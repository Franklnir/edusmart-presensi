<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Requests\Academic\ApplyAcademicPeriodRequest;
use App\Http\Requests\Admin\CreateCorrectionSessionRequest;
use App\Services\Academic\AcademicPeriodLifecycleService;
use App\Services\Academic\AcademicRolloverService;
use App\Services\Academic\CorrectionSessionService;
use App\Services\Admin\AdminPageCacheService;
use App\Support\AcademicPeriod;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class AcademicPeriodController extends Controller
{
    public function __construct(
        private readonly AcademicPeriodLifecycleService $academicPeriodLifecycle,
        private readonly CorrectionSessionService $academicCorrectionService,
        private readonly AcademicRolloverService $academicRolloverService,
        private readonly AdminPageCacheService $pageCache
    ) {}

    private function getRequestId(Request $request): string
    {
        return $request->header('X-Request-ID', (string) Str::uuid());
    }

    private function isAdmin(Request $request): bool
    {
        $profile = $request->user()?->profile;

        return $profile && in_array($profile->role, ['admin', 'super_admin', 'superadmin'], true);
    }

    private function deny(string $message = 'Akses ditolak', int $status = 403): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $message,
            'request_id' => $this->getRequestId(request()),
        ], max(400, min(503, $status)));
    }

    private function tenantId(Request $request): ?string
    {
        $tenantId = $request->attributes->get('tenant_id');

        return $tenantId ? (string) $tenantId : null;
    }

    public function index(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $data = $this->academicPeriodLifecycle->listForTenant($tenantId);
        $data['active_correction_sessions'] = $this->academicCorrectionService->activeForActor(
            $tenantId,
            (string) ($request->user()?->id ?? '')
        );

        return response()->json([
            'success' => true,
            'message' => 'Periode akademik berhasil dimuat.',
            'data' => $data,
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function preview(ApplyAcademicPeriodRequest $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $preview = $this->academicPeriodLifecycle->impactPreview($tenantId, $request->all());
        if (! ($preview['valid'] ?? false)) {
            $error = $preview['error'] ?? [];

            return response()->json([
                'success' => false,
                'message' => $error['message'] ?? 'Periode akademik belum valid.',
                'code' => $error['code'] ?? 'academic_period_invalid',
                'request_id' => $this->getRequestId($request),
            ], (int) ($error['status'] ?? 422));
        }

        $currentYear = AcademicPeriod::normalizeAcademicYear($preview['current']['tahun_ajaran'] ?? null);
        $targetYear = AcademicPeriod::normalizeAcademicYear($preview['target']['tahun_ajaran'] ?? null);
        if ($currentYear && $targetYear && (int) substr($targetYear, 0, 4) === (int) substr($currentYear, 0, 4) + 1) {
            $preview['rollover'] = $this->academicRolloverService->preview(
                $tenantId, $currentYear, $targetYear
            );
        }

        return response()->json([
            'success' => true,
            'data' => $preview,
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function apply(ApplyAcademicPeriodRequest $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($payload['tahun_ajaran'] ?? null);
        $semester = AcademicPeriod::normalizeSemester($payload['semester_aktif'] ?? null);
        if ($tahunAjaran === null || $semester === null) {
            return $this->deny('Tahun ajaran atau semester belum valid.', 422);
        }

        $ganjilStart = AcademicPeriod::normalizeDate($payload['periode_ganjil_mulai'] ?? null);
        $ganjilEnd = AcademicPeriod::normalizeDate($payload['periode_ganjil_selesai'] ?? null);
        $genapStart = AcademicPeriod::normalizeDate($payload['periode_genap_mulai'] ?? null);
        $genapEnd = AcademicPeriod::normalizeDate($payload['periode_genap_selesai'] ?? null);
        $activeStart = AcademicPeriod::normalizeDate($payload['periode_mulai'] ?? null);
        $activeEnd = AcademicPeriod::normalizeDate($payload['periode_selesai'] ?? null);

        $result = $this->academicPeriodLifecycle->applyPeriod(
            $tenantId,
            $tahunAjaran,
            $semester,
            $ganjilStart, $ganjilEnd,
            $genapStart, $genapEnd,
            $activeStart, $activeEnd,
            $payload
        );

        if (! empty($result['error'])) {
            $err = $result['error'];

            return response()->json([
                'success' => false,
                'message' => $err['message'] ?? 'Gagal menerapkan periode.',
                'code' => $err['code'] ?? 'apply_failed',
                'request_id' => $this->getRequestId($request),
            ], (int) ($err['status'] ?? 422));
        }

        return response()->json([
            'success' => true,
            'message' => 'Periode akademik berhasil diterapkan.',
            'data' => $result,
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function restoreRoster(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $apply = filter_var($request->input('apply', false), FILTER_VALIDATE_BOOLEAN);
        $result = $this->academicPeriodLifecycle->restoreAcademicPeriodRoster($tenantId, $apply);

        return response()->json([
            'success' => true,
            'data' => $result,
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function copyStructure(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validated = Validator::make($request->all(), [
            'source_tahun_ajaran' => ['required', 'string', 'max:32'],
            'target_tahun_ajaran' => ['nullable', 'string', 'max:32'],
            'replace' => ['nullable', 'boolean'],
            'include_organizations' => ['nullable', 'boolean'],
        ])->validate();

        $activePeriod = AcademicPeriod::current();
        $sourceYear = AcademicPeriod::normalizeAcademicYear($validated['source_tahun_ajaran'] ?? null);
        $targetYear = AcademicPeriod::normalizeAcademicYear($validated['target_tahun_ajaran'] ?? null)
            ?: ($activePeriod['tahun_ajaran'] ?? null);

        if (! $sourceYear || ! $targetYear) {
            return $this->deny('Periode sumber atau target tidak valid.', 422);
        }
        if ($sourceYear === $targetYear) {
            return $this->deny('Periode sumber dan target harus berbeda.', 422);
        }

        $targetSemester = (string) ($activePeriod['semester'] ?? AcademicPeriod::current()['semester']);
        $replace = filter_var($validated['replace'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $includeOrganizations = filter_var($validated['include_organizations'] ?? true, FILTER_VALIDATE_BOOLEAN);

        $summary = [
            'struktur_sekolah' => $this->copySchoolStructureRows($tenantId, $sourceYear, $targetYear, $targetSemester, $replace),
            'kelas_struktur' => $this->copyClassStructureRows($tenantId, $sourceYear, $targetYear, $targetSemester, $replace),
            'organisasi' => 0,
            'organisasi_anggota' => 0,
        ];

        if ($includeOrganizations) {
            $orgSummary = $this->copyOrganizationRows($tenantId, $sourceYear, $targetYear, $targetSemester, $replace);
            $summary['organisasi'] = $orgSummary['organisasi'];
            $summary['organisasi_anggota'] = $orgSummary['organisasi_anggota'];
        }

        $this->pageCache->bumpTenantVersions($tenantId, [
            AdminPageCacheService::SCOPE_HOME,
            AdminPageCacheService::SCOPE_STRUCTURE,
            AdminPageCacheService::SCOPE_ORGANIZATIONS,
        ]);

        return response()->json([
            'success' => true,
            'data' => [
                'source_tahun_ajaran' => $sourceYear,
                'target_tahun_ajaran' => $targetYear,
                'replace' => $replace,
                'summary' => $summary,
            ],
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function scheduleDecisionStatus(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $status = $this->buildScheduleDecisionStatus($tenantId, $request->query());

        return response()->json([
            'success' => true,
            'data' => $status,
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function resolveScheduleDecision(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validated = Validator::make($request->all(), [
            'target_tahun_ajaran' => ['nullable', 'string', 'max:32'],
            'source_tahun_ajaran' => ['nullable', 'string', 'max:32'],
            'action' => ['required', 'in:start_empty,use_previous'],
        ])->validate();

        $activePeriod = AcademicPeriod::current();
        $targetYear = AcademicPeriod::normalizeAcademicYear($validated['target_tahun_ajaran'] ?? null)
            ?: ($activePeriod['tahun_ajaran'] ?? null);
        $activeYear = AcademicPeriod::normalizeAcademicYear($activePeriod['tahun_ajaran'] ?? null);
        $targetSemester = AcademicPeriod::normalizeSemester($activePeriod['semester'] ?? null)
            ?: AcademicPeriod::SEMESTER_GANJIL;

        if (! $targetYear || ! $activeYear) {
            return $this->deny('Periode aktif belum valid.', 422);
        }
        if ($targetYear !== $activeYear) {
            return $this->deny('Keputusan jadwal hanya bisa untuk periode aktif.', 422);
        }
        if (! Schema::hasTable('academic_schedule_period_decisions')) {
            return $this->deny('Tabel belum tersedia.', 422);
        }

        DB::table('academic_schedule_period_decisions')->updateOrInsert(
            ['tenant_id' => $tenantId, 'tahun_ajaran' => $targetYear, 'semester' => $targetSemester],
            [
                'action' => $validated['action'],
                'resolved_at' => now(),
                'resolved_by' => (string) ($request->user()?->id ?? ''),
                'updated_at' => now(),
            ]
        );

        return response()->json([
            'success' => true,
            'message' => 'Keputusan jadwal berhasil disimpan.',
            'data' => [
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'action' => $validated['action'],
            ],
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function rolloverExceptions(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($request->query('tahun_ajaran', '')) ?: '';

        $exceptions = [];
        if ($tahunAjaran !== '' && Schema::hasTable('academic_rollover_exceptions')) {
            $exceptions = DB::table('academic_rollover_exceptions')
                ->where('tenant_id', $tenantId)
                ->where('tahun_ajaran', $tahunAjaran)
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values()
                ->all();
        }

        return response()->json([
            'success' => true,
            'data' => $exceptions,
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function replaceRolloverExceptions(Request $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validated = Validator::make($request->all(), [
            'tahun_ajaran' => ['required', 'string', 'max:32'],
            'items' => ['required', 'array'],
        ])->validate();

        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($validated['tahun_ajaran']);

        if (Schema::hasTable('academic_rollover_exceptions')) {
            DB::table('academic_rollover_exceptions')
                ->where('tenant_id', $tenantId)
                ->where('tahun_ajaran', $tahunAjaran)
                ->delete();

            $now = now();
            $rows = collect($validated['items'])->map(fn ($item) => [
                'tenant_id' => $tenantId,
                'tahun_ajaran' => $tahunAjaran,
                'student_id' => $item['student_id'] ?? '',
                'source_kelas' => $item['source_kelas'] ?? '',
                'target_kelas' => $item['target_kelas'] ?? '',
                'reason' => $item['reason'] ?? '',
                'created_at' => $now,
                'updated_at' => $now,
            ])->all();

            if (! empty($rows)) {
                DB::table('academic_rollover_exceptions')->insert($rows);
            }
        }

        return response()->json([
            'success' => true,
            'message' => 'Exception rollover berhasil disimpan.',
            'request_id' => $this->getRequestId($request),
        ]);
    }

    public function createCorrectionSession(CreateCorrectionSessionRequest $request): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validated = $request->validated();

        try {
            $session = $this->academicCorrectionService->create(
                $tenantId,
                (string) ($request->user()?->id ?? ''),
                (string) $validated['academic_term_id'],
                (string) $validated['reason'],
                (array) $validated['allowed_scopes'],
                (int) ($validated['duration_minutes'] ?? 30)
            );
        } catch (\DomainException|\InvalidArgumentException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'request_id' => $this->getRequestId($request),
            ], 422);
        }

        if ($session === null) {
            return response()->json([
                'success' => false,
                'message' => 'Periode arsip tidak ditemukan.',
                'request_id' => $this->getRequestId($request),
            ], 404);
        }

        return response()->json([
            'success' => true,
            'message' => 'Sesi koreksi akademik berhasil dibuat.',
            'data' => $session,
            'request_id' => $this->getRequestId($request),
        ], 201);
    }

    public function closeCorrectionSession(Request $request, string $sessionId): JsonResponse
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $closed = $this->academicCorrectionService->close(
            $tenantId,
            (string) ($request->user()?->id ?? ''),
            $sessionId
        );

        if (! $closed) {
            return response()->json([
                'success' => false,
                'message' => 'Sesi koreksi aktif tidak ditemukan.',
                'request_id' => $this->getRequestId($request),
            ], 404);
        }

        return response()->json([
            'success' => true,
            'message' => 'Sesi koreksi berhasil ditutup.',
            'request_id' => $this->getRequestId($request),
        ]);
    }

    private function buildScheduleDecisionStatus(string $tenantId, array $params = []): array
    {
        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($params['target_tahun_ajaran'] ?? '') ?: '';

        $decision = null;
        if ($tahunAjaran !== '' && Schema::hasTable('academic_schedule_period_decisions')) {
            $semester = AcademicPeriod::normalizeSemester($params['semester'] ?? '');
            $query = DB::table('academic_schedule_period_decisions')
                ->where('tenant_id', $tenantId)
                ->where('tahun_ajaran', $tahunAjaran);
            if ($semester) {
                $query->where('semester', $semester);
            }
            $row = $query->first();
            $decision = $row ? (array) $row : null;
        }

        return [
            'has_decision' => $decision !== null && ! empty($decision),
            'decision' => $decision,
            'tahun_ajaran' => $tahunAjaran,
        ];
    }

    private function copySchoolStructureRows(string $tenantId, string $sourceYear, string $targetYear, string $targetSemester, bool $replace): int
    {
        if (! Schema::hasTable('struktur_sekolah')) {
            return 0;
        }

        $sourceRows = DB::table('struktur_sekolah')
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', $sourceYear)
            ->get();

        if ($sourceRows->isEmpty()) {
            return 0;
        }

        if ($replace) {
            DB::table('struktur_sekolah')
                ->where('tenant_id', $tenantId)
                ->where('tahun_ajaran', $targetYear)
                ->delete();
        }

        $now = now();
        $newRows = $sourceRows->map(fn ($row) => [
            'tenant_id' => $tenantId,
            'tahun_ajaran' => $targetYear,
            'semester' => $targetSemester,
            'jabatan' => $row->jabatan ?? '',
            'guru_id' => $row->guru_id ?? '',
            'guru_nama' => $row->guru_nama ?? '',
            'created_at' => $now,
            'updated_at' => $now,
        ])->all();

        DB::table('struktur_sekolah')->insert($newRows);

        return count($newRows);
    }

    private function copyClassStructureRows(string $tenantId, string $sourceYear, string $targetYear, string $targetSemester, bool $replace): int
    {
        if (! Schema::hasTable('kelas_struktur')) {
            return 0;
        }

        $sourceRows = DB::table('kelas_struktur')
            ->where('tahun_ajaran', $sourceYear)
            ->whereIn('kelas_id', function ($q) use ($tenantId) {
                $q->select('id')->from('kelas')->where('tenant_id', $tenantId);
            })
            ->get();

        if ($sourceRows->isEmpty()) {
            return 0;
        }

        if ($replace) {
            $targetIds = $sourceRows->pluck('kelas_id')->unique()->all();
            DB::table('kelas_struktur')
                ->where('tahun_ajaran', $targetYear)
                ->whereIn('kelas_id', $targetIds)
                ->delete();
        }

        $now = now();
        $newRows = $sourceRows->map(fn ($row) => [
            'kelas_id' => $row->kelas_id,
            'tahun_ajaran' => $targetYear,
            'semester' => $targetSemester,
            'wali_guru_id' => $row->wali_guru_id ?? null,
            'wali_guru_nama' => $row->wali_guru_nama ?? null,
            'ketua_siswa_id' => null,
            'ketua_siswa_nama' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ])->all();

        DB::table('kelas_struktur')->insert($newRows);

        return count($newRows);
    }

    private function copyOrganizationRows(string $tenantId, string $sourceYear, string $targetYear, string $targetSemester, bool $replace): array
    {
        $result = ['organisasi' => 0, 'organisasi_anggota' => 0];

        if (! Schema::hasTable('organisasi')) {
            return $result;
        }

        $sourceOrgs = DB::table('organisasi')
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', $sourceYear)
            ->get();

        if ($sourceOrgs->isEmpty()) {
            return $result;
        }

        if ($replace) {
            DB::table('organisasi')
                ->where('tenant_id', $tenantId)
                ->where('tahun_ajaran', $targetYear)
                ->delete();
        }

        $now = now();
        $orgIdMap = [];
        foreach ($sourceOrgs as $org) {
            $newId = (string) Str::uuid();
            DB::table('organisasi')->insert([
                'id' => $newId,
                'tenant_id' => $tenantId,
                'nama' => $org->nama ?? '',
                'jenis' => $org->jenis ?? '',
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'pembina_id' => $org->pembina_id ?? null,
                'pembina_nama' => $org->pembina_nama ?? null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $orgIdMap[$org->id] = $newId;
            $result['organisasi']++;
        }

        if (Schema::hasTable('organisasi_anggota')) {
            $sourceMembers = DB::table('organisasi_anggota')
                ->whereIn('organisasi_id', array_keys($orgIdMap))
                ->get();

            foreach ($sourceMembers as $member) {
                if (! isset($orgIdMap[$member->organisasi_id])) {
                    continue;
                }
                DB::table('organisasi_anggota')->insert([
                    'organisasi_id' => $orgIdMap[$member->organisasi_id],
                    'siswa_id' => $member->siswa_id ?? '',
                    'nama' => $member->nama ?? '',
                    'jabatan' => $member->jabatan ?? '',
                    'tahun_ajaran' => $targetYear,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $result['organisasi_anggota']++;
            }
        }

        return $result;
    }
}
