<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Academic\ApplyAcademicPeriodRequest;
use App\Http\Requests\Academic\CreateCorrectionSessionRequest;
use App\Jobs\RefreshAdminPageCacheJob;
use App\Mail\SertifikatMail;
use App\Models\Profile;
use App\Models\User;
use App\Services\Academic\AcademicPeriodLifecycleService;
use App\Services\Academic\AcademicRolloverService;
use App\Services\Academic\CorrectionSessionService;
use App\Services\Academic\ExtracurricularPeriodService;
use App\Services\Admin\AdminPageCacheService;
use App\Services\Rfid\RfidDeviceService;
use App\Services\Rfid\RfidIngressService;
use App\Services\Rfid\RfidLiveEventStreamService;
use App\Support\AcademicPeriod;
use App\Support\AcademicScopeRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;

class AdminController extends ApiController
{
    private const SCAN_FEATURE_KEYS = [
        'scan-kehadiran',
        'scan-kehadiran-pengaturan',
        'scan-kehadiran-live',
        'scan-kehadiran-riwayat',
    ];

    private const SCAN_LIVE_FEATURE_KEYS = [
        'scan-kehadiran',
        'scan-kehadiran-live',
    ];

    public function __construct(
        private readonly AcademicPeriodLifecycleService $academicPeriodLifecycle,
        private readonly CorrectionSessionService $academicCorrectionService,
        private readonly AcademicRolloverService $academicRolloverService
    ) {}

    public function rfidDevices(Request $request)
    {
        if (! $this->canAccessScanFeature($request, self::SCAN_LIVE_FEATURE_KEYS)) {
            return $this->deny();
        }

        $tenantId = $this->resolveOwnedTenantId($request) ?? $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        if (! Schema::hasTable('rfid_devices')) {
            return $this->ok([
                'tenant_id' => (string) $tenantId,
                'tenant_slug' => (string) ($request->attributes->get('tenant_slug') ?? ''),
                'summary' => ['total' => 0, 'online' => 0, 'offline' => 0],
                'devices' => [],
            ]);
        }

        $tenantSlug = trim((string) ($request->attributes->get('tenant_slug') ?? ''));
        if ($tenantSlug === '') {
            $tenantSlug = (string) DB::table('tenants')
                ->where('id', $tenantId)
                ->value('slug');
        }

        if ($tenantSlug === '') {
            return $this->deny('Tenant tidak valid', 400);
        }

        $devices = collect(app(RfidDeviceService::class)->listDevices($tenantSlug))
            ->filter(fn ($device) => (string) ($device['tenant_id'] ?? '') === (string) $tenantId)
            ->values();

        $total = $devices->count();
        $online = $devices->where('is_online', true)->count();

        return $this->ok([
            'tenant_id' => (string) $tenantId,
            'tenant_slug' => $tenantSlug,
            'summary' => [
                'total' => $total,
                'online' => $online,
                'offline' => $total - $online,
            ],
            'devices' => $devices->all(),
        ]);
    }

    public function rfidBrowserEvent(Request $request)
    {
        if (! $this->canAccessScanFeature($request, self::SCAN_LIVE_FEATURE_KEYS)) {
            return $this->deny();
        }

        if (! Schema::hasTable('rfid_device_events') || ! Schema::hasTable('rfid_scans')) {
            return $this->deny('Infrastruktur RFID belum siap.', 503);
        }

        $tenantId = $this->resolveOwnedTenantId($request) ?? $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $tenantSlug = trim((string) ($request->attributes->get('tenant_slug') ?? ''));
        if ($tenantSlug === '') {
            $tenantSlug = (string) DB::table('tenants')
                ->where('id', $tenantId)
                ->value('slug');
        }

        if ($tenantSlug === '') {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validated = Validator::make($request->all(), [
            'card_uid' => ['required', 'string', 'max:128'],
            'event_id' => ['nullable', 'string', 'max:191'],
            'mode' => ['nullable', 'string', 'max:32'],
            'scanned_at' => ['nullable', 'date'],
            'browser_device_id' => ['nullable', 'string', 'max:191'],
            'browser' => ['nullable', 'array'],
        ])->validate();

        $profile = $this->profile($request);
        $actorId = (string) ($profile?->id ?? $request->user()?->id ?? '');
        $actorName = trim((string) ($profile?->nama ?? $request->user()?->name ?? ''));
        $actorRole = trim((string) ($profile?->role ?? ''));
        $deviceId = 'WEB_NFC_BROWSER_'.substr(hash('sha256', $tenantId.'|'.$actorId), 0, 16);
        $eventId = trim((string) ($validated['event_id'] ?? ''));
        if ($eventId === '') {
            $eventId = 'web-nfc-'.(string) Str::uuid();
        }

        $payload = array_merge($request->except(['device_id', 'tenant_slug']), [
            'browser_nfc' => true,
            'source' => 'web-nfc',
            'actor_id' => $actorId !== '' ? $actorId : null,
            'actor_name' => $actorName !== '' ? $actorName : null,
            'actor_role' => $actorRole !== '' ? $actorRole : null,
            'tenant_slug' => $tenantSlug,
            'browser_device_id' => $validated['browser_device_id'] ?? null,
            'user_agent' => substr((string) $request->userAgent(), 0, 500),
            'ip' => $request->ip(),
        ]);

        $result = app(RfidIngressService::class)->processScanByTenantSlug(
            tenantSlug: $tenantSlug,
            cardUid: (string) $validated['card_uid'],
            deviceId: $deviceId,
            mode: (string) ($validated['mode'] ?? ''),
            source: 'web-nfc',
            eventId: $eventId,
            scannedAt: (string) ($validated['scanned_at'] ?? ''),
            payload: $payload,
        );

        $data = is_array($result['data'] ?? null) ? $result['data'] : [];
        $data['source'] = $data['source'] ?? 'web-nfc';
        $data['actor'] = [
            'id' => $actorId !== '' ? $actorId : null,
            'name' => $actorName !== '' ? $actorName : null,
            'role' => $actorRole !== '' ? $actorRole : null,
        ];

        return response()->json($data, (int) ($result['status'] ?? 500));
    }

    public function copyAcademicStructure(Request $request)
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

        $settings = $this->firstTenantRow('settings', $tenantId);
        $activePeriod = AcademicPeriod::fromSettings($settings);
        $sourceYear = AcademicPeriod::normalizeAcademicYear($validated['source_tahun_ajaran'] ?? null);
        $targetYear = AcademicPeriod::normalizeAcademicYear($validated['target_tahun_ajaran'] ?? null)
            ?: $activePeriod['tahun_ajaran'];

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
            $organizationSummary = $this->copyOrganizationRows($tenantId, $sourceYear, $targetYear, $targetSemester, $replace);
            $summary['organisasi'] = $organizationSummary['organisasi'];
            $summary['organisasi_anggota'] = $organizationSummary['organisasi_anggota'];
        }

        $this->refreshAdminPageCache(
            $tenantId,
            [
                AdminPageCacheService::SCOPE_HOME,
                AdminPageCacheService::SCOPE_STRUCTURE,
                AdminPageCacheService::SCOPE_ORGANIZATIONS,
            ],
            [$sourceYear, $targetYear]
        );

        return $this->ok([
            'source_tahun_ajaran' => $sourceYear,
            'target_tahun_ajaran' => $targetYear,
            'replace' => $replace,
            'summary' => $summary,
        ]);
    }

    public function schedulePeriodDecisionStatus(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        return $this->ok($this->buildSchedulePeriodDecisionStatus($tenantId, $request->query()));
    }

    public function resolveSchedulePeriodDecision(Request $request)
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

        $settings = $this->firstTenantRow('settings', $tenantId);
        $activePeriod = AcademicPeriod::fromSettings($settings);
        $targetYear = AcademicPeriod::normalizeAcademicYear($validated['target_tahun_ajaran'] ?? null)
            ?: ($activePeriod['tahun_ajaran'] ?? null);
        $activeYear = AcademicPeriod::normalizeAcademicYear($activePeriod['tahun_ajaran'] ?? null);
        $targetSemester = AcademicPeriod::normalizeSemester($activePeriod['semester'] ?? null)
            ?: AcademicPeriod::SEMESTER_GANJIL;

        if (! $targetYear || ! $activeYear) {
            return $this->deny('Periode aktif belum valid.', 422);
        }

        if ($targetYear !== $activeYear) {
            return $this->deny('Keputusan jadwal hanya bisa dilakukan untuk periode aktif sekolah.', 422);
        }

        if (! Schema::hasTable('academic_schedule_period_decisions')) {
            return $this->deny('Tabel keputusan jadwal periode belum tersedia. Jalankan migration terbaru di VPS.', 422);
        }

        $targetScheduleCount = $this->scheduleCountForAcademicYear($tenantId, $targetYear);
        if ($targetScheduleCount > 0) {
            return $this->ok($this->buildSchedulePeriodDecisionStatus($tenantId, [
                'target_tahun_ajaran' => $targetYear,
            ]));
        }

        $action = (string) $validated['action'];
        $sourceYear = AcademicPeriod::normalizeAcademicYear($validated['source_tahun_ajaran'] ?? null)
            ?: $this->previousAcademicYear($targetYear);
        $copied = 0;

        if ($action === 'use_previous') {
            if (! $sourceYear || $sourceYear === $targetYear) {
                return $this->deny('Periode sumber jadwal tidak valid.', 422);
            }

            $sourceScheduleCount = $this->scheduleCountForAcademicYear($tenantId, $sourceYear);
            if ($sourceScheduleCount <= 0) {
                return $this->deny('Jadwal periode sebelumnya belum tersedia untuk disalin.', 422);
            }

            $copied = $this->copyJadwalToNewPeriod($tenantId, $sourceYear, $targetYear, $targetSemester);
        }

        $this->recordSchedulePeriodDecision(
            $tenantId,
            $targetYear,
            $action === 'use_previous' ? $sourceYear : null,
            $action === 'use_previous' ? 'copy_previous' : 'start_empty',
            $copied,
            (string) ($request->user()?->id ?? '')
        );

        $this->refreshAdminPageCache(
            $tenantId,
            [AdminPageCacheService::SCOPE_STRUCTURE],
            array_values(array_filter([$sourceYear, $targetYear]))
        );
        $this->logAudit($request, 'jadwal', $targetYear, 'SCHEDULE_PERIOD_DECISION', null, [
            'target_tahun_ajaran' => $targetYear,
            'source_tahun_ajaran' => $sourceYear,
            'decision' => $action,
            'copied_count' => $copied,
        ], $tenantId);

        $status = $this->buildSchedulePeriodDecisionStatus($tenantId, [
            'target_tahun_ajaran' => $targetYear,
        ]);
        $status['copied_count'] = $copied;

        return $this->ok($status);
    }

    public function academicRolloverExceptions(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        [$sourceYear, $targetYear] = $this->resolveRolloverExceptionYears($request->all());
        if (! $sourceYear || ! $targetYear) {
            return $this->deny('Periode sumber dan target wajib diisi.', 422);
        }

        if (! Schema::hasTable('academic_rollover_exceptions')) {
            return $this->ok([
                'rows' => [],
                'schema_ready' => false,
                'source_tahun_ajaran' => $sourceYear,
                'target_tahun_ajaran' => $targetYear,
            ]);
        }

        $columns = $this->existingColumns('academic_rollover_exceptions', [
            'student_id', 'reason', 'created_at', 'updated_at',
        ]);

        $rows = $this->tenantQuery('academic_rollover_exceptions', $tenantId)
            ->select($columns ?: ['student_id', 'reason'])
            ->where('source_tahun_ajaran', $sourceYear)
            ->where('target_tahun_ajaran', $targetYear)
            ->when(Schema::hasColumn('academic_rollover_exceptions', 'resolved_at'), fn ($query) => $query->whereNull('resolved_at'))
            ->when(Schema::hasColumn('academic_rollover_exceptions', 'created_at'), fn ($query) => $query->orderBy('created_at'))
            ->get()
            ->map(fn ($row) => [
                'student_id' => (string) ($row->student_id ?? ''),
                'reason' => (string) ($row->reason ?? ''),
                'created_at' => $row->created_at ?? null,
                'updated_at' => $row->updated_at ?? null,
            ])
            ->values()
            ->all();

        return $this->ok([
            'rows' => $rows,
            'schema_ready' => true,
            'source_tahun_ajaran' => $sourceYear,
            'target_tahun_ajaran' => $targetYear,
        ]);
    }

    public function replaceAcademicRolloverExceptions(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        if (! Schema::hasTable('academic_rollover_exceptions')) {
            return $this->deny('Tabel pengecualian rollover belum tersedia. Jalankan migration terbaru di VPS.', 422);
        }

        [$sourceYear, $targetYear] = $this->resolveRolloverExceptionYears($request->all());
        if (! $sourceYear || ! $targetYear) {
            return $this->deny('Periode sumber dan target wajib diisi.', 422);
        }

        if ($sourceYear === $targetYear) {
            return $this->deny('Periode target rollover harus berbeda dari periode sumber.', 422);
        }

        $studentIds = collect($request->input('student_ids', []))
            ->map(fn ($studentId) => trim((string) $studentId))
            ->filter()
            ->unique()
            ->values()
            ->all();

        $reason = trim((string) $request->input('reason', 'Tidak naik kelas')) ?: 'Tidak naik kelas';
        $userId = (string) ($request->user()?->id ?? '');

        $validationError = $this->validateRolloverExceptionStudents($tenantId, $studentIds);
        if ($validationError) {
            return $this->deny($validationError, 422);
        }

        DB::transaction(function () use ($tenantId, $sourceYear, $targetYear, $studentIds, $reason, $userId) {
            $deleteQuery = $this->tenantQuery('academic_rollover_exceptions', $tenantId)
                ->where('source_tahun_ajaran', $sourceYear)
                ->where('target_tahun_ajaran', $targetYear);

            if (Schema::hasColumn('academic_rollover_exceptions', 'resolved_at')) {
                $deleteQuery->whereNull('resolved_at');
            }

            $deleteQuery->delete();

            if ($studentIds === []) {
                return;
            }

            $now = now();
            $rows = array_map(function (string $studentId) use ($tenantId, $sourceYear, $targetYear, $reason, $userId, $now) {
                return $this->filterExistingPayload('academic_rollover_exceptions', [
                    'id' => (string) Str::uuid(),
                    'tenant_id' => $tenantId,
                    'student_id' => $studentId,
                    'source_tahun_ajaran' => $sourceYear,
                    'target_tahun_ajaran' => $targetYear,
                    'reason' => $reason,
                    'created_by' => $userId ?: null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }, $studentIds);

            DB::table('academic_rollover_exceptions')->insert(array_values(array_filter($rows)));
        });

        return $this->ok([
            'saved_count' => count($studentIds),
            'rows' => array_map(fn ($studentId) => [
                'student_id' => $studentId,
                'reason' => $reason,
            ], $studentIds),
            'source_tahun_ajaran' => $sourceYear,
            'target_tahun_ajaran' => $targetYear,
        ]);
    }

    public function rfidEventsStream(Request $request)
    {
        if (! $this->canAccessScanFeature($request, self::SCAN_LIVE_FEATURE_KEYS)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        if (! Schema::hasTable('rfid_device_events')) {
            return response()->stream(function () {
                echo "event: error\n";
                echo 'data: '.json_encode(['message' => 'Tabel event RFID belum tersedia'])."\n\n";
            }, 200, $this->eventStreamHeaders());
        }

        $cursor = max(0, (int) $request->query('cursor', 0));
        if ($cursor <= 0) {
            $cursor = (int) DB::table('rfid_device_events')
                ->where('tenant_id', $tenantId)
                ->max('id');
        }

        $liveEvents = app(RfidLiveEventStreamService::class);

        return response()->stream(function () use ($tenantId, $cursor, $liveEvents) {
            $lastId = $cursor;
            $startedAt = microtime(true);
            $lastPingAt = 0.0;
            $lastDatabaseCatchupAt = 0.0;

            echo "event: ready\n";
            echo 'data: '.json_encode(['cursor' => $lastId, 'server_time' => now()->toIso8601String()])."\n\n";
            @ob_flush();
            flush();

            while (! connection_aborted() && (microtime(true) - $startedAt) < 55) {
                $stream = $liveEvents->readAfter($tenantId, $lastId);
                $events = $stream['events'] ?? [];

                foreach ($events as $payload) {
                    $lastId = max($lastId, (int) ($payload['id'] ?? 0));
                    echo "event: scan\n";
                    echo 'id: '.$lastId."\n";
                    echo 'data: '.json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n\n";
                }

                if ($events !== []) {
                    @ob_flush();
                    flush();

                    continue;
                }

                $now = microtime(true);
                $catchupInterval = (int) config('rfid.live_events.database_catchup_seconds', 5);
                if (! ($stream['available'] ?? false) || ($now - $lastDatabaseCatchupAt) >= $catchupInterval) {
                    $lastDatabaseCatchupAt = $now;
                    $rows = $this->latestRfidEventRows($tenantId, $lastId);
                    foreach ($rows as $row) {
                        $lastId = max($lastId, (int) $row->id);
                        echo "event: scan\n";
                        echo 'id: '.$lastId."\n";
                        echo 'data: '.json_encode($liveEvents->formatPayload($row), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n\n";
                    }
                    if ($rows->isNotEmpty()) {
                        @ob_flush();
                        flush();

                        continue;
                    }
                }

                if (($now - $lastPingAt) >= 15) {
                    $lastPingAt = $now;
                    echo "event: ping\n";
                    echo 'data: '.json_encode(['cursor' => $lastId, 'server_time' => now()->toIso8601String()])."\n\n";
                    @ob_flush();
                    flush();
                }

                if (! ($stream['available'] ?? false)) {
                    usleep(250000);
                }
            }
        }, 200, $this->eventStreamHeaders());
    }

    private function copySchoolStructureRows(
        string $tenantId,
        string $sourceYear,
        string $targetYear,
        string $targetSemester,
        bool $replace
    ): int {
        if (! Schema::hasTable('struktur_sekolah')) {
            return 0;
        }

        if ($replace && Schema::hasColumn('struktur_sekolah', 'tahun_ajaran')) {
            $this->tenantQuery('struktur_sekolah', $tenantId)
                ->where('tahun_ajaran', $targetYear)
                ->delete();
        }

        $rows = $this->tenantQuery('struktur_sekolah', $tenantId)
            ->select($this->existingColumns('struktur_sekolah', [
                'id', 'jabatan', 'guru_id', 'guru_nama', 'tahun_ajaran', 'semester',
            ]))
            ->when(Schema::hasColumn('struktur_sekolah', 'tahun_ajaran'), fn ($query) => $query->where('tahun_ajaran', $sourceYear))
            ->orderBy('jabatan')
            ->get();

        $copied = 0;
        foreach ($rows as $row) {
            $jabatan = trim((string) ($row->jabatan ?? ''));
            if ($jabatan === '') {
                continue;
            }

            $existing = $this->tenantQuery('struktur_sekolah', $tenantId)
                ->whereRaw('lower(jabatan) = ?', [Str::lower($jabatan)])
                ->when(Schema::hasColumn('struktur_sekolah', 'tahun_ajaran'), fn ($query) => $query->where('tahun_ajaran', $targetYear))
                ->first(['id']);

            $payload = $this->filterExistingPayload('struktur_sekolah', [
                'id' => $existing->id ?? $this->periodScopedId('struktur', $jabatan, $targetYear),
                'tenant_id' => $tenantId,
                'jabatan' => $jabatan,
                'guru_id' => $row->guru_id ?? null,
                'guru_nama' => $row->guru_nama ?? null,
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'updated_at' => now(),
                'created_at' => now(),
            ]);

            if ($existing) {
                unset($payload['id'], $payload['tenant_id'], $payload['created_at']);
                $this->tenantQuery('struktur_sekolah', $tenantId)
                    ->where('id', $existing->id)
                    ->update($payload);
            } else {
                DB::table('struktur_sekolah')->insert($payload);
            }

            $copied++;
        }

        return $copied;
    }

    private function copyClassStructureRows(
        string $tenantId,
        string $sourceYear,
        string $targetYear,
        string $targetSemester,
        bool $replace
    ): int {
        if (! Schema::hasTable('kelas_struktur')) {
            return 0;
        }

        if ($replace && Schema::hasColumn('kelas_struktur', 'tahun_ajaran')) {
            $this->tenantQuery('kelas_struktur', $tenantId)
                ->where('tahun_ajaran', $targetYear)
                ->delete();
        }

        $rows = $this->tenantQuery('kelas_struktur', $tenantId)
            ->select($this->existingColumns('kelas_struktur', [
                'id', 'kelas_id', 'wali_guru_id', 'wali_guru_nama',
                'ketua_siswa_id', 'ketua_siswa_nama', 'tahun_ajaran', 'semester',
            ]))
            ->when(Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($query) => $query->where('tahun_ajaran', $sourceYear))
            ->orderBy('kelas_id')
            ->get();

        $copied = 0;
        foreach ($rows as $row) {
            $kelasId = trim((string) ($row->kelas_id ?? ''));
            if ($kelasId === '') {
                continue;
            }

            $existing = $this->tenantQuery('kelas_struktur', $tenantId)
                ->where('kelas_id', $kelasId)
                ->when(Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($query) => $query->where('tahun_ajaran', $targetYear))
                ->first($this->existingColumns('kelas_struktur', ['id', 'kelas_id']));

            $payload = $this->filterExistingPayload('kelas_struktur', [
                'id' => $existing->id ?? (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'kelas_id' => $kelasId,
                'wali_guru_id' => $row->wali_guru_id ?? null,
                'wali_guru_nama' => $row->wali_guru_nama ?? null,
                'ketua_siswa_id' => $row->ketua_siswa_id ?? null,
                'ketua_siswa_nama' => $row->ketua_siswa_nama ?? null,
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'updated_at' => now(),
                'created_at' => now(),
            ]);

            if ($existing) {
                unset($payload['id'], $payload['tenant_id'], $payload['kelas_id'], $payload['created_at']);
                $query = $this->tenantQuery('kelas_struktur', $tenantId);
                if (isset($existing->id)) {
                    $query->where('id', $existing->id);
                } else {
                    $query->where('kelas_id', $kelasId);
                }
                $query->update($payload);
            } else {
                DB::table('kelas_struktur')->insert($payload);
            }

            $copied++;
        }

        return $copied;
    }

    private function copyOrganizationRows(
        string $tenantId,
        string $sourceYear,
        string $targetYear,
        string $targetSemester,
        bool $replace
    ): array {
        if (! Schema::hasTable('organisasi')) {
            return ['organisasi' => 0, 'organisasi_anggota' => 0];
        }

        if ($replace && Schema::hasColumn('organisasi', 'tahun_ajaran')) {
            $targetOrgIds = $this->tenantQuery('organisasi', $tenantId)
                ->where('tahun_ajaran', $targetYear)
                ->pluck('id')
                ->filter()
                ->values()
                ->all();

            if (Schema::hasTable('organisasi_anggota') && $targetOrgIds !== []) {
                $this->tenantQuery('organisasi_anggota', $tenantId)
                    ->whereIn('organisasi_id', $targetOrgIds)
                    ->delete();
            }

            $this->tenantQuery('organisasi', $tenantId)
                ->where('tahun_ajaran', $targetYear)
                ->delete();
        }

        $sourceOrganizations = $this->tenantQuery('organisasi', $tenantId)
            ->select($this->existingColumns('organisasi', [
                'id', 'nama', 'visi', 'misi', 'pembina_guru_id', 'pembina_guru_nama',
                'tahun_ajaran', 'semester',
            ]))
            ->when(Schema::hasColumn('organisasi', 'tahun_ajaran'), fn ($query) => $query->where('tahun_ajaran', $sourceYear))
            ->orderBy('nama')
            ->get();

        $orgMap = [];
        $orgCopied = 0;
        foreach ($sourceOrganizations as $row) {
            $sourceId = trim((string) ($row->id ?? ''));
            $name = trim((string) ($row->nama ?? ''));
            if ($sourceId === '' || $name === '') {
                continue;
            }

            $existing = $this->tenantQuery('organisasi', $tenantId)
                ->whereRaw('lower(nama) = ?', [Str::lower($name)])
                ->when(Schema::hasColumn('organisasi', 'tahun_ajaran'), fn ($query) => $query->where('tahun_ajaran', $targetYear))
                ->first(['id']);

            $targetId = (string) ($existing->id ?? $this->periodScopedId('organisasi', $name, $targetYear));
            $payload = $this->filterExistingPayload('organisasi', [
                'id' => $targetId,
                'tenant_id' => $tenantId,
                'nama' => $name,
                'visi' => $row->visi ?? '',
                'misi' => $row->misi ?? '',
                'pembina_guru_id' => $row->pembina_guru_id ?? null,
                'pembina_guru_nama' => $row->pembina_guru_nama ?? null,
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'updated_at' => now(),
                'created_at' => now(),
            ]);

            if ($existing) {
                unset($payload['id'], $payload['tenant_id'], $payload['created_at']);
                $this->tenantQuery('organisasi', $tenantId)
                    ->where('id', $targetId)
                    ->update($payload);
            } else {
                DB::table('organisasi')->insert($payload);
            }

            $orgMap[$sourceId] = $targetId;
            $orgCopied++;
        }

        $membersCopied = $this->copyOrganizationMemberRows($tenantId, $sourceYear, $targetYear, $targetSemester, $orgMap);

        return ['organisasi' => $orgCopied, 'organisasi_anggota' => $membersCopied];
    }

    private function copyOrganizationMemberRows(
        string $tenantId,
        string $sourceYear,
        string $targetYear,
        string $targetSemester,
        array $orgMap
    ): int {
        if (! Schema::hasTable('organisasi_anggota') || $orgMap === []) {
            return 0;
        }

        $activeStudents = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereRaw('lower(coalesce(status, \'active\')) not in (?, ?, ?, ?)', ['alumni', 'nonaktif', 'inactive', 'disabled'])
            ->pluck('kelas', 'id');

        $rows = $this->tenantQuery('organisasi_anggota', $tenantId)
            ->select($this->existingColumns('organisasi_anggota', [
                'organisasi_id', 'siswa_id', 'nama', 'kelas', 'jabatan',
                'status', 'bagian', 'tahun_ajaran', 'semester',
            ]))
            ->whereIn('organisasi_id', array_keys($orgMap))
            ->when(Schema::hasColumn('organisasi_anggota', 'tahun_ajaran'), fn ($query) => $query->where('tahun_ajaran', $sourceYear))
            ->orderBy('organisasi_id')
            ->orderBy('jabatan')
            ->get();

        $copied = 0;
        foreach ($rows as $row) {
            $studentId = trim((string) ($row->siswa_id ?? ''));
            $targetOrgId = $orgMap[(string) ($row->organisasi_id ?? '')] ?? '';
            if ($studentId === '' || $targetOrgId === '' || ! $activeStudents->has($studentId)) {
                continue;
            }

            $existing = $this->tenantQuery('organisasi_anggota', $tenantId)
                ->where('organisasi_id', $targetOrgId)
                ->where('siswa_id', $studentId)
                ->when(Schema::hasColumn('organisasi_anggota', 'tahun_ajaran'), fn ($query) => $query->where('tahun_ajaran', $targetYear))
                ->first(['id']);

            $payload = $this->filterExistingPayload('organisasi_anggota', [
                'tenant_id' => $tenantId,
                'organisasi_id' => $targetOrgId,
                'siswa_id' => $studentId,
                'nama' => $row->nama ?? '',
                'kelas' => $activeStudents->get($studentId) ?: ($row->kelas ?? ''),
                'jabatan' => $row->jabatan ?? 'Anggota',
                'status' => $row->status ?? 'aktif',
                'bagian' => $row->bagian ?? null,
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'updated_at' => now(),
                'created_at' => now(),
            ]);

            if ($existing) {
                unset($payload['tenant_id'], $payload['organisasi_id'], $payload['siswa_id'], $payload['created_at']);
                $this->tenantQuery('organisasi_anggota', $tenantId)
                    ->where('id', $existing->id)
                    ->update($payload);
            } else {
                DB::table('organisasi_anggota')->insert($payload);
            }

            $copied++;
        }

        return $copied;
    }

    private function latestRfidEventRows(string $tenantId, int $cursor)
    {
        return DB::table('rfid_device_events')
            ->where('tenant_id', $tenantId)
            ->where('id', '>', $cursor)
            ->whereNotNull('processed_at')
            ->orderBy('id')
            ->limit(25)
            ->get();
    }

    private function eventStreamHeaders(): array
    {
        return [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-transform',
            'Connection' => 'keep-alive',
            'X-Accel-Buffering' => 'no',
        ];
    }

    private function periodScopedId(string $prefix, string $label, string $tahunAjaran): string
    {
        $slug = Str::slug($label) ?: $prefix;
        $year = preg_replace('/[^0-9]/', '', $tahunAjaran) ?: Str::lower(Str::random(6));

        return Str::limit($prefix.'-'.$slug.'-'.$year, 120, '');
    }

    public function provisionUser(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $createdVia = $this->normalizeProfileCreatedVia($payload['created_via'] ?? $payload['source'] ?? null, 'admin_created');
        if ($createdVia === 'import' && array_key_exists('password', $payload)) {
            $payload['password'] = $this->normalizeProvisionPassword((string) ($payload['password'] ?? ''));
        }

        $validator = Validator::make($payload, [
            'id' => 'nullable|string|max:191',
            'nama' => 'required|string|max:120',
            'email' => 'nullable|email|max:255',
            'password' => ['nullable', 'string', PasswordRule::defaults()],
            'role' => 'required|in:siswa,guru,admin',
            'nis' => 'nullable|string|max:64',
            'kelas' => 'nullable|string|max:120',
            'jk' => 'nullable|string|max:20',
            'usia' => 'nullable|integer|min:0|max:150',
            'telp' => 'nullable|string|max:32',
            'agama' => 'nullable|string|max:50',
            'jabatan' => 'nullable|string|max:100',
            'alamat' => 'nullable|string|max:1000',
            'status' => 'nullable|string|max:32',
            'tanggal_lahir' => 'nullable|date',
            'no_hp_siswa' => 'nullable|string|max:32',
            'no_hp_wali' => 'nullable|string|max:32',
            'must_change_password' => 'nullable|boolean',
            'sync_existing' => 'nullable|boolean',
            'created_via' => 'nullable|string|max:40',
            'source' => 'nullable|string|max:40',
        ]);
        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        $role = strtolower(trim((string) ($payload['role'] ?? '')));
        $nama = trim((string) ($payload['nama'] ?? ''));
        $nis = $this->normalizeIdentifierCode($payload['nis'] ?? '');
        $email = strtolower(trim((string) ($payload['email'] ?? '')));
        $requestedId = trim((string) ($payload['id'] ?? ''));
        $syncExisting = filter_var($payload['sync_existing'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $allowExistingUpdate = $syncExisting || $requestedId !== '';

        if ($email === '') {
            if ($role !== 'siswa') {
                return response()->json(['message' => 'Email wajib diisi untuk akun guru atau admin'], 422);
            }
            if ($nis === '') {
                return response()->json(['message' => 'NIS wajib diisi jika email siswa kosong'], 422);
            }
            $email = $this->buildImportPlaceholderEmail($nis, $tenantId);
        } elseif (Str::endsWith($email, '@import.local')) {
            $seed = $nis !== '' ? $nis : strstr($email, '@', true);
            $email = $this->buildImportPlaceholderEmail((string) $seed, $tenantId);
        }

        $existingProfile = null;
        if ($requestedId !== '') {
            $existingProfile = Profile::query()
                ->where('tenant_id', $tenantId)
                ->where('id', $requestedId)
                ->first();
        }

        if (! $existingProfile && $allowExistingUpdate && $nis !== '') {
            $existingProfile = Profile::query()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(nis) = ?', [strtolower($nis)])
                ->first();
        }

        if (! $existingProfile && $allowExistingUpdate && $email !== '') {
            $existingProfile = Profile::query()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(email) = ?', [$email])
                ->first();
        }

        if ($existingProfile) {
            $existingRole = strtolower(trim((string) ($existingProfile->role ?? '')));
            $existingRole = $existingRole === 'teacher' ? 'guru' : $existingRole;
            if ($existingRole !== $role) {
                return response()->json(['message' => 'Data ditemukan, tapi role akun berbeda'], 409);
            }

            if (
                Profile::query()
                    ->where('tenant_id', $tenantId)
                    ->whereRaw('lower(email) = ?', [$email])
                    ->where('id', '!=', $existingProfile->id)
                    ->exists()
            ) {
                return response()->json(['message' => 'Email sudah terdaftar di sekolah ini'], 409);
            }

            if ($nis !== '' && Profile::query()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(nis) = ?', [strtolower($nis)])
                ->where('id', '!=', $existingProfile->id)
                ->exists()
            ) {
                return response()->json(['message' => 'NIS/NIP sudah terdaftar di sekolah ini'], 409);
            }
        } else {
            $existingUser = Profile::query()
                ->where('tenant_id', $tenantId)
                ->whereRaw('lower(email) = ?', [$email])
                ->first();
            if ($existingUser) {
                return response()->json(['message' => 'Email sudah terdaftar di sekolah ini'], 409);
            }

            if ($nis !== '') {
                $existingNis = Profile::query()
                    ->where('tenant_id', $tenantId)
                    ->whereRaw('lower(nis) = ?', [strtolower($nis)])
                    ->first();
                if ($existingNis) {
                    return response()->json(['message' => 'NIS/NIP sudah terdaftar di sekolah ini'], 409);
                }
            }

            if (trim((string) ($payload['password'] ?? '')) === '') {
                return response()->json(['message' => 'Password wajib diisi'], 422);
            }
        }

        $userId = $existingProfile ? (string) $existingProfile->id : (string) Str::uuid();
        $statusInput = array_key_exists('status', $payload)
            ? trim((string) ($payload['status'] ?? ''))
            : trim((string) ($existingProfile->status ?? 'active'));
        $status = $statusInput !== '' ? $statusInput : 'active';
        $angkatan = $this->resolveCohortForClass($tenantId, $payload['kelas'] ?? null);
        $now = now();
        $password = trim((string) ($payload['password'] ?? ''));
        $actorId = (string) ($request->user()?->id ?? '');
        $isUpdate = (bool) $existingProfile;
        $oldData = $existingProfile ? (array) $existingProfile->getAttributes() : null;
        $syncedSnapshots = [];

        $user = null;
        $profile = null;

        DB::transaction(function () use (
            $payload,
            $tenantId,
            $userId,
            $nama,
            $email,
            $role,
            $nis,
            $status,
            $angkatan,
            $now,
            $password,
            $actorId,
            $createdVia,
            $existingProfile,
            $isUpdate,
            &$user,
            &$profile,
            &$syncedSnapshots
        ) {
            $profilePayload = [
                'email' => $email,
                'nama' => $nama,
                'role' => $role,
                'status' => $status,
                'updated_at' => $now,
            ];

            if (! $isUpdate || $nis !== '') {
                $profilePayload['nis'] = $nis !== '' ? $nis : null;
            }

            foreach (['kelas', 'jk', 'telp', 'agama', 'jabatan', 'alamat', 'tanggal_lahir', 'no_hp_siswa', 'no_hp_wali'] as $key) {
                if (! $isUpdate || array_key_exists($key, $payload)) {
                    $profilePayload[$key] = $this->nullableString($payload[$key] ?? null);
                }
            }

            if (array_key_exists('tanggal_lahir', $profilePayload)) {
                $profilePayload['usia'] = $profilePayload['tanggal_lahir']
                    ? $this->calculateAgeFromBirthDate((string) $profilePayload['tanggal_lahir'])
                    : null;
            } elseif (! $isUpdate || array_key_exists('usia', $payload)) {
                $rawUsia = $payload['usia'] ?? null;
                $profilePayload['usia'] = $rawUsia === null || $rawUsia === ''
                    ? null
                    : (int) $rawUsia;
            }

            if (Schema::hasColumn('profiles', 'angkatan') && (! $isUpdate || array_key_exists('kelas', $payload))) {
                $profilePayload['angkatan'] = $angkatan;
            }

            if (Schema::hasColumn('profiles', 'created_via') && (! $isUpdate || trim((string) ($existingProfile?->created_via ?? '')) === '')) {
                $profilePayload['created_via'] = $createdVia;
            }
            if (Schema::hasColumn('profiles', 'created_by') && $actorId !== '' && (! $isUpdate || trim((string) ($existingProfile?->created_by ?? '')) === '')) {
                $profilePayload['created_by'] = $actorId;
            }

            if ($isUpdate) {
                Profile::query()
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->update($profilePayload);

                $user = User::query()->where('id', $userId)->first();
                if ($user) {
                    $user->forceFill([
                        'name' => $nama,
                        'email' => $email,
                    ])->save();
                } else {
                    $user = User::query()->create([
                        'id' => $userId,
                        'name' => $nama,
                        'email' => $email,
                        'password' => $password !== '' ? $password : $this->temporaryStrongPassword(),
                    ]);
                }

                $profile = Profile::query()
                    ->where('id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->first();

                if (in_array($role, ['siswa', 'guru'], true) && array_key_exists('tanggal_lahir', $profilePayload)) {
                    $this->syncImportedInitialProfilePassword($tenantId, $userId, $now);
                }
            } else {
                $user = User::query()->create([
                    'id' => $userId,
                    'name' => $nama,
                    'email' => $email,
                    'password' => $password,
                ]);

                $profilePayload['id'] = $userId;
                $profilePayload['tenant_id'] = $tenantId;
                $profilePayload['must_change_password'] = (bool) ($payload['must_change_password'] ?? false);
                $profilePayload['created_at'] = $now;

                $profile = Profile::query()->create($profilePayload);
            }

            if ($isUpdate) {
                if ($role === 'guru') {
                    $syncedSnapshots = $this->syncTeacherDisplayNameSnapshots($tenantId, $userId, $nama, $now);
                } elseif ($role === 'siswa') {
                    $syncedSnapshots = $this->syncStudentDisplayNameSnapshots($tenantId, $userId, $nama, $now);
                }
            }
        });

        $newData = [
            'id' => $userId,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $nama,
            'role' => $role,
            'nis' => $nis !== '' ? $nis : null,
            'status' => $status,
            'angkatan' => $angkatan,
            'must_change_password' => (bool) ($profile?->must_change_password ?? ($payload['must_change_password'] ?? false)),
            'created_via' => $profile?->created_via ?? null,
            'created_by' => $profile?->created_by ?? null,
        ];
        if ($isUpdate) {
            $newData['synced_snapshots'] = $syncedSnapshots;
        }

        $this->logAudit($request, 'profiles', $userId, $isUpdate ? 'UPDATE' : 'INSERT', $oldData, $newData, $tenantId);

        $this->refreshAdminPageCache($tenantId);

        return response()->json([
            'data' => [
                'user' => $user,
                'profile' => $profile,
                'status' => $isUpdate ? 'updated' : 'created',
            ],
        ], $isUpdate ? 200 : 201);
    }

    public function monitoring(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $activeSeconds = (int) $request->query('active_sec', 120);
        if ($activeSeconds < 30) {
            $activeSeconds = 30;
        }
        if ($activeSeconds > 900) {
            $activeSeconds = 900;
        }

        $activeCutoff = now()->subSeconds($activeSeconds)->toDateTimeString();
        $presenceAgg = $this->presenceAggregateQuery($tenantId, $activeCutoff);

        $rows = DB::table('profiles as p')
            ->leftJoinSub($presenceAgg, 'pr', 'p.id', '=', 'pr.user_id')
            ->where('p.tenant_id', $tenantId)
            ->whereIn('p.role', ['siswa', 'guru'])
            ->select(
                'p.id',
                'p.nama',
                'p.email',
                'p.nis',
                'p.role',
                'p.kelas',
                'pr.last_seen_at',
                'pr.active_devices',
                'pr.activity_count'
            )
            ->get();

        $students = [];
        $teachers = [];

        foreach ($rows as $row) {
            $activeDevices = (int) ($row->active_devices ?? 0);
            $item = [
                'id' => $row->id,
                'nama' => $row->nama,
                'email' => $row->email,
                'nis' => $row->nis,
                'kelas' => $row->kelas,
                'role' => $row->role,
                'online' => $activeDevices > 0,
                'last_seen_at' => $row->last_seen_at,
                'active_devices' => $activeDevices,
                'activity_count' => (int) ($row->activity_count ?? 0),
            ];

            if ($row->role === 'siswa') {
                $students[] = $item;
            } else {
                $teachers[] = $item;
            }
        }

        $sortWithActivity = function ($a, $b) {
            if ($a['online'] !== $b['online']) {
                return $a['online'] ? -1 : 1;
            }
            if ($a['online']) {
                if ($a['activity_count'] !== $b['activity_count']) {
                    return $b['activity_count'] <=> $a['activity_count'];
                }
            }
            $aSeen = $a['last_seen_at'] ?? '';
            $bSeen = $b['last_seen_at'] ?? '';

            return strcmp($bSeen, $aSeen);
        };

        $sortByLastSeen = function ($a, $b) {
            if ($a['online'] !== $b['online']) {
                return $a['online'] ? -1 : 1;
            }
            $aSeen = $a['last_seen_at'] ?? '';
            $bSeen = $b['last_seen_at'] ?? '';

            return strcmp($bSeen, $aSeen);
        };

        usort($students, $sortWithActivity);
        usort($teachers, $sortByLastSeen);

        return response()->json([
            'data' => [
                'students' => $students,
                'teachers' => $teachers,
                'active_seconds' => $activeSeconds,
                'generated_at' => now()->toISOString(),
            ],
        ]);
    }

    public function dashboardSummary(Request $request, AdminPageCacheService $pageCache)
    {
        set_time_limit(120);
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $pageCache->dashboardSummary($tenantId, [
            'tahun_ajaran' => $this->queryText($request, 'tahun_ajaran'),
        ]);

        return response()->json(['data' => $payload]);
    }

    public function homeBootstrap(Request $request, AdminPageCacheService $pageCache)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        return response()->json([
            'data' => $pageCache->homeBootstrap($tenantId, [
                'tahun_ajaran' => $this->queryText($request, 'tahun_ajaran'),
            ]),
        ]);
    }

    public function teacherOptions(Request $request, AdminPageCacheService $pageCache)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        return response()->json([
            'data' => $pageCache->teacherOptions($tenantId, [
                'scope' => $this->queryText($request, 'scope'),
            ]),
        ]);
    }

    public function organisasiBootstrap(Request $request, AdminPageCacheService $pageCache)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        return response()->json([
            'data' => $pageCache->organizationBootstrap($tenantId, [
                'tahun_ajaran' => $this->queryText($request, 'tahun_ajaran'),
            ]),
        ]);
    }

    public function strukturBootstrap(Request $request, AdminPageCacheService $pageCache)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        return response()->json([
            'data' => $pageCache->structureBootstrap($tenantId, [
                'tahun_ajaran' => $this->queryText($request, 'tahun_ajaran'),
            ]),
        ]);
    }

    public function students(Request $request)
    {
        if (! $this->isAdmin($request) && ! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $isAdmin = $this->isAdmin($request);
        $teacherClassIds = null;
        if (! $isAdmin) {
            $teacherClassIds = $this->teacherClassIds($tenantId, (string) ($request->user()?->id ?? ''));
            if (empty($teacherClassIds)) {
                return response()->json([
                    'data' => [
                        'rows' => [],
                        'meta' => $this->paginationMeta(1, $this->perPage($request), 0),
                        'stats' => $this->emptyStudentStats(),
                        'kelas' => [],
                        'struktur' => [],
                        'wali_kelas_ids' => [],
                    ],
                ]);
            }
        }

        $page = max(1, (int) $request->query('page', 1));
        $allRows = filter_var($request->query('all', false), FILTER_VALIDATE_BOOLEAN);
        $perPage = $allRows ? min(5000, max(1, (int) $request->query('per_page', 5000))) : $this->perPage($request);
        $includeContext = filter_var($request->query('include_context', true), FILTER_VALIDATE_BOOLEAN);
        $includeStats = filter_var($request->query('include_stats', true), FILTER_VALIDATE_BOOLEAN);

        $presenceAgg = $this->presenceAggregateQuery($tenantId);
        $query = $this->studentBaseQuery($tenantId, $teacherClassIds)
            ->leftJoinSub($presenceAgg, 'pr', 'profiles.id', '=', 'pr.user_id');
        $this->applyStudentFilters($query, $request);

        $total = (clone $query)->count('profiles.id');
        $studentColumns = $this->prefixedExistingColumns('profiles', [
            'id', 'email', 'nama', 'role', 'kelas', 'jk', 'usia', 'telp', 'photo_url',
            'created_at', 'nis', 'agama', 'jabatan', 'alamat', 'status',
            'alasan_nonaktif', 'disabled_at', 'tanggal_lahir', 'updated_at',
            'rfid_uid', 'kelas_change_used', 'no_hp_siswa', 'no_hp_wali',
            'deleted_at', 'photo_path', 'photo_updated_at', 'angkatan',
            'created_via', 'created_by',
        ]);
        $rows = $query
            ->select($studentColumns)
            ->selectRaw('pr.last_seen_at as last_seen_at')
            ->selectRaw('coalesce(pr.active_devices, 0) as active_devices')
            ->selectRaw('coalesce(pr.activity_count, 0) as activity_count')
            ->selectRaw('case when coalesce(pr.active_devices, 0) > 0 then 1 else 0 end as online')
            ->orderBy('profiles.kelas')
            ->orderBy('profiles.nama')
            ->orderBy('profiles.nis')
            ->orderBy('profiles.id')
            ->when(! $allRows, fn ($builder) => $builder->offset(($page - 1) * $perPage)->limit($perPage))
            ->when($allRows, fn ($builder) => $builder->limit($perPage))
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        $payload = [
            'rows' => $rows,
            'meta' => $this->paginationMeta($page, $perPage, $total, $allRows),
        ];

        if ($includeStats) {
            $payload['stats'] = $this->studentStats($tenantId, $teacherClassIds);
        }

        if ($includeContext) {
            $activeYear = $this->activeAcademicYearForTenant($tenantId);
            $payload['kelas'] = $this->tenantQuery('kelas', $tenantId)
                ->select($this->existingColumns('kelas', ['id', 'nama', 'tingkat', 'jurusan', 'wali_kelas', 'angkatan', 'created_at', 'updated_at']))
                ->when($teacherClassIds !== null, fn ($builder) => $builder->whereIn('id', $teacherClassIds))
                ->orderBy('id')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $payload['struktur'] = $this->tenantQuery('kelas_struktur', $tenantId)
                ->select($this->existingColumns('kelas_struktur', ['kelas_id', 'wali_guru_id', 'wali_guru_nama', 'ketua_siswa_id', 'ketua_siswa_nama', 'created_at', 'updated_at']))
                ->when($teacherClassIds !== null, fn ($builder) => $builder->whereIn('kelas_id', $teacherClassIds))
                ->when($activeYear !== '' && Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $activeYear))
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();

            $payload['wali_kelas_ids'] = $teacherClassIds ?? [];
        }

        return response()->json(['data' => $payload]);
    }

    public function studentDetail(Request $request, string $id)
    {
        if (! $this->isAdmin($request) && ! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $query = $this->studentBaseQuery($tenantId);
        if (! $this->isAdmin($request)) {
            $teacherClassIds = $this->teacherClassIds($tenantId, (string) ($request->user()?->id ?? ''));
            if (empty($teacherClassIds)) {
                return $this->deny('Siswa tidak ditemukan', 404);
            }
            $query->whereIn('kelas', $teacherClassIds);
        }

        $profile = $query
            ->where('id', $id)
            ->select($this->existingColumns('profiles', [
                'id', 'email', 'nama', 'role', 'kelas', 'jk', 'usia', 'telp', 'photo_url',
                'created_at', 'nis', 'agama', 'jabatan', 'alamat', 'status',
                'alasan_nonaktif', 'disabled_at', 'tanggal_lahir', 'updated_at',
                'rfid_uid', 'kelas_change_used', 'no_hp_siswa', 'no_hp_wali',
                'deleted_at', 'photo_path', 'photo_updated_at', 'angkatan',
                'created_via', 'created_by',
            ]))
            ->first();

        if (! $profile) {
            return $this->deny('Siswa tidak ditemukan', 404);
        }

        return response()->json([
            'data' => [
                'profile' => (array) $profile,
                'class_history' => $this->studentClassHistoriesForStudents($tenantId, [$id])[$id] ?? [],
                'org_member' => $this->studentOrganizationMemberships($tenantId, $id),
                'osis' => $this->studentOsisMembership($tenantId, $id),
            ],
        ]);
    }

    public function importStudents(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $rows = $request->input('rows', []);
        if (! is_array($rows) || ! array_is_list($rows)) {
            return response()->json(['message' => 'rows harus berupa array'], 422);
        }

        $maxRows = max(100, min(5000, (int) env('STUDENT_IMPORT_MAX_ROWS', 2000)));
        if (count($rows) > $maxRows) {
            return response()->json(['message' => "Import maksimal {$maxRows} baris per batch"], 422);
        }

        $source = strtolower(trim((string) $request->input('source', 'file')));
        $source = in_array($source, ['file', 'sheet'], true) ? $source : 'file';
        $clientErrors = $request->input('errors', []);
        $clientErrors = is_array($clientErrors) ? $clientErrors : [];
        $now = now();
        $summary = [
            'created' => 0,
            'updated' => 0,
            'skipped' => 0,
            'failed' => 0,
            'errors' => [],
        ];
        $historyItems = [];

        foreach ($clientErrors as $error) {
            if (! is_array($error)) {
                continue;
            }

            $this->addStudentImportFailure(
                $summary,
                $historyItems,
                (int) ($error['row'] ?? 0),
                trim((string) ($error['reason'] ?? 'Validasi gagal')) ?: 'Validasi gagal',
                [
                    'kelas' => $error['className'] ?? null,
                ],
                $now
            );
        }

        $preparedRows = [];
        $seenNis = [];
        $seenEmail = [];
        foreach (array_values($rows) as $index => $row) {
            $rowNumber = is_array($row) ? (int) ($row['__rowNum'] ?? $row['row'] ?? ($index + 2)) : ($index + 2);
            if (! is_array($row)) {
                $this->addStudentImportFailure($summary, $historyItems, $rowNumber, 'Format baris tidak valid', null, $now);

                continue;
            }

            $normalized = $this->normalizeStudentImportPayloadRow($tenantId, $row, $rowNumber);
            if (($normalized['error'] ?? '') !== '') {
                $this->addStudentImportFailure($summary, $historyItems, $rowNumber, $normalized['error'], $row, $now);

                continue;
            }

            $data = $normalized['data'];
            $nisKey = strtolower((string) ($data['nis'] ?? ''));
            $emailKey = strtolower((string) ($data['email'] ?? ''));
            if ($nisKey !== '' && isset($seenNis[$nisKey])) {
                $this->addStudentImportFailure($summary, $historyItems, $rowNumber, 'NIS duplikat di file import', $row, $now);

                continue;
            }
            if ($emailKey !== '' && isset($seenEmail[$emailKey])) {
                $this->addStudentImportFailure($summary, $historyItems, $rowNumber, 'Email duplikat di file import', $row, $now);

                continue;
            }

            if ($nisKey !== '') {
                $seenNis[$nisKey] = true;
            }
            if ($emailKey !== '') {
                $seenEmail[$emailKey] = true;
            }
            $preparedRows[] = $data;
        }

        $existingProfiles = $this->loadStudentImportExistingProfiles(
            $tenantId,
            array_values(array_filter(array_map(fn ($row) => $row['nis'] ?? '', $preparedRows))),
            array_values(array_filter(array_map(fn ($row) => $row['email'] ?? '', $preparedRows)))
        );
        $existingUsersByEmail = $this->loadStudentImportExistingUsers(
            array_values(array_filter(array_map(fn ($row) => $row['email'] ?? '', $preparedRows)))
        );

        foreach (array_chunk($preparedRows, 100) as $chunk) {
            foreach ($chunk as $row) {
                try {
                    $result = DB::transaction(fn () => $this->upsertStudentImportRow(
                        $request,
                        $tenantId,
                        $row,
                        $existingProfiles['by_nis'],
                        $existingProfiles['by_email'],
                        $existingUsersByEmail,
                        $now
                    ));

                    $status = $result['status'] ?? 'skipped';
                    if ($status === 'created') {
                        $summary['created'] += 1;
                    } elseif ($status === 'updated') {
                        $summary['updated'] += 1;
                    } else {
                        $summary['skipped'] += 1;
                    }

                    $historyItems[] = [
                        'profile_id' => $result['profile_id'] ?? null,
                        'status' => $status,
                        'created_user' => $status === 'created',
                        'nis' => $row['nis'] ?: null,
                        'nama' => $row['nama'] ?: null,
                        'kelas' => $row['kelas_label'] ?: $row['kelas'],
                        'error_message' => null,
                        'imported_at' => $now,
                    ];
                } catch (\Throwable $e) {
                    $this->addStudentImportFailure($summary, $historyItems, (int) ($row['row'] ?? 0), $e->getMessage(), $row, $now);
                }
            }
        }

        $historyId = $this->storeStudentImportHistory(
            $tenantId,
            (string) ($request->user()?->id ?? ''),
            $source,
            $request->input('file_name'),
            $request->input('sheet_url'),
            count($rows) + count($clientErrors),
            $summary,
            $historyItems,
            $now
        );

        Cache::forget("tenant:{$tenantId}:admin-dashboard-summary:v2");
        Cache::forget($this->dashboardSummaryCacheKey(
            $tenantId,
            AcademicPeriod::normalizeAcademicYear($this->firstTenantRow('settings', $tenantId)?->tahun_ajaran ?? null) ?: ''
        ));
        $this->refreshAdminPageCache(
            $tenantId,
            [
                AdminPageCacheService::SCOPE_HOME,
                AdminPageCacheService::SCOPE_STRUCTURE,
                AdminPageCacheService::SCOPE_ORGANIZATIONS,
            ],
            [
                AcademicPeriod::normalizeAcademicYear($this->firstTenantRow('settings', $tenantId)?->tahun_ajaran ?? null) ?: '',
            ]
        );
        $this->logAudit($request, 'profiles', $historyId ?: 'student-import', 'IMPORT', null, [
            'summary' => $summary,
            'history_id' => $historyId,
        ], $tenantId);

        return response()->json([
            'data' => [
                'summary' => array_merge($summary, ['historyId' => $historyId]),
                'history_id' => $historyId,
            ],
        ]);
    }

    public function academicSummary(Request $request, AdminPageCacheService $pageCache)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $includeStudents = filter_var($request->query('include_students', true), FILTER_VALIDATE_BOOLEAN);
        $includeSchedule = filter_var($request->query('include_schedule', false), FILTER_VALIDATE_BOOLEAN);
        $includeMapel = filter_var($request->query('include_mapel', false), FILTER_VALIDATE_BOOLEAN);
        $requestedClassId = $this->queryText($request, 'class_id');
        $studentStatus = strtolower($this->queryText($request, 'student_status'));
        $tahunAjaran = $this->queryText($request, 'tahun_ajaran');

        $settings = $this->firstTenantRow('settings', $tenantId);
        if ($tahunAjaran === '') {
            $tahunAjaran = AcademicPeriod::normalizeAcademicYear($settings?->tahun_ajaran ?? null) ?: '';
        } else {
            $tahunAjaran = AcademicPeriod::normalizeAcademicYear($tahunAjaran) ?: $tahunAjaran;
        }

        if (
            ! $includeStudents
            && ! $includeSchedule
            && ! $includeMapel
            && $requestedClassId === ''
            && $studentStatus === ''
        ) {
            return response()->json([
                'data' => $pageCache->structureBootstrap($tenantId, [
                    'tahun_ajaran' => $tahunAjaran,
                ]),
            ]);
        }

        $classes = $this->classesForAcademicYear($tenantId, $tahunAjaran);

        $selectedClassId = $requestedClassId;
        if ($selectedClassId === '' || ! $classes->contains(fn ($row) => (string) ($row['id'] ?? '') === $selectedClassId)) {
            $selectedClassId = (string) ($classes->first()['id'] ?? '');
        }

        $teacherRows = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['guru', 'teacher'])
            ->select($this->existingColumns('profiles', ['id', 'nama', 'email', 'role', 'jabatan', 'status', 'updated_at', 'created_via', 'created_by']))
            ->orderBy('nama')
            ->limit(1000)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        $classIds = $classes
            ->pluck('id')
            ->filter(fn ($id) => trim((string) $id) !== '')
            ->map(fn ($id) => (string) $id)
            ->values()
            ->all();

        $classStructureRows = collect();
        if (Schema::hasTable('kelas_struktur')) {
            $classStructureRows = $this->tenantQuery('kelas_struktur', $tenantId)
                ->select($this->existingColumns('kelas_struktur', [
                    'id', 'kelas_id', 'wali_guru_id', 'wali_guru_nama',
                    'ketua_siswa_id', 'ketua_siswa_nama', 'created_at', 'updated_at',
                    'tahun_ajaran', 'semester',
                ]))
                ->when($tahunAjaran !== '' && Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $tahunAjaran))
                ->when(! empty($classIds), fn ($builder) => $builder->whereIn('kelas_id', $classIds))
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();
        }

        $selectedStructure = $selectedClassId !== ''
            ? $classStructureRows->first(fn ($row) => (string) ($row['kelas_id'] ?? '') === $selectedClassId)
            : null;

        $schoolStructureRows = Schema::hasTable('struktur_sekolah')
            ? $this->tenantQuery('struktur_sekolah', $tenantId)
                ->select($this->existingColumns('struktur_sekolah', [
                    'id', 'jabatan', 'guru_id', 'guru_nama', 'created_at', 'updated_at',
                    'tahun_ajaran', 'semester',
                ]))
                ->when($tahunAjaran !== '' && Schema::hasColumn('struktur_sekolah', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $tahunAjaran))
                ->orderBy('jabatan')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values()
            : collect();

        $students = collect();
        if ($includeStudents && $selectedClassId !== '') {
            $studentLimit = max(1, min(1000, (int) $request->query('students_limit', 250)));
            $students = $this->studentsForAcademicYearClass(
                $tenantId,
                $selectedClassId,
                $tahunAjaran,
                $studentStatus,
                $studentLimit
            );

            $historiesByStudent = $this->studentClassHistoriesForStudents(
                $tenantId,
                $students->pluck('id')->filter()->map(fn ($id) => (string) $id)->all()
            );
            $students = $students
                ->map(function (array $row) use ($historiesByStudent) {
                    $studentId = (string) ($row['id'] ?? '');
                    $row['class_history'] = $historiesByStudent[$studentId] ?? [];

                    return $row;
                })
                ->values();
        }

        $schedule = collect();
        if ($includeSchedule && $selectedClassId !== '' && Schema::hasTable('jadwal')) {
            $scheduleQuery = $this->tenantQuery('jadwal', $tenantId)
                ->select($this->existingColumns('jadwal', [
                    'id', 'kelas_id', 'hari', 'mapel', 'guru_id', 'guru_nama',
                    'jam_mulai', 'jam_selesai', 'tahun_ajaran', 'semester', 'periode_berlaku',
                    'created_at', 'updated_at',
                ]))
                ->where('kelas_id', $selectedClassId);

            if ($tahunAjaran !== '' && Schema::hasColumn('jadwal', 'tahun_ajaran')) {
                $scheduleQuery->where('tahun_ajaran', $tahunAjaran);
            }
            $schedule = $scheduleQuery
                ->orderBy('hari')
                ->orderBy('jam_mulai')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();
        }

        $mapel = collect();
        if ($includeMapel && Schema::hasTable('mata_pelajaran')) {
            $mapel = $this->tenantQuery('mata_pelajaran', $tenantId)
                ->select($this->existingColumns('mata_pelajaran', ['id', 'nama', 'created_at', 'updated_at']))
                ->orderBy('nama')
                ->limit(1000)
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values();
        }

        return response()->json([
            'data' => [
                'settings' => $settings ? (array) $settings : null,
                'guru' => $teacherRows,
                'kelas' => $classes,
                'struktur' => $classStructureRows,
                'kelas_struktur' => $classStructureRows,
                'struktur_sekolah' => $schoolStructureRows,
                'selected_class_id' => $selectedClassId,
                'selected_structure' => $selectedStructure ? (array) $selectedStructure : null,
                'selected_students' => $students,
                'schedule' => $schedule,
                'mapel' => $mapel,
                'statistics' => [
                    'teachers' => $teacherRows->count(),
                    'classes' => $classes->count(),
                    'selected_students' => $students->count(),
                    'schedule_rows' => $schedule->count(),
                    'mapel' => $mapel->count(),
                ],
                'generated_at' => now()->toISOString(),
            ],
        ]);
    }

    public function academicPeriods(Request $request)
    {
        if ($this->isAdmin($request) === false) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '') {
            return $this->deny('Tenant tidak valid', 400);
        }

        $data = $this->academicPeriodLifecycle->listForTenant($tenantId);
        $data['active_correction_sessions'] = $this->academicCorrectionService->activeForActor(
            $tenantId,
            (string) ($request->user()?->id ?? '')
        );
        $data['correction_scopes'] = [
            'academic_year' => AcademicScopeRegistry::tablesFor(AcademicScopeRegistry::YEAR),
            'academic_term' => AcademicScopeRegistry::tablesFor(AcademicScopeRegistry::TERM),
        ];

        return response()->json(['data' => $data]);
    }

    public function previewAcademicPeriod(ApplyAcademicPeriodRequest $request)
    {
        if ($this->isAdmin($request) === false) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '') {
            return $this->deny('Tenant tidak valid', 400);
        }

        $preview = $this->academicPeriodLifecycle->impactPreview($tenantId, $request->all());
        if (! ($preview['valid'] ?? false)) {
            $error = $preview['error'] ?? [];

            return response()->json([
                'message' => $error['message'] ?? 'Periode akademik belum valid.',
                'code' => $error['code'] ?? 'academic_period_invalid',
            ], (int) ($error['status'] ?? 422));
        }

        $currentYear = AcademicPeriod::normalizeAcademicYear($preview['current']['tahun_ajaran'] ?? null);
        $targetYear = AcademicPeriod::normalizeAcademicYear($preview['target']['tahun_ajaran'] ?? null);
        if ($currentYear && $targetYear && (int) substr($targetYear, 0, 4) === (int) substr($currentYear, 0, 4) + 1) {
            $preview['rollover'] = $this->previewAcademicYearRollover(
                $tenantId,
                $currentYear,
                $targetYear
            );
        }

        return response()->json(['data' => $preview]);
    }

    public function createAcademicCorrectionSession(CreateCorrectionSessionRequest $request)
    {
        if ($this->isAdmin($request) === false) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '') {
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
            return $this->deny($e->getMessage(), 422);
        }

        if ($session === null) {
            return $this->deny('Periode arsip tidak ditemukan.', 404);
        }

        $this->logAudit(
            $request,
            'academic_correction_sessions',
            (string) $session['id'],
            'CREATE',
            null,
            $session,
            $tenantId
        );

        return response()->json(['data' => $session], 201);
    }

    public function closeAcademicCorrectionSession(Request $request, string $sessionId)
    {
        if ($this->isAdmin($request) === false) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '') {
            return $this->deny('Tenant tidak valid', 400);
        }

        $closed = $this->academicCorrectionService->close(
            $tenantId,
            (string) ($request->user()?->id ?? ''),
            $sessionId
        );
        if (! $closed) {
            return $this->deny('Sesi koreksi aktif tidak ditemukan.', 404);
        }

        $this->logAudit(
            $request,
            'academic_correction_sessions',
            $sessionId,
            'CLOSE',
            null,
            ['status' => 'closed'],
            $tenantId
        );

        return response()->json(['data' => ['id' => $sessionId, 'status' => 'closed']]);
    }

    public function applyAcademicPeriod(ApplyAcademicPeriodRequest $request)
    {
        if ($this->isAdmin($request) === false) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if ($tenantId === null || $tenantId === '') {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($payload['tahun_ajaran'] ?? null);
        $semester = AcademicPeriod::normalizeSemester($payload['semester_aktif'] ?? null);
        $jadwalPeriodeBerlaku = 'tahunan';
        if ($tahunAjaran === null || $semester === null) {
            return $this->deny('Tahun ajaran atau semester belum valid.', 422);
        }

        $ganjilStart = AcademicPeriod::normalizeDate($payload['periode_ganjil_mulai'] ?? null);
        $ganjilEnd = AcademicPeriod::normalizeDate($payload['periode_ganjil_selesai'] ?? null);
        $genapStart = AcademicPeriod::normalizeDate($payload['periode_genap_mulai'] ?? null);
        $genapEnd = AcademicPeriod::normalizeDate($payload['periode_genap_selesai'] ?? null);
        $activeStart = AcademicPeriod::normalizeDate($payload['periode_mulai'] ?? null);
        $activeEnd = AcademicPeriod::normalizeDate($payload['periode_selesai'] ?? null);

        $activeFallbackPeriod = AcademicPeriod::make($tahunAjaran, $semester, $activeStart, $activeEnd);
        $activeFallbackIsSemesterRange = ! empty($activeFallbackPeriod['custom_range'])
            && count($activeFallbackPeriod['months'] ?? []) <= 6;

        if ($semester === AcademicPeriod::SEMESTER_GANJIL && $activeFallbackIsSemesterRange) {
            $ganjilStart = $ganjilStart ?: $activeStart;
            $ganjilEnd = $ganjilEnd ?: $activeEnd;
        } elseif ($semester === AcademicPeriod::SEMESTER_GENAP && $activeFallbackIsSemesterRange) {
            $genapStart = $genapStart ?: $activeStart;
            $genapEnd = $genapEnd ?: $activeEnd;
        }

        $ganjilPeriod = AcademicPeriod::make(
            $tahunAjaran,
            AcademicPeriod::SEMESTER_GANJIL,
            $ganjilStart,
            $ganjilEnd
        );
        $genapPeriod = AcademicPeriod::make(
            $tahunAjaran,
            AcademicPeriod::SEMESTER_GENAP,
            $genapStart,
            $genapEnd
        );
        if (($ganjilStart !== null || $ganjilEnd !== null) && empty($ganjilPeriod['custom_range'])) {
            return $this->deny('Rentang bulan semester Ganjil belum valid.', 422);
        }
        if (($genapStart !== null || $genapEnd !== null) && empty($genapPeriod['custom_range'])) {
            return $this->deny('Rentang bulan semester Genap belum valid.', 422);
        }

        $activePeriod = $semester === AcademicPeriod::SEMESTER_GENAP ? $genapPeriod : $ganjilPeriod;
        $academicYearPeriod = [
            'tahun_ajaran' => $tahunAjaran,
            'semester' => $semester,
            'starts_at' => $ganjilPeriod['starts_at'],
            'ends_at' => $genapPeriod['ends_at'],
            'periode_mulai' => $ganjilPeriod['starts_at'],
            'periode_selesai' => $genapPeriod['ends_at'],
            'range_label' => ($ganjilPeriod['starts_at'] && $genapPeriod['ends_at'])
                ? ($ganjilPeriod['range_label'] ?? '').' - '.($genapPeriod['range_label'] ?? '')
                : null,
        ];
        $settingsPayload = [
            'tahun_ajaran' => $tahunAjaran,
            'semester_aktif' => $semester,
            'periode_mulai' => $academicYearPeriod['starts_at'],
            'periode_selesai' => $academicYearPeriod['ends_at'],
            'periode_ganjil_mulai' => $ganjilPeriod['starts_at'],
            'periode_ganjil_selesai' => $ganjilPeriod['ends_at'],
            'periode_genap_mulai' => $genapPeriod['starts_at'],
            'periode_genap_selesai' => $genapPeriod['ends_at'],
            'jadwal_periode_berlaku' => $jadwalPeriodeBerlaku,
        ];

        $lifecycleValidation = $this->academicPeriodLifecycle->validateActivation($tenantId, $settingsPayload);
        if ($lifecycleValidation !== null) {
            return response()->json([
                'message' => $lifecycleValidation['message'],
                'code' => $lifecycleValidation['code'],
            ], (int) $lifecycleValidation['status']);
        }

        $impactPreview = $this->academicPeriodLifecycle->impactPreview($tenantId, $settingsPayload);
        $impactConfirmed = filter_var(
            $payload['impact_confirmed'] ?? $payload['calendar_confirmed'] ?? false,
            FILTER_VALIDATE_BOOLEAN
        );
        if (
            ($impactPreview['valid'] ?? false)
            && ($impactPreview['changes']['dates'] ?? false)
            && $impactConfirmed === false
        ) {
            return response()->json([
                'message' => 'Pratinjau dampak wajib dikonfirmasi sebelum tanggal periode diubah.',
                'code' => 'academic_period_impact_confirmation_required',
                'data' => $impactPreview,
            ], 409);
        }

        $existing = $this->firstTenantRow('settings', $tenantId);
        $previousYear = AcademicPeriod::normalizeAcademicYear($existing->tahun_ajaran ?? null)
            ?: AcademicPeriod::current()['tahun_ajaran'];
        $previousSemester = AcademicPeriod::normalizeSemester($existing->semester_aktif ?? null)
            ?: AcademicPeriod::current()['semester'];
        $yearChanged = $previousYear !== $tahunAjaran;
        $autoRollover = filter_var($payload['auto_rollover'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $carryEskulMembers = filter_var($payload['carry_eskul_members'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $previousStartYear = (int) substr($previousYear, 0, 4);
        $targetStartYear = (int) substr($tahunAjaran, 0, 4);
        $semesterOnlyChange = $yearChanged === false && $previousSemester !== $semester;
        $serverNow = Carbon::now('Asia/Jakarta');
        $calendarPeriod = AcademicPeriod::current($serverNow);
        $calendarStartYear = (int) substr((string) $calendarPeriod['tahun_ajaran'], 0, 4);
        $calendarConfirmed = filter_var($payload['calendar_confirmed'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $isCalendarCorrection = $yearChanged
            && $previousStartYear > $calendarStartYear
            && $targetStartYear === $calendarStartYear;
        $targetHasClassSnapshot = $yearChanged && $this->hasStudentClassSnapshotsForPeriod($tenantId, $activePeriod);
        $restoreFromClassSnapshot = $yearChanged && $targetHasClassSnapshot;
        $movingBackward = $yearChanged && $targetStartYear < $previousStartYear;
        $movingForwardOneYear = $yearChanged && $targetStartYear === $previousStartYear + 1;
        $requiresRollover = $yearChanged
            && $restoreFromClassSnapshot === false
            && $isCalendarCorrection === false
            && $movingForwardOneYear;
        $rolloverPreview = $requiresRollover
            ? $this->previewAcademicYearRollover($tenantId, $previousYear, $tahunAjaran)
            : null;
        $targetMatchesServerCalendar = $tahunAjaran === $calendarPeriod['tahun_ajaran']
            && $semester === $calendarPeriod['semester'];

        if ($movingBackward && $restoreFromClassSnapshot === false && $isCalendarCorrection === false) {
            return $this->deny(
                'Snapshot kelas siswa untuk periode '.$tahunAjaran.' belum tersedia. Periode tidak diturunkan agar data siswa tidak rusak.',
                422
            );
        }

        if ($targetStartYear > $calendarStartYear + 1 && $restoreFromClassSnapshot === false) {
            return $this->deny('Periode aktif tidak boleh melompat lebih dari satu tahun ajaran dari kalender server.', 422);
        }

        if (($isCalendarCorrection || $targetMatchesServerCalendar === false) && $calendarConfirmed === false) {
            return $this->academicPeriodConfirmationRequired(
                $isCalendarCorrection
                    ? 'Periode aktif tersimpan berada di masa depan. Konfirmasi untuk mengoreksi kalender aktif; data siswa akan dipulihkan dari snapshot periode jika tersedia.'
                    : 'Periode yang dipilih tidak sama dengan kalender server saat ini. Konfirmasi ulang sebelum dipakai sebagai periode operasional.',
                $calendarPeriod,
                $serverNow,
                [
                    'tahun_ajaran' => $previousYear,
                    'semester' => $previousSemester,
                ],
                [
                    'tahun_ajaran' => $tahunAjaran,
                    'semester' => $semester,
                ]
            );
        }

        if (
            $yearChanged
            && $restoreFromClassSnapshot === false
            && $movingForwardOneYear === false
            && $isCalendarCorrection === false
        ) {
            return $this->deny('Rollover akademik hanya bisa maju tepat satu tahun ajaran.', 422);
        }

        if ($requiresRollover && $autoRollover === false) {
            return $this->deny('Perubahan tahun ajaran harus dijalankan melalui rollover otomatis dari Pengaturan Akademik.', 409);
        }

        $actorId = (string) ($request->user()?->id ?? '');
        $lifecycleBefore = $this->academicPeriodLifecycle->currentContext($tenantId);

        try {
            $result = DB::transaction(function () use (
                $tenantId,
                $existing,
                $settingsPayload,
                $activePeriod,
                $academicYearPeriod,
                $previousYear,
                $previousSemester,
                $yearChanged,
                $semesterOnlyChange,
                $requiresRollover,
                $restoreFromClassSnapshot,
                $isCalendarCorrection,
                $calendarPeriod,
                $serverNow,
                $carryEskulMembers,
                $actorId,
                $lifecycleBefore,
                $rolloverPreview
            ) {
                $rollover = null;
                $classesSynced = 0;
                $classHistorySnapshots = 0;
                $previousClassHistorySnapshots = 0;
                $studentProfileRestores = 0;
                $studentProfilesOutsidePeriod = 0;
                $eskulCatalogCopied = 0;
                $rolloverRunId = null;

                $this->academicRolloverService->lockTenant($tenantId);

                if ($yearChanged) {
                    $previousClassHistorySnapshots = $this->snapshotStudentClassHistoriesForPeriod(
                        $tenantId,
                        [
                            'tahun_ajaran' => $previousYear,
                            'semester' => $previousSemester,
                        ],
                        'before_period_change'
                    );
                }

                $settings = $this->saveAcademicPeriodSettings($tenantId, $existing, $settingsPayload);
                $lifecycle = $this->academicPeriodLifecycle->activate(
                    $tenantId,
                    $settingsPayload,
                    $actorId,
                    $settings
                );

                if ($semesterOnlyChange) {
                    $catalogCopy = app(ExtracurricularPeriodService::class)->copyCatalog(
                        $tenantId,
                        $previousYear,
                        $previousSemester,
                        $activePeriod
                    );
                    $eskulCatalogCopied = (int) ($catalogCopy['copied_count'] ?? 0);
                }

                if ($restoreFromClassSnapshot) {
                    $classesSynced = $this->syncClassPeriodMetadata($tenantId, $activePeriod);
                    $restoreResult = $this->restoreStudentProfilesFromPeriodSnapshot($tenantId, $activePeriod);
                    $studentProfileRestores = (int) ($restoreResult['restored'] ?? 0);
                    $studentProfilesOutsidePeriod = (int) ($restoreResult['outside_period'] ?? 0);
                } elseif ($requiresRollover) {
                    $execution = $this->academicRolloverService->execute(
                        $tenantId,
                        $lifecycleBefore['academic_year_id'] ?? null,
                        $lifecycle['academic_year_id'] ?? null,
                        $previousYear,
                        (string) $activePeriod['tahun_ajaran'],
                        $actorId,
                        fn () => $this->rolloverAcademicYearData(
                            $tenantId,
                            $activePeriod,
                            $previousYear,
                            $previousSemester,
                            $carryEskulMembers
                        )
                    );
                    $rolloverRunId = $execution['run_id'] ?? null;
                    $rollover = $execution['result'] ?? [];
                    $this->assertRolloverMatchesPreview($rolloverPreview, $rollover);
                    $classesSynced = (int) ($rollover['classes_synced'] ?? 0);
                } elseif ($yearChanged || $isCalendarCorrection) {
                    $classesSynced = $this->syncClassPeriodMetadata($tenantId, $activePeriod);
                }

                if ($classesSynced > 0 || $requiresRollover || $restoreFromClassSnapshot || $yearChanged) {
                    $classHistorySnapshots = $this->snapshotStudentClassHistoriesForPeriod(
                        $tenantId,
                        $activePeriod,
                        $restoreFromClassSnapshot
                            ? 'period_snapshot_restore'
                            : ($requiresRollover ? 'auto_rollover' : 'period_sync')
                    );
                }

                return [
                    'settings' => $settings ? (array) $settings : null,
                    'lifecycle' => $lifecycle,
                    'period' => [
                        'tahun_ajaran' => $academicYearPeriod['tahun_ajaran'],
                        'semester' => $academicYearPeriod['semester'],
                        'starts_at' => $academicYearPeriod['starts_at'],
                        'ends_at' => $academicYearPeriod['ends_at'],
                        'scope' => 'academic_year',
                    ],
                    'year_changed' => $yearChanged,
                    'semester_only_change' => $semesterOnlyChange,
                    'calendar_correction' => $isCalendarCorrection,
                    'period_snapshot_restored' => $restoreFromClassSnapshot,
                    'student_profile_restores' => $studentProfileRestores,
                    'student_profiles_outside_period' => $studentProfilesOutsidePeriod,
                    'previous_class_history_snapshots' => $previousClassHistorySnapshots,
                    'class_history_snapshots' => $classHistorySnapshots,
                    'server_calendar' => [
                        'today' => $serverNow->toDateString(),
                        'timezone' => 'Asia/Jakarta',
                        'tahun_ajaran' => $calendarPeriod['tahun_ajaran'],
                        'semester' => $calendarPeriod['semester'],
                    ],
                    'classes_synced' => $classesSynced,
                    'eskul_catalog_copied' => $rollover
                        ? (int) ($rollover['eskul_catalog_copied'] ?? 0)
                        : $eskulCatalogCopied,
                    'rollover' => $rollover,
                    'rollover_preview' => $rolloverPreview,
                    'rollover_run_id' => $rolloverRunId,
                ];
            });
        } catch (\DomainException $e) {
            $error = json_decode($e->getMessage(), true);
            if (is_array($error)) {
                return response()->json([
                    'message' => $error['message'] ?? 'Periode akademik ditolak.',
                    'code' => $error['code'] ?? 'academic_period_invalid',
                ], (int) ($error['status'] ?? 409));
            }

            return $this->deny($e->getMessage(), 409);
        } catch (\RuntimeException $e) {
            return $this->deny($e->getMessage(), 422);
        }

        $this->refreshAdminPageCache(
            $tenantId,
            [
                AdminPageCacheService::SCOPE_HOME,
                AdminPageCacheService::SCOPE_STRUCTURE,
                AdminPageCacheService::SCOPE_ORGANIZATIONS,
                AdminPageCacheService::SCOPE_TEACHER_OPTIONS,
            ],
            [
                $previousYear,
                (string) ($result['period']['tahun_ajaran'] ?? $tahunAjaran),
            ]
        );

        return response()->json(['data' => $result]);
    }

    public function restoreAcademicPeriodRoster(Request $request)
    {
        if ($this->isAdmin($request) === false) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if ($tenantId === null || $tenantId === '') {
            return $this->deny('Tenant tidak valid', 400);
        }

        $settings = $this->firstTenantRow('settings', $tenantId);
        if (! $settings) {
            return $this->deny('Pengaturan akademik belum tersedia.', 422);
        }

        $period = AcademicPeriod::fromSettings($settings);
        if (! $this->hasStudentClassSnapshotsForPeriod($tenantId, $period)) {
            return $this->deny(
                'Snapshot roster siswa untuk periode '.$period['tahun_ajaran'].' belum tersedia. Tidak ada data aman untuk dipulihkan.',
                422
            );
        }

        $apply = filter_var($request->input('apply', false), FILTER_VALIDATE_BOOLEAN);
        $preview = $this->previewStudentProfilesFromPeriodSnapshot($tenantId, $period);

        if ($apply === false) {
            return response()->json([
                'data' => [
                    'dry_run' => true,
                    'period' => [
                        'tahun_ajaran' => $period['tahun_ajaran'],
                        'semester' => $period['semester'],
                    ],
                    'preview' => $preview,
                ],
            ]);
        }

        $result = DB::transaction(function () use ($request, $tenantId, $period, $preview) {
            $beforeSnapshots = $this->snapshotStudentClassHistoriesForPeriod(
                $tenantId,
                $period,
                'before_roster_repair'
            );
            $classesSynced = $this->syncClassPeriodMetadata($tenantId, $period);
            $restoreResult = $this->restoreStudentProfilesFromPeriodSnapshot($tenantId, $period);
            $afterSnapshots = $this->snapshotStudentClassHistoriesForPeriod(
                $tenantId,
                $period,
                'period_snapshot_restore'
            );

            $payload = [
                'period' => [
                    'tahun_ajaran' => $period['tahun_ajaran'],
                    'semester' => $period['semester'],
                ],
                'preview' => $preview,
                'period_snapshot_restored' => true,
                'student_profile_restores' => (int) ($restoreResult['restored'] ?? 0),
                'student_profiles_outside_period' => (int) ($restoreResult['outside_period'] ?? 0),
                'before_class_history_snapshots' => $beforeSnapshots,
                'class_history_snapshots' => $afterSnapshots,
                'classes_synced' => $classesSynced,
            ];

            $this->logAudit(
                $request,
                'student_class_histories',
                (string) ($period['tahun_ajaran'] ?? 'active-period'),
                'UPDATE',
                ['preview' => $preview],
                $payload,
                $tenantId
            );

            return $payload;
        });

        $this->refreshAdminPageCache(
            $tenantId,
            [
                AdminPageCacheService::SCOPE_HOME,
                AdminPageCacheService::SCOPE_STRUCTURE,
                AdminPageCacheService::SCOPE_ORGANIZATIONS,
            ],
            [(string) ($period['tahun_ajaran'] ?? '')]
        );

        return response()->json(['data' => $result]);
    }

    private function academicPeriodConfirmationRequired(
        string $message,
        array $serverPeriod,
        Carbon $serverNow,
        array $previousPeriod,
        array $targetPeriod
    ) {
        return response()->json([
            'message' => $message,
            'code' => 'academic_period_calendar_confirmation_required',
            'data' => [
                'server_calendar' => [
                    'today' => $serverNow->toDateString(),
                    'timezone' => 'Asia/Jakarta',
                    'tahun_ajaran' => $serverPeriod['tahun_ajaran'] ?? null,
                    'semester' => $serverPeriod['semester'] ?? null,
                    'label' => ($serverPeriod['tahun_ajaran'] ?? '-').' - Semester '.($serverPeriod['semester'] ?? '-'),
                ],
                'previous_period' => $previousPeriod,
                'target_period' => $targetPeriod,
            ],
        ], 409);
    }

    public function studentOptions(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $allRows = filter_var($request->query('all', false), FILTER_VALIDATE_BOOLEAN);
        $perPage = $allRows
            ? max(1, min(10000, (int) $request->query('per_page', 10000)))
            : max(1, min(100, (int) $request->query('per_page', 50)));
        $search = strtolower($this->queryText($request, 'q'));
        $kelas = $this->queryText($request, 'kelas');
        $status = strtolower($this->queryText($request, 'status') ?: 'active');
        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($this->queryText($request, 'tahun_ajaran')) ?: '';

        $historyHasPeriodRows = $tahunAjaran !== '' && $this->hasStudentClassHistoryForYear($tenantId, $tahunAjaran);
        if ($historyHasPeriodRows) {
            $rows = $this->studentOptionRowsFromClassHistory(
                $tenantId,
                $tahunAjaran,
                $kelas,
                $status,
                $search,
                $perPage + 1
            );

            $hasMore = $rows->count() > $perPage;

            return response()->json([
                'data' => [
                    'rows' => $rows->take($perPage)->values(),
                    'meta' => [
                        'per_page' => $perPage,
                        'has_more' => $hasMore,
                        'all' => $allRows,
                    ],
                ],
            ]);
        }

        $query = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa');

        if ($status !== '') {
            $query->whereRaw('lower(coalesce(status, \'active\')) = ?', [$status]);
        } else {
            $query->whereRaw('lower(coalesce(status, \'active\')) <> ?', ['alumni']);
        }
        if ($kelas !== '') {
            $query->where('kelas', $kelas);
        }
        if ($search !== '') {
            $like = '%'.$search.'%';
            $query->where(function ($builder) use ($like) {
                $builder->whereRaw('lower(coalesce(nama, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(email, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(nis, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(kelas, \'\')) like ?', [$like]);
            });
        }

        $rows = $query
            ->select($this->existingColumns('profiles', ['id', 'nama', 'email', 'kelas', 'nis', 'status', 'angkatan', 'created_via', 'created_by']))
            ->orderBy('kelas')
            ->orderBy('nama')
            ->orderBy('nis')
            ->orderBy('id')
            ->limit($perPage + 1)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        $hasMore = $rows->count() > $perPage;

        return response()->json([
            'data' => [
                'rows' => $rows->take($perPage)->values(),
                'meta' => [
                    'per_page' => $perPage,
                    'has_more' => $hasMore,
                    'all' => $allRows,
                ],
            ],
        ]);
    }

    public function teachers(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $page = max(1, (int) $request->query('page', 1));
        $allRows = filter_var($request->query('all', false), FILTER_VALIDATE_BOOLEAN);
        $perPage = $allRows ? min(10000, max(1, (int) $request->query('per_page', 10000))) : $this->perPage($request);

        $presenceAgg = $this->presenceAggregateQuery($tenantId);
        $teacherColumns = $this->prefixedExistingColumns('profiles', [
            'id', 'email', 'nama', 'role', 'kelas', 'jk', 'usia', 'telp', 'photo_url',
            'created_at', 'nis', 'agama', 'jabatan', 'alamat', 'status',
            'alasan_nonaktif', 'disabled_at', 'tanggal_lahir', 'updated_at',
            'photo_path', 'photo_updated_at', 'created_via', 'created_by',
        ]);
        $baseTeachers = DB::table('profiles')
            ->leftJoinSub($presenceAgg, 'pr', 'profiles.id', '=', 'pr.user_id')
            ->where('profiles.tenant_id', $tenantId)
            ->where('profiles.role', 'guru')
            ->select($teacherColumns)
            ->selectRaw('pr.last_seen_at as last_seen_at')
            ->selectRaw('coalesce(pr.active_devices, 0) as active_devices')
            ->selectRaw('coalesce(pr.activity_count, 0) as activity_count')
            ->selectRaw('case when coalesce(pr.active_devices, 0) > 0 then 1 else 0 end as online')
            ->orderByRaw('case when coalesce(pr.active_devices, 0) > 0 then 0 else 1 end')
            ->orderByRaw('case when pr.last_seen_at is null then 1 else 0 end')
            ->orderByDesc('pr.last_seen_at')
            ->orderBy('profiles.nama')
            ->get()
            ->map(fn ($row) => (array) $row);

        $teacherIds = $baseTeachers->pluck('id')->filter()->values()->all();
        $activeYear = $this->activeAcademicYearForTenant($tenantId);
        $jadwalRows = empty($teacherIds)
            ? collect()
            : $this->tenantQuery('jadwal', $tenantId)
                ->select($this->existingColumns('jadwal', ['id', 'kelas_id', 'hari', 'mapel', 'guru_id', 'guru_nama', 'jam_mulai', 'jam_selesai', 'created_at', 'updated_at']))
                ->whereIn('guru_id', $teacherIds)
                ->when($activeYear !== '' && Schema::hasColumn('jadwal', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $activeYear))
                ->get();
        $waliRows = empty($teacherIds)
            ? collect()
            : $this->tenantQuery('kelas_struktur', $tenantId)
                ->select($this->existingColumns('kelas_struktur', ['kelas_id', 'wali_guru_id', 'wali_guru_nama']))
                ->whereIn('wali_guru_id', $teacherIds)
                ->when($activeYear !== '' && Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $activeYear))
                ->get();
        $strukturRows = empty($teacherIds)
            ? collect()
            : $this->tenantQuery('struktur_sekolah', $tenantId)
                ->select($this->existingColumns('struktur_sekolah', ['id', 'jabatan', 'guru_id', 'guru_nama']))
                ->whereIn('guru_id', $teacherIds)
                ->when($activeYear !== '' && Schema::hasColumn('struktur_sekolah', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $activeYear))
                ->get();

        $jadwalByTeacher = $jadwalRows->groupBy('guru_id');
        $waliByTeacher = $waliRows->groupBy('wali_guru_id');
        $strukturByTeacher = $strukturRows->groupBy('guru_id');
        $allMapel = [];
        $allJabatan = [];

        $teachers = $baseTeachers->map(function (array $teacher) use ($jadwalByTeacher, $waliByTeacher, $strukturByTeacher, &$allMapel, &$allJabatan) {
            $teacherId = (string) ($teacher['id'] ?? '');
            $mapel = $jadwalByTeacher->get($teacherId, collect())
                ->pluck('mapel')
                ->filter()
                ->unique()
                ->values()
                ->all();
            $kelas = $jadwalByTeacher->get($teacherId, collect())
                ->pluck('kelas_id')
                ->merge($waliByTeacher->get($teacherId, collect())->pluck('kelas_id'))
                ->filter()
                ->unique()
                ->values()
                ->all();
            $jabatan = [];
            if (! empty($teacher['jabatan'])) {
                $jabatan[] = (string) $teacher['jabatan'];
            }
            $jabatan = collect($jabatan)
                ->merge($strukturByTeacher->get($teacherId, collect())->pluck('jabatan'))
                ->filter()
                ->unique()
                ->values()
                ->all();

            $allMapel = array_merge($allMapel, $mapel);
            $allJabatan = array_merge($allJabatan, $jabatan);

            $teacher['mapelList'] = $mapel;
            $teacher['kelasList'] = $kelas;
            $teacher['jabatanList'] = $jabatan;
            $teacher['jabatanUtama'] = $jabatan[0] ?? ($teacher['jabatan'] ?? '-');

            return $teacher;
        })->values();

        $filtered = $this->sortRowsByPresence($this->filterTeacherRows($teachers, $request))->values();
        $total = $filtered->count();
        $rows = $allRows
            ? $filtered->take($perPage)->values()
            : $filtered->slice(($page - 1) * $perPage, $perPage)->values();

        $statusCounts = $teachers->groupBy(fn ($row) => strtolower(trim((string) ($row['status'] ?? 'active'))) ?: 'active')
            ->map(fn ($items) => $items->count());

        return response()->json([
            'data' => [
                'rows' => $rows,
                'meta' => $this->paginationMeta($page, $perPage, $total, $allRows),
                'stats' => [
                    'totalGuru' => $teachers->count(),
                    'aktifGuru' => (int) ($statusCounts['active'] ?? 0),
                    'nonaktifGuru' => (int) ($statusCounts['nonaktif'] ?? 0),
                    'mutasiGuru' => (int) ($statusCounts['mutasi'] ?? 0),
                    'inactiveGuru' => max(0, $teachers->count() - (int) ($statusCounts['active'] ?? 0)),
                    'mapelCount' => count(array_unique(array_filter($allMapel))),
                    'jabatanCount' => count(array_unique(array_filter($allJabatan))),
                ],
                'filter_options' => [
                    'mapel' => array_values(array_unique(array_filter($allMapel))),
                    'jabatan' => array_values(array_unique(array_filter($allJabatan))),
                ],
            ],
        ]);
    }

    public function certificates(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $page = max(1, (int) $request->query('page', 1));
        $perPage = $this->perPage($request, 50);

        $query = DB::table('certificates as c')
            ->leftJoin('profiles as p', 'c.user_id', '=', 'p.id');
        if (Schema::hasColumn('certificates', 'tenant_id')) {
            $query->where('c.tenant_id', $tenantId);
        } else {
            $query->where(function ($builder) use ($tenantId) {
                $builder->where('p.tenant_id', $tenantId)
                    ->orWhereNull('c.user_id');
            });
        }

        $search = $this->queryText($request, 'q');
        if ($search !== '') {
            $like = '%'.strtolower($search).'%';
            $query->where(function ($builder) use ($like) {
                $builder->whereRaw('lower(c.nama_penerima) like ?', [$like])
                    ->orWhereRaw('lower(c.email) like ?', [$like])
                    ->orWhereRaw('lower(c.event) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(c.kelas, p.kelas, \'\')) like ?', [$like]);
            });
        }
        $kelas = $this->queryText($request, 'kelas');
        if ($kelas !== '') {
            $query->where(function ($builder) use ($kelas) {
                $builder->where('c.kelas', $kelas)->orWhere('p.kelas', $kelas);
            });
        }
        $sent = $this->queryText($request, 'sent');
        if ($sent !== '') {
            $query->where('c.sent', filter_var($sent, FILTER_VALIDATE_BOOLEAN));
        }

        $total = (clone $query)->count('c.id');
        $rows = $query
            ->select([
                'c.*',
                'p.nama as profile_nama',
                'p.kelas as profile_kelas',
                'p.email as profile_email',
            ])
            ->orderByDesc('c.issued_at')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();

        return response()->json([
            'data' => [
                'rows' => $rows,
                'meta' => $this->paginationMeta($page, $perPage, $total),
            ],
        ]);
    }

    public function scanSessionSummary(Request $request)
    {
        if (! $this->canAccessScanFeature($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $date = $this->queryText($request, 'date') ?: now('Asia/Jakarta')->toDateString();
        $dayName = $this->indonesianDayName(Carbon::parse($date, 'Asia/Jakarta'));

        $settings = $this->firstTenantRow('settings', $tenantId);
        $classes = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', ['id', 'nama', 'tingkat', 'jurusan', 'angkatan']))
            ->orderBy('id')
            ->get();

        $todaySchedule = $this->tenantQuery('jadwal', $tenantId)
            ->select($this->existingColumns('jadwal', ['id', 'kelas_id', 'hari', 'mapel', 'guru_id', 'guru_nama', 'jam_mulai', 'jam_selesai']))
            ->whereRaw('lower(hari) = ?', [strtolower($dayName)])
            ->orderBy('kelas_id')
            ->orderBy('jam_mulai')
            ->get();

        $studentCountByClass = DB::table('profiles')
            ->select('kelas', DB::raw('count(*) as aggregate'))
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->groupBy('kelas')
            ->pluck('aggregate', 'kelas');
        $scheduleCountByClass = $todaySchedule->groupBy('kelas_id')->map(fn ($rows) => $rows->count());

        $recentTempScans = Schema::hasTable('absensi_scan_temp')
            ? $this->tenantQuery('absensi_scan_temp', $tenantId, 't')
                ->leftJoin('profiles as p', function ($join) use ($tenantId) {
                    $join->on('p.id', '=', 't.siswa_id')
                        ->where('p.tenant_id', '=', $tenantId);
                })
                ->select([
                    't.id',
                    't.tanggal',
                    't.siswa_id',
                    't.kelas',
                    't.sesi',
                    't.scan_at',
                    't.source',
                    't.card_uid',
                    't.mapel_count',
                    't.created_at',
                    'p.nama as siswa_nama',
                    'p.nis as siswa_nis',
                    'p.photo_path as siswa_photo_path',
                    'p.photo_url as siswa_photo_url',
                    'p.rfid_uid as siswa_rfid_uid',
                ])
                ->where('t.tanggal', $date)
                ->orderByDesc('t.scan_at')
                ->limit(50)
                ->get()
            : collect();

        $canReadAttendanceScans = Schema::hasTable('absensi')
            && Schema::hasColumn('absensi', 'tanggal')
            && Schema::hasColumn('absensi', 'uid')
            && Schema::hasColumn('absensi', 'waktu')
            && Schema::hasColumn('absensi', 'oleh');

        $recentAttendanceScans = $canReadAttendanceScans
            ? $this->tenantQuery('absensi', $tenantId, 'a')
                ->leftJoin('profiles as p', function ($join) use ($tenantId) {
                    $join->on('p.id', '=', 'a.uid')
                        ->where('p.tenant_id', '=', $tenantId);
                })
                ->select([
                    $this->nullableAliasedColumn('absensi', 'a', 'id', 'absensi_id'),
                    $this->nullableAliasedColumn('absensi', 'a', 'tanggal'),
                    $this->nullableAliasedColumn('absensi', 'a', 'uid', 'siswa_id'),
                    $this->nullableAliasedColumn('absensi', 'a', 'kelas'),
                    $this->nullableAliasedColumn('absensi', 'a', 'mapel'),
                    $this->nullableAliasedColumn('absensi', 'a', 'waktu'),
                    $this->nullableAliasedColumn('absensi', 'a', 'oleh'),
                    $this->nullableAliasedColumn('profiles', 'p', 'nama', 'siswa_nama'),
                    $this->nullableAliasedColumn('profiles', 'p', 'nis', 'siswa_nis'),
                    $this->nullableAliasedColumn('profiles', 'p', 'photo_path', 'siswa_photo_path'),
                    $this->nullableAliasedColumn('profiles', 'p', 'photo_url', 'siswa_photo_url'),
                    $this->nullableAliasedColumn('profiles', 'p', 'rfid_uid', 'siswa_rfid_uid'),
                ])
                ->where('a.tanggal', $date)
                ->whereIn('a.oleh', ['rfid_auto', 'rfid_manual'])
                ->orderByDesc('a.waktu')
                ->limit(50)
                ->get()
                ->map(fn ($row) => (object) [
                    'id' => 'absensi-'.($row->absensi_id ?: md5(($row->siswa_id ?? '').'|'.($row->mapel ?? '').'|'.($row->waktu ?? ''))),
                    'tanggal' => $row->tanggal,
                    'siswa_id' => $row->siswa_id,
                    'kelas' => $row->kelas,
                    'sesi' => $row->mapel,
                    'scan_at' => $row->waktu,
                    'source' => $row->oleh,
                    'card_uid' => $row->siswa_rfid_uid,
                    'mapel_count' => null,
                    'created_at' => $row->waktu,
                    'siswa_nama' => $row->siswa_nama,
                    'siswa_nis' => $row->siswa_nis,
                    'siswa_photo_path' => $row->siswa_photo_path,
                    'siswa_photo_url' => $row->siswa_photo_url,
                    'siswa_rfid_uid' => $row->siswa_rfid_uid,
                ])
            : collect();

        $recentScans = $recentTempScans
            ->concat($recentAttendanceScans)
            ->sortByDesc(fn ($row) => (string) ($row->scan_at ?? $row->created_at ?? ''))
            ->take(50)
            ->values();
        $scannedCountByClass = $recentScans
            ->groupBy('kelas')
            ->map(fn ($rows) => $rows->pluck('siswa_id')->unique()->count());

        $classes = $classes->map(function ($row) use ($studentCountByClass, $scheduleCountByClass, $scannedCountByClass) {
            $item = (array) $row;
            $classId = (string) ($item['id'] ?? '');
            $item['total_siswa'] = (int) ($studentCountByClass[$classId] ?? 0);
            $item['total_mapel'] = (int) ($scheduleCountByClass[$classId] ?? 0);
            $item['scanned_count'] = (int) ($scannedCountByClass[$classId] ?? 0);

            return $item;
        })->values();

        $studentsWithRfid = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereNotNull('rfid_uid')
            ->where('rfid_uid', '<>', '')
            ->count('id');

        return response()->json([
            'data' => [
                'settings' => $settings ? (array) $settings : null,
                'date' => $date,
                'day' => $dayName,
                'classes' => $classes,
                'today_schedule' => $todaySchedule,
                'recent_scans' => $recentScans,
                'statistics' => [
                    'classes' => $classes->count(),
                    'schedule_rows' => $todaySchedule->count(),
                    'recent_scans' => $recentScans->count(),
                    'students_with_rfid' => (int) $studentsWithRfid,
                ],
                'generated_at' => now()->toISOString(),
            ],
        ]);
    }

    public function deleteUser(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $profile = DB::table('profiles')->where('id', $id)->where('tenant_id', $tenantId)->first();
        if (! $profile) {
            return $this->deny('User tidak ditemukan', 404);
        }

        $role = strtolower((string) ($profile->role ?? ''));
        if (! in_array($role, ['guru', 'teacher', 'siswa'], true)) {
            return $this->deny('Hanya role guru/siswa yang boleh dihapus', 409);
        }

        $currentUserId = (string) ($request->user()?->id ?? '');
        if ($currentUserId !== '' && $currentUserId === $id) {
            return $this->deny('Tidak bisa menghapus akun sendiri', 409);
        }

        return $this->deny(
            'Hapus permanen akun guru/siswa sudah dinonaktifkan. Gunakan Mutasi atau Nonaktif agar data tetap aman.',
            409
        );
    }

    public function updateUserStatus(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validator = Validator::make($request->all(), [
            'status' => ['required', 'string', 'in:active,nonaktif,mutasi,alumni'],
            'reason' => ['nullable', 'string', 'max:1000'],
            'role' => ['nullable', 'string', 'in:siswa,guru,teacher'],
        ]);
        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        $profile = DB::table('profiles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $profile) {
            return $this->deny('User tidak ditemukan', 404);
        }

        $role = strtolower((string) ($profile->role ?? ''));
        $normalizedRole = $role === 'teacher' ? 'guru' : $role;
        if (! in_array($normalizedRole, ['guru', 'siswa'], true)) {
            return $this->deny('Status hanya bisa diubah untuk guru atau siswa', 409);
        }

        $expectedRole = strtolower(trim((string) $request->input('role', '')));
        $expectedRole = $expectedRole === 'teacher' ? 'guru' : $expectedRole;
        if ($expectedRole !== '' && $expectedRole !== $normalizedRole) {
            return $this->deny('Role user tidak sesuai dengan data yang dikirim', 409);
        }

        $status = strtolower(trim((string) $request->input('status')));
        if ($normalizedRole === 'guru' && $status === 'alumni') {
            return $this->deny('Status alumni hanya tersedia untuk siswa', 422);
        }

        $reason = preg_replace('/\s+/', ' ', trim((string) $request->input('reason', ''))) ?? '';
        if (in_array($status, ['nonaktif', 'mutasi', 'alumni'], true) && $reason === '') {
            return $this->deny('Alasan wajib diisi', 422);
        }

        $now = now();
        $oldData = (array) $profile;
        $profilePayload = [
            'status' => $status,
            'updated_at' => $now,
        ];

        if ($status === 'active') {
            $profilePayload['alasan_nonaktif'] = null;
            $profilePayload['disabled_at'] = null;
        } else {
            $profilePayload['alasan_nonaktif'] = $reason;
            $profilePayload['disabled_at'] = $now;
        }

        if ($normalizedRole === 'siswa' && in_array($status, ['mutasi', 'alumni'], true)) {
            if (Schema::hasColumn('profiles', 'rfid_uid')) {
                $profilePayload['rfid_uid'] = null;
            }
            if (Schema::hasColumn('profiles', 'kelas')) {
                $profilePayload['kelas'] = '';
            }
        }

        $syncedAssignments = [];
        DB::transaction(function () use (
            $id,
            $tenantId,
            $normalizedRole,
            $status,
            $profilePayload,
            $now,
            &$syncedAssignments
        ) {
            DB::table('profiles')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update($profilePayload);

            if (Schema::hasColumn('users', 'updated_at')) {
                DB::table('users')
                    ->where('id', $id)
                    ->update(['updated_at' => $now]);
            }

            if (in_array($status, ['mutasi', 'alumni'], true)) {
                $syncedAssignments = $normalizedRole === 'guru'
                    ? $this->clearTeacherActiveAssignments($tenantId, $id, $now)
                    : $this->clearStudentActiveAssignments($tenantId, $id, $now);
            }
        });

        $fresh = Profile::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        $this->logAudit(
            $request,
            'profiles',
            $id,
            'UPDATE',
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'status' => $oldData['status'] ?? null,
                'alasan_nonaktif' => $oldData['alasan_nonaktif'] ?? null,
                'disabled_at' => $oldData['disabled_at'] ?? null,
                'kelas' => $oldData['kelas'] ?? null,
                'rfid_uid' => $oldData['rfid_uid'] ?? null,
            ],
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $normalizedRole,
                'status' => $fresh?->status,
                'alasan_nonaktif' => $fresh?->alasan_nonaktif,
                'disabled_at' => $fresh?->disabled_at,
                'kelas' => $fresh?->kelas,
                'rfid_uid' => $fresh?->rfid_uid,
                'synced_assignments' => $syncedAssignments,
            ],
            $tenantId
        );

        $this->refreshAdminPageCache(
            $tenantId,
            [
                AdminPageCacheService::SCOPE_HOME,
                AdminPageCacheService::SCOPE_STRUCTURE,
                AdminPageCacheService::SCOPE_ORGANIZATIONS,
                AdminPageCacheService::SCOPE_TEACHER_OPTIONS,
            ]
        );

        return response()->json([
            'data' => [
                'profile' => $fresh,
                'synced_assignments' => $syncedAssignments,
            ],
        ]);
    }

    public function updateTeacherName(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validator = Validator::make($request->all(), [
            'nama' => ['required', 'string', 'max:120'],
        ]);
        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        $newName = preg_replace('/\s+/', ' ', trim((string) $request->input('nama', ''))) ?? '';
        if ($newName === '') {
            return $this->deny('Nama guru wajib diisi.', 422);
        }

        $profile = DB::table('profiles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $profile) {
            return $this->deny('Guru tidak ditemukan', 404);
        }

        $role = strtolower((string) ($profile->role ?? ''));
        if (! in_array($role, ['guru', 'teacher'], true)) {
            return $this->deny('Hanya nama guru yang bisa diubah dari form ini.', 409);
        }

        $oldName = (string) ($profile->nama ?? '');
        if ($oldName === $newName) {
            return response()->json([
                'data' => [
                    'profile' => $profile,
                    'changed' => false,
                    'synced_snapshots' => [
                        'jadwal' => 0,
                        'kelas_struktur' => 0,
                        'struktur_sekolah' => 0,
                        'organisasi' => 0,
                        'absensi_ajuan' => 0,
                    ],
                ],
            ]);
        }

        $now = now();
        $syncedSnapshots = [];

        DB::transaction(function () use ($id, $tenantId, $newName, $now, &$syncedSnapshots) {
            DB::table('profiles')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update([
                    'nama' => $newName,
                    'updated_at' => $now,
                ]);

            DB::table('users')
                ->where('id', $id)
                ->update([
                    'name' => $newName,
                    'updated_at' => $now,
                ]);

            $syncedSnapshots = $this->syncTeacherDisplayNameSnapshots($tenantId, $id, $newName, $now);
        });

        $fresh = Profile::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        $editor = $this->profile($request);
        $this->logAudit(
            $request,
            'profiles',
            $id,
            'UPDATE',
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'email' => $profile->email,
                'nama' => $oldName,
            ],
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'email' => $profile->email,
                'nama' => $fresh?->nama,
                'synced_snapshots' => $syncedSnapshots,
                'edited_by' => [
                    'id' => $editor?->id ?? $request->user()?->id,
                    'nama' => $editor?->nama ?? $request->user()?->name,
                    'email' => $editor?->email ?? $request->user()?->email,
                    'role' => $editor?->role,
                ],
                'edited_at' => $now->toISOString(),
            ],
            $tenantId
        );

        $this->refreshAdminPageCache(
            $tenantId,
            [
                AdminPageCacheService::SCOPE_HOME,
                AdminPageCacheService::SCOPE_STRUCTURE,
                AdminPageCacheService::SCOPE_ORGANIZATIONS,
                AdminPageCacheService::SCOPE_TEACHER_OPTIONS,
            ]
        );

        return response()->json([
            'data' => [
                'profile' => $fresh,
                'changed' => true,
                'synced_snapshots' => $syncedSnapshots,
            ],
        ]);
    }

    public function updateTeacherProfile(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $validator = Validator::make($request->all(), [
            'nama' => ['required', 'string', 'max:120'],
            'nis' => ['nullable', 'string', 'max:64'],
            'jk' => ['nullable', 'string', 'max:20'],
            'agama' => ['nullable', 'string', 'max:50'],
            'telp' => ['nullable', 'string', 'max:32'],
            'alamat' => ['nullable', 'string', 'max:1000'],
            'tanggal_lahir' => ['nullable', 'date'],
        ]);
        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        $profile = DB::table('profiles')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $profile) {
            return $this->deny('Guru tidak ditemukan', 404);
        }

        $role = strtolower((string) ($profile->role ?? ''));
        if (! in_array($role, ['guru', 'teacher'], true)) {
            return $this->deny('Hanya profil guru yang bisa diubah dari form ini.', 409);
        }

        $validated = $validator->validated();
        $data = [];
        foreach (['nama', 'nis', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir'] as $key) {
            if (! array_key_exists($key, $validated) || ! Schema::hasColumn('profiles', $key)) {
                continue;
            }

            $value = $validated[$key];
            if (is_string($value)) {
                $value = preg_replace('/\s+/', ' ', trim($value)) ?? '';
            }

            if ($key === 'nis') {
                $value = $this->normalizeIdentifierCode($value);
            }
            if ($key === 'jk' && $value !== '') {
                $gender = strtoupper((string) $value);
                $value = in_array($gender, ['L', 'P'], true) ? $gender : $value;
            }

            $data[$key] = $value === '' ? null : $value;
        }

        $newName = (string) ($data['nama'] ?? '');
        if ($newName === '') {
            return $this->deny('Nama guru wajib diisi.', 422);
        }

        $oldProfile = (array) $profile;
        $now = now();
        $syncedSnapshots = [
            'jadwal' => 0,
            'kelas_struktur' => 0,
            'struktur_sekolah' => 0,
            'organisasi' => 0,
            'absensi_ajuan' => 0,
        ];

        DB::transaction(function () use ($id, $tenantId, $data, $newName, $profile, $now, &$syncedSnapshots) {
            DB::table('profiles')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update(array_merge($data, ['updated_at' => $now]));

            if ((string) ($profile->nama ?? '') !== $newName) {
                DB::table('users')
                    ->where('id', $id)
                    ->update([
                        'name' => $newName,
                        'updated_at' => $now,
                    ]);

                $syncedSnapshots = $this->syncTeacherDisplayNameSnapshots($tenantId, $id, $newName, $now);
            }
        });

        $fresh = Profile::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        $editor = $this->profile($request);
        $this->logAudit(
            $request,
            'profiles',
            $id,
            'UPDATE',
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'email' => $oldProfile['email'] ?? null,
                'nama' => $oldProfile['nama'] ?? null,
                'nis' => $oldProfile['nis'] ?? null,
                'jk' => $oldProfile['jk'] ?? null,
                'agama' => $oldProfile['agama'] ?? null,
                'telp' => $oldProfile['telp'] ?? null,
                'alamat' => $oldProfile['alamat'] ?? null,
                'tanggal_lahir' => $oldProfile['tanggal_lahir'] ?? null,
            ],
            [
                'id' => $id,
                'tenant_id' => $tenantId,
                'role' => $role,
                'email' => $fresh?->email,
                'nama' => $fresh?->nama,
                'nis' => $fresh?->nis,
                'jk' => $fresh?->jk,
                'agama' => $fresh?->agama,
                'telp' => $fresh?->telp,
                'alamat' => $fresh?->alamat,
                'tanggal_lahir' => $fresh?->tanggal_lahir,
                'synced_snapshots' => $syncedSnapshots,
                'edited_by' => [
                    'id' => $editor?->id ?? $request->user()?->id,
                    'nama' => $editor?->nama ?? $request->user()?->name,
                    'email' => $editor?->email ?? $request->user()?->email,
                    'role' => $editor?->role,
                ],
                'edited_at' => $now->toISOString(),
            ],
            $tenantId
        );

        $this->refreshAdminPageCache(
            $tenantId,
            [
                AdminPageCacheService::SCOPE_HOME,
                AdminPageCacheService::SCOPE_STRUCTURE,
                AdminPageCacheService::SCOPE_ORGANIZATIONS,
                AdminPageCacheService::SCOPE_TEACHER_OPTIONS,
            ]
        );

        return response()->json([
            'data' => [
                'profile' => $fresh,
                'synced_snapshots' => $syncedSnapshots,
            ],
        ]);
    }

    public function updateStudentAdditionalInfo(Request $request, string $id)
    {
        if (! $this->isAdmin($request) && ! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $student = Profile::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->first();

        if (! $student) {
            return $this->deny('Siswa tidak ditemukan', 404);
        }

        if (! $this->canEditStudentAdditionalInfo($request, $student, $tenantId)) {
            return $this->deny('Anda tidak memiliki akses untuk mengubah data siswa ini.', 403);
        }

        $payload = $request->all();
        $validator = Validator::make($payload, [
            'nama' => ['sometimes', 'string', 'max:120'],
            'nis' => ['sometimes', 'nullable', 'string', 'max:40'],
            'jk' => ['sometimes', 'nullable', 'string', 'max:20'],
            'tanggal_lahir' => ['sometimes', 'nullable', 'date'],
            'agama' => ['sometimes', 'nullable', 'string', 'max:50'],
            'alamat' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        $allowedKeys = ['nama', 'nis', 'jk', 'tanggal_lahir', 'agama', 'alamat'];
        $hasAnyField = false;
        foreach ($allowedKeys as $key) {
            if (array_key_exists($key, $payload)) {
                $hasAnyField = true;
                break;
            }
        }

        if (! $hasAnyField) {
            return $this->deny('Tidak ada data yang dikirim untuk diperbarui.', 422);
        }

        $data = [];

        if (array_key_exists('nama', $payload)) {
            $nama = trim((string) ($payload['nama'] ?? ''));
            if ($nama === '') {
                return $this->deny('Nama siswa wajib diisi.', 422);
            }
            $data['nama'] = $nama;
        }

        if (array_key_exists('nis', $payload)) {
            $nis = $this->nullableString($payload['nis'] ?? null);
            if ($nis !== null) {
                $exists = DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->where('role', 'siswa')
                    ->where('id', '!=', $id)
                    ->whereRaw('UPPER(nis) = ?', [strtoupper($nis)])
                    ->exists();

                if ($exists) {
                    return $this->deny('NIS sudah dipakai siswa lain di sekolah ini.', 422);
                }
            }

            $data['nis'] = $nis;
        }

        if (array_key_exists('jk', $payload)) {
            $data['jk'] = $this->normalizeGenderValue($payload['jk']);
        }

        if (array_key_exists('tanggal_lahir', $payload)) {
            $tanggalLahir = $this->nullableString($payload['tanggal_lahir'] ?? null);
            $data['tanggal_lahir'] = $tanggalLahir;
            $data['usia'] = $tanggalLahir ? $this->calculateAgeFromBirthDate($tanggalLahir) : null;
        }

        if (array_key_exists('agama', $payload)) {
            $data['agama'] = $this->nullableString($payload['agama'] ?? null);
        }

        if (array_key_exists('alamat', $payload)) {
            $data['alamat'] = $this->nullableString($payload['alamat'] ?? null);
        }

        $oldData = [
            'nama' => $student->nama,
            'jk' => $student->jk,
            'usia' => $student->usia,
            'nis' => $student->nis,
            'tanggal_lahir' => $student->tanggal_lahir,
            'agama' => $student->agama,
            'alamat' => $student->alamat,
        ];

        $now = now();
        $data['updated_at'] = $now;

        DB::transaction(function () use ($id, $tenantId, $data, $now) {
            DB::table('profiles')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update($data);

            if (array_key_exists('tanggal_lahir', $data)) {
                $this->syncImportedInitialStudentPassword($tenantId, $id, $now);
            }

            if (array_key_exists('nama', $data)) {
                DB::table('users')
                    ->where('id', $id)
                    ->update([
                        'name' => $data['nama'],
                        'updated_at' => $now,
                    ]);

                $this->syncStudentDisplayNameSnapshots($tenantId, $id, (string) $data['nama'], $now);
            }
        });

        $fresh = Profile::query()
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        $this->logAudit(
            $request,
            'profiles',
            $id,
            'UPDATE',
            $oldData,
            [
                'nama' => $fresh?->nama,
                'jk' => $fresh?->jk,
                'usia' => $fresh?->usia,
                'tanggal_lahir' => $fresh?->tanggal_lahir,
                'agama' => $fresh?->agama,
                'alamat' => $fresh?->alamat,
            ],
            $tenantId
        );

        $this->refreshAdminPageCache(
            $tenantId,
            [
                AdminPageCacheService::SCOPE_HOME,
                AdminPageCacheService::SCOPE_STRUCTURE,
                AdminPageCacheService::SCOPE_ORGANIZATIONS,
            ]
        );

        return response()->json([
            'data' => [
                'profile' => $fresh,
            ],
        ]);
    }

    private function clearStudentActiveAssignments(string $tenantId, string $studentId, Carbon $now): array
    {
        return [
            'kelas_struktur' => $this->updateTenantActiveAcademicTable(
                'kelas_struktur',
                ['ketua_siswa_id' => $studentId],
                [
                    'ketua_siswa_id' => null,
                    'ketua_siswa_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
        ];
    }

    private function clearTeacherActiveAssignments(string $tenantId, string $teacherId, Carbon $now): array
    {
        return [
            'jadwal' => $this->updateTenantActiveAcademicTable(
                'jadwal',
                ['guru_id' => $teacherId],
                [
                    'guru_id' => null,
                    'guru_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
            'kelas_struktur' => $this->updateTenantActiveAcademicTable(
                'kelas_struktur',
                ['wali_guru_id' => $teacherId],
                [
                    'wali_guru_id' => null,
                    'wali_guru_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
            'struktur_sekolah' => $this->updateTenantActiveAcademicTable(
                'struktur_sekolah',
                ['guru_id' => $teacherId],
                [
                    'guru_id' => null,
                    'guru_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
            'organisasi' => $this->updateTenantActiveAcademicTable(
                'organisasi',
                ['pembina_guru_id' => $teacherId],
                [
                    'pembina_guru_id' => null,
                    'pembina_guru_nama' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
            'ekskul' => $this->updateTenantActiveAcademicTable(
                'ekskul',
                ['pembina_guru_id' => $teacherId],
                [
                    'pembina_guru_id' => null,
                    'updated_at' => $now,
                ],
                $tenantId
            ),
        ];
    }

    private function updateTenantActiveAcademicTable(
        string $table,
        array $matches,
        array $values,
        string $tenantId
    ): int {
        try {
            if (! Schema::hasTable($table)) {
                return 0;
            }

            $query = DB::table($table);
            if (Schema::hasColumn($table, 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }

            $period = $this->academicPeriodLifecycle->currentContext($tenantId);
            $yearColumn = AcademicScopeRegistry::academicYearColumn($table);
            if (
                AcademicScopeRegistry::isYearScoped($table)
                && Schema::hasColumn($table, $yearColumn)
            ) {
                $query->where($yearColumn, $period['tahun_ajaran'] ?? '');
            } elseif (AcademicScopeRegistry::isTermScoped($table)) {
                if (Schema::hasColumn($table, $yearColumn)) {
                    $query->where($yearColumn, $period['tahun_ajaran'] ?? '');
                }
                if (Schema::hasColumn($table, 'semester')) {
                    $query->where('semester', $period['semester'] ?? '');
                }
            }

            foreach ($matches as $column => $value) {
                if (! Schema::hasColumn($table, $column)) {
                    return 0;
                }
                $query->where($column, $value);
            }

            $payload = $this->filterExistingPayload($table, $values);

            return $payload === [] ? 0 : $query->update($payload);
        } catch (\Throwable) {
            return 0;
        }
    }

    private function cleanupBeforeHardDelete(string $userId, string $role): void
    {
        $now = now();

        // FK audit_log.user_id -> profiles.id (non-cascade), wajib dinullkan dulu
        DB::table('audit_log')->where('user_id', $userId)->update(['user_id' => null]);

        // Referensi text/non-cascade yang sering menahan delete
        DB::table('kelas_struktur')
            ->where('ketua_siswa_id', $userId)
            ->update([
                'ketua_siswa_id' => null,
                'ketua_siswa_nama' => null,
                'updated_at' => $now,
            ]);

        DB::table('organisasi_anggota')->where('siswa_id', $userId)->delete();
        DB::table('absensi_eskul')->where('user_id', $userId)->delete();

        // Referensi ke users.id (non-cascade)
        DB::table('templat_sertifikat_publik')
            ->where('created_by', $userId)
            ->update([
                'created_by' => null,
                'updated_at' => $now,
            ]);

        // Referensi ke profiles.id (non-cascade)
        DB::table('tugas')
            ->where('created_by', $userId)
            ->update([
                'created_by' => null,
                'updated_at' => $now,
            ]);

        if (in_array($role, ['guru', 'teacher'], true)) {
            DB::table('jadwal')->where('guru_id', $userId)->delete();

            DB::table('kelas_struktur')
                ->where('wali_guru_id', $userId)
                ->update([
                    'wali_guru_id' => null,
                    'wali_guru_nama' => null,
                    'updated_at' => $now,
                ]);

            DB::table('struktur_sekolah')->where('guru_id', $userId)->delete();

            DB::table('organisasi')
                ->where('pembina_guru_id', $userId)
                ->update([
                    'pembina_guru_id' => null,
                    'pembina_guru_nama' => null,
                    'updated_at' => $now,
                ]);

            DB::table('ekskul')
                ->where('pembina_guru_id', $userId)
                ->update([
                    'pembina_guru_id' => null,
                    'updated_at' => $now,
                ]);

            DB::table('absensi_ajuan')
                ->where('guru_id', $userId)
                ->update([
                    'guru_id' => null,
                    'guru_nama' => null,
                ]);

            DB::table('quizzes')->where('guru_id', $userId)->delete();
        }
    }

    private function nullableString(mixed $value): ?string
    {
        $normalized = trim((string) ($value ?? ''));

        return $normalized === '' ? null : $normalized;
    }

    private function normalizeIdentifierCode(mixed $value): string
    {
        $normalized = preg_replace('/\s+/', '', trim((string) ($value ?? '')));

        return strtoupper((string) $normalized);
    }

    private function normalizeProfileCreatedVia(mixed $value, string $default): string
    {
        $normalized = strtolower(trim((string) ($value ?? '')));
        $normalized = str_replace(['-', ' '], '_', $normalized);

        return match ($normalized) {
            'import', 'file', 'excel', 'spreadsheet', 'sheet', 'google_sheet', 'google_sheets' => 'import',
            'manual', 'manual_registration', 'pendaftaran_manual', 'registrasi_manual' => 'manual_registration',
            'admin', 'admin_created', 'created_by_admin', 'buatan_admin' => 'admin_created',
            default => $default,
        };
    }

    private function syncImportedInitialStudentPassword(string $tenantId, string $studentId, mixed $timestamp = null): bool
    {
        return $this->syncImportedInitialProfilePassword($tenantId, $studentId, $timestamp);
    }

    private function syncImportedInitialProfilePassword(string $tenantId, string $profileId, mixed $timestamp = null): bool
    {
        $profile = Profile::query()
            ->where('id', $profileId)
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['siswa', 'guru', 'teacher'])
            ->first();

        if (! $profile || ! $this->isImportedInitialProfileAccount($profile)) {
            return false;
        }

        $seed = $this->buildBirthDatePasswordSeed($profile->tanggal_lahir);
        if ($seed === '') {
            $nis = trim((string) ($profile->nis ?? ''));
            $digits = preg_replace('/\D+/', '', $nis) ?? '';
            $seed = $digits !== '' ? $digits : $nis;
        }
        if ($seed === '') {
            return false;
        }

        DB::table('users')
            ->where('id', $profileId)
            ->update([
                'password' => Hash::make($this->normalizeProvisionPassword($seed)),
                'updated_at' => $timestamp ?: now(),
            ]);

        return true;
    }

    private function isImportedInitialStudentAccount(Profile $profile): bool
    {
        return $this->isImportedInitialProfileAccount($profile);
    }

    private function isImportedInitialProfileAccount(Profile $profile): bool
    {
        if (! in_array(strtolower(trim((string) ($profile->role ?? ''))), ['siswa', 'guru', 'teacher'], true)) {
            return false;
        }
        if (! (bool) ($profile->must_change_password ?? false)) {
            return false;
        }

        $createdVia = $this->normalizeProfileCreatedVia($profile->created_via ?? null, '');
        $email = strtolower(trim((string) ($profile->email ?? '')));

        return $createdVia === 'import' || Str::endsWith($email, '@import.local');
    }

    private function buildBirthDatePasswordSeed(mixed $tanggalLahir): string
    {
        if (! $tanggalLahir) {
            return '';
        }

        try {
            $date = date_create((string) $tanggalLahir);
            if (! $date) {
                return '';
            }

            return $date->format('dmY');
        } catch (\Throwable $e) {
            return '';
        }
    }

    private function normalizeProvisionPassword(string $password): string
    {
        $raw = trim($password);
        if ($this->looksLikeStrongProvisionPassword($raw)) {
            return $raw;
        }

        $digits = preg_replace('/\D+/', '', $raw) ?? '';
        $digits = $digits !== '' ? $digits : '123456';
        if (strlen($digits) < 6) {
            $digits = str_pad($digits, 6, '0');
        }

        $generated = 'Aa'.$digits.'!Edu';
        while (strlen($generated) < $this->provisionPasswordMinLength()) {
            $generated .= '9';
        }

        return $generated;
    }

    private function looksLikeStrongProvisionPassword(string $password): bool
    {
        if (strlen($password) < $this->provisionPasswordMinLength()) {
            return false;
        }

        return preg_match('/[a-z]/', $password)
            && preg_match('/[A-Z]/', $password)
            && preg_match('/\d/', $password)
            && preg_match('/[^a-zA-Z0-9]/', $password);
    }

    private function provisionPasswordMinLength(): int
    {
        return max(12, (int) env('PASSWORD_MIN_LENGTH', 12));
    }

    private function temporaryStrongPassword(): string
    {
        return $this->normalizeProvisionPassword(Str::random(24).'9!');
    }

    private function resolveCohortForClass(string $tenantId, mixed $classId): ?string
    {
        $normalizedClassId = trim((string) ($classId ?? ''));
        if ($normalizedClassId === '' || ! Schema::hasTable('kelas') || ! Schema::hasColumn('kelas', 'angkatan')) {
            return null;
        }

        $query = DB::table('kelas')->where(function ($inner) use ($normalizedClassId) {
            $inner->where('id', $normalizedClassId);
            if (Schema::hasColumn('kelas', 'nama')) {
                $inner->orWhere('nama', $normalizedClassId);
            }
        });
        if (Schema::hasColumn('kelas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $cohort = trim((string) ($query->orderBy('id')->value('angkatan') ?? ''));

        return $cohort !== '' ? $cohort : null;
    }

    private function canEditStudentAdditionalInfo(Request $request, Profile $student, string $tenantId): bool
    {
        if ($this->isAdmin($request)) {
            return true;
        }

        if (! $this->isGuru($request)) {
            return false;
        }

        $guruId = (string) ($request->user()?->id ?? '');
        $kelasId = trim((string) ($student->kelas ?? ''));
        if ($guruId === '' || $kelasId === '') {
            return false;
        }

        return DB::table('kelas_struktur')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', $kelasId)
            ->where('wali_guru_id', $guruId)
            ->exists();
    }

    private function normalizeGenderValue(mixed $value): ?string
    {
        $normalized = strtolower(trim((string) ($value ?? '')));
        if ($normalized === '') {
            return null;
        }

        if (in_array($normalized, ['l', 'lk', 'laki', 'laki-laki', 'laki laki', 'pria', 'cowok'], true)) {
            return 'L';
        }

        if (in_array($normalized, ['p', 'pr', 'perempuan', 'perumpuan', 'wanita', 'cewek'], true)) {
            return 'P';
        }

        return strtoupper(substr($normalized, 0, 1));
    }

    private function calculateAgeFromBirthDate(string $value): ?int
    {
        try {
            $birthDate = Carbon::parse($value);
        } catch (\Throwable $e) {
            return null;
        }

        $now = Carbon::now($birthDate->getTimezone());
        if ($birthDate->greaterThan($now)) {
            return null;
        }

        return $birthDate->age;
    }

    private function buildImportPlaceholderEmail(string $identifier, string $tenantId): string
    {
        $local = strtolower(trim($identifier));
        $local = preg_replace('/[^a-z0-9]+/i', '.', $local) ?? '';
        $local = trim($local, '.');
        if ($local === '') {
            $local = 'user';
        }

        $tenantPart = strtolower(trim($tenantId));
        $tenantPart = preg_replace('/[^a-z0-9]+/i', '.', $tenantPart) ?? '';
        $tenantPart = trim($tenantPart, '.');
        if ($tenantPart === '') {
            $tenantPart = 'tenant';
        }

        return "{$local}.{$tenantPart}@import.local";
    }

    private function saveAcademicPeriodSettings(string $tenantId, ?object $existing, array $payload): ?object
    {
        if (Schema::hasTable('settings') === false) {
            throw new \RuntimeException('Tabel settings belum tersedia.');
        }

        $update = $this->filterExistingPayload('settings', $payload);
        if (Schema::hasColumn('settings', 'updated_at')) {
            $update['updated_at'] = now();
        }

        if ($existing) {
            $query = DB::table('settings')->where('id', $existing->id);
            if (Schema::hasColumn('settings', 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }
            $query->update($update);

            $select = DB::table('settings')->where('id', $existing->id);
            if (Schema::hasColumn('settings', 'tenant_id')) {
                $select->where('tenant_id', $tenantId);
            }

            return $select->first();
        }

        if (Schema::hasColumn('settings', 'tenant_id')) {
            $update['tenant_id'] = $tenantId;
        }
        if (Schema::hasColumn('settings', 'created_at')) {
            $update['created_at'] = now();
        }

        $id = DB::table('settings')->insertGetId($update);

        $select = DB::table('settings')->where('id', $id);
        if (Schema::hasColumn('settings', 'tenant_id')) {
            $select->where('tenant_id', $tenantId);
        }

        return $select->first();
    }

    private function previewAcademicYearRollover(
        string $tenantId,
        string $sourceYear,
        string $targetYear
    ): array {
        if (! Schema::hasTable('kelas') || ! Schema::hasTable('profiles')) {
            return [
                'promoted_students' => 0,
                'alumni_students' => 0,
                'retained_students' => 0,
                'skipped_students' => 0,
            ];
        }

        $classInfoById = [];
        $classRows = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', [
                'id', 'nama', 'grade', 'suffix', 'angkatan', 'tahun_ajaran', 'semester', 'is_active',
            ]))
            ->get();
        foreach ($classRows as $row) {
            if (! $this->isActiveClassRow($row)) {
                continue;
            }
            $grade = $this->classGradeFromRow($row);
            $suffix = $this->classSuffixFromRow($row, $grade);
            $id = trim((string) ($row->id ?? ''));
            if ($id !== '' && $grade !== '' && $suffix !== '') {
                $classInfoById[$id] = ['grade' => $grade, 'suffix' => $suffix];
            }
        }

        $retainedIds = $this->rolloverExceptionStudentIds($tenantId, $sourceYear, $targetYear);
        $preview = [
            'promoted_students' => 0,
            'alumni_students' => 0,
            'retained_students' => 0,
            'skipped_students' => 0,
        ];
        DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereRaw('lower(coalesce(status, \'active\')) = ?', ['active'])
            ->select($this->existingColumns('profiles', ['id', 'kelas']))
            ->orderBy('id')
            ->get()
            ->each(function ($student) use (&$preview, $classInfoById, $retainedIds) {
                $studentId = trim((string) ($student->id ?? ''));
                $classId = trim((string) ($student->kelas ?? ''));
                if ($studentId === '' || $classId === '' || ! isset($classInfoById[$classId])) {
                    $preview['skipped_students']++;

                    return;
                }
                if (isset($retainedIds[$studentId])) {
                    $preview['retained_students']++;

                    return;
                }

                $nextGrade = $this->nextAcademicGrade($classInfoById[$classId]['grade']);
                if ($nextGrade === null) {
                    $preview['skipped_students']++;
                } elseif ($nextGrade === 'ALUMNI') {
                    $preview['alumni_students']++;
                } else {
                    $preview['promoted_students']++;
                }
            });

        return $preview;
    }

    private function assertRolloverMatchesPreview(?array $preview, array $result): void
    {
        if ($preview === null) {
            return;
        }

        foreach (['promoted_students', 'alumni_students', 'retained_students', 'skipped_students'] as $key) {
            if ((int) ($preview[$key] ?? 0) !== (int) ($result[$key] ?? 0)) {
                throw new \RuntimeException(
                    'Rollover dibatalkan karena hasil eksekusi berubah dari pratinjau. Muat ulang halaman lalu konfirmasi kembali.'
                );
            }
        }
    }

    private function rolloverAcademicYearData(
        string $tenantId,
        array $period,
        string $previousYear,
        string $previousSemester,
        bool $carryEskulMembers
    ): array {
        $catalogCopy = app(ExtracurricularPeriodService::class)->copyCatalog(
            $tenantId,
            $previousYear,
            $previousSemester,
            $period
        );
        $eskulCatalogCopied = (int) ($catalogCopy['copied_count'] ?? 0);
        $eskulIdMap = is_array($catalogCopy['id_map'] ?? null)
            ? $catalogCopy['id_map']
            : [];

        if (Schema::hasTable('kelas') === false || Schema::hasTable('profiles') === false) {
            return [
                'promoted_students' => 0,
                'alumni_students' => 0,
                'skipped_students' => 0,
                'classes_synced' => 0,
                'eskul_catalog_copied' => $eskulCatalogCopied,
                'eskul_members_copied' => 0,
            ];
        }

        $targetStartYear = (int) substr((string) $period['tahun_ajaran'], 0, 4);
        $classRows = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', [
                'id', 'nama', 'grade', 'suffix', 'angkatan', 'tahun_ajaran', 'semester', 'is_active',
            ]))
            ->get();

        $classInfoById = [];
        $classesByGradeSuffix = [];
        foreach ($classRows as $row) {
            if ($this->isActiveClassRow($row) === false) {
                continue;
            }

            $grade = $this->classGradeFromRow($row);
            $suffix = $this->classSuffixFromRow($row, $grade);
            $id = trim((string) ($row->id ?? ''));
            if ($id === '' || $grade === '' || $suffix === '') {
                continue;
            }

            $info = [
                'id' => $id,
                'grade' => $grade,
                'suffix' => $suffix,
                'label' => trim($grade.' '.$suffix),
            ];
            $classInfoById[$id] = $info;
            $classesByGradeSuffix[$grade][$suffix] = $info;
        }

        $createdTargetClasses = $this->ensureRolloverTargetClasses(
            $tenantId,
            $period,
            $classInfoById,
            $classesByGradeSuffix
        );

        $studentRows = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereRaw('lower(coalesce(status, \'active\')) = ?', ['active'])
            ->select($this->existingColumns('profiles', ['id', 'kelas', 'angkatan', 'status']))
            ->orderBy('kelas')
            ->orderBy('id')
            ->get();

        $updatesByTarget = [];
        $targetGradeByClass = [];
        $alumniIds = [];
        $affectedClassIds = [];
        $studentClassSnapshots = [];
        $clearedClassStudentIds = [];
        $skippedStudents = 0;
        $retainedStudents = 0;
        $missingTargets = [];
        $retainedStudentIds = $this->rolloverExceptionStudentIds($tenantId, $previousYear, $period['tahun_ajaran']);

        foreach ($studentRows as $student) {
            $studentId = trim((string) ($student->id ?? ''));
            $classId = trim((string) ($student->kelas ?? ''));
            if ($studentId === '' || $classId === '' || isset($classInfoById[$classId]) === false) {
                $skippedStudents += 1;

                continue;
            }

            $currentClass = $classInfoById[$classId];
            if (isset($retainedStudentIds[$studentId])) {
                $affectedClassIds[$classId] = true;
                $studentClassSnapshots[$studentId] = $classId;
                $retainedStudents += 1;

                continue;
            }

            $nextGrade = $this->nextAcademicGrade($currentClass['grade']);
            if ($nextGrade === null) {
                $skippedStudents += 1;

                continue;
            }

            $affectedClassIds[$classId] = true;
            if ($nextGrade === 'ALUMNI') {
                $alumniIds[] = $studentId;
                $clearedClassStudentIds[] = $studentId;

                continue;
            }

            $targetClass = $classesByGradeSuffix[$nextGrade][$currentClass['suffix']] ?? null;
            if ($targetClass === null) {
                $missingTargets[$nextGrade.' '.$currentClass['suffix']] = true;

                continue;
            }

            $updatesByTarget[$targetClass['id']][] = $studentId;
            $targetGradeByClass[$targetClass['id']] = $nextGrade;
            $affectedClassIds[$targetClass['id']] = true;
            $studentClassSnapshots[$studentId] = $targetClass['id'];
        }

        if ($missingTargets !== []) {
            $labels = array_keys($missingTargets);
            sort($labels, SORT_NATURAL);
            throw new \RuntimeException(
                'Kelas tujuan rollover belum bisa disiapkan otomatis: '.implode(', ', array_slice($labels, 0, 12)).
                (count($labels) > 12 ? ', ...' : '').
                '. Periksa data kelas aktif sebelum periode disimpan.'
            );
        }

        $now = now();
        $promotedStudents = 0;
        foreach ($updatesByTarget as $targetClassId => $studentIds) {
            $update = [
                'kelas' => $targetClassId,
                'updated_at' => $now,
            ];
            if (Schema::hasColumn('profiles', 'angkatan')) {
                $update['angkatan'] = $this->cohortYearForGrade($targetGradeByClass[$targetClassId] ?? '', $targetStartYear);
            }
            $update = $this->filterExistingPayload('profiles', $update);

            foreach (array_chunk($studentIds, 500) as $chunk) {
                DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('id', $chunk)
                    ->update($update);
            }
            $promotedStudents += count($studentIds);
        }

        if ($alumniIds !== []) {
            $alumniPayload = [
                'status' => 'alumni',
                'kelas' => '',
                'tahun_lulus' => $targetStartYear,
                'disabled_at' => $now,
                'alasan_nonaktif' => 'Lulus otomatis saat rollover dari '.$previousYear.' ke '.$period['tahun_ajaran'].'.',
                'updated_at' => $now,
            ];
            $alumniPayload = $this->filterExistingPayload('profiles', $alumniPayload);

            foreach (array_chunk($alumniIds, 500) as $chunk) {
                DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('id', $chunk)
                    ->update($alumniPayload);
            }
        }

        $snapshotUpdates = $this->syncStudentClassSnapshotTables($tenantId, $studentClassSnapshots, $clearedClassStudentIds);
        $this->markRolloverExceptionsResolved($tenantId, $previousYear, $period['tahun_ajaran']);
        $eskulMembersCopied = $carryEskulMembers
            ? $this->copyEskulMembershipsToAcademicPeriod(
                $tenantId,
                $previousYear,
                $previousSemester,
                $period,
                array_keys($studentClassSnapshots),
                $eskulIdMap
            )
            : 0;

        $affectedIds = array_keys($affectedClassIds);
        if ($affectedIds !== [] && Schema::hasTable('kelas_struktur')) {
            $structurePayload = $this->filterExistingPayload('kelas_struktur', [
                'ketua_siswa_id' => null,
                'ketua_siswa_nama' => null,
                'updated_at' => $now,
            ]);
            if ($structurePayload !== []) {
                $query = DB::table('kelas_struktur')->whereIn('kelas_id', $affectedIds);
                if (Schema::hasColumn('kelas_struktur', 'tenant_id')) {
                    $query->where('tenant_id', $tenantId);
                }
                if (Schema::hasColumn('kelas_struktur', 'tahun_ajaran')) {
                    $query->where('tahun_ajaran', $period['tahun_ajaran']);
                }
                $query->update($structurePayload);
            }
        }

        return [
            'promoted_students' => $promotedStudents,
            'alumni_students' => count($alumniIds),
            'retained_students' => $retainedStudents,
            'skipped_students' => $skippedStudents,
            'created_target_classes' => $createdTargetClasses,
            'classes_synced' => $this->syncClassPeriodMetadata($tenantId, $period),
            'related_snapshots_synced' => $snapshotUpdates,
            'eskul_catalog_copied' => $eskulCatalogCopied,
            'eskul_members_copied' => $eskulMembersCopied,
        ];
    }

    private function ensureRolloverTargetClasses(
        string $tenantId,
        array $period,
        array &$classInfoById,
        array &$classesByGradeSuffix
    ): int {
        if (Schema::hasTable('kelas') === false) {
            return 0;
        }

        $targetYear = AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        $targetSemester = AcademicPeriod::normalizeSemester($period['semester'] ?? null);
        if ($targetYear === null || $targetSemester === null) {
            return 0;
        }

        $targetStartYear = (int) substr($targetYear, 0, 4);
        $created = 0;
        $insertedNames = [];

        foreach ($classesByGradeSuffix as $grade => $suffixes) {
            $nextGrade = $this->nextAcademicGrade($grade);
            if ($nextGrade === null || $nextGrade === 'ALUMNI') {
                continue;
            }

            foreach (array_keys($suffixes) as $suffix) {
                if (isset($classesByGradeSuffix[$nextGrade][$suffix])) {
                    continue;
                }

                $name = trim($nextGrade.' '.$suffix);
                if ($name === '' || isset($insertedNames[$name])) {
                    continue;
                }

                $existing = $this->findClassByNameForRollover($tenantId, $name);
                if ($existing !== null) {
                    $this->prepareExistingClassForRollover(
                        $tenantId,
                        $existing,
                        $period,
                        $nextGrade,
                        $suffix,
                        $targetStartYear
                    );

                    $info = $this->classInfoFromRow($existing, true, $nextGrade, $suffix);
                    if ($info !== null) {
                        $classInfoById[$info['id']] = $info;
                        $classesByGradeSuffix[$info['grade']][$info['suffix']] = $info;
                    }

                    continue;
                }

                $classId = $this->resolveRolloverClassId($name);
                $payload = $this->filterExistingPayload('kelas', [
                    'id' => $classId,
                    'tenant_id' => $tenantId,
                    'nama' => strtoupper($name),
                    'grade' => $nextGrade,
                    'suffix' => $suffix,
                    'angkatan' => $this->cohortYearForGrade($nextGrade, $targetStartYear),
                    'tahun_ajaran' => $targetYear,
                    'semester' => $targetSemester,
                    'is_active' => true,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                if ($payload === [] || ! isset($payload['id'])) {
                    continue;
                }

                DB::table('kelas')->insert($payload);

                $info = [
                    'id' => $classId,
                    'grade' => $nextGrade,
                    'suffix' => $suffix,
                    'label' => strtoupper($name),
                ];
                $classInfoById[$classId] = $info;
                $classesByGradeSuffix[$nextGrade][$suffix] = $info;
                $insertedNames[$name] = true;
                $created += 1;
            }
        }

        return $created;
    }

    private function findClassByNameForRollover(string $tenantId, string $name): ?object
    {
        if (Schema::hasTable('kelas') === false || Schema::hasColumn('kelas', 'nama') === false) {
            return null;
        }

        $query = DB::table('kelas')
            ->whereRaw('upper(nama) = ?', [strtoupper($name)]);
        if (Schema::hasColumn('kelas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query
            ->select($this->existingColumns('kelas', [
                'id', 'nama', 'grade', 'suffix', 'angkatan', 'tahun_ajaran', 'semester', 'is_active',
            ]))
            ->first();
    }

    private function prepareExistingClassForRollover(
        string $tenantId,
        object $row,
        array $period,
        string $grade,
        string $suffix,
        int $targetStartYear
    ): void {
        $classId = trim((string) ($row->id ?? ''));
        if ($classId === '') {
            return;
        }

        $payload = $this->filterExistingPayload('kelas', [
            'grade' => $grade,
            'suffix' => $suffix,
            'angkatan' => $this->cohortYearForGrade($grade, $targetStartYear),
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
            'is_active' => true,
            'updated_at' => now(),
        ]);
        if ($payload === []) {
            return;
        }

        $query = DB::table('kelas')->where('id', $classId);
        if (Schema::hasColumn('kelas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
        $query->update($payload);
    }

    private function classInfoFromRow(
        object $row,
        bool $ignoreActive = false,
        ?string $gradeOverride = null,
        ?string $suffixOverride = null
    ): ?array {
        if ($ignoreActive === false && $this->isActiveClassRow($row) === false) {
            return null;
        }

        $grade = $this->normalizeClassGrade((string) ($gradeOverride ?? '')) ?: $this->classGradeFromRow($row);
        $suffix = $suffixOverride !== null ? strtoupper(trim($suffixOverride)) : $this->classSuffixFromRow($row, $grade);
        $id = trim((string) ($row->id ?? ''));
        if ($id === '' || $grade === '' || $suffix === '') {
            return null;
        }

        return [
            'id' => $id,
            'grade' => $grade,
            'suffix' => $suffix,
            'label' => trim($grade.' '.$suffix),
        ];
    }

    private function resolveRolloverClassId(string $name): string
    {
        $base = Str::slug($name);
        $base = trim(substr($base, 0, 80), '-');
        if ($base === '') {
            $base = 'kelas';
        }

        $candidate = $base;
        $attempt = 1;
        while (DB::table('kelas')->where('id', $candidate)->exists()) {
            $attempt += 1;
            $suffix = '-'.$attempt;
            $candidate = trim(substr($base, 0, max(1, 80 - strlen($suffix))), '-').$suffix;
        }

        return $candidate;
    }

    private function rolloverExceptionStudentIds(string $tenantId, string $sourceYear, string $targetYear): array
    {
        if (
            Schema::hasTable('academic_rollover_exceptions') === false
            || Schema::hasColumn('academic_rollover_exceptions', 'student_id') === false
        ) {
            return [];
        }

        $query = $this->tenantQuery('academic_rollover_exceptions', $tenantId)
            ->where('source_tahun_ajaran', $sourceYear)
            ->where('target_tahun_ajaran', $targetYear);

        if (Schema::hasColumn('academic_rollover_exceptions', 'resolved_at')) {
            $query->whereNull('resolved_at');
        }

        return $query
            ->pluck('student_id')
            ->mapWithKeys(fn ($studentId) => [trim((string) $studentId) => true])
            ->filter(fn ($selected, $studentId) => $studentId !== '')
            ->all();
    }

    private function resolveRolloverExceptionYears(array $payload): array
    {
        $sourceYear = AcademicPeriod::normalizeAcademicYear($payload['source_tahun_ajaran'] ?? null)
            ?: trim((string) ($payload['source_tahun_ajaran'] ?? ''));
        $targetYear = AcademicPeriod::normalizeAcademicYear($payload['target_tahun_ajaran'] ?? null)
            ?: trim((string) ($payload['target_tahun_ajaran'] ?? ''));

        return [$sourceYear ?: null, $targetYear ?: null];
    }

    private function validateRolloverExceptionStudents(string $tenantId, array $studentIds): ?string
    {
        if ($studentIds === []) {
            return null;
        }

        if (! Schema::hasTable('profiles')) {
            return 'Data siswa belum siap.';
        }

        $query = DB::table('profiles')
            ->whereIn('id', $studentIds);

        if (Schema::hasColumn('profiles', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        if (Schema::hasColumn('profiles', 'role')) {
            $query->whereIn('role', ['siswa', 'student']);
        }

        if (Schema::hasColumn('profiles', 'status')) {
            $query->where(function ($statusQuery) {
                $statusQuery
                    ->whereNull('status')
                    ->orWhere('status', '')
                    ->orWhereIn(DB::raw('LOWER(status)'), ['active', 'aktif']);
            });
        }

        $validCount = $query
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->unique()
            ->count();

        return $validCount === count($studentIds)
            ? null
            : 'Siswa pengecualian harus siswa aktif di sekolah ini.';
    }

    private function markRolloverExceptionsResolved(string $tenantId, string $sourceYear, string $targetYear): void
    {
        if (
            Schema::hasTable('academic_rollover_exceptions') === false
            || Schema::hasColumn('academic_rollover_exceptions', 'resolved_at') === false
        ) {
            return;
        }

        $payload = $this->filterExistingPayload('academic_rollover_exceptions', [
            'resolved_at' => now(),
            'updated_at' => now(),
        ]);
        if ($payload === []) {
            return;
        }

        $this->tenantQuery('academic_rollover_exceptions', $tenantId)
            ->where('source_tahun_ajaran', $sourceYear)
            ->where('target_tahun_ajaran', $targetYear)
            ->whereNull('resolved_at')
            ->update($payload);
    }

    private function copyEskulMembershipsToAcademicPeriod(
        string $tenantId,
        string $sourceYear,
        string $sourceSemester,
        array $targetPeriod,
        array $studentIds,
        array $eskulIdMap = []
    ): int {
        $studentIds = array_values(array_unique(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $studentIds
        ))));
        if ($studentIds === [] || Schema::hasTable('ekskul_anggota') === false) {
            return 0;
        }

        foreach (['ekskul_id', 'user_id', 'tahun_ajaran', 'semester'] as $column) {
            if (Schema::hasColumn('ekskul_anggota', $column) === false) {
                return 0;
            }
        }

        $targetYear = AcademicPeriod::normalizeAcademicYear($targetPeriod['tahun_ajaran'] ?? null);
        $targetSemester = AcademicPeriod::normalizeSemester($targetPeriod['semester'] ?? null);
        $sourceYear = AcademicPeriod::normalizeAcademicYear($sourceYear);
        $sourceSemester = AcademicPeriod::normalizeSemester($sourceSemester);
        if (
            $targetYear === null
            || $targetSemester === null
            || $sourceYear === null
            || $sourceSemester === null
            || ($sourceYear === $targetYear && $sourceSemester === $targetSemester)
        ) {
            return 0;
        }

        $cohortByStudent = [];
        if (Schema::hasColumn('profiles', 'angkatan')) {
            foreach (array_chunk($studentIds, 500) as $chunk) {
                $profileQuery = DB::table('profiles')->whereIn('id', $chunk);
                if (Schema::hasColumn('profiles', 'tenant_id')) {
                    $profileQuery->where('tenant_id', $tenantId);
                }

                foreach ($profileQuery->pluck('angkatan', 'id') as $studentId => $cohort) {
                    $cohortByStudent[(string) $studentId] = $cohort;
                }
            }
        }

        $validTargetEskulIds = [];
        if (Schema::hasTable('ekskul') && Schema::hasColumn('ekskul', 'id')) {
            $ekskulQuery = DB::table('ekskul');
            if (Schema::hasColumn('ekskul', 'tenant_id')) {
                $ekskulQuery->where('tenant_id', $tenantId);
            }
            if (Schema::hasColumn('ekskul', 'tahun_ajaran')) {
                $ekskulQuery->where('tahun_ajaran', $targetYear);
            }
            if (Schema::hasColumn('ekskul', 'semester')) {
                $ekskulQuery->where('semester', $targetSemester);
            }

            foreach ($ekskulQuery->pluck('id') as $ekskulId) {
                $id = trim((string) $ekskulId);
                if ($id !== '') {
                    $validTargetEskulIds[$id] = true;
                }
            }
        }

        $existingTargetKeys = [];
        foreach (array_chunk($studentIds, 500) as $chunk) {
            $targetQuery = DB::table('ekskul_anggota')
                ->where('tahun_ajaran', $targetYear)
                ->where('semester', $targetSemester)
                ->whereIn('user_id', $chunk);
            if (Schema::hasColumn('ekskul_anggota', 'tenant_id')) {
                $targetQuery->where('tenant_id', $tenantId);
            }

            foreach ($targetQuery->get(['ekskul_id', 'user_id']) as $row) {
                $userId = trim((string) ($row->user_id ?? ''));
                $ekskulId = trim((string) ($row->ekskul_id ?? ''));
                if ($userId !== '' && $ekskulId !== '') {
                    $existingTargetKeys[$userId.'|'.$ekskulId] = true;
                }
            }
        }

        $sourceColumns = $this->existingColumns('ekskul_anggota', ['id', 'ekskul_id', 'user_id', 'angkatan']);
        $sourceRows = [];
        foreach (array_chunk($studentIds, 500) as $chunk) {
            $sourceQuery = DB::table('ekskul_anggota')
                ->where('tahun_ajaran', $sourceYear)
                ->where('semester', $sourceSemester)
                ->whereIn('user_id', $chunk)
                ->whereNotNull('ekskul_id')
                ->where('ekskul_id', '!=', '')
                ->whereNotNull('user_id')
                ->where('user_id', '!=', '');
            if (Schema::hasColumn('ekskul_anggota', 'tenant_id')) {
                $sourceQuery->where('tenant_id', $tenantId);
            }
            if (Schema::hasColumn('ekskul_anggota', 'id')) {
                $sourceQuery->orderBy('id');
            }

            foreach ($sourceQuery->get($sourceColumns) as $row) {
                $sourceRows[] = $row;
            }
        }

        $now = now();
        $insertRows = [];
        $seenSourceKeys = [];
        foreach ($sourceRows as $row) {
            $userId = trim((string) ($row->user_id ?? ''));
            $sourceEskulId = trim((string) ($row->ekskul_id ?? ''));
            $targetEskulId = trim((string) ($eskulIdMap[$sourceEskulId] ?? ''));
            if ($userId === '' || $sourceEskulId === '' || $targetEskulId === '') {
                continue;
            }
            if (! isset($validTargetEskulIds[$targetEskulId])) {
                continue;
            }

            $key = $userId.'|'.$targetEskulId;
            if (isset($seenSourceKeys[$key]) || isset($existingTargetKeys[$key])) {
                continue;
            }

            $seenSourceKeys[$key] = true;
            $insertRows[] = $this->filterExistingPayload('ekskul_anggota', [
                'tenant_id' => $tenantId,
                'ekskul_id' => $targetEskulId,
                'user_id' => $userId,
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'angkatan' => $cohortByStudent[$userId] ?? ($row->angkatan ?? null),
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        foreach (array_chunk($insertRows, 500) as $chunk) {
            if ($chunk !== []) {
                DB::table('ekskul_anggota')->insert($chunk);
            }
        }

        return count($insertRows);
    }

    private function buildSchedulePeriodDecisionStatus(string $tenantId, array $params = []): array
    {
        $settings = $this->firstTenantRow('settings', $tenantId);
        $activePeriod = AcademicPeriod::fromSettings($settings);
        $activeYear = AcademicPeriod::normalizeAcademicYear($activePeriod['tahun_ajaran'] ?? null);
        $targetYear = AcademicPeriod::normalizeAcademicYear($params['target_tahun_ajaran'] ?? $params['tahun_ajaran'] ?? null)
            ?: $activeYear;
        $sourceYear = $this->previousAcademicYear($targetYear);
        $targetScheduleCount = $targetYear ? $this->scheduleCountForAcademicYear($tenantId, $targetYear) : 0;
        $sourceScheduleCount = $sourceYear ? $this->scheduleCountForAcademicYear($tenantId, $sourceYear) : 0;
        $decision = $targetYear ? $this->scheduleDecisionForAcademicYear($tenantId, $targetYear) : null;
        $isActivePeriod = $targetYear !== null && $activeYear !== null && $targetYear === $activeYear;
        $schemaReady = Schema::hasTable('academic_schedule_period_decisions');

        return [
            'schema_ready' => $schemaReady,
            'active_tahun_ajaran' => $activeYear,
            'active_semester' => AcademicPeriod::normalizeSemester($activePeriod['semester'] ?? null),
            'target_tahun_ajaran' => $targetYear,
            'source_tahun_ajaran' => $sourceYear,
            'is_active_period' => $isActivePeriod,
            'target_schedule_count' => $targetScheduleCount,
            'source_schedule_count' => $sourceScheduleCount,
            'has_target_schedule' => $targetScheduleCount > 0,
            'has_source_schedule' => $sourceScheduleCount > 0,
            'decision' => $decision,
            'requires_decision' => $schemaReady && $isActivePeriod && $targetScheduleCount === 0 && $decision === null,
        ];
    }

    private function scheduleCountForAcademicYear(string $tenantId, ?string $academicYear): int
    {
        $academicYear = AcademicPeriod::normalizeAcademicYear($academicYear);
        if (! $academicYear || ! Schema::hasTable('jadwal') || ! Schema::hasColumn('jadwal', 'tahun_ajaran')) {
            return 0;
        }

        return (int) $this->tenantQuery('jadwal', $tenantId)
            ->where('tahun_ajaran', $academicYear)
            ->count();
    }

    private function previousAcademicYear(?string $academicYear): ?string
    {
        $academicYear = AcademicPeriod::normalizeAcademicYear($academicYear);
        if (! $academicYear) {
            return null;
        }

        $startYear = (int) substr($academicYear, 0, 4);
        if ($startYear <= 1) {
            return null;
        }

        return ($startYear - 1).'/'.$startYear;
    }

    private function scheduleDecisionForAcademicYear(string $tenantId, string $targetYear): ?array
    {
        if (! Schema::hasTable('academic_schedule_period_decisions')) {
            return null;
        }

        $row = $this->tenantQuery('academic_schedule_period_decisions', $tenantId)
            ->where('target_tahun_ajaran', $targetYear)
            ->first($this->existingColumns('academic_schedule_period_decisions', [
                'id', 'target_tahun_ajaran', 'source_tahun_ajaran', 'decision',
                'copied_count', 'decided_by', 'created_at', 'updated_at',
            ]));

        if (! $row) {
            return null;
        }

        return [
            'id' => (string) ($row->id ?? ''),
            'target_tahun_ajaran' => (string) ($row->target_tahun_ajaran ?? ''),
            'source_tahun_ajaran' => $row->source_tahun_ajaran ?? null,
            'decision' => (string) ($row->decision ?? ''),
            'copied_count' => (int) ($row->copied_count ?? 0),
            'decided_by' => $row->decided_by ?? null,
            'created_at' => $row->created_at ?? null,
            'updated_at' => $row->updated_at ?? null,
        ];
    }

    private function recordSchedulePeriodDecision(
        string $tenantId,
        string $targetYear,
        ?string $sourceYear,
        string $decision,
        int $copiedCount,
        ?string $userId = null
    ): void {
        if (! Schema::hasTable('academic_schedule_period_decisions')) {
            return;
        }

        $now = now();
        $existing = $this->tenantQuery('academic_schedule_period_decisions', $tenantId)
            ->where('target_tahun_ajaran', $targetYear)
            ->first(['id']);

        $payload = $this->filterExistingPayload('academic_schedule_period_decisions', [
            'tenant_id' => $tenantId,
            'target_tahun_ajaran' => $targetYear,
            'source_tahun_ajaran' => $sourceYear,
            'decision' => $decision,
            'copied_count' => $copiedCount,
            'decided_by' => $userId ?: null,
            'updated_at' => $now,
        ]);

        if ($existing?->id) {
            $this->tenantQuery('academic_schedule_period_decisions', $tenantId)
                ->where('id', $existing->id)
                ->update($payload);

            return;
        }

        $payload = $this->filterExistingPayload('academic_schedule_period_decisions', array_merge($payload, [
            'id' => (string) Str::uuid(),
            'created_at' => $now,
        ]));

        if ($payload !== []) {
            DB::table('academic_schedule_period_decisions')->insert($payload);
        }
    }

    /**
     * Salin semua jadwal dari tahun ajaran sebelumnya ke tahun ajaran baru.
     *
     * Guru dan mata pelajaran tetap sama — hanya tahun_ajaran yang diganti.
     * Siswa tidak perlu disalin karena daftar siswa per kelas sudah diupdate
     * oleh rolloverAcademicYearData() melalui profiles.kelas.
     *
     * Baris yang sudah ada di tahun tujuan tidak akan diduplikasi (skip).
     * Ini memastikan aman dijalankan berkali-kali (idempotent).
     */
    private function copyJadwalToNewPeriod(
        string $tenantId,
        string $sourceYear,
        string $targetYear,
        ?string $targetSemester = null
    ): int {
        if (! Schema::hasTable('jadwal')) {
            return 0;
        }

        $sourceYear = AcademicPeriod::normalizeAcademicYear($sourceYear);
        $targetYear = AcademicPeriod::normalizeAcademicYear($targetYear);
        $targetSemester = AcademicPeriod::normalizeSemester($targetSemester);

        if (! $sourceYear || ! $targetYear || $sourceYear === $targetYear) {
            return 0;
        }

        if (! Schema::hasColumn('jadwal', 'tahun_ajaran')) {
            return 0;
        }

        // Columns to carry over (excluding id — we generate a new one)
        $copyColumns = $this->existingColumns('jadwal', [
            'tenant_id', 'kelas_id', 'hari', 'mapel',
            'guru_id', 'guru_nama',
            'jam_mulai', 'jam_selesai',
            'semester', 'periode_berlaku', 'angkatan',
        ]);

        // Load source rows
        $sourceQuery = DB::table('jadwal')->where('tahun_ajaran', $sourceYear);
        if (Schema::hasColumn('jadwal', 'tenant_id')) {
            $sourceQuery->where('tenant_id', $tenantId);
        }
        $sourceColumns = array_values(array_unique(array_merge($copyColumns, ['kelas_id', 'mapel', 'hari', 'jam_mulai'])));
        $sourceRows = $sourceQuery->get($sourceColumns);

        if ($sourceRows->isEmpty()) {
            return 0;
        }

        // Build a set of existing rows in the target year to avoid duplicates.
        // Key: kelas_id|hari|mapel|jam_mulai
        $existingQuery = DB::table('jadwal')->where('tahun_ajaran', $targetYear);
        if (Schema::hasColumn('jadwal', 'tenant_id')) {
            $existingQuery->where('tenant_id', $tenantId);
        }
        $existingKeys = [];
        foreach ($existingQuery->get(['kelas_id', 'hari', 'mapel', 'jam_mulai']) as $row) {
            $key = implode('|', [
                trim((string) ($row->kelas_id ?? '')),
                trim((string) ($row->hari ?? '')),
                trim((string) ($row->mapel ?? '')),
                trim((string) ($row->jam_mulai ?? '')),
            ]);
            $existingKeys[$key] = true;
        }

        $now = now();
        $insertRows = [];

        foreach ($sourceRows as $row) {
            $key = implode('|', [
                trim((string) ($row->kelas_id ?? '')),
                trim((string) ($row->hari ?? '')),
                trim((string) ($row->mapel ?? '')),
                trim((string) ($row->jam_mulai ?? '')),
            ]);

            // Skip if already exists in target year
            if (isset($existingKeys[$key])) {
                continue;
            }

            $existingKeys[$key] = true; // prevent duplicate inserts within this batch

            $newRow = ['tahun_ajaran' => $targetYear, 'created_at' => $now, 'updated_at' => $now];
            foreach ($copyColumns as $col) {
                $newRow[$col] = $row->{$col} ?? null;
            }
            if ($targetSemester && Schema::hasColumn('jadwal', 'semester')) {
                $newRow['semester'] = $targetSemester;
            }
            if (Schema::hasColumn('jadwal', 'periode_berlaku') && trim((string) ($newRow['periode_berlaku'] ?? '')) === '') {
                $newRow['periode_berlaku'] = 'tahunan';
            }

            // Generate a new UUID-style id for the row
            $newRow['id'] = (string) Str::uuid();

            $newRow = $this->filterExistingPayload('jadwal', $newRow);
            if (empty($newRow)) {
                continue;
            }

            $insertRows[] = $newRow;
        }

        foreach (array_chunk($insertRows, 300) as $chunk) {
            if ($chunk !== []) {
                DB::table('jadwal')->insert($chunk);
            }
        }

        return count($insertRows);
    }

    private function syncStudentClassSnapshotTables(string $tenantId, array $studentClassMap, array $clearedStudentIds): int
    {
        $updates = 0;
        $snapshotTables = [
            'organisasi_anggota' => 'siswa_id',
            'osis_anggota' => 'siswa_id',
        ];

        foreach ($snapshotTables as $table => $studentColumn) {
            if (
                Schema::hasTable($table) === false
                || Schema::hasColumn($table, $studentColumn) === false
                || Schema::hasColumn($table, 'kelas') === false
            ) {
                continue;
            }

            foreach ($studentClassMap as $studentId => $classId) {
                $payload = $this->filterExistingPayload($table, [
                    'kelas' => $classId,
                    'updated_at' => now(),
                ]);
                if ($payload === []) {
                    continue;
                }

                $query = DB::table($table)->where($studentColumn, $studentId);
                if (Schema::hasColumn($table, 'tenant_id')) {
                    $query->where('tenant_id', $tenantId);
                }
                $updates += (int) $query->update($payload);
            }

            if ($clearedStudentIds !== []) {
                $payload = $this->filterExistingPayload($table, [
                    'kelas' => null,
                    'updated_at' => now(),
                ]);
                if ($payload === []) {
                    continue;
                }

                foreach (array_chunk($clearedStudentIds, 500) as $chunk) {
                    $query = DB::table($table)->whereIn($studentColumn, $chunk);
                    if (Schema::hasColumn($table, 'tenant_id')) {
                        $query->where('tenant_id', $tenantId);
                    }
                    $updates += (int) $query->update($payload);
                }
            }
        }

        return $updates;
    }

    private function syncClassPeriodMetadata(string $tenantId, array $period): int
    {
        if (Schema::hasTable('kelas') === false) {
            return 0;
        }

        $targetStartYear = (int) substr((string) $period['tahun_ajaran'], 0, 4);
        $rows = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', ['id', 'nama', 'grade', 'suffix', 'is_active']))
            ->orderBy('id')
            ->get();

        $count = 0;
        foreach ($rows as $row) {
            if ($this->isActiveClassRow($row) === false) {
                continue;
            }

            $grade = $this->classGradeFromRow($row);
            $update = [
                'tahun_ajaran' => $period['tahun_ajaran'],
                'semester' => $period['semester'],
                'updated_at' => now(),
            ];
            if ($grade !== '') {
                $update['angkatan'] = $this->cohortYearForGrade($grade, $targetStartYear);
            }

            $update = $this->filterExistingPayload('kelas', $update);
            if (empty($update)) {
                continue;
            }

            $query = DB::table('kelas')->where('id', $row->id);
            if (Schema::hasColumn('kelas', 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }
            $query->update($update);
            $count += 1;
        }

        return $count;
    }

    private function dashboardSummaryCacheKey(string $tenantId, string $tahunAjaran = ''): string
    {
        return "tenant:{$tenantId}:admin-dashboard-summary:v3:".sha1($tahunAjaran ?: 'active');
    }

    private function refreshAdminPageCache(string $tenantId, array $scopes = [], array $years = []): void
    {
        if (trim($tenantId) === '') {
            return;
        }

        $scopes = array_values(array_unique(array_filter($scopes))) ?: [
            AdminPageCacheService::SCOPE_HOME,
            AdminPageCacheService::SCOPE_STRUCTURE,
            AdminPageCacheService::SCOPE_ORGANIZATIONS,
            AdminPageCacheService::SCOPE_TEACHER_OPTIONS,
        ];

        $years = array_values(array_unique(array_filter(array_map(
            fn ($year) => AcademicPeriod::normalizeAcademicYear($year) ?: '',
            $years
        ))));

        try {
            app(AdminPageCacheService::class)->bumpTenantVersions($tenantId, $scopes);
            RefreshAdminPageCacheJob::dispatch($tenantId, $scopes, $years)->afterResponse();
        } catch (\Throwable $e) {
            // Cache admin tidak boleh mengganggu mutasi utama.
        }
    }

    private function studentCountForAcademicYear(string $tenantId, string $tahunAjaran = ''): int
    {
        if ($tahunAjaran !== '' && $this->hasStudentClassHistoryForYear($tenantId, $tahunAjaran)) {
            $query = $this->tenantQuery('student_class_histories', $tenantId)
                ->where('tahun_ajaran', $tahunAjaran)
                ->whereNotNull('student_id')
                ->whereNotNull('class_id')
                ->where('class_id', '!=', '')
                ->whereRaw('lower(coalesce(status, \'active\')) <> ?', ['alumni']);

            return (int) $query->distinct()->count('student_id');
        }

        if (! Schema::hasTable('profiles')) {
            return 0;
        }

        return (int) DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereRaw('lower(coalesce(status, \'active\')) <> ?', ['alumni'])
            ->count();
    }

    private function classesForAcademicYear(string $tenantId, string $tahunAjaran = '')
    {
        $baseRows = $this->classRowsFromTable($tenantId);
        $periodTableRows = $this->classRowsFromTable($tenantId, $tahunAjaran);
        $historyRows = $this->classRowsFromStudentHistory($tenantId, $tahunAjaran);

        if ($historyRows->isNotEmpty()) {
            $baseById = $baseRows->keyBy(fn ($row) => (string) ($row['id'] ?? ''));
            $merged = [];

            foreach ($historyRows as $row) {
                $id = (string) ($row['id'] ?? '');
                if ($id === '') {
                    continue;
                }

                $base = (array) ($baseById->get($id) ?? []);
                $merged[$id] = $this->mergeClassRowPreferNonEmpty($base, $row);
            }

            foreach ($periodTableRows as $row) {
                $id = (string) ($row['id'] ?? '');
                if ($id === '') {
                    continue;
                }

                $merged[$id] = isset($merged[$id])
                    ? $this->mergeClassRowPreferNonEmpty($row, $merged[$id])
                    : $row;
            }

            return $this->sortClassRows(collect(array_values($merged)));
        }

        if ($periodTableRows->isNotEmpty()) {
            return $this->sortClassRows($periodTableRows);
        }

        return $this->sortClassRows($baseRows);
    }

    private function classRowsFromTable(string $tenantId, string $tahunAjaran = '')
    {
        if (! Schema::hasTable('kelas')) {
            return collect();
        }

        if ($tahunAjaran !== '' && ! Schema::hasColumn('kelas', 'tahun_ajaran')) {
            return collect();
        }

        $query = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', [
                'id', 'nama', 'grade', 'suffix', 'tingkat', 'jurusan',
                'angkatan', 'tahun_ajaran', 'semester', 'is_active',
                'created_at', 'updated_at',
            ]));

        if ($tahunAjaran !== '' && Schema::hasColumn('kelas', 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $tahunAjaran);
        }

        return $query
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();
    }

    private function classRowsFromStudentHistory(string $tenantId, string $tahunAjaran = '')
    {
        if ($tahunAjaran === '' || ! $this->hasStudentClassHistoryForYear($tenantId, $tahunAjaran)) {
            return collect();
        }

        $rows = $this->tenantQuery('student_class_histories', $tenantId)
            ->where('tahun_ajaran', $tahunAjaran)
            ->whereNotNull('class_id')
            ->where('class_id', '!=', '')
            ->whereRaw('lower(coalesce(status, \'active\')) <> ?', ['alumni'])
            ->select($this->existingColumns('student_class_histories', [
                'class_id', 'class_name', 'grade', 'suffix', 'angkatan',
                'tahun_ajaran', 'semester',
            ]))
            ->orderBy('class_id')
            ->limit(10000)
            ->get();

        $classes = [];
        foreach ($rows as $row) {
            $id = trim((string) ($row->class_id ?? ''));
            if ($id === '') {
                continue;
            }

            $name = trim((string) ($row->class_name ?? '')) ?: $id;
            $grade = $this->normalizeClassGrade((string) ($row->grade ?? '')) ?: $this->parseClassGrade($name);
            $suffix = trim((string) ($row->suffix ?? ''));
            if ($suffix === '') {
                $suffix = $this->stripClassGradePrefix($name, $grade);
            }

            $next = [
                'id' => $id,
                'nama' => $name,
                'grade' => $grade,
                'suffix' => $suffix,
                'tingkat' => $grade,
                'jurusan' => '',
                'angkatan' => trim((string) ($row->angkatan ?? '')),
                'tahun_ajaran' => $tahunAjaran,
                'semester' => trim((string) ($row->semester ?? '')),
                'is_active' => true,
            ];

            $classes[$id] = isset($classes[$id])
                ? $this->mergeClassRowPreferNonEmpty($classes[$id], $next)
                : $next;
        }

        return collect(array_values($classes))->values();
    }

    private function mergeClassRowPreferNonEmpty(array $base, array $override): array
    {
        $row = $base;
        foreach ($override as $key => $value) {
            if ($value === null) {
                continue;
            }
            if (is_string($value) && trim($value) === '') {
                continue;
            }
            $row[$key] = $value;
        }

        return $row;
    }

    private function sortClassRows($rows)
    {
        $gradeOrder = [
            'VII' => 0,
            'VIII' => 1,
            'IX' => 2,
            'X' => 3,
            'XI' => 4,
            'XII' => 5,
        ];

        return $rows
            ->sort(function (array $a, array $b) use ($gradeOrder) {
                $gradeA = $this->normalizeClassGrade((string) ($a['grade'] ?? ''))
                    ?: $this->parseClassGrade((string) ($a['nama'] ?? $a['id'] ?? ''));
                $gradeB = $this->normalizeClassGrade((string) ($b['grade'] ?? ''))
                    ?: $this->parseClassGrade((string) ($b['nama'] ?? $b['id'] ?? ''));
                $orderA = $gradeOrder[$gradeA] ?? 999;
                $orderB = $gradeOrder[$gradeB] ?? 999;
                if ($orderA !== $orderB) {
                    return $orderA <=> $orderB;
                }

                $suffixCompare = strcasecmp((string) ($a['suffix'] ?? ''), (string) ($b['suffix'] ?? ''));
                if ($suffixCompare !== 0) {
                    return $suffixCompare;
                }

                return strcasecmp((string) ($a['nama'] ?? $a['id'] ?? ''), (string) ($b['nama'] ?? $b['id'] ?? ''));
            })
            ->values();
    }

    private function hasStudentClassHistoryForYear(string $tenantId, string $tahunAjaran = ''): bool
    {
        return $tahunAjaran !== ''
            && Schema::hasTable('student_class_histories')
            && Schema::hasColumn('student_class_histories', 'student_id')
            && Schema::hasColumn('student_class_histories', 'tahun_ajaran')
            && (bool) $this->tenantQuery('student_class_histories', $tenantId)
                ->where('tahun_ajaran', $tahunAjaran)
                ->whereNotNull('student_id')
                ->exists();
    }

    private function studentOptionRowsFromClassHistory(
        string $tenantId,
        string $tahunAjaran,
        string $kelas = '',
        string $status = 'active',
        string $search = '',
        int $limit = 51
    ) {
        if (
            $tahunAjaran === ''
            || ! Schema::hasTable('student_class_histories')
            || ! Schema::hasTable('profiles')
            || ! Schema::hasColumn('student_class_histories', 'student_id')
            || ! Schema::hasColumn('student_class_histories', 'class_id')
            || ! Schema::hasColumn('student_class_histories', 'tahun_ajaran')
        ) {
            return collect();
        }

        $limit = max(1, min(10001, $limit));
        $fetchLimit = min(20000, max($limit + 25, $limit * 3));
        $status = strtolower(trim($status));
        $search = strtolower(trim($search));

        $query = $this->tenantQuery('student_class_histories', $tenantId, 'sch')
            ->join('profiles as p', 'p.id', '=', 'sch.student_id')
            ->where('p.role', 'siswa')
            ->where('sch.tahun_ajaran', $tahunAjaran)
            ->whereNotNull('sch.class_id')
            ->where('sch.class_id', '!=', '');

        if (Schema::hasColumn('profiles', 'tenant_id')) {
            $query->where('p.tenant_id', $tenantId);
        }
        if ($kelas !== '') {
            $query->where('sch.class_id', $kelas);
        }

        $statusExpression = 'lower(coalesce(sch.status, \'active\'))';
        if ($status !== '') {
            $query->whereRaw("{$statusExpression} = ?", [$status]);
        } else {
            $query->whereRaw("{$statusExpression} <> ?", ['alumni']);
        }

        if ($search !== '') {
            $like = '%'.$search.'%';
            $query->where(function ($builder) use ($like) {
                $builder->whereRaw('lower(coalesce(p.nama, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(p.email, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(p.nis, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(sch.class_id, \'\')) like ?', [$like])
                    ->orWhereRaw('lower(coalesce(sch.class_name, \'\')) like ?', [$like]);
            });
        }

        $rows = $query
            ->select($this->prefixedExistingColumns('profiles', [
                'id', 'nama', 'email', 'nis', 'created_via', 'created_by',
            ], 'p'))
            ->selectRaw('coalesce(sch.class_id, p.kelas) as kelas')
            ->selectRaw('coalesce(sch.status, \'active\') as status')
            ->selectRaw('coalesce(sch.angkatan, p.angkatan) as angkatan')
            ->orderBy('sch.class_id')
            ->orderBy('p.nama')
            ->limit($fetchLimit)
            ->get();

        $unique = [];
        foreach ($rows as $row) {
            $id = trim((string) ($row->id ?? ''));
            if ($id === '' || isset($unique[$id])) {
                continue;
            }

            $item = (array) $row;
            $item['role'] = 'siswa';
            $item['uid'] = $id;
            $unique[$id] = $item;
            if (count($unique) >= $limit) {
                break;
            }
        }

        return collect(array_values($unique))->values();
    }

    private function studentsForAcademicYearClass(
        string $tenantId,
        string $classId,
        string $tahunAjaran = '',
        string $studentStatus = '',
        int $limit = 250
    ) {
        if ($tahunAjaran !== '' && $this->hasStudentClassHistoryForYear($tenantId, $tahunAjaran)) {
            return $this->studentOptionRowsFromClassHistory(
                $tenantId,
                $tahunAjaran,
                $classId,
                $studentStatus,
                '',
                $limit
            )->take($limit)->values();
        }

        $studentQuery = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->where('kelas', $classId);

        if ($studentStatus !== '') {
            $studentQuery->whereRaw('lower(coalesce(status, \'active\')) = ?', [$studentStatus]);
        } else {
            $studentQuery->whereRaw('lower(coalesce(status, \'active\')) <> ?', ['alumni']);
        }

        return $studentQuery
            ->select($this->existingColumns('profiles', [
                'id', 'nama', 'email', 'kelas', 'role', 'status', 'nis', 'angkatan',
                'created_via', 'created_by',
            ]))
            ->orderBy('nama')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();
    }

    private function studentClassHistoriesForStudents(string $tenantId, array $studentIds): array
    {
        $ids = array_values(array_unique(array_filter(
            array_map(fn ($id) => trim((string) $id), $studentIds),
            fn ($id) => $id !== ''
        )));
        if ($ids === [] || ! Schema::hasTable('student_class_histories')) {
            return [];
        }

        $columns = $this->existingColumns('student_class_histories', [
            'id', 'student_id', 'class_id', 'class_name', 'grade', 'suffix', 'angkatan',
            'tahun_ajaran', 'semester', 'status', 'source', 'note', 'valid_from',
            'valid_until', 'created_at',
        ]);
        if ($columns === []) {
            return [];
        }

        $rows = $this->tenantQuery('student_class_histories', $tenantId)
            ->whereIn('student_id', $ids)
            ->select($columns)
            ->orderBy('student_id')
            ->orderByDesc(Schema::hasColumn('student_class_histories', 'valid_from') ? 'valid_from' : 'created_at')
            ->limit(max(100, count($ids) * 8))
            ->get()
            ->map(fn ($row) => (array) $row)
            ->groupBy(fn ($row) => (string) ($row['student_id'] ?? ''));

        $histories = [];
        foreach ($rows as $studentId => $studentRows) {
            $histories[$studentId] = $studentRows
                ->take(8)
                ->values()
                ->all();
        }

        return $histories;
    }

    private function hasStudentClassSnapshotsForPeriod(string $tenantId, array $period): bool
    {
        if (
            ! Schema::hasTable('student_class_histories')
            || ! Schema::hasColumn('student_class_histories', 'tahun_ajaran')
        ) {
            return false;
        }

        $year = AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        if (! $year) {
            return false;
        }

        $query = $this->tenantQuery('student_class_histories', $tenantId)
            ->where('tahun_ajaran', $year)
            ->whereNotNull('student_id');

        $semester = AcademicPeriod::normalizeSemester($period['semester'] ?? null);
        if ($semester && Schema::hasColumn('student_class_histories', 'semester')) {
            $query->where('semester', $semester);
        }

        if (Schema::hasColumn('student_class_histories', 'source')) {
            $query->whereIn('source', $this->authoritativeClassSnapshotSources());
        }

        return $query->exists();
    }

    private function previewStudentProfilesFromPeriodSnapshot(string $tenantId, array $period): array
    {
        $year = AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        if (! $year || ! Schema::hasTable('profiles')) {
            return [
                'snapshot_students' => 0,
                'active_profile_students' => 0,
                'would_restore' => 0,
                'would_mark_outside_period' => 0,
                'missing_profiles' => 0,
                'active_snapshots' => 0,
                'alumni_snapshots' => 0,
                'nonactive_snapshots' => 0,
            ];
        }

        $snapshots = $this->latestStudentSnapshotRowsForPeriod($tenantId, $period, true);
        $snapshotStudentIds = array_keys($snapshots);
        $profiles = [];
        foreach (array_chunk($snapshotStudentIds, 500) as $chunk) {
            foreach (DB::table('profiles')
                ->where('tenant_id', $tenantId)
                ->where('role', 'siswa')
                ->whereIn('id', $chunk)
                ->select($this->existingColumns('profiles', [
                    'id', 'kelas', 'status', 'angkatan', 'disabled_at', 'alasan_nonaktif', 'tahun_lulus',
                ]))
                ->get() as $profile) {
                $profiles[(string) ($profile->id ?? '')] = $profile;
            }
        }

        $wouldRestore = 0;
        $missingProfiles = 0;
        $statusCounts = [
            'active_snapshots' => 0,
            'alumni_snapshots' => 0,
            'nonactive_snapshots' => 0,
        ];

        foreach ($snapshots as $studentId => $snapshot) {
            $status = $this->statusFromStudentClassSnapshot($snapshot);
            if ($status === 'active') {
                $statusCounts['active_snapshots'] += 1;
            } elseif ($status === 'alumni') {
                $statusCounts['alumni_snapshots'] += 1;
            } else {
                $statusCounts['nonactive_snapshots'] += 1;
            }

            $profile = $profiles[$studentId] ?? null;
            if (! $profile) {
                $missingProfiles += 1;

                continue;
            }

            if ($this->studentProfileNeedsSnapshotRestore($profile, $snapshot, $year)) {
                $wouldRestore += 1;
            }
        }

        $activeProfileStudents = (int) DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereRaw('lower(coalesce(status, \'active\')) = ?', ['active'])
            ->count();

        return array_merge([
            'snapshot_students' => count($snapshots),
            'active_profile_students' => $activeProfileStudents,
            'would_restore' => $wouldRestore,
            'would_mark_outside_period' => $this->countStudentsMissingFromPeriodSnapshot($tenantId, $snapshotStudentIds),
            'missing_profiles' => $missingProfiles,
        ], $statusCounts);
    }

    private function restoreStudentProfilesFromPeriodSnapshot(string $tenantId, array $period): array
    {
        if (
            ! Schema::hasTable('student_class_histories')
            || ! Schema::hasTable('profiles')
            || ! Schema::hasColumn('student_class_histories', 'student_id')
            || ! Schema::hasColumn('student_class_histories', 'tahun_ajaran')
        ) {
            return ['restored' => 0, 'outside_period' => 0];
        }

        $year = AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        if (! $year) {
            return ['restored' => 0, 'outside_period' => 0];
        }

        $snapshots = $this->latestStudentSnapshotRowsForPeriod($tenantId, $period, true);

        if ($snapshots === []) {
            return ['restored' => 0, 'outside_period' => 0];
        }

        $now = now();
        $restored = 0;
        foreach (array_chunk($snapshots, 300, true) as $chunk) {
            foreach ($chunk as $studentId => $snapshot) {
                $payload = $this->studentProfilePayloadFromSnapshot($snapshot, $year, $now);
                if ($payload === []) {
                    continue;
                }

                $affected = DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->where('role', 'siswa')
                    ->where('id', $studentId)
                    ->update($payload);
                $restored += (int) $affected;
            }
        }

        $outsidePeriod = $this->markStudentsMissingFromPeriodSnapshot($tenantId, $year, array_keys($snapshots), $now);

        return ['restored' => $restored, 'outside_period' => $outsidePeriod];
    }

    private function latestStudentSnapshotRowsForPeriod(string $tenantId, array $period, bool $includeProfileEvents): array
    {
        if (
            ! Schema::hasTable('student_class_histories')
            || ! Schema::hasColumn('student_class_histories', 'student_id')
            || ! Schema::hasColumn('student_class_histories', 'tahun_ajaran')
        ) {
            return [];
        }

        $year = AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        if (! $year) {
            return [];
        }

        $semester = AcademicPeriod::normalizeSemester($period['semester'] ?? null);
        $columns = $this->existingColumns('student_class_histories', [
            'student_id', 'class_id', 'class_name', 'grade', 'suffix', 'angkatan',
            'tahun_ajaran', 'semester', 'status', 'source', 'valid_from', 'created_at',
        ]);
        $query = $this->tenantQuery('student_class_histories', $tenantId)
            ->where('tahun_ajaran', $year);
        if ($semester && Schema::hasColumn('student_class_histories', 'semester')) {
            $query->where('semester', $semester);
        }
        if (Schema::hasColumn('student_class_histories', 'source')) {
            $query->whereIn(
                'source',
                $includeProfileEvents
                    ? $this->studentRosterSnapshotSources()
                    : $this->authoritativeClassSnapshotSources()
            );
        }

        $rows = $query->select($columns)
            ->orderBy('student_id')
            ->orderByDesc(Schema::hasColumn('student_class_histories', 'valid_from') ? 'valid_from' : 'created_at')
            ->get();

        $snapshots = [];
        foreach ($rows as $row) {
            $studentId = trim((string) ($row->student_id ?? ''));
            if ($studentId === '') {
                continue;
            }

            $timestamp = (string) ($row->valid_from ?? $row->created_at ?? '');
            $previous = $snapshots[$studentId] ?? null;
            if (
                $previous === null
                || strcmp($timestamp, $previous['timestamp']) > 0
            ) {
                $snapshots[$studentId] = [
                    'row' => $row,
                    'timestamp' => $timestamp,
                ];
            }
        }

        return array_map(fn ($snapshot) => $snapshot['row'], $snapshots);
    }

    private function studentProfilePayloadFromSnapshot(object $row, string $year, $timestamp): array
    {
        $classId = trim((string) ($row->class_id ?? ''));
        $status = $this->statusFromStudentClassSnapshot($row);
        $payload = [
            'kelas' => $classId,
            'status' => $status,
            'updated_at' => $timestamp,
        ];

        $angkatan = trim((string) ($row->angkatan ?? ''));
        if ($angkatan !== '') {
            $payload['angkatan'] = $angkatan;
        }

        if ($status === 'active') {
            $payload['disabled_at'] = null;
            $payload['alasan_nonaktif'] = null;
            $payload['tahun_lulus'] = null;
        } elseif ($status === 'alumni') {
            $payload['kelas'] = '';
            $payload['disabled_at'] = $timestamp;
            $payload['tahun_lulus'] = (int) substr($year, 0, 4);
            $payload['alasan_nonaktif'] = 'Status alumni mengikuti snapshot periode '.$year.'.';
        }

        return $this->filterExistingPayload('profiles', $payload);
    }

    private function statusFromStudentClassSnapshot(object $row): string
    {
        $classId = trim((string) ($row->class_id ?? ''));
        $status = strtolower(trim((string) ($row->status ?? '')));
        if (! in_array($status, ['active', 'nonaktif', 'mutasi', 'alumni'], true)) {
            $status = $classId !== '' ? 'active' : 'alumni';
        }

        return $status;
    }

    private function studentProfileNeedsSnapshotRestore(object $profile, object $snapshot, string $year): bool
    {
        $expected = $this->studentProfilePayloadFromSnapshot($snapshot, $year, now());
        foreach (['kelas', 'status', 'angkatan', 'tahun_lulus'] as $column) {
            if (! array_key_exists($column, $expected)) {
                continue;
            }
            if ((string) ($profile->{$column} ?? '') !== (string) ($expected[$column] ?? '')) {
                return true;
            }
        }

        $status = (string) ($expected['status'] ?? '');
        if ($status === 'active' && ($profile->disabled_at ?? null) !== null) {
            return true;
        }
        if ($status === 'alumni' && ($profile->disabled_at ?? null) === null) {
            return true;
        }

        return false;
    }

    private function markStudentsMissingFromPeriodSnapshot(string $tenantId, string $year, array $snapshotStudentIds, $timestamp): int
    {
        if (! Schema::hasTable('profiles')) {
            return 0;
        }

        $snapshotStudentIds = array_values(array_unique(array_filter(
            array_map(fn ($id) => trim((string) $id), $snapshotStudentIds),
            fn ($id) => $id !== ''
        )));
        if ($snapshotStudentIds === []) {
            return 0;
        }

        $payload = $this->filterExistingPayload('profiles', [
            'kelas' => '',
            'status' => 'nonaktif',
            'disabled_at' => $timestamp,
            'alasan_nonaktif' => 'Tidak tercatat pada snapshot periode '.$year.'.',
            'tahun_lulus' => null,
            'updated_at' => $timestamp,
        ]);
        if ($payload === []) {
            return 0;
        }

        $query = $this->studentsMissingFromPeriodSnapshotQuery($tenantId, $snapshotStudentIds);

        return (int) $query->update($payload);
    }

    private function countStudentsMissingFromPeriodSnapshot(string $tenantId, array $snapshotStudentIds): int
    {
        if (! Schema::hasTable('profiles')) {
            return 0;
        }

        $snapshotStudentIds = array_values(array_unique(array_filter(
            array_map(fn ($id) => trim((string) $id), $snapshotStudentIds),
            fn ($id) => $id !== ''
        )));
        if ($snapshotStudentIds === []) {
            return 0;
        }

        return (int) $this->studentsMissingFromPeriodSnapshotQuery($tenantId, $snapshotStudentIds)->count();
    }

    private function studentsMissingFromPeriodSnapshotQuery(string $tenantId, array $snapshotStudentIds)
    {
        return DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereNotIn('id', $snapshotStudentIds)
            ->where(function ($inner) {
                $inner->whereRaw('lower(coalesce(status, \'active\')) = ?', ['active'])
                    ->orWhere(function ($classQuery) {
                        $classQuery->whereNotNull('kelas')->where('kelas', '!=', '');
                    });
            });
    }

    private function authoritativeClassSnapshotSources(): array
    {
        return [
            'backfill',
            'before_period_change',
            'period_sync',
            'auto_rollover',
            'manual_rollover_completed',
            'period_snapshot_restore',
        ];
    }

    private function studentRosterSnapshotSources(): array
    {
        return array_values(array_unique(array_merge(
            $this->authoritativeClassSnapshotSources(),
            ['profile_create', 'profile_update']
        )));
    }

    private function snapshotStudentClassHistoriesForPeriod(string $tenantId, array $period, string $source): int
    {
        if (
            ! Schema::hasTable('student_class_histories')
            || ! Schema::hasTable('profiles')
            || ! Schema::hasTable('kelas')
        ) {
            return 0;
        }

        $classRows = $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', ['id', 'nama', 'grade', 'suffix', 'angkatan']))
            ->get()
            ->keyBy(fn ($row) => (string) ($row->id ?? ''));

        $studentRows = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->select($this->existingColumns('profiles', ['id', 'kelas', 'angkatan', 'status']))
            ->orderBy('kelas')
            ->orderBy('id')
            ->get();

        if ($studentRows->isEmpty()) {
            return 0;
        }

        $now = now();
        $inserted = 0;
        foreach ($studentRows->chunk(500) as $chunk) {
            $studentIds = $chunk->pluck('id')->filter()->map(fn ($id) => (string) $id)->values()->all();
            $existingKeys = $this->tenantQuery('student_class_histories', $tenantId)
                ->whereIn('student_id', $studentIds)
                ->where('tahun_ajaran', $period['tahun_ajaran'])
                ->where('semester', $period['semester'])
                ->whereNull('valid_until')
                ->select($this->existingColumns('student_class_histories', ['student_id', 'class_id', 'status', 'source']))
                ->get()
                ->mapWithKeys(fn ($row) => [
                    (string) ($row->student_id ?? '').'|'.
                    (string) ($row->class_id ?? '').'|'.
                    strtolower(trim((string) ($row->status ?? 'active'))).'|'.
                    strtolower(trim((string) ($row->source ?? 'system'))) => true,
                ]);

            $rowsToInsert = [];
            $studentsToClose = [];
            foreach ($chunk as $student) {
                $studentId = (string) ($student->id ?? '');
                $classId = (string) ($student->kelas ?? '');
                $studentStatus = strtolower(trim((string) ($student->status ?? 'active'))) ?: 'active';
                if ($studentId === '') {
                    continue;
                }

                if ($existingKeys->has($studentId.'|'.$classId.'|'.$studentStatus.'|'.strtolower($source))) {
                    continue;
                }

                $class = $classRows->get($classId);
                $studentsToClose[] = $studentId;
                $rowsToInsert[] = $this->filterExistingPayload('student_class_histories', [
                    'id' => (string) Str::uuid(),
                    'tenant_id' => $tenantId,
                    'student_id' => $studentId,
                    'class_id' => $classId,
                    'class_name' => $class->nama ?? $classId,
                    'grade' => $class ? $this->classGradeFromRow($class) : $this->parseClassGrade($classId),
                    'suffix' => $class ? $this->classSuffixFromRow($class, $this->classGradeFromRow($class)) : null,
                    'angkatan' => $student->angkatan ?? ($class->angkatan ?? null),
                    'tahun_ajaran' => $period['tahun_ajaran'],
                    'semester' => $period['semester'],
                    'status' => $student->status ?? 'active',
                    'source' => $source,
                    'note' => 'Snapshot otomatis periode akademik aktif.',
                    'valid_from' => $now,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            if ($rowsToInsert === []) {
                continue;
            }

            $this->tenantQuery('student_class_histories', $tenantId)
                ->whereIn('student_id', array_values(array_unique($studentsToClose)))
                ->whereNull('valid_until')
                ->update($this->filterExistingPayload('student_class_histories', [
                    'valid_until' => $now,
                    'updated_at' => $now,
                ]));

            DB::table('student_class_histories')->insert($rowsToInsert);
            $inserted += count($rowsToInsert);
        }

        return $inserted;
    }

    private function filterExistingPayload(string $table, array $payload): array
    {
        if (Schema::hasTable($table) === false) {
            return [];
        }

        return array_filter(
            $payload,
            fn ($value, $column) => Schema::hasColumn($table, (string) $column),
            ARRAY_FILTER_USE_BOTH
        );
    }

    private function isActiveClassRow(object $row): bool
    {
        if (property_exists($row, 'is_active') === false) {
            return true;
        }

        $value = $row->is_active;
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower(trim((string) $value)), ['0', 'false', 'no', 'inactive'], true) === false;
    }

    private function classGradeFromRow(object $row): string
    {
        $grade = $this->normalizeClassGrade($row->grade ?? '');
        if ($grade !== '') {
            return $grade;
        }

        return $this->parseClassGrade((string) ($row->nama ?? $row->id ?? ''));
    }

    private function classSuffixFromRow(object $row, string $grade): string
    {
        $suffix = trim((string) ($row->suffix ?? ''));
        if ($suffix === '') {
            $suffix = $this->stripClassGradePrefix((string) ($row->nama ?? $row->id ?? ''), $grade);
        }

        return strtoupper(trim((string) preg_replace('/\s+/', ' ', $suffix)));
    }

    private function normalizeClassGrade(string $value): string
    {
        $grade = strtoupper(trim((string) preg_replace('/\s+/', ' ', $value)));

        return in_array($grade, ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'], true) ? $grade : '';
    }

    private function parseClassGrade(string $value): string
    {
        $normalized = strtoupper(trim((string) preg_replace('/[\s_-]+/', ' ', $value)));
        if (preg_match('/^(XII|XI|X|IX|VIII|VII)\b/', $normalized, $matches)) {
            return $matches[1];
        }

        return '';
    }

    private function stripClassGradePrefix(string $value, string $grade): string
    {
        $normalized = strtoupper(trim((string) preg_replace('/[\s_-]+/', ' ', $value)));
        if ($grade !== '' && str_starts_with($normalized, $grade.' ')) {
            return trim(substr($normalized, strlen($grade) + 1));
        }

        return $normalized;
    }

    private function nextAcademicGrade(string $grade): ?string
    {
        return match ($grade) {
            'VII' => 'VIII',
            'VIII' => 'IX',
            'IX', 'XII' => 'ALUMNI',
            'X' => 'XI',
            'XI' => 'XII',
            default => null,
        };
    }

    private function cohortYearForGrade(string $grade, int $academicStartYear): string
    {
        $offset = match ($grade) {
            'VIII', 'XI' => -1,
            'IX', 'XII' => -2,
            default => 0,
        };

        return (string) ($academicStartYear + $offset);
    }

    private function firstTenantRow(string $table, string $tenantId): ?object
    {
        if (! Schema::hasTable($table)) {
            return null;
        }

        $query = DB::table($table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->orderBy(Schema::hasColumn($table, 'id') ? 'id' : 'created_at')->first();
    }

    private function tenantQuery(string $table, string $tenantId, ?string $alias = null)
    {
        $query = DB::table($alias ? "{$table} as {$alias}" : $table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where(($alias ? "{$alias}." : '').'tenant_id', $tenantId);
        }

        return $query;
    }

    private function activeAcademicYearForTenant(string $tenantId): string
    {
        $settings = $this->firstTenantRow('settings', $tenantId);

        return AcademicPeriod::normalizeAcademicYear($settings?->tahun_ajaran ?? null)
            ?: AcademicPeriod::current()['tahun_ajaran'];
    }

    private function canAccessScanFeature(Request $request, array $featureKeys = self::SCAN_FEATURE_KEYS): bool
    {
        return $this->isAdmin($request)
            || $this->hasAnyDelegatedAdminFeatureAccess($request, $featureKeys);
    }

    private function tenantTableCount(string $table, string $tenantId): int
    {
        if (! Schema::hasTable($table)) {
            return 0;
        }

        return (int) $this->tenantQuery($table, $tenantId)->count();
    }

    private function perPage(Request $request, int $default = 25): int
    {
        return max(1, min(100, (int) $request->query('per_page', $default)));
    }

    private function paginationMeta(int $page, int $perPage, int $total, bool $allRows = false): array
    {
        $pageCount = $allRows ? 1 : max(1, (int) ceil($total / max(1, $perPage)));
        $safePage = $allRows ? 1 : min(max(1, $page), $pageCount);
        $from = $total === 0 ? 0 : (($safePage - 1) * $perPage) + 1;
        $to = $total === 0 ? 0 : min($total, $from + $perPage - 1);

        return [
            'page' => $safePage,
            'per_page' => $perPage,
            'total' => $total,
            'page_count' => $pageCount,
            'from' => $from,
            'to' => $to,
            'all' => $allRows,
        ];
    }

    private function existingColumns(string $table, array $columns): array
    {
        if (! Schema::hasTable($table)) {
            return $columns;
        }

        $available = array_values(array_filter($columns, fn ($column) => Schema::hasColumn($table, $column)));

        return ! empty($available) ? $available : ['*'];
    }

    private function prefixedExistingColumns(string $table, array $columns, ?string $prefix = null): array
    {
        $prefix = $prefix ?: $table;

        return array_map(
            fn ($column) => $column === '*' ? "{$prefix}.*" : "{$prefix}.{$column}",
            $this->existingColumns($table, $columns)
        );
    }

    private function nullableAliasedColumn(string $table, string $alias, string $column, ?string $as = null)
    {
        $as = $as ?: $column;

        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, $column)) {
            return DB::raw("NULL as {$as}");
        }

        return $as === $column ? "{$alias}.{$column}" : "{$alias}.{$column} as {$as}";
    }

    private function presenceAggregateQuery(string $tenantId, $activeCutoff = null)
    {
        $activeCutoff = $activeCutoff ?: now()->subSeconds(120)->toDateTimeString();
        $query = DB::table('user_presence')
            ->select('user_id', DB::raw('max(last_seen_at) as last_seen_at'))
            ->selectRaw('sum(case when last_seen_at >= ? then 1 else 0 end) as active_devices', [$activeCutoff])
            ->selectRaw('sum(case when last_seen_at >= ? then activity_count else 0 end) as activity_count', [$activeCutoff])
            ->groupBy('user_id');

        if (Schema::hasColumn('user_presence', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query;
    }

    private function sortRowsByPresence($rows)
    {
        return $rows->sort(function (array $a, array $b) {
            $aOnline = (int) ($a['online'] ?? 0) > 0 || (int) ($a['active_devices'] ?? 0) > 0;
            $bOnline = (int) ($b['online'] ?? 0) > 0 || (int) ($b['active_devices'] ?? 0) > 0;

            if ($aOnline !== $bOnline) {
                return $aOnline ? -1 : 1;
            }

            $aSeen = (string) ($a['last_seen_at'] ?? '');
            $bSeen = (string) ($b['last_seen_at'] ?? '');
            if ($aSeen !== $bSeen) {
                return strcmp($bSeen, $aSeen);
            }

            return strcasecmp((string) ($a['nama'] ?? ''), (string) ($b['nama'] ?? ''));
        });
    }

    private function queryText(Request $request, string $key): string
    {
        return trim((string) $request->query($key, ''));
    }

    private function teacherClassIds(string $tenantId, string $teacherId): array
    {
        if ($teacherId === '' || ! Schema::hasTable('kelas_struktur')) {
            return [];
        }

        $activeYear = $this->activeAcademicYearForTenant($tenantId);

        return $this->tenantQuery('kelas_struktur', $tenantId)
            ->where('wali_guru_id', $teacherId)
            ->when($activeYear !== '' && Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $activeYear))
            ->pluck('kelas_id')
            ->filter()
            ->map(fn ($value) => (string) $value)
            ->values()
            ->all();
    }

    private function studentBaseQuery(string $tenantId, ?array $classIds = null)
    {
        $query = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa');

        if ($classIds !== null) {
            $query->whereIn('kelas', $classIds);
        }

        return $query;
    }

    private function applyStudentFilters($query, Request $request): void
    {
        $search = $this->queryText($request, 'q') ?: $this->queryText($request, 'nama');
        if ($search !== '') {
            $like = '%'.strtolower($search).'%';
            $query->where(function ($builder) use ($like) {
                $builder->whereRaw('lower(nama) like ?', [$like])
                    ->orWhereRaw('lower(email) like ?', [$like]);
            });
        }

        $nis = $this->queryText($request, 'nis');
        if ($nis !== '') {
            $query->whereRaw('lower(coalesce(nis, \'\')) like ?', ['%'.strtolower($nis).'%']);
        }

        $kelas = $this->queryText($request, 'kelas');
        if ($kelas !== '') {
            $query->where('kelas', $kelas);
        }

        $status = $this->queryText($request, 'status');
        if ($status !== '') {
            $query->whereRaw('lower(coalesce(status, \'active\')) = ?', [strtolower($status)]);
        }

        $hasRfid = $this->queryText($request, 'has_rfid');
        if ($hasRfid !== '') {
            $truthy = in_array(strtolower($hasRfid), ['1', 'true', 'yes', 'ada', 'rfid'], true);
            if ($truthy) {
                $query->whereNotNull('rfid_uid')->where('rfid_uid', '<>', '');
            } else {
                $query->where(function ($builder) {
                    $builder->whereNull('rfid_uid')->orWhere('rfid_uid', '');
                });
            }
        }
    }

    private function studentOrganizationMemberships(string $tenantId, string $studentId): array
    {
        if (! Schema::hasTable('organisasi_anggota') || ! Schema::hasColumn('organisasi_anggota', 'siswa_id')) {
            return [];
        }

        $query = $this->tenantQuery('organisasi_anggota', $tenantId, 'oa')
            ->where('oa.siswa_id', $studentId);

        $hasOrganizationJoin =
            Schema::hasTable('organisasi') &&
            Schema::hasColumn('organisasi_anggota', 'organisasi_id') &&
            Schema::hasColumn('organisasi', 'id');

        if ($hasOrganizationJoin) {
            $query->leftJoin('organisasi as o', function ($join) {
                $join->on('o.id', '=', 'oa.organisasi_id');
                if (Schema::hasColumn('organisasi', 'tenant_id') && Schema::hasColumn('organisasi_anggota', 'tenant_id')) {
                    $join->on('o.tenant_id', '=', 'oa.tenant_id');
                }
            });
        }

        $selects = [];
        $selects[] = Schema::hasColumn('organisasi_anggota', 'organisasi_id')
            ? 'oa.organisasi_id'
            : DB::raw('null as organisasi_id');
        $selects[] = Schema::hasColumn('organisasi_anggota', 'status')
            ? 'oa.status'
            : DB::raw("'aktif' as status");
        $selects[] = Schema::hasColumn('organisasi_anggota', 'bagian')
            ? 'oa.bagian'
            : DB::raw("'' as bagian");
        $selects[] = Schema::hasColumn('organisasi_anggota', 'jabatan')
            ? 'oa.jabatan'
            : DB::raw("'Anggota' as jabatan");
        $selects[] = $hasOrganizationJoin && Schema::hasColumn('organisasi', 'nama')
            ? DB::raw('o.nama as org_nama')
            : DB::raw('null as org_nama');

        if (Schema::hasColumn('organisasi_anggota', 'organisasi_id')) {
            $query->orderBy('oa.organisasi_id');
        }

        return $query
            ->select($selects)
            ->get()
            ->map(fn ($member) => [
                'orgId' => $member->organisasi_id ?? null,
                'orgNama' => $member->org_nama ?: ($member->organisasi_id ?? 'Organisasi'),
                'status' => $member->status ?: 'aktif',
                'bagian' => $member->bagian ?: '',
                'jabatan' => $member->jabatan ?: 'Anggota',
            ])
            ->values()
            ->all();
    }

    private function studentOsisMembership(string $tenantId, string $studentId): ?array
    {
        if (! Schema::hasTable('osis_anggota') || ! Schema::hasColumn('osis_anggota', 'siswa_id')) {
            return null;
        }

        $query = $this->tenantQuery('osis_anggota', $tenantId)
            ->where('siswa_id', $studentId);

        $selects = [];
        $selects[] = Schema::hasColumn('osis_anggota', 'status')
            ? 'status'
            : DB::raw("'aktif' as status");
        $selects[] = Schema::hasColumn('osis_anggota', 'bagian')
            ? 'bagian'
            : DB::raw("'' as bagian");
        $selects[] = Schema::hasColumn('osis_anggota', 'jabatan')
            ? 'jabatan'
            : DB::raw("'Anggota' as jabatan");

        $row = $query->select($selects)->first();
        if (! $row) {
            return null;
        }

        return [
            'status' => $row->status ?: 'aktif',
            'bagian' => $row->bagian ?: '',
            'jabatan' => $row->jabatan ?: 'Anggota',
        ];
    }

    private function studentStats(string $tenantId, ?array $classIds = null): array
    {
        $base = $this->studentBaseQuery($tenantId, $classIds);
        $statusCounts = (clone $base)
            ->selectRaw("coalesce(status, 'active') as status_key, count(*) as aggregate")
            ->groupBy('status_key')
            ->pluck('aggregate', 'status_key');

        $total = (int) $statusCounts->sum();
        $active = (int) ($statusCounts['active'] ?? 0);
        $activeYear = $this->activeAcademicYearForTenant($tenantId);
        $struktur = $this->tenantQuery('kelas_struktur', $tenantId)
            ->when($classIds !== null, fn ($builder) => $builder->whereIn('kelas_id', $classIds))
            ->when($activeYear !== '' && Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $activeYear))
            ->whereNotNull('ketua_siswa_id')
            ->where('ketua_siswa_id', '<>', '');

        return [
            'totalSiswa' => $total,
            'aktifSiswa' => $active,
            'nonaktifSiswa' => max(0, $total - $active),
            'nonaktifOnly' => (int) ($statusCounts['nonaktif'] ?? 0),
            'mutasiSiswa' => (int) ($statusCounts['mutasi'] ?? 0),
            'alumniSiswa' => (int) ($statusCounts['alumni'] ?? 0),
            'ketuaKelas' => Schema::hasTable('kelas_struktur') ? (int) $struktur->count() : 0,
        ];
    }

    private function emptyStudentStats(): array
    {
        return [
            'totalSiswa' => 0,
            'aktifSiswa' => 0,
            'nonaktifSiswa' => 0,
            'nonaktifOnly' => 0,
            'mutasiSiswa' => 0,
            'alumniSiswa' => 0,
            'ketuaKelas' => 0,
        ];
    }

    private function normalizeStudentImportPayloadRow(string $tenantId, array $row, int $rowNumber): array
    {
        $nama = preg_replace('/\s+/', ' ', trim((string) ($row['nama'] ?? ''))) ?? '';
        if ($nama === '') {
            return ['message' => 'Nama siswa wajib diisi'];
        }
        if (mb_strlen($nama) > 120) {
            return ['message' => 'Nama siswa terlalu panjang'];
        }

        $nis = $this->normalizeIdentifierCode($row['nis'] ?? '');
        $email = strtolower(trim((string) ($row['email'] ?? '')));
        if ($email !== '' && ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return ['message' => 'Format email tidak valid'];
        }
        if ($nis === '' && $email === '') {
            return ['message' => 'NIS atau email wajib diisi'];
        }

        $classResult = $this->resolveStudentImportClass($tenantId, $row['kelas'] ?? $row['kelas_id'] ?? null);
        if (($classResult['id'] ?? '') === '') {
            return ['message' => 'Kelas tidak ditemukan'];
        }

        $status = $this->normalizeStudentImportStatus($row['status'] ?? null);
        $tanggalLahir = $this->normalizeStudentImportDate($row['tanggal_lahir'] ?? null);
        $optional = [];
        foreach (['agama', 'alamat', 'telp', 'no_hp_siswa', 'no_hp_wali'] as $key) {
            $value = $this->nullableString($row[$key] ?? null);
            if ($value !== null) {
                $optional[$key] = $value;
            }
        }

        $gender = $this->normalizeGenderValue($row['jk'] ?? null);
        if ($gender !== null) {
            $optional['jk'] = $gender;
        }
        if ($tanggalLahir !== null) {
            $optional['tanggal_lahir'] = $tanggalLahir;
            $optional['usia'] = $this->calculateAgeFromBirthDate($tanggalLahir);
        }

        $passwordSeed = trim((string) ($row['password'] ?? ''));
        if ($passwordSeed === '') {
            $passwordSeed = $this->buildBirthDatePasswordSeed($tanggalLahir) ?: $nis;
        }

        return [
            'data' => [
                'row' => $rowNumber,
                'nama' => $nama,
                'nis' => $nis,
                'email' => $email,
                'kelas' => $classResult['id'],
                'kelas_label' => $classResult['label'] ?? $classResult['id'],
                'status' => $status,
                'password' => $this->normalizeProvisionPassword($passwordSeed),
                'optional' => $optional,
            ],
        ];
    }

    private function resolveStudentImportClass(string $tenantId, mixed $value): array
    {
        $raw = preg_replace('/\s+/', ' ', trim((string) ($value ?? ''))) ?? '';
        if ($raw === '') {
            return ['id' => '', 'label' => ''];
        }

        if (! Schema::hasTable('kelas')) {
            return ['id' => $raw, 'label' => $raw];
        }

        $query = DB::table('kelas')->where(function ($builder) use ($raw) {
            $builder->where('id', $raw);
            if (Schema::hasColumn('kelas', 'nama')) {
                $builder->orWhereRaw('lower(nama) = ?', [strtolower($raw)]);
            }
        });
        if (Schema::hasColumn('kelas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first($this->existingColumns('kelas', ['id', 'nama']));
        if (! $row) {
            return ['id' => '', 'label' => ''];
        }

        return [
            'id' => (string) ($row->id ?? ''),
            'label' => (string) (property_exists($row, 'nama') ? ($row->nama ?? $row->id ?? '') : ($row->id ?? '')),
        ];
    }

    private function normalizeStudentImportStatus(mixed $value): string
    {
        $normalized = strtolower(trim((string) ($value ?? '')));
        $normalized = str_replace([' ', '-'], '_', $normalized);

        return match ($normalized) {
            'nonaktif', 'non_aktif', 'inactive', 'disabled' => 'nonaktif',
            'mutasi', 'pindah' => 'mutasi',
            'alumni', 'lulus' => 'alumni',
            default => 'active',
        };
    }

    private function normalizeStudentImportDate(mixed $value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        try {
            return Carbon::parse($raw)->toDateString();
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function loadStudentImportExistingProfiles(string $tenantId, array $nisValues, array $emailValues): array
    {
        $nisKeys = array_values(array_unique(array_filter(array_map(fn ($value) => strtolower($this->normalizeIdentifierCode($value)), $nisValues))));
        $emailKeys = array_values(array_unique(array_filter(array_map(fn ($value) => strtolower(trim((string) $value)), $emailValues))));
        $byNis = [];
        $byEmail = [];

        if (empty($nisKeys) && empty($emailKeys)) {
            return ['by_nis' => $byNis, 'by_email' => $byEmail];
        }

        $rows = Profile::query()
            ->where('tenant_id', $tenantId)
            ->where(function ($builder) use ($nisKeys, $emailKeys) {
                if (! empty($nisKeys)) {
                    $builder->orWhereIn(DB::raw('lower(nis)'), $nisKeys);
                }
                if (! empty($emailKeys)) {
                    $builder->orWhereIn(DB::raw('lower(email)'), $emailKeys);
                }
            })
            ->get(['id', 'tenant_id', 'email', 'nis', 'nama', 'role', 'created_via', 'must_change_password']);

        foreach ($rows as $row) {
            $data = (array) $row->getAttributes();
            $nisKey = strtolower(trim((string) ($data['nis'] ?? '')));
            $emailKey = strtolower(trim((string) ($data['email'] ?? '')));
            if ($nisKey !== '') {
                $byNis[$nisKey] = $data;
            }
            if ($emailKey !== '') {
                $byEmail[$emailKey] = $data;
            }
        }

        return ['by_nis' => $byNis, 'by_email' => $byEmail];
    }

    private function loadStudentImportExistingUsers(array $emailValues): array
    {
        $emailKeys = array_values(array_unique(array_filter(array_map(fn ($value) => strtolower(trim((string) $value)), $emailValues))));
        if (empty($emailKeys)) {
            return [];
        }

        return User::query()
            ->whereIn(DB::raw('lower(email)'), $emailKeys)
            ->get(['id', 'email'])
            ->mapWithKeys(fn (User $user) => [strtolower((string) $user->email) => ['id' => (string) $user->id, 'email' => (string) $user->email]])
            ->all();
    }

    private function upsertStudentImportRow(
        Request $request,
        string $tenantId,
        array $row,
        array $profilesByNis,
        array $profilesByEmail,
        array $usersByEmail,
        Carbon $now
    ): array {
        $nis = (string) ($row['nis'] ?? '');
        $email = strtolower(trim((string) ($row['email'] ?? '')));
        $nisKey = strtolower($nis);
        $emailKey = $email;
        $byNis = $nisKey !== '' ? ($profilesByNis[$nisKey] ?? null) : null;
        $byEmail = $emailKey !== '' ? ($profilesByEmail[$emailKey] ?? null) : null;

        if ($byNis && $byEmail && (string) ($byNis['id'] ?? '') !== (string) ($byEmail['id'] ?? '')) {
            throw new \RuntimeException('NIS dan email sudah dipakai oleh akun berbeda');
        }

        $existing = $byNis ?: $byEmail;
        if ($existing && ! in_array(strtolower((string) ($existing['role'] ?? '')), ['siswa'], true)) {
            throw new \RuntimeException('NIS/email sudah digunakan untuk role lain');
        }

        if ($email === '') {
            $email = $existing ? strtolower((string) ($existing['email'] ?? '')) : $this->buildImportPlaceholderEmail($nis, $tenantId);
            $emailKey = strtolower($email);
        }

        $existingUser = $usersByEmail[$emailKey] ?? null;
        $existingId = $existing ? (string) ($existing['id'] ?? '') : '';
        if ($existingUser && (string) ($existingUser['id'] ?? '') !== $existingId) {
            throw new \RuntimeException('Email sudah terdaftar pada akun lain');
        }

        $profilePayload = [
            'email' => $email,
            'nama' => $row['nama'],
            'role' => 'siswa',
            'kelas' => $row['kelas'],
            'status' => $row['status'],
            'updated_at' => $now,
        ];
        if ($nis !== '') {
            $profilePayload['nis'] = $nis;
        }

        foreach (($row['optional'] ?? []) as $key => $value) {
            $profilePayload[$key] = $value;
        }

        if (Schema::hasColumn('profiles', 'angkatan')) {
            $profilePayload['angkatan'] = $this->resolveCohortForClass($tenantId, $row['kelas']);
        }

        if ($existingId !== '') {
            $profile = Profile::query()
                ->where('tenant_id', $tenantId)
                ->where('id', $existingId)
                ->first();
            if (! $profile) {
                throw new \RuntimeException('Profil siswa tidak ditemukan');
            }

            if (Schema::hasColumn('profiles', 'created_via') && trim((string) ($profile->created_via ?? '')) === '') {
                $profilePayload['created_via'] = 'import';
            }
            if (Schema::hasColumn('profiles', 'created_by') && trim((string) ($profile->created_by ?? '')) === '') {
                $profilePayload['created_by'] = (string) ($request->user()?->id ?? '');
            }

            $profile->forceFill($profilePayload)->save();

            $user = User::query()->where('id', $existingId)->first();
            if ($user) {
                $user->forceFill([
                    'name' => $row['nama'],
                    'email' => $email,
                ])->save();
            } else {
                User::query()->create([
                    'id' => $existingId,
                    'name' => $row['nama'],
                    'email' => $email,
                    'password' => $row['password'],
                ]);
            }

            if (array_key_exists('tanggal_lahir', $profilePayload)) {
                $this->syncImportedInitialProfilePassword($tenantId, $existingId, $now);
            }

            return ['status' => 'updated', 'profile_id' => $existingId];
        }

        $profileId = (string) Str::uuid();
        User::query()->create([
            'id' => $profileId,
            'name' => $row['nama'],
            'email' => $email,
            'password' => $row['password'],
        ]);

        $profilePayload['id'] = $profileId;
        $profilePayload['tenant_id'] = $tenantId;
        $profilePayload['must_change_password'] = true;
        $profilePayload['created_at'] = $now;
        if (Schema::hasColumn('profiles', 'created_via')) {
            $profilePayload['created_via'] = 'import';
        }
        if (Schema::hasColumn('profiles', 'created_by')) {
            $profilePayload['created_by'] = (string) ($request->user()?->id ?? '');
        }

        Profile::query()->create($profilePayload);

        return ['status' => 'created', 'profile_id' => $profileId];
    }

    private function addStudentImportFailure(array &$summary, array &$historyItems, int $rowNumber, string $reason, ?array $row, Carbon $now): void
    {
        $summary['failed'] += 1;
        $summary['errors'][] = [
            'row' => $rowNumber,
            'reason' => $reason,
        ];
        $historyItems[] = [
            'profile_id' => null,
            'status' => 'failed',
            'created_user' => false,
            'nis' => isset($row['nis']) ? $this->normalizeIdentifierCode($row['nis']) : null,
            'nama' => isset($row['nama']) ? trim((string) $row['nama']) : null,
            'kelas' => isset($row['kelas']) ? trim((string) $row['kelas']) : ($row['kelas_label'] ?? null),
            'error_message' => $reason,
            'imported_at' => $now,
        ];
    }

    private function storeStudentImportHistory(
        string $tenantId,
        string $adminId,
        string $source,
        mixed $fileName,
        mixed $sheetUrl,
        int $totalRows,
        array $summary,
        array $items,
        Carbon $now
    ): ?string {
        if (! Schema::hasTable('import_siswa_histories') || ! Schema::hasTable('import_siswa_history_items')) {
            return null;
        }

        $historyId = (string) Str::uuid();
        DB::table('import_siswa_histories')->insert([
            'id' => $historyId,
            'tenant_id' => $tenantId,
            'admin_id' => $adminId !== '' ? $adminId : null,
            'source' => $source,
            'file_name' => $source === 'file' ? $this->nullableString($fileName) : null,
            'sheet_url' => $source === 'sheet' ? $this->nullableString($sheetUrl) : null,
            'status' => 'pending',
            'total_rows' => $totalRows,
            'success_rows' => (int) ($summary['created'] + $summary['updated'] + $summary['skipped']),
            'created_rows' => (int) $summary['created'],
            'updated_rows' => (int) $summary['updated'],
            'skipped_rows' => (int) $summary['skipped'],
            'failed_rows' => (int) $summary['failed'],
            'saved_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $payload = array_map(fn (array $item) => [
            'history_id' => $historyId,
            'tenant_id' => $tenantId,
            'profile_id' => $item['profile_id'] ?? null,
            'status' => $item['status'] ?? 'failed',
            'created_user' => (bool) ($item['created_user'] ?? false),
            'nis' => $item['nis'] ?? null,
            'nama' => $item['nama'] ?? null,
            'kelas' => $item['kelas'] ?? null,
            'error_message' => $item['error_message'] ?? null,
            'imported_at' => $item['imported_at'] ?? $now,
            'created_at' => $now,
            'updated_at' => $now,
        ], $items);

        foreach (array_chunk($payload, 500) as $chunk) {
            if (! empty($chunk)) {
                DB::table('import_siswa_history_items')->insert($chunk);
            }
        }

        return $historyId;
    }

    private function filterTeacherRows($teachers, Request $request)
    {
        $search = strtolower($this->queryText($request, 'q'));
        $mapel = strtolower($this->queryText($request, 'mapel'));
        $jabatan = strtolower($this->queryText($request, 'jabatan'));
        $status = strtolower($this->queryText($request, 'status'));

        return $teachers->filter(function (array $teacher) use ($search, $mapel, $jabatan, $status) {
            if ($search !== '') {
                $haystack = strtolower(implode(' ', array_filter([
                    $teacher['nama'] ?? '',
                    $teacher['email'] ?? '',
                    $teacher['nis'] ?? '',
                    implode(' ', $teacher['mapelList'] ?? []),
                    implode(' ', $teacher['kelasList'] ?? []),
                    implode(' ', $teacher['jabatanList'] ?? []),
                ])));
                if (! str_contains($haystack, $search)) {
                    return false;
                }
            }

            if ($mapel !== '' && ! $this->arrayContainsText($teacher['mapelList'] ?? [], $mapel)) {
                return false;
            }

            if ($jabatan !== '' && ! $this->arrayContainsText($teacher['jabatanList'] ?? [], $jabatan)) {
                return false;
            }

            if ($status !== '') {
                $teacherStatus = strtolower(trim((string) ($teacher['status'] ?? 'active'))) ?: 'active';
                if ($teacherStatus !== $status) {
                    return false;
                }
            }

            return true;
        });
    }

    private function arrayContainsText(array $values, string $needle): bool
    {
        foreach ($values as $value) {
            if (strtolower(trim((string) $value)) === $needle) {
                return true;
            }
        }

        return false;
    }

    private function indonesianDayName(Carbon $date): string
    {
        return match ((int) $date->dayOfWeekIso) {
            1 => 'Senin',
            2 => 'Selasa',
            3 => 'Rabu',
            4 => 'Kamis',
            5 => 'Jumat',
            6 => 'Sabtu',
            default => 'Minggu',
        };
    }

    public function sendCertificateEmail(Request $request, string $id)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $certificate = DB::table('certificates')->where('id', $id)->first();
        if (! $certificate) {
            return response()->json(['success' => false, 'message' => 'Sertifikat tidak ditemukan.'], 404);
        }

        if (! $certificate->user_id) {
            DB::table('certificates')->where('id', $id)->update([
                'email_sent' => false,
                'email_error' => 'Data profil (user_id) tidak valid.',
            ]);

            return response()->json(['success' => false, 'message' => 'Sertifikat tidak terkait dengan profil valid.'], 400);
        }

        $user = User::find($certificate->user_id);
        if (! $user) {
            DB::table('certificates')->where('id', $id)->update([
                'email_sent' => false,
                'email_error' => 'Data akun tidak ditemukan.',
            ]);

            return response()->json(['success' => false, 'message' => 'Data akun (user) tidak ditemukan.'], 400);
        }

        if (! $user->email_verified_at) {
            DB::table('certificates')->where('id', $id)->update([
                'email_sent' => false,
                'email_error' => 'Email belum terverifikasi.',
            ]);

            return response()->json(['success' => false, 'message' => 'Email pengguna belum terverifikasi.'], 400);
        }

        try {
            // Kita harus dapatkan URL download. Misal pakai temporaryUrl dari disk S3 (Supabase)
            // Atau public url jika bucket public.
            // Dari frontend menggunakan createSignedUrl dengan expiresIn 31536000
            $downloadUrl = Storage::disk('s3')->temporaryUrl(
                $certificate->file_url,
                now()->addDays(7) // berlaku 7 hari
            );

            $schoolName = DB::table('settings')->value('nama_sekolah') ?: config('app.name');

            Mail::to($user->email)->send(new SertifikatMail($certificate, $user->name ?: $certificate->nama_penerima, $downloadUrl, $schoolName));

            DB::table('certificates')->where('id', $id)->update([
                'email_sent' => true,
                'email_error' => null,
            ]);

            return response()->json(['success' => true, 'message' => 'Email sertifikat berhasil dikirim!']);

        } catch (\Exception $e) {
            DB::table('certificates')->where('id', $id)->update([
                'email_sent' => false,
                'email_error' => 'Gagal mengirim email: '.$e->getMessage(),
            ]);

            return response()->json(['success' => false, 'message' => 'Terjadi kesalahan sistem saat mengirim email: '.$e->getMessage()], 500);
        }
    }
}
