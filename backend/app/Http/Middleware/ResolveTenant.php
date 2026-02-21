<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ResolveTenant
{
    public function handle(Request $request, Closure $next)
    {
        $slug = $this->resolveSlug($request);
        if (! $slug) {
            $slug = config('tenancy.default_slug', 'default');
        }

        $tenant = DB::table('tenants')->where('slug', $slug)->first();
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $isAdminHost = $this->isAdminHost((string) $request->getHost());
        if (
            ! $isAdminHost
            && ! $request->is('api/health')
            && $this->isTenantBlocked((string) ($tenant->status ?? 'active'))
        ) {
            return response()->json([
                'error' => 'Tenant saat ini tidak aktif. Hubungi super admin untuk aktivasi ulang.',
                'tenant_status' => $tenant->status,
            ], 423);
        }

        $request->attributes->set('tenant_id', $tenant->id);
        $request->attributes->set('tenant_slug', $tenant->slug);

        return $next($request);
    }

    private function resolveSlug(Request $request): ?string
    {
        $header = config('tenancy.header', 'X-Tenant');
        $allowHeaderOverride = (bool) config('tenancy.allow_header_override', false);
        $host = $request->getHost();
        $isAdminHost = $this->isAdminHost($host);
        $fromHeader = trim((string) $request->header($header, ''));
        if ($allowHeaderOverride && $fromHeader !== '') {
            if ($isAdminHost && $this->isAdminSlug($fromHeader)) {
                return null;
            }

            return $fromHeader;
        }

        if ($isAdminHost) {
            return null;
        }

        if ($this->isLocalHost($host)) {
            return null;
        }

        $root = trim((string) config('tenancy.root_domain', ''));
        $slug = '';

        if ($root !== '' && str_ends_with($host, $root)) {
            $trimmed = rtrim(substr($host, 0, -strlen($root)), '.');
            $slug = $trimmed !== '' ? explode('.', $trimmed)[0] : '';
        } else {
            $parts = explode('.', $host);
            $slug = $parts[0] ?? '';
        }

        $slug = trim((string) $slug);
        if ($slug === '' || $this->isReserved($slug)) {
            return null;
        }

        return $slug;
    }

    private function isReserved(string $slug): bool
    {
        $reserved = config('tenancy.reserved_subdomains', []);

        return in_array(strtolower($slug), array_map('strtolower', $reserved), true);
    }

    private function isAdminHost(string $host): bool
    {
        $host = strtolower(trim($host));
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
            $adminHost = $adminSubdomain !== '' ? ($adminSubdomain.'.'.$root) : $root;
            if ($host === $adminHost) {
                return true;
            }
            if ($allowRoot && $host === $root) {
                return true;
            }
        }

        if ($host === $adminSubdomain.'.localhost' || $host === $adminSubdomain.'.127.0.0.1') {
            return true;
        }

        if ($allowRoot && ($host === 'localhost' || $host === '127.0.0.1')) {
            return true;
        }

        return false;
    }

    private function isAdminSlug(string $slug): bool
    {
        $slug = strtolower(trim($slug));
        if ($slug === '') {
            return false;
        }

        $adminSubdomain = strtolower(trim((string) config('tenancy.admin_subdomain', 'admin')));

        return $slug === $adminSubdomain;
    }

    private function isLocalHost(string $host): bool
    {
        if ($host === 'localhost' || $host === '127.0.0.1') {
            return true;
        }

        return filter_var($host, FILTER_VALIDATE_IP) !== false;
    }

    private function isTenantBlocked(string $status): bool
    {
        $normalized = strtolower(trim($status));

        return in_array($normalized, ['suspended', 'archived', 'inactive', 'disabled'], true);
    }
}
