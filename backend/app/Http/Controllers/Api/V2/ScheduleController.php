<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\StoreScheduleRequest;
use App\Http\Requests\Api\V2\UpdateScheduleRequest;
use App\Http\Resources\Api\V2\ScheduleResource;
use App\Models\Jadwal;
use App\Models\Kelas;
use App\Models\Profile;
use App\Services\Academic\AcademicContextResolver;
use App\Services\Academic\AcademicMutationGuard;
use App\Services\Academic\AcademicPeriodLifecycleService;
use App\Services\Academic\HistoricalEnrollmentResolver;
use App\Services\IdempotencyService;
use App\Support\AcademicPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class ScheduleController extends Controller
{
    public function __construct(
        private readonly IdempotencyService $idempotencyService,
        private readonly AcademicContextResolver $academicContext,
        private readonly AcademicPeriodLifecycleService $academicLifecycle,
        private readonly AcademicMutationGuard $academicMutationGuard,
        private readonly HistoricalEnrollmentResolver $historicalEnrollment
    ) {}

    public function index(Request $request): AnonymousResourceCollection|JsonResponse
    {
        Gate::authorize('viewAny', Jadwal::class);
        $tenantId = $this->tenantId($request);
        $context = $this->readContext($request, $tenantId);
        if (($error = $this->contextError($request, $context)) !== null) {
            return $error;
        }

        $query = $this->scopedQuery($request, $context);
        foreach (['kelas_id', 'hari', 'mapel'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }
        if ($request->filled('guru_id') && $request->user()->profile->role === 'admin') {
            $query->where('guru_id', $request->query('guru_id'));
        }

        $schedules = $query
            ->orderByRaw($this->dayOrderSql())
            ->orderBy('jam_mulai')
            ->orderBy('id')
            ->paginate(max(1, min((int) $request->query('per_page', 50), 500)))
            ->appends($request->query());

        return ScheduleResource::collection($schedules)->additional([
            'success' => true,
            'message' => 'Jadwal berhasil dimuat.',
            'academic_context' => $this->publicContext($context),
            'request_id' => $this->requestId($request),
        ]);
    }

    public function store(StoreScheduleRequest $request): JsonResponse
    {
        Gate::authorize('create', Jadwal::class);
        $tenantId = $this->tenantId($request);
        $guard = $this->academicMutationGuard->authorize(
            $request,
            'jadwal',
            'insert',
            $request->validated(),
            [],
            $tenantId
        );
        if (($error = $this->mutationError($request, $guard)) !== null) {
            return $error;
        }

        return $this->idempotencyService->handle(
            $request,
            $request->validated('idempotency_key'),
            function () use ($request, $tenantId, $guard): JsonResponse {
                $validated = $request->validated();

                return DB::transaction(function () use ($request, $tenantId, $guard, $validated): JsonResponse {
                    $class = Kelas::query()
                        ->where('tenant_id', $tenantId)
                        ->where('id', $validated['kelas_id'])
                        ->lockForUpdate()
                        ->first();
                    if (! $class) {
                        return $this->error($request, 'SCHEDULE_CLASS_NOT_FOUND', 'Kelas untuk jadwal tidak ditemukan.', 422);
                    }

                    $teacher = $this->lockedTeacher($tenantId, $validated['guru_id'] ?? null);
                    if (($validated['guru_id'] ?? null) !== null && $teacher === null) {
                        return $this->error($request, 'SCHEDULE_TEACHER_NOT_FOUND', 'Guru pengampu tidak ditemukan atau tidak aktif.', 422);
                    }

                    $attributes = $this->scheduleAttributes($validated, $tenantId, $guard['context'], $teacher);
                    if (($conflict = $this->findConflict($attributes)) !== null) {
                        return $this->conflictError($request, $conflict);
                    }

                    $schedule = Jadwal::create($attributes);
                    $this->audit($tenantId, $request, 'INSERT', $schedule, null, $guard['context']);

                    return (new ScheduleResource($schedule))->additional([
                        'success' => true,
                        'message' => 'Jadwal berhasil dibuat.',
                        'academic_context' => $this->publicContext($guard['context']),
                        'request_id' => $this->requestId($request),
                    ])->response()->setStatusCode(201);
                });
            }
        );
    }

    public function show(Request $request, string $schedule): JsonResponse
    {
        Gate::authorize('viewAny', Jadwal::class);
        $context = $this->readContext($request, $this->tenantId($request));
        if (($error = $this->contextError($request, $context)) !== null) {
            return $error;
        }

        $entry = $this->scopedQuery($request, $context)
            ->where('id', $schedule)
            ->when($request->filled('kelas_id'), fn (Builder $query) => $query->where('kelas_id', $request->query('kelas_id')))
            ->get();
        if ($entry->isEmpty()) {
            return $this->error($request, 'SCHEDULE_NOT_FOUND', 'Jadwal tidak ditemukan.', 404);
        }
        if ($entry->count() > 1) {
            return $this->error($request, 'SCHEDULE_IDENTIFIER_AMBIGUOUS', 'ID jadwal lama tidak unik. Sertakan kelas_id saat meminta data.', 409);
        }

        return (new ScheduleResource($entry->first()))->additional([
            'success' => true,
            'message' => 'Jadwal berhasil dimuat.',
            'academic_context' => $this->publicContext($context),
            'request_id' => $this->requestId($request),
        ])->response();
    }

    public function update(UpdateScheduleRequest $request, string $schedule): JsonResponse
    {
        Gate::authorize('create', Jadwal::class);
        $tenantId = $this->tenantId($request);
        $guard = $this->academicMutationGuard->authorize(
            $request,
            'jadwal',
            'update',
            $request->validated(),
            ['eq' => ['id' => $schedule, 'kelas_id' => $request->validated('kelas_id')]],
            $tenantId
        );
        if (($error = $this->mutationError($request, $guard)) !== null) {
            return $error;
        }

        return $this->idempotencyService->handle(
            $request,
            $request->validated('idempotency_key'),
            function () use ($request, $schedule, $tenantId, $guard): JsonResponse {
                $validated = $request->validated();

                return DB::transaction(function () use ($request, $schedule, $tenantId, $guard, $validated): JsonResponse {
                    $entry = $this->mutationQuery($tenantId, $guard['context'])
                        ->where('id', $schedule)
                        ->where('kelas_id', $validated['kelas_id'])
                        ->lockForUpdate()
                        ->first();
                    if (! $entry) {
                        return $this->error($request, 'SCHEDULE_NOT_FOUND', 'Jadwal tidak ditemukan.', 404);
                    }
                    Gate::authorize('update', $entry);

                    // Lock the class before conflict detection so two concurrent
                    // edits cannot reserve the same class/time slot.
                    Kelas::query()
                        ->where('tenant_id', $tenantId)
                        ->where('id', $entry->kelas_id)
                        ->lockForUpdate()
                        ->firstOrFail();

                    $teacherId = array_key_exists('guru_id', $validated)
                        ? $validated['guru_id']
                        : $entry->guru_id;
                    $teacher = $this->lockedTeacher($tenantId, $teacherId);
                    if ($teacherId !== null && $teacher === null) {
                        return $this->error($request, 'SCHEDULE_TEACHER_NOT_FOUND', 'Guru pengampu tidak ditemukan atau tidak aktif.', 422);
                    }

                    $attributes = $this->scheduleAttributes($validated, $tenantId, $guard['context'], $teacher, $entry);
                    if (($timeError = $this->timeError($attributes)) !== null) {
                        return $this->error($request, 'SCHEDULE_TIME_INVALID', $timeError, 422);
                    }
                    if (($conflict = $this->findConflict($attributes, $entry->id, $entry->kelas_id)) !== null) {
                        return $this->conflictError($request, $conflict);
                    }

                    $before = $entry->toArray();
                    $entry->fill($attributes)->save();
                    $this->audit($tenantId, $request, 'UPDATE', $entry, $before, $guard['context']);

                    return (new ScheduleResource($entry))->additional([
                        'success' => true,
                        'message' => 'Jadwal berhasil diperbarui.',
                        'academic_context' => $this->publicContext($guard['context']),
                        'request_id' => $this->requestId($request),
                    ])->response();
                });
            }
        );
    }

    public function destroy(Request $request, string $schedule): JsonResponse
    {
        Gate::authorize('create', Jadwal::class);
        $classId = trim((string) $request->input('kelas_id', ''));
        if ($classId === '') {
            return $this->error($request, 'SCHEDULE_CLASS_REQUIRED', 'kelas_id wajib dikirim untuk menghapus jadwal.', 422);
        }

        $tenantId = $this->tenantId($request);
        $guard = $this->academicMutationGuard->authorize(
            $request,
            'jadwal',
            'delete',
            [],
            ['eq' => ['id' => $schedule, 'kelas_id' => $classId]],
            $tenantId
        );
        if (($error = $this->mutationError($request, $guard)) !== null) {
            return $error;
        }

        return $this->idempotencyService->handle($request, null, function () use ($request, $schedule, $classId, $tenantId, $guard): JsonResponse {
            return DB::transaction(function () use ($request, $schedule, $classId, $tenantId, $guard): JsonResponse {
                $entry = $this->mutationQuery($tenantId, $guard['context'])
                    ->where('id', $schedule)
                    ->where('kelas_id', $classId)
                    ->lockForUpdate()
                    ->first();
                if (! $entry) {
                    return $this->error($request, 'SCHEDULE_NOT_FOUND', 'Jadwal tidak ditemukan.', 404);
                }
                Gate::authorize('delete', $entry);

                $before = $entry->toArray();
                $entry->delete();
                $this->audit($tenantId, $request, 'DELETE', $entry, $before, $guard['context']);

                return response()->json([
                    'success' => true,
                    'message' => 'Jadwal berhasil dihapus.',
                    'academic_context' => $this->publicContext($guard['context']),
                    'request_id' => $this->requestId($request),
                ]);
            });
        });
    }

    private function scopedQuery(Request $request, array $context): Builder
    {
        $tenantId = $this->tenantId($request);
        $query = Jadwal::query()
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', $context['tahun_ajaran']);
        $actor = $request->user()->profile;

        if ($actor->role === 'guru') {
            $requestedClassId = trim((string) $request->query('kelas_id', ''));
            if ($requestedClassId !== '' && $this->isHomeroomTeacher(
                $tenantId,
                $requestedClassId,
                $context['tahun_ajaran'],
                (string) $actor->id
            )) {
                $query->where('kelas_id', $requestedClassId);
            } else {
                $query->where('guru_id', $actor->id);
            }
        } elseif ($actor->role === 'siswa') {
            $active = $this->academicLifecycle->currentContext($tenantId);
            $classId = $this->historicalEnrollment->resolve(
                $tenantId,
                (string) $actor->id,
                $context['tahun_ajaran'],
                $context['semester'] ?? null,
                $actor->kelas,
                $active['tahun_ajaran'] ?? null
            );
            $classId === null
                ? $query->whereRaw('1 = 0')
                : $query->where('kelas_id', $classId);
        }

        return $query;
    }

    private function isHomeroomTeacher(string $tenantId, string $classId, string $academicYear, string $teacherId): bool
    {
        if (! Schema::hasTable('kelas_struktur')) {
            return false;
        }

        $query = DB::table('kelas_struktur')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', $classId)
            ->where('wali_guru_id', $teacherId);

        if (Schema::hasColumn('kelas_struktur', 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $academicYear);
        }

        return $query->exists();
    }

    private function mutationQuery(string $tenantId, array $context): Builder
    {
        return Jadwal::query()
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', $context['tahun_ajaran']);
    }

    private function lockedTeacher(string $tenantId, ?string $teacherId): ?Profile
    {
        if ($teacherId === null || $teacherId === '') {
            return null;
        }

        return Profile::query()
            ->where('tenant_id', $tenantId)
            ->where('id', $teacherId)
            ->where('role', 'guru')
            ->where(function (Builder $query): void {
                $query->whereNull('status')->orWhere('status', 'active');
            })
            ->lockForUpdate()
            ->first();
    }

    private function scheduleAttributes(array $validated, string $tenantId, array $context, ?Profile $teacher, ?Jadwal $existing = null): array
    {
        $teacherId = array_key_exists('guru_id', $validated) ? $validated['guru_id'] : $existing?->guru_id;

        return [
            'id' => $existing?->id ?? (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'kelas_id' => $existing?->kelas_id ?? $validated['kelas_id'],
            'hari' => $validated['hari'] ?? $existing?->hari,
            'mapel' => $validated['mapel'] ?? $existing?->mapel,
            'guru_id' => $teacherId,
            'guru_nama' => $teacher?->nama,
            'jam_mulai' => $this->normalizeTime($validated['jam_mulai'] ?? $existing?->jam_mulai),
            'jam_selesai' => $this->normalizeTime($validated['jam_selesai'] ?? $existing?->jam_selesai),
            'tahun_ajaran' => $context['tahun_ajaran'],
            'semester' => null,
            'periode_berlaku' => 'tahunan',
            'academic_year_id' => $context['academic_year_id'] ?? null,
        ];
    }

    private function findConflict(array $attributes, ?string $ignoreId = null, ?string $ignoreClassId = null): ?array
    {
        $base = Jadwal::query()
            ->where('tenant_id', $attributes['tenant_id'])
            ->where('tahun_ajaran', $attributes['tahun_ajaran'])
            ->where('hari', $attributes['hari'])
            ->where('jam_mulai', '<', $attributes['jam_selesai'])
            ->where('jam_selesai', '>', $attributes['jam_mulai']);
        if ($ignoreId !== null) {
            $base->where(function (Builder $query) use ($ignoreId, $ignoreClassId): void {
                $query->where('id', '!=', $ignoreId)
                    ->orWhere('kelas_id', '!=', $ignoreClassId);
            });
        }

        $classConflict = (clone $base)->where('kelas_id', $attributes['kelas_id'])->first();
        if ($classConflict) {
            return ['type' => 'class', 'schedule' => $classConflict];
        }

        if (($attributes['guru_id'] ?? null) === null) {
            return null;
        }

        $teacherConflict = (clone $base)->where('guru_id', $attributes['guru_id'])->first();

        return $teacherConflict ? ['type' => 'teacher', 'schedule' => $teacherConflict] : null;
    }

    private function conflictError(Request $request, array $conflict): JsonResponse
    {
        /** @var Jadwal $schedule */
        $schedule = $conflict['schedule'];
        $isTeacher = $conflict['type'] === 'teacher';

        return $this->error(
            $request,
            $isTeacher ? 'SCHEDULE_TEACHER_CONFLICT' : 'SCHEDULE_CLASS_CONFLICT',
            $isTeacher
                ? sprintf('Guru sudah mengajar %s di kelas %s pada %s-%s.', $schedule->mapel, $schedule->kelas_id, $this->displayTime($schedule->jam_mulai), $this->displayTime($schedule->jam_selesai))
                : sprintf('Kelas sudah memiliki jadwal %s pada %s-%s.', $schedule->mapel, $this->displayTime($schedule->jam_mulai), $this->displayTime($schedule->jam_selesai)),
            409
        );
    }

    private function readContext(Request $request, string $tenantId): array
    {
        $year = $request->query('tahun_ajaran');
        if ($year !== null && AcademicPeriod::normalizeAcademicYear($year) === null) {
            return ['invalid' => true];
        }

        return $this->academicContext->forRead($request, $tenantId);
    }

    private function contextError(Request $request, array $context): ?JsonResponse
    {
        if (($context['invalid'] ?? false) === true) {
            return $this->error($request, 'ACADEMIC_YEAR_INVALID', 'Tahun ajaran tidak valid.', 422);
        }
        if (empty($context['tahun_ajaran'])) {
            return $this->error($request, 'ACADEMIC_PERIOD_MISSING', 'Periode akademik belum tersedia.', 409);
        }

        return null;
    }

    private function mutationError(Request $request, array $guard): ?JsonResponse
    {
        if (($guard['allowed'] ?? false) === true) {
            return null;
        }

        return $this->error(
            $request,
            strtoupper((string) ($guard['code'] ?? 'ACADEMIC_PERIOD_LOCKED')),
            (string) ($guard['message'] ?? 'Periode akademik terkunci.'),
            (int) ($guard['status'] ?? 409)
        );
    }

    private function timeError(array $attributes): ?string
    {
        $duration = $this->timeToSeconds($attributes['jam_selesai']) - $this->timeToSeconds($attributes['jam_mulai']);
        if ($duration <= 0) {
            return 'Jam mulai harus lebih awal dari jam selesai.';
        }

        return $duration < 30 * 60 ? 'Durasi pelajaran minimal 30 menit.' : null;
    }

    private function normalizeTime(mixed $value): string
    {
        $time = trim((string) $value);

        return strlen($time) === 5 ? $time.':00' : $time;
    }

    private function displayTime(mixed $value): string
    {
        return substr((string) $value, 0, 5);
    }

    private function timeToSeconds(string $value): int
    {
        $parts = array_map('intval', explode(':', $value));
        $parts = array_pad($parts, 3, 0);

        return ($parts[0] * 3600) + ($parts[1] * 60) + $parts[2];
    }

    private function dayOrderSql(): string
    {
        return "CASE hari WHEN 'Senin' THEN 1 WHEN 'Selasa' THEN 2 WHEN 'Rabu' THEN 3 WHEN 'Kamis' THEN 4 WHEN 'Jumat' THEN 5 WHEN 'Sabtu' THEN 6 WHEN 'Minggu' THEN 7 ELSE 99 END";
    }

    private function tenantId(Request $request): string
    {
        return (string) $request->attributes->get('tenant_id');
    }

    private function requestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    private function publicContext(array $context): array
    {
        return [
            'tahun_ajaran' => $context['tahun_ajaran'] ?? null,
            'semester' => $context['semester'] ?? null,
            'mode' => $context['mode'] ?? 'active',
        ];
    }

    private function audit(string $tenantId, Request $request, string $action, Jadwal $schedule, ?array $before, array $context): void
    {
        $actor = $request->user()->profile;
        $after = $action === 'DELETE' ? null : $schedule->toArray();
        if ($after !== null) {
            $after['academic_context'] = [
                'tahun_ajaran' => $context['tahun_ajaran'] ?? null,
                'semester' => $context['semester'] ?? null,
                'mode' => $context['mode'] ?? 'active',
                'correction_session_id' => $context['correction_session_id'] ?? null,
                'reason' => $context['reason'] ?? null,
            ];
        }

        DB::table('audit_log')->insert([
            'tenant_id' => $tenantId,
            'table_name' => 'jadwal',
            'record_id' => (string) $schedule->id,
            'action' => $action,
            'old_data' => $before ? json_encode($before) : null,
            'new_data' => $after ? json_encode($after) : null,
            'user_id' => $actor->id,
            'user_role' => $actor->role,
            'timestamp' => now(),
        ]);
    }

    private function error(Request $request, string $code, string $message, int $status): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => $code,
            'message' => $message,
            'error' => $message,
            'request_id' => $this->requestId($request),
        ], $status);
    }
}
