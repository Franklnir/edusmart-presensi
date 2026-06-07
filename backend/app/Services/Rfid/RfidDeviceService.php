<?php

namespace App\Services\Rfid;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class RfidDeviceService
{
    private static array $deviceContextCache = [];

    public function authenticateRequest(Request $request): array
    {
        $deviceId = $this->extractDeviceId($request);
        $providedSecret = trim((string) $request->header('X-RFID-Secret', $request->input('device_secret', '')));

        if ($deviceId !== '' && $providedSecret !== '') {
            $device = $this->findDeviceContext($deviceId);
            if (! $device) {
                return $this->authError(401, 'device_not_registered', 'Device RFID belum terdaftar');
            }

            if ($this->isDeviceBlocked((string) ($device->status ?? 'active'))) {
                return $this->authError(423, 'device_blocked', 'Device RFID tidak aktif');
            }

            $secretHash = trim((string) ($device->secret_hash ?? ''));
            $authCacheKey = $this->deviceAuthCacheKey((string) $device->id, $secretHash, $providedSecret);
            $secretValid = $authCacheKey !== null && $this->shouldUseRuntimeCache() && Cache::get($authCacheKey) === true;

            if (! $secretValid && $secretHash !== '' && Hash::check($providedSecret, $secretHash)) {
                $secretValid = true;
                if ($authCacheKey !== null && $this->shouldUseRuntimeCache()) {
                    Cache::put($authCacheKey, true, $this->performanceTtl('device_auth_cache_ttl_seconds', 300));
                }
            }

            if (! $secretValid) {
                return $this->authError(401, 'invalid_device_secret', 'Secret device RFID tidak valid');
            }

            return [
                'authorized' => true,
                'auth_mode' => 'device_secret',
                'device' => $device,
                'device_id' => (string) $device->device_id,
                'tenant_slug' => $this->normalizeTenantSlug($device->tenant_slug ?? ''),
            ];
        }

        $sharedKeyAuth = $this->validateSharedKey($request);
        if (! ($sharedKeyAuth['authorized'] ?? false)) {
            return $sharedKeyAuth;
        }

        $device = $deviceId !== '' ? $this->findDeviceContext($deviceId) : null;
        if ($device && $this->isDeviceBlocked((string) ($device->status ?? 'active'))) {
            return $this->authError(423, 'device_blocked', 'Device RFID tidak aktif');
        }

        return [
            'authorized' => true,
            'auth_mode' => (string) ($sharedKeyAuth['auth_mode'] ?? 'shared_key'),
            'device' => $device,
            'device_id' => $device ? (string) $device->device_id : $deviceId,
            'tenant_slug' => $this->normalizeTenantSlug($device->tenant_slug ?? ''),
        ];
    }

    public function registerDevice(
        string $tenantSlug,
        string $deviceId,
        ?string $name = null,
        ?string $transport = 'mqtt',
        ?string $plainSecret = null
    ): array {
        $tenant = $this->resolveTenantBySlug($tenantSlug);
        if (! $tenant) {
            return [
                'success' => false,
                'message' => 'Tenant tidak ditemukan',
            ];
        }

        if ($this->isDeviceBlocked((string) ($tenant->status ?? 'active'))) {
            return [
                'success' => false,
                'message' => 'Tenant tidak aktif, device tidak bisa didaftarkan',
            ];
        }

        $deviceId = trim($deviceId);
        if ($deviceId === '') {
            return [
                'success' => false,
                'message' => 'device_id wajib diisi',
            ];
        }

        if ($this->findDeviceContext($deviceId)) {
            return [
                'success' => false,
                'message' => 'device_id sudah terdaftar',
            ];
        }

        $secret = trim((string) $plainSecret);
        if ($secret === '') {
            $secret = Str::random(40);
        }

        $transport = $this->normalizeTransport($transport);

        DB::table('rfid_devices')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => (string) $tenant->id,
            'device_id' => $deviceId,
            'name' => $this->nullableString($name),
            'secret_hash' => Hash::make($secret),
            'status' => 'active',
            'transport' => $transport,
            'fallback_http_enabled' => $transport !== 'mqtt',
            'metadata' => json_encode([
                'created_via' => 'artisan',
            ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->forgetDeviceContext($deviceId);

        return [
            'success' => true,
            'message' => 'Device RFID berhasil didaftarkan',
            'tenant_slug' => (string) $tenant->slug,
            'device_id' => $deviceId,
            'device_name' => $this->nullableString($name),
            'transport' => $transport,
            'secret' => $secret,
        ];
    }

    public function findDeviceContext(string $deviceId): ?object
    {
        $deviceId = trim($deviceId);
        if ($deviceId === '') {
            return null;
        }

        $normalized = Str::lower($deviceId);
        if ($this->shouldUseRuntimeCache() && array_key_exists($normalized, self::$deviceContextCache)) {
            return self::$deviceContextCache[$normalized];
        }

        $deviceQuery = fn () => DB::table('rfid_devices as devices')
            ->leftJoin('tenants as tenants', 'tenants.id', '=', 'devices.tenant_id')
            ->whereRaw('lower(devices.device_id) = ?', [$normalized])
            ->first([
                'devices.id',
                'devices.tenant_id',
                'devices.device_id',
                'devices.name',
                'devices.secret_hash',
                'devices.status',
                'devices.transport',
                'devices.fallback_http_enabled',
                'devices.metadata',
                'devices.last_seen_at',
                'devices.last_transport',
                'devices.last_ip',
                'tenants.slug as tenant_slug',
                'tenants.status as tenant_status',
            ]);

        $device = $this->shouldUseRuntimeCache()
            ? Cache::remember('rfid:device-context:'.$normalized, $this->performanceTtl('device_cache_ttl_seconds', 60), $deviceQuery)
            : $deviceQuery();

        self::$deviceContextCache[$normalized] = $device ?: null;

        return self::$deviceContextCache[$normalized];
    }

    public function resolveRegisteredTenantSlug(string $deviceId): string
    {
        $device = $this->findDeviceContext($deviceId);

        return $this->normalizeTenantSlug($device->tenant_slug ?? '');
    }

    public function listDevices(?string $tenantSlug = null): array
    {
        $query = DB::table('rfid_devices as devices')
            ->leftJoin('tenants as tenants', 'tenants.id', '=', 'devices.tenant_id')
            ->orderByRaw('coalesce(tenants.slug, \'\') asc')
            ->orderBy('devices.device_id');

        $tenantSlug = $this->normalizeTenantSlug($tenantSlug);
        if ($tenantSlug !== '') {
            $query->whereRaw('lower(tenants.slug) = ?', [$tenantSlug]);
        }

        $rows = $query->get([
            'devices.id',
            'devices.tenant_id',
            'devices.device_id',
            'devices.name',
            'devices.status',
            'devices.transport',
            'devices.fallback_http_enabled',
            'devices.metadata',
            'devices.last_seen_at',
            'devices.last_transport',
            'devices.last_ip',
            'tenants.slug as tenant_slug',
        ]);

        $eventStats = $this->deviceEventStats(
            $rows->map(fn ($row) => trim((string) ($row->device_id ?? '')))->filter()->values()->all(),
            $tenantSlug
        );
        $onlineGraceSeconds = max(30, (int) config('rfid.performance.device_status_online_grace_seconds', 120));
        $now = now();

        return $rows->map(function ($row) use ($eventStats, $onlineGraceSeconds, $now) {
            $metadata = $this->decodeMetadata($row->metadata ?? null);
            $deviceId = trim((string) ($row->device_id ?? ''));
            $stats = $eventStats[Str::lower($deviceId)] ?? [];
            $lastSeenAt = $row->last_seen_at ? (string) $row->last_seen_at : null;
            $isOnline = false;
            if ($lastSeenAt) {
                try {
                    $isOnline = $now->diffInSeconds(\Illuminate\Support\Carbon::parse($lastSeenAt), true) <= $onlineGraceSeconds;
                } catch (\Throwable $e) {
                    $isOnline = false;
                }
            }

            return [
                'tenant_slug' => $this->normalizeTenantSlug($row->tenant_slug ?? ''),
                'device_id' => $deviceId,
                'name' => $this->nullableString($row->name ?? null),
                'status' => Str::lower(trim((string) ($row->status ?? 'active'))),
                'connection_status' => $isOnline ? 'online' : 'offline',
                'is_online' => $isOnline,
                'transport' => Str::lower(trim((string) ($row->transport ?? 'mqtt'))),
                'fallback_http_enabled' => (bool) ($row->fallback_http_enabled ?? false),
                'last_seen_at' => $lastSeenAt,
                'last_transport' => $this->nullableString($row->last_transport ?? null),
                'last_ip' => $this->nullableString($row->last_ip ?? null),
                'last_scan_at' => $metadata['last_scan_at'] ?? ($stats['last_scan_at'] ?? null),
                'last_error_at' => $stats['last_error_at'] ?? null,
                'error_count' => (int) ($stats['error_count'] ?? 0),
                'firmware_version' => $this->nullableString($metadata['firmware_version'] ?? $metadata['firmware'] ?? null),
                'wifi_rssi' => $metadata['wifi_rssi'] ?? $metadata['rssi'] ?? null,
                'free_heap' => $metadata['free_heap'] ?? $metadata['heap'] ?? null,
                'metadata' => [
                    'last_mqtt_topic' => $metadata['last_mqtt_topic'] ?? null,
                    'battery' => $metadata['battery'] ?? null,
                    'mac' => $metadata['mac'] ?? null,
                ],
            ];
        })->values()->all();
    }

    private function deviceEventStats(array $deviceIds, string $tenantSlug = ''): array
    {
        $deviceIds = array_values(array_unique(array_filter(array_map(
            fn ($value) => Str::lower(trim((string) $value)),
            $deviceIds
        ))));
        if (empty($deviceIds)) {
            return [];
        }

        try {
            if (! \Illuminate\Support\Facades\Schema::hasTable('rfid_device_events')) {
                return [];
            }

            $query = DB::table('rfid_device_events as events')
                ->selectRaw('lower(events.device_id) as device_key')
                ->selectRaw('max(events.created_at) as last_scan_at')
                ->selectRaw("max(case when events.status = 'error' then events.updated_at else null end) as last_error_at")
                ->selectRaw("sum(case when events.status = 'error' then 1 else 0 end) as error_count")
                ->whereIn(DB::raw('lower(events.device_id)'), $deviceIds)
                ->groupBy(DB::raw('lower(events.device_id)'));

            if ($tenantSlug !== '') {
                $query->leftJoin('tenants', 'tenants.id', '=', 'events.tenant_id')
                    ->whereRaw('lower(tenants.slug) = ?', [$tenantSlug]);
            }

            return $query->get()
                ->mapWithKeys(fn ($row) => [
                    (string) $row->device_key => [
                        'last_scan_at' => $row->last_scan_at ? (string) $row->last_scan_at : null,
                        'last_error_at' => $row->last_error_at ? (string) $row->last_error_at : null,
                        'error_count' => (int) ($row->error_count ?? 0),
                    ],
                ])
                ->all();
        } catch (\Throwable $e) {
            return [];
        }
    }

    public function rotateSecret(string $deviceId, ?string $plainSecret = null): array
    {
        $device = $this->findDeviceContext($deviceId);
        if (! $device) {
            return [
                'success' => false,
                'message' => 'Device RFID tidak ditemukan',
            ];
        }

        $secret = trim((string) $plainSecret);
        if ($secret === '') {
            $secret = Str::random(40);
        }

        $metadata = $this->mergeMetadata(
            $this->decodeMetadata($device->metadata ?? null),
            ['secret_rotated_at' => now()->toIso8601String()]
        );

        DB::table('rfid_devices')
            ->where('id', $device->id)
            ->update([
                'secret_hash' => Hash::make($secret),
                'metadata' => ! empty($metadata)
                    ? json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                    : null,
                'updated_at' => now(),
            ]);
        $this->forgetDeviceContext((string) $device->device_id);

        return [
            'success' => true,
            'message' => 'Secret device RFID berhasil dirotasi',
            'tenant_slug' => $this->normalizeTenantSlug($device->tenant_slug ?? ''),
            'device_id' => (string) $device->device_id,
            'device_name' => $this->nullableString($device->name ?? null),
            'secret' => $secret,
        ];
    }

    public function ensureTenantTemplateDevice(string $tenantId, string $tenantSlug): array
    {
        $tenantId = trim($tenantId);
        $tenantSlug = $this->normalizeTenantSlug($tenantSlug);

        if ($tenantId === '' || $tenantSlug === '') {
            return [
                'success' => false,
                'message' => 'Tenant RFID template tidak valid',
            ];
        }

        $deviceId = $this->templateDeviceId($tenantSlug);
        $deviceName = 'Template RFID '.Str::upper($tenantSlug);
        $device = $this->findDeviceContext($deviceId);

        if ($device && (string) ($device->tenant_id ?? '') !== $tenantId) {
            return [
                'success' => false,
                'message' => 'Device template RFID bentrok dengan tenant lain',
            ];
        }

        $metadata = $this->decodeMetadata($device->metadata ?? null);
        $plainSecret = $this->decryptTemplateSecret($metadata);

        if (! $device) {
            $plainSecret = Str::random(40);
            $metadata = $this->buildTemplateMetadata($metadata, $tenantSlug, $plainSecret);

            DB::table('rfid_devices')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'device_id' => $deviceId,
                'name' => $deviceName,
                'secret_hash' => Hash::make($plainSecret),
                'status' => 'active',
                'transport' => 'mqtt',
                'fallback_http_enabled' => false,
                'metadata' => json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->forgetDeviceContext($deviceId);
        } elseif ($plainSecret === null) {
            $plainSecret = Str::random(40);
            $metadata = $this->buildTemplateMetadata($metadata, $tenantSlug, $plainSecret);

            DB::table('rfid_devices')
                ->where('id', $device->id)
                ->update([
                    'name' => $deviceName,
                    'secret_hash' => Hash::make($plainSecret),
                    'transport' => 'mqtt',
                    'fallback_http_enabled' => false,
                    'metadata' => json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'updated_at' => now(),
                ]);
            $this->forgetDeviceContext($deviceId);
        } else {
            $metadata = $this->mergeMetadata($metadata, [
                'template_transport' => 'mqtt',
                'template_http_fallback' => false,
            ]);

            DB::table('rfid_devices')
                ->where('id', $device->id)
                ->update([
                    'name' => $deviceName,
                    'transport' => 'mqtt',
                    'fallback_http_enabled' => false,
                    'metadata' => json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'updated_at' => now(),
                ]);
            $this->forgetDeviceContext($deviceId);
        }

        return [
            'success' => true,
            'tenant_id' => $tenantId,
            'tenant_slug' => $tenantSlug,
            'device_id' => $deviceId,
            'device_name' => $deviceName,
            'secret' => $plainSecret,
        ];
    }

    public function touchDeviceSeen(string $deviceId, string $transport, ?string $ipAddress = null, array $metadata = []): void
    {
        $normalizedDeviceId = Str::lower(trim($deviceId));
        if ($normalizedDeviceId === '') {
            return;
        }

        $seenCacheKey = 'rfid:device-seen:'.$normalizedDeviceId.':'.Str::lower($this->normalizeTransport($transport));
        if ($this->shouldUseRuntimeCache() && ! Cache::add($seenCacheKey, true, $this->performanceTtl('device_seen_throttle_seconds', 30))) {
            return;
        }

        $device = $this->findDeviceContext($deviceId);
        if (! $device) {
            return;
        }

        $mergedMetadata = $this->mergeMetadata(
            $this->decodeMetadata($device->metadata ?? null),
            $metadata
        );

        DB::table('rfid_devices')
            ->where('id', $device->id)
            ->update([
                'last_seen_at' => now(),
                'last_transport' => $this->normalizeTransport($transport),
                'last_ip' => $this->nullableString($ipAddress),
                'metadata' => ! empty($mergedMetadata)
                    ? json_encode($mergedMetadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                    : null,
                'updated_at' => now(),
            ]);

        Cache::forget('rfid:device-context:'.$normalizedDeviceId);
        unset(self::$deviceContextCache[$normalizedDeviceId]);
    }

    private function forgetDeviceContext(string $deviceId): void
    {
        $normalized = Str::lower(trim($deviceId));
        if ($normalized === '') {
            return;
        }

        Cache::forget('rfid:device-context:'.$normalized);
        unset(self::$deviceContextCache[$normalized]);
    }

    private function deviceAuthCacheKey(string $deviceId, string $secretHash, string $providedSecret): ?string
    {
        if ($deviceId === '' || $secretHash === '' || $providedSecret === '') {
            return null;
        }

        return 'rfid:device-auth:'.hash('sha256', $deviceId.'|'.$secretHash.'|'.$providedSecret);
    }

    private function performanceTtl(string $key, int $default): int
    {
        return max(1, (int) config('rfid.performance.'.$key, $default));
    }

    private function shouldUseRuntimeCache(): bool
    {
        return ! app()->runningUnitTests();
    }

    private function validateSharedKey(Request $request): array
    {
        $expected = trim((string) config('rfid.shared_key', ''));
        if ($expected === '') {
            if (! (bool) config('rfid.allow_open_http', false)) {
                return $this->authError(401, 'rfid_key_required', 'Kunci device RFID wajib dikonfigurasi');
            }

            return [
                'authorized' => true,
                'auth_mode' => 'open',
            ];
        }

        $provided = trim((string) $request->header('X-RFID-Key', $request->input('rfid_key', '')));
        if ($provided !== '' && hash_equals($expected, $provided)) {
            return [
                'authorized' => true,
                'auth_mode' => 'shared_key',
            ];
        }

        return $this->authError(401, 'unauthorized_device', 'Kunci device RFID tidak valid');
    }

    private function resolveTenantBySlug(string $tenantSlug): ?object
    {
        $tenantSlug = trim($tenantSlug);
        if ($tenantSlug === '') {
            return null;
        }

        return DB::table('tenants')
            ->whereRaw('lower(slug) = ?', [Str::lower($tenantSlug)])
            ->first(['id', 'slug', 'status']);
    }

    private function extractDeviceId(Request $request): string
    {
        return trim((string) $request->header('X-RFID-Device', $request->input('device_id', '')));
    }

    private function normalizeTenantSlug(mixed $tenantSlug): string
    {
        $tenantSlug = trim((string) $tenantSlug);

        return $tenantSlug !== '' ? Str::lower($tenantSlug) : '';
    }

    private function decodeMetadata(mixed $metadata): array
    {
        if (is_array($metadata)) {
            return $metadata;
        }

        if (! is_string($metadata) || trim($metadata) === '') {
            return [];
        }

        $decoded = json_decode($metadata, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function mergeMetadata(array $existing, array $incoming): array
    {
        $normalizedIncoming = [];
        foreach ($incoming as $key => $value) {
            $normalizedKey = trim((string) $key);
            if ($normalizedKey === '' || $value === null || $value === '') {
                continue;
            }

            $normalizedIncoming[$normalizedKey] = $value;
        }

        if (empty($normalizedIncoming)) {
            return $existing;
        }

        return array_merge($existing, $normalizedIncoming);
    }

    private function buildTemplateMetadata(array $existing, string $tenantSlug, string $plainSecret): array
    {
        $ciphertext = $this->encryptTemplateSecret($plainSecret);

        return $this->mergeMetadata($existing, [
            'created_via' => $existing['created_via'] ?? 'super_admin_template',
            'template_managed' => true,
            'template_scope' => 'tenant_detail',
            'template_tenant_slug' => $tenantSlug,
            'template_device_id' => $this->templateDeviceId($tenantSlug),
            'template_transport' => 'mqtt',
            'template_http_fallback' => false,
            'template_generated_at' => now()->toIso8601String(),
            'template_secret_ciphertext' => $ciphertext,
        ]);
    }

    private function decryptTemplateSecret(array $metadata): ?string
    {
        $ciphertext = trim((string) ($metadata['template_secret_ciphertext'] ?? ''));
        if ($ciphertext === '') {
            return null;
        }

        try {
            $plain = Crypt::decryptString($ciphertext);

            return trim((string) $plain) !== '' ? (string) $plain : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function encryptTemplateSecret(string $plainSecret): ?string
    {
        $plainSecret = trim($plainSecret);
        if ($plainSecret === '') {
            return null;
        }

        try {
            return Crypt::encryptString($plainSecret);
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function templateDeviceId(string $tenantSlug): string
    {
        return 'rfid-template-'.$tenantSlug.'-01';
    }

    private function normalizeTransport(?string $transport): string
    {
        $normalized = Str::lower(trim((string) $transport));

        return $normalized !== '' ? $normalized : 'mqtt';
    }

    private function isDeviceBlocked(string $status): bool
    {
        $normalized = Str::lower(trim($status));

        return in_array($normalized, ['inactive', 'disabled', 'suspended', 'archived'], true);
    }

    private function authError(int $status, string $reason, string $message): array
    {
        return [
            'authorized' => false,
            'status' => $status,
            'reason' => $reason,
            'message' => $message,
        ];
    }

    private function nullableString(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }
}
