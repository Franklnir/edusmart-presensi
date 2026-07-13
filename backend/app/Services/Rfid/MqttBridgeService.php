<?php

namespace App\Services\Rfid;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

class MqttBridgeService
{
    private array $modePublishAfterScanAt = [];

    public function __construct(
        private readonly RfidScanService $rfidScanService,
        private readonly RfidIngressService $rfidIngressService,
        private readonly RfidDeviceService $rfidDeviceService,
        private readonly TenantMqttConfigService $tenantMqttConfigService,
    ) {}

    public function run(callable $log, bool $once = false, array $forcedTenants = []): void
    {
        do {
            $contexts = [];
            $restartReason = 'error';
            try {
                $configs = $this->tenantMqttConfigService->runtimeConfigs($forcedTenants);
                if (empty($configs)) {
                    throw new \RuntimeException('Belum ada konfigurasi MQTT RFID yang aktif.');
                }

                $contexts = $this->connectContexts($configs, $log);
                if (empty($contexts)) {
                    throw new \RuntimeException('Tidak ada koneksi MQTT RFID yang berhasil dibuat.');
                }

                if ($once) {
                    foreach ($contexts as $context) {
                        try {
                            $this->publishScopedTenantModes(
                                $context['client'],
                                $context['cfg'],
                                $forcedTenants,
                                $this->normalizeQos((int) ($context['cfg']['qos'] ?? 1)),
                                $log
                            );
                        } catch (\Throwable $e) {
                            $tenantSlug = $this->nullableString($context['cfg']['tenant_slug'] ?? null) ?: '*';
                            $log('warning', sprintf('Publish mode MQTT dilewati [%s]: %s', $tenantSlug, $e->getMessage()));
                        }
                    }
                    $log('info', 'Bridge selesai dijalankan sekali (--once).');

                    return;
                }

                $restartReason = $this->runContextsLoop($contexts, $forcedTenants, $log);
            } catch (\Throwable $e) {
                $log('error', 'MQTT bridge error: '.$e->getMessage());
            } finally {
                $this->disconnectContexts($contexts);
            }

            if ($once) {
                break;
            }

            $delay = max(1, (int) (config('rfid.mqtt.reconnect_delay_seconds', 5)));
            $log('warning', sprintf('MQTT reconnect dalam %d detik...', $delay));
            sleep($delay);
        } while (true);
    }

    private function connectContexts(array $configs, callable $log): array
    {
        $contexts = [];

        foreach ($configs as $cfg) {
            try {
                $contexts[$this->contextIdentityKey($cfg)] = $this->connectContext($cfg, $log);
            } catch (\Throwable $e) {
                $tenantSlug = $this->nullableString($cfg['tenant_slug'] ?? null) ?: '*';
                $log('error', sprintf('Gagal konek MQTT [%s]: %s', $tenantSlug, $e->getMessage()));
            }
        }

        return $contexts;
    }

    private function runContextsLoop(array &$contexts, array $forcedTenants, callable $log): string
    {
        $reloadInterval = max(30, (int) config('rfid.mqtt.config_reload_interval_seconds', 60));
        $lastReloadAt = microtime(true);

        while (true) {
            foreach ($contexts as $key => &$context) {
                $client = $context['client'] ?? null;
                if (! $client instanceof MqttClient || ! $client->isConnected()) {
                    unset($contexts[$key]);

                    continue;
                }

                $cfg = (array) ($context['cfg'] ?? []);
                $qos = $this->normalizeQos((int) ($cfg['qos'] ?? 1));

                try {
                    $client->loopOnce((float) ($context['started_at'] ?? microtime(true)), false);
                } catch (\Throwable $e) {
                    $tenantSlug = $this->nullableString($cfg['tenant_slug'] ?? null) ?: '*';
                    $log('error', sprintf('MQTT loop error [%s]: %s', $tenantSlug, $e->getMessage()));
                    $this->disconnectClient($client);
                    unset($contexts[$key]);

                    continue;
                }

                $interval = max(5, (int) ($cfg['mode_sync_interval_seconds'] ?? config('rfid.mqtt.mode_sync_interval_seconds', 20)));
                $now = microtime(true);
                if (! ($context['mode_synced'] ?? false) || ($now - (float) ($context['last_mode_sync_at'] ?? 0)) >= $interval) {
                    try {
                        $this->publishScopedTenantModes($client, $cfg, $forcedTenants, $qos, $log);
                        $context['mode_synced'] = true;
                        $context['last_mode_sync_at'] = $now;
                    } catch (\Throwable $e) {
                        $tenantSlug = $this->nullableString($cfg['tenant_slug'] ?? null) ?: '*';
                        $log('warning', sprintf('Publish mode MQTT dilewati [%s]: %s', $tenantSlug, $e->getMessage()));
                        $context['last_mode_sync_at'] = $now;
                    }
                }
            }
            unset($context);

            if (empty($contexts)) {
                $log('warning', 'Semua koneksi MQTT RFID terputus.');

                return 'disconnected';
            }

            if ((microtime(true) - $lastReloadAt) >= $reloadInterval) {
                $lastReloadAt = microtime(true);
                $this->reconcileContexts($contexts, $forcedTenants, $log);
            }

            usleep(100000);
        }
    }

    private function connectContext(array $cfg, callable $log): array
    {
        $host = trim((string) ($cfg['connect_host'] ?? $cfg['host'] ?? ''));
        $port = (int) ($cfg['connect_port'] ?? $cfg['port'] ?? 0);
        $tenantSlug = $this->nullableString($cfg['tenant_slug'] ?? null) ?: '*';

        if ($host === '' || $port <= 0) {
            throw new \RuntimeException(sprintf('MQTT config [%s] tidak memiliki host/port.', $tenantSlug));
        }

        $client = $this->connectClient($cfg, $log);
        $scanFilter = $this->scanTopicFilter($cfg);
        $qos = $this->normalizeQos((int) ($cfg['qos'] ?? 1));

        $log('info', sprintf('MQTT subscribe [%s]: %s', $tenantSlug, $scanFilter));
        $client->subscribe(
            $scanFilter,
            function (string $topic, string $message, bool $retained, array $matchedWildcards) use ($client, $cfg, $qos, $log) {
                unset($retained, $matchedWildcards);
                $this->handleIncomingScan($client, $cfg, $topic, $message, $qos, $log);
            },
            $qos
        );

        return [
            'client' => $client,
            'cfg' => $cfg,
            'fingerprint' => $this->configFingerprint($cfg),
            'started_at' => microtime(true),
            'last_mode_sync_at' => 0.0,
            'mode_synced' => false,
        ];
    }

    private function reconcileContexts(array &$contexts, array $forcedTenants, callable $log): void
    {
        try {
            $configs = $this->tenantMqttConfigService->runtimeConfigs($forcedTenants);
        } catch (\Throwable $e) {
            $log('warning', 'Pemeriksaan konfigurasi MQTT dilewati: '.$e->getMessage());

            return;
        }

        $nextConfigs = [];
        foreach ($configs as $cfg) {
            $nextConfigs[$this->contextIdentityKey($cfg)] = $cfg;
        }

        foreach ($nextConfigs as $key => $cfg) {
            $current = $contexts[$key] ?? null;
            $nextFingerprint = $this->configFingerprint($cfg);
            if (is_array($current) && hash_equals((string) ($current['fingerprint'] ?? ''), $nextFingerprint)) {
                continue;
            }

            $tenantSlug = $this->nullableString($cfg['tenant_slug'] ?? null) ?: '*';
            try {
                $this->probeConfig($cfg, $log);
                $previousContext = is_array($current) ? $current : null;
                $previous = $previousContext['client'] ?? null;
                if ($previous instanceof MqttClient) {
                    $this->disconnectClient($previous);
                }

                try {
                    $contexts[$key] = $this->connectContext($cfg, $log);
                } catch (\Throwable $activationError) {
                    if (is_array($previousContext)) {
                        try {
                            $contexts[$key] = $this->connectContext((array) $previousContext['cfg'], $log);
                        } catch (\Throwable $rollbackError) {
                            unset($contexts[$key]);
                            throw new \RuntimeException(
                                $activationError->getMessage().'; rollback gagal: '.$rollbackError->getMessage(),
                                previous: $activationError
                            );
                        }
                    }

                    throw $activationError;
                }
                $log('info', sprintf('Konfigurasi MQTT diterapkan [%s] tanpa restart bridge massal.', $tenantSlug));
            } catch (\Throwable $e) {
                $log('error', sprintf('Konfigurasi MQTT baru ditolak [%s], koneksi lama dipertahankan: %s', $tenantSlug, $e->getMessage()));
            }
        }

        foreach (array_diff(array_keys($contexts), array_keys($nextConfigs)) as $removedKey) {
            $removed = $contexts[$removedKey] ?? null;
            if (is_array($removed) && ($removed['client'] ?? null) instanceof MqttClient) {
                $this->disconnectClient($removed['client']);
            }
            unset($contexts[$removedKey]);
            $log('info', sprintf('Koneksi MQTT yang dinonaktifkan telah dilepas [%s].', $removedKey));
        }
    }

    private function probeConfig(array $cfg, callable $log): void
    {
        $probeId = substr($this->stableClientId($cfg).'-probe-'.Str::lower(Str::random(6)), 0, 110);
        $client = $this->connectClient($cfg, $log, $probeId, true, false);
        $this->disconnectClient($client);
    }

    private function disconnectContexts(array $contexts): void
    {
        foreach ($contexts as $context) {
            $client = $context['client'] ?? null;
            if ($client instanceof MqttClient) {
                $this->disconnectClient($client);
            }
        }
    }

    private function disconnectClient(MqttClient $client): void
    {
        if (! $client->isConnected()) {
            return;
        }

        try {
            $client->disconnect();
        } catch (\Throwable $e) {
            // ignore disconnect errors
        }
    }

    private function connectClient(
        array $cfg,
        callable $log,
        ?string $clientIdOverride = null,
        bool $cleanSession = false,
        bool $automaticReconnect = true
    ): MqttClient {
        $clientId = $clientIdOverride ?: $this->stableClientId($cfg);

        $client = new MqttClient(
            (string) ($cfg['connect_host'] ?? $cfg['host']),
            (int) ($cfg['connect_port'] ?? $cfg['port']),
            $clientId,
            MqttClient::MQTT_3_1_1
        );
        $username = $this->nullableString($cfg['bridge_username'] ?? null)
            ?? $this->nullableString($cfg['username'] ?? null);
        $password = $this->nullableString($cfg['bridge_password'] ?? null)
            ?? $this->nullableString($cfg['password'] ?? null);

        $settings = (new ConnectionSettings)
            ->setUsername($username)
            ->setPassword($password)
            ->setConnectTimeout(max(3, (int) ($cfg['connect_timeout'] ?? 20)))
            ->setSocketTimeout(max(1, (int) ($cfg['socket_timeout'] ?? 5)))
            ->setKeepAliveInterval(max(3, (int) ($cfg['keep_alive'] ?? 20)))
            ->setReconnectAutomatically($automaticReconnect)
            ->setMaxReconnectAttempts(max(1, (int) config('rfid.mqtt.auto_reconnect_max_attempts', 5)))
            ->setDelayBetweenReconnectAttempts(max(100, (int) config('rfid.mqtt.auto_reconnect_delay_milliseconds', 500)))
            ->setUseTls((bool) ($cfg['connect_use_tls'] ?? $cfg['use_tls'] ?? true))
            ->setTlsVerifyPeer((bool) ($cfg['tls_verify_peer'] ?? true))
            ->setTlsVerifyPeerName((bool) ($cfg['tls_verify_peer_name'] ?? true))
            ->setTlsSelfSignedAllowed((bool) ($cfg['tls_allow_self_signed'] ?? false));

        $client->connect($settings, $cleanSession);
        $log('info', sprintf(
            'MQTT connected: %s:%d (%s)',
            (string) ($cfg['connect_host'] ?? $cfg['host']),
            (int) ($cfg['connect_port'] ?? $cfg['port']),
            $clientId
        ));

        return $client;
    }

    private function publishScopedTenantModes(
        MqttClient $client,
        array $cfg,
        array $forcedTenants,
        int $qos,
        callable $log
    ): void {
        $tenantSlug = $this->nullableString($cfg['tenant_slug'] ?? null);
        if ($tenantSlug) {
            $this->publishTenantModes($client, $cfg, [$tenantSlug], $qos, $log);

            return;
        }

        $this->publishTenantModes($client, $cfg, $forcedTenants, $qos, $log);
    }

    private function handleIncomingScan(
        MqttClient $client,
        array $cfg,
        string $topic,
        string $message,
        int $qos,
        callable $log
    ): void {
        $maxPayloadBytes = (int) config('rfid.mqtt.max_payload_bytes', 8192);
        if ($maxPayloadBytes > 0 && strlen($message) > $maxPayloadBytes) {
            $log('warning', sprintf(
                'Payload scan MQTT ditolak karena terlalu besar pada topik %s (%d bytes, maks %d bytes).',
                $topic,
                strlen($message),
                $maxPayloadBytes
            ));

            return;
        }

        $payload = json_decode($message, true);
        if (! is_array($payload)) {
            $log('warning', sprintf('Payload scan invalid JSON pada topik %s', $topic));

            return;
        }

        $topicDeviceId = $this->extractDeviceIdFromTopic($cfg, $topic);
        $payloadDeviceId = trim((string) ($payload['device_id'] ?? ''));
        if (
            $topicDeviceId !== ''
            && $payloadDeviceId !== ''
            && ! hash_equals(Str::lower($topicDeviceId), Str::lower($payloadDeviceId))
        ) {
            $log('warning', sprintf(
                'Payload scan MQTT ditolak: device_id payload %s tidak sesuai dengan topic %s.',
                $payloadDeviceId,
                $topic
            ));

            return;
        }

        $deviceId = $topicDeviceId !== '' ? $topicDeviceId : $payloadDeviceId;
        if ($deviceId !== '' && ! $this->isSafeMqttTopicSegment($deviceId)) {
            $log('warning', sprintf(
                'Payload scan MQTT ditolak: device_id %s tidak aman untuk topic MQTT.',
                $deviceId
            ));

            return;
        }
        $cardUid = trim((string) ($payload['card_uid'] ?? ''));
        $mode = trim((string) ($payload['mode'] ?? ''));
        $eventId = trim((string) ($payload['event_id'] ?? $payload['scan_id'] ?? ''));
        $scannedAt = trim((string) ($payload['scanned_at'] ?? $payload['timestamp'] ?? ''));
        $tenantSlug = $this->resolveTenantSlugFromMessage($cfg, $topic, $payload, $deviceId);

        if ($tenantSlug === '') {
            $log('warning', sprintf('Tenant tidak bisa ditentukan untuk device %s', $deviceId ?: '-'));

            return;
        }

        if ($deviceId !== '') {
            $this->rfidDeviceService->touchDeviceSeen($deviceId, 'mqtt', null, $this->deviceTelemetryFromPayload($payload, [
                'last_mqtt_topic' => $topic,
                'last_scan_at' => now('Asia/Jakarta')->toIso8601String(),
            ]));
        }

        $result = $this->rfidIngressService->processScanByTenantSlug(
            tenantSlug: $tenantSlug,
            cardUid: $cardUid,
            deviceId: $deviceId,
            mode: $mode,
            source: 'mqtt',
            eventId: $eventId,
            scannedAt: $scannedAt,
            payload: $payload,
        );
        $responseTopic = $this->renderTopicTemplate(
            (string) ($cfg['response_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/response'),
            $tenantSlug,
            $deviceId
        );

        $responsePayload = is_array($result['data'] ?? null) ? $result['data'] : [];
        if (! array_key_exists('event_id', $responsePayload) && $eventId !== '') {
            $responsePayload['event_id'] = $eventId;
        }
        if (! array_key_exists('device_id', $responsePayload) && $deviceId !== '') {
            $responsePayload['device_id'] = $deviceId;
        }
        if (! array_key_exists('card_uid', $responsePayload) && $cardUid !== '') {
            $responsePayload['card_uid'] = $cardUid;
        }
        if (! array_key_exists('tenant_slug', $responsePayload) && $tenantSlug !== '') {
            $responsePayload['tenant_slug'] = $tenantSlug;
        }
        $responsePayload['source'] = 'rfid-mqtt-bridge';
        $responsePayload['received_topic'] = $topic;
        $responsePayload['http_status'] = (int) ($result['status'] ?? 500);

        $client->publish(
            $responseTopic,
            json_encode($responsePayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            $qos,
            false
        );

        $this->publishTenantModeAfterScan($client, $cfg, $tenantSlug, $deviceId, $qos, $log);
    }

    private function publishTenantModes(
        MqttClient $client,
        array $cfg,
        array $forcedTenants,
        int $qos,
        callable $log
    ): void {
        $tenants = $this->resolveModeTenants($forcedTenants);
        foreach ($tenants as $tenantSlug) {
            $this->publishTenantMode($client, $cfg, $tenantSlug, $qos, $log);
        }
    }

    private function publishTenantModeAfterScan(
        MqttClient $client,
        array $cfg,
        string $tenantSlug,
        string $deviceId,
        int $qos,
        callable $log
    ): void {
        try {
            $this->publishTenantModeAfterScanUnsafe($client, $cfg, $tenantSlug, $deviceId, $qos);
        } catch (\Throwable $e) {
            $log('warning', sprintf(
                'Publish mode setelah scan dilewati [%s/%s]: %s',
                $tenantSlug,
                $deviceId !== '' ? $deviceId : '-',
                $e->getMessage()
            ));
        }
    }

    private function publishTenantModeAfterScanUnsafe(MqttClient $client, array $cfg, string $tenantSlug, string $deviceId, int $qos): void
    {
        $throttleSeconds = max(0, (int) config('rfid.performance.mqtt_mode_publish_after_scan_throttle_seconds', 5));
        $cacheKey = $this->contextKey($cfg).'|mode-after-scan|'.$tenantSlug.'|'.$deviceId;
        $now = microtime(true);

        if (
            $throttleSeconds > 0
            && isset($this->modePublishAfterScanAt[$cacheKey])
            && ($now - $this->modePublishAfterScanAt[$cacheKey]) < $throttleSeconds
        ) {
            return;
        }

        if ($this->publishTenantMode($client, $cfg, $tenantSlug, $qos, null, $deviceId)) {
            $this->modePublishAfterScanAt[$cacheKey] = $now;
        }
    }

    private function publishTenantMode(
        MqttClient $client,
        array $cfg,
        string $tenantSlug,
        int $qos,
        ?callable $log = null,
        ?string $deviceId = null
    ): bool {
        $result = $this->rfidScanService->modeByTenantSlug($tenantSlug);
        if ((int) ($result['status'] ?? 500) !== 200 || ! is_array($result['data'] ?? null)) {
            return false;
        }

        $mode = (string) (($result['data']['mode'] ?? 'auto'));
        $template = (string) ($cfg['mode_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/mode');
        if (str_contains($template, '{device}')) {
            $devices = $deviceId !== null && trim($deviceId) !== ''
                ? [['device_id' => trim($deviceId), 'status' => 'active']]
                : $this->rfidDeviceService->listDevices($tenantSlug);

            $published = false;
            foreach ($devices as $device) {
                $targetDeviceId = trim((string) ($device['device_id'] ?? ''));
                $status = Str::lower(trim((string) ($device['status'] ?? 'active')));
                if ($targetDeviceId === '' || in_array($status, ['blocked', 'inactive', 'disabled'], true)) {
                    continue;
                }

                $modeTopic = $this->renderTopicTemplate($template, $tenantSlug, $targetDeviceId);
                $client->publish($modeTopic, $mode, $qos, true);
                $published = true;

                if ($log !== null) {
                    $log('debug', sprintf('Publish mode [%s/%s] => %s', $tenantSlug, $targetDeviceId, $mode));
                }
            }

            return $published || $deviceId === null;
        }

        $modeTopic = $this->renderTopicTemplate(
            $template,
            $tenantSlug
        );
        $client->publish($modeTopic, $mode, $qos, true);

        if ($log !== null) {
            $log('debug', sprintf('Publish mode [%s] => %s', $tenantSlug, $mode));
        }

        return true;
    }

    private function resolveModeTenants(array $forcedTenants): array
    {
        $forced = array_values(array_filter(array_map(
            fn ($value) => trim((string) $value),
            $forcedTenants
        )));

        if (! empty($forced)) {
            return array_values(array_unique($forced));
        }

        $blockedStatuses = ['suspended', 'archived', 'inactive', 'disabled'];

        return DB::table('tenants')
            ->orderBy('slug')
            ->get(['slug', 'status'])
            ->filter(function ($row) use ($blockedStatuses) {
                $status = Str::lower(trim((string) ($row->status ?? 'active')));

                return ! in_array($status, $blockedStatuses, true);
            })
            ->pluck('slug')
            ->map(fn ($slug) => trim((string) $slug))
            ->filter(fn ($slug) => $slug !== '')
            ->values()
            ->all();
    }

    private function resolveTenantSlugFromMessage(array $cfg, string $topic, array $payload, string $deviceId): string
    {
        $configTenant = $this->nullableString($cfg['tenant_slug'] ?? null);
        if ($deviceId !== '') {
            $registered = $this->rfidDeviceService->resolveRegisteredTenantSlug($deviceId);
            if ($configTenant !== null) {
                return $registered === '' || $registered === Str::lower($configTenant)
                    ? Str::lower($configTenant)
                    : '';
            }

            if ($registered !== '') {
                return $registered;
            }
        }

        if ($configTenant !== null) {
            return Str::lower($configTenant);
        }

        $fromTopic = $this->extractTenantSlugFromTopic($cfg, $topic);
        if ($fromTopic !== '') {
            return $fromTopic;
        }

        $fromPayload = trim((string) ($payload['tenant_slug'] ?? ''));
        if ($fromPayload !== '') {
            return Str::lower($fromPayload);
        }

        $map = $this->deviceTenantMap($cfg);
        if ($deviceId !== '') {
            $mapped = trim((string) ($map[$deviceId] ?? ''));
            if ($mapped !== '') {
                return Str::lower($mapped);
            }
        }

        $defaultTenant = trim((string) ($cfg['default_tenant_slug'] ?? ''));
        if ($defaultTenant !== '') {
            return Str::lower($defaultTenant);
        }

        return '';
    }

    private function extractTenantSlugFromTopic(array $cfg, string $topic): string
    {
        $template = trim((string) ($cfg['scan_topic_template'] ?? ''));
        if ($template === '' || ! str_contains($template, '{tenant}')) {
            return '';
        }

        $regex = preg_quote($template, '#');
        $regex = str_replace('\{tenant\}', '([^/]+)', $regex);
        $regex = str_replace('\{device\}', '[^/]+', $regex);

        if (! preg_match('#^'.$regex.'$#', $topic, $matches)) {
            return '';
        }

        return isset($matches[1]) ? Str::lower(trim((string) $matches[1])) : '';
    }

    private function extractDeviceIdFromTopic(array $cfg, string $topic): string
    {
        $template = trim((string) ($cfg['scan_topic_template'] ?? ''));
        if ($template === '' || ! str_contains($template, '{device}')) {
            return '';
        }

        $regex = preg_quote($template, '#');
        $regex = str_replace('\{tenant\}', '[^/]+', $regex);
        $regex = str_replace('\{device\}', '([^/]+)', $regex);

        if (! preg_match('#^'.$regex.'$#', $topic, $matches)) {
            return '';
        }

        return isset($matches[1]) ? trim((string) $matches[1]) : '';
    }

    private function scanTopicFilter(array $cfg): string
    {
        $tenantSlug = $this->nullableString($cfg['tenant_slug'] ?? null);
        $filter = trim((string) ($cfg['scan_topic_filter'] ?? ''));
        if ($filter !== '') {
            return $tenantSlug ? $this->renderTopicTemplate($filter, $tenantSlug) : $filter;
        }

        $template = trim((string) ($cfg['scan_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/scan'));
        if (str_contains($template, '{tenant}')) {
            $topic = $tenantSlug ? $this->renderTopicTemplate($template, $tenantSlug, '+') : str_replace('{tenant}', '+', $template);

            return str_replace('{device}', '+', $topic);
        }

        return str_replace('{device}', '+', $template);
    }

    private function renderTopicTemplate(string $template, string $tenantSlug, string $deviceId = ''): string
    {
        $topic = str_replace(
            ['{tenant}', '{device}'],
            [$tenantSlug, $deviceId !== '' ? $deviceId : 'RFID_DEVICE'],
            trim($template)
        );

        return $topic !== '' ? $topic : sprintf('edusmart/%s/rfid/response', $tenantSlug);
    }

    private function isSafeMqttTopicSegment(string $value): bool
    {
        return preg_match('/^[A-Za-z0-9._-]{1,191}$/', $value) === 1;
    }

    private function deviceTelemetryFromPayload(array $payload, array $defaults = []): array
    {
        $metadata = $defaults;
        foreach ([
            'firmware_version',
            'firmware',
            'wifi_rssi',
            'rssi',
            'free_heap',
            'heap',
            'battery',
            'ip_address',
            'local_ip',
            'ip',
            'mac',
        ] as $key) {
            if (array_key_exists($key, $payload) && $payload[$key] !== null && $payload[$key] !== '') {
                $metadata[$key] = $payload[$key];
            }
        }

        return $metadata;
    }

    private function deviceTenantMap(array $cfg): array
    {
        $raw = $cfg['device_tenant_map'] ?? [];
        if (is_array($raw)) {
            return $raw;
        }

        if (! is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            return [];
        }

        return $decoded;
    }

    private function normalizeQos(int $qos): int
    {
        if ($qos < 0) {
            return 0;
        }

        if ($qos > 2) {
            return 2;
        }

        return $qos;
    }

    private function contextKey(array $cfg): string
    {
        return implode('|', [
            $this->nullableString($cfg['tenant_slug'] ?? null) ?: 'global',
            trim((string) ($cfg['connect_host'] ?? $cfg['host'] ?? '')),
            (string) ((int) ($cfg['connect_port'] ?? $cfg['port'] ?? 0)),
            trim((string) (($this->nullableString($cfg['bridge_username'] ?? null) ?? $this->nullableString($cfg['username'] ?? null)) ?? '')),
            trim((string) ($cfg['scan_topic_template'] ?? '')),
            trim((string) ($cfg['scan_topic_filter'] ?? '')),
        ]);
    }

    private function contextIdentityKey(array $cfg): string
    {
        $tenantId = trim((string) ($cfg['tenant_id'] ?? ''));
        if ($tenantId !== '') {
            return 'tenant-id:'.Str::lower($tenantId);
        }

        return 'tenant-slug:'.($this->nullableString($cfg['tenant_slug'] ?? null) ?: 'global');
    }

    private function configFingerprint(array $cfg): string
    {
        $keys = [
            'connect_host', 'connect_port', 'connect_use_tls', 'host', 'port', 'username',
            'password', 'bridge_username', 'bridge_password', 'use_tls', 'tls_verify_peer',
            'tls_verify_peer_name', 'tls_allow_self_signed', 'qos', 'client_id_prefix',
            'scan_topic_template', 'scan_topic_filter', 'response_topic_template',
            'mode_topic_template', 'connect_timeout', 'socket_timeout', 'keep_alive',
            'default_tenant_slug', 'device_tenant_map',
        ];
        $relevant = [];
        foreach ($keys as $key) {
            $relevant[$key] = $cfg[$key] ?? null;
        }

        return hash('sha256', json_encode($relevant, JSON_UNESCAPED_SLASHES) ?: '');
    }

    private function stableClientId(array $cfg): string
    {
        $prefix = Str::slug(trim((string) ($cfg['client_id_prefix'] ?? 'edusmart-rfid-bridge')));
        $tenant = Str::slug($this->nullableString($cfg['tenant_slug'] ?? null) ?: 'global');
        $identity = substr(hash('sha256', $this->contextIdentityKey($cfg)), 0, 10);
        $clientId = trim(sprintf('%s-%s-%s', $prefix ?: 'edusmart-rfid-bridge', $tenant ?: 'global', $identity), '-');

        return substr($clientId, 0, 96);
    }

    private function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }
}
