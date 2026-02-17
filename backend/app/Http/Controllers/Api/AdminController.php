<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminController extends ApiController
{
    public function monitoring(Request $request)
    {
        if (!$this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $activeSeconds = (int) $request->query('active_sec', 120);
        if ($activeSeconds < 30) $activeSeconds = 30;
        if ($activeSeconds > 900) $activeSeconds = 900;

        $activeCutoff = now()->subSeconds($activeSeconds)->toDateTimeString();

        $presenceAgg = DB::table('user_presence')
            ->select(
                'user_id',
                DB::raw("max(last_seen_at) as last_seen_at"),
                DB::raw("sum(case when last_seen_at >= '{$activeCutoff}' then 1 else 0 end) as active_devices"),
                DB::raw("sum(case when last_seen_at >= '{$activeCutoff}' then activity_count else 0 end) as activity_count")
            )
            ->where('tenant_id', $tenantId)
            ->groupBy('user_id');

        $rows = DB::table('profiles as p')
            ->leftJoinSub($presenceAgg, 'pr', 'p.id', '=', 'pr.user_id')
            ->where('p.tenant_id', $tenantId)
            ->whereIn('p.role', ['siswa', 'guru'])
            ->select(
                'p.id',
                'p.nama',
                'p.email',
                'p.nis',
                'p.role',
                'p.kelas',
                'pr.last_seen_at',
                'pr.active_devices',
                'pr.activity_count'
            )
            ->get();

        $students = [];
        $teachers = [];

        foreach ($rows as $row) {
            $activeDevices = (int) ($row->active_devices ?? 0);
            $item = [
                'id' => $row->id,
                'nama' => $row->nama,
                'email' => $row->email,
                'nis' => $row->nis,
                'kelas' => $row->kelas,
                'role' => $row->role,
                'online' => $activeDevices > 0,
                'last_seen_at' => $row->last_seen_at,
                'active_devices' => $activeDevices,
                'activity_count' => (int) ($row->activity_count ?? 0),
            ];

            if ($row->role === 'siswa') {
                $students[] = $item;
            } else {
                $teachers[] = $item;
            }
        }

        $sortWithActivity = function ($a, $b) {
            if ($a['online'] !== $b['online']) return $a['online'] ? -1 : 1;
            if ($a['online']) {
                if ($a['activity_count'] !== $b['activity_count']) {
                    return $b['activity_count'] <=> $a['activity_count'];
                }
            }
            $aSeen = $a['last_seen_at'] ?? '';
            $bSeen = $b['last_seen_at'] ?? '';
            return strcmp($bSeen, $aSeen);
        };

        $sortByLastSeen = function ($a, $b) {
            if ($a['online'] !== $b['online']) return $a['online'] ? -1 : 1;
            $aSeen = $a['last_seen_at'] ?? '';
            $bSeen = $b['last_seen_at'] ?? '';
            return strcmp($bSeen, $aSeen);
        };

        usort($students, $sortWithActivity);
        usort($teachers, $sortByLastSeen);

        return response()->json([
            'data' => [
                'students' => $students,
                'teachers' => $teachers,
                'active_seconds' => $activeSeconds,
                'generated_at' => now()->toISOString(),
            ]
        ]);
    }

    public function deleteUser(Request $request, string $id)
    {
        if (!$this->isAdmin($request)) {
            return $this->deny();
        }
        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $profile = DB::table('profiles')->where('id', $id)->where('tenant_id', $tenantId)->first();
        if (!$profile) {
            return $this->deny('User tidak ditemukan', 404);
        }

        $role = strtolower((string) ($profile->role ?? ''));
        if (!in_array($role, ['guru', 'teacher', 'siswa'], true)) {
            return $this->deny('Hanya role guru/siswa yang boleh dihapus', 409);
        }

        $currentUserId = (string) ($request->user()?->id ?? '');
        if ($currentUserId !== '' && $currentUserId === $id) {
            return $this->deny('Tidak bisa menghapus akun sendiri', 409);
        }

        $oldData = (array) $profile;

        try {
            DB::transaction(function () use ($id, $role) {
                $this->cleanupBeforeHardDelete($id, $role);

                $deleted = DB::table('users')->where('id', $id)->delete();
                if ($deleted === 0) {
                    DB::table('profiles')->where('id', $id)->delete();
                }
            });
        } catch (\Throwable $e) {
            return $this->deny('Gagal menghapus user, masih ada data yang terkait.', 409);
        }

        $this->logAudit($request, 'profiles', $id, 'DELETE', $oldData, null, $tenantId);

        return response()->json(['data' => 'deleted']);
    }

    private function cleanupBeforeHardDelete(string $userId, string $role): void
    {
        $now = now();

        // FK audit_log.user_id -> profiles.id (non-cascade), wajib dinullkan dulu
        DB::table('audit_log')->where('user_id', $userId)->update(['user_id' => null]);

        // Referensi text/non-cascade yang sering menahan delete
        DB::table('kelas_struktur')
            ->where('ketua_siswa_id', $userId)
            ->update([
                'ketua_siswa_id' => null,
                'ketua_siswa_nama' => null,
                'updated_at' => $now,
            ]);

        DB::table('organisasi_anggota')->where('siswa_id', $userId)->delete();
        DB::table('absensi_eskul')->where('user_id', $userId)->delete();

        // Referensi ke users.id (non-cascade)
        DB::table('templat_sertifikat_publik')
            ->where('created_by', $userId)
            ->update([
                'created_by' => null,
                'updated_at' => $now,
            ]);

        // Referensi ke profiles.id (non-cascade)
        DB::table('tugas')
            ->where('created_by', $userId)
            ->update([
                'created_by' => null,
                'updated_at' => $now,
            ]);

        if (in_array($role, ['guru', 'teacher'], true)) {
            DB::table('jadwal')->where('guru_id', $userId)->delete();

            DB::table('kelas_struktur')
                ->where('wali_guru_id', $userId)
                ->update([
                    'wali_guru_id' => null,
                    'wali_guru_nama' => null,
                    'updated_at' => $now,
                ]);

            DB::table('struktur_sekolah')->where('guru_id', $userId)->delete();

            DB::table('organisasi')
                ->where('pembina_guru_id', $userId)
                ->update([
                    'pembina_guru_id' => null,
                    'pembina_guru_nama' => null,
                    'updated_at' => $now,
                ]);

            DB::table('ekskul')
                ->where('pembina_guru_id', $userId)
                ->update([
                    'pembina_guru_id' => null,
                    'updated_at' => $now,
                ]);

            DB::table('absensi_ajuan')
                ->where('guru_id', $userId)
                ->update([
                    'guru_id' => null,
                    'guru_nama' => null,
                ]);

            DB::table('quizzes')->where('guru_id', $userId)->delete();
        }
    }
}
