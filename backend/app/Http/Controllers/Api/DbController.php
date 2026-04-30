<?php

namespace App\Http\Controllers\Api;

use App\Services\WhatsApp\WhatsAppNotificationService;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
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

    private const MAX_DB_FILTER_FIELDS = 40;

    private const MAX_DB_ORDER_FIELDS = 8;

    private const MAX_DB_PAYLOAD_ROWS = 500;

    private const MAX_DB_STRING_VALUE_LENGTH = 20000;

    public function __construct(
        private readonly WhatsAppNotificationService $whatsAppNotificationService
    ) {}

    private array $allowedTables = [
        'settings',
        'profiles',
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
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'absensi_rfid_settings',
        'absensi_eskul',
        'absensi_scan_temp',
        'rfid_scans',
        'jam_kosong',
        'tugas',
        'tugas_jawaban',
        'certificates',
        'templat_sertifikat_publik',
        'printed_cards',
        'allowed_registrations',
        'registration_otps',
        'admin_users',
        'audit_log',
        'anggota_eksku1',
        'anggota_ekskul',
        'quizzes',
        'quiz_questions',
        'quiz_options',
        'quiz_submissions',
        'quiz_answers',
        'quiz_violation_logs',
        'user_presence',
        'import_siswa_histories',
        'import_siswa_history_items',
    ];

    private array $tenantScopedTables = [
        'settings',
        'profiles',
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
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'absensi_rfid_settings',
        'absensi_eskul',
        'absensi_scan_temp',
        'rfid_scans',
        'jam_kosong',
        'tugas',
        'tugas_jawaban',
        'certificates',
        'templat_sertifikat_publik',
        'printed_cards',
        'allowed_registrations',
        'registration_otps',
        'admin_users',
        'audit_log',
        'anggota_eksku1',
        'anggota_ekskul',
        'quizzes',
        'quiz_questions',
        'quiz_options',
        'quiz_submissions',
        'quiz_answers',
        'quiz_violation_logs',
        'user_presence',
        'import_siswa_histories',
        'import_siswa_history_items',
    ];

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

    private array $knownJsonColumns = [
        'audit_log' => ['old_data', 'new_data'],
        'templat_sertifikat_publik' => ['fields'],
        'quiz_violation_logs' => ['event_meta'],
    ];

    public function handle(Request $request)
    {
        $table = $request->input('table');
        $action = $request->input('action', 'select');

        if (! in_array($table, $this->allowedTables, true)) {
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
        $tenantScoped = in_array($table, $this->tenantScopedTables, true);

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
            $countRequested = $request->input('count');
            $head = (bool) $request->input('head', false);
            $count = null;

            if ($countRequested) {
                $countQuery = clone $query;
                $count = $countQuery->count();
            }

            if ($limit !== null) {
                $query->limit((int) $limit);
            }
            if ($offset !== null) {
                $query->offset((int) $offset);
            }

            $columns = $request->input('columns', '*');
            if ($columns && $columns !== '*') {
                $parsed = $this->parseColumns($table, $columns);
                if (! empty($parsed)) {
                    $query->select($parsed);
                }
            }

            $data = $head ? [] : $query->get();

            if (! $head && $table === 'settings' && ! $user) {
                $data = $this->sanitizePublicSettingsRows($data);
            }

            if (! $head && $table === 'profiles' && ! $this->isAdmin($request)) {
                $viewerRole = strtolower((string) ($profile?->role ?? ''));
                $waliKelas = [];
                if ($viewerRole === 'guru' && $user?->id) {
                    $waliKelas = $this->guruWaliKelasIds((string) $user->id);
                }
                $data = $this->sanitizeProfilesForNonAdmin(
                    $data,
                    (string) ($user?->id ?? ''),
                    $viewerRole,
                    $waliKelas
                );
            }

            if (! $head && $table === 'quizzes') {
                $data = $this->sanitizeQuizRows($data);
            }

            return response()->json(['data' => $data, 'count' => $count]);
        }

        if ($action === 'insert') {
            $rows = $this->normalizeRows($payload);
            if (empty($rows)) {
                return $this->deny('Payload kosong', 422);
            }
            if ($tenantScoped && $tenantId) {
                $rows = $this->attachTenantRows($rows, $tenantId);
            }
            try {
                $rows = $this->normalizeJsonRowsForTable($table, $rows);
            } catch (\InvalidArgumentException $e) {
                return $this->deny($e->getMessage(), 422);
            }
            $rows = $this->filterRowsToExistingColumns($table, $rows);
            if (empty($rows)) {
                return $this->deny('Payload tidak memiliki kolom yang valid', 422);
            }
            if ($table === 'settings') {
                $saved = $this->saveSettingsSingletonRows($rows, $tenantId, $tenantScoped);

                return response()->json(['data' => $saved]);
            }
            if ($table === 'absensi_rfid_settings') {
                $singletonTenantId = $tenantId ?: (string) ($rows[0]['tenant_id'] ?? '');
                if ($singletonTenantId === '') {
                    return $this->deny('Tenant tidak valid', 400);
                }
                $saved = $this->saveTenantSingletonRows($table, $rows, $singletonTenantId);

                return response()->json(['data' => $saved]);
            }

            $beforeRows = [];
            $shouldAuditNilai = $table === 'tugas_jawaban' && $this->isNilaiAuditActor($request);
            if ($shouldAuditNilai) {
                $beforeRows = $this->fetchTugasJawabanRowsForPayload($rows, $tenantId);
            }

            DB::table($table)->insert($rows);

            $this->notifyWhatsAppMutation($tenantId, $table, 'insert', [], $rows);

            if ($shouldAuditNilai) {
                $afterRows = $this->fetchTugasJawabanRowsForPayload($rows, $tenantId);
                $this->logAudit(
                    $request,
                    'tugas_jawaban',
                    'bulk',
                    'INSERT',
                    $beforeRows,
                    $afterRows,
                    $tenantId
                );
            }

            return response()->json(['data' => $rows]);
        }

        if ($action === 'update') {
            if (! is_array($payload) || empty($payload)) {
                return $this->deny('Payload tidak valid', 422);
            }

            $beforeMutationRows = $this->shouldNotifyWhatsAppForTable($table)
                ? $this->queryRowsToArray(clone $query)
                : [];
            $beforeRows = [];
            $shouldAuditNilai = $table === 'tugas_jawaban' && $this->isNilaiAuditActor($request);
            if ($shouldAuditNilai) {
                $beforeRows = $this->queryRowsToArray(clone $query);
            }

            if ($table === 'profiles' && array_key_exists('tanggal_lahir', $payload)) {
                $payload['usia'] = $this->calculateAgeFromBirthDate($payload['tanggal_lahir']);
            }

            if ($tenantScoped) {
                unset($payload['tenant_id']);
            }

            try {
                $payload = $this->normalizeJsonRowForTable($table, $payload);
            } catch (\InvalidArgumentException $e) {
                return $this->deny($e->getMessage(), 422);
            }
            $payload = $this->filterPayloadToExistingColumns($table, $payload);
            if (empty($payload)) {
                return $this->deny('Payload tidak memiliki kolom yang valid', 422);
            }

            $profileIdForEmailSync = null;
            $emailForSync = null;
            if (
                $table === 'profiles'
                && $this->isAdmin($request)
                && array_key_exists('email', $payload)
                && is_string($payload['email'])
            ) {
                $candidateEmail = strtolower(trim($payload['email']));
                if (filter_var($candidateEmail, FILTER_VALIDATE_EMAIL)) {
                    $profileIdFromFilter = $filters['eq']['id'] ?? null;
                    if (is_string($profileIdFromFilter) && $profileIdFromFilter !== '') {
                        $profileIdForEmailSync = $profileIdFromFilter;
                        $emailForSync = $candidateEmail;
                    }
                }
            }

            try {
                $updated = DB::transaction(function () use (
                    $query,
                    $payload,
                    $profileIdForEmailSync,
                    $emailForSync
                ) {
                    $updatedCount = $query->update($payload);

                    if ($updatedCount && $profileIdForEmailSync && $emailForSync) {
                        DB::table('users')
                            ->where('id', $profileIdForEmailSync)
                            ->update([
                                'email' => $emailForSync,
                                'updated_at' => now(),
                            ]);
                    }

                    return $updatedCount;
                });
            } catch (QueryException $e) {
                $message = strtolower($e->getMessage());
                if (str_contains($message, 'duplicate') || str_contains($message, 'unique')) {
                    return $this->deny('Email sudah digunakan akun lain', 409);
                }
                throw $e;
            }

            if ($updated > 0) {
                $afterMutationRows = $this->shouldNotifyWhatsAppForTable($table)
                    ? $this->queryRowsToArray(clone $query)
                    : [];
                $this->notifyWhatsAppMutation($tenantId, $table, 'update', $beforeMutationRows, $afterMutationRows);
            }

            if ($shouldAuditNilai && $updated > 0) {
                $afterRows = $this->queryRowsToArray(clone $query);
                $this->logAudit(
                    $request,
                    'tugas_jawaban',
                    'bulk',
                    'UPDATE',
                    $beforeRows,
                    $afterRows,
                    $tenantId
                );
            }

            return response()->json(['data' => $updated]);
        }

        if ($action === 'delete') {
            $beforeMutationRows = $this->shouldNotifyWhatsAppForTable($table)
                ? $this->queryRowsToArray(clone $query)
                : [];
            $beforeRows = [];
            $shouldAuditNilai = $table === 'tugas_jawaban' && $this->isNilaiAuditActor($request);
            if ($shouldAuditNilai) {
                $beforeRows = $this->queryRowsToArray(clone $query);
            }

            if ($table === 'profiles' && $this->isAdmin($request)) {
                $updated = $query->update([
                    'status' => 'nonaktif',
                    'alasan_nonaktif' => 'Dinonaktifkan oleh admin',
                    'disabled_at' => now(),
                    'deleted_at' => now(),
                    'updated_at' => now(),
                ]);

                if ($shouldAuditNilai && $updated > 0) {
                    $this->logAudit(
                        $request,
                        'tugas_jawaban',
                        'bulk',
                        'DELETE',
                        $beforeRows,
                        [],
                        $tenantId
                    );
                }

                if ($updated > 0) {
                    $afterMutationRows = $this->queryRowsToArray(clone $query);
                    $this->notifyWhatsAppMutation($tenantId, $table, 'delete', $beforeMutationRows, $afterMutationRows);
                }

                return response()->json(['data' => $updated]);
            }

            $deleted = $query->delete();

            if ($deleted > 0) {
                $this->notifyWhatsAppMutation($tenantId, $table, 'delete', $beforeMutationRows, []);
            }

            if ($shouldAuditNilai && $deleted > 0) {
                $this->logAudit(
                    $request,
                    'tugas_jawaban',
                    'bulk',
                    'DELETE',
                    $beforeRows,
                    [],
                    $tenantId
                );
            }

            return response()->json(['data' => $deleted]);
        }

        if ($action === 'upsert') {
            $rows = $this->normalizeRows($payload);
            if (empty($rows)) {
                return $this->deny('Payload kosong', 422);
            }
            if ($tenantScoped && $tenantId) {
                $rows = $this->attachTenantRows($rows, $tenantId);
            }
            try {
                $rows = $this->normalizeJsonRowsForTable($table, $rows);
            } catch (\InvalidArgumentException $e) {
                return $this->deny($e->getMessage(), 422);
            }
            $rows = $this->filterRowsToExistingColumns($table, $rows);
            if (empty($rows)) {
                return $this->deny('Payload tidak memiliki kolom yang valid', 422);
            }

            $beforeRows = [];
            $shouldAuditNilai = $table === 'tugas_jawaban' && $this->isNilaiAuditActor($request);
            if ($shouldAuditNilai) {
                $beforeRows = $this->fetchTugasJawabanRowsForPayload($rows, $tenantId);
            }

            if ($table === 'settings') {
                $saved = $this->saveSettingsSingletonRows($rows, $tenantId, $tenantScoped);

                return response()->json(['data' => $saved]);
            }
            if ($table === 'absensi_rfid_settings') {
                $singletonTenantId = $tenantId ?: (string) ($rows[0]['tenant_id'] ?? '');
                if ($singletonTenantId === '') {
                    return $this->deny('Tenant tidak valid', 400);
                }
                $saved = $this->saveTenantSingletonRows($table, $rows, $singletonTenantId);

                return response()->json(['data' => $saved]);
            }

            $onConflict = $request->input('onConflict');
            if (is_string($onConflict) && $onConflict !== '') {
                $uniqueBy = array_values(array_filter(array_map('trim', explode(',', $onConflict))));
            } else {
                $uniqueBy = [];
            }
            if (! empty($uniqueBy)) {
                $uniqueBy = array_values(array_filter(
                    $uniqueBy,
                    fn ($column) => $this->isSelectableColumn($table, (string) $column)
                ));
            }

            if (
                in_array($table, ['absensi', 'absensi_settings'], true) &&
                $tenantId &&
                Schema::hasColumn($table, 'tenant_id')
            ) {
                $uniqueBy = array_values(array_unique(array_merge(['tenant_id'], $uniqueBy)));
            }

            if ($table === 'settings' && empty($uniqueBy)) {
                $existingQuery = DB::table('settings')->orderBy('id');
                if ($tenantScoped && $tenantId) {
                    $existingQuery->where('tenant_id', $tenantId);
                }
                $existing = $existingQuery->first();
                if ($existing && isset($rows[0]['id'])) {
                    $updateQuery = DB::table('settings')->where('id', $rows[0]['id']);
                    if ($tenantScoped && $tenantId) {
                        $updateQuery->where('tenant_id', $tenantId);
                    }
                    $updateQuery->update($rows[0]);

                    return response()->json(['data' => $rows]);
                }
            }

            if (empty($uniqueBy)) {
                // Fallback: try to use id if present
                if (isset($rows[0]['id'])) {
                    $uniqueBy = ['id'];
                } else {
                    DB::table($table)->insert($rows);

                    $this->notifyWhatsAppMutation($tenantId, $table, 'upsert', [], $rows);

                    if ($shouldAuditNilai) {
                        $afterRows = $this->fetchTugasJawabanRowsForPayload($rows, $tenantId);
                        $this->logAudit(
                            $request,
                            'tugas_jawaban',
                            'bulk',
                            'UPDATE',
                            $beforeRows,
                            $afterRows,
                            $tenantId
                        );
                    }

                    return response()->json(['data' => $rows]);
                }
            }

            $updateColumns = array_keys($rows[0]);
            if (in_array($table, ['absensi', 'absensi_settings'], true) && ! empty($uniqueBy)) {
                $resolved = [];
                try {
                    DB::table($table)->upsert($rows, $uniqueBy, $updateColumns);
                    $resolved = $this->fetchRowsByKeys($table, $rows, $uniqueBy, $tenantId);
                } catch (\Throwable $e) {
                    $message = strtolower($e->getMessage() ?? '');
                    if (str_contains($message, 'on conflict') || str_contains($message, 'unique')) {
                        // Fallback manual upsert jika unique index belum ada.
                        $resolved = $this->manualUpsertByKeys($table, $rows, $uniqueBy, $tenantId);
                    } else {
                        throw $e;
                    }
                }

                $this->notifyWhatsAppMutation($tenantId, $table, 'upsert', [], $resolved);

                return response()->json(['data' => $resolved]);
            }

            DB::table($table)->upsert($rows, $uniqueBy, $updateColumns);

            $this->notifyWhatsAppMutation($tenantId, $table, 'upsert', [], $rows);

            if ($shouldAuditNilai) {
                $afterRows = $this->fetchTugasJawabanRowsForPayload($rows, $tenantId);
                $this->logAudit(
                    $request,
                    'tugas_jawaban',
                    'bulk',
                    'UPDATE',
                    $beforeRows,
                    $afterRows,
                    $tenantId
                );
            }

            return response()->json(['data' => $rows]);
        }

        return $this->deny('Aksi tidak dikenali', 400);
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

            $normalizeError = $this->normalizeSettingsGovernancePayload($payload, $userId);
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

                        $ekskulIds = $this->guruEskulIds($userId);
                        if (! empty($ekskulIds)) {
                            $q->orWhere(function ($q2) use ($ekskulIds) {
                                $q2->where('role', 'siswa')
                                    ->whereIn('id', function ($sub) use ($ekskulIds) {
                                        $sub->select('user_id')
                                            ->from('ekskul_anggota')
                                            ->whereIn('ekskul_id', $ekskulIds);
                                        $this->applyTenantFilter($sub);
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
                    $query->where('created_by', $userId);

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
                    $query->where('created_by', $userId);
                    $this->mapPayload($payload, function ($row) use ($userId) {
                        if (! isset($row['created_by'])) {
                            $row['created_by'] = $userId;
                        }

                        return $row;
                    });

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
                        $q->select('id')->from('tugas')->where('created_by', $userId);
                        if (! empty($wali)) {
                            $q->orWhereIn('kelas', $wali);
                        }
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

    private function validateDbRequestShape(Request $request): ?string
    {
        $table = (string) $request->input('table', '');
        $columns = $request->input('columns');
        if ($columns !== null && ! is_string($columns)) {
            return 'Format columns tidak valid';
        }
        if (is_string($columns) && strlen($columns) > 4000) {
            return 'Panjang columns melebihi batas';
        }

        $filters = $request->input('filters', []);
        if (! is_array($filters)) {
            return 'Format filters tidak valid';
        }

        foreach (['eq', 'neq', 'is', 'gt', 'gte', 'lt', 'lte', 'in'] as $op) {
            if (! isset($filters[$op])) {
                continue;
            }
            if (! is_array($filters[$op])) {
                return "Format filters.{$op} tidak valid";
            }
            if (count($filters[$op]) > self::MAX_DB_FILTER_FIELDS) {
                return "Jumlah filters.{$op} melebihi batas";
            }

            foreach ($filters[$op] as $field => $value) {
                $column = is_string($field) ? $this->sanitizeIdentifier($field) : null;
                if ($column === null) {
                    return 'Nama kolom filter tidak valid';
                }
                if (! $this->isSelectableColumn($table, $column)) {
                    return 'Kolom filter tidak diizinkan';
                }
                if (! $this->isReasonableDbValue($value, 0)) {
                    return 'Nilai filter tidak valid';
                }
            }
        }

        $order = $request->input('order', []);
        if ($order !== null && ! is_array($order)) {
            return 'Format order tidak valid';
        }
        $orderItems = is_array($order) && isset($order['field']) ? [$order] : (is_array($order) ? $order : []);
        if (count($orderItems) > self::MAX_DB_ORDER_FIELDS) {
            return 'Jumlah order melebihi batas';
        }

        foreach ($orderItems as $item) {
            if (! is_array($item)) {
                return 'Format item order tidak valid';
            }
            $field = (string) ($item['field'] ?? '');
            $column = $this->sanitizeIdentifier($field);
            if ($field === '' || $column === null) {
                return 'Kolom order tidak valid';
            }
            if (! $this->isSelectableColumn($table, $column)) {
                return 'Kolom order tidak diizinkan';
            }
        }

        $limit = $request->input('limit');
        if ($limit !== null && (! is_numeric($limit) || (int) $limit < 0)) {
            return 'Nilai limit tidak valid';
        }

        $offset = $request->input('offset');
        if ($offset !== null && (! is_numeric($offset) || (int) $offset < 0)) {
            return 'Nilai offset tidak valid';
        }

        $action = strtolower((string) $request->input('action', 'select'));
        if (in_array($action, ['insert', 'upsert'], true)) {
            $payload = $request->input('payload');
            if ($payload === null) {
                return null;
            }

            if (is_array($payload) && array_is_list($payload) && count($payload) > self::MAX_DB_PAYLOAD_ROWS) {
                return 'Jumlah payload melebihi batas';
            }

            if (! $this->isReasonableDbValue($payload, 0)) {
                return 'Payload tidak valid';
            }
        }

        if ($action === 'update') {
            $payload = $request->input('payload');
            if ($payload !== null && (! is_array($payload) || ! $this->isReasonableDbValue($payload, 0))) {
                return 'Payload update tidak valid';
            }
        }

        return null;
    }

    private function isReasonableDbValue($value, int $depth): bool
    {
        if ($depth > 4) {
            return false;
        }

        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) {
            return true;
        }

        if (is_string($value)) {
            return strlen($value) <= self::MAX_DB_STRING_VALUE_LENGTH;
        }

        if (is_array($value)) {
            if (count($value) > 500) {
                return false;
            }

            foreach ($value as $key => $item) {
                if (is_string($key) && strlen($key) > 120) {
                    return false;
                }
                if (! $this->isReasonableDbValue($item, $depth + 1)) {
                    return false;
                }
            }

            return true;
        }

        return false;
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

    private function saveTenantSingletonRows(string $table, array $rows, string $tenantId): array
    {
        $results = [];
        $hasCreatedAt = Schema::hasColumn($table, 'created_at');
        $hasUpdatedAt = Schema::hasColumn($table, 'updated_at');
        $hasId = Schema::hasColumn($table, 'id');

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
        $hasCreatedAt = Schema::hasColumn($table, 'created_at');
        $hasUpdatedAt = Schema::hasColumn($table, 'updated_at');
        $hasTenantId = Schema::hasColumn($table, 'tenant_id');

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
        $hasTenantColumn = $tenantId && Schema::hasColumn($table, 'tenant_id');

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
        $hasTenantColumn = $tenantId && Schema::hasColumn($table, 'tenant_id');

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

    private function guruKelasIds(string $userId): array
    {
        if (isset($this->guruKelasCache[$userId])) {
            return $this->guruKelasCache[$userId];
        }

        $kelasQuery = DB::table('jadwal')->where('guru_id', $userId);
        $this->applyTenantFilter($kelasQuery);
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

        $ekskulIds = array_values(array_unique($ekskulIds));
        $hasDeadlineColumn = Schema::hasColumn('ekskul', 'registration_deadline_at');

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

        $now = now();
        foreach ($ekskulIds as $ekskulId) {
            $ekskul = $ekskulMap[$ekskulId] ?? null;
            if (! $ekskul) {
                return 'Ekstrakurikuler tidak ditemukan';
            }

            if ($hasDeadlineColumn) {
                $deadline = $this->parseEskulDateTime($ekskul->registration_deadline_at ?? null);
                if ($deadline && $now->gt($deadline)) {
                    return 'Pendaftaran ekstrakurikuler sudah ditutup';
                }
            }
        }

        $existingMembershipQuery = DB::table('ekskul_anggota')->where('user_id', $userId);
        $this->applyTenantFilter($existingMembershipQuery);
        $existingIds = array_map(
            fn ($id) => (string) $id,
            $existingMembershipQuery->pluck('ekskul_id')->filter()->values()->all()
        );
        $totalIds = array_values(array_unique(array_merge($existingIds, $ekskulIds)));

        if (count($totalIds) > 3) {
            return 'Maksimal 3 ekstrakurikuler yang bisa diikuti';
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
        $this->applyFilters($targetQuery, $request->input('filters', []));
        $targets = $targetQuery->get(['ekskul_id']);

        if ($targets->isEmpty()) {
            return null;
        }

        if (! Schema::hasColumn('ekskul', 'registration_deadline_at')) {
            return null;
        }

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
        $ekskulRows = $ekskulQuery->get(['id', 'registration_deadline_at']);
        $ekskulMap = [];
        foreach ($ekskulRows as $row) {
            $ekskulMap[(string) ($row->id ?? '')] = $row;
        }

        $now = now();
        foreach ($ekskulIds as $ekskulId) {
            $ekskul = $ekskulMap[$ekskulId] ?? null;
            if (! $ekskul) {
                return 'Ekstrakurikuler tidak ditemukan';
            }

            $deadline = $this->parseEskulDateTime($ekskul->registration_deadline_at ?? null);
            if ($deadline && $now->gt($deadline)) {
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
            'bobot_tugas_pr' => ['min' => 20, 'max' => 40, 'label' => 'Bobot Tugas/PR'],
            'bobot_quiz_reguler' => ['min' => 10, 'max' => 30, 'label' => 'Bobot Quiz Reguler'],
            'bobot_quiz_uts' => ['min' => 20, 'max' => 30, 'label' => 'Bobot Quiz UTS'],
            'bobot_quiz_uas' => ['min' => 30, 'max' => 40, 'label' => 'Bobot Quiz UAS'],
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
                if (abs($total - 100) > 0.01) {
                    $error = 'Total bobot Tugas/PR + Quiz Reguler + Quiz UTS + Quiz UAS harus tepat 100%';

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

        $jadwalQuery = DB::table('jadwal')
            ->where('guru_id', $guruId)
            ->whereNotNull('mapel');
        $this->applyTenantFilter($jadwalQuery);

        $lookup = [];
        foreach ($jadwalQuery->pluck('mapel')->all() as $mapel) {
            $normalized = strtolower(trim((string) $mapel));
            if ($normalized !== '') {
                $lookup[$normalized] = true;
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
            return 'Anda belum memiliki mapel di jadwal mengajar, sehingga bobot mapel belum bisa disimpan';
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

        $jadwalQuery = DB::table('jadwal')
            ->where('guru_id', $guruId)
            ->where('kelas_id', $kelasId);
        $this->applyTenantFilter($jadwalQuery);
        $mapelRows = $jadwalQuery->pluck('mapel')->filter()->all();

        foreach ($mapelRows as $mapelRow) {
            if (strtolower(trim((string) $mapelRow)) === $mapelNeedle) {
                return true;
            }
        }

        return false;
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

                $normalized['is_live'] = true;
                $normalized['is_active'] = true;
                $normalized['live_started_at'] = $startsAt;
                $normalized['duration_minutes'] = $duration;
                $normalized['deadline_at'] = $startsAt->copy()->addMinutes($duration);
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

        if (! $touchOwnedTarget && ! $touchTimeline) {
            return null;
        }

        $targetQuery = DB::table('quizzes')
            ->where('guru_id', $userId);
        $this->applyTenantFilter($targetQuery);
        $this->applyFilters($targetQuery, $request->input('filters', []));

        $targets = $targetQuery->get([
            'id',
            'kelas_id',
            'mapel',
            'starts_at',
            'deadline_at',
            'mode',
            'is_live',
            'duration_minutes',
        ]);

        if ($targets->isEmpty()) {
            return null;
        }

        if ($targets->count() > 1) {
            return 'Update data quiz harus per quiz (satu per satu)';
        }

        $target = $targets->first();
        $now = now()->startOfMinute();

        $kelasId = trim((string) ($payload['kelas_id'] ?? $target->kelas_id ?? ''));
        $mapel = trim((string) ($payload['mapel'] ?? $target->mapel ?? ''));
        if ($kelasId === '' || $mapel === '') {
            return 'Kelas dan mata pelajaran quiz wajib diisi';
        }
        if (! $this->guruCanTeachMapelInKelas($userId, $kelasId, $mapel)) {
            return 'Kelas dan mapel quiz harus sesuai yang diampu guru';
        }

        $startsAt = $this->parseQuizDateTime($payload['starts_at'] ?? $target->starts_at);
        if (! $startsAt) {
            return 'Tanggal mulai quiz tidak valid';
        }
        if (array_key_exists('starts_at', $payload) && $startsAt->lt($now)) {
            return 'Tanggal mulai quiz tidak boleh di masa lalu';
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

        $payload['kelas_id'] = $kelasId;
        $payload['mapel'] = $mapel;
        $payload['starts_at'] = $startsAt;
        $payload['mode'] = $mode;

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

        $payload['duration_minutes'] = $duration;
        $payload['is_live'] = true;
        $payload['is_active'] = true;
        $payload['live_started_at'] = $startsAt;
        $payload['deadline_at'] = $startsAt->copy()->addMinutes($duration);

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

        if (! Schema::hasColumn('settings', 'approval_maker_checker_enabled')) {
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

        if (! Schema::hasTable('settings') || ! Schema::hasColumn('settings', 'approval_primary_admin_id')) {
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

    private function normalizeSettingsGovernancePayload(&$payload, ?string $userId): ?string
    {
        if (! is_array($payload)) {
            return null;
        }

        $error = null;
        $now = now();

        $this->mapPayload($payload, function ($row) use (&$error, $userId, $now) {
            if ($error !== null || ! is_array($row)) {
                return $row;
            }

            $touchRankingPolicy = false;
            $touchFreezePolicy = false;

            // Admin utama tenant hanya boleh diubah dari panel super admin.
            if (array_key_exists('approval_primary_admin_id', $row)) {
                unset($row['approval_primary_admin_id']);
            }

            $weightKeys = [
                'ranking_weight_tugas',
                'ranking_weight_quiz',
                'ranking_weight_absensi',
            ];
            $weightValues = [];
            foreach ($weightKeys as $key) {
                if (! array_key_exists($key, $row)) {
                    continue;
                }

                $touchRankingPolicy = true;
                $raw = $row[$key];
                if ($raw === '' || $raw === null) {
                    $row[$key] = 0;
                    $weightValues[$key] = 0.0;

                    continue;
                }
                if (! is_numeric($raw)) {
                    $error = 'Bobot ranking harus berupa angka';

                    return $row;
                }

                $weight = round((float) $raw, 2);
                if ($weight < 0) {
                    $error = 'Bobot ranking tidak boleh negatif';

                    return $row;
                }

                $row[$key] = $weight;
                $weightValues[$key] = $weight;
            }

            if (count($weightValues) === count($weightKeys)) {
                $total = array_sum($weightValues);
                if (abs($total - 100) > 0.01) {
                    $error = 'Total bobot tugas + quiz + absensi harus tepat 100';

                    return $row;
                }
            }

            if (array_key_exists('ranking_tiebreak_order', $row)) {
                $touchRankingPolicy = true;
                $normalizedTieBreak = $this->normalizeSettingsTieBreakOrder($row['ranking_tiebreak_order']);
                if ($normalizedTieBreak === null) {
                    $error = 'Format urutan tie-break ranking tidak valid';

                    return $row;
                }
                $row['ranking_tiebreak_order'] = json_encode(
                    $normalizedTieBreak,
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
                );
            }

            if (array_key_exists('ranking_core_mapel', $row)) {
                $touchRankingPolicy = true;
                $normalizedCoreMapel = $this->normalizeSettingsMapelList($row['ranking_core_mapel']);
                if ($normalizedCoreMapel === null) {
                    $error = 'Format mapel inti tidak valid';

                    return $row;
                }
                $row['ranking_core_mapel'] = json_encode(
                    $normalizedCoreMapel,
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
                );
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

            foreach (['nilai_freeze_enabled', 'nilai_freeze_start', 'nilai_freeze_end', 'nilai_freeze_reason'] as $key) {
                if (array_key_exists($key, $row)) {
                    $touchFreezePolicy = true;
                }
            }

            if (array_key_exists('nilai_freeze_enabled', $row)) {
                $row['nilai_freeze_enabled'] = filter_var(
                    $row['nilai_freeze_enabled'],
                    FILTER_VALIDATE_BOOLEAN,
                    FILTER_NULL_ON_FAILURE
                );
                if ($row['nilai_freeze_enabled'] === null) {
                    $row['nilai_freeze_enabled'] = false;
                }
            }

            if (array_key_exists('nilai_freeze_start', $row)) {
                if ($row['nilai_freeze_start'] === '' || $row['nilai_freeze_start'] === null) {
                    $row['nilai_freeze_start'] = null;
                } elseif (! $this->isValidDateTimeValue($row['nilai_freeze_start'])) {
                    $error = 'Tanggal mulai freeze nilai tidak valid';

                    return $row;
                }
            }

            if (array_key_exists('nilai_freeze_end', $row)) {
                if ($row['nilai_freeze_end'] === '' || $row['nilai_freeze_end'] === null) {
                    $row['nilai_freeze_end'] = null;
                } elseif (! $this->isValidDateTimeValue($row['nilai_freeze_end'])) {
                    $error = 'Tanggal akhir freeze nilai tidak valid';

                    return $row;
                }
            }

            if (
                array_key_exists('nilai_freeze_start', $row)
                && array_key_exists('nilai_freeze_end', $row)
                && $row['nilai_freeze_start']
                && $row['nilai_freeze_end']
            ) {
                try {
                    $start = Carbon::parse((string) $row['nilai_freeze_start']);
                    $end = Carbon::parse((string) $row['nilai_freeze_end']);
                    if ($start->gt($end)) {
                        $error = 'Tanggal akhir freeze nilai harus setelah tanggal mulai';

                        return $row;
                    }
                } catch (\Throwable $e) {
                    $error = 'Rentang tanggal freeze nilai tidak valid';

                    return $row;
                }
            }

            if (array_key_exists('nilai_freeze_reason', $row)) {
                $reason = trim((string) ($row['nilai_freeze_reason'] ?? ''));
                $row['nilai_freeze_reason'] = $reason === '' ? null : Str::limit($reason, 500, '');
            }

            if ($touchRankingPolicy) {
                $row['ranking_policy_updated_at'] = $now;
            }

            if ($touchFreezePolicy) {
                $row['nilai_freeze_updated_at'] = $now;
                $row['nilai_freeze_updated_by'] = $userId ?: null;
            }

            return $row;
        });

        return $error;
    }

    private function isValidDateTimeValue($value): bool
    {
        try {
            Carbon::parse((string) $value);

            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function normalizeSettingsTieBreakOrder($value): ?array
    {
        $defaultOrder = ['nilai_akhir', 'mapel_inti', 'absensi', 'nama'];
        $normalized = [];

        $source = $value;
        if (is_string($source)) {
            $trimmed = trim($source);
            if ($trimmed === '') {
                return $defaultOrder;
            }

            $decoded = null;
            if (str_starts_with($trimmed, '[')) {
                $decoded = json_decode($trimmed, true);
            }

            if (is_array($decoded)) {
                $source = $decoded;
            } else {
                $source = preg_split('/[,;\\n\\r]+/', $trimmed) ?: [];
            }
        }

        if (! is_array($source)) {
            return null;
        }

        foreach ($source as $item) {
            $token = strtolower(trim((string) $item));
            if ($token === '') {
                continue;
            }

            $mapped = match ($token) {
                'nilai_akhir', 'nilaiakhir', 'final_score', 'akhir' => 'nilai_akhir',
                'mapel_inti', 'mapelinti', 'core_mapel', 'core' => 'mapel_inti',
                'absensi', 'attendance' => 'absensi',
                'nama', 'name' => 'nama',
                default => null,
            };

            if ($mapped === null) {
                return null;
            }

            if (! in_array($mapped, $normalized, true)) {
                $normalized[] = $mapped;
            }
        }

        foreach ($defaultOrder as $fallback) {
            if (! in_array($fallback, $normalized, true)) {
                $normalized[] = $fallback;
            }
        }

        return $normalized;
    }

    private function normalizeSettingsMapelList($value): ?array
    {
        if ($value === null || $value === '') {
            return [];
        }

        $source = $value;
        if (is_string($source)) {
            $trimmed = trim($source);
            if ($trimmed === '') {
                return [];
            }

            $decoded = null;
            if (str_starts_with($trimmed, '[')) {
                $decoded = json_decode($trimmed, true);
            }

            if (is_array($decoded)) {
                $source = $decoded;
            } else {
                $source = preg_split('/[,;\\n\\r]+/', $trimmed) ?: [];
            }
        }

        if (! is_array($source)) {
            return null;
        }

        $result = [];
        foreach ($source as $item) {
            $name = trim((string) $item);
            if ($name === '') {
                continue;
            }
            if (! in_array($name, $result, true)) {
                $result[] = $name;
            }
        }

        return $result;
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
