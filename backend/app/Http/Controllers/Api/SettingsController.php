<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Traits\HasTenantBackupLogic;

class SettingsController extends ApiController
{
    use HasTenantBackupLogic;

    public function backup(Request $request)
    {
        if (!$this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa melakukan backup.');
        }

        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $mode = $this->normalizeBackupMode($request->query('mode'));
        $months = $this->normalizeBackupMonths($request->query('months'));

        $data = match ($mode) {
            'students' => $this->buildStudentBackupTables($tenantId, $months),
            'teachers' => $this->buildTeacherBackupTables($tenantId, $months),
            default => $this->buildFullBackupTables($tenantId, $months),
        };

        return response()->json([
            'meta' => [
                'mode' => $mode,
                'period' => $months ? "$months bulan terakhir" : "Semua waktu",
                'generated_at' => now()->toDateTimeString(),
            ],
            'data' => $data
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
        if (!$this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
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
