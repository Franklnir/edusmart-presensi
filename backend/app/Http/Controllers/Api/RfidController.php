<?php

namespace App\Http\Controllers\Api;

use App\Services\Rfid\RfidDeviceService;
use App\Services\Rfid\RfidIngressService;
use App\Services\Rfid\RfidScanService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class RfidController extends ApiController
{
    public function __construct(
        private readonly RfidScanService $rfidScanService,
        private readonly RfidIngressService $rfidIngressService,
        private readonly RfidDeviceService $rfidDeviceService,
    ) {}

    public function scan(Request $request)
    {
        $auth = $this->authorizeDeviceRequest($request);
        if ($auth['response'] ?? null) {
            return $auth['response'];
        }

        $validated = $request->validate([
            'card_uid' => ['required', 'string', 'max:128'],
            'device_id' => ['nullable', 'string', 'max:191'],
            'event_id' => ['nullable', 'string', 'max:191'],
            'mode' => ['nullable', 'string', 'max:32'],
            'scanned_at' => ['nullable', 'date'],
        ]);

        $tenantSlug = $this->resolveTenantSlug($request, $auth);
        if ($tenantSlug === '') {
            return $this->tenantRequiredResponse();
        }

        $deviceId = $this->resolveDeviceId($validated, $auth);
        $this->touchRegisteredDevice($auth, $request, 'http-scan');

        $result = $this->rfidIngressService->processScanByTenantSlug(
            tenantSlug: $tenantSlug,
            cardUid: (string) $validated['card_uid'],
            deviceId: $deviceId,
            mode: (string) ($validated['mode'] ?? ''),
            source: 'http-scan',
            eventId: (string) ($validated['event_id'] ?? ''),
            scannedAt: (string) ($validated['scanned_at'] ?? ''),
            payload: $request->all(),
        );

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    public function mode(Request $request)
    {
        $auth = $this->authorizeDeviceRequest($request);
        if ($auth['response'] ?? null) {
            return $auth['response'];
        }

        $tenantSlug = $this->resolveTenantSlug($request, $auth);
        if ($tenantSlug === '') {
            return $this->tenantRequiredResponse();
        }

        $this->touchRegisteredDevice($auth, $request, 'http-mode');

        $result = $this->rfidScanService->modeByTenantSlug($tenantSlug);

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    public function sync(Request $request)
    {
        $auth = $this->authorizeDeviceRequest($request);
        if ($auth['response'] ?? null) {
            return $auth['response'];
        }

        $maxEvents = max(10, min(1000, (int) config('rfid.performance.sync_batch_max_events', 500)));
        $validated = $request->validate([
            'device_id' => ['nullable', 'string', 'max:191'],
            'events' => ['required', 'array', 'min:1', 'max:'.$maxEvents],
            'events.*.event_id' => ['nullable', 'string', 'max:191'],
            'events.*.scan_id' => ['nullable', 'string', 'max:191'],
            'events.*.device_id' => ['nullable', 'string', 'max:191'],
            'events.*.card_uid' => ['required', 'string', 'max:128'],
            'events.*.mode' => ['nullable', 'string', 'max:32'],
            'events.*.scanned_at' => ['nullable', 'date'],
            'events.*.timestamp' => ['nullable', 'date'],
        ]);

        $tenantSlug = $this->resolveTenantSlug($request, $auth);
        if ($tenantSlug === '') {
            return $this->tenantRequiredResponse();
        }

        $deviceId = $this->resolveDeviceId($validated, $auth);
        $this->touchRegisteredDevice($auth, $request, 'http-sync', [
            'last_batch_size' => count((array) ($validated['events'] ?? [])),
        ]);

        $result = $this->rfidIngressService->syncBatchByTenantSlug(
            tenantSlug: $tenantSlug,
            events: (array) $validated['events'],
            deviceId: $deviceId,
            source: 'http-sync',
        );

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    public function heartbeat(Request $request)
    {
        $auth = $this->authorizeDeviceRequest($request);
        if ($auth['response'] ?? null) {
            return $auth['response'];
        }

        $validated = $request->validate([
            'device_id' => ['nullable', 'string', 'max:191'],
            'transport' => ['nullable', 'string', 'max:32'],
            'ip_address' => ['nullable', 'ip'],
            'firmware_version' => ['nullable', 'string', 'max:64'],
            'wifi_rssi' => ['nullable', 'numeric'],
            'free_heap' => ['nullable', 'numeric'],
            'meta' => ['nullable', 'array'],
        ]);

        $tenantSlug = $this->resolveTenantSlug($request, $auth);
        if ($tenantSlug === '') {
            return $this->tenantRequiredResponse();
        }

        $deviceId = $this->resolveDeviceId($validated, $auth, false);
        $transport = trim((string) ($validated['transport'] ?? 'heartbeat'));

        $metadata = array_filter([
            'tenant_slug' => $tenantSlug,
            'firmware_version' => $validated['firmware_version'] ?? null,
            'wifi_rssi' => $validated['wifi_rssi'] ?? null,
            'free_heap' => $validated['free_heap'] ?? null,
        ], fn ($value) => $value !== null && $value !== '');

        if (is_array($validated['meta'] ?? null)) {
            $metadata = array_merge($metadata, (array) $validated['meta']);
        }

        if ($deviceId !== '') {
            $this->rfidDeviceService->touchDeviceSeen(
                $deviceId,
                $transport,
                (string) ($validated['ip_address'] ?? $request->ip()),
                $metadata
            );
        }

        $modeResult = $this->rfidScanService->modeByTenantSlug($tenantSlug);
        $modeContext = ((int) ($modeResult['status'] ?? 500) === 200)
            ? ($modeResult['data'] ?? null)
            : null;

        return response()->json([
            'success' => true,
            'message' => 'Heartbeat RFID diterima',
            'server_time' => now()->toIso8601String(),
            'tenant_slug' => $tenantSlug,
            'device_id' => $deviceId !== '' ? $deviceId : null,
            'device_registered' => ($auth['device'] ?? null) !== null,
            'mode_context' => $modeContext,
        ]);
    }

    public function setMode(Request $request)
    {
        // Untuk setMode dari dashboard, kita pakai auth default (Sanctum/Session)
        // Bukan validateDeviceKey (yang untuk Arduino)
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $validated = $request->validate([
            'mode' => ['required', 'string', 'in:auto,manual,enroll'],
            'tenant_slug' => ['nullable', 'string'],
        ]);

        $tenantSlug = $this->resolveDashboardTenantSlug($request, (string) ($validated['tenant_slug'] ?? ''));
        if ($tenantSlug === '') {
            return $this->tenantRequiredResponse();
        }

        $result = $this->rfidScanService->setModeByTenantSlug($tenantSlug, $validated['mode']);

        return response()->json($result['data'] ?? [], (int) ($result['status'] ?? 500));
    }

    private function authorizeDeviceRequest(Request $request): array
    {
        $auth = $this->rfidDeviceService->authenticateRequest($request);
        if (($auth['authorized'] ?? false) === true) {
            return $auth;
        }

        return [
            'response' => response()->json([
                'success' => false,
                'reason' => $auth['reason'] ?? 'unauthorized_device',
                'message' => $auth['message'] ?? 'Akses device RFID ditolak',
            ], (int) ($auth['status'] ?? 401)),
        ];
    }

    private function resolveTenantSlug(Request $request, array $auth = []): string
    {
        $tenantSlug = trim((string) ($auth['tenant_slug'] ?? ''));
        if ($tenantSlug !== '') {
            return Str::lower($tenantSlug);
        }

        $tenantSlug = trim((string) $request->input('tenant_slug', $request->query('tenant_slug', '')));
        if ($tenantSlug === '') {
            $tenantSlug = trim((string) $request->header(config('tenancy.header', 'X-Tenant'), ''));
        }

        return $tenantSlug !== '' ? Str::lower($tenantSlug) : '';
    }

    private function resolveDeviceId(array $validated, array $auth = [], bool $allowFallback = true): string
    {
        $deviceId = trim((string) ($auth['device_id'] ?? ''));
        if ($deviceId !== '') {
            return $deviceId;
        }

        $deviceId = trim((string) ($validated['device_id'] ?? ''));

        if ($deviceId !== '') {
            return $deviceId;
        }

        return $allowFallback ? 'RFID_DEVICE' : '';
    }

    private function touchRegisteredDevice(array $auth, Request $request, string $transport, array $metadata = []): void
    {
        $device = $auth['device'] ?? null;
        if (! $device || empty($device->device_id)) {
            return;
        }

        $this->rfidDeviceService->touchDeviceSeen(
            (string) $device->device_id,
            $transport,
            $request->ip(),
            $metadata
        );
    }

    private function resolveDashboardTenantSlug(Request $request, string $requestedTenantSlug): string
    {
        $requestedTenantSlug = trim($requestedTenantSlug);
        $currentTenantSlug = trim((string) $request->attributes->get('tenant_slug', ''));

        if ($this->isSuperAdmin($request) && $requestedTenantSlug !== '') {
            return Str::lower($requestedTenantSlug);
        }

        if ($currentTenantSlug === '') {
            return '';
        }

        if ($requestedTenantSlug !== '' && Str::lower($requestedTenantSlug) !== Str::lower($currentTenantSlug)) {
            abort(response()->json([
                'error' => 'Tenant RFID tidak sesuai dengan sesi login',
            ], 403));
        }

        return Str::lower($currentTenantSlug);
    }

    private function tenantRequiredResponse(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'reason' => 'tenant_required',
            'message' => 'tenant_slug wajib diisi atau ditentukan dari device RFID',
        ], 422);
    }
}
