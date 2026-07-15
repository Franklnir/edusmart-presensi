<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V2\ListGradeWeightsRequest;
use App\Http\Requests\Api\V2\ListManualScoresRequest;
use App\Http\Requests\Api\V2\UpsertGradeWeightRequest;
use App\Http\Requests\Api\V2\UpsertManualScoreRequest;
use App\Http\Resources\Api\V2\GradeWeightResource;
use App\Http\Resources\Api\V2\ManualScoreResource;
use App\Services\Academic\AcademicContextResolver;
use App\Services\Academic\AcademicMutationGuard;
use App\Services\Academic\HistoricalEnrollmentResolver;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class GradeController extends Controller
{
    public function __construct(
        private readonly AcademicContextResolver $academicContext,
        private readonly AcademicMutationGuard $academicMutationGuard,
        private readonly IdempotencyService $idempotency,
        private readonly HistoricalEnrollmentResolver $historicalEnrollment
    ) {}

    public function weights(ListGradeWeightsRequest $request): AnonymousResourceCollection|JsonResponse
    {
        $this->authorizeGradeRole($request);
        $tenantId = $this->tenantId($request);
        $context = $this->academicContext->forRead($request, $tenantId);

        if (($error = $this->contextError($request, $context)) !== null) {
            return $error;
        }

        $role = $this->role($request);
        $query = DB::table('guru_mapel_bobot')
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', $context['tahun_ajaran'])
            ->where('semester', $context['semester'])
            ->when($role === 'guru' || $role === 'teacher', fn ($builder) => $builder->where('guru_id', $request->user()->id))
            ->when($request->filled('guru_id') && $role === 'admin', fn ($builder) => $builder->where('guru_id', $request->query('guru_id')))
            ->when($request->filled('mapel'), fn ($builder) => $builder->where('mapel', trim((string) $request->query('mapel'))))
            ->orderBy('mapel')
            ->orderBy('guru_id');

        $perPage = min(max((int) $request->query('per_page', 50), 1), 100);

        return GradeWeightResource::collection($query->paginate($perPage)->appends($request->query()))
            ->additional([
                'success' => true,
                'message' => 'Bobot penilaian berhasil dimuat.',
                'academic_context' => $this->publicContext($context),
                'request_id' => $this->requestId($request),
            ]);
    }

    public function upsertWeights(UpsertGradeWeightRequest $request): JsonResponse
    {
        $this->authorizeGradeRole($request);
        $tenantId = $this->tenantId($request);
        $validated = $request->validated();
        $guard = $this->academicMutationGuard->authorize(
            $request,
            'guru_mapel_bobot',
            'upsert',
            $validated,
            [
                'eq' => [
                    'tahun_ajaran' => $validated['tahun_ajaran'],
                    'semester' => $validated['semester'],
                ],
            ],
            $tenantId
        );

        if (($error = $this->mutationError($request, $guard)) !== null) {
            return $error;
        }

        $role = $this->role($request);
        $guruId = $role === 'guru' || $role === 'teacher'
            ? (string) $request->user()->id
            : trim((string) ($validated['guru_id'] ?? ''));

        if ($guruId === '') {
            return $this->error($request, 'GRADE_TEACHER_REQUIRED', 'Guru pengampu wajib dipilih.', 422);
        }
        if (($role === 'guru' || $role === 'teacher') && isset($validated['guru_id']) && (string) $validated['guru_id'] !== $guruId) {
            return $this->error($request, 'GRADE_TEACHER_FORBIDDEN', 'Guru hanya dapat mengubah bobot miliknya sendiri.', 403);
        }

        $context = $guard['context'];
        $mapel = trim((string) $validated['mapel']);

        return $this->idempotency->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $tenantId, $guruId, $mapel, $validated, $context): JsonResponse {
                return DB::transaction(function () use ($request, $tenantId, $guruId, $mapel, $validated, $context): JsonResponse {
                    $teacher = DB::table('profiles')
                        ->where('tenant_id', $tenantId)
                        ->where('id', $guruId)
                        ->whereIn('role', ['guru', 'teacher'])
                        ->lockForUpdate()
                        ->first();
                    if (! $teacher) {
                        return $this->error($request, 'GRADE_TEACHER_NOT_FOUND', 'Guru pengampu tidak ditemukan pada tenant ini.', 422);
                    }

                    $existing = DB::table('guru_mapel_bobot')
                        ->where('tenant_id', $tenantId)
                        ->where('guru_id', $guruId)
                        ->where('mapel', $mapel)
                        ->where('tahun_ajaran', $context['tahun_ajaran'])
                        ->where('semester', $context['semester'])
                        ->lockForUpdate()
                        ->first();
                    $before = $existing ? (array) $existing : null;
                    $now = now();
                    $attributes = [
                        'tenant_id' => $tenantId,
                        'guru_id' => $guruId,
                        'mapel' => $mapel,
                        'tahun_ajaran' => $context['tahun_ajaran'],
                        'semester' => $context['semester'],
                        'bobot_tugas_pr' => $validated['bobot_tugas_pr'],
                        'bobot_quiz_reguler' => $validated['bobot_quiz_reguler'],
                        'bobot_quiz_uts' => $validated['bobot_quiz_uts'],
                        'bobot_quiz_uas' => $validated['bobot_quiz_uas'],
                        'sumber_uts' => $validated['sumber_uts'],
                        'sumber_uas' => $validated['sumber_uas'],
                        'jenis_manual' => $validated['jenis_manual'],
                        'label_manual' => $validated['label_manual'] ?? null,
                        'updated_at' => $now,
                    ];

                    if (Schema::hasColumn('guru_mapel_bobot', 'academic_year_id')) {
                        $attributes['academic_year_id'] = $context['academic_year_id'] ?? null;
                    }
                    if (Schema::hasColumn('guru_mapel_bobot', 'academic_term_id')) {
                        $attributes['academic_term_id'] = $context['academic_term_id'] ?? null;
                    }

                    if ($existing) {
                        DB::table('guru_mapel_bobot')->where('id', $existing->id)->update($attributes);
                        $id = (string) $existing->id;
                        $action = 'UPDATE';
                    } else {
                        $id = (string) Str::uuid();
                        DB::table('guru_mapel_bobot')->insert([
                            'id' => $id,
                            ...$attributes,
                            'created_at' => $now,
                        ]);
                        $action = 'INSERT';
                    }

                    $saved = DB::table('guru_mapel_bobot')->where('id', $id)->first();
                    $this->audit($tenantId, $request, $action, $id, $before, (array) $saved, $context);

                    return (new GradeWeightResource($saved))->additional([
                        'success' => true,
                        'message' => 'Bobot penilaian berhasil disimpan.',
                        'academic_context' => $this->publicContext($context),
                        'request_id' => $this->requestId($request),
                    ])->response();
                });
            }
        );
    }

    public function manualScores(ListManualScoresRequest $request): AnonymousResourceCollection|JsonResponse
    {
        $this->authorizeGradeRole($request);
        $tenantId = $this->tenantId($request);
        $context = $this->academicContext->forRead($request, $tenantId);

        if (($error = $this->contextError($request, $context)) !== null) {
            return $error;
        }

        $role = $this->role($request);
        $query = DB::table('guru_mapel_manual_nilai')
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', $context['tahun_ajaran'])
            ->where('semester', $context['semester'])
            ->when($role === 'guru' || $role === 'teacher', fn ($builder) => $builder->where('guru_id', $request->user()->id))
            ->when($request->filled('guru_id') && $role === 'admin', fn ($builder) => $builder->where('guru_id', $request->query('guru_id')))
            ->when($request->filled('siswa_id'), fn ($builder) => $builder->where('siswa_id', $request->query('siswa_id')))
            ->when($request->filled('kelas_id'), fn ($builder) => $builder->where('kelas_id', trim((string) $request->query('kelas_id'))))
            ->when($request->filled('mapel'), fn ($builder) => $builder->where('mapel', trim((string) $request->query('mapel'))))
            ->orderBy('kelas_id')
            ->orderBy('mapel')
            ->orderBy('siswa_id');

        $perPage = min(max((int) $request->query('per_page', 100), 1), 500);

        return ManualScoreResource::collection($query->paginate($perPage)->appends($request->query()))
            ->additional([
                'success' => true,
                'message' => 'Nilai manual berhasil dimuat.',
                'academic_context' => $this->publicContext($context),
                'request_id' => $this->requestId($request),
            ]);
    }

    public function upsertManualScore(UpsertManualScoreRequest $request): JsonResponse
    {
        $this->authorizeGradeRole($request);
        $tenantId = $this->tenantId($request);
        $validated = $request->validated();
        $role = $this->role($request);
        $guruId = $role === 'guru' || $role === 'teacher'
            ? (string) $request->user()->id
            : trim((string) ($validated['guru_id'] ?? ''));

        if ($guruId === '') {
            return $this->error($request, 'GRADE_TEACHER_REQUIRED', 'Guru pengampu wajib dipilih.', 422);
        }
        if (($role === 'guru' || $role === 'teacher') && isset($validated['guru_id']) && (string) $validated['guru_id'] !== $guruId) {
            return $this->error($request, 'GRADE_TEACHER_FORBIDDEN', 'Guru hanya dapat mengubah nilai miliknya sendiri.', 403);
        }

        $existing = DB::table('guru_mapel_manual_nilai')
            ->where('tenant_id', $tenantId)
            ->where('guru_id', $guruId)
            ->where('siswa_id', $validated['siswa_id'])
            ->where('kelas_id', trim((string) $validated['kelas_id']))
            ->where('mapel', trim((string) $validated['mapel']))
            ->where('tahun_ajaran', $validated['tahun_ajaran'])
            ->where('semester', $validated['semester'])
            ->first();
        $action = $existing ? 'update' : 'upsert';
        $guard = $this->academicMutationGuard->authorize(
            $request,
            'guru_mapel_manual_nilai',
            $action,
            $validated,
            [
                'eq' => [
                    'tahun_ajaran' => $validated['tahun_ajaran'],
                    'semester' => $validated['semester'],
                ],
            ],
            $tenantId
        );

        if (($error = $this->mutationError($request, $guard)) !== null) {
            return $error;
        }

        $context = $guard['context'];
        $mapel = trim((string) $validated['mapel']);
        $kelasId = trim((string) $validated['kelas_id']);

        return $this->idempotency->handle(
            $request,
            $validated['idempotency_key'] ?? null,
            function () use ($request, $tenantId, $guruId, $mapel, $kelasId, $validated, $context): JsonResponse {
                return DB::transaction(function () use ($request, $tenantId, $guruId, $mapel, $kelasId, $validated, $context): JsonResponse {
                    $teacher = DB::table('profiles')
                        ->where('tenant_id', $tenantId)
                        ->where('id', $guruId)
                        ->whereIn('role', ['guru', 'teacher'])
                        ->lockForUpdate()
                        ->first();
                    if (! $teacher) {
                        return $this->error($request, 'GRADE_TEACHER_NOT_FOUND', 'Guru pengampu tidak ditemukan pada tenant ini.', 422);
                    }

                    $student = DB::table('profiles')
                        ->where('tenant_id', $tenantId)
                        ->where('id', $validated['siswa_id'])
                        ->whereIn('role', ['siswa', 'student'])
                        ->lockForUpdate()
                        ->first();
                    if (! $student) {
                        return $this->error($request, 'GRADE_STUDENT_NOT_FOUND', 'Siswa tidak ditemukan pada tenant ini.', 422);
                    }

                    $studentClass = $this->historicalEnrollment->resolve(
                        $tenantId,
                        (string) $student->id,
                        $context['tahun_ajaran'] ?? null,
                        $context['semester'] ?? null,
                        $student->kelas ?? null,
                        $context['tahun_ajaran'] ?? null
                    );
                    if ($studentClass !== $kelasId) {
                        return $this->error($request, 'GRADE_STUDENT_CLASS_MISMATCH', 'Siswa tidak terdaftar pada kelas periode ini.', 403);
                    }

                    if ($this->role($request) !== 'admin' && ! DB::table('jadwal')
                        ->where('tenant_id', $tenantId)
                        ->where('guru_id', $guruId)
                        ->where('kelas_id', $kelasId)
                        ->where('mapel', $mapel)
                        ->where('tahun_ajaran', $context['tahun_ajaran'])
                        ->exists()) {
                        return $this->error($request, 'GRADE_TEACHING_ASSIGNMENT_REQUIRED', 'Guru tidak memiliki penugasan mapel pada kelas dan periode ini.', 403);
                    }

                    $existing = DB::table('guru_mapel_manual_nilai')
                        ->where('tenant_id', $tenantId)
                        ->where('guru_id', $guruId)
                        ->where('siswa_id', $student->id)
                        ->where('kelas_id', $kelasId)
                        ->where('mapel', $mapel)
                        ->where('tahun_ajaran', $context['tahun_ajaran'])
                        ->where('semester', $context['semester'])
                        ->lockForUpdate()
                        ->first();
                    $before = $existing ? (array) $existing : null;
                    $now = now();
                    $attributes = [
                        'tenant_id' => $tenantId,
                        'guru_id' => $guruId,
                        'siswa_id' => $student->id,
                        'kelas_id' => $kelasId,
                        'mapel' => $mapel,
                        'tahun_ajaran' => $context['tahun_ajaran'],
                        'semester' => $context['semester'],
                        'nilai_manual' => $validated['nilai_manual'] ?? null,
                        'nilai_uts_manual' => $validated['nilai_uts_manual'] ?? null,
                        'nilai_uas_manual' => $validated['nilai_uas_manual'] ?? null,
                        'catatan' => isset($validated['catatan']) ? trim((string) $validated['catatan']) : null,
                        'updated_at' => $now,
                    ];
                    if (Schema::hasColumn('guru_mapel_manual_nilai', 'academic_year_id')) {
                        $attributes['academic_year_id'] = $context['academic_year_id'] ?? null;
                    }
                    if (Schema::hasColumn('guru_mapel_manual_nilai', 'academic_term_id')) {
                        $attributes['academic_term_id'] = $context['academic_term_id'] ?? null;
                    }

                    if ($existing) {
                        DB::table('guru_mapel_manual_nilai')->where('id', $existing->id)->update($attributes);
                        $id = (string) $existing->id;
                        $action = 'UPDATE';
                    } else {
                        $id = (string) Str::uuid();
                        DB::table('guru_mapel_manual_nilai')->insert([
                            'id' => $id,
                            ...$attributes,
                            'created_at' => $now,
                        ]);
                        $action = 'INSERT';
                    }

                    $saved = DB::table('guru_mapel_manual_nilai')->where('id', $id)->first();
                    $this->audit($tenantId, $request, $action, $id, $before, (array) $saved, $context);

                    return (new ManualScoreResource($saved))->additional([
                        'success' => true,
                        'message' => 'Nilai manual berhasil disimpan.',
                        'academic_context' => $this->publicContext($context),
                        'request_id' => $this->requestId($request),
                    ])->response();
                });
            }
        );
    }

    private function authorizeGradeRole(Request $request): void
    {
        abort_unless(in_array($this->role($request), ['admin', 'guru', 'teacher'], true), 403, 'Akses nilai tidak tersedia untuk role ini.');
    }

    private function tenantId(Request $request): string
    {
        $tenantId = trim((string) $request->attributes->get('tenant_id', ''));
        abort_if($tenantId === '', 403, 'Konteks tenant tidak tersedia.');

        return $tenantId;
    }

    private function role(Request $request): string
    {
        return strtolower(trim((string) ($request->user()?->profile?->role ?? '')));
    }

    private function contextError(Request $request, array $context): ?JsonResponse
    {
        if (($context['tahun_ajaran'] ?? null) && ($context['semester'] ?? null)) {
            return null;
        }

        return $this->error($request, 'GRADE_ACADEMIC_CONTEXT_MISSING', 'Periode akademik belum tersedia.', 409);
    }

    private function mutationError(Request $request, array $guard): ?JsonResponse
    {
        return ($guard['allowed'] ?? false)
            ? null
            : $this->error(
                $request,
                (string) ($guard['code'] ?? 'ACADEMIC_PERIOD_LOCKED'),
                (string) ($guard['message'] ?? 'Periode akademik terkunci.'),
                (int) ($guard['status'] ?? 409)
            );
    }

    private function publicContext(array $context): array
    {
        return [
            'tahun_ajaran' => $context['tahun_ajaran'] ?? null,
            'semester' => $context['semester'] ?? null,
            'mode' => $context['mode'] ?? 'active',
        ];
    }

    private function audit(string $tenantId, Request $request, string $action, string $recordId, ?array $before, array $after, array $context): void
    {
        DB::table('audit_log')->insert([
            'tenant_id' => $tenantId,
            'table_name' => 'guru_mapel_bobot',
            'record_id' => $recordId,
            'action' => $action,
            'old_data' => $before ? json_encode($before) : null,
            'new_data' => json_encode([
                ...$after,
                'academic_context' => $this->publicContext($context),
            ]),
            'user_id' => $request->user()->id,
            'user_role' => $this->role($request),
            'timestamp' => now(),
        ]);
    }

    private function requestId(Request $request): string
    {
        return (string) ($request->attributes->get('request_id')
            ?: $request->header('X-Request-ID', (string) Str::uuid()));
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
