<?php

namespace App\Traits;

use App\Support\AcademicPeriod;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

trait HasTenantBackupLogic
{
    private array $tableExistenceCache = [];

    private array $tableColumnExistenceCache = [];

    private function getBackupTableOrder(): array
    {
        return [
            'users',
            'settings', 'profiles', 'admin_users', 'admin_feature_permissions', 'kelas', 'mata_pelajaran', 'guru_mapel_bobot',
            'guru_mapel_manual_nilai', 'rapot_siswa', 'rapot_siswa_items',
            'struktur_sekolah', 'kelas_struktur', 'jadwal', 'pengumuman',
            'ekskul', 'ekskul_anggota', 'organisasi', 'organisasi_anggota', 'osis_anggota',
            'absensi_settings', 'absensi_rfid_settings', 'absensi', 'absensi_ajuan',
            'absensi_eskul', 'absensi_scan_temp', 'rfid_scans', 'jam_kosong',
            'tugas', 'tugas_jawaban', 'quizzes', 'quiz_questions', 'quiz_options',
            'quiz_submissions', 'quiz_answers', 'quiz_retake_logs', 'quiz_violation_logs',
            'certificates', 'templat_sertifikat_publik', 'printed_cards',
            'allowed_registrations', 'registration_otps', 'audit_log',
            'approval_requests',
            'anggota_eksku1', 'anggota_ekskul',
            'import_siswa_histories', 'import_siswa_history_items',
            'import_guru_histories', 'import_guru_history_items',
            'kelas_deleted_histories',
            'user_presence',
            'tenant_domains',
            'tenant_google_drive_configs', 'tenant_google_drive_files',
            'tenant_mqtt_configs',
            'rfid_devices', 'rfid_device_events',
            'whatsapp_integrations', 'whatsapp_notification_settings', 'whatsapp_message_logs',
            'password_change_verifications', 'email_verifications',
        ];
    }

    private function excludedTenantBackupTables(): array
    {
        return [
            '_policy_backup',
            'cache',
            'cache_locks',
            'failed_jobs',
            'job_batches',
            'jobs',
            'migrations',
            'password_reset_tokens',
            'personal_access_tokens',
            'plugin_upload_drafts',
            'sessions',
            'super_admins',
            'system_plugins',
            'tenants',
        ];
    }

    private function backupTablesForTenant(): array
    {
        $availableTables = [];
        try {
            $availableTables = Schema::getTableListing();
        } catch (\Throwable $e) {
            $availableTables = $this->getBackupTableOrder();
        }
        $availableTables = array_values(array_unique(array_map(
            fn ($tableName) => $this->normalizeBackupTableName((string) $tableName),
            $availableTables
        )));

        $availableMap = array_fill_keys(array_map('strval', $availableTables), true);
        $excluded = array_fill_keys($this->excludedTenantBackupTables(), true);
        $tables = [];

        foreach ($this->getBackupTableOrder() as $tableName) {
            if (! isset($availableMap[$tableName]) || isset($excluded[$tableName])) {
                continue;
            }

            if ($tableName === 'users' || $this->tableHasColumn($tableName, 'tenant_id')) {
                $tables[] = $tableName;
            }
        }

        foreach ($availableTables as $tableName) {
            $tableName = (string) $tableName;
            if (isset($excluded[$tableName]) || in_array($tableName, $tables, true)) {
                continue;
            }

            if ($this->tableHasColumn($tableName, 'tenant_id')) {
                $tables[] = $tableName;
            }
        }

        return $tables;
    }

    private function normalizeBackupTableName(string $tableName): string
    {
        $tableName = trim($tableName);
        if ($tableName === '') {
            return $tableName;
        }

        if (str_contains($tableName, '.')) {
            $parts = explode('.', $tableName);

            return trim((string) end($parts));
        }

        return $tableName;
    }

    private function masterTablesWithoutDateFilter(): array
    {
        return [
            'settings',
            'profiles',
            'kelas',
            'mata_pelajaran',
            'guru_mapel_bobot',
            'guru_mapel_manual_nilai',
            'rapot_siswa',
            'rapot_siswa_items',
            'kelas_struktur',
            'struktur_sekolah',
            'ekskul',
            'organisasi',
            'admin_users',
            'allowed_registrations',
            'registration_otps',
        ];
    }

    private function normalizeBackupMode(?string $value): string
    {
        $mode = strtolower(trim((string) $value));

        return match ($mode) {
            'siswa', 'student', 'students' => 'students',
            'guru', 'teacher', 'teachers' => 'teachers',
            'kelas', 'class', 'classes' => 'classes',
            default => 'full',
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

        return $months > 0 ? min(12, $months) : null;
    }

    private function normalizeBackupPeriodScope(string $tenantId, array $input = []): array
    {
        $rawType = strtolower(trim((string) ($input['period_type'] ?? $input['period'] ?? '')));
        $months = $this->normalizeBackupMonths($input['months'] ?? null);
        $type = $rawType !== '' ? $rawType : ($months !== null ? 'last_months' : 'all');
        $now = now('Asia/Jakarta');

        if (in_array($type, ['month', 'this_month', 'bulan_ini'], true)) {
            $start = $now->copy()->startOfMonth()->startOfDay();
            $end = $now->copy()->endOfMonth();

            return $this->makeBackupPeriodScope('this_month', 'Bulan ini', 1, $start, $end);
        }

        if (in_array($type, ['last_months', 'months', 'bulan'], true) && $months !== null) {
            $start = $now->copy()->subMonths($months)->startOfDay();

            return $this->makeBackupPeriodScope(
                'last_months',
                $this->backupPeriodLabel($months),
                $months,
                $start,
                $now->copy()
            );
        }

        if (in_array($type, ['semester', 'current_semester', 'semester_aktif'], true)) {
            $activePeriod = $this->tenantActiveAcademicPeriod($tenantId);
            $academicYear = AcademicPeriod::normalizeAcademicYear($input['tahun_ajaran'] ?? $input['academic_year'] ?? null)
                ?: (string) ($activePeriod['tahun_ajaran'] ?? '');
            $semester = AcademicPeriod::normalizeSemester($input['semester'] ?? null)
                ?: (string) ($activePeriod['semester'] ?? '');
            $period = AcademicPeriod::make($academicYear, $semester);
            $start = $this->carbonFromBackupDate($period['starts_at'] ?? null, false);
            $end = $this->carbonFromBackupDate($period['ends_at'] ?? null, true);

            return $this->makeBackupPeriodScope(
                'semester',
                'Semester '.($period['semester'] ?? $semester).' '.$period['tahun_ajaran'],
                null,
                $start,
                $end,
                (string) ($period['tahun_ajaran'] ?? $academicYear),
                (string) ($period['semester'] ?? $semester),
                $period
            );
        }

        if (in_array($type, ['academic_year', 'tahun_ajaran', 'year'], true)) {
            $activePeriod = $this->tenantActiveAcademicPeriod($tenantId);
            $academicYear = AcademicPeriod::normalizeAcademicYear($input['tahun_ajaran'] ?? $input['academic_year'] ?? null)
                ?: (string) ($activePeriod['tahun_ajaran'] ?? AcademicPeriod::current()['tahun_ajaran']);
            $startYear = (int) substr($academicYear, 0, 4);
            $start = Carbon::create($startYear, 7, 1, 0, 0, 0, 'Asia/Jakarta')->startOfDay();
            $end = Carbon::create($startYear + 1, 6, 30, 23, 59, 59, 'Asia/Jakarta');

            return $this->makeBackupPeriodScope(
                'academic_year',
                'Tahun ajaran '.$academicYear,
                null,
                $start,
                $end,
                $academicYear,
                null
            );
        }

        if (in_array($type, ['custom', 'range', 'date_range', 'rentang'], true)) {
            $start = $this->carbonFromBackupDate($input['start_date'] ?? $input['from'] ?? null, false);
            $end = $this->carbonFromBackupDate($input['end_date'] ?? $input['to'] ?? null, true);

            if ($start && $end && $start->lessThanOrEqualTo($end)) {
                return $this->makeBackupPeriodScope(
                    'date_range',
                    'Rentang '.$start->toDateString().' s/d '.$end->toDateString(),
                    null,
                    $start,
                    $end
                );
            }
        }

        return $this->makeBackupPeriodScope('all', 'Semua data');
    }

    private function makeBackupPeriodScope(
        string $type,
        string $label,
        ?int $months = null,
        ?Carbon $startAt = null,
        ?Carbon $endAt = null,
        ?string $academicYear = null,
        ?string $semester = null,
        ?array $academicPeriod = null
    ): array {
        return [
            'type' => $type,
            'months' => $months,
            'label' => $label,
            'start_at' => $startAt,
            'end_at' => $endAt,
            'tahun_ajaran' => $academicYear,
            'semester' => $semester,
            'academic_period' => $academicPeriod,
        ];
    }

    private function backupPeriodPayload(array $scope): array
    {
        return [
            'type' => (string) ($scope['type'] ?? 'all'),
            'months' => $scope['months'] ?? null,
            'label' => (string) ($scope['label'] ?? 'Semua data'),
            'start_at' => isset($scope['start_at']) && $scope['start_at'] instanceof Carbon
                ? $scope['start_at']->toIso8601String()
                : null,
            'end_at' => isset($scope['end_at']) && $scope['end_at'] instanceof Carbon
                ? $scope['end_at']->toIso8601String()
                : null,
            'tahun_ajaran' => $scope['tahun_ajaran'] ?? null,
            'semester' => $scope['semester'] ?? null,
            'academic_period' => $scope['academic_period'] ?? null,
        ];
    }

    private function backupModeLabel(string $mode): string
    {
        return match ($mode) {
            'students' => 'Backup Siswa (profil, kelas, absensi, tugas, quiz, sertifikat, dan data terkait siswa)',
            'teachers' => 'Backup Guru (profil, jadwal, wali kelas, tugas, quiz, jam kosong, dan data terkait guru)',
            'classes' => 'Backup Kelas (master kelas, struktur, siswa, jadwal, absensi, tugas, quiz, dan data kelas terkait)',
            default => 'Backup Lengkap Sekolah (seluruh tabel database tenant, tanpa file storage)',
        };
    }

    private function backupPeriodLabel(?int $months): string
    {
        if ($months === null) {
            return 'Semua data';
        }

        if ($months === 1) {
            return '1 bulan terakhir (termasuk bulan ini)';
        }

        return $months.' bulan terakhir';
    }

    private function tenantActiveAcademicPeriod(string $tenantId): array
    {
        $current = AcademicPeriod::current();
        if (! $this->hasTable('settings') || ! $this->tableHasColumn('settings', 'tenant_id')) {
            return $current;
        }

        try {
            $columns = array_values(array_filter(
                [
                    'tahun_ajaran',
                    'semester_aktif',
                    'periode_mulai',
                    'periode_selesai',
                    'periode_ganjil_mulai',
                    'periode_ganjil_selesai',
                    'periode_genap_mulai',
                    'periode_genap_selesai',
                ],
                fn (string $column) => $this->tableHasColumn('settings', $column)
            ));
            $settings = DB::table('settings')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->first($columns ?: ['id']);

            return $settings ? AcademicPeriod::fromSettings($settings) : $current;
        } catch (\Throwable $e) {
            return $current;
        }
    }

    private function carbonFromBackupDate($value, bool $endOfDay = false): ?Carbon
    {
        $date = AcademicPeriod::normalizeDate($value);
        if (! $date) {
            return null;
        }

        try {
            $carbon = Carbon::parse($date, 'Asia/Jakarta');

            return $endOfDay ? $carbon->endOfDay() : $carbon->startOfDay();
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function hasTable(string $table): bool
    {
        if (! isset($this->tableExistenceCache[$table])) {
            $this->tableExistenceCache[$table] = Schema::hasTable($table);
        }

        return $this->tableExistenceCache[$table];
    }

    private function tableHasColumn(string $table, string $column): bool
    {
        $key = "$table.$column";
        if (! isset($this->tableColumnExistenceCache[$key])) {
            $this->tableColumnExistenceCache[$key] = Schema::hasColumn($table, $column);
        }

        return $this->tableColumnExistenceCache[$key];
    }

    private function allTableColumnsExist(string $table, array $columns): bool
    {
        foreach ($columns as $col) {
            if (! $this->tableHasColumn($table, $col)) {
                return false;
            }
        }

        return true;
    }

    private function firstExistingColumn(string $table, array $columns): ?string
    {
        foreach ($columns as $column) {
            if ($this->tableHasColumn($table, $column)) {
                return $column;
            }
        }

        return null;
    }

    private function backupDateColumnsForTable(string $table): array
    {
        if (in_array($table, $this->masterTablesWithoutDateFilter(), true)) {
            return $this->existingDateColumns($table, ['updated_at', 'created_at']);
        }

        $candidates = match ($table) {
            'absensi' => ['tanggal', 'waktu', 'created_at'],
            'absensi_ajuan' => ['waktu_respon', 'created_at', 'tanggal'],
            'absensi_settings',
            'absensi_eskul',
            'jam_kosong' => ['updated_at', 'created_at', 'tanggal'],
            'absensi_scan_temp' => ['scan_at', 'created_at', 'tanggal'],
            'rfid_scans',
            'pengumuman',
            'approval_requests',
            'import_siswa_histories',
            'import_siswa_history_items',
            'import_guru_histories',
            'import_guru_history_items',
            'kelas_deleted_histories' => ['updated_at', 'created_at'],
            'tugas',
            'quizzes',
            'quiz_questions',
            'quiz_options',
            'quiz_answers',
            'quiz_retake_logs',
            'quiz_violation_logs' => ['updated_at', 'created_at'],
            'tugas_jawaban' => ['dinilai_at', 'waktu_submit', 'created_at'],
            'quiz_submissions' => ['finished_at', 'updated_at', 'started_at', 'created_at'],
            'certificates' => ['issued_at', 'sent_at', 'created_at', 'updated_at'],
            'printed_cards' => ['printed_at', 'created_at', 'updated_at'],
            'storage_files' => ['uploaded_at', 'created_at', 'updated_at'],
            default => [
                'updated_at',
                'created_at',
                'tanggal',
                'waktu',
                'waktu_respon',
                'waktu_submit',
                'dinilai_at',
                'uploaded_at',
                'scan_at',
                'scanned_at',
                'queued_at',
                'sent_at',
                'failed_at',
                'requested_at',
                'approved_at',
                'rejected_at',
                'printed_at',
                'issued_at',
                'started_at',
                'finished_at',
                'live_started_at',
                'timestamp',
            ],
        };

        return $this->existingDateColumns($table, $candidates);
    }

    private function existingDateColumns(string $table, array $columns): array
    {
        $existing = [];
        foreach (array_values(array_unique($columns)) as $column) {
            if (is_string($column) && $column !== '' && $this->tableHasColumn($table, $column)) {
                $existing[] = $column;
            }
        }

        return $existing;
    }

    private function backupDateColumnValue(string $column, Carbon $value): string
    {
        return in_array($column, ['tanggal', 'event_date'], true)
            ? $value->toDateString()
            : $value->toDateTimeString();
    }

    private function rowValue($row, string $key)
    {
        if (is_array($row)) {
            return $row[$key] ?? null;
        }
        if (is_object($row)) {
            return $row->{$key} ?? null;
        }

        return null;
    }

    private function normalizeIdList(array $values): array
    {
        $normalized = [];
        foreach ($values as $value) {
            if ($value === null || $value === '') {
                continue;
            }
            $key = (string) $value;
            if ($key === '') {
                continue;
            }
            $normalized[$key] = $key;
        }

        return array_values($normalized);
    }

    private function extractIds(array $rows, string $column): array
    {
        $values = [];
        foreach ($rows as $row) {
            $values[] = $this->rowValue($row, $column);
        }

        return $this->normalizeIdList($values);
    }

    private function buildDateLimit(?int $months): ?Carbon
    {
        if (! $months || $months <= 0) {
            return null;
        }

        return now()->subMonths($months)->startOfDay();
    }

    private function coerceBackupPeriodScope($periodScope): array
    {
        if ($periodScope instanceof Carbon) {
            return $this->makeBackupPeriodScope('date_range', 'Periode terbatas', null, $periodScope);
        }

        if (is_array($periodScope)) {
            $scope = $periodScope;
            foreach (['start_at', 'end_at'] as $key) {
                if (isset($scope[$key]) && is_string($scope[$key])) {
                    $scope[$key] = $this->carbonFromBackupDate($scope[$key], $key === 'end_at');
                }
            }

            return $scope;
        }

        if (is_numeric($periodScope)) {
            $months = $this->normalizeBackupMonths($periodScope);
            if ($months !== null) {
                return $this->makeBackupPeriodScope(
                    'last_months',
                    $this->backupPeriodLabel($months),
                    $months,
                    $this->buildDateLimit($months),
                    now('Asia/Jakarta')
                );
            }
        }

        return $this->makeBackupPeriodScope('all', 'Semua data');
    }

    private function applyDateLimit($query, string $table, $periodScope, array $preferredColumns = []): void
    {
        $scope = $this->coerceBackupPeriodScope($periodScope);
        if (($scope['type'] ?? 'all') === 'all') {
            return;
        }

        $academicApplied = false;
        $academicYear = trim((string) ($scope['tahun_ajaran'] ?? ''));
        $semester = trim((string) ($scope['semester'] ?? ''));

        if ($academicYear !== '' && $this->tableHasColumn($table, 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $academicYear);
            $academicApplied = true;
        }

        if (
            ($scope['type'] ?? '') === 'semester'
            && $semester !== ''
            && $this->tableHasColumn($table, 'semester')
        ) {
            $query->where('semester', $semester);
            $academicApplied = true;
        }

        if (
            $academicApplied
            && (
                ($scope['type'] ?? '') === 'academic_year'
                || (($scope['type'] ?? '') === 'semester' && $this->tableHasColumn($table, 'semester'))
            )
        ) {
            return;
        }

        $startAt = $scope['start_at'] ?? null;
        $endAt = $scope['end_at'] ?? null;
        if (! $startAt instanceof Carbon && ! $endAt instanceof Carbon) {
            return;
        }

        $candidates = array_values(array_unique(array_filter(array_merge(
            $preferredColumns,
            $this->backupDateColumnsForTable($table),
            [
                'tanggal', 'scan_at', 'scanned_at', 'uploaded_at', 'queued_at', 'sent_at', 'failed_at',
                'requested_at', 'approved_at', 'rejected_at', 'printed_at', 'issued_at',
                'waktu', 'waktu_respon', 'waktu_submit', 'dinilai_at',
                'started_at', 'finished_at', 'live_started_at',
                'created_at', 'updated_at', 'timestamp',
            ]
        ), fn ($column) => is_string($column) && $column !== '')));

        $dateColumns = array_values(array_filter(
            $candidates,
            fn (string $column) => $this->tableHasColumn($table, $column)
        ));
        if (empty($dateColumns)) {
            return;
        }

        $query->where(function ($dateQuery) use ($dateColumns, $startAt, $endAt) {
            foreach ($dateColumns as $index => $dateColumn) {
                $method = $index === 0 ? 'where' : 'orWhere';
                $dateQuery->{$method}(function ($columnQuery) use ($dateColumn, $startAt, $endAt) {
                    if ($startAt instanceof Carbon) {
                        $columnQuery->where($dateColumn, '>=', $this->backupDateColumnValue($dateColumn, $startAt));
                    }

                    if ($endAt instanceof Carbon) {
                        $columnQuery->where($dateColumn, '<=', $this->backupDateColumnValue($dateColumn, $endAt));
                    }
                });
            }
        });
    }

    private function applyDefaultOrder($query, string $table): void
    {
        if ($this->tableHasColumn($table, 'id')) {
            $query->orderBy('id');

            return;
        }

        $fallbackColumn = $this->firstExistingColumn($table, ['created_at', 'tanggal', 'updated_at']);
        if ($fallbackColumn) {
            $query->orderBy($fallbackColumn);
        }
    }

    private function queryTenantTable(
        string $table,
        string $tenantId,
        $periodScope = null,
        ?callable $scope = null,
        array $preferredDateColumns = []
    ): array {
        if (! $this->hasTable($table) || ! $this->tableHasColumn($table, 'tenant_id')) {
            return [];
        }

        try {
            $query = DB::table($table)->where('tenant_id', $tenantId);
            if ($scope) {
                $scope($query);
            }

            $this->applyDateLimit($query, $table, $periodScope, $preferredDateColumns);
            $this->applyDefaultOrder($query, $table);

            return $query->get()->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    private function averageNumbers(array $values): ?float
    {
        $numbers = [];
        foreach ($values as $value) {
            if (is_numeric($value)) {
                $numbers[] = (float) $value;
            }
        }

        if (empty($numbers)) {
            return null;
        }

        return round(array_sum($numbers) / count($numbers), 2);
    }

    private function makeBackupTable(string $name, array $rows): array
    {
        $normalizedRows = [];
        $columns = [];
        $columnMap = [];
        foreach ($rows as $row) {
            $normalized = $this->normalizeBackupRow(is_array($row) ? $row : (array) $row);
            $normalizedRows[] = $normalized;

            foreach (array_keys($normalized) as $column) {
                if (isset($columnMap[$column])) {
                    continue;
                }

                $columnMap[$column] = true;
                $columns[] = $column;
            }
        }

        return [
            'name' => $name,
            'row_count' => count($normalizedRows),
            'column_count' => count($columns),
            'columns' => $columns,
            'rows' => $normalizedRows,
        ];
    }

    private function buildLinkedUsersBackupTable(string $tenantId): ?array
    {
        if (! $this->hasTable('users')) {
            return null;
        }

        $userIds = [];

        if ($this->hasTable('profiles') && $this->allTableColumnsExist('profiles', ['id', 'tenant_id'])) {
            try {
                $userIds = array_merge(
                    $userIds,
                    DB::table('profiles')
                        ->where('tenant_id', $tenantId)
                        ->pluck('id')
                        ->filter()
                        ->map(fn ($value) => (string) $value)
                        ->all()
                );
            } catch (\Throwable $e) {
                // Backup tenant tetap lanjut walau tabel users tambahan gagal dibaca.
            }
        }

        if ($this->hasTable('admin_users') && $this->allTableColumnsExist('admin_users', ['id', 'tenant_id'])) {
            try {
                $userIds = array_merge(
                    $userIds,
                    DB::table('admin_users')
                        ->where('tenant_id', $tenantId)
                        ->pluck('id')
                        ->filter()
                        ->map(fn ($value) => (string) $value)
                        ->all()
                );
            } catch (\Throwable $e) {
                // Backup tenant tetap lanjut walau tabel admin_users tambahan gagal dibaca.
            }
        }

        $userIds = $this->normalizeIdList($userIds);
        if (empty($userIds)) {
            return $this->makeBackupTable('users', []);
        }

        try {
            $query = DB::table('users')->whereIn('id', $userIds);
            $this->applyDefaultOrder($query, 'users');

            return $this->makeBackupTable('users', $query->get()->all());
        } catch (\Throwable $e) {
            return $this->makeBackupTable('users', []);
        }
    }

    private function buildFullBackupTables(string $tenantId, $periodScope = null): array
    {
        $tables = [];
        $resolvedScope = $this->coerceBackupPeriodScope($periodScope);
        $masterTables = $this->masterTablesWithoutDateFilter();

        $linkedUsers = $this->buildLinkedUsersBackupTable($tenantId);
        if ($linkedUsers !== null) {
            $tables[] = $linkedUsers;
        }

        foreach ($this->backupTablesForTenant() as $tableName) {
            if ($tableName === 'users') {
                continue;
            }

            if (! $this->hasTable($tableName) || ! $this->tableHasColumn($tableName, 'tenant_id')) {
                continue;
            }

            $rows = $this->queryTenantTable(
                $tableName,
                $tenantId,
                in_array($tableName, $masterTables, true) ? null : $resolvedScope
            );

            $tables[] = $this->makeBackupTable($tableName, $rows);
        }

        return $tables;
    }

    private function buildStudentBackupTables(string $tenantId, $periodScope = null): array
    {
        $dateLimit = $this->coerceBackupPeriodScope($periodScope);
        $tables = [];

        $students = $this->queryTenantTable('profiles', $tenantId, null, function ($query) {
            $query->where('role', 'siswa');
            if ($this->tableHasColumn('profiles', 'kelas')) {
                $query->orderBy('kelas');
            }
            if ($this->tableHasColumn('profiles', 'nama')) {
                $query->orderBy('nama');
            }
        });

        $tables[] = $this->makeBackupTable('Siswa - Profil', $students);

        $studentIds = $this->extractIds($students, 'id');
        $classIds = $this->extractIds($students, 'kelas');

        $kelasRows = ! empty($classIds)
            ? $this->queryTenantTable('kelas', $tenantId, null, function ($query) use ($classIds) {
                if ($this->tableHasColumn('kelas', 'id')) {
                    $query->whereIn('id', $classIds);
                }
            })
            : [];
        $tables[] = $this->makeBackupTable('Siswa - Data Kelas', $kelasRows);

        if (empty($studentIds)) {
            $tables[] = $this->makeBackupTable('Siswa - Ringkasan', []);

            return $tables;
        }

        $absensiUserColumn = $this->firstExistingColumn('absensi', ['uid', 'siswa_id', 'user_id']);
        $absensiRows = $absensiUserColumn
            ? $this->queryTenantTable('absensi', $tenantId, $dateLimit, function ($query) use ($absensiUserColumn, $studentIds) {
                $query->whereIn($absensiUserColumn, $studentIds);
            }, ['tanggal', 'created_at', 'waktu'])
            : [];

        $absensiAjuanUserColumn = $this->firstExistingColumn('absensi_ajuan', ['uid', 'siswa_id', 'user_id']);
        $absensiAjuanRows = $absensiAjuanUserColumn
            ? $this->queryTenantTable('absensi_ajuan', $tenantId, $dateLimit, function ($query) use ($absensiAjuanUserColumn, $studentIds) {
                $query->whereIn($absensiAjuanUserColumn, $studentIds);
            }, ['tanggal', 'created_at'])
            : [];

        $scanTempUserColumn = $this->firstExistingColumn('absensi_scan_temp', ['siswa_id', 'uid', 'user_id']);
        $scanTempRows = $scanTempUserColumn
            ? $this->queryTenantTable('absensi_scan_temp', $tenantId, $dateLimit, function ($query) use ($scanTempUserColumn, $studentIds) {
                $query->whereIn($scanTempUserColumn, $studentIds);
            }, ['tanggal', 'scan_at', 'created_at'])
            : [];

        $jawabanUserColumn = $this->firstExistingColumn('tugas_jawaban', ['user_id', 'siswa_id', 'uid']);
        $taskAnswerRows = $jawabanUserColumn
            ? $this->queryTenantTable('tugas_jawaban', $tenantId, $dateLimit, function ($query) use ($jawabanUserColumn, $studentIds) {
                $query->whereIn($jawabanUserColumn, $studentIds);
            }, ['waktu_submit', 'created_at'])
            : [];

        $taskIds = $this->extractIds($taskAnswerRows, 'tugas_id');
        $taskRows = ! empty($taskIds)
            ? $this->queryTenantTable('tugas', $tenantId, $dateLimit, function ($query) use ($taskIds) {
                if ($this->tableHasColumn('tugas', 'id')) {
                    $query->whereIn('id', $taskIds);
                }
            }, ['deadline', 'mulai', 'created_at'])
            : [];

        $submissionRows = $this->queryTenantTable('quiz_submissions', $tenantId, $dateLimit, function ($query) use ($studentIds) {
            if ($this->tableHasColumn('quiz_submissions', 'siswa_id')) {
                $query->whereIn('siswa_id', $studentIds);
            }
        }, ['created_at', 'started_at', 'finished_at']);

        $submissionIds = $this->extractIds($submissionRows, 'id');
        $quizIdsFromSubmission = $this->extractIds($submissionRows, 'quiz_id');
        $quizRows = ! empty($quizIdsFromSubmission)
            ? $this->queryTenantTable('quizzes', $tenantId, $dateLimit, function ($query) use ($quizIdsFromSubmission) {
                $query->whereIn('id', $quizIdsFromSubmission);
            }, ['starts_at', 'deadline_at', 'created_at'])
            : [];

        $questionRows = ! empty($quizIdsFromSubmission)
            ? $this->queryTenantTable('quiz_questions', $tenantId, null, function ($query) use ($quizIdsFromSubmission) {
                if ($this->tableHasColumn('quiz_questions', 'quiz_id')) {
                    $query->whereIn('quiz_id', $quizIdsFromSubmission);
                }
            })
            : [];
        $questionIds = $this->extractIds($questionRows, 'id');

        $optionRows = ! empty($questionIds)
            ? $this->queryTenantTable('quiz_options', $tenantId, null, function ($query) use ($questionIds) {
                if ($this->tableHasColumn('quiz_options', 'question_id')) {
                    $query->whereIn('question_id', $questionIds);
                }
            })
            : [];

        $answerRows = ! empty($submissionIds)
            ? $this->queryTenantTable('quiz_answers', $tenantId, null, function ($query) use ($submissionIds) {
                if ($this->tableHasColumn('quiz_answers', 'submission_id')) {
                    $query->whereIn('submission_id', $submissionIds);
                }
            })
            : [];

        $retakeRows = $this->queryTenantTable('quiz_retake_logs', $tenantId, $dateLimit, function ($query) use ($studentIds) {
            if ($this->tableHasColumn('quiz_retake_logs', 'siswa_id')) {
                $query->whereIn('siswa_id', $studentIds);
            }
        });

        $certRows = $this->queryTenantTable('certificates', $tenantId, $dateLimit, function ($query) use ($studentIds) {
            if ($this->tableHasColumn('certificates', 'user_id')) {
                $query->whereIn('user_id', $studentIds);
            }
        }, ['issued_at', 'created_at']);

        $printedCardsRows = $this->queryTenantTable('printed_cards', $tenantId, $dateLimit, function ($query) use ($studentIds) {
            if ($this->tableHasColumn('printed_cards', 'student_id')) {
                $query->whereIn('student_id', $studentIds);
            }
        }, ['printed_at', 'created_at']);

        $ekskulRows = $this->queryTenantTable('ekskul_anggota', $tenantId, $dateLimit, function ($query) use ($studentIds) {
            if ($this->tableHasColumn('ekskul_anggota', 'user_id')) {
                $query->whereIn('user_id', $studentIds);
            }
        });

        $absensiEskulRows = $this->queryTenantTable('absensi_eskul', $tenantId, $dateLimit, function ($query) use ($studentIds) {
            if ($this->tableHasColumn('absensi_eskul', 'user_id')) {
                $query->whereIn('user_id', $studentIds);
            }
        }, ['tanggal', 'created_at']);

        $organisasiRows = $this->queryTenantTable('organisasi_anggota', $tenantId, null, function ($query) use ($studentIds) {
            if ($this->tableHasColumn('organisasi_anggota', 'siswa_id')) {
                $query->whereIn('siswa_id', $studentIds);
            }
        });

        $osisRows = $this->queryTenantTable('osis_anggota', $tenantId, null, function ($query) use ($studentIds) {
            if ($this->tableHasColumn('osis_anggota', 'siswa_id')) {
                $query->whereIn('siswa_id', $studentIds);
            }
        });

        $tables[] = $this->makeBackupTable('Siswa - Absensi', $absensiRows);
        $tables[] = $this->makeBackupTable('Siswa - Ajuan Absensi', $absensiAjuanRows);
        $tables[] = $this->makeBackupTable('Siswa - Scan Kehadiran', $scanTempRows);
        $tables[] = $this->makeBackupTable('Siswa - Tugas', $taskRows);
        $tables[] = $this->makeBackupTable('Siswa - Jawaban Tugas', $taskAnswerRows);
        $tables[] = $this->makeBackupTable('Siswa - Quiz', $quizRows);
        $tables[] = $this->makeBackupTable('Siswa - Soal Quiz', $questionRows);
        $tables[] = $this->makeBackupTable('Siswa - Opsi Quiz', $optionRows);
        $tables[] = $this->makeBackupTable('Siswa - Submission Quiz', $submissionRows);
        $tables[] = $this->makeBackupTable('Siswa - Jawaban Quiz', $answerRows);
        $tables[] = $this->makeBackupTable('Siswa - Log Ulang Quiz', $retakeRows);
        $tables[] = $this->makeBackupTable('Siswa - Sertifikat', $certRows);
        $tables[] = $this->makeBackupTable('Siswa - Riwayat Cetak Kartu', $printedCardsRows);
        $tables[] = $this->makeBackupTable('Siswa - Keanggotaan Ekskul', $ekskulRows);
        $tables[] = $this->makeBackupTable('Siswa - Absensi Ekskul', $absensiEskulRows);
        $tables[] = $this->makeBackupTable('Siswa - Organisasi', $organisasiRows);
        $tables[] = $this->makeBackupTable('Siswa - OSIS', $osisRows);

        $taskScoreByStudent = [];
        foreach ($taskAnswerRows as $row) {
            $studentId = (string) $this->rowValue($row, $jawabanUserColumn ?: 'user_id');
            if ($studentId === '') {
                continue;
            }
            $taskScoreByStudent[$studentId][] = $this->rowValue($row, 'nilai');
        }

        $quizScoreByStudent = [];
        foreach ($submissionRows as $row) {
            $studentId = (string) $this->rowValue($row, 'siswa_id');
            if ($studentId === '') {
                continue;
            }
            $quizScoreByStudent[$studentId][] = $this->rowValue($row, 'score');
        }

        $absensiCountByStudent = [];
        foreach ($absensiRows as $row) {
            $studentId = (string) $this->rowValue($row, $absensiUserColumn ?: 'uid');
            $status = (string) $this->rowValue($row, 'status');
            if ($studentId === '') {
                continue;
            }
            if (! isset($absensiCountByStudent[$studentId])) {
                $absensiCountByStudent[$studentId] = ['Hadir' => 0, 'Izin' => 0, 'Sakit' => 0, 'Alpha' => 0];
            }
            if (isset($absensiCountByStudent[$studentId][$status])) {
                $absensiCountByStudent[$studentId][$status] += 1;
            }
        }

        $studentMap = [];
        foreach ($students as $index => $student) {
            $studentId = (string) $this->rowValue($student, 'id');
            if ($studentId === '') {
                continue;
            }

            $taskAvg = $this->averageNumbers($taskScoreByStudent[$studentId] ?? []);
            $quizAvg = $this->averageNumbers($quizScoreByStudent[$studentId] ?? []);
            $combinedAvg = $this->combineAcademicScore($taskAvg, $quizAvg);
            $absensi = $absensiCountByStudent[$studentId] ?? ['Hadir' => 0, 'Izin' => 0, 'Sakit' => 0, 'Alpha' => 0];

            $studentMap[] = [
                'no' => $index + 1,
                'siswa_id' => $studentId,
                'nama' => $this->rowValue($student, 'nama'),
                'nis' => $this->rowValue($student, 'nis'),
                'kelas' => $this->rowValue($student, 'kelas'),
                'email' => $this->rowValue($student, 'email'),
                'status' => $this->rowValue($student, 'status'),
                'jumlah_tugas_terkirim' => count($taskScoreByStudent[$studentId] ?? []),
                'rata_nilai_tugas' => $taskAvg,
                'jumlah_quiz_dikerjakan' => count($quizScoreByStudent[$studentId] ?? []),
                'rata_nilai_quiz' => $quizAvg,
                'rata_nilai_akademik' => $combinedAvg,
                'hadir' => $absensi['Hadir'],
                'izin' => $absensi['Izin'],
                'sakit' => $absensi['Sakit'],
                'alpha' => $absensi['Alpha'],
            ];
        }

        $tables[] = $this->makeBackupTable('Siswa - Ringkasan', $studentMap);

        return $tables;
    }

    private function buildTeacherBackupTables(string $tenantId, $periodScope = null): array
    {
        $dateLimit = $this->coerceBackupPeriodScope($periodScope);
        $tables = [];

        $teachers = $this->queryTenantTable('profiles', $tenantId, null, function ($query) {
            $query->where('role', 'guru');
            if ($this->tableHasColumn('profiles', 'nama')) {
                $query->orderBy('nama');
            }
        });
        $tables[] = $this->makeBackupTable('Guru - Profil', $teachers);

        $teacherIds = $this->extractIds($teachers, 'id');
        if (empty($teacherIds)) {
            $tables[] = $this->makeBackupTable('Guru - Ringkasan', []);

            return $tables;
        }

        $jadwalRows = $this->queryTenantTable('jadwal', $tenantId, null, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('jadwal', 'guru_id')) {
                $query->whereIn('guru_id', $teacherIds);
            }
        });

        $waliRows = $this->queryTenantTable('kelas_struktur', $tenantId, null, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('kelas_struktur', 'wali_guru_id')) {
                $query->whereIn('wali_guru_id', $teacherIds);
            }
        });

        $strukturRows = $this->queryTenantTable('struktur_sekolah', $tenantId, null, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('struktur_sekolah', 'guru_id')) {
                $query->whereIn('guru_id', $teacherIds);
            }
        });

        $ekskulRows = $this->queryTenantTable('ekskul', $tenantId, null, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('ekskul', 'pembina_guru_id')) {
                $query->whereIn('pembina_guru_id', $teacherIds);
            }
        });

        $organisasiRows = $this->queryTenantTable('organisasi', $tenantId, null, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('organisasi', 'pembina_guru_id')) {
                $query->whereIn('pembina_guru_id', $teacherIds);
            }
        });

        $jamKosongRows = $this->queryTenantTable('jam_kosong', $tenantId, $dateLimit, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('jam_kosong', 'created_by')) {
                $query->whereIn('created_by', $teacherIds);
            }
        }, ['tanggal', 'created_at']);

        $taskRows = $this->queryTenantTable('tugas', $tenantId, $dateLimit, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('tugas', 'created_by')) {
                $query->whereIn('created_by', $teacherIds);
            }
        }, ['created_at', 'deadline', 'mulai']);
        $taskIds = $this->extractIds($taskRows, 'id');

        $taskAnswerRows = ! empty($taskIds)
            ? $this->queryTenantTable('tugas_jawaban', $tenantId, $dateLimit, function ($query) use ($taskIds) {
                if ($this->tableHasColumn('tugas_jawaban', 'tugas_id')) {
                    $query->whereIn('tugas_id', $taskIds);
                }
            }, ['waktu_submit', 'created_at'])
            : [];

        $quizRows = $this->queryTenantTable('quizzes', $tenantId, $dateLimit, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('quizzes', 'guru_id')) {
                $query->whereIn('guru_id', $teacherIds);
            }
        }, ['starts_at', 'deadline_at', 'created_at']);
        $quizIds = $this->extractIds($quizRows, 'id');

        $questionRows = ! empty($quizIds)
            ? $this->queryTenantTable('quiz_questions', $tenantId, null, function ($query) use ($quizIds) {
                if ($this->tableHasColumn('quiz_questions', 'quiz_id')) {
                    $query->whereIn('quiz_id', $quizIds);
                }
            })
            : [];
        $questionIds = $this->extractIds($questionRows, 'id');

        $optionRows = ! empty($questionIds)
            ? $this->queryTenantTable('quiz_options', $tenantId, null, function ($query) use ($questionIds) {
                if ($this->tableHasColumn('quiz_options', 'question_id')) {
                    $query->whereIn('question_id', $questionIds);
                }
            })
            : [];

        $submissionRows = ! empty($quizIds)
            ? $this->queryTenantTable('quiz_submissions', $tenantId, $dateLimit, function ($query) use ($quizIds) {
                if ($this->tableHasColumn('quiz_submissions', 'quiz_id')) {
                    $query->whereIn('quiz_id', $quizIds);
                }
            }, ['created_at', 'started_at', 'finished_at'])
            : [];
        $submissionIds = $this->extractIds($submissionRows, 'id');

        $answerRows = ! empty($submissionIds)
            ? $this->queryTenantTable('quiz_answers', $tenantId, null, function ($query) use ($submissionIds) {
                if ($this->tableHasColumn('quiz_answers', 'submission_id')) {
                    $query->whereIn('submission_id', $submissionIds);
                }
            })
            : [];

        $retakeRows = ! empty($quizIds)
            ? $this->queryTenantTable('quiz_retake_logs', $tenantId, $dateLimit, function ($query) use ($quizIds) {
                if ($this->tableHasColumn('quiz_retake_logs', 'quiz_id')) {
                    $query->whereIn('quiz_id', $quizIds);
                }
            })
            : [];

        $absensiAjuanRows = $this->queryTenantTable('absensi_ajuan', $tenantId, $dateLimit, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('absensi_ajuan', 'guru_id')) {
                $query->whereIn('guru_id', $teacherIds);
            }
        }, ['tanggal', 'created_at']);

        $rfidRows = $this->queryTenantTable('rfid_scans', $tenantId, $dateLimit, function ($query) use ($teacherIds) {
            if ($this->tableHasColumn('rfid_scans', 'user_id')) {
                $query->whereIn('user_id', $teacherIds);
            }
        });

        $tables[] = $this->makeBackupTable('Guru - Jadwal Mengajar', $jadwalRows);
        $tables[] = $this->makeBackupTable('Guru - Wali Kelas', $waliRows);
        $tables[] = $this->makeBackupTable('Guru - Struktur Sekolah', $strukturRows);
        $tables[] = $this->makeBackupTable('Guru - Ekskul Binaan', $ekskulRows);
        $tables[] = $this->makeBackupTable('Guru - Organisasi Binaan', $organisasiRows);
        $tables[] = $this->makeBackupTable('Guru - Tugas Dibuat', $taskRows);
        $tables[] = $this->makeBackupTable('Guru - Jawaban Tugas Siswa', $taskAnswerRows);
        $tables[] = $this->makeBackupTable('Guru - Quiz Dibuat', $quizRows);
        $tables[] = $this->makeBackupTable('Guru - Soal Quiz', $questionRows);
        $tables[] = $this->makeBackupTable('Guru - Opsi Quiz', $optionRows);
        $tables[] = $this->makeBackupTable('Guru - Submission Quiz', $submissionRows);
        $tables[] = $this->makeBackupTable('Guru - Jawaban Quiz', $answerRows);
        $tables[] = $this->makeBackupTable('Guru - Log Ulang Quiz', $retakeRows);
        $tables[] = $this->makeBackupTable('Guru - Ajuan Absensi', $absensiAjuanRows);
        $tables[] = $this->makeBackupTable('Guru - Monitoring Jam Kosong', $jamKosongRows);
        $tables[] = $this->makeBackupTable('Guru - Scan RFID', $rfidRows);

        $summaryRows = [];
        $jadwalCount = [];
        foreach ($jadwalRows as $row) {
            $id = (string) $this->rowValue($row, 'guru_id');
            if ($id !== '') {
                $jadwalCount[$id] = ($jadwalCount[$id] ?? 0) + 1;
            }
        }

        $waliCount = [];
        foreach ($waliRows as $row) {
            $id = (string) $this->rowValue($row, 'wali_guru_id');
            if ($id !== '') {
                $waliCount[$id] = ($waliCount[$id] ?? 0) + 1;
            }
        }

        $taskCount = [];
        foreach ($taskRows as $row) {
            $id = (string) $this->rowValue($row, 'created_by');
            if ($id !== '') {
                $taskCount[$id] = ($taskCount[$id] ?? 0) + 1;
            }
        }

        $quizCount = [];
        foreach ($quizRows as $row) {
            $id = (string) $this->rowValue($row, 'guru_id');
            if ($id !== '') {
                $quizCount[$id] = ($quizCount[$id] ?? 0) + 1;
            }
        }

        $jamKosongCount = [];
        foreach ($jamKosongRows as $row) {
            $id = (string) $this->rowValue($row, 'created_by');
            if ($id !== '') {
                $jamKosongCount[$id] = ($jamKosongCount[$id] ?? 0) + 1;
            }
        }

        foreach ($teachers as $index => $teacher) {
            $teacherId = (string) $this->rowValue($teacher, 'id');
            if ($teacherId === '') {
                continue;
            }

            $summaryRows[] = [
                'no' => $index + 1,
                'guru_id' => $teacherId,
                'nama' => $this->rowValue($teacher, 'nama'),
                'email' => $this->rowValue($teacher, 'email'),
                'status' => $this->rowValue($teacher, 'status'),
                'total_jadwal' => $jadwalCount[$teacherId] ?? 0,
                'total_wali_kelas' => $waliCount[$teacherId] ?? 0,
                'total_tugas_dibuat' => $taskCount[$teacherId] ?? 0,
                'total_quiz_dibuat' => $quizCount[$teacherId] ?? 0,
                'total_laporan_jam_kosong' => $jamKosongCount[$teacherId] ?? 0,
            ];
        }

        $tables[] = $this->makeBackupTable('Guru - Ringkasan', $summaryRows);

        return $tables;
    }

    private function buildClassBackupTables(string $tenantId, $periodScope = null): array
    {
        $dateLimit = $this->coerceBackupPeriodScope($periodScope);
        $tables = [];

        $classRows = $this->queryTenantTable('kelas', $tenantId, null, function ($query) {
            if ($this->tableHasColumn('kelas', 'id')) {
                $query->orderBy('id');
            }
        });
        $tables[] = $this->makeBackupTable('Kelas - Master', $classRows);

        $classIds = $this->extractIds($classRows, 'id');
        if (empty($classIds)) {
            $tables[] = $this->makeBackupTable('Kelas - Ringkasan', []);

            return $tables;
        }

        $classColumnAbsensi = $this->firstExistingColumn('absensi', ['kelas', 'kelas_id']);
        $classColumnAjuan = $this->firstExistingColumn('absensi_ajuan', ['kelas', 'kelas_id']);
        $classColumnSettings = $this->firstExistingColumn('absensi_settings', ['kelas', 'kelas_id']);
        $classColumnTugas = $this->firstExistingColumn('tugas', ['kelas', 'kelas_id']);
        $classColumnQuiz = $this->firstExistingColumn('quizzes', ['kelas_id', 'kelas']);
        $classColumnJamKosong = $this->firstExistingColumn('jam_kosong', ['kelas', 'kelas_id']);
        $classColumnScanTemp = $this->firstExistingColumn('absensi_scan_temp', ['kelas', 'kelas_id']);
        $classColumnProfiles = $this->firstExistingColumn('profiles', ['kelas', 'kelas_id']);

        $studentsRows = $classColumnProfiles
            ? $this->queryTenantTable('profiles', $tenantId, null, function ($query) use ($classColumnProfiles, $classIds) {
                $query->where('role', 'siswa');
                $query->whereIn($classColumnProfiles, $classIds);
            })
            : [];

        $strukturRows = $this->queryTenantTable('kelas_struktur', $tenantId, null, function ($query) use ($classIds) {
            if ($this->tableHasColumn('kelas_struktur', 'kelas_id')) {
                $query->whereIn('kelas_id', $classIds);
            }
        });

        $jadwalRows = $this->queryTenantTable('jadwal', $tenantId, null, function ($query) use ($classIds) {
            if ($this->tableHasColumn('jadwal', 'kelas_id')) {
                $query->whereIn('kelas_id', $classIds);
            }
        });

        $absensiRows = $classColumnAbsensi
            ? $this->queryTenantTable('absensi', $tenantId, $dateLimit, function ($query) use ($classColumnAbsensi, $classIds) {
                $query->whereIn($classColumnAbsensi, $classIds);
            }, ['tanggal', 'created_at', 'waktu'])
            : [];

        $ajuanRows = $classColumnAjuan
            ? $this->queryTenantTable('absensi_ajuan', $tenantId, $dateLimit, function ($query) use ($classColumnAjuan, $classIds) {
                $query->whereIn($classColumnAjuan, $classIds);
            }, ['tanggal', 'created_at'])
            : [];

        $absensiSettingsRows = $classColumnSettings
            ? $this->queryTenantTable('absensi_settings', $tenantId, $dateLimit, function ($query) use ($classColumnSettings, $classIds) {
                $query->whereIn($classColumnSettings, $classIds);
            }, ['tanggal', 'created_at'])
            : [];

        $taskRows = $classColumnTugas
            ? $this->queryTenantTable('tugas', $tenantId, $dateLimit, function ($query) use ($classColumnTugas, $classIds) {
                $query->whereIn($classColumnTugas, $classIds);
            }, ['created_at', 'deadline', 'mulai'])
            : [];
        $taskIds = $this->extractIds($taskRows, 'id');

        $taskAnswerRows = ! empty($taskIds)
            ? $this->queryTenantTable('tugas_jawaban', $tenantId, $dateLimit, function ($query) use ($taskIds) {
                if ($this->tableHasColumn('tugas_jawaban', 'tugas_id')) {
                    $query->whereIn('tugas_id', $taskIds);
                }
            }, ['waktu_submit', 'created_at'])
            : [];

        $quizRows = $classColumnQuiz
            ? $this->queryTenantTable('quizzes', $tenantId, $dateLimit, function ($query) use ($classColumnQuiz, $classIds) {
                $query->whereIn($classColumnQuiz, $classIds);
            }, ['starts_at', 'deadline_at', 'created_at'])
            : [];
        $quizIds = $this->extractIds($quizRows, 'id');

        $questionRows = ! empty($quizIds)
            ? $this->queryTenantTable('quiz_questions', $tenantId, null, function ($query) use ($quizIds) {
                if ($this->tableHasColumn('quiz_questions', 'quiz_id')) {
                    $query->whereIn('quiz_id', $quizIds);
                }
            })
            : [];
        $questionIds = $this->extractIds($questionRows, 'id');

        $optionRows = ! empty($questionIds)
            ? $this->queryTenantTable('quiz_options', $tenantId, null, function ($query) use ($questionIds) {
                if ($this->tableHasColumn('quiz_options', 'question_id')) {
                    $query->whereIn('question_id', $questionIds);
                }
            })
            : [];

        $submissionRows = ! empty($quizIds)
            ? $this->queryTenantTable('quiz_submissions', $tenantId, $dateLimit, function ($query) use ($quizIds) {
                if ($this->tableHasColumn('quiz_submissions', 'quiz_id')) {
                    $query->whereIn('quiz_id', $quizIds);
                }
            }, ['created_at', 'started_at', 'finished_at'])
            : [];
        $submissionIds = $this->extractIds($submissionRows, 'id');

        $answerRows = ! empty($submissionIds)
            ? $this->queryTenantTable('quiz_answers', $tenantId, null, function ($query) use ($submissionIds) {
                if ($this->tableHasColumn('quiz_answers', 'submission_id')) {
                    $query->whereIn('submission_id', $submissionIds);
                }
            })
            : [];

        $retakeRows = ! empty($quizIds)
            ? $this->queryTenantTable('quiz_retake_logs', $tenantId, $dateLimit, function ($query) use ($quizIds) {
                if ($this->tableHasColumn('quiz_retake_logs', 'quiz_id')) {
                    $query->whereIn('quiz_id', $quizIds);
                }
            })
            : [];

        $jamKosongRows = $classColumnJamKosong
            ? $this->queryTenantTable('jam_kosong', $tenantId, $dateLimit, function ($query) use ($classColumnJamKosong, $classIds) {
                $query->whereIn($classColumnJamKosong, $classIds);
            }, ['tanggal', 'created_at'])
            : [];

        $scanTempRows = $classColumnScanTemp
            ? $this->queryTenantTable('absensi_scan_temp', $tenantId, $dateLimit, function ($query) use ($classColumnScanTemp, $classIds) {
                $query->whereIn($classColumnScanTemp, $classIds);
            }, ['tanggal', 'scan_at', 'created_at'])
            : [];

        $tables[] = $this->makeBackupTable('Kelas - Struktur', $strukturRows);
        $tables[] = $this->makeBackupTable('Kelas - Siswa', $studentsRows);
        $tables[] = $this->makeBackupTable('Kelas - Jadwal', $jadwalRows);
        $tables[] = $this->makeBackupTable('Kelas - Absensi', $absensiRows);
        $tables[] = $this->makeBackupTable('Kelas - Ajuan Absensi', $ajuanRows);
        $tables[] = $this->makeBackupTable('Kelas - Pengaturan Absensi', $absensiSettingsRows);
        $tables[] = $this->makeBackupTable('Kelas - Tugas', $taskRows);
        $tables[] = $this->makeBackupTable('Kelas - Jawaban Tugas', $taskAnswerRows);
        $tables[] = $this->makeBackupTable('Kelas - Quiz', $quizRows);
        $tables[] = $this->makeBackupTable('Kelas - Soal Quiz', $questionRows);
        $tables[] = $this->makeBackupTable('Kelas - Opsi Quiz', $optionRows);
        $tables[] = $this->makeBackupTable('Kelas - Submission Quiz', $submissionRows);
        $tables[] = $this->makeBackupTable('Kelas - Jawaban Quiz', $answerRows);
        $tables[] = $this->makeBackupTable('Kelas - Log Ulang Quiz', $retakeRows);
        $tables[] = $this->makeBackupTable('Kelas - Monitoring Jam Kosong', $jamKosongRows);
        $tables[] = $this->makeBackupTable('Kelas - Scan Kehadiran', $scanTempRows);

        $studentCountByClass = [];
        foreach ($studentsRows as $row) {
            $kelas = (string) $this->rowValue($row, $classColumnProfiles ?: 'kelas');
            if ($kelas !== '') {
                $studentCountByClass[$kelas] = ($studentCountByClass[$kelas] ?? 0) + 1;
            }
        }

        $jadwalCountByClass = [];
        foreach ($jadwalRows as $row) {
            $kelas = (string) $this->rowValue($row, 'kelas_id');
            if ($kelas !== '') {
                $jadwalCountByClass[$kelas] = ($jadwalCountByClass[$kelas] ?? 0) + 1;
            }
        }

        $taskCountByClass = [];
        foreach ($taskRows as $row) {
            $kelas = (string) $this->rowValue($row, $classColumnTugas ?: 'kelas');
            if ($kelas !== '') {
                $taskCountByClass[$kelas] = ($taskCountByClass[$kelas] ?? 0) + 1;
            }
        }

        $quizCountByClass = [];
        foreach ($quizRows as $row) {
            $kelas = (string) $this->rowValue($row, $classColumnQuiz ?: 'kelas_id');
            if ($kelas !== '') {
                $quizCountByClass[$kelas] = ($quizCountByClass[$kelas] ?? 0) + 1;
            }
        }

        $absensiCountByClass = [];
        foreach ($absensiRows as $row) {
            $kelas = (string) $this->rowValue($row, $classColumnAbsensi ?: 'kelas');
            if ($kelas !== '') {
                $absensiCountByClass[$kelas] = ($absensiCountByClass[$kelas] ?? 0) + 1;
            }
        }

        $waliByClass = [];
        foreach ($strukturRows as $row) {
            $kelas = (string) $this->rowValue($row, 'kelas_id');
            if ($kelas === '') {
                continue;
            }
            $waliByClass[$kelas] = $this->rowValue($row, 'wali_guru_nama') ?: $this->rowValue($row, 'wali_guru_id');
        }

        $summaryRows = [];
        foreach ($classRows as $index => $classRow) {
            $classId = (string) $this->rowValue($classRow, 'id');
            if ($classId === '') {
                continue;
            }

            $summaryRows[] = [
                'no' => $index + 1,
                'kelas_id' => $classId,
                'nama_kelas' => $this->rowValue($classRow, 'nama'),
                'wali_kelas' => $waliByClass[$classId] ?? '-',
                'jumlah_siswa' => $studentCountByClass[$classId] ?? 0,
                'total_jadwal' => $jadwalCountByClass[$classId] ?? 0,
                'total_tugas' => $taskCountByClass[$classId] ?? 0,
                'total_quiz' => $quizCountByClass[$classId] ?? 0,
                'total_absensi' => $absensiCountByClass[$classId] ?? 0,
            ];
        }

        $tables[] = $this->makeBackupTable('Kelas - Ringkasan', $summaryRows);

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

    private function normalizeBackupMapel($value): string
    {
        $mapel = trim((string) ($value ?? ''));

        return $mapel !== '' ? $mapel : 'Tanpa Mapel';
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

        return $taskScore !== null
            ? round($taskScore, 2)
            : ($quizScore !== null ? round($quizScore, 2) : null);
    }
}
