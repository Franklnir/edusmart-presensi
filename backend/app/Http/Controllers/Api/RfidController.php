<?php

namespace App\Http\Controllers\Api;

use App\Services\Rfid\RfidScanService;
use Illuminate\Http\Request;

class RfidController extends ApiController
{
    public function __construct(
        private readonly RfidScanService $rfidScanService
    ) {
    }

    public function scan(Request $request)
    {
        $authError = $this->validateDeviceKey($request);
        if ($authError) {
            return $authError;
        }

        $tenantSlug = $this->resolveTenantSlug($request);

        $validated = $request->validate([
            'card_uid' => ['required', 'string', 'max:128'],
            'device_id' => ['nullable', 'string', 'max:191'],
        ]);

        $result = $this->rfidScanService->processScanByTenantSlug(
            $tenantSlug,
            (string) $validated['card_uid'],
            (string) ($validated['device_id'] ?? '')
        );

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    public function mode(Request $request)
    {
        $authError = $this->validateDeviceKey($request);
        if ($authError) {
            return $authError;
        }

        $result = $this->rfidScanService->modeByTenantSlug($this->resolveTenantSlug($request));

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    public function setMode(Request $request)
    {
        // Untuk setMode dari dashboard, kita pakai auth default (Sanctum/Session)
        // Bukan validateDeviceKey (yang untuk Arduino)

        $validated = $request->validate([
            'mode' => ['required', 'string', 'in:auto,manual,enroll'],
            'tenant_slug' => ['nullable', 'string'],
        ]);

        $tenantSlug = $validated['tenant_slug'] ?? $this->resolveTenantSlug($request);

        $result = $this->rfidScanService->setModeByTenantSlug($tenantSlug, $validated['mode']);

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    private function validateDeviceKey(Request $request): ?\Illuminate\Http\JsonResponse
    {
        $expected = trim((string) config('rfid.shared_key', ''));
        if ($expected === '') {
            return null;
        }

        $provided = trim((string) $request->header('X-RFID-Key', $request->input('rfid_key', '')));
        if ($provided !== '' && hash_equals($expected, $provided)) {
            return null;
        }

        return response()->json([
            'success' => false,
            'reason' => 'unauthorized_device',
            'message' => 'Kunci device RFID tidak valid',
        ], 401);
    }

    private function resolveTenantSlug(Request $request): string
    {
        $tenantSlug = trim((string) $request->input('tenant_slug', $request->query('tenant_slug', '')));
        if ($tenantSlug === '') {
            $tenantSlug = trim((string) $request->header(config('tenancy.header', 'X-Tenant'), ''));
        }

        return $tenantSlug;
    }
}
