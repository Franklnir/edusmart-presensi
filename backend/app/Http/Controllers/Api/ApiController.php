<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Profile;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ApiController extends Controller
{
    protected function user(Request $request)
    {
        return $request->user();
    }

    protected function profile(Request $request): ?Profile
    {
        $user = $this->user($request);
        if (! $user) {
            return null;
        }

        if ($user->relationLoaded('profile')) {
            return $user->profile;
        }

        $tenantId = $this->tenantId($request);
        $query = Profile::query()->where('id', $user->id);
        if ($tenantId) {
            $query->where('tenant_id', $tenantId);
        }
        $profile = $query->first();
        $user->setRelation('profile', $profile);

        return $profile;
    }

    protected function role(Request $request): ?string
    {
        $profile = $this->profile($request);

        return $profile?->role;
    }

    protected function isAdmin(Request $request): bool
    {
        if ($this->isSuperAdminIdentity($request)) {
            return true;
        }

        return $this->role($request) === 'admin';
    }

    protected function isSuperAdmin(Request $request): bool
    {
        return $this->isSuperAdminIdentity($request);
    }

    protected function isSuperAdminIdentity(Request $request): bool
    {
        $user = $this->user($request);
        if (! $user) {
            return false;
        }

        return $this->isSuperAdminByIdentity(
            $user->id ? (string) $user->id : null,
            $user->email ? (string) $user->email : null
        );
    }

    protected function isGuru(Request $request): bool
    {
        $role = $this->role($request);

        return $role === 'guru' || $role === 'teacher';
    }

    protected function isSiswa(Request $request): bool
    {
        return $this->role($request) === 'siswa';
    }

    protected function currentKelas(Request $request): ?string
    {
        return $this->profile($request)?->kelas;
    }

    protected function deny(string $message = 'Akses ditolak', int $code = 403)
    {
        return response()->json(['error' => $message], $code);
    }

    protected function tenantId(Request $request): ?string
    {
        return $request->attributes->get('tenant_id');
    }

    protected function profileTenantId(Request $request): ?string
    {
        $user = $this->user($request);
        if (! $user?->id) {
            return null;
        }

        try {
            $tenantId = Profile::query()
                ->where('id', $user->id)
                ->value('tenant_id');
            if (! $tenantId) {
                return null;
            }

            return (string) $tenantId;
        } catch (\Throwable $e) {
            return null;
        }
    }

    protected function resolveOwnedTenantId(Request $request): ?string
    {
        $profileTenantId = $this->profileTenantId($request);
        if ($profileTenantId) {
            return $profileTenantId;
        }

        return $this->tenantId($request);
    }

    protected function ok($data = null)
    {
        return response()->json(['data' => $data]);
    }

    protected function applyPagination($query, Request $request)
    {
        $limit = (int) $request->query('limit', 0);
        $offset = (int) $request->query('offset', 0);

        if ($limit > 0) {
            $query->limit(min($limit, 1000));
        }
        if ($offset > 0) {
            $query->offset($offset);
        }

        return $query;
    }

    protected function logAudit(
        Request $request,
        string $table,
        string $recordId,
        string $action,
        $oldData = null,
        $newData = null,
        ?string $tenantId = null
    ): void {
        try {
            $profile = $this->profile($request);
            $userId = $profile?->id ?? $request->user()?->id;
            $payload = [
                'table_name' => $table,
                'record_id' => $recordId,
                'action' => strtoupper($action),
                'old_data' => $oldData !== null ? json_encode($oldData) : null,
                'new_data' => $newData !== null ? json_encode($newData) : null,
                'user_id' => $userId,
                'user_role' => $profile?->role,
                'timestamp' => now(),
            ];

            $tenantId = $tenantId ?? $this->tenantId($request);
            if ($tenantId) {
                $payload['tenant_id'] = $tenantId;
            }

            DB::table('audit_log')->insert($payload);
        } catch (\Throwable $e) {
            // jangan block proses utama jika audit gagal
        }
    }

    protected function syncTeacherDisplayNameSnapshots(
        string $tenantId,
        string $teacherId,
        string $displayName,
        Carbon $now
    ): array {
        $teacherName = preg_replace('/\s+/', ' ', trim($displayName)) ?? '';
        if ($tenantId === '' || $teacherId === '' || $teacherName === '') {
            return [
                'jadwal' => 0,
                'kelas_struktur' => 0,
                'struktur_sekolah' => 0,
                'organisasi' => 0,
                'absensi_ajuan' => 0,
            ];
        }

        return [
            'jadwal' => $this->updateTenantSnapshotTable(
                'jadwal',
                ['guru_id' => $teacherId],
                ['guru_nama' => $teacherName, 'updated_at' => $now],
                $tenantId
            ),
            'kelas_struktur' => $this->updateTenantSnapshotTable(
                'kelas_struktur',
                ['wali_guru_id' => $teacherId],
                ['wali_guru_nama' => $teacherName, 'updated_at' => $now],
                $tenantId
            ),
            'struktur_sekolah' => $this->updateTenantSnapshotTable(
                'struktur_sekolah',
                ['guru_id' => $teacherId],
                ['guru_nama' => $teacherName, 'updated_at' => $now],
                $tenantId
            ),
            'organisasi' => $this->updateTenantSnapshotTable(
                'organisasi',
                ['pembina_guru_id' => $teacherId],
                ['pembina_guru_nama' => $teacherName, 'updated_at' => $now],
                $tenantId
            ),
            'absensi_ajuan' => $this->updateTenantSnapshotTable(
                'absensi_ajuan',
                ['guru_id' => $teacherId],
                ['guru_nama' => $teacherName],
                $tenantId
            ),
        ];
    }

    protected function updateTenantSnapshotTable(
        string $table,
        array $matches,
        array $values,
        string $tenantId
    ): int {
        try {
            if (! Schema::hasTable($table)) {
                return 0;
            }

            $query = DB::table($table);
            if (Schema::hasColumn($table, 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }

            foreach ($matches as $column => $value) {
                if (! Schema::hasColumn($table, $column)) {
                    return 0;
                }
                $query->where($column, $value);
            }

            $payload = [];
            foreach ($values as $column => $value) {
                if (Schema::hasColumn($table, $column)) {
                    $payload[$column] = $value;
                }
            }

            if (empty($payload)) {
                return 0;
            }

            return $query->update($payload);
        } catch (\Throwable $e) {
            return 0;
        }
    }

    protected function syncStudentDisplayNameSnapshots(
        string $tenantId,
        string $studentId,
        string $displayName,
        Carbon $now
    ): array {
        $studentName = preg_replace('/\s+/', ' ', trim($displayName)) ?? '';
        if ($tenantId === '' || $studentId === '' || $studentName === '') {
            return [
                'kelas_struktur' => 0,
                'organisasi_anggota' => 0,
                'absensi' => 0,
                'absensi_ajuan' => 0,
            ];
        }

        return [
            'kelas_struktur' => $this->updateTenantSnapshotTable(
                'kelas_struktur',
                ['ketua_siswa_id' => $studentId],
                ['ketua_siswa_nama' => $studentName, 'updated_at' => $now],
                $tenantId
            ),
            'organisasi_anggota' => $this->updateTenantSnapshotTable(
                'organisasi_anggota',
                ['siswa_id' => $studentId],
                ['nama' => $studentName, 'updated_at' => $now],
                $tenantId
            ),
            'absensi' => $this->updateTenantSnapshotTable(
                'absensi',
                ['uid' => $studentId],
                ['nama' => $studentName],
                $tenantId
            ),
            'absensi_ajuan' => $this->updateTenantSnapshotTable(
                'absensi_ajuan',
                ['uid' => $studentId],
                ['nama' => $studentName],
                $tenantId
            ),
        ];
    }

    protected function getNilaiFreezeState(Request $request): ?array
    {
        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return null;
        }

        $settings = DB::table('settings')
            ->where('tenant_id', $tenantId)
            ->orderBy('id')
            ->first([
                'nilai_freeze_enabled',
                'nilai_freeze_start',
                'nilai_freeze_end',
                'nilai_freeze_reason',
            ]);

        if (! $settings || ! (bool) ($settings->nilai_freeze_enabled ?? false)) {
            return null;
        }

        $startAt = null;
        $endAt = null;

        try {
            if (! empty($settings->nilai_freeze_start)) {
                $startAt = Carbon::parse((string) $settings->nilai_freeze_start);
            }
        } catch (\Throwable $e) {
            $startAt = null;
        }

        try {
            if (! empty($settings->nilai_freeze_end)) {
                $endAt = Carbon::parse((string) $settings->nilai_freeze_end);
            }
        } catch (\Throwable $e) {
            $endAt = null;
        }

        $now = now();
        $inRange = ($startAt === null || $now->greaterThanOrEqualTo($startAt))
            && ($endAt === null || $now->lessThanOrEqualTo($endAt));

        if (! $inRange) {
            return null;
        }

        return [
            'enabled' => true,
            'start' => $startAt ? $startAt->toIso8601String() : null,
            'end' => $endAt ? $endAt->toIso8601String() : null,
            'reason' => trim((string) ($settings->nilai_freeze_reason ?? '')) ?: null,
        ];
    }

    protected function denyIfNilaiFrozen(Request $request, string $context = 'Perubahan nilai')
    {
        $freeze = $this->getNilaiFreezeState($request);
        if (! $freeze) {
            return null;
        }

        $range = [];
        if (! empty($freeze['start'])) {
            $range[] = 'mulai '.$freeze['start'];
        }
        if (! empty($freeze['end'])) {
            $range[] = 'sampai '.$freeze['end'];
        }

        $message = $context.' dikunci karena periode nilai sedang freeze.';
        if (! empty($range)) {
            $message .= ' Periode: '.implode(' ', $range).'.';
        }
        if (! empty($freeze['reason'])) {
            $message .= ' Alasan: '.$freeze['reason'].'.';
        }

        return response()->json([
            'error' => $message,
            'code' => 'NILAI_FREEZE_ACTIVE',
            'freeze' => $freeze,
        ], 423);
    }

    protected function isSuperAdminByIdentity(?string $userId = null, ?string $email = null): bool
    {
        $normalizedId = trim((string) ($userId ?? ''));
        $normalizedEmail = strtolower(trim((string) ($email ?? '')));
        $emails = array_map('strtolower', config('superadmin.emails', []));
        $ids = config('superadmin.ids', []);
        $allowEmailFallback = (bool) config('superadmin.allow_email_fallback', false);

        try {
            if ($normalizedId !== '') {
                if (DB::table('super_admins')->where('user_id', $normalizedId)->exists()) {
                    return true;
                }
            }
        } catch (\Throwable $e) {
            // fallback ke env bila tabel belum ada
        }

        if ($normalizedId !== '' && in_array($normalizedId, $ids, true)) {
            return true;
        }

        if ($normalizedId === '' && $allowEmailFallback && $normalizedEmail !== '' && in_array($normalizedEmail, $emails, true)) {
            return true;
        }

        return false;
    }
}
