<?php

namespace App\Http\Controllers\Api;

use App\Traits\HasTenantBackupLogic;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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

    public function update(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $request->all();
        $allowed = [
            'nama_sekolah', 'logo_url', 'logo_path', 'alamat', 'telepon', 'email',
            'tahun_ajaran', 'semester_aktif',
            'registrasi_siswa_aktif', 'registrasi_guru_aktif', 'registrasi_admin_aktif',
            'scan_manual_enabled', 'manual_jam_masuk_mulai', 'manual_jam_masuk_selesai',
            'manual_jam_pulang_mulai', 'manual_jam_pulang_selesai',
            'visi', 'misi', 'link_instagram', 'link_facebook', 'link_youtube', 'link_tiktok',
            'auto_alpha_enabled',
            'ranking_weight_tugas', 'ranking_weight_quiz', 'ranking_weight_absensi',
            'ranking_tiebreak_order', 'ranking_core_mapel', 'ranking_policy_updated_at',
            'nilai_freeze_enabled', 'nilai_freeze_start', 'nilai_freeze_end', 'nilai_freeze_reason',
            'nilai_freeze_updated_by', 'nilai_freeze_updated_at',
            'approval_maker_checker_enabled', 'approval_require_second_approver',
            'anomaly_alert_enabled', 'anomaly_bulk_threshold',
        ];

        $update = array_intersect_key($payload, array_flip($allowed));
        $update['updated_at'] = now();

        $existing = DB::table('settings')->where('tenant_id', $tenantId)->orderBy('id')->first();
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
}
