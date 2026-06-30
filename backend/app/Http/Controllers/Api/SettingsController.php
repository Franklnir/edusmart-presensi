<?php

namespace App\Http\Controllers\Api;

use App\Support\AcademicPeriod;
use App\Traits\HasTenantBackupLogic;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class SettingsController extends ApiController
{
    use HasTenantBackupLogic;

    public function backup(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa melakukan backup.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $mode = $this->normalizeBackupMode($request->query('mode'));
        $months = $this->normalizeBackupMonths($request->query('months'));
        $periodStart = $months !== null ? now()->subMonths($months)->startOfDay() : null;

        $tables = match ($mode) {
            'students' => $this->buildStudentBackupTables($tenantId, $months),
            'teachers' => $this->buildTeacherBackupTables($tenantId, $months),
            'classes' => $this->buildClassBackupTables($tenantId, $months),
            default => $this->buildFullBackupTables($tenantId, $months),
        };

        $totalRows = 0;
        foreach ($tables as $tableInfo) {
            $totalRows += (int) ($tableInfo['row_count'] ?? 0);
        }

        $tenantName = DB::table('settings')
            ->where('tenant_id', $tenantId)
            ->orderBy('id')
            ->value('nama_sekolah');

        return response()->json([
            'data' => [
                'tenant' => [
                    'id' => $tenantId,
                    'name' => $tenantName ?: 'Sekolah',
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
                'formats_supported' => ['xlsx', 'json', 'csv', 'html'],
            ],
        ]);
    }

    public function show()
    {
        $tenantId = $this->tenantId(request());
        $query = DB::table('settings')->orderBy('id');
        if ($tenantId) {
            $query->where('tenant_id', $tenantId);
        }
        $row = $query->first();

        return response()->json(['data' => $row]);
    }

    public function scanShow(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        return $this->ok($this->scanSettingsPayload($request, (string) $tenantId));
    }

    public function scanUpdate(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        if (! $this->canUpdateScanSettings($request, (string) $tenantId)) {
            return $this->deny(
                'Guru biasa hanya bisa melihat Pengaturan Scan Manual. Perubahan hanya bisa dilakukan admin sekolah, wali kelas, atau guru berjabatan.',
                403
            );
        }

        $existing = DB::table('settings')
            ->where('tenant_id', $tenantId)
            ->orderBy('id')
            ->first();

        $payload = $request->all();
        $update = [];
        $supportsAlwaysActive = Schema::hasColumn('settings', 'scan_always_active');

        foreach (['scan_manual_enabled', 'auto_alpha_enabled'] as $field) {
            if (array_key_exists($field, $payload) && Schema::hasColumn('settings', $field)) {
                $update[$field] = $this->booleanValue($payload[$field]);
            }
        }

        if (array_key_exists('scan_always_active', $payload)) {
            $alwaysActive = $this->booleanValue($payload['scan_always_active']);
            if ($supportsAlwaysActive) {
                $update['scan_always_active'] = $alwaysActive;
            }

            // Database lama belum punya kolom scan_always_active. Pakai toggle manual
            // sebagai fallback supaya simpan dari UI tidak gagal dan scanner tetap aktif.
            if (! $supportsAlwaysActive || $alwaysActive) {
                $update['scan_manual_enabled'] = $alwaysActive;
            }
        }

        foreach ([
            'manual_jam_masuk_mulai',
            'manual_jam_masuk_selesai',
            'manual_jam_pulang_mulai',
            'manual_jam_pulang_selesai',
        ] as $field) {
            if (! array_key_exists($field, $payload) || ! Schema::hasColumn('settings', $field)) {
                continue;
            }

            $time = $this->normalizeScanTime($payload[$field]);
            if ($time === false) {
                return $this->deny('Format jam scan harus HH:MM.', 422);
            }

            $update[$field] = $time;
        }

        if (empty($update)) {
            return $this->ok($this->scanSettingsPayload($request, (string) $tenantId));
        }

        $merged = array_merge((array) ($existing ?? []), $update);
        $rangeError = $this->validateScanTimeRanges($merged);
        if ($rangeError) {
            return $this->deny($rangeError, 422);
        }

        $update['updated_at'] = now();

        if ($existing) {
            DB::table('settings')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->update($update);
        } else {
            $update['tenant_id'] = $tenantId;
            if (Schema::hasColumn('settings', 'created_at')) {
                $update['created_at'] = now();
            }
            DB::table('settings')->insert($update);
        }

        return $this->ok($this->scanSettingsPayload($request, (string) $tenantId));
    }

    public function update(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $existing = DB::table('settings')->where('tenant_id', $tenantId)->orderBy('id')->first();
        $payload = $request->all();
        $allowed = [
            'nama_sekolah', 'logo_url', 'logo_path', 'alamat', 'telepon', 'email',
            'tahun_ajaran', 'semester_aktif', 'periode_mulai', 'periode_selesai',
            'registrasi_siswa_aktif', 'registrasi_guru_aktif', 'registrasi_admin_aktif',
            'scan_manual_enabled', 'scan_always_active', 'manual_jam_masuk_mulai', 'manual_jam_masuk_selesai',
            'manual_jam_pulang_mulai', 'manual_jam_pulang_selesai',
            'visi', 'misi', 'link_instagram', 'link_facebook', 'link_youtube', 'link_tiktok',
            'auto_alpha_enabled',
            'anomaly_alert_enabled', 'anomaly_bulk_threshold',
        ];

        $update = array_intersect_key($payload, array_flip($allowed));
        if (array_key_exists('tahun_ajaran', $update)) {
            $year = AcademicPeriod::normalizeAcademicYear($update['tahun_ajaran']);
            if (! $year) {
                return $this->deny('Tahun ajaran harus berformat 2025/2026', 422);
            }
            $update['tahun_ajaran'] = $year;
        }

        if (array_key_exists('semester_aktif', $update)) {
            $semester = AcademicPeriod::normalizeSemester($update['semester_aktif']);
            if (! $semester) {
                return $this->deny('Semester aktif harus Ganjil atau Genap', 422);
            }
            $update['semester_aktif'] = $semester;
        }

        if (array_key_exists('periode_mulai', $update) || array_key_exists('periode_selesai', $update)) {
            $periodPayload = array_merge((array) ($existing ?? []), $update);
            $year = AcademicPeriod::normalizeAcademicYear($periodPayload['tahun_ajaran'] ?? null);
            $startsAt = AcademicPeriod::normalizeDate($periodPayload['periode_mulai'] ?? null);
            $endsAt = AcademicPeriod::normalizeDate($periodPayload['periode_selesai'] ?? null);

            if (! $year || ! $startsAt || ! $endsAt || empty(AcademicPeriod::customMonths($year, $startsAt, $endsAt))) {
                return $this->deny('Rentang bulan periode harus berada dalam tahun ajaran aktif dan tanggal mulai tidak boleh melewati tanggal selesai.', 422);
            }

            $period = AcademicPeriod::make($year, $periodPayload['semester_aktif'] ?? null, $startsAt, $endsAt);
            $update['periode_mulai'] = $period['starts_at'];
            $update['periode_selesai'] = $period['ends_at'];
        }

        $update['updated_at'] = now();

        if ($existing) {
            DB::table('settings')->where('id', $existing->id)->where('tenant_id', $tenantId)->update($update);
            $row = DB::table('settings')->where('id', $existing->id)->where('tenant_id', $tenantId)->first();
        } else {
            $update['tenant_id'] = $tenantId;
            $id = DB::table('settings')->insertGetId($update);
            $row = DB::table('settings')->where('id', $id)->where('tenant_id', $tenantId)->first();
        }

        return response()->json(['data' => $row]);
    }

    private function scanSettingsForTenant(string $tenantId): array
    {
        $columns = array_values(array_filter([
            Schema::hasColumn('settings', 'id') ? 'id' : null,
            Schema::hasColumn('settings', 'tenant_id') ? 'tenant_id' : null,
            Schema::hasColumn('settings', 'scan_manual_enabled') ? 'scan_manual_enabled' : null,
            Schema::hasColumn('settings', 'scan_always_active') ? 'scan_always_active' : null,
            Schema::hasColumn('settings', 'manual_jam_masuk_mulai') ? 'manual_jam_masuk_mulai' : null,
            Schema::hasColumn('settings', 'manual_jam_masuk_selesai') ? 'manual_jam_masuk_selesai' : null,
            Schema::hasColumn('settings', 'manual_jam_pulang_mulai') ? 'manual_jam_pulang_mulai' : null,
            Schema::hasColumn('settings', 'manual_jam_pulang_selesai') ? 'manual_jam_pulang_selesai' : null,
            Schema::hasColumn('settings', 'auto_alpha_enabled') ? 'auto_alpha_enabled' : null,
            Schema::hasColumn('settings', 'updated_at') ? 'updated_at' : null,
        ]));

        $row = DB::table('settings')
            ->where('tenant_id', $tenantId)
            ->orderBy('id')
            ->first($columns ?: ['*']);

        $data = $row ? (array) $row : [];
        $supportsAlwaysActive = Schema::hasColumn('settings', 'scan_always_active');

        return [
            'id' => $data['id'] ?? null,
            'scan_manual_enabled' => (bool) ($data['scan_manual_enabled'] ?? false),
            'scan_always_active' => $supportsAlwaysActive
                ? (bool) ($data['scan_always_active'] ?? true)
                : (bool) ($data['scan_manual_enabled'] ?? true),
            'manual_jam_masuk_mulai' => $this->formatTimeForInput($data['manual_jam_masuk_mulai'] ?? null, '06:00'),
            'manual_jam_masuk_selesai' => $this->formatTimeForInput($data['manual_jam_masuk_selesai'] ?? null, '08:00'),
            'manual_jam_pulang_mulai' => $this->formatTimeForInput($data['manual_jam_pulang_mulai'] ?? null, '14:00'),
            'manual_jam_pulang_selesai' => $this->formatTimeForInput($data['manual_jam_pulang_selesai'] ?? null, '16:00'),
            'auto_alpha_enabled' => (bool) ($data['auto_alpha_enabled'] ?? true),
            'schema_supports_scan_always_active' => $supportsAlwaysActive,
            'updated_at' => $data['updated_at'] ?? null,
        ];
    }

    private function scanSettingsPayload(Request $request, string $tenantId): array
    {
        return array_merge($this->scanSettingsForTenant($tenantId), [
            'can_update_settings' => $this->canUpdateScanSettings($request, $tenantId),
        ]);
    }

    private function canUpdateScanSettings(Request $request, string $tenantId): bool
    {
        if ($this->isSuperAdminIdentity($request)) {
            return true;
        }

        $profile = $this->profile($request);
        $role = strtolower((string) ($profile?->role ?? ''));
        if ($role === 'admin') {
            return true;
        }

        if (! in_array($role, ['guru', 'teacher'], true)) {
            return false;
        }

        $teacherId = (string) ($request->user()?->id ?? $profile?->id ?? '');
        if ($teacherId === '') {
            return false;
        }

        if ($this->teacherHasActiveHomeroomContext($tenantId, $teacherId)) {
            return true;
        }

        if ($this->teacherHasActivePositionContext($tenantId, $teacherId, $profile?->jabatan ?? null)) {
            return true;
        }

        return $this->teacherHasDelegatedScanManagerContext($tenantId, $teacherId);
    }

    private function teacherHasActiveHomeroomContext(string $tenantId, string $teacherId): bool
    {
        if ($teacherId === '' || ! Schema::hasTable('kelas_struktur') || ! Schema::hasColumn('kelas_struktur', 'wali_guru_id')) {
            return false;
        }

        $query = DB::table('kelas_struktur')
            ->where('wali_guru_id', $teacherId);
        $this->scopeTenant($query, 'kelas_struktur', $tenantId);
        $this->scopeActiveAcademicPeriod($query, 'kelas_struktur', $tenantId);

        return $query->exists();
    }

    private function teacherHasActivePositionContext(string $tenantId, string $teacherId, mixed $profilePosition = null): bool
    {
        $position = trim((string) ($profilePosition ?? ''));
        if ($position !== '' && $position !== '-') {
            return true;
        }

        if ($teacherId === '' || ! Schema::hasTable('struktur_sekolah') || ! Schema::hasColumn('struktur_sekolah', 'guru_id')) {
            return false;
        }

        $query = DB::table('struktur_sekolah')
            ->where('guru_id', $teacherId);
        $this->scopeTenant($query, 'struktur_sekolah', $tenantId);
        $this->scopeActiveAcademicPeriod($query, 'struktur_sekolah', $tenantId);

        return $query->exists();
    }

    private function teacherHasDelegatedScanManagerContext(string $tenantId, string $teacherId): bool
    {
        if ($teacherId === '' || ! Schema::hasTable('admin_feature_permissions')) {
            return false;
        }

        $query = DB::table('admin_feature_permissions')
            ->where('target_teacher_id', $teacherId)
            ->where('feature_key', 'scan-kehadiran')
            ->where('is_active', true)
            ->whereIn('target_type', ['homeroom', 'position']);
        $this->scopeTenant($query, 'admin_feature_permissions', $tenantId);

        return $query->exists();
    }

    private function scopeTenant($query, string $table, string $tenantId): void
    {
        if ($tenantId !== '' && Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }
    }

    private function scopeActiveAcademicPeriod($query, string $table, string $tenantId): void
    {
        if (! Schema::hasTable('settings')) {
            return;
        }

        $columns = array_values(array_filter([
            Schema::hasColumn('settings', 'tahun_ajaran') ? 'tahun_ajaran' : null,
            Schema::hasColumn('settings', 'semester_aktif') ? 'semester_aktif' : null,
        ]));
        if ($columns === []) {
            return;
        }

        $settings = DB::table('settings')
            ->when(Schema::hasColumn('settings', 'tenant_id'), fn ($builder) => $builder->where('tenant_id', $tenantId))
            ->orderBy('id')
            ->first($columns);

        $year = trim((string) ($settings->tahun_ajaran ?? ''));
        $semester = trim((string) ($settings->semester_aktif ?? ''));

        if ($year !== '' && Schema::hasColumn($table, 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $year);
        }

        if ($semester !== '' && Schema::hasColumn($table, 'semester')) {
            $query->where('semester', $semester);
        }
    }

    private function booleanValue($value): bool
    {
        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false;
    }

    private function normalizeScanTime($value): string|false|null
    {
        if ($value === null || $value === '') {
            return null;
        }

        $time = trim((string) $value);
        if (! preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/', $time)) {
            return false;
        }

        return substr($time, 0, 5);
    }

    private function validateScanTimeRanges(array $settings): ?string
    {
        $masukMulai = $this->formatTimeForInput($settings['manual_jam_masuk_mulai'] ?? null, null);
        $masukSelesai = $this->formatTimeForInput($settings['manual_jam_masuk_selesai'] ?? null, null);
        $pulangMulai = $this->formatTimeForInput($settings['manual_jam_pulang_mulai'] ?? null, null);
        $pulangSelesai = $this->formatTimeForInput($settings['manual_jam_pulang_selesai'] ?? null, null);

        if (! $masukMulai || ! $masukSelesai || ! $pulangMulai || ! $pulangSelesai) {
            return null;
        }

        if ($masukMulai >= $masukSelesai) {
            return 'Jam mulai scan MASUK harus lebih kecil dari jam selesai.';
        }

        if ($pulangMulai >= $pulangSelesai) {
            return 'Jam mulai scan PULANG harus lebih kecil dari jam selesai.';
        }

        if ($masukSelesai > $pulangMulai) {
            return 'Rentang scan MASUK dan PULANG tidak boleh bertumpukan.';
        }

        return null;
    }

    private function formatTimeForInput($value, ?string $fallback): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return $fallback;
        }

        return preg_match('/^(\d{2}:\d{2})/', $raw, $match) ? $match[1] : $fallback;
    }
}
