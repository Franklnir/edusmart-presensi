<?php

namespace App\Http\Middleware;

use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantDomainService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ResolveTenant
{
    public function __construct(
        private readonly TenantDomainService $tenantDomainService,
        private readonly TenantContext $tenantContext
    ) {}

    public function handle(Request $request, Closure $next)
    {
        $host = $this->tenantDomainService->trustedRequestHost($request);
        $slug = $this->resolveHeaderTenantSlug($request);

        if ($slug === '') {
            if ($this->tenantDomainService->isAdminHost($host) || $this->isLocalHost($host)) {
                if ($request->is('api/health')) {
                    $request->attributes->set('tenant_slug', (string) config('tenancy.default_slug', 'default'));

                    return $next($request);
                }

                $slug = (string) config('tenancy.default_slug', 'default');
            } else {
                $tenant = $this->tenantDomainService->resolveTenantForHost($host);
                if (! $tenant) {
                    return response()->json(['message' => 'Host tenant belum terdaftar. Tambahkan domain ini dari panel super admin terlebih dahulu.'], 404);
                }

                $slug = (string) ($tenant->slug ?? '');
            }
        }

        if ($slug === '') {
            $slug = (string) config('tenancy.default_slug', 'default');
        }

        $tenant = DB::table('tenants')->where('slug', $slug)->first();
        if (! $tenant) {
            return response()->json(['message' => 'Tenant tidak ditemukan'], 404);
        }

        $isAdminHost = $this->tenantDomainService->isAdminHost($host);
        if (
            ! $isAdminHost
            && ! $request->is('api/health')
            && $this->isTenantBlocked((string) ($tenant->status ?? 'active'))
        ) {
            return response()->json([
                'message' => 'Tenant saat ini tidak aktif. Hubungi super admin untuk aktivasi ulang.',
                'tenant_status' => $tenant->status,
            ], 423);
        }

        $request->attributes->set('tenant_id', $tenant->id);
        $request->attributes->set('tenant_slug', $tenant->slug);
        $this->tenantContext->set((string) $tenant->id, (string) $tenant->slug);

        $usesPostgresContext = DB::getDriverName() === 'pgsql';
        if ($usesPostgresContext) {
            DB::selectOne("select set_config('app.current_tenant_id', ?, false)", [(string) $tenant->id]);
        }

        try {
            return $next($request);
        } finally {
            if ($usesPostgresContext) {
                DB::selectOne("select set_config('app.current_tenant_id', '', false)");
            }
            $this->tenantContext->clear();
        }
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
