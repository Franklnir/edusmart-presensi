<?php

namespace App\Services\Rfid;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

class MqttBridgeService
{
    public function __construct(
        private readonly RfidScanService $rfidScanService
    ) {
    }

    public function run(callable $log, bool $once = false, array $forcedTenants = []): void
    {
        $cfg = $this->mqttConfig();
        $host = trim((string) ($cfg['host'] ?? ''));
        $port = (int) ($cfg['port'] ?? 0);

        if ($host === '' || $port <= 0) {
            throw new \RuntimeException('Konfigurasi MQTT belum lengkap (RFID_MQTT_HOST / RFID_MQTT_PORT).');
        }

        do {
            $client = null;
            try {
                $client = $this->connectClient($cfg, $log);
                $scanFilter = $this->scanTopicFilter($cfg);
                $qos = $this->normalizeQos((int) ($cfg['qos'] ?? 1));

                $log('info', sprintf('MQTT subscribe: %s', $scanFilter));

                $client->subscribe(
                    $scanFilter,
                    function (string $topic, string $message, bool $retained, array $matchedWildcards) use ($client, $cfg, $qos, $log) {
                        $this->handleIncomingScan($client, $cfg, $topic, $message, $qos, $log);
                    },
                    $qos
                );

                if ($once) {
                    $this->publishTenantModes($client, $cfg, $forcedTenants, $qos, $log);
                    $log('info', 'Bridge selesai dijalankan sekali (--once).');

                    return;
                }

                $interval = max(5, (int) ($cfg['mode_sync_interval_seconds'] ?? 20));
                $lastSyncAt = 0.0;
                $initialSynced = false;

                $client->registerLoopEventHandler(function (MqttClient $mqtt, float $elapsedTime) use ($forcedTenants, $qos, $cfg, $log, $interval, &$lastSyncAt, &$initialSynced) {
                    unset($elapsedTime);
                    $now = microtime(true);
                    if (!$initialSynced || ($now - $lastSyncAt) >= $interval) {
                        $this->publishTenantModes($mqtt, $cfg, $forcedTenants, $qos, $log);
                        $initialSynced = true;
                        $lastSyncAt = $now;
                    }
                });

                $client->loop(true);
            } catch (\Throwable $e) {
                $log('error', 'MQTT bridge error: ' . $e->getMessage());
            } finally {
                if ($client instanceof MqttClient && $client->isConnected()) {
                    try {
                        $client->disconnect();
                    } catch (\Throwable $e) {
                        // ignore disconnect errors
                    }
                }
            }

            if ($once) {
                break;
            }

            $delay = max(1, (int) ($cfg['reconnect_delay_seconds'] ?? 5));
            $log('warning', sprintf('MQTT reconnect dalam %d detik...', $delay));
            sleep($delay);
        } while (true);
    }

    private function connectClient(array $cfg, callable $log): MqttClient
    {
        $clientId = sprintf(
            '%s-%s',
            trim((string) ($cfg['client_id_prefix'] ?? 'edusmart-rfid-bridge')),
            Str::lower(Str::random(8))
        );

        $client = new MqttClient(
            (string) $cfg['host'],
            (int) $cfg['port'],
            $clientId,
            MqttClient::MQTT_3_1_1
        );

        $settings = (new ConnectionSettings())
            ->setUsername($this->nullableString($cfg['username'] ?? null))
            ->setPassword($this->nullableString($cfg['password'] ?? null))
            ->setConnectTimeout(max(3, (int) ($cfg['connect_timeout'] ?? 20)))
            ->setSocketTimeout(max(1, (int) ($cfg['socket_timeout'] ?? 5)))
            ->setKeepAliveInterval(max(3, (int) ($cfg['keep_alive'] ?? 20)))
            ->setUseTls((bool) ($cfg['use_tls'] ?? true))
            ->setTlsVerifyPeer((bool) ($cfg['tls_verify_peer'] ?? true))
            ->setTlsVerifyPeerName((bool) ($cfg['tls_verify_peer_name'] ?? true))
            ->setTlsSelfSignedAllowed((bool) ($cfg['tls_allow_self_signed'] ?? false));

        $client->connect($settings, true);
        $log('info', sprintf('MQTT connected: %s:%d (%s)', $cfg['host'], $cfg['port'], $clientId));

        return $client;
    }

    private function handleIncomingScan(
        MqttClient $client,
        array $cfg,
        string $topic,
        string $message,
        int $qos,
        callable $log
    ): void {
        $payload = json_decode($message, true);
        if (!is_array($payload)) {
            $log('warning', sprintf('Payload scan invalid JSON pada topik %s', $topic));
            return;
        }

        $deviceId = trim((string) ($payload['device_id'] ?? ''));
        $cardUid = trim((string) ($payload['card_uid'] ?? ''));
        $mode = trim((string) ($payload['mode'] ?? ''));
        $tenantSlug = $this->resolveTenantSlugFromMessage($cfg, $topic, $payload, $deviceId);

        if ($tenantSlug === '') {
            $log('warning', sprintf('Tenant tidak bisa ditentukan untuk device %s', $deviceId ?: '-'));
            return;
        }

        $result = $this->rfidScanService->processScanByTenantSlug($tenantSlug, $cardUid, $deviceId, $mode);
        $responseTopic = $this->renderTopicTemplate(
            (string) ($cfg['response_topic_template'] ?? 'edusmart/{tenant}/rfid/response'),
            $tenantSlug
        );

        $responsePayload = $result['data'] ?? [];
        $responsePayload['source'] = 'rfid-mqtt-bridge';
        $responsePayload['received_topic'] = $topic;
        $responsePayload['http_status'] = (int) ($result['status'] ?? 500);

        $client->publish(
            $responseTopic,
            json_encode($responsePayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
            $qos,
            false
        );

        $modeResult = $this->rfidScanService->modeByTenantSlug($tenantSlug);
        if ((int) ($modeResult['status'] ?? 500) === 200 && is_array($modeResult['data'] ?? null)) {
            $modeTopic = $this->renderTopicTemplate(
                (string) ($cfg['mode_topic_template'] ?? 'edusmart/{tenant}/rfid/mode'),
                $tenantSlug
            );
            $mode = (string) ($modeResult['data']['mode'] ?? 'auto');
            $client->publish($modeTopic, $mode, $qos, true);
        }
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
            $result = $this->rfidScanService->modeByTenantSlug($tenantSlug);
            if ((int) ($result['status'] ?? 500) !== 200) {
                continue;
            }

            $mode = (string) (($result['data']['mode'] ?? 'auto'));
            $modeTopic = $this->renderTopicTemplate(
                (string) ($cfg['mode_topic_template'] ?? 'edusmart/{tenant}/rfid/mode'),
                $tenantSlug
            );
            $client->publish($modeTopic, $mode, $qos, true);
            $log('debug', sprintf('Publish mode [%s] => %s', $tenantSlug, $mode));
        }
    }

    private function resolveModeTenants(array $forcedTenants): array
    {
        $forced = array_values(array_filter(array_map(
            fn($value) => trim((string) $value),
            $forcedTenants
        )));

        if (!empty($forced)) {
            return array_values(array_unique($forced));
        }

        $blockedStatuses = ['suspended', 'archived', 'inactive', 'disabled'];

        return DB::table('tenants')
            ->orderBy('slug')
            ->get(['slug', 'status'])
            ->filter(function ($row) use ($blockedStatuses) {
                $status = Str::lower(trim((string) ($row->status ?? 'active')));

                return !in_array($status, $blockedStatuses, true);
            })
            ->pluck('slug')
            ->map(fn($slug) => trim((string) $slug))
            ->filter(fn($slug) => $slug !== '')
            ->values()
            ->all();
    }

    private function resolveTenantSlugFromMessage(array $cfg, string $topic, array $payload, string $deviceId): string
    {
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
        if ($template === '' || !str_contains($template, '{tenant}')) {
            return '';
        }

        $regex = preg_quote($template, '#');
        $regex = str_replace('\{tenant\}', '([^/]+)', $regex);

        if (!preg_match('#^' . $regex . '$#', $topic, $matches)) {
            return '';
        }

        return isset($matches[1]) ? Str::lower(trim((string) $matches[1])) : '';
    }

    private function scanTopicFilter(array $cfg): string
    {
        $filter = trim((string) ($cfg['scan_topic_filter'] ?? ''));
        if ($filter !== '') {
            return $filter;
        }

        $template = trim((string) ($cfg['scan_topic_template'] ?? 'edusmart/{tenant}/rfid/scan'));
        if (str_contains($template, '{tenant}')) {
            return str_replace('{tenant}', '+', $template);
        }

        return $template;
    }

    private function renderTopicTemplate(string $template, string $tenantSlug): string
    {
        $topic = str_replace('{tenant}', $tenantSlug, trim($template));

        return $topic !== '' ? $topic : sprintf('edusmart/%s/rfid/response', $tenantSlug);
    }

    private function deviceTenantMap(array $cfg): array
    {
        $raw = $cfg['device_tenant_map'] ?? [];
        if (is_array($raw)) {
            return $raw;
        }

        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
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

    private function mqttConfig(): array
    {
        $cfg = config('rfid.mqtt', []);
        if (!is_array($cfg)) {
            return [];
        }

        return $cfg;
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
