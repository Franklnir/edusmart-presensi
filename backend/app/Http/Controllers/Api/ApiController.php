<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Profile;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ApiController extends Controller
{
    protected function user(Request $request)
    {
        return $request->user();
    }

    protected function profile(Request $request): ?Profile
    {
        $user = $this->user($request);
        if (!$user) return null;

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
        if (!$user) {
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
