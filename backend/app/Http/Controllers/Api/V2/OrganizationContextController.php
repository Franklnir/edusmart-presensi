<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use App\Http\Resources\Api\V2\OrganizationContextResource;
use App\Services\Organization\OrganizationContextService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class OrganizationContextController extends Controller
{
    public function __construct(
        private readonly OrganizationContextService $organizations
    ) {}

    public function show(Request $request): JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id', '');
        $userId = (string) ($request->user()?->id ?? '');
        $role = (string) ($request->user()?->profile?->role ?? '');

        abort_if($tenantId === '' || $userId === '', 403, 'Konteks organisasi tidak tersedia.');

        return response()->json([
            'success' => true,
            'message' => 'Konteks organisasi berhasil dimuat.',
            'data' => (new OrganizationContextResource(
                $this->organizations->show($tenantId, $userId, $role)
            ))->resolve($request),
            'request_id' => $request->attributes->get('request_id')
                ?: $request->header('X-Request-ID', (string) Str::uuid()),
        ]);
    }
}
