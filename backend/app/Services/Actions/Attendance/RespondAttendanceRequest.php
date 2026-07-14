<?php

namespace App\Services\Actions\Attendance;

use App\Models\Absensi;
use App\Models\AbsensiAjuan;
use App\Models\Profile;
use Illuminate\Support\Facades\DB;

class RespondAttendanceRequest
{
    public function execute(AbsensiAjuan $request, string $action, Profile $actor, string $tenantId): AbsensiAjuan
    {
        return DB::transaction(function () use ($request, $action, $actor, $tenantId) {
            $request = AbsensiAjuan::whereKey($request->id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->firstOrFail();

            if ($request->status_guru !== 'pending') {
                throw new \LogicException('ATTENDANCE_REQUEST_ALREADY_PROCESSED');
            }

            $before = $request->only(['status_guru', 'kategori_final', 'guru_id', 'waktu_respon']);
            $status = match ($action) {
                'izin' => 'Izin',
                'sakit' => 'Sakit',
                default => null,
            };

            if ($status !== null) {
                $attendance = Absensi::where('tenant_id', $tenantId)
                    ->where('uid', $request->uid)
                    ->whereDate('tanggal', $request->tanggal)
                    ->where('kelas', $request->kelas)
                    ->where('mapel', $request->mapel)
                    ->lockForUpdate()
                    ->first();

                if (! $attendance) {
                    $attendance = new Absensi;
                    $attendance->tenant_id = $tenantId;
                    $attendance->uid = $request->uid;
                    $attendance->kelas = $request->kelas;
                    $attendance->tanggal = $request->tanggal;
                    $attendance->mapel = $request->mapel;
                    $attendance->tahun_ajaran = $request->tahun_ajaran;
                    $attendance->semester = $request->semester;
                    $attendance->nama = $request->nama;
                    $attendance->waktu = now();
                }
                $attendance->status = $status;
                $attendance->komentar = $request->alasan ?: "{$status} (Ajuan)";
                $attendance->oleh = $actor->nama;
                $attendance->dikonfirmasi = $actor->id;
                $attendance->save();
            }

            $request->status_guru = match ($action) {
                'izin' => 'terima',
                'sakit' => 'sakit',
                default => 'tolak',
            };
            $request->kategori_final = $status;
            $request->guru_id = $actor->id;
            $request->guru_nama = $actor->nama;
            $request->waktu_respon = now();
            $request->save();

            DB::table('audit_log')->insert([
                'tenant_id' => $tenantId,
                'table_name' => 'absensi_ajuan',
                'record_id' => $request->id,
                'action' => 'UPDATE',
                'old_data' => json_encode($before),
                'new_data' => json_encode($request->only(['status_guru', 'kategori_final', 'guru_id', 'waktu_respon'])),
                'user_id' => $actor->id,
                'user_role' => $actor->role,
                'timestamp' => now(),
            ]);

            return $request->fresh(['profile']);
        });
    }
}
