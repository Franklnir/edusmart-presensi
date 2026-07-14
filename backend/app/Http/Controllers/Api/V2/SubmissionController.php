<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\GradeSubmissionRequest;
use App\Http\Requests\Api\V2\StoreSubmissionRequest;
use App\Http\Requests\Api\V2\UpdateSubmissionRequest;
use App\Models\Profile;
use App\Models\Tugas;
use App\Models\TugasJawaban;
use App\Services\AttachmentClaimService;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class SubmissionController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotencyService,
        private readonly AttachmentClaimService $attachmentClaims
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', TugasJawaban::class);
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actor = $request->user()->profile;
        $query = TugasJawaban::with('student:id,nama,photo_url')
            ->where('tenant_id', $tenantId)
            ->whereHas('tugas', fn ($assignment) => $assignment->where('tenant_id', $tenantId));

        if ($request->filled('tugas_id')) {
            $ids = collect((array) $request->query('tugas_id'))->take(100)->all();
            $query->whereIn('tugas_id', $ids);
        }
        if ($actor->role === 'siswa') {
            $query->where('user_id', $actor->id);
        } elseif ($actor->role === 'guru') {
            $query->whereHas('tugas', fn ($assignment) => $assignment
                ->where('tenant_id', $tenantId)
                ->where('created_by', $actor->id));
        } elseif ($request->filled('user_id')) {
            $query->where('user_id', $request->query('user_id'));
        }

        $query->orderByDesc('waktu_submit');
        $requested = $request->query('per_page', 50);
        if ($requested === 'all') {
            return response()->json([
                'success' => true,
                'data' => $query->limit(500)->get(),
                'request_id' => $this->requestId($request),
            ]);
        }

        $submissions = $query->paginate(max(1, min((int) $requested, 100)))->appends($request->query());

        return response()->json([
            'success' => true,
            'data' => $submissions->items(),
            'meta' => [
                'current_page' => $submissions->currentPage(),
                'last_page' => $submissions->lastPage(),
                'per_page' => $submissions->perPage(),
                'total' => $submissions->total(),
            ],
            'request_id' => $this->requestId($request),
        ]);
    }

    public function store(StoreSubmissionRequest $request): JsonResponse
    {
        Gate::authorize('create', TugasJawaban::class);
        $validated = $request->validated();
        $actor = $request->user()->profile;
        $tenantId = (string) $request->attributes->get('tenant_id');

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $validated, $actor, $tenantId) {
                try {
                    $submission = DB::transaction(function () use ($validated, $actor, $tenantId) {
                        $assignment = Tugas::where('tenant_id', $tenantId)
                            ->whereKey($validated['tugas_id'])
                            ->lockForUpdate()
                            ->firstOrFail();
                        Gate::authorize('view', $assignment);
                        $this->assertOpenForSubmission($assignment);

                        if ($assignment->kelas !== $actor->kelas) {
                            throw new \LogicException('SUBMISSION_CLASS_MISMATCH');
                        }
                        if (TugasJawaban::where('tenant_id', $tenantId)
                            ->where('tugas_id', $assignment->id)
                            ->where('user_id', $actor->id)
                            ->exists()) {
                            throw new \LogicException('SUBMISSION_ALREADY_EXISTS');
                        }

                        $submission = new TugasJawaban;
                        $submission->tenant_id = $tenantId;
                        $submission->tugas_id = $assignment->id;
                        $submission->user_id = $actor->id;
                        $submission->link_url = $validated['link_url'] ?? null;
                        $submission->file_name = $validated['file_name'] ?? null;
                        $submission->komentar_siswa = $validated['komentar_siswa'] ?? null;
                        $submission->status = 'menunggu';
                        $submission->waktu_submit = now();
                        $submission->save();

                        $submission->attachment_ids = $this->attachmentClaims->claim(
                            $validated['attachment_ids'] ?? [],
                            $tenantId,
                            $actor->id,
                            'submission_attachment',
                            $assignment->id,
                            'submission',
                            $submission->id
                        ) ?: null;
                        $submission->save();
                        $this->audit($actor, 'INSERT', $submission, null);

                        return $submission;
                    });
                } catch (\LogicException $exception) {
                    return $this->domainError($request, $exception);
                }

                return response()->json([
                    'success' => true,
                    'message' => 'Jawaban berhasil dikumpulkan.',
                    'data' => $submission,
                    'request_id' => $this->requestId($request),
                ], 201);
            }
        );
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $submission = $this->tenantSubmission($request, $id)->with('student:id,nama,photo_url')->firstOrFail();
        Gate::authorize('view', $submission);

        return response()->json([
            'success' => true,
            'data' => $submission,
            'request_id' => $this->requestId($request),
        ]);
    }

    public function update(UpdateSubmissionRequest $request, string $id): JsonResponse
    {
        $submission = $this->tenantSubmission($request, $id)->firstOrFail();
        Gate::authorize('update', $submission);
        $validated = $request->validated();
        $actor = $request->user()->profile;
        $tenantId = (string) $request->attributes->get('tenant_id');

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $submission, $validated, $actor, $tenantId) {
                try {
                    $submission = DB::transaction(function () use ($submission, $validated, $actor, $tenantId) {
                        $submission = TugasJawaban::where('tenant_id', $tenantId)
                            ->whereKey($submission->id)
                            ->lockForUpdate()
                            ->firstOrFail();
                        $assignment = Tugas::where('tenant_id', $tenantId)
                            ->whereKey($submission->tugas_id)
                            ->lockForUpdate()
                            ->firstOrFail();
                        $this->assertOpenForSubmission($assignment);
                        $before = $submission->toArray();

                        foreach (['link_url', 'file_name', 'komentar_siswa'] as $field) {
                            if (array_key_exists($field, $validated)) {
                                $submission->{$field} = $validated[$field];
                            }
                        }
                        if (array_key_exists('attachment_ids', $validated)) {
                            $submission->attachment_ids = $this->attachmentClaims->claim(
                                $validated['attachment_ids'] ?? [],
                                $tenantId,
                                $actor->id,
                                'submission_attachment',
                                $assignment->id,
                                'submission',
                                $submission->id
                            );
                        }
                        $submission->waktu_submit = now();
                        $submission->status = 'menunggu';
                        $submission->nilai = null;
                        $submission->dinilai_oleh = null;
                        $submission->dinilai_at = null;
                        $submission->save();
                        $this->audit($actor, 'UPDATE', $submission, $before);

                        return $submission;
                    });
                } catch (\LogicException $exception) {
                    return $this->domainError($request, $exception);
                }

                return response()->json([
                    'success' => true,
                    'message' => 'Jawaban berhasil diperbarui.',
                    'data' => $submission,
                    'request_id' => $this->requestId($request),
                ]);
            }
        );
    }

    public function grade(GradeSubmissionRequest $request, string $id): JsonResponse
    {
        $submission = $this->tenantSubmission($request, $id)->firstOrFail();
        Gate::authorize('grade', $submission);
        $validated = $request->validated();
        $actor = $request->user()->profile;
        $tenantId = (string) $request->attributes->get('tenant_id');

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $submission, $validated, $actor, $tenantId) {
                $submission = DB::transaction(function () use ($submission, $validated, $actor, $tenantId) {
                    $submission = TugasJawaban::where('tenant_id', $tenantId)
                        ->whereKey($submission->id)
                        ->lockForUpdate()
                        ->firstOrFail();
                    Gate::authorize('grade', $submission);
                    $before = $submission->toArray();
                    $submission->nilai = $validated['nilai'];
                    $submission->status = $validated['status'] ?? 'dinilai';
                    $submission->dinilai_oleh = $actor->id;
                    $submission->dinilai_at = now();
                    $submission->save();
                    $this->audit($actor, 'UPDATE', $submission, $before);

                    return $submission;
                });

                return response()->json([
                    'success' => true,
                    'message' => 'Jawaban berhasil dinilai.',
                    'data' => $submission,
                    'request_id' => $this->requestId($request),
                ]);
            }
        );
    }

    public function gradeByUser(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'tugas_id' => ['required', 'integer'],
            'user_id' => ['required', 'uuid'],
            'nilai' => ['required', 'integer', 'min:0', 'max:100'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ]);
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actor = $request->user()->profile;

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $validated, $tenantId, $actor) {
                try {
                    $submission = DB::transaction(function () use ($validated, $tenantId, $actor) {
                        $assignment = Tugas::where('tenant_id', $tenantId)
                            ->whereKey($validated['tugas_id'])
                            ->lockForUpdate()
                            ->firstOrFail();
                        $student = Profile::where('tenant_id', $tenantId)
                            ->where('role', 'siswa')
                            ->whereKey($validated['user_id'])
                            ->firstOrFail();
                        if ($student->kelas !== $assignment->kelas) {
                            throw new \LogicException('SUBMISSION_CLASS_MISMATCH');
                        }

                        $submission = TugasJawaban::where('tenant_id', $tenantId)
                            ->where('tugas_id', $assignment->id)
                            ->where('user_id', $student->id)
                            ->lockForUpdate()
                            ->first();
                        if (! $submission) {
                            throw new \LogicException('SUBMISSION_NOT_FOUND');
                        }
                        Gate::authorize('grade', $submission);
                        $before = $submission->toArray();
                        $submission->nilai = $validated['nilai'];
                        $submission->status = 'dinilai';
                        $submission->dinilai_oleh = $actor->id;
                        $submission->dinilai_at = now();
                        $submission->save();
                        $this->audit($actor, 'UPDATE', $submission, $before);

                        return $submission;
                    });
                } catch (\LogicException $exception) {
                    return $this->domainError($request, $exception);
                }

                return response()->json([
                    'success' => true,
                    'message' => 'Jawaban berhasil dinilai.',
                    'data' => $submission,
                    'request_id' => $this->requestId($request),
                ]);
            }
        );
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $submission = $this->tenantSubmission($request, $id)->firstOrFail();
        Gate::authorize('delete', $submission);
        $actor = $request->user()->profile;

        return $this->idempotencyService->handle($request, null, function () use ($request, $submission, $actor) {
            DB::transaction(function () use ($submission, $actor) {
                $submission = TugasJawaban::where('tenant_id', $actor->tenant_id)
                    ->whereKey($submission->id)
                    ->lockForUpdate()
                    ->firstOrFail();
                Gate::authorize('delete', $submission);
                $before = $submission->toArray();
                $submission->delete();
                $this->audit($actor, 'DELETE', $submission, $before);
            });

            return response()->json([
                'success' => true,
                'message' => 'Jawaban berhasil dihapus.',
                'request_id' => $this->requestId($request),
            ]);
        });
    }

    private function tenantSubmission(Request $request, string $id)
    {
        $tenantId = (string) $request->attributes->get('tenant_id');

        return TugasJawaban::where('tenant_id', $tenantId)
            ->whereHas('tugas', fn ($assignment) => $assignment->where('tenant_id', $tenantId))
            ->whereKey($id);
    }

    private function assertOpenForSubmission(Tugas $assignment): void
    {
        if ($assignment->status !== 'published') {
            throw new \LogicException('ASSIGNMENT_NOT_OPEN');
        }
        if ($assignment->mulai && $assignment->mulai->isFuture()) {
            throw new \LogicException('ASSIGNMENT_NOT_STARTED');
        }
        if ($assignment->deadline && $assignment->deadline->isPast()) {
            throw new \LogicException('ASSIGNMENT_DEADLINE_PASSED');
        }
    }

    private function audit(Profile $actor, string $action, TugasJawaban $submission, ?array $before): void
    {
        DB::table('audit_log')->insert([
            'tenant_id' => $actor->tenant_id,
            'table_name' => 'tugas_jawaban',
            'record_id' => (string) $submission->id,
            'action' => $action,
            'old_data' => $before ? json_encode($before) : null,
            'new_data' => $action === 'DELETE' ? null : json_encode($submission->toArray()),
            'user_id' => $actor->id,
            'user_role' => $actor->role,
            'timestamp' => now(),
        ]);
    }

    private function domainError(Request $request, \LogicException $exception): JsonResponse
    {
        $code = $exception->getMessage();
        $status = str_contains($code, 'TENANT') || str_contains($code, 'OWNER') || str_contains($code, 'CLASS') ? 403 : 409;

        return $this->error($request, $code, 'Submission tidak dapat diproses.', $status);
    }

    private function requestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    private function error(Request $request, string $code, string $message, int $status): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => $code,
            'message' => $message,
            'request_id' => $this->requestId($request),
        ], $status);
    }
}
