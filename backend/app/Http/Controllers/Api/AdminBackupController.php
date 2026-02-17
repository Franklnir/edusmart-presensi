<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use App\Traits\HasTenantBackupLogic;

class AdminBackupController extends ApiController
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
}