<?php

namespace App\Http\Controllers\Api;

use App\Models\Profile;
use App\Models\User;
use App\Services\GoogleDrive\GoogleDriveService;
use App\Services\Rfid\RfidDeviceService;
use App\Services\Rfid\TenantMqttConfigService;
use App\Support\Tenancy\TenantDomainService;
use App\Traits\HasTenantRestoreLogic;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;

class SuperAdminController extends ApiController
{
    use HasTenantRestoreLogic;

    private array $tableExistenceCache = [];

    private array $tableColumnExistenceCache = [];

    private const BACKUP_MODE_STUDENTS = 'students';

    private const BACKUP_MODE_TEACHERS = 'teachers';

    private const BACKUP_MODE_FULL = 'full';

    private const TENANT_STATUS_ACTIVE = 'active';

    private const TENANT_STATUS_SUSPENDED = 'suspended';

    private const TENANT_STATUS_ARCHIVED = 'archived';

    private const MONITORED_STORAGE_BUCKETS = [
        'profile-photos',
        'assignments',
        'certificates',
        'sertifikat-files',
        'certificate-templates',
        'sertifikat-templates',
    ];

    private const BACKUP_TABLE_ORDER = [
        'settings',
        'profiles',
        'admin_users',
        'kelas',
        'mata_pelajaran',
        'guru_mapel_bobot',
        'struktur_sekolah',
        'kelas_struktur',
        'jadwal',
        'pengumuman',
        'ekskul',
        'ekskul_anggota',
        'organisasi',
        'organisasi_anggota',
        'osis_anggota',
        'absensi_settings',
        'absensi_rfid_settings',
        'absensi',
        'absensi_ajuan',
        'absensi_eskul',
        'absensi_scan_temp',
        'rfid_scans',
        'jam_kosong',
        'tugas',
        'tugas_jawaban',
        'quizzes',
        'quiz_questions',
        'quiz_options',
        'quiz_submissions',
        'quiz_answers',
        'quiz_retake_logs',
        'certificates',
        'templat_sertifikat_publik',
        'printed_cards',
        'allowed_registrations',
        'registration_otps',
        'audit_log',
        'approval_requests',
        'anggota_eksku1',
        'anggota_ekskul',
        'import_siswa_histories',
        'import_siswa_history_items',
        'import_guru_histories',
        'import_guru_history_items',
    ];

    public function __construct(
        private readonly TenantDomainService $tenantDomainService,
        private readonly RfidDeviceService $rfidDeviceService,
        private readonly TenantMqttConfigService $tenantMqttConfigService,
        private readonly GoogleDriveService $googleDriveService
    ) {}

    public function me(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        return $this->ok(['is_super_admin' => true]);
    }

    public function index(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $query = DB::table('tenants')
            ->select('id', 'name', 'slug', 'status', 'created_at', 'updated_at')
            ->orderBy('created_at', 'desc');

        foreach (['status_reason', 'status_changed_at', 'status_changed_by', 'archived_at'] as $column) {
            if ($this->tableHasColumn('tenants', $column)) {
                $query->addSelect($column);
            } else {
                $query->addSelect(DB::raw("null as {$column}"));
            }
        }

        $this->applyPagination($query, $request);

        $tenants = $query->get();

        return $this->ok($tenants);
    }

    public function showTenant(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->findTenantByIdOrSlug($id);

        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $stats = DB::table('profiles')
            ->where('tenant_id', $tenant->id)
            ->selectRaw('count(*) as total_users')
            ->selectRaw("sum(case when role = 'siswa' then 1 else 0 end) as total_siswa")
            ->selectRaw("sum(case when role in ('guru', 'teacher') then 1 else 0 end) as total_guru")
            ->selectRaw("sum(case when role = 'admin' then 1 else 0 end) as total_admin")
            ->selectRaw("sum(case when status = 'active' then 1 else 0 end) as total_aktif")
            ->selectRaw("sum(case when status = 'nonaktif' then 1 else 0 end) as total_nonaktif")
            ->first();

        $activeCutoff = now()->subSeconds(120)->toDateTimeString();
        $onlineUsers = DB::table('user_presence')
            ->where('tenant_id', $tenant->id)
            ->whereNotNull('last_seen_at')
            ->where('last_seen_at', '>=', $activeCutoff)
            ->distinct()
            ->count('user_id');

        $lastActivity = DB::table('user_presence')
            ->where('tenant_id', $tenant->id)
            ->max('last_seen_at');

        $presenceAgg = DB::table('user_presence')
            ->select('user_id', DB::raw('max(last_seen_at) as last_seen_at'))
            ->where('tenant_id', $tenant->id)
            ->groupBy('user_id');

        $primaryAdminUserId = $this->resolveTenantPrimaryAdminUserId((string) $tenant->id);

        $admins = DB::table('profiles as p')
            ->leftJoin('users as u', 'u.id', '=', 'p.id')
            ->leftJoin('super_admins as sa', 'sa.user_id', '=', 'p.id')
            ->leftJoinSub($presenceAgg, 'pr', function ($join) {
                $join->on('pr.user_id', '=', 'p.id');
            })
            ->where('p.tenant_id', $tenant->id)
            ->where('p.role', 'admin')
            ->select(
                'p.id as user_id',
                'p.nama as name',
                'p.email',
                'p.status',
                'p.created_at',
                'p.updated_at',
                'pr.last_seen_at',
                'u.email_verified_at',
                DB::raw('case when sa.user_id is not null then true else false end as is_super_admin')
            )
            ->orderBy('p.created_at', 'desc')
            ->get()
            ->map(function ($row) use ($primaryAdminUserId) {
                $row->is_primary_admin = $primaryAdminUserId !== ''
                    && (string) ($row->user_id ?? '') === $primaryAdminUserId;

                return $row;
            })
            ->values();

        $primaryAdmin = $admins->first(function ($row) use ($primaryAdminUserId) {
            return $primaryAdminUserId !== '' && (string) ($row->user_id ?? '') === $primaryAdminUserId;
        });

        $domains = $this->tenantDomainService->listTenantDomains((string) $tenant->id);
        $rfidMqttConfig = $this->tenantMqttConfigService->tenantConfig(
            (string) $tenant->id,
            (string) $tenant->slug,
            false
        );
        $rfidTemplate = $this->buildTenantRfidTemplate($tenant);

        return response()->json([
            'data' => [
                'tenant' => [
                    'id' => $tenant->id,
                    'name' => $tenant->name,
                    'slug' => $tenant->slug,
                    'status' => $tenant->status,
                    'status_reason' => $tenant->status_reason ?? null,
                    'status_changed_at' => $tenant->status_changed_at ?? null,
                    'status_changed_by' => $tenant->status_changed_by ?? null,
                    'archived_at' => $tenant->archived_at ?? null,
                    'primary_admin_user_id' => $primaryAdminUserId !== '' ? $primaryAdminUserId : null,
                    'primary_admin_name' => $primaryAdmin?->name ?? null,
                    'primary_admin_email' => $primaryAdmin?->email ?? null,
                    'created_at' => $tenant->created_at,
                    'updated_at' => $tenant->updated_at,
                ],
                'access' => [
                    'default_host' => $this->tenantDomainService->defaultTenantHost((string) $tenant->slug),
                    'default_url' => $this->tenantDomainService->defaultTenantUrl((string) $tenant->slug),
                    'custom_domain_count' => count($domains),
                ],
                'stats' => [
                    'total_users' => (int) ($stats->total_users ?? 0),
                    'total_siswa' => (int) ($stats->total_siswa ?? 0),
                    'total_guru' => (int) ($stats->total_guru ?? 0),
                    'total_admin' => (int) ($stats->total_admin ?? 0),
                    'total_aktif' => (int) ($stats->total_aktif ?? 0),
                    'total_nonaktif' => (int) ($stats->total_nonaktif ?? 0),
                    'online_users' => (int) $onlineUsers,
                    'last_activity_at' => $lastActivity,
                ],
                'admins' => $admins,
                'domains' => $domains,
                'rfid_mqtt_config' => $this->tenantMqttConfigService->publicConfig($rfidMqttConfig),
                'rfid_template' => $rfidTemplate,
                'password_security' => [
                    'can_view_existing_password' => false,
                    'note' => 'Password lama tidak bisa ditampilkan karena disimpan dalam hash.',
                ],
            ],
        ]);
    }

    public function platformDomains(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        return $this->ok([
            'platform' => $this->tenantDomainService->platformOverview(),
            'admin_domains' => $this->tenantDomainService->listAdminDomains(),
        ]);
    }

    public function storePlatformDomain(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $validator = Validator::make($request->all(), $this->domainRules());
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        try {
            $domain = $this->tenantDomainService->createAdminDomain($validator->validated());
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $this->logAudit($request, 'tenant_domains', (string) ($domain['id'] ?? ''), 'INSERT', null, $domain, null);

        return response()->json(['data' => $domain], 201);
    }

    public function storeTenantDomain(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->findTenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $validator = Validator::make($request->all(), $this->domainRules());
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        try {
            $domain = $this->tenantDomainService->createTenantDomain((string) $tenant->id, $validator->validated());
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $this->logAudit(
            $request,
            'tenant_domains',
            (string) ($domain['id'] ?? ''),
            'INSERT',
            null,
            $domain,
            (string) $tenant->id
        );

        return response()->json(['data' => $domain], 201);
    }

    public function updateTenantRfidMqtt(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->findTenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $validator = Validator::make($request->all(), [
            'enabled' => ['nullable', 'boolean'],
            'provider' => ['nullable', 'string', 'in:custom,mosquitto'],
            'managed_by_platform' => ['nullable', 'boolean'],
            'host' => ['required', 'string', 'max:191'],
            'port' => ['required', 'integer', 'min:1', 'max:65535'],
            'runtime_host' => ['nullable', 'string', 'max:191'],
            'runtime_port' => ['nullable', 'integer', 'min:1', 'max:65535'],
            'runtime_use_tls' => ['nullable', 'boolean'],
            'username' => ['nullable', 'string', 'max:191'],
            'password' => ['nullable', 'string', 'max:512'],
            'clear_password' => ['nullable', 'boolean'],
            'use_tls' => ['nullable', 'boolean'],
            'tls_verify_peer' => ['nullable', 'boolean'],
            'tls_verify_peer_name' => ['nullable', 'boolean'],
            'tls_allow_self_signed' => ['nullable', 'boolean'],
            'qos' => ['nullable', 'integer', 'min:0', 'max:2'],
            'client_id_prefix' => ['nullable', 'string', 'max:120'],
            'scan_topic_template' => ['nullable', 'string', 'max:191'],
            'response_topic_template' => ['nullable', 'string', 'max:191'],
            'mode_topic_template' => ['nullable', 'string', 'max:191'],
            'connect_timeout' => ['nullable', 'integer', 'min:3', 'max:120'],
            'socket_timeout' => ['nullable', 'integer', 'min:1', 'max:60'],
            'keep_alive' => ['nullable', 'integer', 'min:3', 'max:300'],
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $payload = $validator->validated();
        $oldConfig = $this->tenantMqttConfigService->publicConfig(
            $this->tenantMqttConfigService->tenantConfig((string) $tenant->id, (string) $tenant->slug, false)
        );

        try {
            $saved = $this->tenantMqttConfigService->saveTenantConfig(
                (string) $tenant->id,
                (string) $tenant->slug,
                $payload,
                (string) ($request->user()?->id ?? '')
            );
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
        $publicSaved = $this->tenantMqttConfigService->publicConfig($saved);
        $syncResult = null;
        if (($saved['provider'] ?? '') === 'mosquitto' && (bool) ($saved['managed_by_platform'] ?? false)) {
            try {
                $syncResult = $this->tenantMqttConfigService->syncManagedMosquittoFiles();
            } catch (\RuntimeException $e) {
                return response()->json(['error' => $e->getMessage()], 422);
            }
        }

        $this->logAudit(
            $request,
            'tenant_mqtt_configs',
            (string) $tenant->id,
            'UPDATE',
            $oldConfig,
            $publicSaved,
            (string) $tenant->id
        );

        return response()->json([
            'data' => [
                'rfid_mqtt_config' => $publicSaved,
                'rfid_template' => $this->buildTenantRfidTemplate($tenant),
                'mosquitto_sync' => $syncResult,
            ],
        ]);
    }

    public function provisionTenantRfidMosquitto(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->findTenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $validator = Validator::make($request->all(), [
            'rotate_password' => ['nullable', 'boolean'],
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $oldConfig = $this->tenantMqttConfigService->publicConfig(
            $this->tenantMqttConfigService->tenantConfig((string) $tenant->id, (string) $tenant->slug, false)
        );

        try {
            $result = $this->tenantMqttConfigService->provisionMosquittoTenantConfig(
                (string) $tenant->id,
                (string) $tenant->slug,
                (string) ($request->user()?->id ?? ''),
                (bool) ($validator->validated()['rotate_password'] ?? false)
            );
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $saved = $result['config'] ?? [];
        $publicSaved = $this->tenantMqttConfigService->publicConfig(is_array($saved) ? $saved : []);

        $this->logAudit(
            $request,
            'tenant_mqtt_configs',
            (string) $tenant->id,
            'UPDATE',
            $oldConfig,
            $publicSaved,
            (string) $tenant->id
        );

        return response()->json([
            'data' => [
                'rfid_mqtt_config' => $publicSaved,
                'rfid_template' => $this->buildTenantRfidTemplate($tenant),
                'mosquitto_sync' => $result['sync'] ?? null,
            ],
        ]);
    }

    public function checkDomain(Request $request, string $domainId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        try {
            $before = $this->tenantDomainRow($domainId);
            $domain = $this->tenantDomainService->checkDomain($domainId);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 404);
        }

        $this->logAudit(
            $request,
            'tenant_domains',
            (string) ($domain['id'] ?? $domainId),
            'UPDATE',
            $before ? (array) $before : null,
            $domain,
            $before?->tenant_id ? (string) $before->tenant_id : null
        );

        return $this->ok($domain);
    }

    public function deleteDomain(Request $request, string $domainId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $row = $this->tenantDomainRow($domainId);
        if (! $row) {
            return response()->json(['error' => 'Domain tidak ditemukan'], 404);
        }

        $before = [
            'id' => (string) $row->id,
            'tenant_id' => $row->tenant_id ? (string) $row->tenant_id : null,
            'host' => (string) $row->host,
            'domain_type' => (string) $row->domain_type,
            'status' => (string) ($row->status ?? ''),
            'is_primary' => (bool) ($row->is_primary ?? false),
        ];

        $this->tenantDomainService->deleteDomain($domainId);

        $this->logAudit(
            $request,
            'tenant_domains',
            (string) $row->id,
            'DELETE',
            $before,
            null,
            $row->tenant_id ? (string) $row->tenant_id : null
        );

        return $this->ok(['deleted' => true]);
    }

    public function backupTenant(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->findTenantByIdOrSlug($id);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $mode = $this->normalizeBackupMode($request->query('mode', self::BACKUP_MODE_FULL));
        $months = $this->normalizeBackupMonths($request->query('months'));
        $periodStart = $months !== null ? now()->subMonths($months)->startOfDay() : null;
        $periodStartDate = $periodStart ? $periodStart->toDateString() : null;
        $periodStartDateTime = $periodStart ? $periodStart->toDateTimeString() : null;
        $tenantId = (string) $tenant->id;

        $tables = match ($mode) {
            self::BACKUP_MODE_STUDENTS => $this->buildStudentBackupTables($tenantId, $periodStartDate, $periodStartDateTime),
            self::BACKUP_MODE_TEACHERS => $this->buildTeacherBackupTables($tenantId),
            default => $this->buildFullBackupTables($tenantId),
        };

        $totalRows = 0;
        foreach ($tables as $tableInfo) {
            $totalRows += (int) ($tableInfo['row_count'] ?? 0);
        }

        return response()->json([
            'data' => [
                'tenant' => [
                    'id' => $tenant->id,
                    'name' => $tenant->name,
                    'slug' => $tenant->slug,
                    'status' => $tenant->status,
                    'status_reason' => $tenant->status_reason ?? null,
                    'status_changed_at' => $tenant->status_changed_at ?? null,
                    'status_changed_by' => $tenant->status_changed_by ?? null,
                    'archived_at' => $tenant->archived_at ?? null,
                    'created_at' => $tenant->created_at,
                    'updated_at' => $tenant->updated_at,
                ],
                'exported_at' => now()->toIso8601String(),
                'mode' => $mode,
                'mode_label' => $this->backupModeLabel($mode),
                'period' => [
                    'months' => $months,
                    'label' => $this->backupPeriodLabel($months),
                    'start_at' => $periodStart ? $periodStart->toIso8601String() : null,
                    'end_at' => now()->toIso8601String(),
                ],
                'summary' => [
                    'table_count' => count($tables),
                    'total_rows' => $totalRows,
                ],
                'tables' => $tables,
            ],
        ]);
    }

    public function updateTenantStatus(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->findTenantByIdOrSlug($id);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $payload = $request->only(['status', 'reason']);
        $validator = Validator::make($payload, [
            'status' => 'required|string|in:active,suspended,archived',
            'reason' => 'nullable|string|max:500',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $nextStatus = strtolower(trim((string) $payload['status']));
        $reason = trim((string) ($payload['reason'] ?? ''));
        $actorId = (string) ($request->user()?->id ?? '');
        $oldData = (array) $tenant;

        $updates = [
            'status' => $nextStatus,
            'updated_at' => now(),
        ];
        if ($this->tableHasColumn('tenants', 'status_reason')) {
            $updates['status_reason'] = $reason !== '' ? $reason : null;
        }
        if ($this->tableHasColumn('tenants', 'status_changed_at')) {
            $updates['status_changed_at'] = now();
        }
        if ($this->tableHasColumn('tenants', 'status_changed_by')) {
            $updates['status_changed_by'] = $actorId !== '' ? $actorId : null;
        }

        if ($nextStatus === self::TENANT_STATUS_ARCHIVED && $this->tableHasColumn('tenants', 'archived_at')) {
            $updates['archived_at'] = now();
        } elseif ($nextStatus === self::TENANT_STATUS_ACTIVE && $this->tableHasColumn('tenants', 'archived_at')) {
            $updates['archived_at'] = null;
        }

        DB::table('tenants')->where('id', $tenant->id)->update($updates);
        $updatedTenant = DB::table('tenants')->where('id', $tenant->id)->first();

        $this->logAudit(
            $request,
            'tenants',
            (string) $tenant->id,
            'UPDATE',
            $oldData,
            (array) ($updatedTenant ?? []),
            (string) $tenant->id
        );

        return response()->json(['data' => $updatedTenant]);
    }

    public function restoreTenant(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->findTenantByIdOrSlug($id);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $backupPayload = $this->normalizeRestoreBackupPayload($request->input('backup'));
        if (! $backupPayload) {
            return $this->deny('Payload backup tidak valid. Gunakan format JSON backup yang benar.', 422);
        }

        $dryRun = filter_var($request->input('dry_run', true), FILTER_VALIDATE_BOOLEAN);
        $truncateBeforeRestore = filter_var($request->input('truncate_before_restore', false), FILTER_VALIDATE_BOOLEAN);
        $includeTables = $request->input('include_tables', []);
        if (! is_array($includeTables)) {
            $includeTables = [];
        }

        if (! $dryRun && ! filter_var($request->input('confirm', false), FILTER_VALIDATE_BOOLEAN)) {
            return $this->deny('Untuk menjalankan restore nyata, kirim confirm=true.', 422);
        }

        try {
            $result = $this->restoreBackupPayloadForTenant(
                (string) $tenant->id,
                $backupPayload,
                $dryRun,
                $truncateBeforeRestore,
                $includeTables
            );
        } catch (\Throwable $e) {
            return $this->deny('Restore gagal: '.trim((string) $e->getMessage()), 422);
        }

        if (! $dryRun) {
            $this->logAudit(
                $request,
                'tenants',
                (string) $tenant->id,
                'UPDATE',
                null,
                [
                    'type' => 'tenant_restore',
                    'tenant_id' => $tenant->id,
                    'summary' => $result['summary'] ?? [],
                    'tables' => array_map(
                        fn ($table) => [
                            'table' => $table['table'] ?? null,
                            'inserted' => $table['inserted'] ?? 0,
                            'updated' => $table['updated'] ?? 0,
                            'errors' => $table['errors'] ?? 0,
                        ],
                        is_array($result['tables'] ?? null) ? $result['tables'] : []
                    ),
                ],
                (string) $tenant->id
            );
        }

        return response()->json([
            'data' => [
                'tenant' => [
                    'id' => $tenant->id,
                    'name' => $tenant->name,
                    'slug' => $tenant->slug,
                ],
                'dry_run' => $dryRun,
                'result' => $result,
            ],
        ]);
    }

    public function auditTrail(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        if (! $this->hasTable('audit_log')) {
            return response()->json([
                'data' => [
                    'rows' => [],
                    'anomalies' => [],
                    'summary' => [
                        'total' => 0,
                    ],
                ],
            ]);
        }

        $query = DB::table('audit_log as a')
            ->leftJoin('profiles as p', 'p.id', '=', 'a.user_id')
            ->leftJoin('tenants as t', 't.id', '=', 'a.tenant_id')
            ->select(
                'a.id',
                'a.tenant_id',
                't.name as tenant_name',
                'a.table_name',
                'a.record_id',
                'a.action',
                'a.user_id',
                'a.user_role',
                'p.nama as user_name',
                'a.timestamp',
                'a.old_data',
                'a.new_data'
            );

        $tenantId = trim((string) $request->query('tenant_id', ''));
        if ($tenantId !== '' && $this->tableHasColumn('audit_log', 'tenant_id')) {
            $query->where('a.tenant_id', $tenantId);
        }

        $table = trim((string) $request->query('table', ''));
        if ($table !== '') {
            $query->where('a.table_name', $table);
        }

        $action = strtoupper(trim((string) $request->query('action', '')));
        if ($action !== '') {
            $query->where('a.action', $action);
        }

        $q = trim((string) $request->query('q', ''));
        if ($q !== '') {
            $like = '%'.strtolower($q).'%';
            $query->where(function ($builder) use ($like) {
                $builder
                    ->whereRaw('LOWER(COALESCE(a.table_name, \'\')) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(COALESCE(a.record_id, \'\')) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(COALESCE(p.nama, \'\')) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(COALESCE(t.name, \'\')) LIKE ?', [$like]);
            });
        }

        $from = trim((string) $request->query('from', ''));
        if ($from !== '') {
            try {
                $query->where('a.timestamp', '>=', Carbon::parse($from));
            } catch (\Throwable $e) {
                // ignore invalid filter
            }
        }

        $to = trim((string) $request->query('to', ''));
        if ($to !== '') {
            try {
                $query->where('a.timestamp', '<=', Carbon::parse($to));
            } catch (\Throwable $e) {
                // ignore invalid filter
            }
        }

        $limit = (int) $request->query('limit', 100);
        $limit = max(1, min(300, $limit));

        $rows = $query
            ->orderByDesc('a.timestamp')
            ->limit($limit)
            ->get()
            ->map(function ($row) {
                $row->old_data = $this->decodeAuditJson($row->old_data);
                $row->new_data = $this->decodeAuditJson($row->new_data);

                return $row;
            })
            ->values();

        $summaryQuery = DB::table('audit_log as a');
        if ($tenantId !== '' && $this->tableHasColumn('audit_log', 'tenant_id')) {
            $summaryQuery->where('a.tenant_id', $tenantId);
        }

        $summary = $summaryQuery
            ->selectRaw('count(*) as total')
            ->selectRaw("sum(case when action = 'INSERT' then 1 else 0 end) as inserts")
            ->selectRaw("sum(case when action = 'UPDATE' then 1 else 0 end) as updates")
            ->selectRaw("sum(case when action = 'DELETE' then 1 else 0 end) as deletes")
            ->first();

        return response()->json([
            'data' => [
                'rows' => $rows,
                'summary' => [
                    'total' => (int) ($summary->total ?? 0),
                    'inserts' => (int) ($summary->inserts ?? 0),
                    'updates' => (int) ($summary->updates ?? 0),
                    'deletes' => (int) ($summary->deletes ?? 0),
                ],
                'anomalies' => $this->buildAuditAnomalies($tenantId !== '' ? $tenantId : null),
            ],
        ]);
    }

    public function store(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $payload = $request->only(['name', 'slug', 'admin_name', 'admin_email', 'admin_password']);

        $validator = Validator::make($payload, [
            'name' => 'required|string|max:120',
            'slug' => 'required|string|max:63',
            'admin_name' => 'required|string|max:120',
            'admin_email' => 'required|email|max:255',
            'admin_password' => ['required', 'string', PasswordRule::defaults()],
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $slug = $this->normalizeSlug($payload['slug']);
        if ($slug === '' || ! $this->isValidSlug($slug)) {
            return response()->json(['error' => 'Subdomain tidak valid'], 422);
        }

        if ($this->isReservedSlug($slug)) {
            return response()->json(['error' => 'Subdomain tidak bisa digunakan'], 422);
        }

        $defaultSlug = strtolower(trim((string) config('tenancy.default_slug', 'default')));
        if ($defaultSlug !== '' && $slug === $defaultSlug) {
            return response()->json(['error' => 'Subdomain sudah dipakai'], 409);
        }

        if (DB::table('tenants')->where('slug', $slug)->exists()) {
            return response()->json(['error' => 'Subdomain sudah dipakai'], 409);
        }

        $adminEmail = strtolower(trim($payload['admin_email']));
        if ($this->isReservedSuperAdminEmail($adminEmail)) {
            return response()->json(['error' => 'Email ini tidak bisa digunakan sebagai admin sekolah'], 403);
        }

        $tenantId = (string) Str::uuid();
        $userId = (string) Str::uuid();
        $tenantName = trim($payload['name']);
        $adminName = trim($payload['admin_name']);

        $result = null;

        DB::transaction(function () use (
            $tenantId,
            $tenantName,
            $slug,
            $userId,
            $adminName,
            $adminEmail,
            $payload,
            &$result
        ) {
            DB::table('tenants')->insert([
                'id' => $tenantId,
                'name' => $tenantName,
                'slug' => $slug,
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            User::query()->create([
                'id' => $userId,
                'name' => $adminName,
                'email' => $adminEmail,
                'password' => Hash::make($payload['admin_password']),
            ]);

            Profile::query()->create([
                'id' => $userId,
                'tenant_id' => $tenantId,
                'email' => $adminEmail,
                'nama' => $adminName,
                'role' => 'admin',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('admin_users')->insert([
                'id' => $userId,
                'tenant_id' => $tenantId,
                'created_at' => now(),
            ]);

            $settingsPayload = [
                'tenant_id' => $tenantId,
                'nama_sekolah' => $tenantName,
                'email' => $adminEmail,
                'registrasi_siswa_aktif' => true,
                'registrasi_guru_aktif' => false,
                'registrasi_admin_aktif' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ];
            if ($this->tableHasColumn('settings', 'approval_primary_admin_id')) {
                $settingsPayload['approval_primary_admin_id'] = $userId;
            }

            DB::table('settings')->insert($settingsPayload);

            $result = [
                'tenant' => [
                    'id' => $tenantId,
                    'name' => $tenantName,
                    'slug' => $slug,
                ],
                'admin' => [
                    'id' => $userId,
                    'name' => $adminName,
                    'email' => $adminEmail,
                ],
                'primary_admin_user_id' => $userId,
            ];
        });

        $this->logAudit($request, 'tenants', $tenantId, 'INSERT', null, [
            'id' => $tenantId,
            'name' => $tenantName,
            'slug' => $slug,
            'status' => 'active',
        ], $tenantId);

        return response()->json(['data' => $result], 201);
    }

    public function admins(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $query = DB::table('super_admins as s')
            ->leftJoin('users as u', 'u.id', '=', 's.user_id')
            ->select(
                's.id',
                's.user_id',
                's.email',
                's.name',
                's.created_at',
                'u.name as user_name'
            )
            ->orderBy('s.created_at', 'desc');

        $this->applyPagination($query, $request);

        return $this->ok($query->get());
    }

    public function storeAdmin(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $payload = $request->only(['email', 'password', 'name', 'tenant_slug']);

        $validator = Validator::make($payload, [
            'email' => 'required|email|max:255',
            'password' => ['nullable', 'string', PasswordRule::defaults()],
            'name' => 'nullable|string|max:120',
            'tenant_slug' => 'nullable|string|max:63',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $email = strtolower(trim($payload['email']));
        $name = trim((string) ($payload['name'] ?? ''));
        if ($name === '') {
            $name = $email;
        }

        $slug = $payload['tenant_slug'] ?? '';
        $slug = $slug !== '' ? $this->normalizeSlug($slug) : strtolower(trim((string) config('tenancy.default_slug', 'default')));

        if ($slug === '' || ! $this->isValidSlug($slug)) {
            return response()->json(['error' => 'Subdomain tidak valid'], 422);
        }

        $tenant = DB::table('tenants')->where('slug', $slug)->first();
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $existingProfileInTenant = Profile::query()
            ->where('tenant_id', $tenant->id)
            ->whereRaw('lower(email) = ?', [$email])
            ->first();
        $existingUser = $existingProfileInTenant?->id
            ? User::query()->where('id', $existingProfileInTenant->id)->first()
            : null;
        if (! $existingUser && empty($payload['password'])) {
            return response()->json(['error' => 'Password wajib diisi untuk user baru'], 422);
        }
        if ($existingUser && ! empty($payload['password']) && $this->isSuperAdminByIdentity((string) $existingUser->id, $email)) {
            return response()->json(['error' => 'Password super admin tidak bisa direset lewat endpoint ini'], 403);
        }

        $result = null;
        $createdSuper = false;
        $superAdminId = null;

        DB::transaction(function () use ($email, $name, $payload, $tenant, $existingUser, $existingProfileInTenant, &$result, &$createdSuper, &$superAdminId) {
            $user = $existingUser;
            if (! $user) {
                $user = User::query()->create([
                    'id' => (string) Str::uuid(),
                    'name' => $name,
                    'email' => $email,
                    'password' => Hash::make($payload['password']),
                ]);
            } else {
                $updates = [];
                if ($name !== '' && $user->name !== $name) {
                    $updates['name'] = $name;
                }
                if (! empty($payload['password'])) {
                    $updates['password'] = Hash::make($payload['password']);
                }
                if (! empty($updates)) {
                    $updates['updated_at'] = now();
                    User::query()->where('id', $user->id)->update($updates);
                }
            }

            $existingProfile = $existingProfileInTenant ?: Profile::query()
                ->where('id', $user->id)
                ->where('tenant_id', $tenant->id)
                ->first();

            if ($existingProfile && $existingProfile->role !== 'admin') {
                throw new \RuntimeException('User ini sudah terdaftar sebagai non-admin.');
            }

            if (! $existingProfile) {
                Profile::query()->create([
                    'id' => $user->id,
                    'tenant_id' => $tenant->id,
                    'email' => $email,
                    'nama' => $name,
                    'role' => 'admin',
                    'status' => 'active',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            $existsAdmin = DB::table('admin_users')->where('id', $user->id)->exists();
            if (! $existsAdmin) {
                DB::table('admin_users')->insert([
                    'id' => $user->id,
                    'tenant_id' => $tenant->id,
                    'created_at' => now(),
                ]);
            }

            $existsSuper = DB::table('super_admins')->where('user_id', $user->id)->first();
            if (! $existsSuper) {
                $superAdminId = (string) Str::uuid();
                DB::table('super_admins')->insert([
                    'id' => $superAdminId,
                    'user_id' => $user->id,
                    'email' => $email,
                    'name' => $name,
                    'created_at' => now(),
                ]);
                $createdSuper = true;
            } else {
                $superAdminId = $existsSuper->id;
                DB::table('super_admins')
                    ->where('id', $existsSuper->id)
                    ->update([
                        'email' => $email,
                        'name' => $name,
                    ]);
            }

            $result = [
                'user_id' => $user->id,
                'email' => $email,
                'name' => $name,
                'tenant_id' => $tenant->id,
                'tenant_slug' => $tenant->slug,
            ];
        });

        if ($createdSuper && $superAdminId) {
            $this->logAudit($request, 'super_admins', $superAdminId, 'INSERT', null, [
                'user_id' => $result['user_id'] ?? null,
                'email' => $result['email'] ?? null,
                'name' => $result['name'] ?? null,
                'tenant_id' => $result['tenant_id'] ?? null,
            ], $result['tenant_id'] ?? null);
        }

        return response()->json(['data' => $result], 201);
    }

    public function deleteAdmin(Request $request, string $id)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $row = DB::table('super_admins')
            ->where('id', $id)
            ->orWhere('user_id', $id)
            ->first();

        if (! $row) {
            return response()->json(['error' => 'Super admin tidak ditemukan'], 404);
        }

        $total = DB::table('super_admins')->count();
        if ($total <= 1) {
            return response()->json(['error' => 'Tidak bisa menghapus super admin terakhir'], 409);
        }

        $oldData = [
            'id' => $row->id,
            'user_id' => $row->user_id,
            'email' => $row->email,
            'name' => $row->name,
        ];

        $tenantId = null;
        if ($row->user_id) {
            $profile = Profile::query()->where('id', $row->user_id)->first();
            $tenantId = $profile?->tenant_id;
        }

        DB::table('super_admins')->where('id', $row->id)->delete();

        $this->logAudit($request, 'super_admins', $row->id, 'DELETE', $oldData, null, $tenantId);

        return response()->json(['data' => 'deleted']);
    }

    public function setTenantPrimaryAdmin(Request $request, string $tenantId, string $userId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->findTenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        if (! $this->hasTable('settings') || ! $this->tableHasColumn('settings', 'approval_primary_admin_id')) {
            return response()->json([
                'error' => 'Kolom admin utama belum tersedia. Jalankan migrasi terbaru terlebih dahulu.',
            ], 503);
        }

        $profile = Profile::query()
            ->where('id', $userId)
            ->where('tenant_id', $tenant->id)
            ->where('role', 'admin')
            ->first();
        if (! $profile) {
            return response()->json(['error' => 'Admin tenant tidak ditemukan'], 404);
        }

        if ($this->isSuperAdminByIdentity((string) $profile->id, (string) ($profile->email ?? ''))) {
            return response()->json([
                'error' => 'Akun super admin tidak bisa dijadikan admin utama tenant.',
            ], 422);
        }

        $settings = DB::table('settings')
            ->where('tenant_id', $tenant->id)
            ->orderBy('id')
            ->first();
        if (! $settings) {
            return response()->json([
                'error' => 'Pengaturan tenant belum tersedia.',
            ], 404);
        }

        $oldData = (array) $settings;
        $currentPrimary = trim((string) ($settings->approval_primary_admin_id ?? ''));
        if ($currentPrimary === (string) $profile->id) {
            return response()->json([
                'data' => [
                    'tenant_id' => (string) $tenant->id,
                    'settings_id' => (string) ($settings->id ?? ''),
                    'primary_admin_user_id' => (string) $profile->id,
                    'primary_admin_name' => $profile->nama,
                    'primary_admin_email' => $profile->email,
                ],
            ]);
        }

        $updates = [
            'approval_primary_admin_id' => (string) $profile->id,
        ];
        if ($this->tableHasColumn('settings', 'updated_at')) {
            $updates['updated_at'] = now();
        }

        DB::table('settings')
            ->where('id', $settings->id)
            ->update($updates);

        $newData = DB::table('settings')->where('id', $settings->id)->first();

        $this->logAudit(
            $request,
            'settings',
            (string) ($settings->id ?? ''),
            'UPDATE',
            $oldData,
            $newData ? (array) $newData : null,
            (string) $tenant->id
        );

        return response()->json([
            'data' => [
                'tenant_id' => (string) $tenant->id,
                'settings_id' => (string) ($settings->id ?? ''),
                'primary_admin_user_id' => (string) $profile->id,
                'primary_admin_name' => $profile->nama,
                'primary_admin_email' => $profile->email,
            ],
        ]);
    }

    public function resetTenantAdminPassword(Request $request, string $tenantId, string $userId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $normalizedTenant = strtolower(trim($tenantId));
        $tenantQuery = DB::table('tenants');
        if (Str::isUuid($tenantId)) {
            $tenantQuery->where('id', $tenantId)->orWhere('slug', $normalizedTenant);
        } else {
            $tenantQuery->where('slug', $normalizedTenant);
        }
        $tenant = $tenantQuery->first();
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $payload = $request->only(['password']);
        $validator = Validator::make($payload, [
            'password' => ['nullable', 'string', PasswordRule::defaults(), 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        $profile = Profile::query()
            ->where('id', $userId)
            ->where('tenant_id', $tenant->id)
            ->where('role', 'admin')
            ->first();

        if (! $profile) {
            return response()->json(['error' => 'Admin tenant tidak ditemukan'], 404);
        }

        $user = User::query()->where('id', $profile->id)->first();
        if (! $user) {
            return response()->json(['error' => 'User admin tidak ditemukan'], 404);
        }
        if ($this->isSuperAdminByIdentity((string) $user->id, (string) ($user->email ?? ''))) {
            return response()->json(['error' => 'Password super admin tidak bisa direset'], 403);
        }

        $newPassword = (string) ($payload['password'] ?? '');
        $generated = false;
        if ($newPassword === '') {
            $newPassword = $this->generateStrongPassword();
            $generated = true;
        }

        $oldData = [
            'tenant_id' => $tenant->id,
            'user_id' => $user->id,
            'email' => $user->email,
            'generated' => $generated,
        ];

        DB::transaction(function () use ($user, $newPassword) {
            $user->forceFill([
                'password' => Hash::make($newPassword),
                'updated_at' => now(),
            ])->save();
        });

        $this->logAudit($request, 'users', $user->id, 'UPDATE', $oldData, [
            'tenant_id' => $tenant->id,
            'user_id' => $user->id,
            'email' => $user->email,
            'password_reset' => true,
            'generated' => $generated,
        ], $tenant->id);

        return response()->json([
            'data' => [
                'tenant_id' => $tenant->id,
                'tenant_slug' => $tenant->slug,
                'user_id' => $user->id,
                'email' => $user->email,
                'generated' => $generated,
                // Returned only once; frontend should mask by default.
                'temporary_password' => $newPassword,
            ],
        ]);
    }

    private function normalizeSlug(string $slug): string
    {
        $normalized = strtolower(trim($slug));
        $normalized = preg_replace('/[^a-z0-9-]+/i', '-', $normalized);
        $normalized = preg_replace('/-+/', '-', $normalized);

        return trim($normalized ?? '', '-');
    }

    private function isValidSlug(string $slug): bool
    {
        return (bool) preg_match('/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $slug);
    }

    private function isReservedSlug(string $slug): bool
    {
        $reserved = config('tenancy.reserved_subdomains', []);
        $reserved = array_map('strtolower', $reserved);
        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin26')));
        if ($adminSubdomain !== '') {
            $reserved[] = $adminSubdomain;
        }

        return in_array(strtolower($slug), $reserved, true);
    }

    private function isReservedSuperAdminEmail(string $email): bool
    {
        $normalizedEmail = strtolower(trim($email));
        if ($normalizedEmail === '') {
            return false;
        }

        $envEmails = array_map('strtolower', config('superadmin.emails', []));
        if (in_array($normalizedEmail, $envEmails, true)) {
            return true;
        }

        try {
            return DB::table('super_admins as s')
                ->join('users as u', 'u.id', '=', 's.user_id')
                ->whereRaw('lower(u.email) = ?', [$normalizedEmail])
                ->exists();
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function generateStrongPassword(int $length = 16): string
    {
        $lower = 'abcdefghijkmnopqrstuvwxyz';
        $upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        $digits = '23456789';
        $symbols = '@#$%&*-_';

        $seed = [
            $lower[random_int(0, strlen($lower) - 1)],
            $upper[random_int(0, strlen($upper) - 1)],
            $digits[random_int(0, strlen($digits) - 1)],
            $symbols[random_int(0, strlen($symbols) - 1)],
        ];

        $all = $lower.$upper.$digits.$symbols;
        while (count($seed) < $length) {
            $seed[] = $all[random_int(0, strlen($all) - 1)];
        }

        shuffle($seed);

        return implode('', $seed);
    }

    private function buildTenantStorageUsage(string $tenantId): array
    {
        $references = $this->collectTenantStorageReferences($tenantId);
        $storage = Storage::disk('local');

        $bucketStats = [];
        foreach (self::MONITORED_STORAGE_BUCKETS as $bucket) {
            $bucketStats[$bucket] = [
                'bucket' => $bucket,
                'bytes' => 0,
                'files' => 0,
            ];
        }

        $resolvedReferences = 0;
        $unresolvedReferences = 0;
        $seenFiles = [];

        foreach ($references as $reference) {
            $raw = (string) ($reference['raw'] ?? '');
            $bucket = isset($reference['bucket']) ? (string) $reference['bucket'] : '';
            $fallbackBuckets = $reference['fallback_buckets'] ?? [];

            $candidates = $this->resolveStorageCandidates($raw, $bucket, $fallbackBuckets);
            $resolved = false;

            foreach ($candidates as $candidate) {
                $candidateBucket = (string) ($candidate['bucket'] ?? '');
                $candidatePath = (string) ($candidate['path'] ?? '');
                if ($candidateBucket === '' || $candidatePath === '') {
                    continue;
                }

                $fullPath = 'private/'.$candidateBucket.'/'.ltrim($candidatePath, '/');
                if (array_key_exists($fullPath, $seenFiles)) {
                    $resolved = true;
                    break;
                }

                if (! $storage->exists($fullPath)) {
                    continue;
                }

                $size = (int) ($storage->size($fullPath) ?: 0);
                $seenFiles[$fullPath] = $size;

                $bucketStats[$candidateBucket]['bytes'] += max(0, $size);
                $bucketStats[$candidateBucket]['files'] += 1;
                $resolved = true;
                break;
            }

            if ($resolved) {
                $resolvedReferences++;
            } else {
                $unresolvedReferences++;
            }
        }

        $totalBytes = 0;
        $totalFiles = 0;
        $buckets = [];
        foreach (self::MONITORED_STORAGE_BUCKETS as $bucket) {
            $bytes = (int) ($bucketStats[$bucket]['bytes'] ?? 0);
            $files = (int) ($bucketStats[$bucket]['files'] ?? 0);
            $totalBytes += $bytes;
            $totalFiles += $files;

            $buckets[] = [
                'bucket' => $bucket,
                'bytes' => $bytes,
                'bytes_label' => $this->formatBytes($bytes),
                'files' => $files,
            ];
        }

        return [
            'total_bytes' => $totalBytes,
            'total_label' => $this->formatBytes($totalBytes),
            'resolved_files' => $totalFiles,
            'total_references' => count($references),
            'resolved_references' => $resolvedReferences,
            'unresolved_references' => $unresolvedReferences,
            'computed_at' => now()->toIso8601String(),
            'buckets' => $buckets,
        ];
    }

    private function collectTenantStorageReferences(string $tenantId): array
    {
        $references = [];

        $this->collectStorageRefsFromColumn(
            $references,
            $tenantId,
            'profiles',
            'photo_path',
            'profile-photos',
            'profiles.photo_path'
        );
        $this->collectStorageRefsFromColumn(
            $references,
            $tenantId,
            'settings',
            'logo_path',
            'profile-photos',
            'settings.logo_path'
        );
        $this->collectStorageRefsFromColumn(
            $references,
            $tenantId,
            'settings',
            'logo_url',
            'profile-photos',
            'settings.logo_url'
        );
        $this->collectStorageRefsFromColumn(
            $references,
            $tenantId,
            'settings',
            'logourl',
            'profile-photos',
            'settings.logourl'
        );
        $this->collectStorageRefsFromColumn(
            $references,
            $tenantId,
            'tugas',
            'file_url',
            'assignments',
            'tugas.file_url'
        );
        $this->collectStorageRefsFromColumn(
            $references,
            $tenantId,
            'tugas_jawaban',
            'file_url',
            'assignments',
            'tugas_jawaban.file_url'
        );
        $this->collectStorageRefsFromColumn(
            $references,
            $tenantId,
            'certificates',
            'file_url',
            'certificates',
            'certificates.file_url',
            ['sertifikat-files']
        );
        $this->collectStorageRefsFromColumn(
            $references,
            $tenantId,
            'templat_sertifikat_publik',
            'background_url',
            'certificate-templates',
            'templat_sertifikat_publik.background_url',
            ['sertifikat-templates']
        );

        return $references;
    }

    private function collectStorageRefsFromColumn(
        array &$references,
        string $tenantId,
        string $table,
        string $column,
        string $bucket,
        string $source,
        array $fallbackBuckets = []
    ): void {
        if (! $this->tableHasColumn($table, 'tenant_id') || ! $this->tableHasColumn($table, $column)) {
            return;
        }

        try {
            $rows = DB::table($table)
                ->where('tenant_id', $tenantId)
                ->whereNotNull($column)
                ->pluck($column);
        } catch (\Throwable $e) {
            return;
        }

        foreach ($rows as $value) {
            if (! is_scalar($value)) {
                continue;
            }

            $raw = trim((string) $value);
            if ($raw === '') {
                continue;
            }
            if ($this->googleDriveService->isGoogleDriveUrl($raw)) {
                continue;
            }

            $references[] = [
                'raw' => $raw,
                'source' => $source,
                'bucket' => $bucket,
                'fallback_buckets' => $fallbackBuckets,
            ];
        }
    }

    private function resolveStorageCandidates(string $stored, string $bucket, array $fallbackBuckets = []): array
    {
        $path = $this->normalizeStoragePath($stored);
        if ($path === '') {
            return [];
        }

        $bucketOrder = [];
        if ($bucket !== '') {
            $bucketOrder[] = $bucket;
        }
        foreach ($fallbackBuckets as $fallbackBucket) {
            $fallbackBucket = trim((string) $fallbackBucket);
            if ($fallbackBucket !== '') {
                $bucketOrder[] = $fallbackBucket;
            }
        }

        if (empty($bucketOrder)) {
            $bucketOrder = self::MONITORED_STORAGE_BUCKETS;
        } else {
            $bucketOrder = array_values(array_unique(array_filter($bucketOrder, function ($value) {
                return in_array($value, self::MONITORED_STORAGE_BUCKETS, true);
            })));
        }

        $candidates = [];
        foreach (self::MONITORED_STORAGE_BUCKETS as $candidateBucket) {
            $privatePrefix = 'private/'.$candidateBucket.'/';
            $plainPrefix = $candidateBucket.'/';

            if (str_starts_with($path, $privatePrefix)) {
                $candidates[] = [
                    'bucket' => $candidateBucket,
                    'path' => ltrim(substr($path, strlen($privatePrefix)), '/'),
                ];
                break;
            }

            if (str_starts_with($path, $plainPrefix)) {
                $candidates[] = [
                    'bucket' => $candidateBucket,
                    'path' => ltrim(substr($path, strlen($plainPrefix)), '/'),
                ];
                break;
            }

            $marker = '/private/'.$candidateBucket.'/';
            $markerPos = strpos($path, $marker);
            if ($markerPos !== false) {
                $candidates[] = [
                    'bucket' => $candidateBucket,
                    'path' => ltrim(substr($path, $markerPos + strlen($marker)), '/'),
                ];
                break;
            }
        }

        foreach ($bucketOrder as $candidateBucket) {
            $candidates[] = [
                'bucket' => $candidateBucket,
                'path' => ltrim($path, '/'),
            ];
        }

        $unique = [];
        $normalized = [];
        foreach ($candidates as $candidate) {
            $candidateBucket = (string) ($candidate['bucket'] ?? '');
            $candidatePath = ltrim((string) ($candidate['path'] ?? ''), '/');

            if ($candidateBucket === '' || $candidatePath === '' || str_contains($candidatePath, '..')) {
                continue;
            }

            $key = $candidateBucket.'|'.$candidatePath;
            if (isset($unique[$key])) {
                continue;
            }
            $unique[$key] = true;
            $normalized[] = [
                'bucket' => $candidateBucket,
                'path' => $candidatePath,
            ];
        }

        return $normalized;
    }

    private function normalizeStoragePath(string $value): string
    {
        $raw = trim($value);
        if ($raw === '') {
            return '';
        }

        if (filter_var($raw, FILTER_VALIDATE_URL)) {
            try {
                $parsed = parse_url($raw);
                if (is_array($parsed)) {
                    $query = (string) ($parsed['query'] ?? '');
                    if ($query !== '') {
                        parse_str($query, $params);
                        $queryPath = $params['path'] ?? null;
                        if (is_string($queryPath) && trim($queryPath) !== '') {
                            $raw = $queryPath;
                        } else {
                            $raw = (string) ($parsed['path'] ?? '');
                        }
                    } else {
                        $raw = (string) ($parsed['path'] ?? '');
                    }
                }
            } catch (\Throwable $e) {
                return '';
            }
        }

        $normalized = rawurldecode($raw);
        $normalized = str_replace('\\', '/', $normalized);
        $normalized = trim($normalized);
        $normalized = ltrim($normalized, '/');

        $prefixesToTrim = [
            'storage/app/private/',
            'app/private/',
        ];

        foreach ($prefixesToTrim as $prefix) {
            if (str_starts_with($normalized, $prefix)) {
                $normalized = substr($normalized, strlen($prefix));
                break;
            }
        }

        return trim($normalized);
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $size = (float) $bytes;
        $index = 0;

        while ($size >= 1024 && $index < count($units) - 1) {
            $size /= 1024;
            $index++;
        }

        $precision = $index === 0 ? 0 : 2;

        return round($size, $precision).' '.$units[$index];
    }

    private function normalizeBackupMode(?string $value): string
    {
        $mode = strtolower(trim((string) $value));

        return match ($mode) {
            self::BACKUP_MODE_STUDENTS => self::BACKUP_MODE_STUDENTS,
            self::BACKUP_MODE_TEACHERS => self::BACKUP_MODE_TEACHERS,
            default => self::BACKUP_MODE_FULL,
        };
    }

    private function backupModeLabel(string $mode): string
    {
        return match ($mode) {
            self::BACKUP_MODE_STUDENTS => 'Backup Siswa Lengkap (mapel, nilai tugas/quiz, absensi, eskul, organisasi/jabatan)',
            self::BACKUP_MODE_TEACHERS => 'Backup Guru (pengampu + nilai/kehadiran siswa + rekap eskul binaan)',
            default => 'Backup Super Lengkap (seluruh data tenant)',
        };
    }

    private function normalizeBackupMonths($value): ?int
    {
        $raw = strtolower(trim((string) ($value ?? '')));
        if ($raw === '' || $raw === 'all' || $raw === '0') {
            return null;
        }
        if (! is_numeric($raw)) {
            return null;
        }

        $months = (int) $raw;
        if ($months <= 0) {
            return null;
        }

        return min(36, $months);
    }

    private function backupPeriodLabel(?int $months): string
    {
        if ($months === null) {
            return 'Semua data';
        }

        return 'Data '.$months.' bulan terakhir';
    }

    private function buildFullBackupTables(string $tenantId): array
    {
        $tables = [];
        $backupTables = $this->backupTablesForTenant();

        foreach ($backupTables as $tableName) {
            if (! $this->tableHasColumn($tableName, 'tenant_id')) {
                continue;
            }

            try {
                $query = DB::table($tableName)->where('tenant_id', $tenantId);
                if ($this->tableHasColumn($tableName, 'id')) {
                    $query->orderBy('id');
                } elseif ($this->tableHasColumn($tableName, 'created_at')) {
                    $query->orderBy('created_at');
                }

                $rows = $query->get()->all();
            } catch (\Throwable $e) {
                $rows = [];
            }

            $tables[] = $this->makeBackupTable($tableName, $rows);
        }

        $profileIds = [];
        if ($this->hasTable('profiles') && $this->allTableColumnsExist('profiles', ['id', 'tenant_id'])) {
            try {
                $profileIds = DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->pluck('id')
                    ->filter()
                    ->values()
                    ->all();
            } catch (\Throwable $e) {
                $profileIds = [];
            }
        }

        $userRows = [];
        if (! empty($profileIds) && $this->hasTable('users')) {
            try {
                $userRows = DB::table('users')
                    ->whereIn('id', $profileIds)
                    ->orderBy('created_at')
                    ->get([
                        'id',
                        'name',
                        'email',
                        'email_verified_at',
                        'created_at',
                        'updated_at',
                    ])
                    ->all();
            } catch (\Throwable $e) {
                $userRows = [];
            }
        }

        $tables[] = $this->makeBackupTable('users', $userRows);

        return $tables;
    }

    private function buildStudentBackupTables(string $tenantId, ?string $periodStartDate = null, ?string $periodStartDateTime = null): array
    {
        $tables = [];
        $studentRows = [];

        if ($this->hasTable('profiles') && $this->allTableColumnsExist('profiles', ['tenant_id', 'id', 'role'])) {
            $columns = array_values(array_filter(
                ['id', 'nama', 'email', 'kelas', 'nis', 'status', 'jk', 'no_hp_siswa', 'no_hp_wali', 'jabatan'],
                fn ($column) => $this->tableHasColumn('profiles', $column)
            ));
            if (! in_array('id', $columns, true)) {
                $columns[] = 'id';
            }

            $query = DB::table('profiles')
                ->where('tenant_id', $tenantId)
                ->where('role', 'siswa');
            if ($this->tableHasColumn('profiles', 'kelas')) {
                $query->orderBy('kelas');
            }
            if ($this->tableHasColumn('profiles', 'nama')) {
                $query->orderBy('nama');
            } else {
                $query->orderBy('id');
            }

            $studentRows = $query->get($columns)->all();
        }

        $studentOrder = [];
        $studentMeta = [];
        $studentIdsByClass = [];
        $summaryByStudent = [];
        $counter = 0;

        foreach ($studentRows as $row) {
            $item = (array) $row;
            $studentId = (string) ($item['id'] ?? '');
            if ($studentId === '') {
                continue;
            }

            $counter++;
            $kelas = trim((string) ($item['kelas'] ?? '')) ?: '-';
            $jabatan = trim((string) ($item['jabatan'] ?? '')) ?: '-';

            $studentOrder[] = $studentId;
            $studentMeta[$studentId] = [
                'id' => $studentId,
                'no' => $counter,
                'nama' => trim((string) ($item['nama'] ?? '')) ?: '-',
                'email' => trim((string) ($item['email'] ?? '')) ?: '-',
                'kelas' => $kelas,
                'nis' => trim((string) ($item['nis'] ?? '')) ?: '-',
                'status' => trim((string) ($item['status'] ?? '')) ?: '-',
                'jk' => trim((string) ($item['jk'] ?? '')) ?: '-',
                'no_hp_siswa' => trim((string) ($item['no_hp_siswa'] ?? '')) ?: '-',
                'no_hp_wali' => trim((string) ($item['no_hp_wali'] ?? '')) ?: '-',
                'jabatan' => $jabatan,
            ];
            $studentIdsByClass[$kelas][] = $studentId;

            $summaryByStudent[$studentId] = [
                'nilai_values' => [],
                'absensi' => ['Hadir' => 0, 'Izin' => 0, 'Sakit' => 0, 'Alpha' => 0],
                'eskul' => ['Hadir' => 0, 'Izin' => 0, 'Alpha' => 0],
                'mapel_keys' => [],
                'ekskul_keys' => [],
                'organisasi_keys' => [],
                'tugas_count' => 0,
                'quiz_count' => 0,
            ];
        }

        $mapelDiikutiRows = [];
        if (
            ! empty($studentOrder)
            && $this->hasTable('jadwal')
            && $this->allTableColumnsExist('jadwal', ['tenant_id', 'kelas_id', 'mapel'])
        ) {
            try {
                $kelasList = array_values(array_filter(array_keys($studentIdsByClass), fn ($value) => $value !== '' && $value !== '-'));
                if (! empty($kelasList)) {
                    $selectColumns = ['j.kelas_id', 'j.mapel'];
                    if ($this->tableHasColumn('jadwal', 'hari')) {
                        $selectColumns[] = 'j.hari';
                    }
                    if ($this->tableHasColumn('jadwal', 'jam_mulai')) {
                        $selectColumns[] = 'j.jam_mulai';
                    }
                    if ($this->tableHasColumn('jadwal', 'jam_selesai')) {
                        $selectColumns[] = 'j.jam_selesai';
                    }
                    if ($this->tableHasColumn('jadwal', 'guru_nama')) {
                        $selectColumns[] = 'j.guru_nama';
                    }

                    $jadwalRows = DB::table('jadwal as j')
                        ->where('j.tenant_id', $tenantId)
                        ->whereIn('j.kelas_id', $kelasList)
                        ->orderBy('j.kelas_id')
                        ->orderBy('j.mapel')
                        ->get($selectColumns);

                    $mapelByClass = [];
                    foreach ($jadwalRows as $row) {
                        $kelas = trim((string) ($row->kelas_id ?? ''));
                        if ($kelas === '') {
                            continue;
                        }
                        $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                        $key = $kelas.'|'.$mapel;
                        if (! isset($mapelByClass[$key])) {
                            $mapelByClass[$key] = [
                                'kelas' => $kelas,
                                'mapel' => $mapel,
                                'hari' => [],
                                'jam_mulai' => null,
                                'jam_selesai' => null,
                                'guru_nama' => [],
                            ];
                        }

                        $hari = trim((string) ($row->hari ?? ''));
                        if ($hari !== '') {
                            $mapelByClass[$key]['hari'][$hari] = true;
                        }

                        $jamMulai = trim((string) ($row->jam_mulai ?? ''));
                        if ($jamMulai !== '') {
                            if ($mapelByClass[$key]['jam_mulai'] === null || $jamMulai < $mapelByClass[$key]['jam_mulai']) {
                                $mapelByClass[$key]['jam_mulai'] = $jamMulai;
                            }
                        }

                        $jamSelesai = trim((string) ($row->jam_selesai ?? ''));
                        if ($jamSelesai !== '') {
                            if ($mapelByClass[$key]['jam_selesai'] === null || $jamSelesai > $mapelByClass[$key]['jam_selesai']) {
                                $mapelByClass[$key]['jam_selesai'] = $jamSelesai;
                            }
                        }

                        $guruNama = trim((string) ($row->guru_nama ?? ''));
                        if ($guruNama !== '') {
                            $mapelByClass[$key]['guru_nama'][$guruNama] = true;
                        }
                    }

                    foreach ($mapelByClass as $entry) {
                        $kelas = (string) ($entry['kelas'] ?? '-');
                        $studentIds = $studentIdsByClass[$kelas] ?? [];
                        foreach ($studentIds as $studentId) {
                            $meta = $studentMeta[$studentId] ?? null;
                            if (! $meta) {
                                continue;
                            }

                            $summaryByStudent[$studentId]['mapel_keys'][(string) $entry['mapel']] = true;
                            $mapelDiikutiRows[] = [
                                'no' => $meta['no'],
                                'kelas' => $meta['kelas'],
                                'nis' => $meta['nis'],
                                'nama_siswa' => $meta['nama'],
                                'mapel' => $entry['mapel'],
                                'hari' => implode(', ', array_keys($entry['hari'] ?? [])),
                                'jam_mulai' => $entry['jam_mulai'],
                                'jam_selesai' => $entry['jam_selesai'],
                                'guru_mapel' => implode(', ', array_keys($entry['guru_nama'] ?? [])),
                            ];
                        }
                    }
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $nilaiByStudentMapel = [];
        $nilaiByStudent = [];

        if (
            ! empty($studentOrder)
            && $this->hasTable('tugas_jawaban')
            && $this->hasTable('tugas')
            && $this->allTableColumnsExist('tugas_jawaban', ['tenant_id', 'user_id', 'tugas_id', 'nilai'])
            && $this->allTableColumnsExist('tugas', ['tenant_id', 'id', 'mapel'])
        ) {
            try {
                $tugasScoresQuery = DB::table('tugas_jawaban as tj')
                    ->join('tugas as t', 't.id', '=', 'tj.tugas_id')
                    ->where('tj.tenant_id', $tenantId)
                    ->where('t.tenant_id', $tenantId)
                    ->whereIn('tj.user_id', $studentOrder)
                    ->whereNotNull('tj.nilai');

                if ($periodStartDateTime !== null) {
                    if ($this->tableHasColumn('tugas_jawaban', 'waktu_submit')) {
                        $tugasScoresQuery->where('tj.waktu_submit', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('tugas_jawaban', 'created_at')) {
                        $tugasScoresQuery->where('tj.created_at', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('tugas', 'created_at')) {
                        $tugasScoresQuery->where('t.created_at', '>=', $periodStartDateTime);
                    }
                }

                $tugasScores = $tugasScoresQuery
                    ->select(
                        'tj.user_id as siswa_id',
                        't.mapel',
                        DB::raw('AVG(tj.nilai) as avg_tugas'),
                        DB::raw('COUNT(*) as jumlah_tugas')
                    )
                    ->groupBy('tj.user_id', 't.mapel')
                    ->get();

                foreach ($tugasScores as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    if ($studentId === '' || ! isset($summaryByStudent[$studentId])) {
                        continue;
                    }

                    $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                    $key = $studentId.'|'.$mapel;
                    if (! isset($nilaiByStudentMapel[$key])) {
                        $nilaiByStudentMapel[$key] = [
                            'siswa_id' => $studentId,
                            'mapel' => $mapel,
                            'avg_tugas' => null,
                            'jumlah_tugas' => 0,
                            'avg_quiz' => null,
                            'jumlah_quiz' => 0,
                        ];
                    }

                    $nilaiByStudentMapel[$key]['avg_tugas'] = $this->toFloatOrNull($row->avg_tugas ?? null);
                    $nilaiByStudentMapel[$key]['jumlah_tugas'] = (int) ($row->jumlah_tugas ?? 0);
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        if (
            ! empty($studentOrder)
            && $this->hasTable('quiz_submissions')
            && $this->hasTable('quizzes')
            && $this->allTableColumnsExist('quiz_submissions', ['tenant_id', 'siswa_id', 'quiz_id', 'score'])
            && $this->allTableColumnsExist('quizzes', ['tenant_id', 'id', 'mapel'])
        ) {
            try {
                $quizScoresQuery = DB::table('quiz_submissions as qs')
                    ->join('quizzes as q', 'q.id', '=', 'qs.quiz_id')
                    ->where('qs.tenant_id', $tenantId)
                    ->where('q.tenant_id', $tenantId)
                    ->whereIn('qs.siswa_id', $studentOrder)
                    ->whereNotNull('qs.score');

                if ($periodStartDateTime !== null) {
                    if ($this->tableHasColumn('quiz_submissions', 'finished_at')) {
                        $quizScoresQuery->where('qs.finished_at', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('quiz_submissions', 'updated_at')) {
                        $quizScoresQuery->where('qs.updated_at', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('quiz_submissions', 'created_at')) {
                        $quizScoresQuery->where('qs.created_at', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('quizzes', 'created_at')) {
                        $quizScoresQuery->where('q.created_at', '>=', $periodStartDateTime);
                    }
                }

                $quizScores = $quizScoresQuery
                    ->select(
                        'qs.siswa_id',
                        'q.mapel',
                        DB::raw('AVG(qs.score) as avg_quiz'),
                        DB::raw('COUNT(*) as jumlah_quiz')
                    )
                    ->groupBy('qs.siswa_id', 'q.mapel')
                    ->get();

                foreach ($quizScores as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    if ($studentId === '' || ! isset($summaryByStudent[$studentId])) {
                        continue;
                    }

                    $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                    $key = $studentId.'|'.$mapel;
                    if (! isset($nilaiByStudentMapel[$key])) {
                        $nilaiByStudentMapel[$key] = [
                            'siswa_id' => $studentId,
                            'mapel' => $mapel,
                            'avg_tugas' => null,
                            'jumlah_tugas' => 0,
                            'avg_quiz' => null,
                            'jumlah_quiz' => 0,
                        ];
                    }

                    $nilaiByStudentMapel[$key]['avg_quiz'] = $this->toFloatOrNull($row->avg_quiz ?? null);
                    $nilaiByStudentMapel[$key]['jumlah_quiz'] = (int) ($row->jumlah_quiz ?? 0);
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        foreach ($nilaiByStudentMapel as $entry) {
            $studentId = (string) ($entry['siswa_id'] ?? '');
            if ($studentId === '') {
                continue;
            }
            $nilaiByStudent[$studentId][] = $entry;
        }

        $nilaiMapelRows = [];
        foreach ($studentOrder as $studentId) {
            $meta = $studentMeta[$studentId] ?? null;
            if (! $meta) {
                continue;
            }

            $entries = $nilaiByStudent[$studentId] ?? [];
            usort($entries, fn ($a, $b) => strcasecmp((string) ($a['mapel'] ?? ''), (string) ($b['mapel'] ?? '')));
            foreach ($entries as $entry) {
                $avgTugas = $this->toFloatOrNull($entry['avg_tugas'] ?? null);
                $avgQuiz = $this->toFloatOrNull($entry['avg_quiz'] ?? null);
                $nilaiAkhir = $this->combineAcademicScore($avgTugas, $avgQuiz);
                if ($nilaiAkhir !== null) {
                    $summaryByStudent[$studentId]['nilai_values'][] = $nilaiAkhir;
                }
                $summaryByStudent[$studentId]['mapel_keys'][(string) ($entry['mapel'] ?? 'Tanpa Mapel')] = true;

                $nilaiMapelRows[] = [
                    'no' => $meta['no'],
                    'kelas' => $meta['kelas'],
                    'nis' => $meta['nis'],
                    'nama_siswa' => $meta['nama'],
                    'mapel' => $entry['mapel'] ?? 'Tanpa Mapel',
                    'rata_tugas' => $avgTugas,
                    'jumlah_tugas_dinilai' => (int) ($entry['jumlah_tugas'] ?? 0),
                    'rata_quiz' => $avgQuiz,
                    'jumlah_quiz_dinilai' => (int) ($entry['jumlah_quiz'] ?? 0),
                    'nilai_akhir_mapel' => $nilaiAkhir,
                ];
            }
        }

        $tugasDetailRows = [];
        if (
            ! empty($studentOrder)
            && $this->hasTable('tugas_jawaban')
            && $this->hasTable('tugas')
            && $this->allTableColumnsExist('tugas_jawaban', ['tenant_id', 'user_id', 'tugas_id'])
            && $this->allTableColumnsExist('tugas', ['tenant_id', 'id', 'mapel', 'kelas', 'judul'])
        ) {
            try {
                $tugasDetailQuery = DB::table('tugas_jawaban as tj')
                    ->join('tugas as t', 't.id', '=', 'tj.tugas_id')
                    ->where('tj.tenant_id', $tenantId)
                    ->where('t.tenant_id', $tenantId)
                    ->whereIn('tj.user_id', $studentOrder);

                $hasCreatorJoin = $this->tableHasColumn('tugas', 'created_by')
                    && $this->hasTable('profiles')
                    && $this->allTableColumnsExist('profiles', ['id']);
                if ($hasCreatorJoin) {
                    $tugasDetailQuery->leftJoin('profiles as pg', function ($join) {
                        $join->on('pg.id', '=', 't.created_by');
                        if ($this->tableHasColumn('profiles', 'tenant_id')) {
                            $join->whereColumn('pg.tenant_id', 't.tenant_id');
                        }
                    });
                }

                if ($periodStartDateTime !== null) {
                    if ($this->tableHasColumn('tugas_jawaban', 'waktu_submit')) {
                        $tugasDetailQuery->where('tj.waktu_submit', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('tugas_jawaban', 'created_at')) {
                        $tugasDetailQuery->where('tj.created_at', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('tugas', 'created_at')) {
                        $tugasDetailQuery->where('t.created_at', '>=', $periodStartDateTime);
                    }
                }

                $selectColumns = [
                    'tj.user_id as siswa_id',
                    't.id as tugas_id',
                    't.kelas',
                    't.mapel',
                    't.judul',
                ];
                if ($this->tableHasColumn('tugas', 'mulai')) {
                    $selectColumns[] = 't.mulai';
                }
                if ($this->tableHasColumn('tugas', 'deadline')) {
                    $selectColumns[] = 't.deadline';
                }
                if ($this->tableHasColumn('tugas_jawaban', 'waktu_submit')) {
                    $selectColumns[] = 'tj.waktu_submit';
                }
                if ($this->tableHasColumn('tugas_jawaban', 'status')) {
                    $selectColumns[] = 'tj.status';
                }
                if ($this->tableHasColumn('tugas_jawaban', 'nilai')) {
                    $selectColumns[] = 'tj.nilai';
                }
                if ($this->tableHasColumn('tugas_jawaban', 'file_name')) {
                    $selectColumns[] = 'tj.file_name';
                }
                if ($hasCreatorJoin) {
                    $selectColumns[] = DB::raw("COALESCE(pg.nama, '-') as guru_pembuat");
                } else {
                    $selectColumns[] = DB::raw("'-' as guru_pembuat");
                }

                $tugasDetails = $tugasDetailQuery
                    ->orderByDesc($this->tableHasColumn('tugas_jawaban', 'waktu_submit') ? 'tj.waktu_submit' : 'tj.id')
                    ->get($selectColumns);

                foreach ($tugasDetails as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    $meta = $studentMeta[$studentId] ?? null;
                    if (! $meta) {
                        continue;
                    }

                    $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                    $summaryByStudent[$studentId]['tugas_count'] += 1;
                    $summaryByStudent[$studentId]['mapel_keys'][$mapel] = true;

                    $tugasDetailRows[] = [
                        'no' => $meta['no'],
                        'kelas' => $meta['kelas'],
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'mapel' => $mapel,
                        'tugas_id' => $row->tugas_id,
                        'judul_tugas' => $row->judul,
                        'mulai_tugas' => $row->mulai ?? null,
                        'deadline_tugas' => $row->deadline ?? null,
                        'waktu_submit' => $row->waktu_submit ?? null,
                        'status_jawaban' => $row->status ?? null,
                        'nilai' => $row->nilai ?? null,
                        'nama_file' => $row->file_name ?? null,
                        'guru_pembuat' => $row->guru_pembuat ?? '-',
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $quizDetailRows = [];
        if (
            ! empty($studentOrder)
            && $this->hasTable('quiz_submissions')
            && $this->hasTable('quizzes')
            && $this->allTableColumnsExist('quiz_submissions', ['tenant_id', 'siswa_id', 'quiz_id'])
            && $this->allTableColumnsExist('quizzes', ['tenant_id', 'id', 'mapel', 'nama'])
        ) {
            try {
                $quizDetailQuery = DB::table('quiz_submissions as qs')
                    ->join('quizzes as q', 'q.id', '=', 'qs.quiz_id')
                    ->where('qs.tenant_id', $tenantId)
                    ->where('q.tenant_id', $tenantId)
                    ->whereIn('qs.siswa_id', $studentOrder);

                $hasGuruJoin = $this->tableHasColumn('quizzes', 'guru_id')
                    && $this->hasTable('profiles')
                    && $this->allTableColumnsExist('profiles', ['id']);
                if ($hasGuruJoin) {
                    $quizDetailQuery->leftJoin('profiles as pgq', function ($join) {
                        $join->on('pgq.id', '=', 'q.guru_id');
                        if ($this->tableHasColumn('profiles', 'tenant_id')) {
                            $join->whereColumn('pgq.tenant_id', 'q.tenant_id');
                        }
                    });
                }

                if ($periodStartDateTime !== null) {
                    if ($this->tableHasColumn('quiz_submissions', 'finished_at')) {
                        $quizDetailQuery->where('qs.finished_at', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('quiz_submissions', 'updated_at')) {
                        $quizDetailQuery->where('qs.updated_at', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('quiz_submissions', 'created_at')) {
                        $quizDetailQuery->where('qs.created_at', '>=', $periodStartDateTime);
                    } elseif ($this->tableHasColumn('quizzes', 'created_at')) {
                        $quizDetailQuery->where('q.created_at', '>=', $periodStartDateTime);
                    }
                }

                $selectColumns = [
                    'qs.siswa_id',
                    'qs.quiz_id',
                    'q.kelas_id',
                    'q.mapel',
                    'q.nama as quiz_nama',
                ];
                if ($this->tableHasColumn('quizzes', 'mode')) {
                    $selectColumns[] = 'q.mode';
                }
                if ($this->tableHasColumn('quizzes', 'starts_at')) {
                    $selectColumns[] = 'q.starts_at';
                }
                if ($this->tableHasColumn('quizzes', 'deadline_at')) {
                    $selectColumns[] = 'q.deadline_at';
                }
                if ($this->tableHasColumn('quizzes', 'duration_minutes')) {
                    $selectColumns[] = 'q.duration_minutes';
                }
                if ($this->tableHasColumn('quiz_submissions', 'started_at')) {
                    $selectColumns[] = 'qs.started_at';
                }
                if ($this->tableHasColumn('quiz_submissions', 'finished_at')) {
                    $selectColumns[] = 'qs.finished_at';
                }
                if ($this->tableHasColumn('quiz_submissions', 'status')) {
                    $selectColumns[] = 'qs.status';
                }
                if ($this->tableHasColumn('quiz_submissions', 'score')) {
                    $selectColumns[] = 'qs.score';
                }
                if ($this->tableHasColumn('quiz_submissions', 'total_points')) {
                    $selectColumns[] = 'qs.total_points';
                }
                if ($hasGuruJoin) {
                    $selectColumns[] = DB::raw("COALESCE(pgq.nama, '-') as guru_quiz");
                } else {
                    $selectColumns[] = DB::raw("'-' as guru_quiz");
                }

                $quizDetails = $quizDetailQuery
                    ->orderByDesc($this->tableHasColumn('quiz_submissions', 'finished_at') ? 'qs.finished_at' : 'qs.id')
                    ->get($selectColumns);

                foreach ($quizDetails as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    $meta = $studentMeta[$studentId] ?? null;
                    if (! $meta) {
                        continue;
                    }

                    $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                    $summaryByStudent[$studentId]['quiz_count'] += 1;
                    $summaryByStudent[$studentId]['mapel_keys'][$mapel] = true;

                    $durationMinutes = null;
                    $startedAt = (string) ($row->started_at ?? '');
                    $finishedAt = (string) ($row->finished_at ?? '');
                    if ($startedAt !== '' && $finishedAt !== '') {
                        $startTs = strtotime($startedAt);
                        $endTs = strtotime($finishedAt);
                        if ($startTs !== false && $endTs !== false && $endTs >= $startTs) {
                            $durationMinutes = round(($endTs - $startTs) / 60, 2);
                        }
                    }

                    $quizDetailRows[] = [
                        'no' => $meta['no'],
                        'kelas' => $meta['kelas'],
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'mapel' => $mapel,
                        'quiz_id' => $row->quiz_id,
                        'nama_quiz' => $row->quiz_nama,
                        'mode_quiz' => $row->mode ?? null,
                        'quiz_mulai' => $row->starts_at ?? null,
                        'quiz_deadline' => $row->deadline_at ?? null,
                        'durasi_quiz_menit' => $row->duration_minutes ?? null,
                        'mulai_mengerjakan' => $row->started_at ?? null,
                        'selesai_mengerjakan' => $row->finished_at ?? null,
                        'durasi_mengerjakan_menit' => $durationMinutes,
                        'status_submission' => $row->status ?? null,
                        'nilai_quiz' => $row->score ?? null,
                        'total_poin_quiz' => $row->total_points ?? null,
                        'guru_quiz' => $row->guru_quiz ?? '-',
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $absensiMapelRows = [];
        $absensiDetailRows = [];
        if (
            ! empty($studentOrder)
            && $this->hasTable('absensi')
            && $this->allTableColumnsExist('absensi', ['tenant_id', 'uid', 'status', 'mapel'])
        ) {
            try {
                $absensiRowsQuery = DB::table('absensi as a')
                    ->where('a.tenant_id', $tenantId)
                    ->whereIn('a.uid', $studentOrder);
                if ($periodStartDate !== null && $this->tableHasColumn('absensi', 'tanggal')) {
                    $absensiRowsQuery->where('a.tanggal', '>=', $periodStartDate);
                }

                $absensiRows = $absensiRowsQuery
                    ->select(
                        'a.uid as siswa_id',
                        DB::raw('MAX(a.kelas) as kelas'),
                        'a.mapel',
                        DB::raw("SUM(CASE WHEN a.status = 'Hadir' THEN 1 ELSE 0 END) as hadir"),
                        DB::raw("SUM(CASE WHEN a.status = 'Izin' THEN 1 ELSE 0 END) as izin"),
                        DB::raw("SUM(CASE WHEN a.status = 'Sakit' THEN 1 ELSE 0 END) as sakit"),
                        DB::raw("SUM(CASE WHEN a.status = 'Alpha' THEN 1 ELSE 0 END) as alpha")
                    )
                    ->groupBy('a.uid', 'a.mapel')
                    ->get();

                foreach ($absensiRows as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    if ($studentId === '' || ! isset($summaryByStudent[$studentId])) {
                        continue;
                    }

                    $meta = $studentMeta[$studentId];
                    $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                    $hadir = (int) ($row->hadir ?? 0);
                    $izin = (int) ($row->izin ?? 0);
                    $sakit = (int) ($row->sakit ?? 0);
                    $alpha = (int) ($row->alpha ?? 0);

                    $summaryByStudent[$studentId]['mapel_keys'][$mapel] = true;
                    $summaryByStudent[$studentId]['absensi']['Hadir'] += $hadir;
                    $summaryByStudent[$studentId]['absensi']['Izin'] += $izin;
                    $summaryByStudent[$studentId]['absensi']['Sakit'] += $sakit;
                    $summaryByStudent[$studentId]['absensi']['Alpha'] += $alpha;

                    $kelas = trim((string) ($row->kelas ?? '')) ?: $meta['kelas'];
                    $absensiMapelRows[] = [
                        'no' => $meta['no'],
                        'kelas' => $kelas ?: '-',
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'mapel' => $mapel,
                        'hadir' => $hadir,
                        'izin' => $izin,
                        'sakit' => $sakit,
                        'alpha' => $alpha,
                    ];
                }

                $absensiDetailQuery = DB::table('absensi as a')
                    ->where('a.tenant_id', $tenantId)
                    ->whereIn('a.uid', $studentOrder);
                if ($periodStartDate !== null && $this->tableHasColumn('absensi', 'tanggal')) {
                    $absensiDetailQuery->where('a.tanggal', '>=', $periodStartDate);
                }

                $detailSelect = [
                    'a.uid as siswa_id',
                    'a.kelas',
                    'a.tanggal',
                    'a.mapel',
                    'a.status',
                ];
                if ($this->tableHasColumn('absensi', 'waktu')) {
                    $detailSelect[] = 'a.waktu';
                }
                if ($this->tableHasColumn('absensi', 'komentar')) {
                    $detailSelect[] = 'a.komentar';
                }

                $absensiDetails = $absensiDetailQuery
                    ->orderByDesc('a.tanggal')
                    ->orderByDesc($this->tableHasColumn('absensi', 'waktu') ? 'a.waktu' : 'a.id')
                    ->get($detailSelect);

                foreach ($absensiDetails as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    $meta = $studentMeta[$studentId] ?? null;
                    if (! $meta) {
                        continue;
                    }

                    $absensiDetailRows[] = [
                        'no' => $meta['no'],
                        'kelas' => trim((string) ($row->kelas ?? '')) ?: $meta['kelas'],
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'tanggal' => $row->tanggal ?? null,
                        'mapel' => $this->normalizeBackupMapel($row->mapel ?? null),
                        'status' => $row->status ?? null,
                        'waktu' => $row->waktu ?? null,
                        'keterangan' => $row->komentar ?? null,
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $eskulAttendanceRows = [];
        if (
            ! empty($studentOrder)
            && $this->hasTable('absensi_eskul')
            && $this->allTableColumnsExist('absensi_eskul', ['tenant_id', 'user_id', 'status', 'ekskul_id'])
        ) {
            try {
                $attendanceQuery = DB::table('absensi_eskul as ae')
                    ->where('ae.tenant_id', $tenantId)
                    ->whereIn('ae.user_id', $studentOrder);

                if ($periodStartDate !== null && $this->tableHasColumn('absensi_eskul', 'tanggal')) {
                    $attendanceQuery->where('ae.tanggal', '>=', $periodStartDate);
                }

                $hasEkskulJoin = $this->hasTable('ekskul') && $this->allTableColumnsExist('ekskul', ['id']);
                if ($hasEkskulJoin) {
                    $attendanceQuery->leftJoin('ekskul as e', function ($join) {
                        $join->on('e.id', '=', 'ae.ekskul_id');
                        if ($this->tableHasColumn('ekskul', 'tenant_id') && $this->tableHasColumn('absensi_eskul', 'tenant_id')) {
                            $join->whereColumn('e.tenant_id', 'ae.tenant_id');
                        }
                    });
                }

                $namaEkskulExpression = $hasEkskulJoin
                    ? DB::raw("COALESCE(MAX(e.nama), 'Tanpa Eskul') as nama_ekskul")
                    : DB::raw("'Tanpa Eskul' as nama_ekskul");

                $attendanceRows = $attendanceQuery
                    ->select(
                        'ae.user_id as siswa_id',
                        'ae.ekskul_id',
                        $namaEkskulExpression,
                        DB::raw("SUM(CASE WHEN ae.status = 'Hadir' THEN 1 ELSE 0 END) as hadir"),
                        DB::raw("SUM(CASE WHEN ae.status = 'Izin' THEN 1 ELSE 0 END) as izin"),
                        DB::raw("SUM(CASE WHEN ae.status = 'Alpha' THEN 1 ELSE 0 END) as alpha")
                    )
                    ->groupBy('ae.user_id', 'ae.ekskul_id')
                    ->get();

                foreach ($attendanceRows as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    if ($studentId === '' || ! isset($summaryByStudent[$studentId])) {
                        continue;
                    }

                    $meta = $studentMeta[$studentId];
                    $ekskulId = (string) ($row->ekskul_id ?? '');
                    if ($ekskulId !== '') {
                        $summaryByStudent[$studentId]['ekskul_keys'][$ekskulId] = true;
                    }

                    $hadir = (int) ($row->hadir ?? 0);
                    $izin = (int) ($row->izin ?? 0);
                    $alpha = (int) ($row->alpha ?? 0);

                    $summaryByStudent[$studentId]['eskul']['Hadir'] += $hadir;
                    $summaryByStudent[$studentId]['eskul']['Izin'] += $izin;
                    $summaryByStudent[$studentId]['eskul']['Alpha'] += $alpha;

                    $eskulAttendanceRows[] = [
                        'no' => $meta['no'],
                        'kelas' => $meta['kelas'],
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'ekskul_id' => $row->ekskul_id,
                        'ekskul' => trim((string) ($row->nama_ekskul ?? '')) ?: 'Tanpa Eskul',
                        'hadir' => $hadir,
                        'izin' => $izin,
                        'alpha' => $alpha,
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $eskulMemberRows = [];
        if (
            ! empty($studentOrder)
            && $this->hasTable('ekskul_anggota')
            && $this->allTableColumnsExist('ekskul_anggota', ['tenant_id', 'ekskul_id', 'user_id'])
        ) {
            try {
                $memberQuery = DB::table('ekskul_anggota as ea')
                    ->where('ea.tenant_id', $tenantId)
                    ->whereIn('ea.user_id', $studentOrder);

                if ($periodStartDateTime !== null && $this->tableHasColumn('ekskul_anggota', 'created_at')) {
                    $memberQuery->where('ea.created_at', '>=', $periodStartDateTime);
                }

                $hasEkskulJoin = $this->hasTable('ekskul') && $this->allTableColumnsExist('ekskul', ['id']);
                if ($hasEkskulJoin) {
                    $memberQuery->leftJoin('ekskul as e', function ($join) {
                        $join->on('e.id', '=', 'ea.ekskul_id');
                        if ($this->tableHasColumn('ekskul', 'tenant_id')) {
                            $join->whereColumn('e.tenant_id', 'ea.tenant_id');
                        }
                    });
                }

                $hasPembinaJoin = $hasEkskulJoin
                    && $this->tableHasColumn('ekskul', 'pembina_guru_id')
                    && $this->hasTable('profiles')
                    && $this->allTableColumnsExist('profiles', ['id']);
                if ($hasPembinaJoin) {
                    $memberQuery->leftJoin('profiles as pg', function ($join) {
                        $join->on('pg.id', '=', 'e.pembina_guru_id');
                        if ($this->tableHasColumn('profiles', 'tenant_id') && $this->tableHasColumn('ekskul', 'tenant_id')) {
                            $join->whereColumn('pg.tenant_id', 'e.tenant_id');
                        }
                    });
                }

                $selectColumns = [
                    'ea.ekskul_id',
                    'ea.user_id as siswa_id',
                    $hasEkskulJoin ? DB::raw("COALESCE(e.nama, 'Tanpa Eskul') as nama_ekskul") : DB::raw("'Tanpa Eskul' as nama_ekskul"),
                    ($hasEkskulJoin && $this->tableHasColumn('ekskul', 'hari')) ? DB::raw("COALESCE(e.hari, '-') as hari") : DB::raw("'-' as hari"),
                    ($hasEkskulJoin && $this->tableHasColumn('ekskul', 'jam_mulai')) ? DB::raw('e.jam_mulai as jam_mulai') : DB::raw('null as jam_mulai'),
                    ($hasEkskulJoin && $this->tableHasColumn('ekskul', 'jam_selesai')) ? DB::raw('e.jam_selesai as jam_selesai') : DB::raw('null as jam_selesai'),
                    $hasPembinaJoin ? DB::raw("COALESCE(pg.nama, '-') as pembina") : DB::raw("'-' as pembina"),
                ];

                $memberRows = $memberQuery
                    ->select($selectColumns)
                    ->orderBy('ea.ekskul_id')
                    ->get();

                $seenMemberKey = [];
                foreach ($memberRows as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    if ($studentId === '' || ! isset($studentMeta[$studentId])) {
                        continue;
                    }

                    $key = $studentId.'|'.(string) ($row->ekskul_id ?? '');
                    if (isset($seenMemberKey[$key])) {
                        continue;
                    }
                    $seenMemberKey[$key] = true;

                    $meta = $studentMeta[$studentId];
                    $ekskulId = (string) ($row->ekskul_id ?? '');
                    if ($ekskulId !== '') {
                        $summaryByStudent[$studentId]['ekskul_keys'][$ekskulId] = true;
                    }

                    $eskulMemberRows[] = [
                        'no' => $meta['no'],
                        'kelas' => $meta['kelas'],
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'ekskul_id' => $row->ekskul_id,
                        'ekskul' => trim((string) ($row->nama_ekskul ?? '')) ?: 'Tanpa Eskul',
                        'hari' => $row->hari ?? '-',
                        'jam_mulai' => $row->jam_mulai ?? null,
                        'jam_selesai' => $row->jam_selesai ?? null,
                        'pembina' => $row->pembina ?? '-',
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $organisasiRows = [];
        $orgRowNumber = 1;
        foreach ($studentOrder as $studentId) {
            $meta = $studentMeta[$studentId] ?? null;
            if (! $meta) {
                continue;
            }
            if (($meta['jabatan'] ?? '-') !== '-') {
                $summaryByStudent[$studentId]['organisasi_keys']['profile:'.$meta['jabatan']] = true;
                $organisasiRows[] = [
                    'no' => $orgRowNumber++,
                    'kelas' => $meta['kelas'],
                    'nis' => $meta['nis'],
                    'nama_siswa' => $meta['nama'],
                    'sumber' => 'Profil',
                    'organisasi' => 'Jabatan Profil',
                    'jabatan' => $meta['jabatan'],
                    'status_keanggotaan' => 'aktif',
                ];
            }
        }

        if (
            ! empty($studentOrder)
            && $this->hasTable('kelas_struktur')
            && $this->allTableColumnsExist('kelas_struktur', ['tenant_id', 'kelas_id', 'ketua_siswa_id'])
        ) {
            try {
                $kelasStructRows = DB::table('kelas_struktur')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('ketua_siswa_id', $studentOrder)
                    ->get(['kelas_id', 'ketua_siswa_id', 'ketua_siswa_nama']);

                foreach ($kelasStructRows as $row) {
                    $studentId = (string) ($row->ketua_siswa_id ?? '');
                    $meta = $studentMeta[$studentId] ?? null;
                    if (! $meta) {
                        continue;
                    }

                    $orgKey = 'kelas:'.(string) ($row->kelas_id ?? '');
                    $summaryByStudent[$studentId]['organisasi_keys'][$orgKey] = true;
                    $organisasiRows[] = [
                        'no' => $orgRowNumber++,
                        'kelas' => $meta['kelas'],
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'sumber' => 'Kelas',
                        'organisasi' => 'Kelas '.(string) ($row->kelas_id ?? '-'),
                        'jabatan' => 'Ketua Kelas',
                        'status_keanggotaan' => 'aktif',
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        if (
            ! empty($studentOrder)
            && $this->hasTable('organisasi_anggota')
            && $this->allTableColumnsExist('organisasi_anggota', ['tenant_id', 'siswa_id'])
        ) {
            try {
                $orgQuery = DB::table('organisasi_anggota as oa')
                    ->where('oa.tenant_id', $tenantId)
                    ->whereIn('oa.siswa_id', $studentOrder);

                if ($periodStartDateTime !== null && $this->tableHasColumn('organisasi_anggota', 'created_at')) {
                    $orgQuery->where('oa.created_at', '>=', $periodStartDateTime);
                }

                $hasOrgJoin = $this->hasTable('organisasi') && $this->allTableColumnsExist('organisasi', ['id']);
                if ($hasOrgJoin) {
                    $orgQuery->leftJoin('organisasi as o', function ($join) {
                        $join->on('o.id', '=', 'oa.organisasi_id');
                        if ($this->tableHasColumn('organisasi', 'tenant_id') && $this->tableHasColumn('organisasi_anggota', 'tenant_id')) {
                            $join->whereColumn('o.tenant_id', 'oa.tenant_id');
                        }
                    });
                }

                $jabatanExpr = $this->tableHasColumn('organisasi_anggota', 'jabatan')
                    ? DB::raw("COALESCE(oa.jabatan, 'Anggota') as jabatan")
                    : DB::raw("'Anggota' as jabatan");
                $namaOrgExpr = $hasOrgJoin
                    ? DB::raw("COALESCE(o.nama, COALESCE(oa.organisasi_id, 'Organisasi')) as nama_organisasi")
                    : ($this->tableHasColumn('organisasi_anggota', 'organisasi_id')
                        ? DB::raw("COALESCE(oa.organisasi_id, 'Organisasi') as nama_organisasi")
                        : DB::raw("'Organisasi' as nama_organisasi"));

                $orgRows = $orgQuery->select('oa.siswa_id', $namaOrgExpr, $jabatanExpr)->get();
                foreach ($orgRows as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    $meta = $studentMeta[$studentId] ?? null;
                    if (! $meta) {
                        continue;
                    }

                    $orgName = trim((string) ($row->nama_organisasi ?? '')) ?: 'Organisasi';
                    $jabatan = trim((string) ($row->jabatan ?? '')) ?: 'Anggota';
                    $summaryByStudent[$studentId]['organisasi_keys']['org:'.$orgName.':'.$jabatan] = true;
                    $organisasiRows[] = [
                        'no' => $orgRowNumber++,
                        'kelas' => $meta['kelas'],
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'sumber' => 'Organisasi',
                        'organisasi' => $orgName,
                        'jabatan' => $jabatan,
                        'status_keanggotaan' => 'aktif',
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        if (
            ! empty($studentOrder)
            && $this->hasTable('osis_anggota')
            && $this->allTableColumnsExist('osis_anggota', ['tenant_id', 'siswa_id'])
        ) {
            try {
                $osisQuery = DB::table('osis_anggota')
                    ->where('tenant_id', $tenantId)
                    ->whereIn('siswa_id', $studentOrder);
                if ($periodStartDateTime !== null && $this->tableHasColumn('osis_anggota', 'created_at')) {
                    $osisQuery->where('created_at', '>=', $periodStartDateTime);
                }

                $selectCols = ['siswa_id'];
                if ($this->tableHasColumn('osis_anggota', 'bagian')) {
                    $selectCols[] = 'bagian';
                }
                if ($this->tableHasColumn('osis_anggota', 'status')) {
                    $selectCols[] = 'status';
                }

                $osisRows = $osisQuery->get($selectCols);
                foreach ($osisRows as $row) {
                    $studentId = (string) ($row->siswa_id ?? '');
                    $meta = $studentMeta[$studentId] ?? null;
                    if (! $meta) {
                        continue;
                    }

                    $jabatan = trim((string) ($row->bagian ?? '')) ?: 'Anggota';
                    $status = trim((string) ($row->status ?? '')) ?: 'aktif';
                    $summaryByStudent[$studentId]['organisasi_keys']['osis:'.$jabatan] = true;
                    $organisasiRows[] = [
                        'no' => $orgRowNumber++,
                        'kelas' => $meta['kelas'],
                        'nis' => $meta['nis'],
                        'nama_siswa' => $meta['nama'],
                        'sumber' => 'OSIS',
                        'organisasi' => 'OSIS',
                        'jabatan' => $jabatan,
                        'status_keanggotaan' => $status,
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $summaryRows = [];
        foreach ($studentOrder as $studentId) {
            $meta = $studentMeta[$studentId] ?? null;
            $summary = $summaryByStudent[$studentId] ?? null;
            if (! $meta || ! $summary) {
                continue;
            }

            $nilaiValues = $summary['nilai_values'] ?? [];
            $rataAkademik = ! empty($nilaiValues)
                ? round(array_sum($nilaiValues) / count($nilaiValues), 2)
                : null;

            $summaryRows[] = [
                'no' => $meta['no'],
                'kelas' => $meta['kelas'],
                'nis' => $meta['nis'],
                'nama_siswa' => $meta['nama'],
                'email' => $meta['email'],
                'status' => $meta['status'],
                'jk' => $meta['jk'],
                'no_hp_siswa' => $meta['no_hp_siswa'],
                'no_hp_wali' => $meta['no_hp_wali'],
                'jabatan_profile' => $meta['jabatan'],
                'total_mapel_diikuti' => count($summary['mapel_keys'] ?? []),
                'total_mapel_bernilai' => count($nilaiValues),
                'rata_nilai_akademik' => $rataAkademik,
                'total_tugas_terkumpul' => (int) ($summary['tugas_count'] ?? 0),
                'total_quiz_dikerjakan' => (int) ($summary['quiz_count'] ?? 0),
                'absen_hadir' => (int) ($summary['absensi']['Hadir'] ?? 0),
                'absen_izin' => (int) ($summary['absensi']['Izin'] ?? 0),
                'absen_sakit' => (int) ($summary['absensi']['Sakit'] ?? 0),
                'absen_alpha' => (int) ($summary['absensi']['Alpha'] ?? 0),
                'total_ekskul_diikuti' => count($summary['ekskul_keys'] ?? []),
                'eskul_hadir' => (int) ($summary['eskul']['Hadir'] ?? 0),
                'eskul_izin' => (int) ($summary['eskul']['Izin'] ?? 0),
                'eskul_alpha' => (int) ($summary['eskul']['Alpha'] ?? 0),
                'total_organisasi_jabatan' => count($summary['organisasi_keys'] ?? []),
                'periode_mulai_data' => $periodStartDate,
            ];
        }

        $tables[] = $this->makeBackupTable('siswa_ringkasan', $summaryRows);
        $tables[] = $this->makeBackupTable('siswa_mapel_diikuti', $mapelDiikutiRows);
        $tables[] = $this->makeBackupTable('siswa_nilai_mapel', $nilaiMapelRows);
        $tables[] = $this->makeBackupTable('siswa_tugas_detail', $tugasDetailRows);
        $tables[] = $this->makeBackupTable('siswa_quiz_detail', $quizDetailRows);
        $tables[] = $this->makeBackupTable('siswa_absensi_mapel', $absensiMapelRows);
        $tables[] = $this->makeBackupTable('siswa_absensi_detail', $absensiDetailRows);
        $tables[] = $this->makeBackupTable('siswa_absensi_eskul', $eskulAttendanceRows);
        $tables[] = $this->makeBackupTable('siswa_ekskul_diikuti', $eskulMemberRows);
        $tables[] = $this->makeBackupTable('siswa_organisasi_jabatan', $organisasiRows);

        // Backward-compatible sheet name lama.
        $tables[] = $this->makeBackupTable('siswa_anggota_ekskul', $eskulMemberRows);

        return $tables;
    }

    private function buildTeacherBackupTables(string $tenantId): array
    {
        $tables = [];

        $guruRows = [];
        if ($this->hasTable('profiles') && $this->allTableColumnsExist('profiles', ['tenant_id', 'id', 'role'])) {
            $columns = array_values(array_filter(
                ['id', 'nama', 'email', 'status'],
                fn ($column) => $this->tableHasColumn('profiles', $column)
            ));
            if (! in_array('id', $columns, true)) {
                $columns[] = 'id';
            }

            $guruQuery = DB::table('profiles')
                ->where('tenant_id', $tenantId)
                ->whereIn('role', ['guru', 'teacher']);
            if ($this->tableHasColumn('profiles', 'nama')) {
                $guruQuery->orderBy('nama');
            } else {
                $guruQuery->orderBy('id');
            }
            $guruRows = $guruQuery->get($columns)->all();
        }

        $guruMap = [];
        foreach ($guruRows as $row) {
            $item = (array) $row;
            $guruId = (string) ($item['id'] ?? '');
            if ($guruId === '') {
                continue;
            }
            $guruMap[$guruId] = [
                'id' => $guruId,
                'nama' => trim((string) ($item['nama'] ?? '')) ?: '-',
                'email' => trim((string) ($item['email'] ?? '')) ?: '-',
                'status' => trim((string) ($item['status'] ?? '')) ?: '-',
            ];
        }

        $studentsByClass = [];
        if ($this->hasTable('profiles') && $this->allTableColumnsExist('profiles', ['tenant_id', 'id', 'role'])) {
            $columns = array_values(array_filter(
                ['id', 'nama', 'nis', 'kelas'],
                fn ($column) => $this->tableHasColumn('profiles', $column)
            ));
            if (! in_array('id', $columns, true)) {
                $columns[] = 'id';
            }

            $studentsQuery = DB::table('profiles')
                ->where('tenant_id', $tenantId)
                ->where('role', 'siswa');
            if ($this->tableHasColumn('profiles', 'kelas')) {
                $studentsQuery->orderBy('kelas');
            }
            if ($this->tableHasColumn('profiles', 'nama')) {
                $studentsQuery->orderBy('nama');
            } else {
                $studentsQuery->orderBy('id');
            }
            $students = $studentsQuery->get($columns)->all();

            foreach ($students as $row) {
                $item = (array) $row;
                $studentId = (string) ($item['id'] ?? '');
                if ($studentId === '') {
                    continue;
                }
                $kelas = trim((string) ($item['kelas'] ?? '')) ?: '-';
                $studentsByClass[$kelas][] = [
                    'id' => $studentId,
                    'nama' => trim((string) ($item['nama'] ?? '')) ?: '-',
                    'nis' => trim((string) ($item['nis'] ?? '')) ?: '-',
                    'kelas' => $kelas,
                ];
            }
        }

        $teachMap = [];

        $ensureTeachKey = function (string $guruId, string $kelas, string $mapel) use (&$teachMap, $guruMap): ?string {
            if ($guruId === '') {
                return null;
            }
            $kelasNormalized = trim($kelas) !== '' ? trim($kelas) : '-';
            $mapelNormalized = $this->normalizeBackupMapel($mapel);
            $key = $guruId.'|'.$kelasNormalized.'|'.$mapelNormalized;

            if (! isset($teachMap[$key])) {
                $guru = $guruMap[$guruId] ?? null;
                $teachMap[$key] = [
                    'guru_id' => $guruId,
                    'guru_nama' => $guru['nama'] ?? '-',
                    'guru_email' => $guru['email'] ?? '-',
                    'guru_status' => $guru['status'] ?? '-',
                    'kelas' => $kelasNormalized,
                    'mapel' => $mapelNormalized,
                    'total_jadwal' => 0,
                    'total_tugas' => 0,
                    'total_quiz' => 0,
                ];
            }

            return $key;
        };

        if (
            $this->hasTable('jadwal')
            && $this->allTableColumnsExist('jadwal', ['tenant_id', 'guru_id', 'kelas_id', 'mapel'])
        ) {
            try {
                $jadwalRows = DB::table('jadwal')
                    ->where('tenant_id', $tenantId)
                    ->whereNotNull('guru_id')
                    ->select(
                        'guru_id',
                        'kelas_id as kelas',
                        'mapel',
                        DB::raw('MAX(guru_nama) as guru_nama'),
                        DB::raw('COUNT(*) as total_jadwal')
                    )
                    ->groupBy('guru_id', 'kelas_id', 'mapel')
                    ->get();

                foreach ($jadwalRows as $row) {
                    $guruId = (string) ($row->guru_id ?? '');
                    $kelas = (string) ($row->kelas ?? '');
                    $mapel = (string) ($row->mapel ?? '');
                    $key = $ensureTeachKey($guruId, $kelas, $mapel);
                    if (! $key) {
                        continue;
                    }

                    $teachMap[$key]['total_jadwal'] += (int) ($row->total_jadwal ?? 0);
                    if ($teachMap[$key]['guru_nama'] === '-' && ! empty($row->guru_nama)) {
                        $teachMap[$key]['guru_nama'] = trim((string) $row->guru_nama);
                    }
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        if (
            $this->hasTable('tugas')
            && $this->allTableColumnsExist('tugas', ['tenant_id', 'created_by', 'kelas', 'mapel'])
        ) {
            try {
                $tugasRows = DB::table('tugas')
                    ->where('tenant_id', $tenantId)
                    ->whereNotNull('created_by')
                    ->select(
                        'created_by as guru_id',
                        'kelas',
                        'mapel',
                        DB::raw('COUNT(*) as total_tugas')
                    )
                    ->groupBy('created_by', 'kelas', 'mapel')
                    ->get();

                foreach ($tugasRows as $row) {
                    $guruId = (string) ($row->guru_id ?? '');
                    $kelas = (string) ($row->kelas ?? '');
                    $mapel = (string) ($row->mapel ?? '');
                    $key = $ensureTeachKey($guruId, $kelas, $mapel);
                    if (! $key) {
                        continue;
                    }
                    $teachMap[$key]['total_tugas'] += (int) ($row->total_tugas ?? 0);
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        if (
            $this->hasTable('quizzes')
            && $this->allTableColumnsExist('quizzes', ['tenant_id', 'guru_id', 'kelas_id', 'mapel'])
        ) {
            try {
                $quizRows = DB::table('quizzes')
                    ->where('tenant_id', $tenantId)
                    ->whereNotNull('guru_id')
                    ->select(
                        'guru_id',
                        'kelas_id as kelas',
                        'mapel',
                        DB::raw('COUNT(*) as total_quiz')
                    )
                    ->groupBy('guru_id', 'kelas_id', 'mapel')
                    ->get();

                foreach ($quizRows as $row) {
                    $guruId = (string) ($row->guru_id ?? '');
                    $kelas = (string) ($row->kelas ?? '');
                    $mapel = (string) ($row->mapel ?? '');
                    $key = $ensureTeachKey($guruId, $kelas, $mapel);
                    if (! $key) {
                        continue;
                    }
                    $teachMap[$key]['total_quiz'] += (int) ($row->total_quiz ?? 0);
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $teachEntries = array_values($teachMap);
        usort($teachEntries, function ($a, $b) {
            $cmpGuru = strcasecmp((string) ($a['guru_nama'] ?? ''), (string) ($b['guru_nama'] ?? ''));
            if ($cmpGuru !== 0) {
                return $cmpGuru;
            }
            $cmpKelas = strcasecmp((string) ($a['kelas'] ?? ''), (string) ($b['kelas'] ?? ''));
            if ($cmpKelas !== 0) {
                return $cmpKelas;
            }

            return strcasecmp((string) ($a['mapel'] ?? ''), (string) ($b['mapel'] ?? ''));
        });

        $guruMengampuRows = [];
        foreach ($teachEntries as $index => $entry) {
            $kelas = (string) ($entry['kelas'] ?? '-');
            $guruMengampuRows[] = [
                'no' => $index + 1,
                'guru_id' => $entry['guru_id'],
                'guru_nama' => $entry['guru_nama'],
                'guru_email' => $entry['guru_email'],
                'status_guru' => $entry['guru_status'],
                'kelas' => $kelas,
                'mapel' => $entry['mapel'],
                'total_siswa_kelas' => count($studentsByClass[$kelas] ?? []),
                'total_slot_jadwal' => (int) ($entry['total_jadwal'] ?? 0),
                'total_tugas_dibuat' => (int) ($entry['total_tugas'] ?? 0),
                'total_quiz_dibuat' => (int) ($entry['total_quiz'] ?? 0),
            ];
        }

        $taskScoreMap = [];
        if (
            $this->hasTable('tugas_jawaban')
            && $this->hasTable('tugas')
            && $this->allTableColumnsExist('tugas_jawaban', ['tenant_id', 'tugas_id', 'user_id', 'nilai'])
            && $this->allTableColumnsExist('tugas', ['tenant_id', 'id', 'created_by', 'kelas', 'mapel'])
        ) {
            try {
                $taskScores = DB::table('tugas_jawaban as tj')
                    ->join('tugas as t', 't.id', '=', 'tj.tugas_id')
                    ->where('tj.tenant_id', $tenantId)
                    ->where('t.tenant_id', $tenantId)
                    ->whereNotNull('t.created_by')
                    ->whereNotNull('tj.nilai')
                    ->select(
                        't.created_by as guru_id',
                        't.kelas',
                        't.mapel',
                        'tj.user_id as siswa_id',
                        DB::raw('AVG(tj.nilai) as avg_tugas'),
                        DB::raw('COUNT(*) as jumlah_tugas')
                    )
                    ->groupBy('t.created_by', 't.kelas', 't.mapel', 'tj.user_id')
                    ->get();

                foreach ($taskScores as $row) {
                    $guruId = (string) ($row->guru_id ?? '');
                    $kelas = trim((string) ($row->kelas ?? '')) ?: '-';
                    $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                    $studentId = (string) ($row->siswa_id ?? '');
                    if ($guruId === '' || $studentId === '') {
                        continue;
                    }

                    $key = $guruId.'|'.$kelas.'|'.$mapel.'|'.$studentId;
                    $taskScoreMap[$key] = [
                        'avg_tugas' => $this->toFloatOrNull($row->avg_tugas ?? null),
                        'jumlah_tugas' => (int) ($row->jumlah_tugas ?? 0),
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $quizScoreMap = [];
        if (
            $this->hasTable('quiz_submissions')
            && $this->hasTable('quizzes')
            && $this->allTableColumnsExist('quiz_submissions', ['tenant_id', 'quiz_id', 'siswa_id', 'score'])
            && $this->allTableColumnsExist('quizzes', ['tenant_id', 'id', 'guru_id', 'kelas_id', 'mapel'])
        ) {
            try {
                $quizScores = DB::table('quiz_submissions as qs')
                    ->join('quizzes as q', 'q.id', '=', 'qs.quiz_id')
                    ->where('qs.tenant_id', $tenantId)
                    ->where('q.tenant_id', $tenantId)
                    ->whereNotNull('q.guru_id')
                    ->whereNotNull('qs.score')
                    ->select(
                        'q.guru_id',
                        'q.kelas_id as kelas',
                        'q.mapel',
                        'qs.siswa_id',
                        DB::raw('AVG(qs.score) as avg_quiz'),
                        DB::raw('COUNT(*) as jumlah_quiz')
                    )
                    ->groupBy('q.guru_id', 'q.kelas_id', 'q.mapel', 'qs.siswa_id')
                    ->get();

                foreach ($quizScores as $row) {
                    $guruId = (string) ($row->guru_id ?? '');
                    $kelas = trim((string) ($row->kelas ?? '')) ?: '-';
                    $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                    $studentId = (string) ($row->siswa_id ?? '');
                    if ($guruId === '' || $studentId === '') {
                        continue;
                    }

                    $key = $guruId.'|'.$kelas.'|'.$mapel.'|'.$studentId;
                    $quizScoreMap[$key] = [
                        'avg_quiz' => $this->toFloatOrNull($row->avg_quiz ?? null),
                        'jumlah_quiz' => (int) ($row->jumlah_quiz ?? 0),
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $attendanceMap = [];
        if ($this->hasTable('absensi') && $this->allTableColumnsExist('absensi', ['tenant_id', 'kelas', 'mapel', 'uid', 'status'])) {
            try {
                $attendanceRows = DB::table('absensi')
                    ->where('tenant_id', $tenantId)
                    ->select(
                        'kelas',
                        'mapel',
                        'uid as siswa_id',
                        DB::raw("SUM(CASE WHEN status = 'Hadir' THEN 1 ELSE 0 END) as hadir"),
                        DB::raw("SUM(CASE WHEN status = 'Izin' THEN 1 ELSE 0 END) as izin"),
                        DB::raw("SUM(CASE WHEN status = 'Sakit' THEN 1 ELSE 0 END) as sakit"),
                        DB::raw("SUM(CASE WHEN status = 'Alpha' THEN 1 ELSE 0 END) as alpha")
                    )
                    ->groupBy('kelas', 'mapel', 'uid')
                    ->get();

                foreach ($attendanceRows as $row) {
                    $kelas = trim((string) ($row->kelas ?? '')) ?: '-';
                    $mapel = $this->normalizeBackupMapel($row->mapel ?? null);
                    $studentId = (string) ($row->siswa_id ?? '');
                    if ($studentId === '') {
                        continue;
                    }
                    $key = $kelas.'|'.$mapel.'|'.$studentId;
                    $attendanceMap[$key] = [
                        'hadir' => (int) ($row->hadir ?? 0),
                        'izin' => (int) ($row->izin ?? 0),
                        'sakit' => (int) ($row->sakit ?? 0),
                        'alpha' => (int) ($row->alpha ?? 0),
                    ];
                }
            } catch (\Throwable $e) {
                // ignored: backup tetap lanjut walau query tertentu gagal
            }
        }

        $detailRows = [];
        $rekapMapel = [];
        foreach ($teachEntries as $entry) {
            $guruId = (string) ($entry['guru_id'] ?? '');
            $kelas = (string) ($entry['kelas'] ?? '-');
            $mapel = (string) ($entry['mapel'] ?? 'Tanpa Mapel');
            $rekapKey = $guruId.'|'.$kelas.'|'.$mapel;

            $studentsInClass = $studentsByClass[$kelas] ?? [];
            $rekapMapel[$rekapKey] = [
                'guru_id' => $guruId,
                'guru_nama' => $entry['guru_nama'],
                'guru_email' => $entry['guru_email'],
                'kelas' => $kelas,
                'mapel' => $mapel,
                'total_siswa_kelas' => count($studentsInClass),
                'siswa_bernilai' => 0,
                'sum_nilai' => 0.0,
                'hadir' => 0,
                'izin' => 0,
                'sakit' => 0,
                'alpha' => 0,
            ];

            foreach ($studentsInClass as $student) {
                $studentId = (string) ($student['id'] ?? '');
                if ($studentId === '') {
                    continue;
                }

                $scoreKey = $guruId.'|'.$kelas.'|'.$mapel.'|'.$studentId;
                $taskInfo = $taskScoreMap[$scoreKey] ?? [];
                $quizInfo = $quizScoreMap[$scoreKey] ?? [];
                $attendance = $attendanceMap[$kelas.'|'.$mapel.'|'.$studentId] ?? [
                    'hadir' => 0,
                    'izin' => 0,
                    'sakit' => 0,
                    'alpha' => 0,
                ];

                $avgTugas = $this->toFloatOrNull($taskInfo['avg_tugas'] ?? null);
                $avgQuiz = $this->toFloatOrNull($quizInfo['avg_quiz'] ?? null);
                $nilaiAkhir = $this->combineAcademicScore($avgTugas, $avgQuiz);

                if ($nilaiAkhir !== null) {
                    $rekapMapel[$rekapKey]['siswa_bernilai'] += 1;
                    $rekapMapel[$rekapKey]['sum_nilai'] += $nilaiAkhir;
                }

                $rekapMapel[$rekapKey]['hadir'] += (int) ($attendance['hadir'] ?? 0);
                $rekapMapel[$rekapKey]['izin'] += (int) ($attendance['izin'] ?? 0);
                $rekapMapel[$rekapKey]['sakit'] += (int) ($attendance['sakit'] ?? 0);
                $rekapMapel[$rekapKey]['alpha'] += (int) ($attendance['alpha'] ?? 0);

                $detailRows[] = [
                    'guru_nama' => $entry['guru_nama'],
                    'guru_email' => $entry['guru_email'],
                    'kelas' => $kelas,
                    'mapel' => $mapel,
                    'siswa_id' => $studentId,
                    'nis' => $student['nis'] ?? '-',
                    'nama_siswa' => $student['nama'] ?? '-',
                    'rata_tugas' => $avgTugas,
                    'jumlah_tugas_dinilai' => (int) ($taskInfo['jumlah_tugas'] ?? 0),
                    'rata_quiz' => $avgQuiz,
                    'jumlah_quiz_dinilai' => (int) ($quizInfo['jumlah_quiz'] ?? 0),
                    'nilai_akhir_mapel' => $nilaiAkhir,
                    'hadir' => (int) ($attendance['hadir'] ?? 0),
                    'izin' => (int) ($attendance['izin'] ?? 0),
                    'sakit' => (int) ($attendance['sakit'] ?? 0),
                    'alpha' => (int) ($attendance['alpha'] ?? 0),
                ];
            }
        }

        foreach ($detailRows as $index => $row) {
            $detailRows[$index]['no'] = $index + 1;
        }

        $rekapMapelRows = [];
        foreach ($teachEntries as $index => $entry) {
            $key = (string) ($entry['guru_id'] ?? '').'|'.(string) ($entry['kelas'] ?? '-').'|'.(string) ($entry['mapel'] ?? 'Tanpa Mapel');
            $rekap = $rekapMapel[$key] ?? null;
            if (! $rekap) {
                continue;
            }

            $rataNilai = ((int) ($rekap['siswa_bernilai'] ?? 0) > 0)
                ? round(((float) ($rekap['sum_nilai'] ?? 0)) / (int) $rekap['siswa_bernilai'], 2)
                : null;

            $rekapMapelRows[] = [
                'no' => $index + 1,
                'guru_id' => $rekap['guru_id'],
                'guru_nama' => $rekap['guru_nama'],
                'guru_email' => $rekap['guru_email'],
                'kelas' => $rekap['kelas'],
                'mapel' => $rekap['mapel'],
                'total_siswa_kelas' => (int) ($rekap['total_siswa_kelas'] ?? 0),
                'siswa_bernilai' => (int) ($rekap['siswa_bernilai'] ?? 0),
                'rata_nilai_mapel' => $rataNilai,
                'hadir' => (int) ($rekap['hadir'] ?? 0),
                'izin' => (int) ($rekap['izin'] ?? 0),
                'sakit' => (int) ($rekap['sakit'] ?? 0),
                'alpha' => (int) ($rekap['alpha'] ?? 0),
            ];
        }

        $ekskulSummaryRows = [];
        $ekskulMemberDetailRows = [];

        if ($this->hasTable('ekskul') && $this->allTableColumnsExist('ekskul', ['tenant_id', 'id', 'nama', 'pembina_guru_id'])) {
            $ekskulRows = [];
            try {
                $ekskulRows = DB::table('ekskul')
                    ->where('tenant_id', $tenantId)
                    ->whereNotNull('pembina_guru_id')
                    ->orderBy('nama')
                    ->get(['id', 'nama', 'pembina_guru_id'])
                    ->all();
            } catch (\Throwable $e) {
                $ekskulRows = [];
            }

            $memberCountByEkskul = [];
            $memberRowsByEkskul = [];
            if (
                $this->hasTable('ekskul_anggota')
                && $this->allTableColumnsExist('ekskul_anggota', ['tenant_id', 'ekskul_id', 'user_id'])
            ) {
                try {
                    $memberCounts = DB::table('ekskul_anggota')
                        ->where('tenant_id', $tenantId)
                        ->select('ekskul_id', DB::raw('COUNT(DISTINCT user_id) as total_anggota'))
                        ->groupBy('ekskul_id')
                        ->get();

                    foreach ($memberCounts as $row) {
                        $memberCountByEkskul[(string) ($row->ekskul_id ?? '')] = (int) ($row->total_anggota ?? 0);
                    }
                } catch (\Throwable $e) {
                    $memberCountByEkskul = [];
                }

                try {
                    $memberDetailQuery = DB::table('ekskul_anggota as ea')
                        ->where('ea.tenant_id', $tenantId);

                    $hasProfileJoin = $this->hasTable('profiles') && $this->allTableColumnsExist('profiles', ['id']);
                    if ($hasProfileJoin) {
                        $memberDetailQuery->leftJoin('profiles as p', function ($join) {
                            $join->on('p.id', '=', 'ea.user_id');
                            if ($this->tableHasColumn('profiles', 'tenant_id')) {
                                $join->whereColumn('p.tenant_id', 'ea.tenant_id');
                            }
                        });
                    }

                    $namaSiswaExpression = $hasProfileJoin
                        ? DB::raw("COALESCE(p.nama, '-') as nama_siswa")
                        : DB::raw("'-' as nama_siswa");
                    $nisExpression = $hasProfileJoin && $this->tableHasColumn('profiles', 'nis')
                        ? DB::raw("COALESCE(p.nis, '-') as nis")
                        : DB::raw("'-' as nis");
                    $kelasExpression = $hasProfileJoin && $this->tableHasColumn('profiles', 'kelas')
                        ? DB::raw("COALESCE(p.kelas, '-') as kelas")
                        : DB::raw("'-' as kelas");

                    $memberDetails = $memberDetailQuery
                        ->select(
                            'ea.ekskul_id',
                            'ea.user_id',
                            $namaSiswaExpression,
                            $nisExpression,
                            $kelasExpression
                        )
                        ->orderBy('ea.ekskul_id')
                        ->get();

                    foreach ($memberDetails as $row) {
                        $ekskulId = (string) ($row->ekskul_id ?? '');
                        if ($ekskulId === '') {
                            continue;
                        }
                        $memberRowsByEkskul[$ekskulId][] = [
                            'user_id' => (string) ($row->user_id ?? ''),
                            'nama_siswa' => trim((string) ($row->nama_siswa ?? '')) ?: '-',
                            'nis' => trim((string) ($row->nis ?? '')) ?: '-',
                            'kelas' => trim((string) ($row->kelas ?? '')) ?: '-',
                        ];
                    }
                } catch (\Throwable $e) {
                    $memberRowsByEkskul = [];
                }
            }

            $ekskulStatusByEkskul = [];
            $ekskulStatusByMember = [];
            if (
                $this->hasTable('absensi_eskul')
                && $this->allTableColumnsExist('absensi_eskul', ['tenant_id', 'ekskul_id', 'user_id', 'status'])
            ) {
                try {
                    $statusRows = DB::table('absensi_eskul')
                        ->where('tenant_id', $tenantId)
                        ->select(
                            'ekskul_id',
                            'user_id',
                            DB::raw("SUM(CASE WHEN status = 'Hadir' THEN 1 ELSE 0 END) as hadir"),
                            DB::raw("SUM(CASE WHEN status = 'Izin' THEN 1 ELSE 0 END) as izin"),
                            DB::raw("SUM(CASE WHEN status = 'Alpha' THEN 1 ELSE 0 END) as alpha")
                        )
                        ->groupBy('ekskul_id', 'user_id')
                        ->get();

                    foreach ($statusRows as $row) {
                        $ekskulId = (string) ($row->ekskul_id ?? '');
                        $userId = (string) ($row->user_id ?? '');
                        if ($ekskulId === '') {
                            continue;
                        }

                        $hadir = (int) ($row->hadir ?? 0);
                        $izin = (int) ($row->izin ?? 0);
                        $alpha = (int) ($row->alpha ?? 0);

                        if (! isset($ekskulStatusByEkskul[$ekskulId])) {
                            $ekskulStatusByEkskul[$ekskulId] = ['hadir' => 0, 'izin' => 0, 'alpha' => 0];
                        }

                        $ekskulStatusByEkskul[$ekskulId]['hadir'] += $hadir;
                        $ekskulStatusByEkskul[$ekskulId]['izin'] += $izin;
                        $ekskulStatusByEkskul[$ekskulId]['alpha'] += $alpha;
                        $ekskulStatusByMember[$ekskulId.'|'.$userId] = [
                            'hadir' => $hadir,
                            'izin' => $izin,
                            'alpha' => $alpha,
                        ];
                    }
                } catch (\Throwable $e) {
                    $ekskulStatusByEkskul = [];
                    $ekskulStatusByMember = [];
                }
            }

            foreach ($ekskulRows as $index => $row) {
                $ekskulId = (string) ($row->id ?? '');
                $guruId = (string) ($row->pembina_guru_id ?? '');
                if ($ekskulId === '' || $guruId === '') {
                    continue;
                }

                $guru = $guruMap[$guruId] ?? null;
                $status = $ekskulStatusByEkskul[$ekskulId] ?? ['hadir' => 0, 'izin' => 0, 'alpha' => 0];

                $ekskulSummaryRows[] = [
                    'no' => $index + 1,
                    'guru_id' => $guruId,
                    'guru_nama' => $guru['nama'] ?? '-',
                    'guru_email' => $guru['email'] ?? '-',
                    'ekskul_id' => $ekskulId,
                    'ekskul' => trim((string) ($row->nama ?? '')) ?: '-',
                    'total_anggota' => (int) ($memberCountByEkskul[$ekskulId] ?? 0),
                    'hadir' => (int) ($status['hadir'] ?? 0),
                    'izin' => (int) ($status['izin'] ?? 0),
                    'alpha' => (int) ($status['alpha'] ?? 0),
                ];

                $members = $memberRowsByEkskul[$ekskulId] ?? [];
                foreach ($members as $member) {
                    $memberKey = $ekskulId.'|'.(string) ($member['user_id'] ?? '');
                    $memberStatus = $ekskulStatusByMember[$memberKey] ?? ['hadir' => 0, 'izin' => 0, 'alpha' => 0];
                    $ekskulMemberDetailRows[] = [
                        'guru_nama' => $guru['nama'] ?? '-',
                        'guru_email' => $guru['email'] ?? '-',
                        'ekskul_id' => $ekskulId,
                        'ekskul' => trim((string) ($row->nama ?? '')) ?: '-',
                        'siswa_id' => $member['user_id'] ?? '',
                        'nis' => $member['nis'] ?? '-',
                        'nama_siswa' => $member['nama_siswa'] ?? '-',
                        'kelas' => $member['kelas'] ?? '-',
                        'hadir' => (int) ($memberStatus['hadir'] ?? 0),
                        'izin' => (int) ($memberStatus['izin'] ?? 0),
                        'alpha' => (int) ($memberStatus['alpha'] ?? 0),
                    ];
                }
            }
        }

        foreach ($ekskulMemberDetailRows as $index => $row) {
            $ekskulMemberDetailRows[$index]['no'] = $index + 1;
        }

        $tables[] = $this->makeBackupTable('guru_pengampu_mapel', $guruMengampuRows);
        $tables[] = $this->makeBackupTable('guru_nilai_kehadiran_siswa', $detailRows);
        $tables[] = $this->makeBackupTable('guru_rekap_mapel', $rekapMapelRows);
        $tables[] = $this->makeBackupTable('guru_rekap_eskul_binaan', $ekskulSummaryRows);
        $tables[] = $this->makeBackupTable('guru_detail_eskul_binaan', $ekskulMemberDetailRows);

        return $tables;
    }

    private function decodeAuditJson($value)
    {
        if (is_array($value)) {
            return $value;
        }
        if (is_object($value)) {
            return (array) $value;
        }
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }

        try {
            return json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable $e) {
            return $trimmed;
        }
    }

    private function buildAuditAnomalies(?string $tenantId = null): array
    {
        $anomalies = [];
        $now = now();
        $criticalTables = [
            'settings',
            'users',
            'profiles',
            'tenants',
            'tenant_domains',
            'super_admins',
            'approval_requests',
            'absensi',
            'absensi_settings',
            'tugas_jawaban',
            'quiz_submissions',
            'quiz_answers',
        ];

        if ($this->hasTable('audit_log')) {
            $deleteQuery = DB::table('audit_log')
                ->where('action', 'DELETE')
                ->whereIn('table_name', $criticalTables)
                ->where('timestamp', '>=', $now->copy()->subDay());
            if ($tenantId && $this->tableHasColumn('audit_log', 'tenant_id')) {
                $deleteQuery->where('tenant_id', $tenantId);
            }
            $criticalDeleteCount = (int) $deleteQuery->count();
            if ($criticalDeleteCount >= 3) {
                $anomalies[] = [
                    'severity' => 'high',
                    'code' => 'CRITICAL_DELETE_SPIKE',
                    'message' => "Terdeteksi {$criticalDeleteCount} aksi DELETE pada tabel kritikal dalam 24 jam terakhir.",
                ];
            }

            $settingsChangeQuery = DB::table('audit_log')
                ->where('table_name', 'settings')
                ->where('action', 'UPDATE')
                ->where('timestamp', '>=', $now->copy()->subHour());
            if ($tenantId && $this->tableHasColumn('audit_log', 'tenant_id')) {
                $settingsChangeQuery->where('tenant_id', $tenantId);
            }
            $settingsChangeCount = (int) $settingsChangeQuery->count();
            if ($settingsChangeCount >= 8) {
                $anomalies[] = [
                    'severity' => 'medium',
                    'code' => 'SETTINGS_CHANGE_BURST',
                    'message' => "Perubahan settings tinggi ({$settingsChangeCount} update/jam).",
                ];
            }

            $scannerQuery = DB::table('audit_log')
                ->where('timestamp', '>=', $now->copy()->subDay())
                ->where(function ($query) {
                    $query
                        ->whereRaw('LOWER(CAST(new_data AS TEXT)) LIKE ?', ['%security_blocked_request%'])
                        ->orWhereRaw('LOWER(CAST(new_data AS TEXT)) LIKE ?', ['%sqlmap%'])
                        ->orWhereRaw('LOWER(CAST(new_data AS TEXT)) LIKE ?', ['%nikto%'])
                        ->orWhereRaw('LOWER(CAST(new_data AS TEXT)) LIKE ?', ['%nuclei%']);
                });
            if ($tenantId && $this->tableHasColumn('audit_log', 'tenant_id')) {
                $scannerQuery->where('tenant_id', $tenantId);
            }
            $scannerCount = (int) $scannerQuery->count();
            if ($scannerCount >= 1) {
                $anomalies[] = [
                    'severity' => 'high',
                    'code' => 'SCANNER_TRAFFIC_DETECTED',
                    'message' => "Terdeteksi {$scannerCount} request dari scanner otomatis dalam 24 jam terakhir. Cek login_success dan perubahan tabel sensitif.",
                ];
            }

            $adminHostDeniedQuery = DB::table('audit_log')
                ->where('table_name', 'auth_events')
                ->where('timestamp', '>=', $now->copy()->subHour())
                ->whereRaw('LOWER(CAST(new_data AS TEXT)) LIKE ?', ['%login_denied_non_super_admin_on_admin_host%']);
            if ($tenantId && $this->tableHasColumn('audit_log', 'tenant_id')) {
                $adminHostDeniedQuery->where('tenant_id', $tenantId);
            }
            $adminHostDeniedCount = (int) $adminHostDeniedQuery->count();
            if ($adminHostDeniedCount >= 3) {
                $anomalies[] = [
                    'severity' => 'medium',
                    'code' => 'ADMIN_HOST_DENIED_BURST',
                    'message' => "Ada {$adminHostDeniedCount} percobaan login non-super-admin di host admin dalam 1 jam.",
                ];
            }

            $anonymousSecurityQuery = DB::table('audit_log')
                ->whereNull('user_id')
                ->whereIn('table_name', ['auth_events', 'security_events'])
                ->where('timestamp', '>=', $now->copy()->subHour());
            if ($tenantId && $this->tableHasColumn('audit_log', 'tenant_id')) {
                $anonymousSecurityQuery->where('tenant_id', $tenantId);
            }
            $anonymousSecurityCount = (int) $anonymousSecurityQuery->count();
            if ($anonymousSecurityCount >= 20) {
                $anomalies[] = [
                    'severity' => 'medium',
                    'code' => 'ANONYMOUS_SECURITY_EVENT_BURST',
                    'message' => "Terdeteksi {$anonymousSecurityCount} event login/keamanan anonim dalam 1 jam.",
                ];
            }

            $actorBurstQuery = DB::table('audit_log')
                ->select('user_id', DB::raw('count(*) as total'))
                ->whereNotNull('user_id')
                ->whereNotIn('table_name', ['auth_events', 'security_events'])
                ->where('timestamp', '>=', $now->copy()->subHour())
                ->groupBy('user_id')
                ->havingRaw('count(*) >= 40');
            if ($tenantId && $this->tableHasColumn('audit_log', 'tenant_id')) {
                $actorBurstQuery->where('tenant_id', $tenantId);
            }
            $burstActors = $actorBurstQuery->get();
            foreach ($burstActors as $actor) {
                $anomalies[] = [
                    'severity' => 'medium',
                    'code' => 'ACTIVITY_BURST',
                    'message' => 'Akun '.((string) $actor->user_id)." membuat {$actor->total} perubahan data dalam 1 jam.",
                ];
            }
        }

        if ($this->hasTable('approval_requests')) {
            $pendingQuery = DB::table('approval_requests')->where('status', 'pending');
            if ($tenantId && $this->tableHasColumn('approval_requests', 'tenant_id')) {
                $pendingQuery->where('tenant_id', $tenantId);
            }
            $pendingCount = (int) $pendingQuery->count();
            if ($pendingCount >= 15) {
                $anomalies[] = [
                    'severity' => 'medium',
                    'code' => 'APPROVAL_QUEUE_BACKLOG',
                    'message' => "Antrian approval menumpuk ({$pendingCount} request pending).",
                ];
            }
        }

        return $anomalies;
    }

    private function domainRules(): array
    {
        return [
            'host' => 'required|string|max:255',
            'dns_record_type' => 'nullable|string|in:A,CNAME',
            'dns_record_value' => 'nullable|string|max:255',
            'is_primary' => 'nullable|boolean',
            'notes' => 'nullable|string|max:1000',
        ];
    }

    private function tenantDomainRow(string $domainId): ?object
    {
        if (! $this->hasTable('tenant_domains')) {
            return null;
        }

        return DB::table('tenant_domains')->where('id', $domainId)->first();
    }

    private function hasTable(string $table): bool
    {
        if (array_key_exists($table, $this->tableExistenceCache)) {
            return $this->tableExistenceCache[$table];
        }

        try {
            $this->tableExistenceCache[$table] = Schema::hasTable($table);
        } catch (\Throwable $e) {
            $this->tableExistenceCache[$table] = false;
        }

        return $this->tableExistenceCache[$table];
    }

    private function allTableColumnsExist(string $table, array $columns): bool
    {
        if (! $this->hasTable($table)) {
            return false;
        }

        foreach ($columns as $column) {
            if (! $this->tableHasColumn($table, (string) $column)) {
                return false;
            }
        }

        return true;
    }

    private function makeBackupTable(string $name, array $rows): array
    {
        $normalizedRows = [];
        foreach ($rows as $row) {
            $normalizedRows[] = $this->normalizeBackupRow(is_array($row) ? $row : (array) $row);
        }

        return [
            'name' => $name,
            'row_count' => count($normalizedRows),
            'rows' => $normalizedRows,
        ];
    }

    private function toFloatOrNull($value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_numeric($value)) {
            return null;
        }

        return round((float) $value, 2);
    }

    private function combineAcademicScore(?float $taskScore, ?float $quizScore): ?float
    {
        if ($taskScore !== null && $quizScore !== null) {
            return round(($taskScore + $quizScore) / 2, 2);
        }
        if ($taskScore !== null) {
            return round($taskScore, 2);
        }
        if ($quizScore !== null) {
            return round($quizScore, 2);
        }

        return null;
    }

    private function normalizeBackupMapel($value): string
    {
        $mapel = trim((string) ($value ?? ''));

        return $mapel !== '' ? $mapel : 'Tanpa Mapel';
    }

    private function tableHasColumn(string $table, string $column): bool
    {
        if (! $this->hasTable($table)) {
            return false;
        }

        $cacheKey = $table.'.'.$column;
        if (array_key_exists($cacheKey, $this->tableColumnExistenceCache)) {
            return $this->tableColumnExistenceCache[$cacheKey];
        }

        try {
            $this->tableColumnExistenceCache[$cacheKey] = Schema::hasColumn($table, $column);
        } catch (\Throwable $e) {
            $this->tableColumnExistenceCache[$cacheKey] = false;
        }

        return $this->tableColumnExistenceCache[$cacheKey];
    }

    private function findTenantByIdOrSlug(string $idOrSlug): ?object
    {
        $normalized = strtolower(trim($idOrSlug));
        $tenantQuery = DB::table('tenants');
        if (Str::isUuid($idOrSlug)) {
            $tenantQuery->where('id', $idOrSlug)->orWhere('slug', $normalized);
        } else {
            $tenantQuery->where('slug', $normalized);
        }

        $tenant = $tenantQuery->first();

        return $tenant ?: null;
    }

    private function resolveTenantPrimaryAdminUserId(string $tenantId): string
    {
        if ($tenantId === '') {
            return '';
        }

        if (! $this->hasTable('settings') || ! $this->tableHasColumn('settings', 'approval_primary_admin_id')) {
            return '';
        }

        try {
            $row = DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->first(['approval_primary_admin_id']);
            $primaryAdminId = trim((string) ($row->approval_primary_admin_id ?? ''));

            return $primaryAdminId;
        } catch (\Throwable $e) {
            return '';
        }
    }

    private function buildTenantRfidTemplate(object $tenant): array
    {
        $tenantId = trim((string) ($tenant->id ?? ''));
        $tenantSlug = strtolower(trim((string) ($tenant->slug ?? '')));

        if ($tenantId === '' || $tenantSlug === '') {
            return [
                'available' => false,
                'message' => 'Template RFID tenant tidak valid',
            ];
        }

        $template = $this->rfidDeviceService->ensureTenantTemplateDevice($tenantId, $tenantSlug);
        if (! ($template['success'] ?? false)) {
            return [
                'available' => false,
                'message' => (string) ($template['message'] ?? 'Gagal menyiapkan template RFID tenant'),
            ];
        }

        $mqttConfig = $this->tenantMqttConfigService->tenantConfig($tenantId, $tenantSlug, true);
        $scanTopicTemplate = trim((string) ($mqttConfig['scan_topic_template'] ?? 'edusmart/{tenant}/rfid/scan'));
        $responseTopicTemplate = trim((string) ($mqttConfig['response_topic_template'] ?? 'edusmart/{tenant}/rfid/response'));
        $modeTopicTemplate = trim((string) ($mqttConfig['mode_topic_template'] ?? 'edusmart/{tenant}/rfid/mode'));
        $mqttHost = trim((string) ($mqttConfig['host'] ?? ''));
        $mqttUsername = trim((string) ($mqttConfig['username'] ?? ''));
        $mqttPassword = trim((string) ($mqttConfig['password'] ?? ''));
        $isTenantScopedMqtt = (string) ($mqttConfig['source'] ?? '') === 'tenant';
        $mqttAvailable = (bool) ($mqttConfig['available'] ?? false)
            && $isTenantScopedMqtt
            && $mqttHost !== ''
            && $mqttUsername !== ''
            && $mqttPassword !== '';

        $unavailableMessage = 'Konfigurasi MQTT RFID sekolah belum aktif/lengkap';
        if (! $isTenantScopedMqtt) {
            $unavailableMessage = 'Klik Pakai Mosquitto agar sekolah ini punya credential dan topic MQTT sendiri.';
        } elseif ($mqttUsername === '' || $mqttPassword === '') {
            $unavailableMessage = 'Credential MQTT sekolah belum lengkap. Jalankan Pakai Mosquitto atau rotasi password.';
        }

        return [
            'available' => $mqttAvailable,
            'message' => $mqttAvailable
                ? null
                : $unavailableMessage,
            'tenant_id' => $tenantId,
            'tenant_slug' => $tenantSlug,
            'device_id' => (string) ($template['device_id'] ?? ''),
            'device_name' => (string) ($template['device_name'] ?? ''),
            'device_secret' => (string) ($template['secret'] ?? ''),
            'firmware_version' => '2.0.0-mqtt-only',
            'api_base_url' => rtrim((string) config('app.url', ''), '/'),
            'mqtt' => [
                'host' => $mqttHost,
                'port' => (int) ($mqttConfig['port'] ?? 8883),
                'username' => $mqttUsername,
                'password' => $mqttPassword,
                'use_tls' => (bool) ($mqttConfig['use_tls'] ?? true),
                'tls_verify_peer' => (bool) ($mqttConfig['tls_verify_peer'] ?? true),
                'tls_verify_peer_name' => (bool) ($mqttConfig['tls_verify_peer_name'] ?? true),
                'tls_allow_self_signed' => (bool) ($mqttConfig['tls_allow_self_signed'] ?? false),
                'config_source' => (string) ($mqttConfig['source'] ?? 'global'),
                'provider' => (string) ($mqttConfig['provider'] ?? 'custom'),
                'managed_by_platform' => (bool) ($mqttConfig['managed_by_platform'] ?? false),
            ],
            'topics' => [
                'scan' => str_replace('{tenant}', $tenantSlug, $scanTopicTemplate),
                'response' => str_replace('{tenant}', $tenantSlug, $responseTopicTemplate),
                'mode' => str_replace('{tenant}', $tenantSlug, $modeTopicTemplate),
            ],
            'notes' => [
                'Template MQTT-only: alat hanya publish scan dan menerima response/mode lewat MQTT.',
                'Backend tetap memutuskan absensi masuk/pulang, jadwal aktif, dan enroll UID.',
                'Kalau tenant butuh alat kedua, duplikasi template lalu ubah DEVICE_ID dan daftarkan device baru agar tidak konflik.',
            ],
        ];
    }

    private function backupTablesForTenant(): array
    {
        $availableTables = [];
        try {
            $availableTables = Schema::getTableListing();
        } catch (\Throwable $e) {
            $availableTables = self::BACKUP_TABLE_ORDER;
        }

        $availableMap = array_fill_keys(array_map('strval', $availableTables), true);
        $tables = [];

        foreach (self::BACKUP_TABLE_ORDER as $tableName) {
            if (isset($availableMap[$tableName])) {
                $tables[] = $tableName;
            }
        }

        foreach ($availableTables as $tableName) {
            $tableName = (string) $tableName;
            if (in_array($tableName, ['tenants', 'users', 'super_admins', 'migrations'], true)) {
                continue;
            }
            if (! in_array($tableName, $tables, true) && $this->tableHasColumn($tableName, 'tenant_id')) {
                $tables[] = $tableName;
            }
        }

        return $tables;
    }

    private function normalizeBackupRow(array $row): array
    {
        $normalized = [];
        foreach ($row as $key => $value) {
            if (is_array($value) || is_object($value)) {
                $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $normalized[$key] = $encoded === false ? '' : $encoded;

                continue;
            }

            if (is_bool($value)) {
                $normalized[$key] = $value ? 1 : 0;

                continue;
            }

            $normalized[$key] = $value;
        }

        return $normalized;
    }
}
