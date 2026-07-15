<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Api\QuizController as LegacyQuizController;
use App\Services\Academic\AcademicContextResolver;
use App\Services\IdempotencyService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class QuizController extends LegacyQuizController
{
    public function index(Request $request): JsonResponse
    {
        return parent::dashboard($request);
    }

    public function show(Request $request, string $quiz): JsonResponse
    {
        $response = parent::detail($request, $quiz);
        if (strtolower((string) ($this->profile($request)?->role ?? '')) !== 'siswa') {
            return $response;
        }

        $payload = $response->getData(true);
        $quizPayload = $payload['data']['quiz'] ?? null;
        if (is_array($quizPayload) && ! (bool) ($quizPayload['result_visible_to_students'] ?? false)) {
            unset(
                $payload['data']['submission']['score'],
                $payload['data']['submission']['total_points']
            );
        }

        return response()->json($payload, $response->getStatusCode());
    }

    public function store(Request $request): JsonResponse
    {
        if (! $this->canManage($request)) {
            return $this->deny('Quiz hanya dapat dikelola guru atau admin.', 403);
        }

        $tenantId = (string) $request->attributes->get('tenant_id');
        $actorId = (string) $request->user()->id;
        $validated = $request->validate([
            'nama' => ['required', 'string', 'max:255'],
            'kelas_id' => ['required', 'string', 'max:100'],
            'mapel' => ['required', 'string', 'max:150'],
            'duration_minutes' => ['nullable', 'integer', 'min:1', 'max:600'],
            'starts_at' => ['nullable', 'date'],
            'deadline_at' => ['nullable', 'date'],
            'mode' => ['nullable', 'string', 'max:40'],
            'is_live' => ['nullable', 'boolean'],
            'access_device' => ['nullable', 'string', 'max:40'],
            'result_visible_to_students' => ['nullable', 'boolean'],
        ]);

        if (! $this->teacherOwnsClassSubject($request, $tenantId, $validated['kelas_id'], $validated['mapel'])) {
            return $this->deny('Kelas dan mata pelajaran tidak sesuai penugasan guru.', 403);
        }

        if (! empty($validated['starts_at']) && Carbon::parse($validated['starts_at'])->lte(now())) {
            return response()->json(['message' => 'Tanggal mulai quiz tidak boleh di masa lalu'], 422);
        }
        if (! empty($validated['starts_at']) && ! empty($validated['deadline_at'])) {
            if (Carbon::parse($validated['deadline_at'])->lte(Carbon::parse($validated['starts_at']))) {
                return response()->json(['message' => 'Tanggal selesai quiz harus setelah tanggal mulai'], 422);
            }
        }

        $idempotency = app(IdempotencyService::class);

        try {
            $academic = app(AcademicContextResolver::class)->forMutation($request, $tenantId, 'quizzes');
        } catch (\DomainException $exception) {
            return response()->json(['message' => $exception->getMessage(), 'code' => 'PERIOD_LOCKED'], 409);
        }

        return $idempotency->handle($request, $request->header('Idempotency-Key'), function () use ($request, $validated, $academic, $tenantId, $actorId) {
            return DB::transaction(function () use ($request, $validated, $academic, $tenantId, $actorId) {
                $now = now();
                $id = (string) Str::uuid();
                $payload = [
                    'id' => $id,
                    'tenant_id' => $tenantId,
                    'guru_id' => $actorId,
                    'kelas_id' => $validated['kelas_id'],
                    'mapel' => trim($validated['mapel']),
                    'nama' => trim($validated['nama']),
                    'duration_minutes' => $validated['duration_minutes'] ?? null,
                    'starts_at' => $validated['starts_at'] ?? null,
                    'deadline_at' => $validated['deadline_at'] ?? null,
                    'is_active' => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];

                foreach (['mode', 'is_live', 'result_visible_to_students', 'access_device'] as $column) {
                    if (Schema::hasColumn('quizzes', $column) && array_key_exists($column, $validated)) {
                        $payload[$column] = $validated[$column];
                    }
                }
                foreach (['tahun_ajaran', 'semester', 'academic_year_id', 'academic_term_id'] as $column) {
                    if (Schema::hasColumn('quizzes', $column) && array_key_exists($column, $academic)) {
                        $payload[$column] = $academic[$column];
                    }
                }

                DB::table('quizzes')->insert($payload);

                return response()->json([
                    'success' => true,
                    'data' => DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $id)->first(),
                    'request_id' => $this->requestId($request),
                ], 201);
            });
        });
    }

    public function update(Request $request, string $quiz): JsonResponse
    {
        if (! $this->canManage($request)) {
            return $this->deny('Quiz hanya dapat dikelola guru atau admin.', 403);
        }

        $tenantId = (string) $request->attributes->get('tenant_id');
        $row = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->first();
        if (! $row) {
            return response()->json(['message' => 'Quiz tidak ditemukan'], 404);
        }
        if (! $this->ownsQuiz($request, $row)) {
            return $this->deny('Quiz tidak diizinkan.', 403);
        }

        $academicGuard = $this->quizMutationContext($request, $tenantId, $row);
        if ($academicGuard instanceof JsonResponse) {
            return $academicGuard;
        }

        $validated = $request->validate([
            'nama' => ['sometimes', 'string', 'max:255'],
            'mode' => ['sometimes', 'string', 'max:40'],
            'is_live' => ['sometimes', 'boolean'],
            'duration_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:600'],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'deadline_at' => ['sometimes', 'nullable', 'date'],
            'result_visible_to_students' => ['sometimes', 'boolean'],
        ]);

        $ongoingSubmission = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quiz)
            ->where('status', 'ongoing')
            ->exists();
        if ($ongoingSubmission && array_diff(array_keys($validated), ['deadline_at']) !== []) {
            return response()->json([
                'message' => 'Quiz sedang dikerjakan siswa. Hanya deadline yang boleh diubah.',
            ], 409);
        }

        $timelineError = $this->validateTimeline($row, $validated, $academicGuard);
        if ($timelineError !== null) {
            return response()->json(['message' => $timelineError], 422);
        }

        $updates = [];
        foreach (array_keys($validated) as $column) {
            if (Schema::hasColumn('quizzes', $column)) {
                $updates[$column] = $validated[$column];
            }
        }
        if (array_key_exists('mode', $validated)) {
            $mode = strtolower(trim((string) $validated['mode']));
            if ($mode === 'regular') {
                $updates['is_live'] = false;
                $updates['duration_minutes'] = null;
                if (Schema::hasColumn('quizzes', 'live_started_at')) {
                    $updates['live_started_at'] = null;
                }
            } elseif (Schema::hasColumn('quizzes', 'is_live')) {
                $updates['is_live'] = true;
            }
            if (Schema::hasColumn('quizzes', 'is_active')) {
                $updates['is_active'] = false;
            }
        }
        $mode = strtolower(trim((string) ($validated['mode'] ?? $row->mode ?? '')));
        if ($mode !== 'regular' && (array_key_exists('starts_at', $validated) || array_key_exists('duration_minutes', $validated))) {
            $startsValue = $validated['starts_at'] ?? $row->starts_at ?? null;
            $duration = (int) ($validated['duration_minutes'] ?? $row->duration_minutes ?? 0);
            if ($startsValue && $duration > 0) {
                $startsAt = Carbon::parse($startsValue);
                if (Schema::hasColumn('quizzes', 'deadline_at')) {
                    $updates['deadline_at'] = $startsAt->copy()->addMinutes($duration)->toISOString();
                }
                if (Schema::hasColumn('quizzes', 'live_started_at')) {
                    $updates['live_started_at'] = $startsAt->toISOString();
                }
            }
        }
        if ($updates === []) {
            return response()->json(['message' => 'Tidak ada perubahan quiz'], 422);
        }
        $updates['updated_at'] = now();

        return app(IdempotencyService::class)->handle($request, $request->header('Idempotency-Key'), function () use ($request, $tenantId, $quiz, $updates) {
            DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->update($updates);

            return response()->json([
                'success' => true,
                'data' => DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->first(),
                'request_id' => $this->requestId($request),
            ]);
        });
    }

    public function destroy(Request $request, string $quiz): JsonResponse
    {
        if (! $this->canManage($request)) {
            return $this->deny('Quiz hanya dapat dikelola guru atau admin.', 403);
        }

        $tenantId = (string) $request->attributes->get('tenant_id');
        $row = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->first();
        if (! $row) {
            return response()->json(['message' => 'Quiz tidak ditemukan'], 404);
        }
        if (! $this->ownsQuiz($request, $row)) {
            return $this->deny('Quiz tidak diizinkan.', 403);
        }
        $academicGuard = $this->quizMutationContext($request, $tenantId, $row);
        if ($academicGuard instanceof JsonResponse) {
            return $academicGuard;
        }
        if (DB::table('quiz_submissions')->where('tenant_id', $tenantId)->where('quiz_id', $quiz)->exists()) {
            return response()->json(['message' => 'Quiz yang sudah memiliki attempt tidak dapat dihapus.'], 409);
        }

        return app(IdempotencyService::class)->handle($request, $request->header('Idempotency-Key'), function () use ($tenantId, $quiz, $request) {
            DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->delete();

            return response()->json(['success' => true, 'request_id' => $this->requestId($request)]);
        });
    }

    public function cloneQuiz(Request $request): JsonResponse
    {
        return app(IdempotencyService::class)->handle(
            $request,
            $request->header('Idempotency-Key'),
            fn () => parent::clone($request)
        );
    }

    public function publishQuiz(Request $request, string $quiz): JsonResponse
    {
        return $this->guardedQuizMutation($request, $quiz, fn (Request $request) => parent::publish($request));
    }

    public function scheduleQuiz(Request $request, string $quiz): JsonResponse
    {
        return $this->guardedQuizMutation($request, $quiz, fn (Request $request) => parent::schedule($request));
    }

    public function closeQuiz(Request $request, string $quiz): JsonResponse
    {
        return $this->guardedQuizMutation($request, $quiz, fn (Request $request) => parent::close($request));
    }

    public function archiveQuiz(Request $request, string $quiz): JsonResponse
    {
        return $this->closeQuiz($request, $quiz);
    }

    public function participants(Request $request, string $quiz): JsonResponse
    {
        if (! $this->canManage($request)) {
            return $this->deny('Peserta quiz hanya dapat dilihat guru atau admin.', 403);
        }

        $tenantId = (string) $request->attributes->get('tenant_id');
        $quizRow = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->first();
        if (! $quizRow || ! $this->ownsQuiz($request, $quizRow)) {
            return response()->json(['message' => 'Quiz tidak ditemukan'], 404);
        }

        $historicalStudentIds = collect();
        $quizYear = trim((string) ($quizRow->tahun_ajaran ?? ''));
        if (
            $quizYear !== ''
            && Schema::hasTable('student_class_histories')
            && Schema::hasColumn('student_class_histories', 'tenant_id')
            && Schema::hasColumn('student_class_histories', 'tahun_ajaran')
            && Schema::hasColumn('student_class_histories', 'class_id')
            && Schema::hasColumn('student_class_histories', 'student_id')
            && Schema::hasColumn('student_class_histories', 'status')
        ) {
            $historicalStudentIds = DB::table('student_class_histories')
                ->where('tenant_id', $tenantId)
                ->where('tahun_ajaran', $quizYear)
                ->where('class_id', $quizRow->kelas_id)
                ->whereIn('status', ['active', 'nonaktif', 'mutasi'])
                ->pluck('student_id')
                ->filter()
                ->unique()
                ->values();
        }

        $students = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->when(
                $historicalStudentIds->isNotEmpty(),
                fn ($query) => $query->whereIn('id', $historicalStudentIds->all()),
                fn ($query) => $query->where('kelas', $quizRow->kelas_id)
            )
            ->orderBy('nama')
            ->get(['id', 'nama', 'nis', 'photo_path', 'photo_url']);

        $submissions = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quiz)
            ->get();
        $studentIds = $students->pluck('id')->merge($submissions->pluck('siswa_id'))->filter()->unique()->values();
        $presence = $studentIds->isEmpty() || ! Schema::hasTable('user_presence')
            ? collect()
            : DB::table('user_presence')
                ->where('tenant_id', $tenantId)
                ->whereIn('user_id', $studentIds->all())
                ->orderByDesc('last_seen_at')
                ->get(['user_id', 'device_id', 'last_seen_at', 'activity_count']);
        $warnings = ! Schema::hasTable('quiz_violation_logs')
            ? collect()
            : DB::table('quiz_violation_logs')
                ->where('tenant_id', $tenantId)
                ->where('quiz_id', $quiz)
                ->orderByDesc('created_at')
                ->limit(300)
                ->get(['id', 'quiz_id', 'submission_id', 'siswa_id', 'event_type', 'event_message', 'event_meta', 'created_at']);

        return response()->json([
            'success' => true,
            'data' => [
                'students' => $students,
                'submissions' => $submissions,
                'presence' => $presence,
                'warnings' => $warnings,
            ],
            'request_id' => $this->requestId($request),
        ]);
    }

    public function attemptAnswers(Request $request, string $quiz, string $attempt): JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id');
        $row = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quiz)
            ->where('id', $attempt)
            ->first();
        if (! $row) {
            return response()->json(['message' => 'Attempt tidak ditemukan'], 404);
        }
        $role = strtolower((string) ($this->profile($request)?->role ?? ''));
        if ($role === 'siswa' && (string) $row->siswa_id !== (string) $request->user()->id) {
            return $this->deny('Attempt tidak diizinkan.', 403);
        }
        if (in_array($role, ['guru', 'admin'], true)) {
            $quizRow = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->first();
            if (! $quizRow || ! $this->ownsQuiz($request, $quizRow)) {
                return $this->deny('Attempt tidak diizinkan.', 403);
            }
        }

        $quizRow = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->first();
        if (
            $role === 'siswa'
            && $quizRow
            && (
                (string) ($row->status ?? '') !== 'finished'
                || ! (bool) ($quizRow->result_visible_to_students ?? false)
            )
        ) {
            $row = (object) collect((array) $row)
                ->except(['score', 'total_points', 'is_correct', 'poin', 'essay_score'])
                ->all();
        }

        $answers = DB::table('quiz_answers')->where('submission_id', $attempt)->get();
        if ($role === 'siswa' && $quizRow && ! (bool) ($quizRow->result_visible_to_students ?? false)) {
            $answers = $answers->map(function ($answer) {
                $payload = (array) $answer;
                unset($payload['is_correct'], $payload['poin'], $payload['essay_score']);

                return (object) $payload;
            });
        }

        return response()->json([
            'success' => true,
            'data' => [
                'submission' => $row,
                'answers' => $answers,
            ],
            'request_id' => $this->requestId($request),
        ]);
    }

    public function retakeHistoryV2(Request $request, string $quiz): JsonResponse
    {
        $request->query->set('quiz_id', $quiz);

        return parent::retakeHistory($request);
    }

    private function withQuizId(Request $request, string $quiz, callable $callback): JsonResponse
    {
        $request->request->set('quiz_id', $quiz);

        return $callback($request);
    }

    private function guardedQuizMutation(Request $request, string $quiz, callable $callback): JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id');
        $row = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quiz)->first();
        if (! $row) {
            return response()->json(['message' => 'Quiz tidak ditemukan'], 404);
        }
        if (! $this->ownsQuiz($request, $row)) {
            return $this->deny('Quiz tidak diizinkan.', 403);
        }
        $guard = $this->quizMutationContext($request, $tenantId, $row);
        if ($guard instanceof JsonResponse) {
            return $guard;
        }

        return app(IdempotencyService::class)->handle(
            $request,
            $request->header('Idempotency-Key'),
            fn () => $this->withQuizId($request, $quiz, $callback)
        );
    }

    private function quizMutationContext(Request $request, string $tenantId, object $quiz): array|JsonResponse
    {
        try {
            $context = app(AcademicContextResolver::class)->forMutation($request, $tenantId, 'quizzes');
        } catch (\DomainException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => 'PERIOD_LOCKED',
            ], 409);
        }

        foreach ([
            'tahun_ajaran' => 'tahun_ajaran',
            'semester' => 'semester',
            'academic_year_id' => 'academic_year_id',
            'academic_term_id' => 'academic_term_id',
        ] as $column => $contextKey) {
            if (! Schema::hasColumn('quizzes', $column)) {
                continue;
            }
            $stored = trim((string) ($quiz->{$column} ?? ''));
            $requested = trim((string) ($context[$contextKey] ?? ''));
            if ($stored !== '' && $requested !== '' && $stored !== $requested) {
                return response()->json([
                    'message' => 'Quiz berada pada periode akademik lain.',
                    'code' => 'PERIOD_LOCKED',
                ], 409);
            }
        }

        return $context;
    }

    private function canManage(Request $request): bool
    {
        return in_array(strtolower((string) ($request->user()?->profile?->role ?? '')), ['guru', 'admin'], true);
    }

    private function ownsQuiz(Request $request, object $quiz): bool
    {
        $role = strtolower((string) ($request->user()?->profile?->role ?? ''));

        return $role === 'admin' || (string) ($quiz->guru_id ?? '') === (string) $request->user()->id;
    }

    private function teacherOwnsClassSubject(Request $request, string $tenantId, string $classId, string $subject): bool
    {
        if (strtolower((string) ($request->user()?->profile?->role ?? '')) === 'admin') {
            return true;
        }

        return DB::table('jadwal')
            ->where('tenant_id', $tenantId)
            ->where('guru_id', $request->user()->id)
            ->where('kelas_id', $classId)
            ->whereRaw('lower(trim(mapel)) = ?', [strtolower(trim($subject))])
            ->exists();
    }

    private function validateTimeline(object $quiz, array $validated, array $context): ?string
    {
        if (! array_intersect(['starts_at', 'deadline_at'], array_keys($validated))) {
            return null;
        }

        try {
            $startsAt = Carbon::parse($validated['starts_at'] ?? $quiz->starts_at ?? null)->setTimezone('Asia/Jakarta');
            $deadlineAt = Carbon::parse($validated['deadline_at'] ?? $quiz->deadline_at ?? null)->setTimezone('Asia/Jakarta');
        } catch (\Throwable) {
            return 'Jadwal quiz tidak valid';
        }

        if ($deadlineAt->lte($startsAt)) {
            return 'Tanggal selesai quiz harus setelah tanggal mulai';
        }

        $academicYear = trim((string) ($context['tahun_ajaran'] ?? $quiz->tahun_ajaran ?? ''));
        if (! preg_match('/^(\d{4})\/(\d{4})$/', $academicYear, $matches)) {
            return null;
        }

        $startYear = (int) $matches[1];
        $periodStart = Carbon::create($startYear, 7, 1, 0, 0, 0, 'Asia/Jakarta')->startOfDay();
        $periodEnd = Carbon::create($startYear + 1, 6, 30, 23, 59, 59, 'Asia/Jakarta')->endOfDay();
        foreach ([
            'Tanggal mulai' => $startsAt,
            'Waktu selesai' => $deadlineAt,
        ] as $label => $date) {
            if ($date->lt($periodStart) || $date->gt($periodEnd)) {
                return "{$label} quiz harus berada dalam tahun periode {$academicYear} ({$periodStart->toDateString()} sampai {$periodEnd->toDateString()})";
            }
        }

        return null;
    }

    private function requestId(Request $request): string
    {
        return (string) ($request->attributes->get('request_id') ?: $request->header('X-Request-ID', Str::uuid()));
    }
}
