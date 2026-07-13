<?php

namespace App\Http\Controllers\Api;

use App\Support\Tenancy\TenantDomainService;
use Illuminate\Http\Request;

class InfrastructureController extends ApiController
{
    public function __construct(
        private readonly TenantDomainService $tenantDomainService
    ) {}

    public function authorizeTlsDomain(Request $request)
    {
        $configuredSecret = trim((string) config('services.caddy.ask_secret', ''));
        if ($configuredSecret === '') {
            return response()->json([
                'message' => 'Caddy ask secret belum dikonfigurasi.',
            ], 503);
        }

        $providedSecret = trim((string) $request->query('secret', ''));
        if (! hash_equals($configuredSecret, $providedSecret)) {
            return response()->json([
                'message' => 'Permintaan TLS tidak valid.',
            ], 403);
        }

        $host = $this->tenantDomainService->normalizeHost((string) $request->query('domain', ''));
        if ($host === '') {
            return response()->json([
                'message' => 'Domain wajib diisi.',
            ], 422);
        }

        if (! $this->tenantDomainService->authorizesTlsForHost($host)) {
            return response()->json([
                'message' => 'Domain belum terdaftar untuk auto TLS.',
            ], 403);
        }

        return response()->noContent();
    }
}
