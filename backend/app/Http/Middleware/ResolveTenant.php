<?php

namespace App\Http\Middleware;

use App\Support\Tenancy\TenantDomainService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ResolveTenant
{
    public function __construct(
        private readonly TenantDomainService $tenantDomainService
    ) {}

    public function handle(Request $request, Closure $next)
    {
        $host = strtolower(trim((string) $request->getHost()));
        $slug = $this->resolveHeaderTenantSlug($request);

        if ($slug === '') {
            if ($this->tenantDomainService->isAdminHost($host) || $this->isLocalHost($host)) {
                $slug = (string) config('tenancy.default_slug', 'default');
            } else {
                $tenant = $this->tenantDomainService->resolveTenantForHost($host);
                if (! $tenant) {
                    return response()->json(['error' => 'Host tenant belum terdaftar. Tambahkan domain ini dari panel super admin terlebih dahulu.'], 404);
                }

                $slug = (string) ($tenant->slug ?? '');
            }
        }

        if ($slug === '') {
            $slug = (string) config('tenancy.default_slug', 'default');
        }

        $tenant = DB::table('tenants')->where('slug', $slug)->first();
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $isAdminHost = $this->tenantDomainService->isAdminHost((string) $request->getHost());
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

    private function resolveHeaderTenantSlug(Request $request): string
    {
        if (! (bool) config('tenancy.allow_header_override', false)) {
            return '';
        }

        $header = trim((string) config('tenancy.header', 'X-Tenant'));
        if ($header === '') {
            return '';
        }

        return strtolower(trim((string) $request->header($header, '')));
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
