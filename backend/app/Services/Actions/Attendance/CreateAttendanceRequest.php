<?php

namespace App\Services\Actions\Attendance;

use App\Models\AbsensiAjuan;
use App\Models\Profile;
use Illuminate\Support\Facades\DB;

class CreateAttendanceRequest
{
    public function execute(array $data, Profile $student, string $tenantId): AbsensiAjuan
    {
        return DB::transaction(function () use ($data, $student, $tenantId) {
            $student = Profile::whereKey($student->id)
                ->where('tenant_id', $tenantId)
                ->where('role', 'siswa')
                ->lockForUpdate()
                ->firstOrFail();

            $existing = AbsensiAjuan::where('tenant_id', $tenantId)
                ->where('uid', $student->id)
                ->whereDate('tanggal', $data['tanggal'])
                ->where('kelas', (string) $student->kelas)
                ->where('mapel', $data['mapel'] ?? '')
                ->where('status_guru', 'pending')
                ->lockForUpdate()
                ->first();
            if ($existing) {
                throw new \LogicException('ATTENDANCE_REQUEST_ALREADY_EXISTS');
            }

            $attendanceRequest = AbsensiAjuan::create([
                'tenant_id' => $tenantId,
                'uid' => $student->id,
                'nama' => $student->nama,
                'kelas' => (string) $student->kelas,
                'tanggal' => $data['tanggal'],
                'mapel' => $data['mapel'] ?? '',
                'alasan' => $data['alasan'],
                'tahun_ajaran' => $data['tahun_ajaran'] ?? null,
                'semester' => $data['semester'] ?? null,
                'status_guru' => 'pending',
            ]);

            DB::table('audit_log')->insert([
                'tenant_id' => $tenantId,
                'table_name' => 'absensi_ajuan',
                'record_id' => $attendanceRequest->id,
                'action' => 'INSERT',
                'old_data' => null,
                'new_data' => json_encode($attendanceRequest->only(['uid', 'kelas', 'tanggal', 'mapel', 'status_guru'])),
                'user_id' => $student->id,
                'user_role' => $student->role,
                'timestamp' => now(),
            ]);

            return $attendanceRequest;
        });
    }
}
