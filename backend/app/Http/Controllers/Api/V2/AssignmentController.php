<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreAssignmentRequest;
use App\Http\Requests\Api\V2\UpdateAssignmentRequest;
use App\Models\Tugas;
use App\Models\TugasJawaban;
use App\Services\AcademicAccessService;
use App\Services\AttachmentClaimService;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class AssignmentController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotencyService,
        private readonly AcademicAccessService $academicAccess,
        private readonly AttachmentClaimService $attachmentClaims
    ) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Tugas::class);
        $tenantId = (string) $request->attributes->get('tenant_id');
        $actor = $request->user()->profile;
        $query = Tugas::where('tenant_id', $tenantId);

        foreach (['kelas', 'mapel', 'tahun_ajaran', 'semester'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }
        if ($request->filled('created_by') && $actor->role === 'admin') {
            $query->where('created_by', $request->query('created_by'));
        }

        if ($actor->role === 'siswa') {
            $query->where('kelas', $actor->kelas)->whereIn('status', ['published', 'closed']);
        } elseif ($actor->role === 'guru') {
            $query->where('created_by', $actor->id);
        }

        if ($request->filled('status')) {
            match ($request->query('status')) {
                'active' => $query->where('status', 'published')->where('deadline', '>=', now()),
                'expired' => $query->where('deadline', '<', now()),
                'draft', 'published', 'closed', 'archived' => $query->where('status', $request->query('status')),
                default => null,
            };
        }
        if ($request->filled('created_after')) {
            $query->where('created_at', '>=', $request->query('created_after'));
        }
        if ($request->filled('created_before')) {
            $query->where('created_at', '<', $request->query('created_before'));
        }
        if ($request->filled('search')) {
            $search = mb_substr((string) $request->query('search'), 0, 255);
            $query->where(fn ($nested) => $nested
                ->where('judul', 'like', "%{$search}%")
                ->orWhere('keterangan', 'like', "%{$search}%"));
        }

        $query->orderByDesc('created_at');
        $requested = $request->query('per_page', 25);
        if ($requested === 'all') {
            $data = $query->limit(500)->get();

            return response()->json([
                'success' => true,
                'data' => $data,
                'request_id' => $this->requestId($request),
            ]);
        }

        $assignments = $query->paginate(max(1, min((int) $requested, 100)))->appends($request->query());

        return response()->json([
            'success' => true,
            'data' => $assignments->items(),
            'meta' => [
                'current_page' => $assignments->currentPage(),
                'last_page' => $assignments->lastPage(),
                'per_page' => $assignments->perPage(),
                'total' => $assignments->total(),
            ],
            'request_id' => $this->requestId($request),
        ]);
    }

    public function store(StoreAssignmentRequest $request): JsonResponse
    {
        Gate::authorize('create', Tugas::class);
        $validated = $request->validated();
        $actor = $request->user()->profile;
        $tenantId = (string) $request->attributes->get('tenant_id');

        if (! $this->academicAccess->canManageClass($actor, $validated['kelas'], $validated['mapel'])) {
            return $this->error($request, 'ASSIGNMENT_SCOPE_FORBIDDEN', 'Guru tidak mengampu kelas/mapel tersebut.', 403);
        }

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $validated, $actor, $tenantId) {
                try {
                    $assignment = DB::transaction(function () use ($validated, $actor, $tenantId) {
                        $assignment = new Tugas;
                        $assignment->fill(collect($validated)->except(['attachment_ids', 'idempotency_key'])->all());
                        $assignment->tenant_id = $tenantId;
                        $assignment->created_by = $actor->id;
                        $assignment->status = $validated['status'] ?? 'published';
                        $assignment->mulai = $validated['mulai'] ?? now();
                        $assignment->save();

                        $attachmentIds = $this->attachmentClaims->claim(
                            $validated['attachment_ids'] ?? [],
                            $tenantId,
                            $actor->id,
                            'assignment_attachment',
                            $assignment->id,
                            'assignment',
                            $assignment->id
                        );
                        $assignment->attachment_ids = $attachmentIds ?: null;
                        $assignment->save();

                        $this->audit($tenantId, $actor->id, $actor->role, 'INSERT', $assignment, null);

                        return $assignment;
                    });
                } catch (\LogicException $exception) {
                    return $this->attachmentError($request, $exception);
                }

                return response()->json([
                    'success' => true,
                    'message' => 'Tugas berhasil dibuat.',
                    'data' => $assignment,
                    'request_id' => $this->requestId($request),
                ], 201);
            }
        );
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $assignment = Tugas::where('tenant_id', $request->attributes->get('tenant_id'))->findOrFail($id);
        Gate::authorize('view', $assignment);

        return response()->json([
            'success' => true,
            'data' => $assignment,
            'request_id' => $this->requestId($request),
        ]);
    }

    public function update(UpdateAssignmentRequest $request, string $id): JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id');
        $assignment = Tugas::where('tenant_id', $tenantId)->findOrFail($id);
        Gate::authorize('update', $assignment);
        $validated = $request->validated();
        $actor = $request->user()->profile;
        $classId = $validated['kelas'] ?? $assignment->kelas;
        $subject = $validated['mapel'] ?? $assignment->mapel;
        if (! $this->academicAccess->canManageClass($actor, $classId, $subject)) {
            return $this->error($request, 'ASSIGNMENT_SCOPE_FORBIDDEN', 'Guru tidak mengampu kelas/mapel tersebut.', 403);
        }

        return $this->idempotencyService->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $assignment, $validated, $actor, $tenantId) {
                try {
                    $assignment = DB::transaction(function () use ($assignment, $validated, $actor, $tenantId) {
                        $assignment = Tugas::whereKey($assignment->id)->where('tenant_id', $tenantId)->lockForUpdate()->firstOrFail();
                        $before = $assignment->toArray();
                        $assignment->fill(collect($validated)->except(['attachment_ids', 'idempotency_key'])->all());
                        if (array_key_exists('attachment_ids', $validated)) {
                            $assignment->attachment_ids = $this->attachmentClaims->claim(
                                $validated['attachment_ids'] ?? [],
                                $tenantId,
                                $actor->id,
                                'assignment_attachment',
                                $assignment->id,
                                'assignment',
                                $assignment->id
                            );
                        }
                        $assignment->save();
                        $this->audit($tenantId, $actor->id, $actor->role, 'UPDATE', $assignment, $before);

                        return $assignment;
                    });
                } catch (\LogicException $exception) {
                    return $this->attachmentError($request, $exception);
                }

                return response()->json([
                    'success' => true,
                    'message' => 'Tugas berhasil diperbarui.',
                    'data' => $assignment,
                    'request_id' => $this->requestId($request),
                ]);
            }
        );
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id');
        $assignment = Tugas::where('tenant_id', $tenantId)->findOrFail($id);
        Gate::authorize('delete', $assignment);
        if (TugasJawaban::where('tugas_id', $assignment->id)->exists()) {
            return $this->error($request, 'ASSIGNMENT_HAS_SUBMISSIONS', 'Tugas dengan submission tidak dapat dihapus.', 409);
        }

        DB::transaction(function () use ($assignment, $request, $tenantId) {
            $before = $assignment->toArray();
            $assignment->delete();
            $actor = $request->user()->profile;
            $this->audit($tenantId, $actor->id, $actor->role, 'DELETE', $assignment, $before);
        });

        return response()->json([
            'success' => true,
            'message' => 'Tugas berhasil dihapus.',
            'request_id' => $this->requestId($request),
        ]);
    }

    private function audit(string $tenantId, string $actorId, string $role, string $action, Tugas $assignment, ?array $before): void
    {
        DB::table('audit_log')->insert([
            'tenant_id' => $tenantId,
            'table_name' => 'tugas',
            'record_id' => (string) $assignment->id,
            'action' => $action,
            'old_data' => $before ? json_encode($before) : null,
            'new_data' => $action === 'DELETE' ? null : json_encode($assignment->toArray()),
            'user_id' => $actorId,
            'user_role' => $role,
            'timestamp' => now(),
        ]);
    }

    private function attachmentError(Request $request, \LogicException $exception): JsonResponse
    {
        $code = $exception->getMessage();
        $status = str_contains($code, 'TENANT') || str_contains($code, 'OWNER') ? 403 : 409;

        return $this->error($request, $code, 'Attachment tidak dapat diklaim untuk tugas ini.', $status);
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
