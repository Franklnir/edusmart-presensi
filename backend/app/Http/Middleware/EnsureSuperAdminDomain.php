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
        $host = strtolower(trim((string) $request->getHost()));
        if ($this->tenantDomainService->isAdminHost($host)) {
            return $next($request);
        }

        return response()->json([
            'error' => $this->tenantDomainService->adminHostMessage(),
        ], 403);
    }
}
