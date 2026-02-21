<?php

namespace App\Http\Middleware;

use App\Models\Profile;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EnsureTenantMatchesProfile
{
    public function handle(Request $request, Closure $next)
    {
        $user = $request->user();
        if (! $user) {
            return $next($request);
        }

        $tenantId = $request->attributes->get('tenant_id');
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        if ($this->isSuperAdminIdentity($user)) {
            return $next($request);
        }

        $profile = Profile::query()->where('id', $user->id)->first();
        if (! $profile) {
            return response()->json(['error' => 'Profil belum tersedia'], 403);
        }

        if ($profile->tenant_id !== $tenantId) {
            return response()->json(['error' => 'Akses tenant ditolak'], 403);
        }

        return $next($request);
    }

    private function isSuperAdminIdentity($user): bool
    {
        if (! $user) {
            return false;
        }

        $ids = config('superadmin.ids', []);

        try {
            if (DB::table('super_admins')->where('user_id', $user->id)->exists()) {
                return true;
            }
        } catch (\Throwable $e) {
            // fallback ke env bila tabel belum ada
        }

        if ($user->id && in_array($user->id, $ids, true)) {
            return true;
        }

        return false;
    }
}
