<?php

namespace App\Services\Actions\Attendance;

use App\Models\Absensi;
use App\Models\Profile;
use Illuminate\Support\Facades\DB;

class UpdateAttendance
{
    public function execute(Absensi $attendance, array $data, Profile $updater, string $tenantId): Absensi
    {
        return DB::transaction(function () use ($attendance, $data, $updater, $tenantId) {
            $attendance = Absensi::whereKey($attendance->id)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->firstOrFail();
            $before = $attendance->only(['status', 'komentar']);

            if (array_key_exists('status', $data)) {
                $attendance->status = $data['status'];
            }
            if (array_key_exists('komentar', $data)) {
                $attendance->komentar = $data['komentar'];
            }

            $attendance->oleh = $updater->nama;
            $attendance->dikonfirmasi = $updater->id;
            $attendance->save();

            DB::table('audit_log')->insert([
                'tenant_id' => $tenantId,
                'table_name' => 'absensi',
                'record_id' => (string) $attendance->id,
                'action' => 'UPDATE',
                'old_data' => json_encode($before),
                'new_data' => json_encode($attendance->only(['status', 'komentar'])),
                'user_id' => $updater->id,
                'user_role' => $updater->role,
                'timestamp' => now(),
            ]);

            return $attendance->load('profile');
        });
    }
}
