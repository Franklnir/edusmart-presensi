<?php

namespace App\Services\Actions\Attendance;

use App\Models\Absensi;
use App\Models\Profile;
use Illuminate\Support\Facades\DB;

class CreateAttendance
{
    public function execute(array $data, Profile $creator, string $tenantId): Absensi
    {
        return DB::transaction(function () use ($data, $creator, $tenantId) {
            $profile = Profile::whereKey($data['uid'])
                ->where('tenant_id', $tenantId)
                ->where('role', 'siswa')
                ->lockForUpdate()
                ->firstOrFail();

            $existing = Absensi::where('tenant_id', $tenantId)
                ->where('uid', $profile->id)
                ->whereDate('tanggal', $data['tanggal'])
                ->where('kelas', $data['kelas'])
                ->where('mapel', $data['mapel'] ?? '')
                ->lockForUpdate()
                ->first();
            if ($existing) {
                throw new \LogicException('ATTENDANCE_ALREADY_EXISTS');
            }

            $attendance = new Absensi;
            $attendance->tenant_id = $tenantId;
            $attendance->uid = $profile->id;
            $attendance->kelas = $data['kelas'];
            $attendance->tanggal = $data['tanggal'];
            $attendance->status = $data['status'];
            $attendance->mapel = $data['mapel'] ?? '';
            $attendance->tahun_ajaran = $data['tahun_ajaran'] ?? null;
            $attendance->semester = $data['semester'] ?? null;
            $attendance->nama = $profile->nama;
            $attendance->waktu = now();
            $attendance->komentar = $data['komentar'] ?? null;
            $attendance->oleh = $creator->nama;
            $attendance->dikonfirmasi = $creator->id;
            $attendance->save();

            DB::table('audit_log')->insert([
                'tenant_id' => $tenantId,
                'table_name' => 'absensi',
                'record_id' => (string) $attendance->id,
                'action' => 'INSERT',
                'old_data' => null,
                'new_data' => json_encode($attendance->only(['uid', 'kelas', 'tanggal', 'mapel', 'status'])),
                'user_id' => $creator->id,
                'user_role' => $creator->role,
                'timestamp' => now(),
            ]);

            return $attendance->load('profile');
        });
    }
}
