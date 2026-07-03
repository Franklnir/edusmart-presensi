<?php

namespace App\Http\Middleware;

use App\Support\Tenancy\TenantDomainService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureSuperAdminDomain
{
    public function __construct(
        private readonly TenantDomainService $tenantDomainService
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $host = $this->tenantDomainService->trustedRequestHost($request);
        if ($this->tenantDomainService->isAdminHost($host) || $this->isAllowedLocalSuperAdminHost($host)) {
            return $next($request);
        }

        return response()->json([
            'error' => $this->tenantDomainService->adminHostMessage(),
        ], 403);
    }

    private function isAllowedLocalSuperAdminHost(string $host): bool
    {
        return app()->environment('local') && in_array($host, ['localhost', '127.0.0.1'], true);
    }
}
