<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureSuperAdminDomain
{
    public function handle(Request $request, Closure $next): Response
    {
        $host = strtolower(trim((string) $request->getHost()));
        if ($this->isAllowedHost($host)) {
            return $next($request);
        }

        return response()->json([
            'error' => $this->errorMessage(),
        ], 403);
    }

    private function isAllowedHost(string $host): bool
    {
        if ($host === '') {
            return false;
        }

        $adminHosts = array_map('strtolower', config('tenancy.admin_hosts', []));
        if (in_array($host, $adminHosts, true)) {
            return true;
        }

        $root = strtolower(trim((string) config('tenancy.root_domain', '')));
        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin')));
        $allowRoot = (bool) config('tenancy.allow_root_for_super_admin', false);

        if ($root !== '') {
            $adminHost = $adminSubdomain !== '' ? ($adminSubdomain . '.' . $root) : $root;
            if ($host === $adminHost) {
                return true;
            }
            if ($allowRoot && $host === $root) {
                return true;
            }
        }

        // Local development fallback.
        if ($host === $adminSubdomain . '.localhost' || $host === $adminSubdomain . '.127.0.0.1') {
            return true;
        }
        if ($allowRoot && ($host === 'localhost' || $host === '127.0.0.1')) {
            return true;
        }

        return false;
    }

    private function errorMessage(): string
    {
        $root = strtolower(trim((string) config('tenancy.root_domain', '')));
        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin')));
        if ($root === '') {
            return 'Panel super admin hanya bisa diakses dari domain admin.';
        }

        $adminHost = $adminSubdomain !== '' ? ($adminSubdomain . '.' . $root) : $root;
        return 'Panel super admin hanya bisa diakses dari ' . $adminHost;
    }
}

