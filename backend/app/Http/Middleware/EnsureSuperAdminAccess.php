<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class EnsureSuperAdminAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (! $user || ! $this->isSuperAdminIdentity((string) ($user->id ?? ''))) {
            return response()->json(['message' => 'Akses super admin ditolak'], 403);
        }

        return $next($request);
    }

    private function isSuperAdminIdentity(string $userId): bool
    {
        $userId = trim($userId);
        if ($userId === '') {
            return false;
        }

        try {
            if (DB::table('super_admins')->where('user_id', $userId)->exists()) {
                return true;
            }
        } catch (\Throwable $e) {
            // Fallback ke env saat migrasi awal atau tabel belum tersedia.
        }

        return in_array($userId, config('superadmin.ids', []), true);
    }
}
