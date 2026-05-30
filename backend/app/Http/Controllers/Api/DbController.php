<?php

namespace App\Http\Controllers\Api;

use App\Services\Db\DbDeleteExecutor;
use App\Services\Db\DbInsertExecutor;
use App\Services\Db\DbRequestShapeValidator;
use App\Services\Db\DbSelectExecutor;
use App\Services\Db\DbTableRegistry;
use App\Services\Db\DbUpdateExecutor;
use App\Services\Db\DbUpsertExecutor;
use App\Services\WhatsApp\WhatsAppNotificationService;
use App\Support\AcademicPeriod;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class DbController extends ApiController
{
    private const CRITICAL_MAKER_CHECKER_TABLES = [
        'settings',
        'absensi',
        'absensi_settings',
        'absensi_rfid_settings',
        'tugas_jawaban',
        'quiz_submissions',
        'quiz_answers',
    ];

    private const REMOVED_SETTINGS_POLICY_FIELDS = [
        'ranking_weight_tugas',
        'ranking_weight_quiz',
        'ranking_weight_absensi',
        'ranking_tiebreak_order',
        'ranking_core_mapel',
        'ranking_policy_updated_at',
        'nilai_freeze_enabled',
        'nilai_freeze_start',
        'nilai_freeze_end',
        'nilai_freeze_reason',
        'nilai_freeze_updated_by',
        'nilai_freeze_updated_at',
    ];

    private const RELATION_SELECTS = [
        'tugas_jawaban' => [
            'profiles' => [
                'table' => 'profiles',
                'local_key' => 'user_id',
                'foreign_key' => 'id',
                'columns' => ['id', 'nama', 'photo_url', 'photo_path'],
            ],
        ],
        'jam_kosong' => [
            'profiles' => [
                'table' => 'profiles',
                'local_key' => 'created_by',
                'foreign_key' => 'id',
                'columns' => ['id', 'nama', 'photo_url', 'photo_path'],
            ],
        ],
    ];

    private const ACADEMIC_PERIOD_TABLES = [
        'kelas',
        'jadwal',
        'tugas',
        'quizzes',
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'absensi_eskul',
        'jam_kosong',
        'ekskul',
        'ekskul_anggota',
        'anggota_ekskul',
    ];

    private const ACADEMIC_DEFAULT_SCOPE_TABLES = [
        'jadwal',
        'tugas',
        'quizzes',
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'absensi_eskul',
        'jam_kosong',
        'ekskul_anggota',
        'anggota_ekskul',
    ];

    private const ACADEMIC_DATE_FILTER_COLUMNS = [
        'tugas' => ['created_at', 'mulai', 'deadline'],
        'quizzes' => ['created_at', 'starts_at', 'deadline_at'],
        'absensi' => ['tanggal', 'waktu', 'created_at'],
        'absensi_ajuan' => ['tanggal', 'created_at', 'waktu_respon'],
        'absensi_settings' => ['tanggal', 'created_at'],
        'jam_kosong' => ['tanggal', 'created_at'],
    ];

    private const ACADEMIC_CHILD_SNAPSHOT_TABLES = [
        'tugas_jawaban',
        'quiz_submissions',
    ];

    public function __construct(
        private readonly WhatsAppNotificationService $whatsAppNotificationService,
        private readonly DbDeleteExecutor $dbDeleteExecutor,
        private readonly DbRequestShapeValidator $dbRequestShapeValidator,
        private readonly DbInsertExecutor $dbInsertExecutor,
        private readonly DbSelectExecutor $dbSelectExecutor,
        private readonly DbTableRegistry $dbTableRegistry,
        private readonly DbUpdateExecutor $dbUpdateExecutor,
        private readonly DbUpsertExecutor $dbUpsertExecutor
    ) {}

    private ?string $currentTenantId = null;

    private array $guruKelasCache = [];

    private array $guruWaliKelasCache = [];

    private array $guruEskulCache = [];

    private array $guruStudentRfidCache = [];

    private array $guruQuizCache = [];

    private array $kelasQuizCache = [];

    private array $quizQuestionCache = [];

    private array $tableColumnCache = [];

    private array $tableJsonColumnCache = [];

    private array $academicPeriodCache = [];

    private array $classCohortCache = [];

    private array $studentCohortCache = [];

    private array $knownJsonColumns = [
        'audit_log' => ['old_data', 'new_data'],
        'templat_sertifikat_publik' => ['fields'],
        'quiz_violation_logs' => ['event_meta'],
        'tugas_jawaban' => ['file_urls'],
    ];

    public function handle(Request $request)
    {
        $table = $request->input('table');
        $action = $request->input('action', 'select');

        if (! $this->dbTableRegistry->isAllowed($table)) {
            return $this->deny('Table tidak diizinkan', 400);
        }

        if (! in_array($action, ['select', 'insert', 'update', 'delete', 'upsert'], true)) {
            return $this->deny('Aksi tidak diizinkan', 400);
        }

        $validationError = $this->validateDbRequestShape($request);
        if ($validationError !== null) {
            return $this->deny($validationError, 422);
        }

        $user = $request->user();
        $profile = $this->profile($request);
        $this->currentTenantId = $this->tenantId($request);
        $tenantId = $this->currentTenantId;
        $tenantScoped = $this->dbTableRegistry->isTenantScoped($table);

        if (! $user && ! ($action === 'select' && $table === 'settings')) {
            return response()->json(['error' => 'Unauthenticated'], 401);
        }

        $payload = $request->input('payload');
        $query = DB::table($table);

        if ($tenantScoped) {
            if (! $tenantId) {
                return $this->deny('Tenant tidak valid', 400);
            }
            $query->where('tenant_id', $tenantId);
        }

        $policy = $this->applyPolicy($table, $action, $query, $payload, $request, $profile);
        if ($policy !== true) {
            return $policy;
        }

        $filters = $request->input('filters', []);
        $this->applyFilters($query, $filters);
        $this->applyDefaultAcademicSelectScope($table, $query, $filters, $tenantId);

        if (in_array($action, ['update', 'delete'], true) && ! $this->isAdmin($request)) {
            $hasFilters = $this->hasAnyFilter($filters);
            if (! $hasFilters) {
                return $this->deny('Filter wajib untuk update/delete');
            }
        }

        $orders = $request->input('order', []);
        $this->applyOrder($query, $orders);

        $maxSelectLimit = $this->isAdmin($request)
            ? (int) env('DB_MAX_SELECT_LIMIT_ADMIN', 10000)
            : (int) env('DB_MAX_SELECT_LIMIT', 5000);
        $maxSelectLimit = max(100, min(50000, $maxSelectLimit));

        $limit = $request->input('limit');
        if ($limit !== null) {
            $limit = min($maxSelectLimit, max(0, (int) $limit));
        }

        $offset = $request->input('offset');
        if ($offset !== null) {
            $offset = min(100000, max(0, (int) $offset));
        }

        if ($action !== 'select') {
            $approvalResponse = $this->queueCriticalChangeApprovalIfNeeded(
                $request,
                $table,
                $action,
                $payload,
                $filters,
                $orders,
                $limit,
                $offset,
                $tenantId
            );
            if ($approvalResponse !== null) {
                return $approvalResponse;
            }
        }

        if ($action === 'select') {
            return $this->dbSelectExecutor->execute(
                $request,
                $query,
                [
                    'table' => $table,
                    'tenant_id' => $tenantId,
                    'user' => $user,
                    'profile' => $profile,
                    'is_admin' => $this->isAdmin($request),
                    'limit' => $limit,
                    'offset' => $offset,
                ],
                [
                    'parse_relation_selects' => fn (string $table, string $columns): array => $this->parseRelationSelects($table, $columns),
                    'parse_columns' => fn (string $table, string $columns): array => $this->parseColumns($table, $columns),
                    'is_selectable_column' => fn (string $table, string $column): bool => $this->isSelectableColumn($table, $column),
                    'sanitize_public_settings_rows' => fn ($rows): array => $this->sanitizePublicSettingsRows($rows),
                    'guru_wali_kelas_ids' => fn (string $userId): array => $this->guruWaliKelasIds($userId),
                    'sanitize_profiles_for_non_admin' => fn ($rows, string $viewerId, string $viewerRole, array $waliKelas): array => $this->sanitizeProfilesForNonAdmin($rows, $viewerId, $viewerRole, $waliKelas),
                    'sanitize_quiz_rows' => fn ($rows): array => $this->sanitizeQuizRows($rows),
                    'hydrate_relation_selects' => fn ($rows, array $relations, ?string $tenantId) => $this->hydrateRelationSelects($rows, $relations, $tenantId),
                ]
            );
        }

        if ($action === 'insert') {
            return $this->dbInsertExecutor->execute(
                $request,
                [
                    'table' => $table,
                    'payload' => $payload,
                    'tenant_scoped' => $tenantScoped,
                    'tenant_id' => $tenantId,
                    'is_admin' => $this->isAdmin($request),
                ],
                $this->dbInsertCallbacks()
            );
        }

        if ($action === 'update') {
            return $this->dbUpdateExecutor->execute(
                $request,
                $query,
                [
                    'table' => $table,
                    'payload' => $payload,
                    'tenant_scoped' => $tenantScoped,
                    'tenant_id' => $tenantId,
                    'filters' => $filters,
                    'is_admin' => $this->isAdmin($request),
                ],
                $this->dbUpdateCallbacks()
            );
        }

        if ($action === 'delete') {
            return $this->dbDeleteExecutor->execute(
                $request,
                $query,
                [
                    'table' => $table,
                    'tenant_id' => $tenantId,
                    'is_admin' => $this->isAdmin($request),
                ],
                $this->dbDeleteCallbacks()
            );
        }

        if ($action === 'upsert') {
            return $this->dbUpsertExecutor->execute(
                $request,
                [
                    'table' => $table,
                    'payload' => $payload,
                    'tenant_scoped' => $tenantScoped,
                    'tenant_id' => $tenantId,
                ],
                $this->dbUpsertCallbacks()
            );
        }

        return $this->deny('Aksi tidak dikenali', 400);
    }

    public function batch(Request $request)
    {
        $requests = $request->input('requests', []);
        if (! is_array($requests)) {
            return $this->deny('Daftar request batch tidak valid', 422);
        }

        $maxBatchItems = (int) env('DB_BATCH_MAX_ITEMS', 25);
        $maxBatchItems = max(1, min(50, $maxBatchItems));
        if (count($requests) > $maxBatchItems) {
            return $this->deny("Maksimal {$maxBatchItems} request per batch", 422);
        }

        $data = [];
        $errors = [];

        foreach (array_values($requests) as $index => $item) {
            if (! is_array($item)) {
                $errors[(string) $index] = [
                    'message' => 'Item batch tidak valid',
                    'status' => 422,
                ];

                continue;
            }

            $key = trim((string) ($item['key'] ?? $index));
            if ($key === '') {
                $key = (string) $index;
            }

            $action = (string) ($item['action'] ?? 'select');
            if ($action !== 'select') {
                $errors[$key] = [
                    'message' => 'Batch hanya mendukung aksi select',
                    'status' => 422,
                ];

                continue;
            }

            $dbRequest = Request::create('/api/db', 'POST', [
                'table' => $item['table'] ?? null,
                'action' => 'select',
                'columns' => $item['columns'] ?? '*',
                'filters' => $item['filters'] ?? [],
                'order' => $item['order'] ?? [],
                'limit' => $item['limit'] ?? null,
                'offset' => $item['offset'] ?? null,
                'count' => $item['count'] ?? null,
                'head' => (bool) ($item['head'] ?? false),
            ]);

            $dbRequest->setUserResolver(fn () => $request->user());
            $dbRequest->attributes->set('tenant_id', $request->attributes->get('tenant_id'));
            $dbRequest->attributes->set('tenant_slug', $request->attributes->get('tenant_slug'));

            $response = $this->handle($dbRequest);
            $payload = json_decode((string) $response->getContent(), true);
            if (! is_array($payload)) {
                $payload = [];
            }

            if ($response->getStatusCode() >= 400) {
                $errors[$key] = [
                    'message' => $payload['error'] ?? $payload['message'] ?? 'Request batch gagal',
                    'code' => $payload['code'] ?? null,
                    'status' => $response->getStatusCode(),
                ];

                continue;
            }

            $data[$key] = [
                'data' => $payload['data'] ?? null,
                'count' => $payload['count'] ?? null,
            ];
        }

        return response()->json([
            'data' => $data,
            'errors' => $errors,
        ]);
    }

    private function dbInsertCallbacks(): array
    {
        return [
            'deny' => fn (string $message, int $code = 403) => $this->deny($message, $code),
            'normalize_rows' => fn ($payload): array => $this->normalizeRows($payload),
            'attach_tenant_rows' => fn (array $rows, string $tenantId): array => $this->attachTenantRows($rows, $tenantId),
            'attach_academic_period_rows' => fn (string $table, array $rows, ?string $tenantId): array => $this->attachAcademicPeriodRows($table, $rows, $tenantId),
            'normalize_json_rows_for_table' => fn (string $table, array $rows): array => $this->normalizeJsonRowsForTable($table, $rows),
            'filter_rows_to_existing_columns' => fn (string $table, array $rows): array => $this->filterRowsToExistingColumns($table, $rows),
            'attach_profile_cohort_rows' => fn (array $rows, ?string $tenantId): array => $this->attachProfileCohortRows($rows, $tenantId),
            'prepare_kelas_rows_for_insert' => function (array &$rows, ?string $tenantId): ?array {
                return $this->prepareKelasRowsForInsert($rows, $tenantId);
            },
            'validate_ekskul_registration_deadline_rows' => fn (array $rows, ?string $tenantId, bool $requireDeadline = false): ?array => $this->validateEskulRegistrationDeadlineRows($rows, $tenantId, $requireDeadline),
            'validate_ekskul_membership_rows_open' => fn (array $rows, ?string $tenantId): ?array => $this->validateEskulMembershipRowsOpen($rows, $tenantId),
            'save_settings_singleton_rows' => fn (array $rows, ?string $tenantId, bool $tenantScoped): array => $this->saveSettingsSingletonRows($rows, $tenantId, $tenantScoped),
            'validate_profile_rows_for_tenant_insert' => function (array &$rows, ?string $tenantId): ?array {
                return $this->validateProfileRowsForTenantInsert($rows, $tenantId);
            },
            'save_tenant_singleton_rows' => fn (string $table, array $rows, string $tenantId): array => $this->saveTenantSingletonRows($table, $rows, $tenantId),
            'is_nilai_audit_actor' => fn (Request $request): bool => $this->isNilaiAuditActor($request),
            'fetch_tugas_jawaban_rows_for_payload' => fn (array $rows, ?string $tenantId): array => $this->fetchTugasJawabanRowsForPayload($rows, $tenantId),
            'is_unique_constraint_exception' => fn (QueryException $e): bool => $this->isUniqueConstraintException($e),
            'notify_whatsapp_mutation' => fn (?string $tenantId, string $table, string $action, array $beforeRows = [], array $afterRows = []) => $this->notifyWhatsAppMutation($tenantId, $table, $action, $beforeRows, $afterRows),
            'log_audit' => fn (Request $request, string $table, string $recordId, string $action, $oldData = null, $newData = null, ?string $tenantId = null) => $this->logAudit($request, $table, $recordId, $action, $oldData, $newData, $tenantId),
        ];
    }

    private function dbUpdateCallbacks(): array
    {
        return [
            'deny' => fn (string $message, int $code = 403) => $this->deny($message, $code),
            'should_notify_whatsapp_for_table' => fn (string $table): bool => $this->shouldNotifyWhatsAppForTable($table),
            'query_rows_to_array' => fn ($query): array => $this->queryRowsToArray($query),
            'is_nilai_audit_actor' => fn (Request $request): bool => $this->isNilaiAuditActor($request),
            'calculate_age_from_birth_date' => fn ($rawDate): ?int => $this->calculateAgeFromBirthDate($rawDate),
            'normalize_json_row_for_table' => fn (string $table, array $payload): array => $this->normalizeJsonRowForTable($table, $payload),
            'filter_payload_to_existing_columns' => fn (string $table, array $payload): array => $this->filterPayloadToExistingColumns($table, $payload),
            'normalize_profile_cohort_payload' => fn (array $payload, ?string $tenantId): array => $this->normalizeProfileCohortPayload($payload, $tenantId),
            'validate_ekskul_registration_deadline_rows' => fn (array $rows, ?string $tenantId, bool $requireDeadline = false): ?array => $this->validateEskulRegistrationDeadlineRows($rows, $tenantId, $requireDeadline),
            'is_selectable_column' => fn (string $table, string $column): bool => $this->isSelectableColumn($table, $column),
            'sync_teacher_display_name_snapshots' => fn (string $tenantId, string $teacherId, string $displayName, Carbon $now): array => $this->syncTeacherDisplayNameSnapshots($tenantId, $teacherId, $displayName, $now),
            'sync_student_display_name_snapshots' => fn (string $tenantId, string $studentId, string $displayName, Carbon $now): array => $this->syncStudentDisplayNameSnapshots($tenantId, $studentId, $displayName, $now),
            'notify_whatsapp_mutation' => fn (?string $tenantId, string $table, string $action, array $beforeRows = [], array $afterRows = []) => $this->notifyWhatsAppMutation($tenantId, $table, $action, $beforeRows, $afterRows),
            'log_audit' => fn (Request $request, string $table, string $recordId, string $action, $oldData = null, $newData = null, ?string $tenantId = null) => $this->logAudit($request, $table, $recordId, $action, $oldData, $newData, $tenantId),
        ];
    }

    private function dbDeleteCallbacks(): array
    {
        return [
            'should_notify_whatsapp_for_table' => fn (string $table): bool => $this->shouldNotifyWhatsAppForTable($table),
            'query_rows_to_array' => fn ($query): array => $this->queryRowsToArray($query),
            'is_nilai_audit_actor' => fn (Request $request): bool => $this->isNilaiAuditActor($request),
            'notify_whatsapp_mutation' => fn (?string $tenantId, string $table, string $action, array $beforeRows = [], array $afterRows = []) => $this->notifyWhatsAppMutation($tenantId, $table, $action, $beforeRows, $afterRows),
            'log_audit' => fn (Request $request, string $table, string $recordId, string $action, $oldData = null, $newData = null, ?string $tenantId = null) => $this->logAudit($request, $table, $recordId, $action, $oldData, $newData, $tenantId),
        ];
    }

    private function dbUpsertCallbacks(): array
    {
        return [
            'deny' => fn (string $message, int $code = 403) => $this->deny($message, $code),
            'normalize_rows' => fn ($payload): array => $this->normalizeRows($payload),
            'attach_tenant_rows' => fn (array $rows, string $tenantId): array => $this->attachTenantRows($rows, $tenantId),
            'attach_academic_period_rows' => fn (string $table, array $rows, ?string $tenantId): array => $this->attachAcademicPeriodRows($table, $rows, $tenantId),
            'normalize_json_rows_for_table' => fn (string $table, array $rows): array => $this->normalizeJsonRowsForTable($table, $rows),
            'filter_rows_to_existing_columns' => fn (string $table, array $rows): array => $this->filterRowsToExistingColumns($table, $rows),
            'validate_ekskul_registration_deadline_rows' => fn (array $rows, ?string $tenantId, bool $requireDeadline = false): ?array => $this->validateEskulRegistrationDeadlineRows($rows, $tenantId, $requireDeadline),
            'validate_ekskul_membership_rows_open' => fn (array $rows, ?string $tenantId): ?array => $this->validateEskulMembershipRowsOpen($rows, $tenantId),
            'is_nilai_audit_actor' => fn (Request $request): bool => $this->isNilaiAuditActor($request),
            'fetch_tugas_jawaban_rows_for_payload' => fn (array $rows, ?string $tenantId): array => $this->fetchTugasJawabanRowsForPayload($rows, $tenantId),
            'save_settings_singleton_rows' => fn (array $rows, ?string $tenantId, bool $tenantScoped): array => $this->saveSettingsSingletonRows($rows, $tenantId, $tenantScoped),
            'save_tenant_singleton_rows' => fn (string $table, array $rows, string $tenantId): array => $this->saveTenantSingletonRows($table, $rows, $tenantId),
            'is_selectable_column' => fn (string $table, string $column): bool => $this->isSelectableColumn($table, $column),
            'fetch_rows_by_keys' => fn (string $table, array $rows, array $uniqueBy, ?string $tenantId): array => $this->fetchRowsByKeys($table, $rows, $uniqueBy, $tenantId),
            'manual_upsert_by_keys' => fn (string $table, array $rows, array $uniqueBy, ?string $tenantId): array => $this->manualUpsertByKeys($table, $rows, $uniqueBy, $tenantId),
            'notify_whatsapp_mutation' => fn (?string $tenantId, string $table, string $action, array $beforeRows = [], array $afterRows = []) => $this->notifyWhatsAppMutation($tenantId, $table, $action, $beforeRows, $afterRows),
            'log_audit' => fn (Request $request, string $table, string $recordId, string $action, $oldData = null, $newData = null, ?string $tenantId = null) => $this->logAudit($request, $table, $recordId, $action, $oldData, $newData, $tenantId),
        ];
    }

    private function applyPolicy(string $table, string $action, $query, &$payload, Request $request, $profile)
    {
        $user = $request->user();
        $userId = $user?->id;

        if ($user && ! $profile && ! $this->isSuperAdmin($request) && $table !== 'profiles' && $table !== 'settings') {
            return $this->deny('Profil belum tersedia', 403);
        }

        // SETTINGS
        if ($table === 'settings') {
            if ($action === 'select') {
                return true;
            }
            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            $normalizeError = $this->normalizeSettingsGovernancePayload($payload);
            if ($normalizeError !== null) {
                return $this->deny($normalizeError, 422);
            }

            return true;
        }

        if ($this->isNilaiFreezeMutationTarget($table, $action, $request)) {
            $freezeResponse = $this->denyIfNilaiFrozen($request, 'Perubahan nilai');
            if ($freezeResponse !== null) {
                return $freezeResponse;
            }
        }

        // PROFILES
        if ($table === 'profiles') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }

                $query->where(function ($q) use ($request, $profile, $userId) {
                    $q->where('id', $userId);

                    if ($this->isGuru($request)) {
                        $kelas = $this->guruKelasIds($userId);
                        if (! empty($kelas)) {
                            $q->orWhere(function ($q2) use ($kelas) {
                                $q2->where('role', 'siswa')->whereIn('kelas', $kelas);
                            });
                        }

                        if (Schema::hasTable('rapot_siswa')) {
                            $tenantId = $this->currentTenantId;
                            $q->orWhereIn('id', function ($sub) use ($kelas, $userId, $tenantId) {
                                $sub->select('siswa_id')
                                    ->from('rapot_siswa')
                                    ->where(function ($owner) use ($kelas, $userId) {
                                        if (! empty($kelas)) {
                                            $owner->whereIn('kelas_id', $kelas);
                                        } else {
                                            $owner->whereRaw('1 = 0');
                                        }
                                        $owner->orWhere('created_by', $userId)
                                            ->orWhere('updated_by', $userId);
                                    });
                                if ($tenantId) {
                                    $sub->where('tenant_id', $tenantId);
                                }
                            });
                        }

                        $ekskulIds = $this->guruEskulIds($userId);
                        if (! empty($ekskulIds)) {
                            $q->orWhere(function ($q2) use ($ekskulIds) {
                                $q2->where('role', 'siswa')
                                    ->whereIn('id', function ($sub) use ($ekskulIds) {
                                        $sub->select('user_id')
                                            ->from('ekskul_anggota')
                                            ->whereIn('ekskul_id', $ekskulIds);
                                        $this->applyTenantFilter($sub);
                                        $this->applyCurrentAcademicPeriodToQuery($sub, 'ekskul_anggota');
                                    });
                            });
                        }

                        $q->orWhereIn('role', ['guru', 'teacher']);
                    } elseif ($this->isSiswa($request)) {
                        $kelas = $profile?->kelas;
                        if ($kelas) {
                            $q->orWhere(function ($q2) use ($kelas) {
                                $q2->where('role', 'siswa')->where('kelas', $kelas);
                            });
                        }
                        $q->orWhereIn('role', ['guru', 'teacher']);
                    }
                });

                return true;
            }

            if ($action === 'insert') {
                if ($this->isAdmin($request)) {
                    return true;
                }

                $this->mapPayload($payload, function ($row) use ($userId) {
                    $row = $this->filterPayload($row, [
                        'id', 'email', 'nama', 'role', 'kelas', 'jk', 'usia', 'telp', 'photo_url',
                        'nis', 'agama', 'jabatan', 'alamat', 'status', 'created_at', 'updated_at',
                        'no_hp_siswa', 'no_hp_wali', 'tanggal_lahir', 'photo_path', 'photo_updated_at',
                    ]);

                    if (! isset($row['id']) || $row['id'] !== $userId) {
                        $row['id'] = $userId;
                    }

                    if (isset($row['role']) && $row['role'] === 'admin') {
                        unset($row['role']);
                    }

                    if (! isset($row['created_at'])) {
                        $row['created_at'] = now();
                    }
                    if (! isset($row['updated_at'])) {
                        $row['updated_at'] = now();
                    }

                    return $row;
                });

                return true;
            }

            if ($action === 'update') {
                if ($this->isAdmin($request)) {
                    return true;
                }

                $query->where('id', $userId);

                if (is_array($payload)) {
                    $payload = $this->filterPayload($payload, [
                        'nama', 'jk', 'usia', 'telp', 'photo_url', 'photo_path', 'photo_updated_at',
                        'nis', 'agama', 'jabatan', 'alamat', 'no_hp_siswa', 'no_hp_wali', 'tanggal_lahir',
                        'updated_at',
                    ]);

                    $payload['updated_at'] = now();

                    if ($this->isSiswa($request)) {
                        unset($payload['kelas']);
                        unset($payload['nama']);
                    }
                }

                return true;
            }

            if ($action === 'delete') {
                if ($this->isAdmin($request)) {
                    return true;
                }

                return $this->deny();
            }

            return $this->deny();
        }

        // USER PRESENCE (read monitoring)
        if ($table === 'user_presence') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }

                if ($this->isGuru($request)) {
                    $kelas = $this->guruKelasIds($userId);
                    $tenantId = $this->currentTenantId;
                    $query->where(function ($q) use ($userId, $kelas, $tenantId) {
                        $q->where('user_id', $userId);
                        if (! empty($kelas)) {
                            $q->orWhereIn('user_id', function ($sub) use ($kelas, $tenantId) {
                                $sub->select('id')
                                    ->from('profiles')
                                    ->where('role', 'siswa')
                                    ->whereIn('kelas', $kelas);
                                if ($tenantId) {
                                    $sub->where('tenant_id', $tenantId);
                                }
                            });
                        }
                    });

                    return true;
                }

                if ($this->isSiswa($request)) {
                    $query->where('user_id', $userId);

                    return true;
                }

                return $this->deny();
            }

            if ($this->isAdmin($request)) {
                return true;
            }

            return $this->deny();
        }

        // PUBLIC READ TABLES (auth), ADMIN WRITE
        $publicReadTables = [
            'kelas',
            'mata_pelajaran',
            'struktur_sekolah',
            'organisasi',
            'ekskul',
            'organisasi_anggota',
        ];

        if (in_array($table, $publicReadTables, true)) {
            if ($action === 'select') {
                return true;
            }
            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // GURU_MAPEL_BOBOT
        if ($table === 'guru_mapel_bobot') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $query->where('guru_id', $userId);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if (! $this->isGuru($request)) {
                    return $this->deny();
                }

                $this->mapPayload($payload, function ($row) use ($userId) {
                    $row = $this->filterPayload($row, [
                        'id',
                        'guru_id',
                        'mapel',
                        'bobot_tugas_pr',
                        'bobot_quiz_reguler',
                        'bobot_quiz_uts',
                        'bobot_quiz_uas',
                        'created_at',
                        'updated_at',
                    ]);
                    $row['guru_id'] = $userId;
                    if (! isset($row['id']) || trim((string) $row['id']) === '') {
                        $row['id'] = (string) Str::uuid();
                    }
                    if (! isset($row['created_at'])) {
                        $row['created_at'] = now();
                    }
                    $row['updated_at'] = now();

                    return $row;
                });

                $validationError = $this->validateGuruMapelBobotPayload($payload, true);
                if ($validationError !== null) {
                    return $this->deny($validationError, 422);
                }
                $ownershipError = $this->validateGuruMapelBobotOwnership($payload, (string) $userId);
                if ($ownershipError !== null) {
                    return $this->deny($ownershipError, 422);
                }

                return true;
            }

            if ($action === 'update') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if (! $this->isGuru($request)) {
                    return $this->deny();
                }

                $query->where('guru_id', $userId);
                if (is_array($payload)) {
                    $payload = $this->filterPayload($payload, [
                        'mapel',
                        'bobot_tugas_pr',
                        'bobot_quiz_reguler',
                        'bobot_quiz_uts',
                        'bobot_quiz_uas',
                        'updated_at',
                    ]);
                    $payload['updated_at'] = now();

                    $validationError = $this->validateGuruMapelBobotPayload($payload, true);
                    if ($validationError !== null) {
                        return $this->deny($validationError, 422);
                    }
                    $ownershipError = $this->validateGuruMapelBobotOwnership($payload, (string) $userId);
                    if ($ownershipError !== null) {
                        return $this->deny($ownershipError, 422);
                    }
                }

                return true;
            }

            if ($action === 'delete') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if (! $this->isGuru($request)) {
                    return $this->deny();
                }
                $query->where('guru_id', $userId);

                return true;
            }

            return $this->deny();
        }

        // OSIS_ANGGOTA
        if ($table === 'osis_anggota') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }

                if ($this->isGuru($request)) {
                    $kelas = $this->guruKelasIds($userId);
                    if (empty($kelas)) {
                        return $this->deny();
                    }

                    $tenantId = $this->currentTenantId;
                    $query->whereIn('siswa_id', function ($q) use ($kelas, $tenantId) {
                        $q->select('id')
                            ->from('profiles')
                            ->where('role', 'siswa')
                            ->whereIn('kelas', $kelas);
                        if ($tenantId) {
                            $q->where('tenant_id', $tenantId);
                        }
                    });

                    return true;
                }

                if ($this->isSiswa($request)) {
                    $query->where('siswa_id', $userId);

                    return true;
                }

                return $this->deny();
            }

            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // CERTIFICATES
        if ($table === 'certificates') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                $query->where('user_id', $userId);

                return true;
            }
            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // AUDIT LOG (read-only)
        if ($table === 'audit_log') {
            if ($action === 'select' && $this->isAdmin($request)) {
                return true;
            }

            return $this->deny();
        }

        // ADMIN ONLY TABLES
        $adminOnlyTables = [
            'templat_sertifikat_publik',
            'printed_cards',
            'allowed_registrations',
            'registration_otps',
            'admin_users',
            'anggota_eksku1',
            'anggota_ekskul',
            'import_siswa_histories',
            'import_siswa_history_items',
            'import_guru_histories',
            'import_guru_history_items',
        ];

        if (in_array($table, $adminOnlyTables, true)) {
            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // PENGUMUMAN
        if ($table === 'pengumuman') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }

                $role = $profile?->role;
                $targets = ['semua', 'all', ''];
                if ($role === 'siswa') {
                    $targets[] = 'siswa';
                }
                if ($role === 'guru' || $role === 'teacher') {
                    $targets[] = 'guru';
                }

                $query->where(function ($q) use ($targets) {
                    $q->whereNull('target')
                        ->orWhereIn(DB::raw('lower(target)'), $targets);
                });

                return true;
            }

            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // KELAS_STRUKTUR
        if ($table === 'kelas_struktur') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $query->where('wali_guru_id', $userId);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $kelas = $profile?->kelas;
                    $tenantId = $this->currentTenantId;
                    $query->where(function ($q) use ($kelas, $userId, $tenantId) {
                        if ($kelas) {
                            $q->where('kelas_id', $kelas);
                        } else {
                            $q->whereRaw('1 = 0');
                        }

                        $q->orWhereIn('id', function ($sub) use ($userId, $tenantId) {
                            $sub->select('quiz_id')
                                ->from('quiz_submissions')
                                ->where('siswa_id', $userId);
                            if ($tenantId && $this->isSelectableColumn('quiz_submissions', 'tenant_id')) {
                                $sub->where('tenant_id', $tenantId);
                            }
                        });
                    });

                    return true;
                }

                return $this->deny();
            }

            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // JADWAL
        if ($table === 'jadwal') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $query->where('guru_id', $userId);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('kelas_id', $profile?->kelas);

                    return true;
                }

                return $this->deny();
            }

            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // EKSKUL_ANGGOTA
        if ($table === 'ekskul_anggota') {
            if ($action === 'select') {
                return true;
            }

            if ($this->isAdmin($request)) {
                return true;
            }

            if (! $this->isSiswa($request)) {
                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                $this->mapPayload($payload, function ($row) use ($userId) {
                    $row['user_id'] = $userId;

                    return $row;
                });

                $validationError = $this->validateSiswaEskulJoinPayload($payload, (string) $userId);
                if ($validationError !== null) {
                    return $this->deny($validationError, 422);
                }

                return true;
            }

            if (in_array($action, ['update', 'delete'], true)) {
                $query->where('user_id', $userId);

                $validationError = $this->validateSiswaEskulMutationTargets($request, (string) $userId);
                if ($validationError !== null) {
                    return $this->deny($validationError, 422);
                }

                return true;
            }
        }

        // QUIZZES
        if ($table === 'quizzes') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $wali = $this->guruWaliKelasIds($userId);
                    $query->where(function ($q) use ($userId, $wali) {
                        $q->where('guru_id', $userId);
                        if (! empty($wali)) {
                            $q->orWhereIn('kelas_id', $wali);
                        }
                    });

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('kelas_id', $profile?->kelas);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $this->mapPayload($payload, function ($row) use ($userId) {
                        $row = $this->filterPayload($row, [
                            'id', 'guru_id', 'kelas_id', 'mapel', 'nama', 'starts_at', 'deadline_at',
                            'penilaian', 'result_visible_to_students', 'mode', 'is_live', 'is_active', 'live_started_at',
                            'duration_minutes', 'created_at', 'updated_at',
                        ]);
                        $row['guru_id'] = $userId;
                        if (! isset($row['created_at'])) {
                            $row['created_at'] = now();
                        }
                        $row['updated_at'] = now();

                        return $row;
                    });
                    $quizValidationError = $this->validateGuruQuizCreatePayload($payload, $userId);
                    if ($quizValidationError !== null) {
                        return $this->deny($quizValidationError, 422);
                    }

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $query->where('guru_id', $userId);
                    if ($action === 'update' && is_array($payload)) {
                        $payload = $this->filterPayload($payload, [
                            'kelas_id', 'mapel', 'nama', 'starts_at', 'deadline_at', 'penilaian',
                            'result_visible_to_students', 'mode', 'is_live', 'is_active', 'live_started_at', 'duration_minutes',
                            'updated_at',
                        ]);
                        $payload['updated_at'] = now();

                        $quizValidationError = $this->validateGuruQuizUpdatePayload($payload, $request, $userId);
                        if ($quizValidationError !== null) {
                            return $this->deny($quizValidationError, 422);
                        }
                    }

                    return true;
                }

                return $this->deny();
            }
        }

        // QUIZ_QUESTIONS
        if ($table === 'quiz_questions') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    if (empty($quizIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('quiz_id', $quizIds);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $quizIds = $this->kelasQuizIds($profile?->kelas);
                    if (empty($quizIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('quiz_id', $quizIds);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    $this->mapPayload($payload, function ($row) {
                        $row = $this->filterPayload($row, [
                            'id', 'quiz_id', 'nomor', 'soal', 'image_path', 'poin', 'question_type', 'created_at', 'updated_at',
                        ]);
                        $row['question_type'] = $this->normalizeQuestionType($row['question_type'] ?? null);
                        if (! isset($row['created_at'])) {
                            $row['created_at'] = now();
                        }
                        $row['updated_at'] = now();

                        return $row;
                    });
                    if ($this->payloadHasInvalidQuiz($payload, $quizIds)) {
                        return $this->deny('Quiz tidak diizinkan');
                    }
                    if ($this->quizIdsHaveOngoingSubmissions($this->quizIdsFromPayload($payload))) {
                        return $this->deny('Soal quiz tidak bisa diubah saat masih ada siswa yang mengerjakan quiz.', 409);
                    }

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    if (empty($quizIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('quiz_id', $quizIds);
                    if ($action === 'update' && is_array($payload)) {
                        $payload = $this->filterPayload($payload, [
                            'nomor', 'soal', 'image_path', 'poin', 'question_type', 'updated_at',
                        ]);
                        if (array_key_exists('question_type', $payload)) {
                            $payload['question_type'] = $this->normalizeQuestionType($payload['question_type']);
                        }
                        $payload['updated_at'] = now();
                    }
                    $targetQuizIds = $this->quizIdsForTargetQuestionMutation($query, $request->input('filters', []));
                    if ($this->quizIdsHaveOngoingSubmissions($targetQuizIds)) {
                        return $this->deny('Soal quiz tidak bisa diubah saat masih ada siswa yang mengerjakan quiz.', 409);
                    }

                    return true;
                }

                return $this->deny();
            }
        }

        // QUIZ_OPTIONS
        if ($table === 'quiz_options') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    $questionIds = $this->questionIdsByQuizIds($quizIds);
                    if (empty($questionIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('question_id', $questionIds);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $quizIds = $this->kelasQuizIds($profile?->kelas);
                    $questionIds = $this->questionIdsByQuizIds($quizIds);
                    if (empty($questionIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('question_id', $questionIds);
                    $columns = $request->input('columns', '*');
                    if ($columns === '*' || str_contains($columns, 'is_correct')) {
                        $request->merge([
                            'columns' => 'id,question_id,label,text,image_path,created_at,updated_at',
                        ]);
                    }

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    $questionIds = $this->questionIdsByQuizIds($quizIds);
                    $this->mapPayload($payload, function ($row) {
                        $row = $this->filterPayload($row, [
                            'id', 'question_id', 'label', 'text', 'image_path', 'is_correct',
                            'created_at', 'updated_at',
                        ]);
                        if (! isset($row['created_at'])) {
                            $row['created_at'] = now();
                        }
                        $row['updated_at'] = now();

                        return $row;
                    });
                    if ($this->payloadHasInvalidQuestion($payload, $questionIds)) {
                        return $this->deny('Soal tidak diizinkan');
                    }
                    $targetQuizIds = $this->quizIdsByQuestionIds($this->questionIdsFromPayload($payload));
                    if ($this->quizIdsHaveOngoingSubmissions($targetQuizIds)) {
                        return $this->deny('Opsi jawaban tidak bisa diubah saat masih ada siswa yang mengerjakan quiz.', 409);
                    }

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    $questionIds = $this->questionIdsByQuizIds($quizIds);
                    if (empty($questionIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('question_id', $questionIds);
                    if ($action === 'update' && is_array($payload)) {
                        $payload = $this->filterPayload($payload, [
                            'label', 'text', 'image_path', 'is_correct', 'updated_at',
                        ]);
                        $payload['updated_at'] = now();
                    }
                    $targetQuizIds = $this->quizIdsForTargetOptionMutation($query, $request->input('filters', []));
                    if ($this->quizIdsHaveOngoingSubmissions($targetQuizIds)) {
                        return $this->deny('Opsi jawaban tidak bisa diubah saat masih ada siswa yang mengerjakan quiz.', 409);
                    }

                    return true;
                }

                return $this->deny();
            }
        }

        // QUIZ_SUBMISSIONS
        if ($table === 'quiz_submissions') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIdsForWali($userId);
                    if (empty($quizIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('quiz_id', $quizIds);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('siswa_id', $userId);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    return $this->deny('Nilai quiz dihitung otomatis oleh sistem');
                }
                if ($this->isSiswa($request)) {
                    return $this->deny('Mulai quiz wajib melalui endpoint start attempt');
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    if (empty($quizIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('quiz_id', $quizIds);
                    if ($action === 'update' && is_array($payload)) {
                        $payload = $this->filterPayload($payload, ['updated_at']);
                        $payload['updated_at'] = now();
                    }

                    return true;
                }
                if ($this->isSiswa($request)) {
                    return $this->deny('Perubahan attempt quiz wajib melalui endpoint quiz');
                }

                return $this->deny();
            }
        }

        // QUIZ_ANSWERS
        if ($table === 'quiz_answers') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    $submissionIds = $this->submissionIdsByQuizIds($quizIds);
                    if (empty($submissionIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('submission_id', $submissionIds);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $submissionIds = $this->submissionIdsByUser($userId);
                    if (empty($submissionIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('submission_id', $submissionIds);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isSiswa($request)) {
                    return $this->deny('Jawaban quiz wajib disimpan melalui endpoint khusus');
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIds($userId);
                    $submissionIds = $this->submissionIdsByQuizIds($quizIds);
                    if (empty($submissionIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('submission_id', $submissionIds);
                    if ($action === 'update' && is_array($payload)) {
                        $payload = $this->filterPayload($payload, [
                            'is_correct', 'poin', 'updated_at',
                        ]);
                        $payload['updated_at'] = now();
                    }

                    return true;
                }
                if ($this->isSiswa($request)) {
                    return $this->deny('Jawaban quiz wajib disimpan melalui endpoint khusus');
                }

                return $this->deny();
            }
        }

        // QUIZ_VIOLATION_LOGS
        if ($table === 'quiz_violation_logs') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $quizIds = $this->guruQuizIdsForWali($userId);
                    if (empty($quizIds)) {
                        return $this->deny();
                    }
                    $query->whereIn('quiz_id', $quizIds);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('siswa_id', $userId);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isSiswa($request)) {
                    return $this->deny('Log pelanggaran quiz wajib melalui endpoint khusus');
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }

                return $this->deny();
            }
        }

        // ABSENSI
        if ($table === 'absensi') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $kelas = $this->guruKelasIds($userId);
                    if (empty($kelas)) {
                        return $this->deny();
                    }
                    $query->whereIn('kelas', $kelas);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('uid', $userId);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }

                if ($this->isGuru($request)) {
                    $kelasList = $this->guruKelasIds($userId);
                    if (empty($kelasList)) {
                        return $this->deny();
                    }
                    $invalid = $this->payloadHasInvalidKelas($payload, $kelasList);
                    if ($invalid) {
                        return $this->deny('Kelas tidak diizinkan');
                    }
                    $this->normalizeAbsensiPayloadForGuru($payload, $userId);

                    return true;
                }

                if ($this->isSiswa($request)) {
                    $kelas = $profile?->kelas;
                    $nama = $profile?->nama;
                    $this->mapPayload($payload, function ($row) use ($userId, $kelas, $nama) {
                        $row['uid'] = $userId;
                        $row['kelas'] = $kelas;
                        if (! isset($row['nama'])) {
                            $row['nama'] = $nama;
                        }

                        return $row;
                    });

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $kelas = $this->guruKelasIds($userId);
                    if (empty($kelas)) {
                        return $this->deny();
                    }
                    $query->whereIn('kelas', $kelas);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('uid', $userId);

                    return true;
                }
            }
        }

        // ABSENSI_AJUAN
        if ($table === 'absensi_ajuan') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $kelas = $this->guruKelasIds($userId);
                    if (empty($kelas)) {
                        return $this->deny();
                    }
                    $query->whereIn('kelas', $kelas);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('uid', $userId);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isSiswa($request)) {
                    $kelas = $profile?->kelas;
                    $nama = $profile?->nama;
                    $this->mapPayload($payload, function ($row) use ($userId, $kelas, $nama) {
                        $row['uid'] = $userId;
                        $row['kelas'] = $kelas;
                        if (! isset($row['nama'])) {
                            $row['nama'] = $nama;
                        }

                        return $row;
                    });

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $kelas = $this->guruKelasIds($userId);
                    if (empty($kelas)) {
                        return $this->deny();
                    }
                    $query->whereIn('kelas', $kelas);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('uid', $userId);

                    return true;
                }
            }
        }

        // ABSENSI_SETTINGS
        if ($table === 'absensi_settings') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $kelas = $this->guruKelasIds($userId);
                    if (empty($kelas)) {
                        return $this->deny();
                    }
                    $query->whereIn('kelas', $kelas);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $kelas = $profile?->kelas;
                    if ($kelas) {
                        $query->where('kelas', $kelas);
                    } else {
                        $query->whereRaw('1 = 0');
                    }

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $kelasList = $this->guruKelasIds($userId);
                    if (empty($kelasList)) {
                        return $this->deny();
                    }
                    $invalid = $this->payloadHasInvalidKelas($payload, $kelasList);
                    if ($invalid) {
                        return $this->deny('Kelas tidak diizinkan');
                    }

                    return true;
                }

                return $this->deny();
            }

            if ($action === 'update') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $kelasList = $this->guruKelasIds($userId);
                    if (empty($kelasList)) {
                        return $this->deny();
                    }
                    $query->whereIn('kelas', $kelasList);

                    return true;
                }

                return $this->deny();
            }

            if ($action === 'delete') {
                if ($this->isAdmin($request)) {
                    return true;
                }

                return $this->deny();
            }
        }

        // ABSENSI_RFID_SETTINGS
        if ($table === 'absensi_rfid_settings') {
            if ($action === 'select') {
                return true;
            }
            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // ABSENSI_ESKUL
        if ($table === 'absensi_eskul') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $ekskul = $this->guruEskulIds($userId);
                    if (empty($ekskul)) {
                        return $this->deny();
                    }
                    $query->whereIn('ekskul_id', $ekskul);

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('user_id', $userId);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert', 'update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $ekskul = $this->guruEskulIds($userId);
                    if (empty($ekskul)) {
                        return $this->deny();
                    }
                    $query->whereIn('ekskul_id', $ekskul);

                    return true;
                }

                return $this->deny();
            }
        }

        // ABSENSI_SCAN_TEMP
        if ($table === 'absensi_scan_temp') {
            if (! $this->isAdmin($request)) {
                return $this->deny();
            }

            return true;
        }

        // RFID_SCANS
        if ($table === 'rfid_scans') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isSiswa($request)) {
                    $card = $profile?->rfid_uid;
                    if (! $card) {
                        return $this->deny();
                    }
                    $query->where('card_uid', $card);

                    return true;
                }
                if ($this->isGuru($request)) {
                    $cards = $this->guruStudentRfidUids($userId);
                    if (empty($cards)) {
                        return $this->deny();
                    }
                    $query->whereIn('card_uid', $cards);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isSiswa($request)) {
                    $card = $profile?->rfid_uid;
                    if (! $card) {
                        return $this->deny();
                    }
                    $query->where('card_uid', $card);

                    return true;
                }
                if ($this->isGuru($request)) {
                    $cards = $this->guruStudentRfidUids($userId);
                    if (empty($cards)) {
                        return $this->deny();
                    }
                    $query->whereIn('card_uid', $cards);

                    return true;
                }

                return $this->deny();
            }
        }

        // JAM_KOSONG
        if ($table === 'jam_kosong') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    // Guru boleh memonitor semua jam kosong dalam tenant aktif.
                    // Filter tenant sudah dipasang sebelum policy ini dipanggil.
                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('kelas', $profile?->kelas);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert', 'update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $teacherReplacementName = trim((string) ($profile->nama ?? $request->user()?->email ?? 'Guru'));
                    $normalizeOwnJamKosongPayload = function ($row) use ($userId, $teacherReplacementName) {
                        if (! isset($row['created_by'])) {
                            $row['created_by'] = $userId;
                        }
                        if (array_key_exists('guru_pengganti', $row)) {
                            $replacement = trim((string) ($row['guru_pengganti'] ?? ''));
                            $row['guru_pengganti'] = $replacement === '' || strcasecmp($replacement, $teacherReplacementName) === 0
                                ? null
                                : $replacement;
                        }

                        return $row;
                    };

                    if (in_array($action, ['insert', 'upsert'], true)) {
                        $this->mapPayload($payload, $normalizeOwnJamKosongPayload);

                        return true;
                    }

                    if ($action === 'delete') {
                        $query->where('created_by', $userId);

                        return true;
                    }

                    $rows = $this->normalizeRows($payload);
                    $isReplacementOnlyUpdate = ! empty($rows);
                    foreach ($rows as $row) {
                        $keys = array_keys($row);
                        $hasReplacementColumn = array_key_exists('guru_pengganti', $row);
                        $onlyReplacementColumns = empty(array_diff($keys, ['guru_pengganti', 'updated_at']));
                        if (! $hasReplacementColumn || ! $onlyReplacementColumns) {
                            $isReplacementOnlyUpdate = false;
                            break;
                        }
                    }

                    if ($isReplacementOnlyUpdate) {
                        $isTakingReplacement = false;
                        foreach ($rows as $row) {
                            if (trim((string) ($row['guru_pengganti'] ?? '')) !== '') {
                                $isTakingReplacement = true;
                                break;
                            }
                        }

                        if ($isTakingReplacement) {
                            $replacementConflict = $this->validateGuruJamKosongReplacement(
                                $request,
                                $userId,
                                $teacherReplacementName,
                                $tenantId
                            );
                            if ($replacementConflict !== null) {
                                return $this->deny($replacementConflict['message'], $replacementConflict['status']);
                            }
                            $query->whereNull('guru_pengganti');
                        }

                        $this->whereNotOwnCreator($query, $userId);
                        $this->mapPayload($payload, function ($row) use ($teacherReplacementName) {
                            $replacement = trim((string) ($row['guru_pengganti'] ?? ''));

                            return [
                                'guru_pengganti' => $replacement === '' ? null : $teacherReplacementName,
                                'updated_at' => now(),
                            ];
                        });

                        return true;
                    }

                    $query->where('created_by', $userId);
                    $this->mapPayload($payload, $normalizeOwnJamKosongPayload);

                    return true;
                }

                return $this->deny();
            }
        }

        // TUGAS
        if ($table === 'tugas') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $wali = $this->guruWaliKelasIds($userId);
                    $query->where(function ($q) use ($userId, $wali) {
                        $q->where('created_by', $userId);
                        if (! empty($wali)) {
                            $q->orWhereIn('kelas', $wali);
                        }
                    });

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('kelas', $profile?->kelas);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $this->mapPayload($payload, function ($row) use ($userId) {
                        $row = $this->filterPayload($row, [
                            'id',
                            'kelas',
                            'judul',
                            'mapel',
                            'mulai',
                            'deadline',
                            'keterangan',
                            'file_url',
                            'link',
                            'created_at',
                            'updated_at',
                        ]);
                        $row['created_by'] = $userId;
                        if (! isset($row['created_at'])) {
                            $row['created_at'] = now();
                        }
                        $row['updated_at'] = now();

                        return $row;
                    });

                    $timelineError = $this->validateGuruTugasTimelinePayload($payload, true);
                    if ($timelineError !== null) {
                        return $this->deny($timelineError, 422);
                    }

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $query->where('created_by', $userId);

                    if ($action === 'update' && is_array($payload)) {
                        $payload = $this->filterPayload($payload, [
                            'kelas',
                            'judul',
                            'mapel',
                            'mulai',
                            'deadline',
                            'keterangan',
                            'file_url',
                            'link',
                            'updated_at',
                        ]);
                        $payload['updated_at'] = now();

                        $timelineError = $this->validateGuruTugasUpdatePayload($payload, $request, $userId);
                        if ($timelineError !== null) {
                            return $this->deny($timelineError, 422);
                        }
                    }

                    if ($action === 'delete') {
                        if ($this->targetedTugasHasGradedSubmission($request, $userId)) {
                            return $this->deny('Tugas yang sudah memiliki nilai tidak boleh dihapus', 422);
                        }
                    }

                    return true;
                }

                return $this->deny();
            }
        }

        // TUGAS_JAWABAN
        if ($table === 'tugas_jawaban') {
            if ($action === 'select') {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $wali = $this->guruWaliKelasIds($userId);
                    $tenantId = $this->currentTenantId;
                    $query->whereIn('tugas_id', function ($q) use ($userId, $wali, $tenantId) {
                        $q->select('id')
                            ->from('tugas')
                            ->where(function ($owned) use ($userId, $wali) {
                                $owned->where('created_by', $userId);
                                if (! empty($wali)) {
                                    $owned->orWhereIn('kelas', $wali);
                                }
                            });
                        if ($tenantId) {
                            $q->where('tenant_id', $tenantId);
                        }
                    });

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('user_id', $userId);

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['insert', 'upsert'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isSiswa($request)) {
                    $kelas = $profile?->kelas;
                    $this->mapPayload($payload, function ($row) use ($userId) {
                        $row = $this->filterPayload($row, [
                            'id',
                            'tugas_id',
                            'file_url',
                            'file_urls',
                            'link_url',
                            'file_name',
                            'waktu_submit',
                            'status',
                        ]);
                        $row['user_id'] = $userId;
                        $row['status'] = 'menunggu';
                        if (! isset($row['waktu_submit'])) {
                            $row['waktu_submit'] = now();
                        }

                        return $row;
                    });

                    $validationError = $this->validateSiswaTugasWritePayload(
                        $payload,
                        $kelas,
                        $userId,
                        $action === 'insert'
                    );
                    if ($validationError !== null) {
                        return $this->deny($validationError, 422);
                    }

                    return true;
                }

                return $this->deny();
            }

            if (in_array($action, ['update', 'delete'], true)) {
                if ($this->isAdmin($request)) {
                    return true;
                }
                if ($this->isGuru($request)) {
                    $tenantId = $this->currentTenantId;
                    $query->whereIn('tugas_id', function ($q) use ($userId, $tenantId) {
                        $q->select('id')->from('tugas')->where('created_by', $userId);
                        if ($tenantId) {
                            $q->where('tenant_id', $tenantId);
                        }
                    });

                    return true;
                }
                if ($this->isSiswa($request)) {
                    $query->where('user_id', $userId);

                    if ($action === 'update' && is_array($payload)) {
                        $payload = $this->filterPayload($payload, [
                            'file_url',
                            'file_urls',
                            'link_url',
                            'file_name',
                            'waktu_submit',
                            'status',
                        ]);
                        $payload['status'] = 'menunggu';
                        if (! isset($payload['waktu_submit'])) {
                            $payload['waktu_submit'] = now();
                        }
                    }

                    $kelas = $profile?->kelas;
                    $validationError = $this->validateSiswaTugasMutationTargets($request, $userId, $kelas);
                    if ($validationError !== null) {
                        return $this->deny($validationError, 422);
                    }

                    return true;
                }

                return $this->deny();
            }
        }

        // GURU_MAPEL_MANUAL_NILAI
        if ($table === 'guru_mapel_manual_nilai') {
            if ($this->isAdmin($request)) {
                return true;
            }

            if ($this->isGuru($request)) {
                $query->where('guru_id', $userId);

                if (in_array($action, ['insert', 'upsert'], true)) {
                    $this->mapPayload($payload, function ($row) use ($userId) {
                        $row = $this->filterPayload($row, [
                            'id',
                            'siswa_id',
                            'kelas_id',
                            'mapel',
                            'tahun_ajaran',
                            'nilai_manual',
                            'catatan',
                            'created_at',
                            'updated_at',
                        ]);
                        $row['guru_id'] = $userId;
                        $row['updated_at'] = now();
                        if (! isset($row['created_at'])) {
                            $row['created_at'] = now();
                        }

                        return $row;
                    });
                }

                if ($action === 'update') {
                    $this->mapPayload($payload, function ($row) {
                        $row = $this->filterPayload($row, [
                            'nilai_manual',
                            'catatan',
                            'updated_at',
                        ]);
                        $row['updated_at'] = now();

                        return $row;
                    });
                }

                return true;
            }

            return $this->deny();
        }

        // RAPOT_SISWA
        if ($table === 'rapot_siswa') {
            if ($this->isAdmin($request)) {
                return true;
            }

            if ($this->isGuru($request)) {
                $wali = $this->guruWaliKelasIds($userId);
                $kelasAmpu = $this->guruRapotKelasIds($userId);
                $kelasAllowed = $this->expandKelasAccessValues(array_merge($wali, $kelasAmpu));
                $query->where(function ($scope) use ($kelasAllowed, $userId) {
                    if (! empty($kelasAllowed)) {
                        $scope->whereIn('kelas_id', $kelasAllowed);
                    } else {
                        $scope->whereRaw('1 = 0');
                    }
                    $scope->orWhere('created_by', $userId)
                        ->orWhere('updated_by', $userId);
                });

                if (in_array($action, ['insert', 'upsert'], true)) {
                    $rows = $this->normalizeRows($payload);
                    $kelasAllowedKeys = $this->normalizeKelasAccessValues(array_merge($wali, $kelasAmpu));
                    foreach ($rows as $row) {
                        $kelasId = (string) ($row['kelas_id'] ?? '');
                        if (! in_array($this->normalizeKelasAccessValue($kelasId), $kelasAllowedKeys, true)) {
                            return $this->deny('Kelas rapot bukan kelas wali atau kelas mengajar Anda', 403);
                        }
                    }

                    $this->mapPayload($payload, function ($row) use ($userId) {
                        $row = $this->filterPayload($row, [
                            'id',
                            'siswa_id',
                            'kelas_id',
                            'jenis',
                            'semester',
                            'tahun_pelajaran',
                            'jumlah',
                            'rata_rata',
                            'rata_rata_manual',
                            'locked_at',
                            'locked_by',
                            'created_by',
                            'updated_by',
                            'created_at',
                            'updated_at',
                        ]);
                        if (! isset($row['created_by'])) {
                            $row['created_by'] = $userId;
                        }
                        $row['updated_by'] = $userId;
                        $row['updated_at'] = now();
                        if (! isset($row['created_at'])) {
                            $row['created_at'] = now();
                        }

                        return $row;
                    });
                }

                if ($action === 'update') {
                    $this->mapPayload($payload, function ($row) use ($userId) {
                        $row = $this->filterPayload($row, [
                            'semester',
                            'jumlah',
                            'rata_rata',
                            'rata_rata_manual',
                            'locked_at',
                            'locked_by',
                            'updated_by',
                            'updated_at',
                        ]);
                        $row['updated_by'] = $userId;
                        $row['updated_at'] = now();

                        return $row;
                    });
                }

                return true;
            }

            return $this->deny();
        }

        // RAPOT_SISWA_ITEMS
        if ($table === 'rapot_siswa_items') {
            if ($this->isAdmin($request)) {
                return true;
            }

            if ($this->isGuru($request)) {
                $wali = $this->guruWaliKelasIds($userId);
                $kelasAmpu = $this->guruRapotKelasIds($userId);
                $kelasAllowed = $this->expandKelasAccessValues(array_merge($wali, $kelasAmpu));
                $waliKeys = $this->normalizeKelasAccessValues($wali);

                $query->whereIn('rapot_id', function ($q) use ($kelasAllowed, $userId, $tenantId) {
                    $q->select('id')
                        ->from('rapot_siswa')
                        ->where(function ($owner) use ($kelasAllowed, $userId) {
                            if (! empty($kelasAllowed)) {
                                $owner->whereIn('kelas_id', $kelasAllowed);
                            } else {
                                $owner->whereRaw('1 = 0');
                            }
                            $owner->orWhere('created_by', $userId)
                                ->orWhere('updated_by', $userId);
                        });
                    if ($tenantId) {
                        $q->where('tenant_id', $tenantId);
                    }
                });

                if (in_array($action, ['insert', 'upsert'], true)) {
                    $rows = $this->normalizeRows($payload);
                    $rapotIds = array_values(array_unique(array_filter(array_map(
                        fn ($row) => (string) ($row['rapot_id'] ?? ''),
                        $rows
                    ))));
                    if (empty($rapotIds)) {
                        return $this->deny('Rapot belum dipilih', 422);
                    }

                    $allowedRapotRows = DB::table('rapot_siswa')
                        ->whereIn('id', $rapotIds)
                        ->where(function ($owner) use ($kelasAllowed, $userId) {
                            if (! empty($kelasAllowed)) {
                                $owner->whereIn('kelas_id', $kelasAllowed);
                            } else {
                                $owner->whereRaw('1 = 0');
                            }
                            $owner->orWhere('created_by', $userId)
                                ->orWhere('updated_by', $userId);
                        })
                        ->when($tenantId, fn ($q) => $q->where('tenant_id', $tenantId))
                        ->get(['id', 'kelas_id', 'locked_at'])
                        ->keyBy('id');
                    if ($allowedRapotRows->count() !== count($rapotIds)) {
                        return $this->deny('Detail rapot bukan milik kelas wali Anda', 403);
                    }
                    foreach ($rows as $row) {
                        $rapot = $allowedRapotRows->get((string) ($row['rapot_id'] ?? ''));
                        if (! $rapot) {
                            return $this->deny('Rapot tidak ditemukan', 404);
                        }
                        $mapel = (string) ($row['mapel'] ?? '');
                        $isWaliClass = in_array($this->normalizeKelasAccessValue($rapot->kelas_id), $waliKeys, true);
                        if ($rapot->locked_at && ! $isWaliClass) {
                            return $this->deny('Rapot dikunci wali kelas. Harap hubungi wali kelas untuk membuka kunci.', 423);
                        }
                        if (! $isWaliClass && ! $this->guruCanTeachMapelInKelas($userId, (string) $rapot->kelas_id, $mapel)) {
                            return $this->deny('Mapel rapot bukan mapel yang Anda ampu di kelas ini', 403);
                        }
                    }

                    $this->mapPayload($payload, function ($row) use ($userId) {
                        $row = $this->filterPayload($row, [
                            'id',
                            'rapot_id',
                            'nomor',
                            'mapel',
                            'kkm',
                            'nilai',
                            'predikat',
                            'keterangan',
                            'source',
                            'sent_by',
                            'sent_at',
                            'created_at',
                            'updated_at',
                        ]);
                        if (! isset($row['sent_by']) && (($row['source'] ?? null) === 'laporan_mapel')) {
                            $row['sent_by'] = $userId;
                        }
                        if (! isset($row['sent_at']) && (($row['source'] ?? null) === 'laporan_mapel')) {
                            $row['sent_at'] = now();
                        }
                        $row['updated_at'] = now();
                        if (! isset($row['created_at'])) {
                            $row['created_at'] = now();
                        }

                        return $row;
                    });
                }

                if ($action === 'update') {
                    $this->mapPayload($payload, function ($row) {
                        $row = $this->filterPayload($row, [
                            'mapel',
                            'kkm',
                            'nilai',
                            'predikat',
                            'keterangan',
                            'updated_at',
                        ]);
                        $row['updated_at'] = now();

                        return $row;
                    });
                }

                return true;
            }

            return $this->deny();
        }

        return $this->deny('Policy belum ditentukan', 403);
    }

    private function applyFilters($query, $filters): void
    {
        if (! is_array($filters)) {
            return;
        }

        foreach (['eq', 'neq', 'is', 'gt', 'gte', 'lt', 'lte'] as $op) {
            if (! empty($filters[$op]) && is_array($filters[$op])) {
                foreach ($filters[$op] as $field => $value) {
                    $field = $this->sanitizeIdentifier($field);
                    if (! $field) {
                        continue;
                    }

                    if ($value === null || ($op === 'is' && is_string($value) && strtolower($value) === 'null')) {
                        if ($op === 'eq' || $op === 'is') {
                            $query->whereNull($field);
                        } elseif ($op === 'neq') {
                            $query->whereNotNull($field);
                        }

                        continue;
                    }

                    if ($op === 'is' && is_string($value) && strtolower($value) === 'not.null') {
                        $query->whereNotNull($field);

                        continue;
                    }

                    $operator = match ($op) {
                        'neq' => '!=',
                        'gt' => '>',
                        'gte' => '>=',
                        'lt' => '<',
                        'lte' => '<=',
                        default => '=',
                    };

                    $query->where($field, $operator, $value);
                }
            }
        }

        if (! empty($filters['ilike']) && is_array($filters['ilike'])) {
            foreach ($filters['ilike'] as $field => $value) {
                $field = $this->sanitizeIdentifier($field);
                if (! $field) {
                    continue;
                }

                $pattern = strtolower((string) $value);
                $wrapped = $query->getGrammar()->wrap($field);
                $query->whereRaw("LOWER({$wrapped}) LIKE ?", [$pattern]);
            }
        }

        if (! empty($filters['in']) && is_array($filters['in'])) {
            foreach ($filters['in'] as $field => $values) {
                $field = $this->sanitizeIdentifier($field);
                if (! $field) {
                    continue;
                }
                if (! is_array($values)) {
                    $values = [$values];
                }
                if (empty($values)) {
                    $query->whereRaw('1 = 0');
                } else {
                    $query->whereIn($field, $values);
                }
            }
        }
    }

    private function hasAnyFilter($filters): bool
    {
        if (! is_array($filters)) {
            return false;
        }
        foreach (['eq', 'neq', 'is', 'gt', 'gte', 'lt', 'lte', 'in'] as $op) {
            if (! empty($filters[$op])) {
                return true;
            }
        }

        return false;
    }

    private function whereNotOwnCreator($query, string $userId): void
    {
        $query->where(function ($inner) use ($userId) {
            $inner->whereNull('created_by')
                ->orWhere('created_by', '!=', $userId);
        });
    }

    private function validateGuruJamKosongReplacement(
        Request $request,
        string $userId,
        string $teacherReplacementName,
        ?string $tenantId
    ): ?array {
        $targetQuery = DB::table('jam_kosong');
        $this->whereNotOwnCreator($targetQuery, $userId);
        $this->applyTenantFilter($targetQuery);
        $this->applyFilters($targetQuery, $request->input('filters', []));

        $targets = $targetQuery
            ->limit(2)
            ->get([
                'id',
                'tanggal',
                'jam_mulai',
                'jam_selesai',
                'mapel',
                'kelas',
                'guru_pengganti',
                'tahun_ajaran',
                'semester',
            ]);

        if ($targets->count() !== 1) {
            return [
                'message' => 'Jam kosong sudah diambil guru lain atau tidak tersedia lagi.',
                'status' => 409,
            ];
        }

        $target = $targets->first();
        if (trim((string) ($target->guru_pengganti ?? '')) !== '') {
            return [
                'message' => 'Jam kosong sudah diambil guru lain atau tidak tersedia lagi.',
                'status' => 409,
            ];
        }

        $tanggal = trim((string) ($target->tanggal ?? ''));
        $jamMulai = $this->normalizeClockForQuery($target->jam_mulai ?? null);
        $jamSelesai = $this->normalizeClockForQuery($target->jam_selesai ?? null);
        $hari = $this->dayNameForDateKey($tanggal);

        if ($tanggal === '' || $jamMulai === null || $jamSelesai === null || $hari === null) {
            return [
                'message' => 'Data jam kosong tidak lengkap. Minta guru pengaju memperbaiki data jam kosong.',
                'status' => 422,
            ];
        }

        $jadwalQuery = DB::table('jadwal')
            ->where('guru_id', $userId)
            ->where('hari', $hari);
        $this->applyTenantFilter($jadwalQuery);
        $this->applyPeriodFromTargetOrCurrent($jadwalQuery, 'jadwal', $target, $tenantId);
        $this->applyClockOverlap($jadwalQuery, $jamMulai, $jamSelesai);

        $jadwalConflict = $jadwalQuery->first(['mapel', 'kelas_id', 'jam_mulai', 'jam_selesai']);
        if ($jadwalConflict) {
            return [
                'message' => sprintf(
                    'Tidak bisa mengambil jam kosong. Anda masih punya jadwal %s kelas %s pukul %s-%s.',
                    $jadwalConflict->mapel ?: 'mengajar',
                    $jadwalConflict->kelas_id ?: '-',
                    $this->formatClockForMessage($jadwalConflict->jam_mulai ?? null),
                    $this->formatClockForMessage($jadwalConflict->jam_selesai ?? null)
                ),
                'status' => 409,
            ];
        }

        $replacementName = Str::lower(trim($teacherReplacementName));
        if ($replacementName === '') {
            return [
                'message' => 'Nama guru pengganti tidak valid.',
                'status' => 422,
            ];
        }

        $jamConflictQuery = DB::table('jam_kosong')
            ->where('tanggal', $tanggal)
            ->where('id', '!=', $target->id)
            ->whereRaw('LOWER(TRIM(guru_pengganti)) = ?', [$replacementName]);
        $this->applyTenantFilter($jamConflictQuery);
        $this->applyPeriodFromTargetOrCurrent($jamConflictQuery, 'jam_kosong', $target, $tenantId);
        $this->applyClockOverlap($jamConflictQuery, $jamMulai, $jamSelesai);

        $jamConflict = $jamConflictQuery->first(['mapel', 'kelas', 'jam_mulai', 'jam_selesai']);
        if ($jamConflict) {
            return [
                'message' => sprintf(
                    'Tidak bisa mengambil jam kosong. Anda sudah mengambil jam kosong %s kelas %s pukul %s-%s.',
                    $jamConflict->mapel ?: 'lain',
                    $jamConflict->kelas ?: '-',
                    $this->formatClockForMessage($jamConflict->jam_mulai ?? null),
                    $this->formatClockForMessage($jamConflict->jam_selesai ?? null)
                ),
                'status' => 409,
            ];
        }

        return null;
    }

    private function applyClockOverlap($query, string $start, string $end): void
    {
        $query->where('jam_mulai', '<', $end)
            ->where('jam_selesai', '>', $start);
    }

    private function applyPeriodFromTargetOrCurrent($query, string $table, $target, ?string $tenantId): void
    {
        if (! $this->tableHasAcademicPeriodColumns($table)) {
            return;
        }

        $tahunAjaran = trim((string) ($target->tahun_ajaran ?? ''));
        $semester = trim((string) ($target->semester ?? ''));
        if ($tahunAjaran !== '' && $semester !== '') {
            $query->where('tahun_ajaran', $tahunAjaran)
                ->where('semester', $semester);

            return;
        }

        $this->applyCurrentAcademicPeriodToQuery($query, $table, $tenantId);
    }

    private function dayNameForDateKey(string $dateKey): ?string
    {
        try {
            $date = Carbon::parse($dateKey, 'Asia/Jakarta');
        } catch (\Throwable $e) {
            return null;
        }

        return [
            0 => 'Minggu',
            1 => 'Senin',
            2 => 'Selasa',
            3 => 'Rabu',
            4 => 'Kamis',
            5 => 'Jumat',
            6 => 'Sabtu',
        ][$date->dayOfWeek] ?? null;
    }

    private function normalizeClockForQuery($value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?/', $raw, $matches) !== 1) {
            return null;
        }

        return sprintf(
            '%02d:%02d:%02d',
            (int) $matches[1],
            (int) $matches[2],
            isset($matches[3]) ? (int) $matches[3] : 0
        );
    }

    private function formatClockForMessage($value): string
    {
        $clock = $this->normalizeClockForQuery($value);
        if ($clock === null) {
            return '-';
        }

        return substr($clock, 0, 5);
    }

    private function validateDbRequestShape(Request $request): ?string
    {
        return $this->dbRequestShapeValidator->validate(
            $request,
            fn (string $name): ?string => $this->sanitizeIdentifier($name),
            fn (string $table, string $column): bool => $this->isSelectableColumn($table, $column)
        );
    }

    private function applyOrder($query, $orders): void
    {
        if (empty($orders)) {
            return;
        }

        $list = $orders;
        if (! is_array($orders) || isset($orders['field'])) {
            $list = [$orders];
        }

        foreach ($list as $order) {
            if (! is_array($order)) {
                continue;
            }
            $field = $this->sanitizeIdentifier($order['field'] ?? '');
            if (! $field) {
                continue;
            }
            $dir = strtolower($order['dir'] ?? 'asc') === 'desc' ? 'desc' : 'asc';
            $query->orderBy($field, $dir);
        }
    }

    private function calculateAgeFromBirthDate($rawDate): ?int
    {
        if ($rawDate === null || $rawDate === '') {
            return null;
        }

        try {
            $birthDate = new \DateTimeImmutable((string) $rawDate);
            $today = new \DateTimeImmutable('today');

            if ($birthDate > $today) {
                return null;
            }

            return $today->diff($birthDate)->y;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function parseColumns(string $table, string $columns): array
    {
        $parts = $this->splitTopLevelColumns($columns);
        $out = [];
        $tableColumnWhitelist = $this->columnWhitelist($table);

        foreach ($parts as $part) {
            $token = trim((string) $part);
            if ($token === '') {
                continue;
            }

            // Ignore relation syntax: kelas:kelas_id(id,nama,grade)
            if (str_contains($token, '(') || str_contains($token, ')')) {
                continue;
            }

            // Support simple alias syntax: alias:column
            if (str_contains($token, ':')) {
                [, $token] = array_pad(explode(':', $token, 2), 2, '');
                $token = trim($token);
            }

            $field = $this->sanitizeIdentifier($token);
            if (
                $field
                && (
                    (! empty($tableColumnWhitelist)
                        ? in_array($field, $tableColumnWhitelist, true)
                        : $this->isSelectableColumn($table, $field))
                )
            ) {
                $out[] = $field;
            }
        }

        return array_values(array_unique($out));
    }

    private function parseRelationSelects(string $table, string $columns): array
    {
        $relationConfig = self::RELATION_SELECTS[$table] ?? [];
        if (empty($relationConfig)) {
            return [];
        }

        $relations = [];
        foreach ($this->splitTopLevelColumns($columns) as $part) {
            $token = trim((string) $part);
            if ($token === '' || ! str_contains($token, '(') || ! str_contains($token, ')')) {
                continue;
            }

            if (! preg_match('/^(?:(?<alias>[A-Za-z_][A-Za-z0-9_]*):)?(?<relation>[A-Za-z_][A-Za-z0-9_]*)(?:![A-Za-z0-9_]+)?\s*\((?<columns>.*)\)$/', $token, $matches)) {
                continue;
            }

            $relationName = (string) ($matches['relation'] ?? '');
            $config = $relationConfig[$relationName] ?? null;
            if (! is_array($config)) {
                continue;
            }

            $allowedColumns = array_values(array_filter(
                $config['columns'] ?? [],
                fn ($column) => is_string($column) && $this->isSelectableColumn((string) $config['table'], $column)
            ));
            if (empty($allowedColumns)) {
                continue;
            }

            $requestedColumns = [];
            foreach ($this->splitTopLevelColumns((string) ($matches['columns'] ?? '')) as $columnPart) {
                $columnToken = trim((string) $columnPart);
                if ($columnToken === '*') {
                    $requestedColumns = $allowedColumns;

                    break;
                }

                if (str_contains($columnToken, ':')) {
                    [, $columnToken] = array_pad(explode(':', $columnToken, 2), 2, '');
                    $columnToken = trim($columnToken);
                }

                $column = $this->sanitizeIdentifier($columnToken);
                if ($column && in_array($column, $allowedColumns, true)) {
                    $requestedColumns[] = $column;
                }
            }

            $requestedColumns = array_values(array_unique($requestedColumns));
            if (empty($requestedColumns)) {
                continue;
            }

            $localKey = (string) ($config['local_key'] ?? '');
            $foreignKey = (string) ($config['foreign_key'] ?? 'id');
            $targetTable = (string) ($config['table'] ?? '');
            if (
                ! $this->isSelectableColumn($table, $localKey)
                || ! $this->isSelectableColumn($targetTable, $foreignKey)
            ) {
                continue;
            }

            $alias = trim((string) ($matches['alias'] ?? '')) ?: $relationName;
            $relations[] = [
                'alias' => $alias,
                'table' => $targetTable,
                'local_key' => $localKey,
                'foreign_key' => $foreignKey,
                'columns' => $requestedColumns,
            ];
        }

        return $relations;
    }

    private function hydrateRelationSelects($rows, array $relations, ?string $tenantId)
    {
        if (empty($relations)) {
            return $rows;
        }

        $rowList = $rows instanceof Collection ? $rows->all() : (is_array($rows) ? $rows : []);
        if (empty($rowList)) {
            return $rows;
        }

        foreach ($relations as $relation) {
            $localKey = (string) ($relation['local_key'] ?? '');
            $foreignKey = (string) ($relation['foreign_key'] ?? '');
            $targetTable = (string) ($relation['table'] ?? '');
            $alias = (string) ($relation['alias'] ?? '');
            $columns = array_values(array_filter($relation['columns'] ?? [], 'is_string'));

            if ($localKey === '' || $foreignKey === '' || $targetTable === '' || $alias === '' || empty($columns)) {
                continue;
            }

            $ids = [];
            foreach ($rowList as $row) {
                $value = $this->readRowValue($row, $localKey);
                if ($value !== null && $value !== '') {
                    $ids[] = (string) $value;
                }
            }

            $ids = array_values(array_unique($ids));
            if (empty($ids)) {
                continue;
            }

            $queryColumns = array_values(array_unique(array_merge([$foreignKey], $columns)));
            try {
                $relatedQuery = DB::table($targetTable)
                    ->whereIn($foreignKey, $ids)
                    ->select($queryColumns);

                if (
                    $tenantId
                    && $this->isSelectableColumn($targetTable, 'tenant_id')
                ) {
                    $relatedQuery->where('tenant_id', $tenantId);
                }

                $relatedMap = [];
                foreach ($relatedQuery->get() as $relatedRow) {
                    $key = (string) $this->readRowValue($relatedRow, $foreignKey);
                    if ($key !== '') {
                        $relatedMap[$key] = $relatedRow;
                    }
                }

                foreach ($rowList as $row) {
                    $value = $this->readRowValue($row, $localKey);
                    $relatedRow = $value !== null ? ($relatedMap[(string) $value] ?? null) : null;
                    $this->writeRowValue(
                        $row,
                        $alias,
                        $relatedRow ? (object) array_intersect_key((array) $relatedRow, array_flip($columns)) : null
                    );
                }
            } catch (\Throwable $e) {
                foreach ($rowList as $row) {
                    $this->writeRowValue($row, $alias, null);
                }
            }
        }

        return $rows;
    }

    private function readRowValue($row, string $key)
    {
        if (is_array($row)) {
            return $row[$key] ?? null;
        }

        if (is_object($row)) {
            return $row->{$key} ?? null;
        }

        return null;
    }

    private function writeRowValue(&$row, string $key, $value): void
    {
        if (is_array($row)) {
            $row[$key] = $value;

            return;
        }

        if (is_object($row)) {
            $row->{$key} = $value;
        }
    }

    private function columnWhitelist(string $table): array
    {
        if ($table === 'kelas_struktur') {
            return [
                'kelas_id',
                'wali_guru_id',
                'wali_guru_nama',
                'ketua_siswa_id',
                'ketua_siswa_nama',
                'tenant_id',
                'created_at',
                'updated_at',
            ];
        }

        return [];
    }

    private function isSelectableColumn(string $table, string $column): bool
    {
        if (! $table || ! $column) {
            return false;
        }

        $connection = DB::connection();
        $cacheKey = implode('|', [
            $connection->getName(),
            (string) ($connection->getDatabaseName() ?? ''),
            $table,
        ]);

        if (! isset($this->tableColumnCache[$cacheKey])) {
            try {
                $columns = Schema::getColumnListing($table);
                $this->tableColumnCache[$cacheKey] = array_fill_keys($columns, true);
            } catch (\Throwable $e) {
                $this->tableColumnCache[$cacheKey] = [];
            }
        }

        return isset($this->tableColumnCache[$cacheKey][$column]);
    }

    private function splitTopLevelColumns(string $columns): array
    {
        $parts = [];
        $buffer = '';
        $depth = 0;
        $length = strlen($columns);

        for ($i = 0; $i < $length; $i++) {
            $char = $columns[$i];

            if ($char === '(') {
                $depth++;
                $buffer .= $char;

                continue;
            }

            if ($char === ')') {
                if ($depth > 0) {
                    $depth--;
                }
                $buffer .= $char;

                continue;
            }

            if ($char === ',' && $depth === 0) {
                $trimmed = trim($buffer);
                if ($trimmed !== '') {
                    $parts[] = $trimmed;
                }
                $buffer = '';

                continue;
            }

            $buffer .= $char;
        }

        $trimmed = trim($buffer);
        if ($trimmed !== '') {
            $parts[] = $trimmed;
        }

        return $parts;
    }

    private function normalizeRows($payload): array
    {
        if (! is_array($payload)) {
            return [];
        }
        if ($this->isAssoc($payload)) {
            return [$payload];
        }

        return array_values(array_filter($payload, fn ($row) => is_array($row)));
    }

    private function isAssoc(array $array): bool
    {
        return array_keys($array) !== range(0, count($array) - 1);
    }

    private function filterPayload(array $payload, array $allowed): array
    {
        return array_intersect_key($payload, array_flip($allowed));
    }

    private function filterPayloadToExistingColumns(string $table, array $payload): array
    {
        $filtered = [];

        foreach ($payload as $column => $value) {
            if (! is_string($column)) {
                continue;
            }

            $normalizedColumn = $this->sanitizeIdentifier($column);
            if (! $normalizedColumn) {
                continue;
            }

            if (! $this->isSelectableColumn($table, $normalizedColumn)) {
                continue;
            }

            $filtered[$normalizedColumn] = $value;
        }

        return $filtered;
    }

    private function filterRowsToExistingColumns(string $table, array $rows): array
    {
        $filteredRows = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $filteredRow = $this->filterPayloadToExistingColumns($table, $row);
            if (! empty($filteredRow)) {
                $filteredRows[] = $filteredRow;
            }
        }

        return $filteredRows;
    }

    private function mapPayload(&$payload, callable $fn): void
    {
        if (! is_array($payload)) {
            return;
        }
        if ($this->isAssoc($payload)) {
            $payload = $fn($payload);
        } else {
            $payload = array_map($fn, $payload);
        }
    }

    private function attachTenantRows(array $rows, string $tenantId): array
    {
        return array_map(function ($row) use ($tenantId) {
            if (! is_array($row)) {
                return $row;
            }
            $row['tenant_id'] = $tenantId;

            return $row;
        }, $rows);
    }

    private function prepareKelasRowsForInsert(array &$rows, ?string $tenantId): ?array
    {
        foreach ($rows as $index => $row) {
            if (! is_array($row)) {
                continue;
            }

            $normalized = $this->normalizeKelasRow($row);
            if ($normalized === null) {
                return [
                    'message' => 'Data kelas tidak valid',
                    'status' => 422,
                ];
            }

            $duplicate = $this->findDuplicateKelasInTenant($normalized['nama'], $tenantId);
            if ($duplicate) {
                return [
                    'message' => 'Kelas '.$normalized['nama'].' sudah ada',
                    'status' => 409,
                ];
            }

            $normalized['id'] = $this->resolveKelasInsertId($normalized['id'], $normalized['nama'], $tenantId);
            $rows[$index] = array_merge($row, $normalized);
        }

        return null;
    }

    private function validateEskulRegistrationDeadlineRows(array $rows, ?string $tenantId, bool $requireDeadline = false): ?array
    {
        if (! $this->isSelectableColumn('ekskul', 'registration_deadline_at')) {
            return null;
        }

        $periodEnd = $this->currentAcademicPeriodEndForTenant($tenantId);
        $now = Carbon::now('Asia/Jakarta');

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            if (! array_key_exists('registration_deadline_at', $row)) {
                if ($requireDeadline) {
                    return [
                        'message' => 'Batas pendaftaran ekstrakurikuler wajib diisi',
                        'status' => 422,
                    ];
                }

                continue;
            }

            $raw = trim((string) ($row['registration_deadline_at'] ?? ''));
            if ($raw === '') {
                return [
                    'message' => 'Batas pendaftaran ekstrakurikuler wajib diisi',
                    'status' => 422,
                ];
            }

            try {
                $deadline = Carbon::parse($raw, 'Asia/Jakarta');
            } catch (\Throwable $e) {
                return [
                    'message' => 'Batas pendaftaran ekstrakurikuler tidak valid',
                    'status' => 422,
                ];
            }

            if ($deadline->lessThanOrEqualTo($now)) {
                return [
                    'message' => 'Batas pendaftaran ekstrakurikuler harus di masa depan',
                    'status' => 422,
                ];
            }

            if ($periodEnd && $deadline->greaterThan($periodEnd)) {
                return [
                    'message' => 'Batas pendaftaran ekstrakurikuler tidak boleh melewati akhir periode aktif',
                    'status' => 422,
                ];
            }
        }

        return null;
    }

    private function validateEskulMembershipRowsOpen(array $rows, ?string $tenantId): ?array
    {
        if (! Schema::hasTable('ekskul')) {
            return null;
        }

        $period = $this->currentAcademicPeriodForTenant($tenantId ?: $this->currentTenantId);
        $periodYear = AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        $periodSemester = AcademicPeriod::normalizeSemester($period['semester'] ?? null);
        $ekskulIds = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $rowYear = AcademicPeriod::normalizeAcademicYear($row['tahun_ajaran'] ?? null);
            $rowSemester = AcademicPeriod::normalizeSemester($row['semester'] ?? null);
            if (
                ($rowYear && $periodYear && $rowYear !== $periodYear) ||
                ($rowSemester && $periodSemester && $rowSemester !== $periodSemester)
            ) {
                return [
                    'message' => 'Anggota ekstrakurikuler hanya dapat ditambahkan pada periode aktif',
                    'status' => 422,
                ];
            }

            $ekskulId = trim((string) ($row['ekskul_id'] ?? ''));
            if ($ekskulId === '') {
                return [
                    'message' => 'Ekstrakurikuler tidak valid',
                    'status' => 422,
                ];
            }

            $ekskulIds[] = $ekskulId;
        }

        $ekskulIds = array_values(array_unique($ekskulIds));
        if (empty($ekskulIds)) {
            return null;
        }

        $now = Carbon::now('Asia/Jakarta');
        $periodEnd = $this->currentAcademicPeriodEndForTenant($tenantId);
        if ($periodEnd && $now->gt($periodEnd)) {
            return [
                'message' => 'Periode akademik aktif sudah berakhir, anggota ekstrakurikuler tidak bisa ditambahkan',
                'status' => 422,
            ];
        }

        $columns = ['id'];
        if ($this->isSelectableColumn('ekskul', 'registration_deadline_at')) {
            $columns[] = 'registration_deadline_at';
        }

        $ekskulQuery = DB::table('ekskul')->whereIn('id', $ekskulIds);
        $this->applyTenantFilter($ekskulQuery);
        if ($periodYear && $this->isSelectableColumn('ekskul', 'tahun_ajaran')) {
            $ekskulQuery->where('tahun_ajaran', $periodYear);
        }
        if ($periodSemester && $this->isSelectableColumn('ekskul', 'semester')) {
            $ekskulQuery->where('semester', $periodSemester);
        }

        $ekskulRows = $ekskulQuery->get($columns);
        $ekskulMap = [];
        foreach ($ekskulRows as $row) {
            $ekskulMap[(string) ($row->id ?? '')] = $row;
        }

        foreach ($ekskulIds as $ekskulId) {
            $ekskul = $ekskulMap[$ekskulId] ?? null;
            if (! $ekskul) {
                return [
                    'message' => 'Ekstrakurikuler tidak tersedia pada periode aktif',
                    'status' => 422,
                ];
            }

            $deadline = $this->parseEskulDateTime($ekskul->registration_deadline_at ?? null);
            if ($deadline && $now->gt($deadline)) {
                return [
                    'message' => 'Pendaftaran ekstrakurikuler sudah ditutup',
                    'status' => 422,
                ];
            }
        }

        return null;
    }

    private function currentAcademicPeriodEndForTenant(?string $tenantId): ?Carbon
    {
        $period = $this->currentAcademicPeriodForTenant($tenantId ?: $this->currentTenantId);
        $periodEndRaw = $period['ends_at'] ?? $period['periode_selesai'] ?? null;
        if (! $periodEndRaw) {
            return null;
        }

        try {
            return Carbon::parse((string) $periodEndRaw, 'Asia/Jakarta')->endOfDay();
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function normalizeKelasRow(array $row): ?array
    {
        $rawGrade = $this->normalizeWhitespace((string) ($row['grade'] ?? ''));
        $rawSuffix = $this->normalizeWhitespace((string) ($row['suffix'] ?? ''));
        $rawName = $this->normalizeWhitespace((string) ($row['nama'] ?? ''));

        $grade = $this->normalizeKelasGrade($rawGrade);
        if ($grade === '') {
            $grade = $this->parseKelasGrade($rawName) ?: $this->parseKelasGrade($rawSuffix);
        }

        if ($grade === '') {
            return null;
        }

        $suffix = $rawSuffix;
        if ($suffix === '' && $rawName !== '') {
            $suffix = $this->stripKelasGradePrefix($rawName, $grade);
        }
        $suffix = $this->stripKelasGradePrefix($suffix, $grade);
        $suffix = strtoupper($this->normalizeWhitespace($suffix));

        if ($suffix === '') {
            return null;
        }

        $nama = strtoupper($this->normalizeWhitespace($grade.' '.$suffix));
        $baseId = $this->makeKelasSlug($nama);

        return [
            'id' => $baseId,
            'nama' => $nama,
            'grade' => $grade,
            'suffix' => $suffix,
        ];
    }

    private function normalizeWhitespace(string $value): string
    {
        return trim((string) preg_replace('/\s+/', ' ', $value));
    }

    private function normalizeKelasGrade(string $value): string
    {
        $grade = strtoupper($this->normalizeWhitespace($value));

        return in_array($grade, ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'], true) ? $grade : '';
    }

    private function parseKelasGrade(string $value): string
    {
        $normalized = strtoupper($this->normalizeWhitespace($value));
        if (preg_match('/^(XII|XI|X|IX|VIII|VII)\b/', $normalized, $matches)) {
            return $matches[1];
        }

        return '';
    }

    private function stripKelasGradePrefix(string $value, string $grade): string
    {
        $normalized = $this->normalizeWhitespace($value);
        if ($normalized === '' || $grade === '') {
            return $normalized;
        }

        return $this->normalizeWhitespace((string) preg_replace(
            '/^'.preg_quote($grade, '/').'\b\s*/i',
            '',
            $normalized,
            1
        ));
    }

    private function makeKelasSlug(string $value): string
    {
        $slug = Str::slug($value);
        $slug = trim(substr($slug, 0, 80), '-');

        return $slug !== '' ? $slug : 'kelas';
    }

    private function findDuplicateKelasInTenant(string $nama, ?string $tenantId): ?object
    {
        if ($nama === '') {
            return null;
        }

        $query = DB::table('kelas')
            ->whereRaw('upper(nama) = ?', [strtoupper($nama)]);

        if ($tenantId && $this->isSelectableColumn('kelas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->first(['id', 'nama', 'tenant_id']);
    }

    private function resolveKelasInsertId(string $baseId, string $nama, ?string $tenantId): string
    {
        $baseId = $this->makeKelasSlug($baseId ?: $nama);
        $candidate = $baseId;
        $tenantSuffix = $tenantId ? substr(str_replace('-', '', $tenantId), 0, 8) : '';
        $attempt = 0;

        while (DB::table('kelas')->where('id', $candidate)->exists()) {
            $attempt++;
            $suffix = $tenantSuffix !== '' ? $tenantSuffix : (string) $attempt;
            if ($attempt > 1) {
                $suffix .= '-'.$attempt;
            }

            $maxBaseLength = max(1, 80 - strlen($suffix) - 1);
            $trimmedBase = trim(substr($baseId, 0, $maxBaseLength), '-');
            $candidate = ($trimmedBase !== '' ? $trimmedBase : 'kelas').'-'.$suffix;
        }

        return $candidate;
    }

    private function isUniqueConstraintException(QueryException $e): bool
    {
        $message = strtolower($e->getMessage());

        return str_contains($message, 'unique')
            || str_contains($message, 'duplicate')
            || str_contains($message, 'constraint failed');
    }

    private function saveTenantSingletonRows(string $table, array $rows, string $tenantId): array
    {
        $results = [];
        $hasCreatedAt = $this->isSelectableColumn($table, 'created_at');
        $hasUpdatedAt = $this->isSelectableColumn($table, 'updated_at');
        $hasId = $this->isSelectableColumn($table, 'id');

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $row['tenant_id'] = $tenantId;

            $existingQuery = DB::table($table)->where('tenant_id', $tenantId);
            if ($hasUpdatedAt) {
                $existingQuery->orderByDesc('updated_at');
            }
            if ($hasCreatedAt) {
                $existingQuery->orderByDesc('created_at');
            }
            if (! $hasUpdatedAt && ! $hasCreatedAt && $hasId) {
                $existingQuery->orderByDesc('id');
            }
            $existing = $existingQuery->first();

            if ($existing) {
                $update = $row;
                unset($update['id'], $update['tenant_id']);
                if ($hasCreatedAt) {
                    unset($update['created_at']);
                }
                if ($hasUpdatedAt && ! array_key_exists('updated_at', $update)) {
                    $update['updated_at'] = now();
                }
                if (empty($update)) {
                    $results[] = $existing;

                    continue;
                }

                DB::table($table)->where('id', $existing->id)->update($update);

                $fresh = DB::table($table)->where('id', $existing->id)->first();
                $results[] = $fresh ?: (object) array_merge((array) $existing, $update);

                continue;
            }

            $insert = $row;
            $insert['id'] = (string) Str::uuid();
            $insert['tenant_id'] = $tenantId;
            if ($hasCreatedAt && ! array_key_exists('created_at', $insert)) {
                $insert['created_at'] = now();
            }
            if ($hasUpdatedAt && ! array_key_exists('updated_at', $insert)) {
                $insert['updated_at'] = now();
            }

            DB::table($table)->insert($insert);
            $results[] = DB::table($table)->where('id', $insert['id'])->first() ?: (object) $insert;
        }

        return $results;
    }

    private function saveSettingsSingletonRows(array $rows, ?string $tenantId, bool $tenantScoped): array
    {
        $results = [];
        $table = 'settings';
        $hasCreatedAt = $this->isSelectableColumn($table, 'created_at');
        $hasUpdatedAt = $this->isSelectableColumn($table, 'updated_at');
        $hasTenantId = $this->isSelectableColumn($table, 'tenant_id');

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            // settings.id bertipe bigint; jangan pernah percaya id dari client.
            unset($row['id']);

            if ($hasTenantId && $tenantScoped && $tenantId) {
                $row['tenant_id'] = $tenantId;
            } else {
                unset($row['tenant_id']);
            }

            $existingQuery = DB::table($table);
            if ($hasTenantId && $tenantScoped && $tenantId) {
                $existingQuery->where('tenant_id', $tenantId);
            }
            $existing = $existingQuery->orderBy('id')->first();

            if ($existing) {
                $update = $row;
                if ($hasCreatedAt) {
                    unset($update['created_at']);
                }
                if ($hasUpdatedAt && ! array_key_exists('updated_at', $update)) {
                    $update['updated_at'] = now();
                }

                if (! empty($update)) {
                    DB::table($table)->where('id', $existing->id)->update($update);
                }

                $fresh = DB::table($table)->where('id', $existing->id)->first();
                $results[] = $fresh ?: (object) array_merge((array) $existing, $update);

                continue;
            }

            $insert = $row;
            if ($hasCreatedAt && ! array_key_exists('created_at', $insert)) {
                $insert['created_at'] = now();
            }
            if ($hasUpdatedAt && ! array_key_exists('updated_at', $insert)) {
                $insert['updated_at'] = now();
            }

            $newId = DB::table($table)->insertGetId($insert);
            $results[] = DB::table($table)->where('id', $newId)->first()
                ?: (object) array_merge($insert, ['id' => $newId]);
        }

        return $results;
    }

    private function normalizeJsonRowsForTable(string $table, array $rows): array
    {
        return array_map(function ($row) use ($table) {
            if (! is_array($row)) {
                return $row;
            }

            return $this->normalizeJsonRowForTable($table, $row);
        }, $rows);
    }

    private function normalizeJsonRowForTable(string $table, array $row): array
    {
        $jsonColumns = $this->jsonColumnsForTable($table);
        if (empty($jsonColumns)) {
            return $row;
        }

        $jsonColumnMap = array_flip($jsonColumns);

        foreach ($row as $column => $value) {
            if (! isset($jsonColumnMap[$column])) {
                continue;
            }

            if ($value === null || is_string($value)) {
                continue;
            }

            if (
                is_array($value)
                || is_object($value)
                || is_bool($value)
                || is_int($value)
                || is_float($value)
            ) {
                $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                if ($encoded === false) {
                    throw new \InvalidArgumentException("Payload JSON tidak valid untuk kolom {$table}.{$column}");
                }
                $row[$column] = $encoded;
            }
        }

        return $row;
    }

    private function jsonColumnsForTable(string $table): array
    {
        if ($table === '') {
            return [];
        }

        $connection = DB::connection();
        $cacheKey = implode('|', [
            $connection->getName(),
            (string) ($connection->getDatabaseName() ?? ''),
            $table,
        ]);

        if (isset($this->tableJsonColumnCache[$cacheKey])) {
            return $this->tableJsonColumnCache[$cacheKey];
        }

        $columns = [];
        if (isset($this->knownJsonColumns[$table])) {
            $columns = $this->knownJsonColumns[$table];
        }

        try {
            foreach (Schema::getColumnListing($table) as $column) {
                $type = '';
                try {
                    $type = strtolower((string) Schema::getColumnType($table, $column));
                } catch (\Throwable $e) {
                    $type = '';
                }

                if ($type !== '' && str_contains($type, 'json')) {
                    $columns[] = $column;
                }
            }
        } catch (\Throwable $e) {
            // ignore schema introspection failure
        }

        if ($connection->getDriverName() === 'pgsql') {
            try {
                $rows = DB::select(
                    "select column_name from information_schema.columns
                     where table_schema = current_schema()
                       and table_name = ?
                       and data_type in ('json', 'jsonb')",
                    [$table]
                );

                foreach ($rows as $jsonRow) {
                    $column = (string) ($jsonRow->column_name ?? '');
                    if ($column !== '') {
                        $columns[] = $column;
                    }
                }
            } catch (\Throwable $e) {
                // ignore metadata lookup failure
            }
        }

        $columns = array_values(array_unique(array_filter(array_map(
            fn ($column) => (string) $column,
            $columns
        ))));

        $this->tableJsonColumnCache[$cacheKey] = $columns;

        return $columns;
    }

    private function normalizeAbsensiPayloadForGuru(&$payload, ?string $userId): void
    {
        $allowedStatus = ['Hadir', 'Izin', 'Sakit', 'Alpha'];

        $this->mapPayload($payload, function ($row) use ($userId, $allowedStatus) {
            $row = $this->filterPayload($row, [
                'kelas',
                'tanggal',
                'uid',
                'mapel',
                'status',
                'nama',
                'komentar',
                'oleh',
                'waktu',
                'dikonfirmasi',
            ]);

            if (! isset($row['oleh']) || $row['oleh'] === '') {
                $row['oleh'] = $userId;
            }
            if (! isset($row['waktu'])) {
                $row['waktu'] = now();
            }
            if (! isset($row['komentar']) && isset($row['status'])) {
                $row['komentar'] = $row['status'].' (Manual Guru)';
            }

            if (isset($row['status'])) {
                $status = (string) $row['status'];
                if (! in_array($status, $allowedStatus, true)) {
                    $row['status'] = 'Alpha';
                }
            }

            return $row;
        });
    }

    private function manualUpsertByKeys(string $table, array $rows, array $uniqueBy, ?string $tenantId): array
    {
        $results = [];
        $hasTenantColumn = $tenantId && $this->isSelectableColumn($table, 'tenant_id');

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $hasKeys = true;
            $query = DB::table($table);

            if ($hasTenantColumn) {
                $query->where('tenant_id', $tenantId);
            }

            foreach ($uniqueBy as $col) {
                if (! array_key_exists($col, $row)) {
                    $hasKeys = false;
                    break;
                }
                $query->where($col, $row[$col]);
            }

            if ($hasKeys) {
                $existing = $query->first();
                if ($existing) {
                    $update = $row;
                    unset($update['id']);
                    if ($hasTenantColumn) {
                        unset($update['tenant_id']);
                    }
                    DB::table($table)->where('id', $existing->id)->update($update);
                    $results[] = (object) array_merge((array) $existing, $update);

                    continue;
                }
            }

            $insert = $row;
            if ($hasTenantColumn && ! isset($insert['tenant_id'])) {
                $insert['tenant_id'] = $tenantId;
            }

            DB::table($table)->insert($insert);

            if ($hasKeys) {
                $fetchQuery = DB::table($table);
                if ($hasTenantColumn) {
                    $fetchQuery->where('tenant_id', $tenantId);
                }

                foreach ($uniqueBy as $col) {
                    $fetchQuery->where($col, $row[$col] ?? null);
                }

                $results[] = $fetchQuery->first() ?: (object) $insert;
            } else {
                $results[] = (object) $insert;
            }
        }

        return $results;
    }

    private function fetchRowsByKeys(string $table, array $rows, array $uniqueBy, ?string $tenantId): array
    {
        $results = [];
        $hasTenantColumn = $tenantId && $this->isSelectableColumn($table, 'tenant_id');

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $query = DB::table($table);
            if ($hasTenantColumn) {
                $query->where('tenant_id', $tenantId);
            }

            $hasKeys = true;
            foreach ($uniqueBy as $col) {
                if (! array_key_exists($col, $row)) {
                    $hasKeys = false;
                    break;
                }
                $query->where($col, $row[$col]);
            }

            if (! $hasKeys) {
                $results[] = $row;

                continue;
            }

            $found = $query->first();
            if ($found) {
                $results[] = $found;
            } else {
                $results[] = $row;
            }
        }

        return $results;
    }

    private function sanitizeIdentifier(string $name): ?string
    {
        if ($name === '') {
            return null;
        }
        if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $name)) {
            return null;
        }

        return $name;
    }

    private function applyTenantFilter($query, string $tenantColumn = 'tenant_id'): void
    {
        if ($this->currentTenantId) {
            $query->where($tenantColumn, $this->currentTenantId);
        }
    }

    private function currentAcademicPeriodForTenant(?string $tenantId): array
    {
        $cacheKey = $tenantId ?: '__default__';
        if (isset($this->academicPeriodCache[$cacheKey])) {
            return $this->academicPeriodCache[$cacheKey];
        }

        $settings = null;
        if ($this->isSelectableColumn('settings', 'id')) {
            $settingsQuery = DB::table('settings')->orderBy('id');
            if ($tenantId && $this->isSelectableColumn('settings', 'tenant_id')) {
                $settingsQuery->where('tenant_id', $tenantId);
            }
            $settingsColumns = array_values(array_filter(
                ['tahun_ajaran', 'semester_aktif', 'periode_mulai', 'periode_selesai'],
                fn ($column) => $this->isSelectableColumn('settings', $column)
            ));
            $settings = $settingsQuery->first($settingsColumns ?: ['tahun_ajaran', 'semester_aktif']);
        }

        $this->academicPeriodCache[$cacheKey] = AcademicPeriod::fromSettings($settings);

        return $this->academicPeriodCache[$cacheKey];
    }

    private function maxEskulPerSiswaForTenant(?string $tenantId): int
    {
        if (! $this->isSelectableColumn('settings', 'max_ekskul_per_siswa')) {
            return 3;
        }

        $settingsQuery = DB::table('settings')->orderBy('id');
        if ($tenantId && $this->isSelectableColumn('settings', 'tenant_id')) {
            $settingsQuery->where('tenant_id', $tenantId);
        }

        $value = $settingsQuery->value('max_ekskul_per_siswa');

        return max(1, min(99, (int) ($value ?: 3)));
    }

    private function tableHasAcademicPeriodColumns(string $table): bool
    {
        return $this->isSelectableColumn($table, 'tahun_ajaran')
            && $this->isSelectableColumn($table, 'semester');
    }

    private function tableHasCohortColumn(string $table): bool
    {
        return $this->isSelectableColumn($table, 'angkatan');
    }

    private function hasAcademicPeriodFilter($filters): bool
    {
        return $this->hasFilterOnAnyColumn($filters, ['tahun_ajaran', 'semester']);
    }

    private function hasFilterOnAnyColumn($filters, array $columns): bool
    {
        if (! is_array($filters) || empty($columns)) {
            return false;
        }

        $columns = array_values(array_unique(array_filter($columns)));
        foreach (['eq', 'neq', 'is', 'gt', 'gte', 'lt', 'lte', 'in', 'ilike'] as $op) {
            if (empty($filters[$op]) || ! is_array($filters[$op])) {
                continue;
            }

            foreach (array_keys($filters[$op]) as $field) {
                $column = is_string($field) ? $this->sanitizeIdentifier($field) : null;
                if (in_array($column, $columns, true)) {
                    return true;
                }
            }
        }

        return false;
    }

    private function applyDefaultAcademicSelectScope(string $table, $query, $filters, ?string $tenantId): void
    {
        if (
            ! in_array($table, self::ACADEMIC_DEFAULT_SCOPE_TABLES, true)
            || ! $this->tableHasAcademicPeriodColumns($table)
        ) {
            return;
        }

        if ($this->hasAcademicPeriodFilter($filters)) {
            return;
        }

        $dateFilterColumns = self::ACADEMIC_DATE_FILTER_COLUMNS[$table] ?? [];
        if ($this->hasFilterOnAnyColumn($filters, $dateFilterColumns)) {
            return;
        }

        $period = $this->currentAcademicPeriodForTenant($tenantId);
        $query->where('tahun_ajaran', $period['tahun_ajaran']);
        if ($this->isSelectableColumn($table, 'semester')) {
            $query->where('semester', $period['semester']);
        }
    }

    private function applyCurrentAcademicPeriodToQuery($query, string $table, ?string $tenantId = null): void
    {
        if (! $this->tableHasAcademicPeriodColumns($table)) {
            return;
        }

        $period = $this->currentAcademicPeriodForTenant($tenantId ?: $this->currentTenantId);
        $query->where('tahun_ajaran', $period['tahun_ajaran'])
            ->where('semester', $period['semester']);
    }

    private function attachAcademicPeriodRows(string $table, array $rows, ?string $tenantId): array
    {
        if (in_array($table, self::ACADEMIC_CHILD_SNAPSHOT_TABLES, true)) {
            return $this->attachChildAcademicSnapshotRows($table, $rows, $tenantId);
        }

        if (! in_array($table, self::ACADEMIC_PERIOD_TABLES, true)) {
            return $rows;
        }

        $hasPeriodColumns = $this->tableHasAcademicPeriodColumns($table);
        $hasCohortColumn = $this->tableHasCohortColumn($table);
        if (! $hasPeriodColumns && ! $hasCohortColumn) {
            return $rows;
        }

        $period = $this->currentAcademicPeriodForTenant($tenantId);

        return array_map(function ($row) use ($table, $tenantId, $period, $hasPeriodColumns, $hasCohortColumn) {
            if (! is_array($row)) {
                return $row;
            }

            if ($hasPeriodColumns) {
                $year = AcademicPeriod::normalizeAcademicYear($row['tahun_ajaran'] ?? null);
                $semester = AcademicPeriod::normalizeSemester($row['semester'] ?? null);

                $row['tahun_ajaran'] = $year ?: $period['tahun_ajaran'];
                $row['semester'] = $semester ?: $period['semester'];
            }

            if ($hasCohortColumn && trim((string) ($row['angkatan'] ?? '')) === '') {
                $cohort = $this->cohortFromRow($table, $row, $tenantId);
                if ($cohort !== null && $cohort !== '') {
                    $row['angkatan'] = $cohort;
                }
            }

            return $row;
        }, $rows);
    }

    private function attachChildAcademicSnapshotRows(string $table, array $rows, ?string $tenantId): array
    {
        $hasPeriodColumns = $this->tableHasAcademicPeriodColumns($table);
        $hasCohortColumn = $this->tableHasCohortColumn($table);
        if (! $hasPeriodColumns && ! $hasCohortColumn) {
            return $rows;
        }

        return array_map(function ($row) use ($table, $tenantId, $hasPeriodColumns, $hasCohortColumn) {
            if (! is_array($row)) {
                return $row;
            }

            $snapshot = match ($table) {
                'tugas_jawaban' => $this->academicSnapshotForTugas(
                    $row['tugas_id'] ?? null,
                    $row['user_id'] ?? null,
                    $tenantId
                ),
                'quiz_submissions' => $this->academicSnapshotForQuiz(
                    $row['quiz_id'] ?? null,
                    $row['siswa_id'] ?? null,
                    $tenantId
                ),
                default => [],
            };

            if ($hasPeriodColumns) {
                $year = AcademicPeriod::normalizeAcademicYear($row['tahun_ajaran'] ?? null);
                $semester = AcademicPeriod::normalizeSemester($row['semester'] ?? null);
                if (! $year && ! empty($snapshot['tahun_ajaran'])) {
                    $year = AcademicPeriod::normalizeAcademicYear($snapshot['tahun_ajaran']);
                }
                if (! $semester && ! empty($snapshot['semester'])) {
                    $semester = AcademicPeriod::normalizeSemester($snapshot['semester']);
                }

                if ($year) {
                    $row['tahun_ajaran'] = $year;
                }
                if ($semester) {
                    $row['semester'] = $semester;
                }
            }

            if ($hasCohortColumn && trim((string) ($row['angkatan'] ?? '')) === '') {
                $cohort = trim((string) ($snapshot['angkatan'] ?? ''));
                if ($cohort !== '') {
                    $row['angkatan'] = $cohort;
                }
            }

            return $row;
        }, $rows);
    }

    private function validateProfileRowsForTenantInsert(array &$rows, ?string $tenantId): ?array
    {
        if (! Schema::hasTable('profiles') || ! $this->isSelectableColumn('profiles', 'email')) {
            return null;
        }

        $normalizedTenantId = trim((string) ($tenantId ?? ''));
        $seen = [];
        $emails = [];

        foreach ($rows as $index => $row) {
            if (! is_array($row) || ! array_key_exists('email', $row)) {
                continue;
            }

            $email = strtolower(trim((string) $row['email']));
            if ($email === '') {
                continue;
            }
            if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                return ['message' => 'Email tidak valid', 'status' => 422];
            }
            if (isset($seen[$email])) {
                return ['message' => 'Email duplikat dalam payload untuk sekolah ini', 'status' => 409];
            }

            $seen[$email] = true;
            $emails[] = $email;
            $rows[$index]['email'] = $email;
        }

        if (empty($emails)) {
            return null;
        }

        $duplicateQuery = DB::table('profiles')
            ->whereIn(DB::raw('lower(email)'), $emails);
        if ($normalizedTenantId !== '' && $this->isSelectableColumn('profiles', 'tenant_id')) {
            $duplicateQuery->where('tenant_id', $normalizedTenantId);
        }

        if ($duplicateQuery->exists()) {
            return ['message' => 'Email sudah terdaftar di sekolah ini', 'status' => 409];
        }

        return null;
    }

    private function attachProfileCohortRows(array $rows, ?string $tenantId): array
    {
        if (! Schema::hasTable('profiles') || ! $this->isSelectableColumn('profiles', 'angkatan')) {
            return $rows;
        }

        return array_map(function ($row) use ($tenantId) {
            if (! is_array($row)) {
                return $row;
            }

            $classId = trim((string) ($row['kelas'] ?? ''));
            if ($classId === '') {
                unset($row['angkatan']);

                return $row;
            }

            $row['angkatan'] = $this->cohortForClass($classId, $tenantId);

            return $row;
        }, $rows);
    }

    private function normalizeProfileCohortPayload(array $payload, ?string $tenantId): array
    {
        if (! $this->isSelectableColumn('profiles', 'angkatan')) {
            return $payload;
        }

        if (! array_key_exists('kelas', $payload)) {
            unset($payload['angkatan']);

            return $payload;
        }

        $classId = trim((string) ($payload['kelas'] ?? ''));
        $payload['angkatan'] = $classId !== ''
            ? $this->cohortForClass($classId, $tenantId)
            : null;

        return $payload;
    }

    private function cohortFromRow(string $table, array $row, ?string $tenantId): ?string
    {
        if ($table === 'kelas') {
            return $this->inferCohortFromClassLabel($row['grade'] ?? $row['nama'] ?? $row['id'] ?? null, $tenantId);
        }

        $classId = match ($table) {
            'jadwal', 'quizzes' => $row['kelas_id'] ?? null,
            'tugas', 'absensi', 'absensi_ajuan', 'absensi_settings', 'jam_kosong' => $row['kelas'] ?? null,
            default => null,
        };

        $cohort = $this->cohortForClass($classId, $tenantId);
        if ($cohort) {
            return $cohort;
        }

        if (in_array($table, ['absensi', 'absensi_ajuan'], true)) {
            return $this->cohortForStudent($row['uid'] ?? null, $tenantId);
        }

        if (in_array($table, ['absensi_eskul', 'ekskul_anggota', 'anggota_ekskul'], true)) {
            return $this->cohortForStudent($row['user_id'] ?? null, $tenantId);
        }

        return null;
    }

    private function inferCohortFromClassLabel($classValue, ?string $tenantId): ?string
    {
        $period = $this->currentAcademicPeriodForTenant($tenantId);
        $academicStartYear = (int) substr((string) ($period['tahun_ajaran'] ?? ''), 0, 4);
        if ($academicStartYear <= 0) {
            return null;
        }

        $grade = strtoupper(trim((string) ($classValue ?? '')));
        if ($grade === '') {
            return (string) $academicStartYear;
        }
        if (preg_match('/^(XII|XI|X|IX|VIII|VII)\b/', $grade, $matches)) {
            $grade = $matches[1];
        }

        $offset = match ($grade) {
            'VIII', 'XI' => -1,
            'IX', 'XII' => -2,
            default => 0,
        };

        return (string) ($academicStartYear + $offset);
    }

    private function cohortForClass($classId, ?string $tenantId): ?string
    {
        $classId = trim((string) ($classId ?? ''));
        if ($classId === '' || ! Schema::hasTable('kelas') || ! $this->isSelectableColumn('kelas', 'angkatan')) {
            return null;
        }

        $cacheKey = ($tenantId ?: '__default__').'|'.$classId;
        if (array_key_exists($cacheKey, $this->classCohortCache)) {
            return $this->classCohortCache[$cacheKey];
        }

        $query = DB::table('kelas')->where(function ($q) use ($classId) {
            $q->where('id', $classId);
            if ($this->isSelectableColumn('kelas', 'nama')) {
                $q->orWhere('nama', $classId);
            }
        });
        if ($tenantId && $this->isSelectableColumn('kelas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->orderBy('id')->first(['angkatan']);
        $cohort = trim((string) ($row->angkatan ?? '')) ?: null;
        $this->classCohortCache[$cacheKey] = $cohort;

        return $cohort;
    }

    private function cohortForStudent($studentId, ?string $tenantId): ?string
    {
        $studentId = trim((string) ($studentId ?? ''));
        if ($studentId === '' || ! Schema::hasTable('profiles') || ! $this->isSelectableColumn('profiles', 'angkatan')) {
            return null;
        }

        $cacheKey = ($tenantId ?: '__default__').'|'.$studentId;
        if (array_key_exists($cacheKey, $this->studentCohortCache)) {
            return $this->studentCohortCache[$cacheKey];
        }

        $query = DB::table('profiles')->where('id', $studentId);
        if ($tenantId && $this->isSelectableColumn('profiles', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first(['angkatan']);
        $cohort = trim((string) ($row->angkatan ?? '')) ?: null;
        $this->studentCohortCache[$cacheKey] = $cohort;

        return $cohort;
    }

    private function academicSnapshotForTugas($tugasId, $studentId, ?string $tenantId): array
    {
        $tugasId = trim((string) ($tugasId ?? ''));
        if ($tugasId === '' || ! Schema::hasTable('tugas')) {
            return [];
        }

        $columns = ['tahun_ajaran', 'semester', 'angkatan'];
        $select = array_values(array_filter($columns, fn ($column) => $this->isSelectableColumn('tugas', $column)));
        if (empty($select)) {
            return [];
        }

        $query = DB::table('tugas')->where('id', $tugasId);
        if ($tenantId && $this->isSelectableColumn('tugas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first($select);
        if (! $row) {
            return [];
        }

        $studentCohort = $this->cohortForStudent($studentId, $tenantId);

        return [
            'tahun_ajaran' => $row->tahun_ajaran ?? null,
            'semester' => $row->semester ?? null,
            'angkatan' => $studentCohort ?: ($row->angkatan ?? null),
        ];
    }

    private function academicSnapshotForQuiz($quizId, $studentId, ?string $tenantId): array
    {
        $quizId = trim((string) ($quizId ?? ''));
        if ($quizId === '' || ! Schema::hasTable('quizzes')) {
            return [];
        }

        $columns = ['tahun_ajaran', 'semester', 'angkatan'];
        $select = array_values(array_filter($columns, fn ($column) => $this->isSelectableColumn('quizzes', $column)));
        if (empty($select)) {
            return [];
        }

        $query = DB::table('quizzes')->where('id', $quizId);
        if ($tenantId && $this->isSelectableColumn('quizzes', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first($select);
        if (! $row) {
            return [];
        }

        $studentCohort = $this->cohortForStudent($studentId, $tenantId);

        return [
            'tahun_ajaran' => $row->tahun_ajaran ?? null,
            'semester' => $row->semester ?? null,
            'angkatan' => $studentCohort ?: ($row->angkatan ?? null),
        ];
    }

    private function guruKelasIds(string $userId): array
    {
        if (isset($this->guruKelasCache[$userId])) {
            return $this->guruKelasCache[$userId];
        }

        $kelasQuery = DB::table('jadwal')->where('guru_id', $userId);
        $this->applyTenantFilter($kelasQuery);
        $this->applyCurrentAcademicPeriodToQuery($kelasQuery, 'jadwal');
        $kelas = $kelasQuery
            ->distinct()
            ->pluck('kelas_id')
            ->filter()
            ->values()
            ->all();

        $waliQuery = DB::table('kelas_struktur')->where('wali_guru_id', $userId);
        $this->applyTenantFilter($waliQuery);
        $wali = $waliQuery
            ->distinct()
            ->pluck('kelas_id')
            ->filter()
            ->values()
            ->all();

        $merged = array_values(array_unique(array_merge($kelas, $wali)));
        $this->guruKelasCache[$userId] = $merged;

        return $merged;
    }

    private function guruWaliKelasIds(string $userId): array
    {
        if (isset($this->guruWaliKelasCache[$userId])) {
            return $this->guruWaliKelasCache[$userId];
        }

        $waliQuery = DB::table('kelas_struktur')->where('wali_guru_id', $userId);
        $this->applyTenantFilter($waliQuery);
        $wali = $waliQuery
            ->distinct()
            ->pluck('kelas_id')
            ->filter()
            ->values()
            ->all();

        $this->guruWaliKelasCache[$userId] = $wali;

        return $wali;
    }

    private function guruRapotKelasIds(string $userId): array
    {
        $userId = trim($userId);
        if ($userId === '') {
            return [];
        }

        $kelas = $this->guruKelasIds($userId);

        $jadwalQuery = DB::table('jadwal')->where('guru_id', $userId);
        $this->applyTenantFilter($jadwalQuery);
        foreach ($jadwalQuery->distinct()->pluck('kelas_id')->all() as $kelasId) {
            if ($kelasId !== null && trim((string) $kelasId) !== '') {
                $kelas[] = $kelasId;
            }
        }

        if ($this->isSelectableColumn('tugas', 'kelas_id') && $this->isSelectableColumn('tugas', 'created_by')) {
            $tugasQuery = DB::table('tugas')->where('created_by', $userId);
            $this->applyTenantFilter($tugasQuery);
            foreach ($tugasQuery->distinct()->pluck('kelas_id')->all() as $kelasId) {
                if ($kelasId !== null && trim((string) $kelasId) !== '') {
                    $kelas[] = $kelasId;
                }
            }
        }

        if ($this->isSelectableColumn('tugas', 'kelas') && $this->isSelectableColumn('tugas', 'created_by')) {
            $tugasKelasQuery = DB::table('tugas')->where('created_by', $userId);
            $this->applyTenantFilter($tugasKelasQuery);
            foreach ($tugasKelasQuery->distinct()->pluck('kelas')->all() as $kelasId) {
                if ($kelasId !== null && trim((string) $kelasId) !== '') {
                    $kelas[] = $kelasId;
                }
            }
        }

        if ($this->isSelectableColumn('quizzes', 'kelas_id') && $this->isSelectableColumn('quizzes', 'guru_id')) {
            $quizQuery = DB::table('quizzes')->where('guru_id', $userId);
            $this->applyTenantFilter($quizQuery);
            foreach ($quizQuery->distinct()->pluck('kelas_id')->all() as $kelasId) {
                if ($kelasId !== null && trim((string) $kelasId) !== '') {
                    $kelas[] = $kelasId;
                }
            }
        }

        return array_values(array_unique(array_map('strval', array_filter($kelas, fn ($kelasId) => trim((string) $kelasId) !== ''))));
    }

    private function normalizeKelasAccessValue($value): string
    {
        $normalized = strtolower($this->normalizeWhitespace(str_replace('-', ' ', (string) $value)));

        return $normalized;
    }

    private function normalizeKelasAccessValues(array $values): array
    {
        return array_values(array_unique(array_filter(array_map(
            fn ($value) => $this->normalizeKelasAccessValue($value),
            $this->expandKelasAccessValues($values)
        ))));
    }

    private function expandKelasAccessValues(array $values): array
    {
        $rawValues = array_values(array_unique(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $values
        ))));
        if (empty($rawValues)) {
            return [];
        }

        $expanded = [];
        foreach ($rawValues as $value) {
            $expanded[] = $value;
            $expanded[] = str_replace('-', ' ', $value);
            $expanded[] = str_replace(' ', '-', $value);
        }

        if (Schema::hasTable('kelas')) {
            $kelasQuery = DB::table('kelas');
            $this->applyTenantFilter($kelasQuery);
            $kelasRows = $kelasQuery
                ->where(function ($query) use ($rawValues) {
                    $query->whereIn('id', $rawValues);
                    if ($this->isSelectableColumn('kelas', 'nama')) {
                        $query->orWhereIn('nama', $rawValues);
                    }
                })
                ->get(['id', 'nama', 'grade', 'suffix']);

            foreach ($kelasRows as $kelas) {
                foreach ([
                    $kelas->id ?? null,
                    $kelas->nama ?? null,
                    trim((string) (($kelas->grade ?? '').' '.($kelas->suffix ?? ''))),
                ] as $alias) {
                    $alias = trim((string) $alias);
                    if ($alias === '') {
                        continue;
                    }
                    $expanded[] = $alias;
                    $expanded[] = str_replace('-', ' ', $alias);
                    $expanded[] = str_replace(' ', '-', $alias);
                }
            }
        }

        return array_values(array_unique(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $expanded
        ))));
    }

    private function guruQuizIdsForWali(string $userId): array
    {
        $quizIds = $this->guruQuizIds($userId);
        $wali = $this->guruWaliKelasIds($userId);
        foreach ($wali as $kelasId) {
            $quizIds = array_merge($quizIds, $this->kelasQuizIds($kelasId));
        }

        return array_values(array_unique($quizIds));
    }

    private function guruEskulIds(string $userId): array
    {
        if (isset($this->guruEskulCache[$userId])) {
            return $this->guruEskulCache[$userId];
        }

        $ekskulQuery = DB::table('ekskul')->where('pembina_guru_id', $userId);
        $this->applyTenantFilter($ekskulQuery);
        $ekskul = $ekskulQuery
            ->pluck('id')
            ->filter()
            ->values()
            ->all();

        $this->guruEskulCache[$userId] = $ekskul;

        return $ekskul;
    }

    private function guruStudentRfidUids(string $userId): array
    {
        if (isset($this->guruStudentRfidCache[$userId])) {
            return $this->guruStudentRfidCache[$userId];
        }

        $kelas = $this->guruKelasIds($userId);
        if (empty($kelas)) {
            $this->guruStudentRfidCache[$userId] = [];

            return [];
        }

        $cardsQuery = DB::table('profiles')
            ->whereIn('kelas', $kelas)
            ->whereNotNull('rfid_uid');
        $this->applyTenantFilter($cardsQuery);
        $cards = $cardsQuery
            ->pluck('rfid_uid')
            ->filter()
            ->values()
            ->all();

        $this->guruStudentRfidCache[$userId] = $cards;

        return $cards;
    }

    private function payloadHasInvalidKelas($payload, array $allowed): bool
    {
        if (! is_array($payload)) {
            return true;
        }
        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $kelas = $row['kelas'] ?? null;
            if (! $kelas || ! in_array($kelas, $allowed, true)) {
                return true;
            }
        }

        return false;
    }

    private function parseEskulDateTime($value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $value);
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function validateSiswaEskulJoinPayload($payload, string $userId): ?string
    {
        if (! is_array($payload) || $userId === '') {
            return 'Data ekstrakurikuler tidak valid';
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $ekskulIds = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $ekskulId = trim((string) ($row['ekskul_id'] ?? ''));
            if ($ekskulId === '') {
                return 'Ekstrakurikuler tidak valid';
            }

            $ekskulIds[] = $ekskulId;
        }

        if (empty($ekskulIds)) {
            return 'Ekstrakurikuler tidak valid';
        }

        if (count($ekskulIds) !== count(array_unique($ekskulIds))) {
            return 'Ekstrakurikuler duplikat dalam pendaftaran';
        }
        $ekskulIds = array_values(array_unique($ekskulIds));
        $hasDeadlineColumn = $this->isSelectableColumn('ekskul', 'registration_deadline_at');

        $ekskulQuery = DB::table('ekskul')->whereIn('id', $ekskulIds);
        $this->applyTenantFilter($ekskulQuery);
        $columns = $hasDeadlineColumn
            ? ['id', 'registration_deadline_at']
            : ['id'];
        $ekskulRows = $ekskulQuery->get($columns);

        $ekskulMap = [];
        foreach ($ekskulRows as $row) {
            $ekskulMap[(string) ($row->id ?? '')] = $row;
        }

        $now = Carbon::now('Asia/Jakarta');
        $periodEnd = $this->currentAcademicPeriodEndForTenant($this->currentTenantId);
        foreach ($ekskulIds as $ekskulId) {
            $ekskul = $ekskulMap[$ekskulId] ?? null;
            if (! $ekskul) {
                return 'Ekstrakurikuler tidak ditemukan';
            }

            $effectiveDeadline = $periodEnd ? $periodEnd->copy() : null;
            if ($hasDeadlineColumn) {
                $deadline = $this->parseEskulDateTime($ekskul->registration_deadline_at ?? null);
                if ($deadline && (! $effectiveDeadline || $deadline->lt($effectiveDeadline))) {
                    $effectiveDeadline = $deadline;
                }
            }
            if ($effectiveDeadline && $now->gt($effectiveDeadline)) {
                return 'Pendaftaran ekstrakurikuler sudah ditutup';
            }
        }

        $existingMembershipQuery = DB::table('ekskul_anggota')->where('user_id', $userId);
        $this->applyTenantFilter($existingMembershipQuery);
        $this->applyCurrentAcademicPeriodToQuery($existingMembershipQuery, 'ekskul_anggota');
        $existingIds = array_map(
            fn ($id) => (string) $id,
            $existingMembershipQuery->pluck('ekskul_id')->filter()->values()->all()
        );
        if (! empty(array_intersect($existingIds, $ekskulIds))) {
            return 'Anda sudah terdaftar pada ekstrakurikuler ini di periode aktif';
        }

        $totalIds = array_values(array_unique(array_merge($existingIds, $ekskulIds)));

        $maxEskul = $this->maxEskulPerSiswaForTenant($this->currentTenantId);
        if (count($totalIds) > $maxEskul) {
            return "Maksimal {$maxEskul} ekstrakurikuler yang bisa diikuti";
        }

        return null;
    }

    private function validateSiswaEskulMutationTargets(Request $request, string $userId): ?string
    {
        if ($userId === '') {
            return 'Data siswa tidak valid';
        }

        $targetQuery = DB::table('ekskul_anggota')->where('user_id', $userId);
        $this->applyTenantFilter($targetQuery);
        $this->applyCurrentAcademicPeriodToQuery($targetQuery, 'ekskul_anggota');
        $this->applyFilters($targetQuery, $request->input('filters', []));
        $targets = $targetQuery->get(['ekskul_id']);

        if ($targets->isEmpty()) {
            return null;
        }

        $hasDeadlineColumn = $this->isSelectableColumn('ekskul', 'registration_deadline_at');

        $ekskulIds = $targets
            ->pluck('ekskul_id')
            ->filter()
            ->map(fn ($id) => (string) $id)
            ->unique()
            ->values()
            ->all();

        if (empty($ekskulIds)) {
            return 'Ekstrakurikuler tidak valid';
        }

        $ekskulQuery = DB::table('ekskul')
            ->whereIn('id', $ekskulIds);
        $this->applyTenantFilter($ekskulQuery);
        $columns = $hasDeadlineColumn
            ? ['id', 'registration_deadline_at']
            : ['id'];
        $ekskulRows = $ekskulQuery->get($columns);
        $ekskulMap = [];
        foreach ($ekskulRows as $row) {
            $ekskulMap[(string) ($row->id ?? '')] = $row;
        }

        $now = Carbon::now('Asia/Jakarta');
        $periodEnd = $this->currentAcademicPeriodEndForTenant($this->currentTenantId);
        foreach ($ekskulIds as $ekskulId) {
            $ekskul = $ekskulMap[$ekskulId] ?? null;
            if (! $ekskul) {
                return 'Ekstrakurikuler tidak ditemukan';
            }

            $effectiveDeadline = $periodEnd ? $periodEnd->copy() : null;
            if ($hasDeadlineColumn) {
                $deadline = $this->parseEskulDateTime($ekskul->registration_deadline_at ?? null);
                if ($deadline && (! $effectiveDeadline || $deadline->lt($effectiveDeadline))) {
                    $effectiveDeadline = $deadline;
                }
            }
            if ($effectiveDeadline && $now->gt($effectiveDeadline)) {
                return 'Pendaftaran ekstrakurikuler sudah ditutup, tidak bisa membatalkan';
            }
        }

        return null;
    }

    private function guruQuizIds(string $userId): array
    {
        if (isset($this->guruQuizCache[$userId])) {
            return $this->guruQuizCache[$userId];
        }

        $quizQuery = DB::table('quizzes')->where('guru_id', $userId);
        $this->applyTenantFilter($quizQuery);
        $ids = $quizQuery
            ->pluck('id')
            ->filter()
            ->values()
            ->all();

        $this->guruQuizCache[$userId] = $ids;

        return $ids;
    }

    private function kelasQuizIds(?string $kelasId): array
    {
        $key = $kelasId ?: '__none__';
        if (isset($this->kelasQuizCache[$key])) {
            return $this->kelasQuizCache[$key];
        }

        if (! $kelasId) {
            $this->kelasQuizCache[$key] = [];

            return [];
        }

        $quizQuery = DB::table('quizzes')->where('kelas_id', $kelasId);
        $this->applyTenantFilter($quizQuery);
        $ids = $quizQuery
            ->pluck('id')
            ->filter()
            ->values()
            ->all();

        $this->kelasQuizCache[$key] = $ids;

        return $ids;
    }

    private function questionIdsByQuizIds(array $quizIds): array
    {
        $key = implode('|', $quizIds);
        if (isset($this->quizQuestionCache[$key])) {
            return $this->quizQuestionCache[$key];
        }

        if (empty($quizIds)) {
            return [];
        }

        $questionQuery = DB::table('quiz_questions')->whereIn('quiz_id', $quizIds);
        $this->applyTenantFilter($questionQuery);
        $ids = $questionQuery
            ->pluck('id')
            ->filter()
            ->values()
            ->all();

        $this->quizQuestionCache[$key] = $ids;

        return $ids;
    }

    private function submissionIdsByQuizIds(array $quizIds): array
    {
        if (empty($quizIds)) {
            return [];
        }

        $submissionQuery = DB::table('quiz_submissions')->whereIn('quiz_id', $quizIds);
        $this->applyTenantFilter($submissionQuery);

        return $submissionQuery->pluck('id')->filter()->values()->all();
    }

    private function submissionIdsByUser(string $userId): array
    {
        $submissionQuery = DB::table('quiz_submissions')->where('siswa_id', $userId);
        $this->applyTenantFilter($submissionQuery);

        return $submissionQuery->pluck('id')->filter()->values()->all();
    }

    private function payloadHasInvalidQuiz($payload, array $allowedQuizIds): bool
    {
        if (! is_array($payload)) {
            return true;
        }
        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $quizId = $row['quiz_id'] ?? null;
            if (! $quizId || ! in_array($quizId, $allowedQuizIds, true)) {
                return true;
            }
        }

        return false;
    }

    private function payloadHasInvalidQuestion($payload, array $allowedQuestionIds): bool
    {
        if (! is_array($payload)) {
            return true;
        }
        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $qid = $row['question_id'] ?? null;
            if (! $qid || ! in_array($qid, $allowedQuestionIds, true)) {
                return true;
            }
        }

        return false;
    }

    private function payloadHasInvalidSubmission($payload, array $allowedSubmissionIds): bool
    {
        if (! is_array($payload)) {
            return true;
        }
        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $sid = $row['submission_id'] ?? null;
            if (! $sid || ! in_array($sid, $allowedSubmissionIds, true)) {
                return true;
            }
        }

        return false;
    }

    private function payloadHasUnavailableQuizForSiswa($payload, ?string $kelas): bool
    {
        if (! is_array($payload) || ! $kelas) {
            return true;
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $quizIds = [];
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $quizId = trim((string) ($row['quiz_id'] ?? ''));
            if ($quizId === '') {
                return true;
            }
            $quizIds[] = $quizId;
        }

        if (empty($quizIds)) {
            return true;
        }

        $quizIds = array_values(array_unique($quizIds));
        $quizQuery = DB::table('quizzes')
            ->whereIn('id', $quizIds)
            ->where('kelas_id', $kelas);
        $this->applyTenantFilter($quizQuery);
        $quizzes = $quizQuery->get();

        $quizMap = [];
        foreach ($quizzes as $quiz) {
            $quizMap[(string) $quiz->id] = $quiz;
        }

        $now = now()->startOfMinute();
        foreach ($quizIds as $quizId) {
            $quiz = $quizMap[$quizId] ?? null;
            if (! $quiz) {
                return true;
            }
            if (! $this->quizIsAvailableForStudent($quiz, $now)) {
                return true;
            }
        }

        return false;
    }

    private function quizIsAvailableForStudent(object $quiz, Carbon $now): bool
    {
        $startsAtRaw = $quiz->starts_at ?? null;
        if (! $startsAtRaw) {
            // Draft quiz belum dijadwalkan.
            return false;
        }
        $startsAt = Carbon::parse($startsAtRaw);
        if ($now->lt($startsAt)) {
            return false;
        }

        if ((bool) ($quiz->is_live ?? false)) {
            $duration = (int) ($quiz->duration_minutes ?? 0);
            if ($duration <= 0) {
                return false;
            }

            $liveStartedAt = $quiz->live_started_at ?? $startsAtRaw;
            if (! $liveStartedAt) {
                return false;
            }

            $liveStart = Carbon::parse($liveStartedAt);
            if ($now->lt($liveStart)) {
                return false;
            }

            $endAt = $liveStart->copy()->addMinutes($duration);
            if ($now->gt($endAt)) {
                return false;
            }

            return true;
        }

        $deadlineRaw = $quiz->deadline_at ?? null;
        if (! $deadlineRaw) {
            return false;
        }
        $deadlineAt = Carbon::parse($deadlineRaw);
        if ($now->gt($deadlineAt)) {
            return false;
        }

        return true;
    }

    private function payloadHasInvalidQuizAnswerForSiswa($payload, string $userId): bool
    {
        if (! is_array($payload)) {
            return true;
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $submissionCache = [];
        $questionCache = [];
        $optionCache = [];
        $now = now();

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $submissionId = trim((string) ($row['submission_id'] ?? ''));
            $questionId = trim((string) ($row['question_id'] ?? ''));
            $optionId = trim((string) ($row['option_id'] ?? ''));
            $essayAnswerRaw = $row['essay_answer'] ?? null;

            if ($submissionId === '' || $questionId === '') {
                return true;
            }

            if (! isset($submissionCache[$submissionId])) {
                $submissionQuery = DB::table('quiz_submissions as s')
                    ->join('quizzes as q', 'q.id', '=', 's.quiz_id')
                    ->select(
                        's.id',
                        's.status',
                        's.siswa_id',
                        's.quiz_id',
                        'q.is_live',
                        'q.is_active',
                        'q.starts_at',
                        'q.deadline_at',
                        'q.live_started_at',
                        'q.duration_minutes'
                    )
                    ->where('s.id', $submissionId)
                    ->where('s.siswa_id', $userId);
                if ($this->currentTenantId) {
                    // Avoid ambiguous tenant_id on joined tables and enforce same-tenant quiz linkage.
                    $submissionQuery
                        ->where('s.tenant_id', $this->currentTenantId)
                        ->where('q.tenant_id', $this->currentTenantId);
                }
                $submissionCache[$submissionId] = $submissionQuery->first();
            }

            $submission = $submissionCache[$submissionId];
            if (! $submission) {
                return true;
            }

            if ((string) ($submission->status ?? '') !== 'ongoing') {
                return true;
            }

            if (! $this->quizIsAvailableForStudent((object) [
                'is_live' => $submission->is_live,
                'is_active' => $submission->is_active,
                'starts_at' => $submission->starts_at,
                'deadline_at' => $submission->deadline_at,
                'live_started_at' => $submission->live_started_at,
                'duration_minutes' => $submission->duration_minutes,
            ], $now)) {
                return true;
            }

            $questionKey = $submission->quiz_id.'|'.$questionId;
            if (! isset($questionCache[$questionKey])) {
                $questionQuery = DB::table('quiz_questions')
                    ->where('id', $questionId)
                    ->where('quiz_id', $submission->quiz_id);
                $this->applyTenantFilter($questionQuery);
                $questionCache[$questionKey] = $questionQuery->first(['id', 'question_type']);
            }

            $question = $questionCache[$questionKey];
            if (! $question) {
                return true;
            }

            $questionType = $this->normalizeQuestionType($question->question_type ?? null);
            $essayAnswer = '';
            if ($essayAnswerRaw !== null) {
                if (is_array($essayAnswerRaw) || is_object($essayAnswerRaw)) {
                    return true;
                }
                $essayAnswer = trim((string) $essayAnswerRaw);
            }

            if ($questionType === 'essay') {
                if ($optionId !== '') {
                    return true;
                }
            } else {
                if ($essayAnswer !== '') {
                    return true;
                }
                if ($optionId !== '') {
                    $optionKey = $questionId.'|'.$optionId;
                    if (! isset($optionCache[$optionKey])) {
                        $optionQuery = DB::table('quiz_options')
                            ->where('id', $optionId)
                            ->where('question_id', $questionId);
                        $this->applyTenantFilter($optionQuery);
                        $optionCache[$optionKey] = $optionQuery->exists();
                    }
                    if (! $optionCache[$optionKey]) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private function parseQuizDateTime($value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $value);
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function normalizeQuestionType($value): string
    {
        $type = strtolower(trim((string) ($value ?? 'mcq')));
        if (! in_array($type, ['mcq', 'essay'], true)) {
            return 'mcq';
        }

        return $type;
    }

    private function normalizeQuizMode($value, bool $isLiveFallback = false, bool $strict = false): ?string
    {
        $raw = strtolower(trim((string) ($value ?? '')));
        if ($raw === '') {
            return $isLiveFallback ? 'uts' : 'regular';
        }

        if (in_array($raw, ['regular', 'uts', 'uas'], true)) {
            return $raw;
        }

        // Backward compatibility untuk data lama.
        if ($raw === 'ulangan') {
            return 'uts';
        }

        if (! $strict && in_array($raw, ['ujian', 'exam'], true)) {
            return 'uts';
        }

        return null;
    }

    private function normalizeQuizPenilaian($value): ?string
    {
        $raw = strtolower(trim((string) ($value ?? '')));
        if ($raw === '') {
            return 'poin';
        }

        if ($raw === 'poin') {
            return 'poin';
        }

        // Backward compatibility: mode skala lama dipaksa ke poin.
        if ($raw === 'skala_100') {
            return 'poin';
        }

        return null;
    }

    private function validateGuruMapelBobotPayload(&$payload, bool $requireAllFields = true): ?string
    {
        if (! is_array($payload)) {
            return null;
        }

        $error = null;
        $weightRules = [
            'bobot_tugas_pr' => ['min' => 0, 'max' => 100, 'label' => 'Bobot Tugas/PR'],
            'bobot_quiz_reguler' => ['min' => 0, 'max' => 100, 'label' => 'Bobot Quiz Reguler'],
            'bobot_quiz_uts' => ['min' => 0, 'max' => 100, 'label' => 'Bobot Quiz UTS'],
            'bobot_quiz_uas' => ['min' => 0, 'max' => 100, 'label' => 'Bobot Quiz UAS'],
        ];

        $this->mapPayload($payload, function ($row) use (&$error, $weightRules, $requireAllFields) {
            if ($error !== null || ! is_array($row)) {
                return $row;
            }

            $mapel = trim((string) ($row['mapel'] ?? ''));
            if ($requireAllFields && $mapel === '') {
                $error = 'Mapel untuk bobot penilaian wajib diisi';

                return $row;
            }
            if ($mapel !== '') {
                $row['mapel'] = $mapel;
            }

            $weights = [];
            foreach ($weightRules as $key => $rule) {
                if (! array_key_exists($key, $row)) {
                    if ($requireAllFields) {
                        $error = $rule['label'].' wajib diisi';

                        return $row;
                    }

                    continue;
                }

                $raw = $row[$key];
                if ($raw === '' || $raw === null || ! is_numeric($raw)) {
                    $error = $rule['label'].' harus berupa angka';

                    return $row;
                }

                $weight = round((float) $raw, 2);
                $min = (float) $rule['min'];
                $max = (float) $rule['max'];
                if ($weight < $min || $weight > $max) {
                    $error = sprintf(
                        '%s harus di antara %s%% sampai %s%%',
                        $rule['label'],
                        rtrim(rtrim(number_format($min, 2, '.', ''), '0'), '.'),
                        rtrim(rtrim(number_format($max, 2, '.', ''), '0'), '.')
                    );

                    return $row;
                }

                $row[$key] = $weight;
                $weights[$key] = $weight;
            }

            if (count($weights) === count($weightRules)) {
                $total = array_sum($weights);
                if ($total > 100.01) {
                    $error = 'Total bobot Tugas/PR + Quiz Reguler + Quiz UTS + Quiz UAS tidak boleh lebih dari 100%';

                    return $row;
                }
            } elseif ($requireAllFields) {
                $error = 'Bobot mapel belum lengkap';

                return $row;
            }

            return $row;
        });

        return $error;
    }

    private function getGuruAmpuMapelLookup(string $guruId): array
    {
        $guruId = trim($guruId);
        if ($guruId === '') {
            return [];
        }

        $normalizeMapel = static fn ($mapel): string => strtolower(trim((string) $mapel));
        $jadwalQuery = DB::table('jadwal')
            ->where('guru_id', $guruId)
            ->whereNotNull('mapel');
        $this->applyTenantFilter($jadwalQuery);

        $lookup = [];
        foreach ($jadwalQuery->pluck('mapel')->all() as $mapel) {
            $normalized = $normalizeMapel($mapel);
            if ($normalized !== '') {
                $lookup[$normalized] = true;
            }
        }

        if ($this->isSelectableColumn('tugas', 'mapel') && $this->isSelectableColumn('tugas', 'created_by')) {
            $tugasQuery = DB::table('tugas')
                ->where('created_by', $guruId)
                ->whereNotNull('mapel');
            $this->applyTenantFilter($tugasQuery);
            foreach ($tugasQuery->distinct()->pluck('mapel')->all() as $mapel) {
                $normalized = $normalizeMapel($mapel);
                if ($normalized !== '') {
                    $lookup[$normalized] = true;
                }
            }
        }

        if ($this->isSelectableColumn('quizzes', 'mapel') && $this->isSelectableColumn('quizzes', 'guru_id')) {
            $quizQuery = DB::table('quizzes')
                ->where('guru_id', $guruId)
                ->whereNotNull('mapel');
            $this->applyTenantFilter($quizQuery);
            foreach ($quizQuery->distinct()->pluck('mapel')->all() as $mapel) {
                $normalized = $normalizeMapel($mapel);
                if ($normalized !== '') {
                    $lookup[$normalized] = true;
                }
            }
        }

        return $lookup;
    }

    private function validateGuruMapelBobotOwnership($payload, string $guruId): ?string
    {
        if (! is_array($payload)) {
            return null;
        }

        $allowedMapelLookup = $this->getGuruAmpuMapelLookup($guruId);
        if (empty($allowedMapelLookup)) {
            return null;
        }

        $error = null;
        $rows = $this->normalizeRows($payload);
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $mapel = trim((string) ($row['mapel'] ?? ''));
            if ($mapel === '') {
                continue;
            }

            $normalizedMapel = strtolower($mapel);
            if (! isset($allowedMapelLookup[$normalizedMapel])) {
                $error = sprintf(
                    'Mapel "%s" tidak ada di jadwal mengajar Anda. Bobot hanya boleh diatur untuk mapel yang diampu',
                    $mapel
                );
                break;
            }
        }

        return $error;
    }

    private function guruCanTeachMapelInKelas(string $guruId, string $kelasId, string $mapel): bool
    {
        $kelasId = trim($kelasId);
        $mapelNeedle = strtolower(trim($mapel));
        if ($kelasId === '' || $mapelNeedle === '') {
            return false;
        }
        $kelasNeedles = $this->normalizeKelasAccessValues([$kelasId]);

        $jadwalQuery = DB::table('jadwal')
            ->where('guru_id', $guruId)
            ->whereIn('kelas_id', $this->expandKelasAccessValues([$kelasId]));
        $this->applyTenantFilter($jadwalQuery);
        $mapelRows = $jadwalQuery->pluck('mapel')->filter()->all();

        foreach ($mapelRows as $mapelRow) {
            if (strtolower(trim((string) $mapelRow)) === $mapelNeedle) {
                return true;
            }
        }

        if ($this->isSelectableColumn('tugas', 'kelas_id') && $this->isSelectableColumn('tugas', 'mapel') && $this->isSelectableColumn('tugas', 'created_by')) {
            $tugasQuery = DB::table('tugas')
                ->where('created_by', $guruId)
                ->whereIn('kelas_id', $this->expandKelasAccessValues([$kelasId]))
                ->whereNotNull('mapel');
            $this->applyTenantFilter($tugasQuery);
            foreach ($tugasQuery->distinct()->pluck('mapel')->all() as $mapelRow) {
                if (strtolower(trim((string) $mapelRow)) === $mapelNeedle) {
                    return true;
                }
            }
        }

        if ($this->isSelectableColumn('tugas', 'kelas') && $this->isSelectableColumn('tugas', 'mapel') && $this->isSelectableColumn('tugas', 'created_by')) {
            $tugasKelasQuery = DB::table('tugas')
                ->where('created_by', $guruId)
                ->whereNotNull('mapel');
            $this->applyTenantFilter($tugasKelasQuery);
            foreach ($tugasKelasQuery->distinct()->get(['kelas', 'mapel']) as $row) {
                if (
                    in_array($this->normalizeKelasAccessValue($row->kelas ?? ''), $kelasNeedles, true) &&
                    strtolower(trim((string) ($row->mapel ?? ''))) === $mapelNeedle
                ) {
                    return true;
                }
            }
        }

        if ($this->isSelectableColumn('quizzes', 'kelas_id') && $this->isSelectableColumn('quizzes', 'mapel') && $this->isSelectableColumn('quizzes', 'guru_id')) {
            $quizQuery = DB::table('quizzes')
                ->where('guru_id', $guruId)
                ->whereIn('kelas_id', $this->expandKelasAccessValues([$kelasId]))
                ->whereNotNull('mapel');
            $this->applyTenantFilter($quizQuery);
            foreach ($quizQuery->distinct()->pluck('mapel')->all() as $mapelRow) {
                if (strtolower(trim((string) $mapelRow)) === $mapelNeedle) {
                    return true;
                }
            }
        }

        return false;
    }

    private function quizIdsHaveOngoingSubmissions(array $quizIds): bool
    {
        $ids = array_values(array_unique(array_filter(array_map(
            fn ($id) => trim((string) $id),
            $quizIds
        ))));
        if (empty($ids)) {
            return false;
        }

        $query = DB::table('quiz_submissions')
            ->whereIn('quiz_id', $ids)
            ->where('status', 'ongoing');
        $this->applyTenantFilter($query);

        return $query->exists();
    }

    private function quizIdsFromPayload($payload): array
    {
        if (! is_array($payload)) {
            return [];
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $ids = [];
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $quizId = trim((string) ($row['quiz_id'] ?? ''));
            if ($quizId !== '') {
                $ids[] = $quizId;
            }
        }

        return array_values(array_unique($ids));
    }

    private function questionIdsFromPayload($payload): array
    {
        if (! is_array($payload)) {
            return [];
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $ids = [];
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            $questionId = trim((string) ($row['question_id'] ?? ''));
            if ($questionId !== '') {
                $ids[] = $questionId;
            }
        }

        return array_values(array_unique($ids));
    }

    private function quizIdsByQuestionIds(array $questionIds): array
    {
        $ids = array_values(array_unique(array_filter(array_map(
            fn ($id) => trim((string) $id),
            $questionIds
        ))));
        if (empty($ids)) {
            return [];
        }

        $query = DB::table('quiz_questions')->whereIn('id', $ids);
        $this->applyTenantFilter($query);

        return $query
            ->pluck('quiz_id')
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function quizIdsForTargetQuestionMutation($baseQuery, $filters): array
    {
        $targetQuery = clone $baseQuery;
        $this->applyFilters($targetQuery, $filters);

        return $targetQuery
            ->pluck('quiz_id')
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function quizIdsForTargetOptionMutation($baseQuery, $filters): array
    {
        $targetQuery = clone $baseQuery;
        $this->applyFilters($targetQuery, $filters);
        $questionIds = $targetQuery
            ->pluck('question_id')
            ->filter()
            ->unique()
            ->values()
            ->all();

        return $this->quizIdsByQuestionIds($questionIds);
    }

    private function boolValue($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    private function academicYearBounds(?string $academicYear): ?array
    {
        $year = AcademicPeriod::normalizeAcademicYear($academicYear);
        if (! $year) {
            return null;
        }

        $startYear = (int) substr($year, 0, 4);
        if ($startYear <= 0) {
            return null;
        }

        return [
            Carbon::create($startYear, 7, 1, 0, 0, 0, 'Asia/Jakarta')->startOfDay(),
            Carbon::create($startYear + 1, 6, 30, 23, 59, 59, 'Asia/Jakarta')->endOfDay(),
        ];
    }

    private function validateQuizTimelineWithinAcademicYear(?Carbon $startsAt, ?Carbon $endsAt, ?string $academicYear): ?string
    {
        $year = AcademicPeriod::normalizeAcademicYear($academicYear);
        $bounds = $this->academicYearBounds($year);
        if (! $year || ! $bounds) {
            return null;
        }

        [$periodStart, $periodEnd] = $bounds;
        foreach ([
            'Tanggal mulai' => $startsAt,
            'Waktu selesai' => $endsAt,
        ] as $label => $date) {
            if (! $date instanceof Carbon) {
                continue;
            }
            $localDate = $date->copy()->setTimezone('Asia/Jakarta');
            if ($localDate->lt($periodStart) || $localDate->gt($periodEnd)) {
                return "{$label} quiz harus berada dalam tahun periode {$year} ({$periodStart->toDateString()} sampai {$periodEnd->toDateString()})";
            }
        }

        return null;
    }

    private function validateGuruQuizCreatePayload(&$payload, string $userId): ?string
    {
        if (! is_array($payload)) {
            return 'Payload quiz tidak valid';
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        if (empty($rows)) {
            return 'Payload quiz tidak valid';
        }

        $now = now()->startOfMinute();
        $normalizedRows = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $nama = trim((string) ($row['nama'] ?? ''));
            if ($nama === '') {
                return 'Nama quiz wajib diisi';
            }

            $kelasId = trim((string) ($row['kelas_id'] ?? ''));
            $mapel = trim((string) ($row['mapel'] ?? ''));
            if ($kelasId === '' || $mapel === '') {
                return 'Kelas dan mata pelajaran quiz wajib diisi';
            }
            if (! $this->guruCanTeachMapelInKelas($userId, $kelasId, $mapel)) {
                return 'Kelas dan mapel quiz harus sesuai yang diampu guru';
            }

            $penilaian = $this->normalizeQuizPenilaian($row['penilaian'] ?? null);
            if ($penilaian === null) {
                return 'Sistem penilaian quiz tidak valid';
            }

            $mode = null;
            if (array_key_exists('mode', $row)) {
                $mode = $this->normalizeQuizMode($row['mode'] ?? null, (bool) ($row['is_live'] ?? false), true);
                if ($mode === null) {
                    return 'Mode quiz tidak valid';
                }
            } else {
                $mode = $this->normalizeQuizMode(null, (bool) ($row['is_live'] ?? false));
            }

            $normalized = $row;
            $normalized['nama'] = $nama;
            $normalized['kelas_id'] = $kelasId;
            $normalized['mapel'] = $mapel;
            $normalized['penilaian'] = $penilaian;
            $normalized['mode'] = $mode;
            $startsAtInput = $row['starts_at'] ?? null;
            $startsAt = $this->parseQuizDateTime($startsAtInput);
            if ($startsAtInput !== null && $startsAtInput !== '' && ! $startsAt) {
                return 'Tanggal mulai quiz tidak valid';
            }
            $normalized['starts_at'] = $startsAt;

            // Draft mode: quiz boleh dibuat dulu tanpa jadwal.
            if (! $startsAt) {
                $normalized['deadline_at'] = null;
                $normalized['live_started_at'] = null;
                $normalized['is_active'] = false;
                if ($mode === 'regular') {
                    $normalized['is_live'] = false;
                    $normalized['duration_minutes'] = null;
                } else {
                    $duration = (int) ($row['duration_minutes'] ?? 60);
                    if ($duration < 10) {
                        $duration = 60;
                    }
                    $normalized['is_live'] = true;
                    $normalized['duration_minutes'] = $duration;
                }
                $normalizedRows[] = $normalized;

                continue;
            }

            if ($startsAt->lt($now)) {
                return 'Tanggal mulai quiz tidak boleh di masa lalu';
            }
            $academicYear = AcademicPeriod::normalizeAcademicYear($row['tahun_ajaran'] ?? null)
                ?: $this->currentAcademicPeriodForTenant($this->currentTenantId)['tahun_ajaran'];

            if ($mode === 'regular') {
                $deadline = $this->parseQuizDateTime($row['deadline_at'] ?? null);
                if (! $deadline) {
                    return 'Tanggal selesai quiz wajib diisi untuk mode reguler';
                }
                if (! $deadline->gt($startsAt)) {
                    return 'Tanggal selesai quiz harus setelah tanggal mulai';
                }
                if ($deadline->lt($now)) {
                    return 'Tanggal selesai quiz tidak boleh di masa lalu';
                }
                $periodError = $this->validateQuizTimelineWithinAcademicYear($startsAt, $deadline, $academicYear);
                if ($periodError !== null) {
                    return $periodError;
                }

                $normalized['deadline_at'] = $deadline;
                $normalized['is_live'] = false;
                $normalized['is_active'] = true;
                $normalized['live_started_at'] = null;
                $normalized['duration_minutes'] = null;
            } else {
                $duration = (int) ($row['duration_minutes'] ?? 0);
                if ($duration < 10) {
                    return 'Durasi quiz ujian minimal 10 menit';
                }
                $endAt = $startsAt->copy()->addMinutes($duration);
                if ($endAt->lt($now)) {
                    return 'Waktu selesai quiz tidak boleh di masa lalu';
                }
                $periodError = $this->validateQuizTimelineWithinAcademicYear($startsAt, $endAt, $academicYear);
                if ($periodError !== null) {
                    return $periodError;
                }

                $normalized['is_live'] = true;
                $normalized['is_active'] = true;
                $normalized['live_started_at'] = $startsAt;
                $normalized['duration_minutes'] = $duration;
                $normalized['deadline_at'] = $endAt;
            }

            $normalizedRows[] = $normalized;
        }

        if (empty($normalizedRows)) {
            return 'Payload quiz tidak valid';
        }

        $payload = $this->isAssoc($payload)
            ? ($normalizedRows[0] ?? [])
            : $normalizedRows;

        return null;
    }

    private function validateGuruQuizUpdatePayload(array &$payload, Request $request, string $userId): ?string
    {
        $timeMutationFields = [
            'starts_at',
            'deadline_at',
            'is_live',
            'is_active',
            'live_started_at',
            'duration_minutes',
            'updated_at',
        ];
        $payloadKeys = array_keys($payload);
        $hasNonTimeMutation = ! empty(array_diff($payloadKeys, $timeMutationFields));
        $touchScoring = array_key_exists('penilaian', $payload);
        $touchOwnedTarget = array_key_exists('kelas_id', $payload) || array_key_exists('mapel', $payload);
        $touchTimeline = array_key_exists('starts_at', $payload)
            || array_key_exists('deadline_at', $payload)
            || array_key_exists('mode', $payload)
            || array_key_exists('is_live', $payload)
            || array_key_exists('is_active', $payload)
            || array_key_exists('live_started_at', $payload)
            || array_key_exists('duration_minutes', $payload);

        if ($touchScoring) {
            $penilaian = $this->normalizeQuizPenilaian($payload['penilaian'] ?? null);
            if ($penilaian === null) {
                return 'Sistem penilaian quiz tidak valid';
            }
            $payload['penilaian'] = $penilaian;
        }

        if (! $touchOwnedTarget && ! $touchTimeline && ! $hasNonTimeMutation) {
            return null;
        }

        $targetQuery = DB::table('quizzes')
            ->where('guru_id', $userId);
        $this->applyTenantFilter($targetQuery);
        $this->applyFilters($targetQuery, $request->input('filters', []));

        $targetColumns = array_values(array_filter([
            'id',
            'kelas_id',
            'mapel',
            'starts_at',
            'deadline_at',
            'mode',
            'is_live',
            'is_active',
            'live_started_at',
            'duration_minutes',
            'tahun_ajaran',
            'semester',
        ], fn ($column) => $this->isSelectableColumn('quizzes', $column)));
        $targets = $targetQuery->get($targetColumns);

        if ($targets->isEmpty()) {
            return null;
        }

        if ($targets->count() > 1) {
            return 'Update data quiz harus per quiz (satu per satu)';
        }

        $target = $targets->first();
        $hasOngoingSubmission = $this->quizIdsHaveOngoingSubmissions([(string) $target->id]);
        if ($hasOngoingSubmission && $hasNonTimeMutation) {
            return 'Quiz sedang dikerjakan siswa. Hanya deadline atau durasi yang boleh diubah.';
        }
        if (
            $hasOngoingSubmission
            && array_key_exists('is_active', $payload)
            && ! $this->boolValue($payload['is_active'])
        ) {
            return 'Quiz sedang dikerjakan siswa. Gunakan Tutup Quiz jika ingin mengakhiri attempt.';
        }
        if (
            $hasOngoingSubmission
            && array_key_exists('is_live', $payload)
            && $this->boolValue($payload['is_live']) !== $this->boolValue($target->is_live ?? false)
        ) {
            return 'Mode quiz tidak boleh diubah saat ada siswa sedang mengerjakan quiz.';
        }
        if (! $touchOwnedTarget && ! $touchTimeline) {
            return null;
        }

        $now = now()->startOfMinute();

        $kelasId = trim((string) ($payload['kelas_id'] ?? $target->kelas_id ?? ''));
        $mapel = trim((string) ($payload['mapel'] ?? $target->mapel ?? ''));
        if ($kelasId === '' || $mapel === '') {
            return 'Kelas dan mata pelajaran quiz wajib diisi';
        }
        if (! $this->guruCanTeachMapelInKelas($userId, $kelasId, $mapel)) {
            return 'Kelas dan mapel quiz harus sesuai yang diampu guru';
        }

        $mode = null;
        if (array_key_exists('mode', $payload)) {
            $mode = $this->normalizeQuizMode($payload['mode'] ?? null, false, true);
            if ($mode === null) {
                return 'Mode quiz tidak valid';
            }
        } else {
            $fallbackLive = array_key_exists('is_live', $payload)
                ? (bool) $payload['is_live']
                : (bool) ($target->is_live ?? false);
            $mode = $this->normalizeQuizMode($target->mode ?? null, $fallbackLive);
        }

        $startsAtInput = array_key_exists('starts_at', $payload)
            ? $payload['starts_at']
            : ($target->starts_at ?? null);
        $startsAt = $this->parseQuizDateTime($startsAtInput);
        if (! $startsAt) {
            if ($startsAtInput !== null && $startsAtInput !== '') {
                return 'Tanggal mulai quiz tidak valid';
            }
            if (array_key_exists('is_active', $payload) && $this->boolValue($payload['is_active'])) {
                return 'Tanggal mulai quiz wajib diisi sebelum quiz dimulai';
            }

            $payload['kelas_id'] = $kelasId;
            $payload['mapel'] = $mapel;
            $payload['mode'] = $mode;
            if ($mode === 'regular') {
                $payload['is_live'] = false;
                $payload['deadline_at'] = null;
                $payload['live_started_at'] = null;
                $payload['duration_minutes'] = null;
            } else {
                $duration = (int) ($payload['duration_minutes'] ?? $target->duration_minutes ?? 60);
                if ($duration < 10) {
                    return 'Durasi quiz ujian minimal 10 menit';
                }
                $payload['is_live'] = true;
                $payload['deadline_at'] = null;
                $payload['live_started_at'] = null;
                $payload['duration_minutes'] = $duration;
            }

            return null;
        }
        if ($hasOngoingSubmission && array_key_exists('starts_at', $payload)) {
            $targetStartsAt = $this->parseQuizDateTime($target->starts_at ?? null);
            if (! $targetStartsAt || ! $targetStartsAt->equalTo($startsAt)) {
                return 'Tanggal mulai tidak boleh diubah saat ada siswa sedang mengerjakan quiz';
            }
        }
        if (array_key_exists('starts_at', $payload) && $startsAt->lt($now)) {
            return 'Tanggal mulai quiz tidak boleh di masa lalu';
        }

        $payload['kelas_id'] = $kelasId;
        $payload['mapel'] = $mapel;
        $payload['starts_at'] = $startsAt;
        $payload['mode'] = $mode;
        $academicYear = AcademicPeriod::normalizeAcademicYear($target->tahun_ajaran ?? null)
            ?: $this->currentAcademicPeriodForTenant($this->currentTenantId)['tahun_ajaran'];

        if ($mode === 'regular') {
            $deadline = $this->parseQuizDateTime($payload['deadline_at'] ?? $target->deadline_at);
            if (! $deadline) {
                return 'Tanggal selesai quiz wajib diisi untuk mode reguler';
            }
            if (! $deadline->gt($startsAt)) {
                return 'Tanggal selesai quiz harus setelah tanggal mulai';
            }
            if (array_key_exists('deadline_at', $payload) && $deadline->lt($now)) {
                return 'Tanggal selesai quiz tidak boleh di masa lalu';
            }
            $periodError = $this->validateQuizTimelineWithinAcademicYear($startsAt, $deadline, $academicYear);
            if ($periodError !== null) {
                return $periodError;
            }

            $payload['deadline_at'] = $deadline;
            $payload['is_live'] = false;
            $payload['is_active'] = true;
            $payload['live_started_at'] = null;
            $payload['duration_minutes'] = null;

            return null;
        }

        $duration = (int) ($payload['duration_minutes'] ?? $target->duration_minutes ?? 0);
        if ($duration < 10) {
            return 'Durasi quiz ujian minimal 10 menit';
        }

        $endAt = $startsAt->copy()->addMinutes($duration);
        if ($endAt->lt($now)) {
            return 'Waktu selesai quiz tidak boleh di masa lalu';
        }
        $periodError = $this->validateQuizTimelineWithinAcademicYear($startsAt, $endAt, $academicYear);
        if ($periodError !== null) {
            return $periodError;
        }

        $payload['duration_minutes'] = $duration;
        $payload['is_live'] = true;
        $payload['is_active'] = true;
        $payload['live_started_at'] = $startsAt;
        $payload['deadline_at'] = $endAt;

        return null;
    }

    private function parseTugasDateTime($value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $value);
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function tugasAvailabilityErrorForSiswa(object $tugas, Carbon $now): ?string
    {
        $mulai = $this->parseTugasDateTime($tugas->mulai ?? null);
        if ($mulai && $now->lt($mulai)) {
            return 'Tugas belum dimulai';
        }

        $deadline = $this->parseTugasDateTime($tugas->deadline ?? null);
        if ($deadline && $now->gt($deadline)) {
            return 'Deadline tugas sudah lewat';
        }

        return null;
    }

    private function isJawabanSudahDinilai(object $jawaban): bool
    {
        if (($jawaban->nilai ?? null) !== null) {
            return true;
        }

        return strtolower((string) ($jawaban->status ?? '')) === 'dinilai';
    }

    private function validateGuruTugasTimelinePayload($payload, bool $requireMulaiAndDeadline): ?string
    {
        if (! is_array($payload)) {
            return 'Payload tugas tidak valid';
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $now = now();

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $hasMulai = array_key_exists('mulai', $row);
            $hasDeadline = array_key_exists('deadline', $row);

            if ($requireMulaiAndDeadline && (! $hasMulai || ! $hasDeadline)) {
                return 'Waktu mulai dan deadline wajib diisi';
            }

            $mulai = null;
            if ($hasMulai) {
                $mulai = $this->parseTugasDateTime($row['mulai'] ?? null);
                if (! $mulai) {
                    return 'Waktu mulai tidak valid';
                }
                if ($mulai->lt($now)) {
                    return 'Waktu mulai tidak boleh di masa lalu';
                }
            }

            $deadline = null;
            if ($hasDeadline) {
                $deadline = $this->parseTugasDateTime($row['deadline'] ?? null);
                if (! $deadline) {
                    return 'Deadline tidak valid';
                }
                if ($deadline->lt($now)) {
                    return 'Deadline tidak boleh di masa lalu';
                }
            }

            if ($mulai && $deadline && ! $deadline->gt($mulai)) {
                return 'Deadline harus setelah waktu mulai';
            }
        }

        return null;
    }

    private function validateGuruTugasUpdatePayload(array $payload, Request $request, string $userId): ?string
    {
        $touchMulai = array_key_exists('mulai', $payload);
        $touchDeadline = array_key_exists('deadline', $payload);

        if (! $touchMulai && ! $touchDeadline) {
            return null;
        }

        $mulaiInput = null;
        if ($touchMulai) {
            $mulaiInput = $this->parseTugasDateTime($payload['mulai'] ?? null);
            if (! $mulaiInput) {
                return 'Waktu mulai tidak valid';
            }
            if ($mulaiInput->lt(now()->startOfMinute())) {
                return 'Waktu mulai tidak boleh di masa lalu';
            }
        }

        $deadlineInput = null;
        if ($touchDeadline) {
            $deadlineInput = $this->parseTugasDateTime($payload['deadline'] ?? null);
            if (! $deadlineInput) {
                return 'Deadline tidak valid';
            }
            if ($deadlineInput->lt(now()->startOfMinute())) {
                return 'Deadline tidak boleh di masa lalu';
            }
        }

        $targetQuery = DB::table('tugas')
            ->where('created_by', $userId);
        $this->applyTenantFilter($targetQuery);
        $this->applyFilters($targetQuery, $request->input('filters', []));

        $targets = $targetQuery->get(['id', 'mulai', 'deadline']);
        foreach ($targets as $target) {
            $mulai = $touchMulai
                ? $mulaiInput
                : $this->parseTugasDateTime($target->mulai ?? null);
            $deadline = $touchDeadline
                ? $deadlineInput
                : $this->parseTugasDateTime($target->deadline ?? null);

            if ($mulai && $deadline && ! $deadline->gt($mulai)) {
                return 'Deadline harus setelah waktu mulai';
            }
        }

        return null;
    }

    private function targetedTugasHasGradedSubmission(Request $request, string $userId): bool
    {
        $targetQuery = DB::table('tugas')
            ->where('created_by', $userId);
        $this->applyTenantFilter($targetQuery);
        $this->applyFilters($targetQuery, $request->input('filters', []));

        $tugasIds = $targetQuery->pluck('id')->filter()->values()->all();
        if (empty($tugasIds)) {
            return false;
        }

        $jawabanQuery = DB::table('tugas_jawaban')
            ->whereIn('tugas_id', $tugasIds)
            ->where(function ($q) {
                $q->whereNotNull('nilai')
                    ->orWhere(DB::raw('lower(coalesce(status, \'\'))'), 'dinilai');
            });
        $this->applyTenantFilter($jawabanQuery);

        return $jawabanQuery->exists();
    }

    private function validateSiswaTugasWritePayload(
        $payload,
        ?string $kelas,
        string $userId,
        bool $isInsert
    ): ?string {
        if (! $kelas || ! is_array($payload)) {
            return 'Tugas tidak diizinkan';
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $tugasIds = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $tugasId = trim((string) ($row['tugas_id'] ?? ''));
            if ($tugasId === '') {
                return 'Tugas tidak diizinkan';
            }

            $tugasIds[] = $tugasId;
        }

        if (empty($tugasIds)) {
            return 'Tugas tidak diizinkan';
        }

        $tugasIds = array_values(array_unique($tugasIds));

        $tugasQuery = DB::table('tugas')
            ->whereIn('id', $tugasIds)
            ->where('kelas', $kelas);
        $this->applyTenantFilter($tugasQuery);
        $tugasRows = $tugasQuery->get(['id', 'kelas', 'mulai', 'deadline']);
        $tugasMap = [];
        foreach ($tugasRows as $tugas) {
            $tugasMap[(string) $tugas->id] = $tugas;
        }

        $existingQuery = DB::table('tugas_jawaban')
            ->where('user_id', $userId)
            ->whereIn('tugas_id', $tugasIds);
        $this->applyTenantFilter($existingQuery);
        $existingRows = $existingQuery->get(['tugas_id', 'nilai', 'status']);
        $existingByTugas = [];
        foreach ($existingRows as $row) {
            $key = (string) $row->tugas_id;
            if (! isset($existingByTugas[$key])) {
                $existingByTugas[$key] = [];
            }
            $existingByTugas[$key][] = $row;
        }

        $now = now();
        foreach ($tugasIds as $tugasId) {
            $tugas = $tugasMap[$tugasId] ?? null;
            if (! $tugas) {
                return 'Tugas tidak diizinkan';
            }

            $availabilityError = $this->tugasAvailabilityErrorForSiswa($tugas, $now);
            if ($availabilityError !== null) {
                return $availabilityError;
            }

            $existingList = $existingByTugas[$tugasId] ?? [];
            foreach ($existingList as $existing) {
                if ($this->isJawabanSudahDinilai($existing)) {
                    return 'Jawaban yang sudah dinilai tidak boleh diubah';
                }
            }

            if ($isInsert && ! empty($existingList)) {
                return 'Jawaban sudah pernah dikirim, gunakan update';
            }
        }

        return null;
    }

    private function validateSiswaTugasMutationTargets(
        Request $request,
        string $userId,
        ?string $kelas
    ): ?string {
        if (! $kelas) {
            return 'Profil kelas tidak valid';
        }

        $targetQuery = DB::table('tugas_jawaban')
            ->where('user_id', $userId);
        $this->applyTenantFilter($targetQuery);
        $this->applyFilters($targetQuery, $request->input('filters', []));
        $targets = $targetQuery->get(['id', 'tugas_id', 'nilai', 'status']);

        if ($targets->isEmpty()) {
            return null;
        }

        $tugasIds = $targets->pluck('tugas_id')->filter()->unique()->values()->all();
        if (empty($tugasIds)) {
            return 'Tugas tidak diizinkan';
        }

        $tugasQuery = DB::table('tugas')
            ->whereIn('id', $tugasIds)
            ->where('kelas', $kelas);
        $this->applyTenantFilter($tugasQuery);
        $tugasRows = $tugasQuery->get(['id', 'kelas', 'mulai', 'deadline']);
        $tugasMap = [];
        foreach ($tugasRows as $tugas) {
            $tugasMap[(string) $tugas->id] = $tugas;
        }

        $now = now();
        foreach ($targets as $row) {
            if ($this->isJawabanSudahDinilai($row)) {
                return 'Jawaban yang sudah dinilai tidak boleh diubah';
            }

            $tugasId = (string) ($row->tugas_id ?? '');
            $tugas = $tugasMap[$tugasId] ?? null;
            if (! $tugas) {
                return 'Tugas tidak diizinkan';
            }

            $availabilityError = $this->tugasAvailabilityErrorForSiswa($tugas, $now);
            if ($availabilityError !== null) {
                return $availabilityError;
            }
        }

        return null;
    }

    private function payloadHasInvalidTugasForSiswa($payload, ?string $kelas): bool
    {
        if (! $kelas || ! is_array($payload)) {
            return true;
        }

        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        $tugasIds = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $tugasId = isset($row['tugas_id']) ? (string) $row['tugas_id'] : '';
            $tugasId = trim($tugasId);
            if ($tugasId === '') {
                return true;
            }

            $tugasIds[] = $tugasId;
        }

        if (empty($tugasIds)) {
            return true;
        }

        $tugasIds = array_values(array_unique($tugasIds));
        $query = DB::table('tugas')
            ->whereIn('id', $tugasIds)
            ->where('kelas', $kelas);

        $this->applyTenantFilter($query);

        $allowed = array_map(
            fn ($id) => (string) $id,
            $query->pluck('id')->filter()->values()->all()
        );
        foreach ($tugasIds as $tugasId) {
            if (! in_array((string) $tugasId, $allowed, true)) {
                return true;
            }
        }

        return false;
    }

    private function sanitizePublicSettingsRows($rows): array
    {
        $allowed = [
            'id',
            'nama_sekolah',
            'logo_url',
            'logo_path',
            'alamat',
            'telepon',
            'email',
            'link_instagram',
            'link_facebook',
            'link_youtube',
            'link_tiktok',
            'tahun_ajaran',
            'semester_aktif',
            'periode_mulai',
            'periode_selesai',
            'registrasi_siswa_aktif',
            'registrasi_guru_aktif',
        ];

        return $this->sanitizeRowsByAllowedFields($rows, $allowed);
    }

    private function sanitizeQuizRows($rows): array
    {
        $out = [];
        foreach ($rows as $row) {
            $item = (array) $row;
            unset($item['access_code_hash']);
            $out[] = $item;
        }

        return $out;
    }

    private function sanitizeProfilesForNonAdmin(
        $rows,
        string $currentUserId,
        string $viewerRole = '',
        array $viewerWaliKelas = []
    ): array {
        if ($currentUserId === '') {
            return [];
        }

        $viewerRole = strtolower(trim($viewerRole));
        $viewerWaliKelas = array_values(array_filter(array_map(
            fn ($kelas) => (string) $kelas,
            $viewerWaliKelas
        )));
        $viewerWaliKelasMap = array_flip($viewerWaliKelas);

        $allowedForOthers = [
            'id',
            'tenant_id',
            'email',
            'nama',
            'role',
            'kelas',
            'jk',
            'usia',
            'photo_url',
            'photo_path',
            'photo_updated_at',
            'nis',
            'agama',
            'jabatan',
            'status',
            'created_at',
            'updated_at',
        ];
        $allowedForOthersMap = array_flip($allowedForOthers);

        $allowedForWaliStudentMap = array_flip(array_merge($allowedForOthers, [
            'telp',
            'alamat',
            'no_hp_siswa',
            'no_hp_wali',
            'tanggal_lahir',
        ]));

        $out = [];
        foreach ($rows as $row) {
            $item = (array) $row;
            $rowUserId = (string) ($item['id'] ?? '');

            if ($rowUserId === $currentUserId) {
                $out[] = (object) $item;

                continue;
            }

            $rowRole = strtolower((string) ($item['role'] ?? ''));
            $rowKelas = (string) ($item['kelas'] ?? '');
            $isWaliViewingOwnedStudent = (
                $viewerRole === 'guru'
                && ! empty($viewerWaliKelasMap)
                && $rowRole === 'siswa'
                && isset($viewerWaliKelasMap[$rowKelas])
            );

            if ($isWaliViewingOwnedStudent) {
                $out[] = (object) array_intersect_key($item, $allowedForWaliStudentMap);

                continue;
            }

            $out[] = (object) array_intersect_key($item, $allowedForOthersMap);
        }

        return $out;
    }

    private function shouldNotifyWhatsAppForTable(string $table): bool
    {
        return in_array($table, [
            'profiles',
            'absensi',
            'tugas_jawaban',
            'quiz_submissions',
            'absensi_eskul',
            'ekskul_anggota',
        ], true);
    }

    private function notifyWhatsAppMutation(
        ?string $tenantId,
        string $table,
        string $action,
        array $beforeRows = [],
        array $afterRows = []
    ): void {
        if (! $tenantId || ! $this->shouldNotifyWhatsAppForTable($table)) {
            return;
        }

        try {
            $this->whatsAppNotificationService->handleTableMutation(
                $tenantId,
                $table,
                $action,
                $this->normalizeNotificationRows($beforeRows),
                $this->normalizeNotificationRows($afterRows)
            );
        } catch (\Throwable $e) {
            // Notifikasi tidak boleh memblokir mutasi database utama.
        }
    }

    private function normalizeNotificationRows(array $rows): array
    {
        return array_values(array_map(fn ($row) => (array) $row, $rows));
    }

    private function sanitizeRowsByAllowedFields($rows, array $allowed): array
    {
        $allowedMap = array_flip($allowed);
        $out = [];

        foreach ($rows as $row) {
            $item = (array) $row;
            $out[] = (object) array_intersect_key($item, $allowedMap);
        }

        return $out;
    }

    private function isNilaiAuditActor(Request $request): bool
    {
        return $this->isAdmin($request) || $this->isGuru($request);
    }

    private function isNilaiFreezeMutationTarget(string $table, string $action, Request $request): bool
    {
        if (! $this->isNilaiAuditActor($request)) {
            return false;
        }

        if (! in_array($action, ['insert', 'update', 'upsert', 'delete'], true)) {
            return false;
        }

        return in_array($table, ['tugas_jawaban', 'quiz_answers', 'quiz_submissions'], true);
    }

    private function queryRowsToArray($query): array
    {
        try {
            return $query
                ->get()
                ->map(fn ($row) => (array) $row)
                ->values()
                ->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    private function fetchTugasJawabanRowsForPayload(array $rows, ?string $tenantId): array
    {
        $ids = [];
        $pairs = [];

        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }

            $id = trim((string) ($row['id'] ?? ''));
            if ($id !== '') {
                $ids[] = $id;
            }

            $userId = trim((string) ($row['user_id'] ?? ''));
            $tugasId = trim((string) ($row['tugas_id'] ?? ''));
            if ($userId !== '' && $tugasId !== '') {
                $pairs[] = [$userId, $tugasId];
            }
        }

        if (empty($ids) && empty($pairs)) {
            return [];
        }

        $query = DB::table('tugas_jawaban');
        if ($tenantId) {
            $query->where('tenant_id', $tenantId);
        }

        $query->where(function ($q) use ($ids, $pairs) {
            if (! empty($ids)) {
                $q->whereIn('id', array_values(array_unique($ids)));
            }

            foreach ($pairs as [$userId, $tugasId]) {
                $q->orWhere(function ($nested) use ($userId, $tugasId) {
                    $nested
                        ->where('user_id', $userId)
                        ->where('tugas_id', $tugasId);
                });
            }
        });

        return $this->queryRowsToArray($query);
    }

    private function queueCriticalChangeApprovalIfNeeded(
        Request $request,
        string $table,
        string $action,
        $payload,
        array $filters,
        array $orders,
        ?int $limit,
        ?int $offset,
        ?string $tenantId
    ) {
        if ($request->attributes->get('approval_exec') === true) {
            return null;
        }

        if (! in_array($action, ['insert', 'update', 'delete', 'upsert'], true)) {
            return null;
        }

        if (! in_array($table, self::CRITICAL_MAKER_CHECKER_TABLES, true)) {
            return null;
        }

        if ($this->isSuperAdmin($request)) {
            return null;
        }

        if ($this->isGuru($request)) {
            return null;
        }

        if (! $this->isAdmin($request)) {
            return null;
        }

        if (! $tenantId) {
            return null;
        }

        $userId = (string) ($request->user()?->id ?? '');
        if ($this->isMakerCheckerBypassUser($tenantId, $userId)) {
            return null;
        }

        if (! $this->isMakerCheckerEnabledForTenant($tenantId)) {
            return null;
        }

        if (! $this->hasTable('approval_requests')) {
            return null;
        }

        $user = $request->user();
        $profile = $this->profile($request);
        $rowEstimate = $this->estimateAffectedRowsFromPayload($payload);
        if ($action === 'delete' && $rowEstimate < 1) {
            $rowEstimate = 1;
        }

        $riskLevel = $this->deriveRiskLevelForApproval($table, $action, $rowEstimate);
        $summary = $this->summarizeApprovalChange($table, $action, $rowEstimate);

        $changePayload = [
            'table' => $table,
            'action' => $action,
            'payload' => $payload,
            'filters' => $filters,
            'order' => $orders,
            'onConflict' => $request->input('onConflict'),
            'limit' => $limit,
            'offset' => $offset,
            'requested_at' => now()->toIso8601String(),
        ];

        $requestId = (string) Str::uuid();
        DB::table('approval_requests')->insert([
            'id' => $requestId,
            'tenant_id' => $tenantId,
            'status' => 'pending',
            'target_table' => $table,
            'target_action' => strtoupper($action),
            'target_record_id' => $this->extractApprovalTargetRecordId($filters, $payload),
            'change_payload' => json_encode($changePayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'change_summary' => $summary,
            'affected_rows_estimate' => max(1, $rowEstimate),
            'risk_level' => $riskLevel,
            'requested_by' => $user?->id ? (string) $user->id : null,
            'requested_by_role' => $profile?->role,
            'requested_at' => now(),
            'request_note' => trim((string) $request->input('approval_note', '')) ?: null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->logAudit(
            $request,
            'approval_requests',
            $requestId,
            'INSERT',
            null,
            [
                'tenant_id' => $tenantId,
                'target_table' => $table,
                'target_action' => strtoupper($action),
                'risk_level' => $riskLevel,
                'affected_rows_estimate' => max(1, $rowEstimate),
            ],
            $tenantId
        );

        return response()->json([
            'data' => [
                'approval_required' => true,
                'approval_id' => $requestId,
                'status' => 'pending',
                'summary' => $summary,
                'risk_level' => $riskLevel,
                'affected_rows_estimate' => max(1, $rowEstimate),
            ],
            'message' => 'Perubahan kritikal masuk antrian maker-checker dan menunggu approval.',
        ], 202);
    }

    private function hasTable(string $table): bool
    {
        try {
            return Schema::hasTable($table);
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function isMakerCheckerEnabledForTenant(string $tenantId): bool
    {
        if (! Schema::hasTable('settings')) {
            return false;
        }

        if (! $this->isSelectableColumn('settings', 'approval_maker_checker_enabled')) {
            return true;
        }

        try {
            $row = DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->first(['approval_maker_checker_enabled']);
            if (! $row) {
                return true;
            }

            return (bool) ($row->approval_maker_checker_enabled ?? true);
        } catch (\Throwable $e) {
            return true;
        }
    }

    private function isMakerCheckerBypassUser(string $tenantId, string $userId): bool
    {
        if ($tenantId === '' || $userId === '') {
            return false;
        }

        if (! $this->isSelectableColumn('settings', 'approval_primary_admin_id')) {
            return false;
        }

        try {
            $row = DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->first(['approval_primary_admin_id']);
            if (! $row) {
                return false;
            }

            $primaryAdminId = strtolower(trim((string) ($row->approval_primary_admin_id ?? '')));
            if ($primaryAdminId === '') {
                return false;
            }

            return $primaryAdminId === strtolower(trim($userId));
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function estimateAffectedRowsFromPayload($payload): int
    {
        if (is_array($payload)) {
            if (array_is_list($payload)) {
                return count($payload);
            }

            return 1;
        }

        return 1;
    }

    private function summarizeApprovalChange(string $table, string $action, int $rows): string
    {
        $actionLabel = strtoupper($action);
        $rowLabel = $rows > 1 ? "{$rows} baris" : '1 baris';

        return "{$actionLabel} pada {$table} ({$rowLabel})";
    }

    private function deriveRiskLevelForApproval(string $table, string $action, int $rows): string
    {
        if (strtolower($action) === 'delete') {
            return 'high';
        }
        if ($table === 'settings') {
            return 'high';
        }
        if ($rows >= 20) {
            return 'high';
        }
        if ($rows >= 5) {
            return 'medium';
        }

        return 'low';
    }

    private function extractApprovalTargetRecordId(array $filters, $payload): ?string
    {
        $filterId = $filters['eq']['id'] ?? null;
        if (is_string($filterId) && trim($filterId) !== '') {
            return trim($filterId);
        }

        if (is_array($payload)) {
            if (array_key_exists('id', $payload) && $payload['id'] !== null) {
                $candidate = trim((string) $payload['id']);
                if ($candidate !== '') {
                    return $candidate;
                }
            }

            if (array_is_list($payload) && isset($payload[0]) && is_array($payload[0]) && isset($payload[0]['id'])) {
                $candidate = trim((string) $payload[0]['id']);
                if ($candidate !== '') {
                    return $candidate;
                }
            }
        }

        return null;
    }

    private function normalizeSettingsGovernancePayload(&$payload): ?string
    {
        if (! is_array($payload)) {
            return null;
        }

        $error = null;

        $this->mapPayload($payload, function ($row) use (&$error) {
            if ($error !== null || ! is_array($row)) {
                return $row;
            }

            // Admin utama tenant hanya boleh diubah dari panel super admin.
            if (array_key_exists('approval_primary_admin_id', $row)) {
                unset($row['approval_primary_admin_id']);
            }

            foreach (self::REMOVED_SETTINGS_POLICY_FIELDS as $field) {
                unset($row[$field]);
            }

            if (array_key_exists('tahun_ajaran', $row)) {
                $year = AcademicPeriod::normalizeAcademicYear($row['tahun_ajaran']);
                if (! $year) {
                    $error = 'Tahun ajaran harus berformat 2025/2026';

                    return $row;
                }
                $row['tahun_ajaran'] = $year;
            }

            if (array_key_exists('semester_aktif', $row)) {
                $semester = AcademicPeriod::normalizeSemester($row['semester_aktif']);
                if (! $semester) {
                    $error = 'Semester aktif harus Ganjil atau Genap';

                    return $row;
                }
                $row['semester_aktif'] = $semester;
            }

            if (array_key_exists('periode_mulai', $row) || array_key_exists('periode_selesai', $row)) {
                if (! array_key_exists('periode_mulai', $row) || ! array_key_exists('periode_selesai', $row)) {
                    $error = 'Tanggal mulai dan selesai periode harus dikirim bersama.';

                    return $row;
                }

                $currentPeriod = $this->currentAcademicPeriodForTenant($this->currentTenantId);
                $year = AcademicPeriod::normalizeAcademicYear($row['tahun_ajaran'] ?? null)
                    ?: ($currentPeriod['tahun_ajaran'] ?? null);
                $semester = AcademicPeriod::normalizeSemester($row['semester_aktif'] ?? null)
                    ?: ($currentPeriod['semester'] ?? null);
                $startsAt = AcademicPeriod::normalizeDate($row['periode_mulai'] ?? null);
                $endsAt = AcademicPeriod::normalizeDate($row['periode_selesai'] ?? null);

                if (! $year || ! $startsAt || ! $endsAt || empty(AcademicPeriod::customMonths($year, $startsAt, $endsAt))) {
                    $error = 'Rentang bulan periode harus berada dalam tahun ajaran aktif dan tanggal mulai tidak boleh melewati tanggal selesai.';

                    return $row;
                }

                $period = AcademicPeriod::make($year, $semester, $startsAt, $endsAt);
                $row['periode_mulai'] = $period['starts_at'];
                $row['periode_selesai'] = $period['ends_at'];
            }

            foreach ([
                'approval_maker_checker_enabled',
                'approval_require_second_approver',
                'anomaly_alert_enabled',
            ] as $boolKey) {
                if (! array_key_exists($boolKey, $row)) {
                    continue;
                }

                $normalizedBool = filter_var($row[$boolKey], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                $row[$boolKey] = $normalizedBool ?? false;
            }

            if (array_key_exists('anomaly_bulk_threshold', $row)) {
                if (! is_numeric($row['anomaly_bulk_threshold'])) {
                    $error = 'Ambang anomali bulk harus berupa angka';

                    return $row;
                }

                $threshold = (int) $row['anomaly_bulk_threshold'];
                if ($threshold < 5 || $threshold > 1000) {
                    $error = 'Ambang anomali bulk harus di antara 5 sampai 1000';

                    return $row;
                }

                $row['anomaly_bulk_threshold'] = $threshold;
            }

            return $row;
        });

        return $error;
    }

    private function payloadHasInvalidScore($payload): bool
    {
        if (! is_array($payload)) {
            return false;
        }
        $rows = $this->isAssoc($payload) ? [$payload] : $payload;
        foreach ($rows as $row) {
            if (! is_array($row)) {
                continue;
            }
            if (! array_key_exists('score', $row)) {
                continue;
            }
            $value = $row['score'];
            if ($value === null || $value === '') {
                continue;
            }
            if (! is_numeric($value)) {
                return true;
            }
            $score = (int) $value;
            if ($score < 0 || $score > 100) {
                return true;
            }
        }

        return false;
    }
}
