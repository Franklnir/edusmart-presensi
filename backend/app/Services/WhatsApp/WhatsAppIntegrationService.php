<?php

namespace App\Services\WhatsApp;

use App\Models\WhatsAppIntegration;
use App\Models\WhatsAppMessageLog;
use App\Models\WhatsAppNotificationSetting;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class WhatsAppIntegrationService
{
    public const WEBHOOK_EVENTS = [
        'QRCODE_UPDATED',
        'CONNECTION_UPDATE',
    ];

    public function __construct(
        private readonly EvolutionApiClient $evolutionApiClient,
        private readonly FonnteApiClient $fonnteApiClient
    ) {}

    public function providerConfigured(): bool
    {
        return $this->providerType() === 'fonnte'
            ? $this->fonnteApiClient->isConfigured()
            : $this->evolutionApiClient->isConfigured();
    }

    public function providerType(): string
    {
        $provider = strtolower(trim((string) config('services.whatsapp.provider', 'evolution')));

        return $provider === 'fonnte' ? 'fonnte' : 'evolution';
    }

    public function providerName(): string
    {
        return $this->providerType() === 'fonnte' ? 'Fonnte' : 'Evolution API';
    }

    public function usesCentralProvider(): bool
    {
        return $this->providerType() === 'fonnte'
            || (bool) config('services.whatsapp.central_enabled', true);
    }

    public function senderIntegrationForTenant(string $tenantId): WhatsAppIntegration
    {
        if ($this->providerType() !== 'fonnte' && $this->usesCentralProvider()) {
            $centralTenantId = $this->centralTenantId();
            if ($centralTenantId !== '') {
                return $this->getOrCreateIntegration($centralTenantId);
            }
        }

        return $this->getOrCreateIntegration($tenantId);
    }

    public function getOrCreateIntegration(string $tenantId): WhatsAppIntegration
    {
        $tenantId = trim($tenantId);
        if ($tenantId === '') {
            throw new RuntimeException('Tenant tidak valid.');
        }

        $instanceName = $this->makeInstanceName($tenantId);

        return WhatsAppIntegration::query()->firstOrCreate(
            ['tenant_id' => $tenantId],
            [
                'id' => (string) Str::uuid(),
                'provider' => 'evolution',
                'instance_name' => $instanceName,
                'status' => 'disconnected',
                'connection_state' => 'close',
                'webhook_secret' => Str::random(40),
                'is_enabled' => true,
            ]
        );
    }

    public function getOrCreateNotificationSettings(
        string $tenantId,
        ?WhatsAppIntegration $integration = null
    ): WhatsAppNotificationSetting {
        $integration = $integration ?: $this->getOrCreateIntegration($tenantId);

        $settings = WhatsAppNotificationSetting::query()->firstOrCreate(
            ['tenant_id' => $tenantId],
            [
                'id' => (string) Str::uuid(),
                'integration_id' => $integration->id,
                'is_enabled' => true,
                'send_attendance' => true,
                'send_profile_updates' => false,
                'send_assignment_updates' => false,
                'send_extracurricular_updates' => false,
                'send_grade_updates' => false,
                'recipient_mode' => 'wali',
            ]
        );

        if ($settings->integration_id !== $integration->id) {
            $settings->integration_id = $integration->id;
            $settings->save();
        }

        $this->enforceNotificationPolicy($settings);

        return $settings;
    }

    public function overview(string $tenantId, ?string $requestHost = null): array
    {
        $integration = $this->getOrCreateIntegration($tenantId)->fresh();
        $settings = $this->getOrCreateNotificationSettings($tenantId, $integration)->fresh();
        $school = $this->schoolSettings($tenantId);

        $logs = WhatsAppMessageLog::query()
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->limit(30)
            ->get();

        return [
            'integration' => $integration,
            'settings' => $settings,
            'logs' => $logs,
            'provider' => [
                'configured' => $this->providerConfigured(),
                'name' => $this->providerName(),
                'type' => $this->providerType(),
                'central' => $this->usesCentralProvider(),
                'public_url' => $this->evolutionPublicUrl($requestHost),
            ],
            'school' => $school,
        ];
    }

    public function saveNotificationSettings(string $tenantId, array $payload): WhatsAppNotificationSetting
    {
        $integration = $this->getOrCreateIntegration($tenantId);
        $settings = $this->getOrCreateNotificationSettings($tenantId, $integration);

        $settings->fill([
            'integration_id' => $integration->id,
            'is_enabled' => (bool) ($payload['is_enabled'] ?? $settings->is_enabled),
            'send_attendance' => (bool) ($payload['send_attendance'] ?? $settings->send_attendance),
            'send_profile_updates' => false,
            'send_assignment_updates' => false,
            'send_extracurricular_updates' => false,
            'send_grade_updates' => false,
            'recipient_mode' => 'wali',
        ]);
        $settings->save();

        return $settings->fresh();
    }

    public function requestQr(string $tenantId, ?string $requestHost = null): array
    {
        $this->evolutionApiClient->assertConfigured();

        $integration = $this->getOrCreateIntegration($tenantId);
        $this->getOrCreateNotificationSettings($tenantId, $integration);
        $webhookError = null;

        try {
            $remote = $this->evolutionApiClient->fetchInstance($integration->instance_name);
            if ($remote && $this->normalizeConnectionState((string) ($remote['status'] ?? $remote['connectionStatus'] ?? '')) === 'open') {
                $webhookError = $this->safeSetWebhook($integration);

                $this->applyRemoteSnapshot($integration, $remote);
                $integration->fill([
                    'last_error' => $webhookError ?: 'WhatsApp sudah terhubung. Logout dulu jika ingin membuat QR baru.',
                    'last_synced_at' => now(),
                ]);
                $integration->save();

                return $this->overview($tenantId, $requestHost);
            }

            $created = [];
            $connect = [];
            if (! $remote) {
                $created = $this->createInstanceForQr($integration);
                $webhookError = $this->safeSetWebhook($integration);
            } else {
                $this->applyRemoteSnapshot($integration, $remote);

                $webhookError = $this->safeSetWebhook($integration);

                ['response' => $connect, 'error' => $connectError] = $this->attemptQrConnect($integration->instance_name);
                if (! $this->hasQrPayload($connect) && $this->shouldRecreateRemoteInstance($remote)) {
                    $created = $this->recreateInstanceForQr($integration);
                    $webhookError = $this->safeSetWebhook($integration);
                    $connect = [];
                    $connectError = null;
                }
            }

            $connectError = $connectError ?? null;
            $qrCode = $this->extractQrCode($created);
            $pairingCode = $this->extractPairingCode($created);

            if ($qrCode === '' && $pairingCode === '') {
                $qrCode = $this->extractQrCode($connect);
                $pairingCode = $this->extractPairingCode($connect);
            }

            if ($qrCode === '' && $pairingCode === '') {
                ['response' => $connect, 'error' => $connectError] = $this->attemptQrConnect($integration->instance_name);
                $qrCode = $this->extractQrCode($connect);
                $pairingCode = $this->extractPairingCode($connect);
            }

            $hasFreshQr = $qrCode !== '' || $pairingCode !== '';
            $lastError = $connectError ?: $webhookError;

            $integration->fill([
                // Evolution v2 may deliver the QR via webhook instead of connect response.
                'status' => 'awaiting_qr',
                'connection_state' => 'connecting',
                'qr_code' => $qrCode !== '' ? $qrCode : null,
                'pairing_code' => $pairingCode ?: null,
                'qr_updated_at' => $hasFreshQr ? now() : null,
                'last_synced_at' => now(),
                'last_error' => $lastError,
            ]);
            $integration->save();
        } catch (\Throwable $e) {
            $integration->fill([
                'status' => $integration->status ?: 'disconnected',
                'connection_state' => $integration->connection_state ?: 'close',
                'last_synced_at' => now(),
                'last_error' => $this->normalizeProviderErrorMessage($e->getMessage()),
            ]);
            $integration->save();
        }

        return $this->overview($tenantId, $requestHost);
    }

    public function synchronize(string $tenantId, ?string $requestHost = null): array
    {
        $integration = $this->getOrCreateIntegration($tenantId);
        $this->syncIntegration($integration, true);

        return $this->overview($tenantId, $requestHost);
    }

    public function syncIntegration(WhatsAppIntegration $integration, bool $refreshPendingQr = false): WhatsAppIntegration
    {
        if (! $this->providerConfigured()) {
            return $integration;
        }

        $wasAwaitingQr = $this->isAwaitingQrState(
            (string) $integration->status,
            (string) $integration->connection_state
        );
        $remote = $this->evolutionApiClient->fetchInstance($integration->instance_name);
        if (! $remote) {
            $integration->fill([
                'status' => 'disconnected',
                'connection_state' => 'close',
                'last_synced_at' => now(),
                'last_error' => 'Instance belum ditemukan di Evolution API.',
            ]);
            $integration->save();

            return $integration->fresh();
        }

        if ($this->shouldPreserveAwaitingQrState($remote, $wasAwaitingQr)) {
            $integration->fill([
                'status' => 'awaiting_qr',
                'connection_state' => 'connecting',
                'last_synced_at' => now(),
            ]);
            $integration->save();
        } else {
            $this->applyRemoteSnapshot($integration, $remote);
        }

        if ($refreshPendingQr && $this->shouldRefreshPendingQr($remote, $wasAwaitingQr)) {
            $this->refreshPendingQr($integration);
        }

        return $integration->fresh();
    }

    public function syncAll(): int
    {
        if (! $this->providerConfigured() || $this->providerType() === 'fonnte') {
            return 0;
        }

        $remoteItems = $this->evolutionApiClient->fetchAllInstances();
        $remoteMap = [];
        foreach ($remoteItems as $item) {
            $name = trim((string) ($item['instanceName'] ?? ''));
            if ($name !== '') {
                $remoteMap[$name] = $item;
            }
        }

        $count = 0;
        $integrations = WhatsAppIntegration::query()->get();
        foreach ($integrations as $integration) {
            $wasAwaitingQr = $this->isAwaitingQrState(
                (string) $integration->status,
                (string) $integration->connection_state
            );
            $remote = $remoteMap[$integration->instance_name] ?? null;
            if ($remote) {
                if ($this->shouldPreserveAwaitingQrState($remote, $wasAwaitingQr)) {
                    $integration->fill([
                        'status' => 'awaiting_qr',
                        'connection_state' => 'connecting',
                        'last_synced_at' => now(),
                    ]);
                    $integration->save();
                } else {
                    $this->applyRemoteSnapshot($integration, $remote);
                }
            } else {
                $integration->fill([
                    'status' => 'disconnected',
                    'connection_state' => 'close',
                    'last_synced_at' => now(),
                    'last_error' => 'Instance belum ditemukan di Evolution API.',
                ]);
                $integration->save();
            }
            $count++;
        }

        return $count;
    }

    public function logout(string $tenantId, ?string $requestHost = null): array
    {
        $integration = $this->getOrCreateIntegration($tenantId);

        if ($this->providerConfigured()) {
            try {
                $this->evolutionApiClient->logoutInstance($integration->instance_name);
            } catch (\Throwable $e) {
                // Tetap bersihkan state lokal agar UI tidak nyangkut pada QR lama.
            }
        }

        $integration->fill([
            'status' => 'disconnected',
            'connection_state' => 'close',
            'qr_code' => null,
            'pairing_code' => null,
            'connected_phone' => null,
            'connected_name' => null,
            'last_error' => null,
            'last_disconnected_at' => now(),
            'last_synced_at' => now(),
        ]);
        $integration->save();

        return $this->overview($tenantId, $requestHost);
    }

    public function handleWebhook(string $secret, ?string $eventSlug, array $payload): ?WhatsAppIntegration
    {
        $integration = WhatsAppIntegration::query()
            ->where('webhook_secret', $secret)
            ->first();

        if (! $integration) {
            return null;
        }

        $eventName = $this->resolveEventName($eventSlug, $payload);
        $instanceName = $this->extractFirstString($payload, [
            'instance.instanceName',
            'instance.name',
            'instanceName',
            'name',
            'data.instance.instanceName',
            'data.instance.name',
            'data.instanceName',
            'data.name',
        ]);

        if ($instanceName !== '' && $instanceName !== $integration->instance_name) {
            return $integration;
        }

        $updates = [
            'last_webhook_at' => now(),
            'last_webhook_event' => $eventName,
            'last_synced_at' => now(),
            'last_error' => null,
        ];

        if ($eventName === 'QRCODE_UPDATED') {
            $qrCode = $this->extractQrCode($payload);
            $pairingCode = $this->extractFirstString($payload, [
                'pairingCode',
                'data.pairingCode',
                'qrcode.pairingCode',
            ]);

            if ($qrCode !== '') {
                $updates['qr_code'] = $qrCode;
                $updates['status'] = 'awaiting_qr';
                $updates['connection_state'] = 'connecting';
                $updates['qr_updated_at'] = now();
            }
            if ($pairingCode !== '') {
                $updates['pairing_code'] = $pairingCode;
            }
        }

        if ($eventName === 'CONNECTION_UPDATE') {
            $state = $this->normalizeConnectionState($this->extractFirstString($payload, [
                'state',
                'status',
                'connectionStatus',
                'data.state',
                'data.status',
                'data.connectionStatus',
                'instance.state',
                'instance.status',
                'instance.connectionStatus',
                'data.instance.status',
                'data.instance.connectionStatus',
            ]));

            $updates['connection_state'] = $state;
            $updates['status'] = $this->statusFromConnectionState($state);
            $updates['connected_phone'] = $this->normalizeOwnerPhone($this->extractFirstString($payload, [
                'owner',
                'ownerJid',
                'number',
                'data.owner',
                'data.ownerJid',
                'data.number',
                'instance.owner',
                'instance.ownerJid',
                'instance.number',
                'data.instance.owner',
                'data.instance.ownerJid',
                'data.instance.number',
            ]));
            $updates['connected_name'] = $this->extractFirstString($payload, [
                'profileName',
                'data.profileName',
                'instance.profileName',
                'data.instance.profileName',
            ]);

            if ($updates['status'] === 'connected') {
                $updates['qr_code'] = null;
                $updates['pairing_code'] = null;
                $updates['last_connected_at'] = now();
            }

            if ($updates['status'] === 'disconnected') {
                $updates['qr_code'] = null;
                $updates['pairing_code'] = null;
                $updates['last_disconnected_at'] = now();
            }
        }

        $integration->fill($updates);
        $integration->save();

        return $integration->fresh();
    }

    public function sendText(WhatsAppIntegration $integration, string $number, string $text): array
    {
        if ($this->providerType() === 'fonnte') {
            return $this->fonnteApiClient->sendText($number, $text);
        }

        return $this->evolutionApiClient->sendText($integration->instance_name, $number, $text);
    }

    public function schoolSettings(string $tenantId): array
    {
        $tenant = DB::table('tenants')
            ->where('id', $tenantId)
            ->first(['id', 'name', 'slug']);

        $settings = DB::table('settings')
            ->where('tenant_id', $tenantId)
            ->orderBy('id')
            ->first(['nama_sekolah']);

        return array_filter([
            'id' => $tenant->id ?? null,
            'name' => $tenant->name ?? null,
            'slug' => $tenant->slug ?? null,
            'nama_sekolah' => $settings->nama_sekolah ?? null,
        ], fn ($value) => $value !== null);
    }

    private function applyRemoteSnapshot(WhatsAppIntegration $integration, array $remote): void
    {
        $state = $this->normalizeConnectionState((string) ($remote['status'] ?? $remote['connectionStatus'] ?? ''));

        $integration->fill([
            'status' => $this->statusFromConnectionState($state),
            'connection_state' => $state,
            'connected_phone' => $this->normalizeOwnerPhone((string) ($remote['owner'] ?? $remote['ownerJid'] ?? $remote['number'] ?? '')),
            'connected_name' => trim((string) ($remote['profileName'] ?? $remote['profile_name'] ?? '')) ?: null,
            'last_synced_at' => now(),
            'last_error' => null,
        ]);

        if ($integration->status === 'connected') {
            $integration->qr_code = null;
            $integration->pairing_code = null;
            $integration->last_connected_at = $integration->last_connected_at ?: now();
        }

        if ($integration->status === 'disconnected') {
            $integration->last_disconnected_at = now();
        }

        $integration->save();
    }

    private function refreshPendingQr(WhatsAppIntegration $integration): void
    {
        if (! $this->isAwaitingQrState((string) $integration->status, (string) $integration->connection_state)) {
            return;
        }

        try {
            $connect = $this->evolutionApiClient->connectInstance($integration->instance_name);
        } catch (\Throwable $e) {
            $integration->fill([
                'status' => 'awaiting_qr',
                'connection_state' => 'connecting',
                'last_synced_at' => now(),
                'last_error' => $this->normalizeProviderErrorMessage($e->getMessage()),
            ]);
            $integration->save();

            return;
        }

        $qrCode = $this->extractQrCode($connect);
        $pairingCode = $this->extractFirstString($connect, [
            'pairingCode',
            'qrcode.pairingCode',
            'data.pairingCode',
        ]);

        $updates = [
            'status' => 'awaiting_qr',
            'connection_state' => 'connecting',
            'last_synced_at' => now(),
            'last_error' => null,
        ];

        if ($qrCode !== '') {
            $updates['qr_code'] = $qrCode;
            $updates['qr_updated_at'] = now();
        }

        if ($pairingCode !== '') {
            $updates['pairing_code'] = $pairingCode;
            $updates['qr_updated_at'] = now();
        }

        $integration->fill($updates);
        $integration->save();
    }

    private function shouldRefreshPendingQr(array $remote, bool $wasAwaitingQr): bool
    {
        if ($wasAwaitingQr) {
            return true;
        }

        $remoteState = $this->normalizeConnectionState((string) ($remote['status'] ?? $remote['connectionStatus'] ?? ''));

        return $remoteState === 'connecting';
    }

    private function shouldPreserveAwaitingQrState(array $remote, bool $wasAwaitingQr): bool
    {
        if (! $wasAwaitingQr) {
            return false;
        }

        $remoteState = $this->normalizeConnectionState((string) ($remote['status'] ?? $remote['connectionStatus'] ?? ''));

        return $remoteState !== 'open';
    }

    private function shouldRecreateRemoteInstance(array $remote): bool
    {
        $remoteState = $this->normalizeConnectionState((string) ($remote['status'] ?? $remote['connectionStatus'] ?? ''));

        return ! in_array($remoteState, ['open', 'connecting'], true);
    }

    private function isAwaitingQrState(string $status, string $connectionState): bool
    {
        return $status === 'awaiting_qr' || $connectionState === 'connecting';
    }

    private function normalizeProviderErrorMessage(string $message): string
    {
        $message = trim($message);

        return $message !== '' ? $message : 'Evolution API belum mengembalikan QR.';
    }

    private function evolutionPublicUrl(?string $requestHost = null): ?string
    {
        $configured = $this->normalizeUrl((string) config('services.evolution_api.public_url', ''));
        $fallbackHost = $this->normalizeHost((string) config('services.caddy.evolution_host', ''));
        $requestRoot = $this->rootDomainFromHost($requestHost);

        if ($requestRoot !== '') {
            $configuredRoot = $this->rootDomainFromHost($configured);
            if ($configured === '' || ($configuredRoot !== '' && $configuredRoot !== $requestRoot)) {
                return $this->publicScheme().'://wa.'.$requestRoot;
            }
        }

        if ($configured !== '') {
            return $configured;
        }

        if ($fallbackHost !== '') {
            return $this->publicScheme().'://'.$fallbackHost;
        }

        $rootDomain = $this->normalizeHost((string) config('tenancy.root_domain', ''));

        return $rootDomain !== '' ? $this->publicScheme().'://wa.'.$rootDomain : null;
    }

    private function normalizeUrl(string $url): string
    {
        $value = rtrim(trim($url), '/');
        if ($value === '') {
            return '';
        }

        if (! str_contains($value, '://')) {
            $value = $this->publicScheme().'://'.$value;
        }

        $host = $this->normalizeHost($value);

        return $host !== '' ? $value : '';
    }

    private function normalizeHost(?string $host): string
    {
        $value = strtolower(trim((string) $host));
        if ($value === '') {
            return '';
        }

        if (str_contains($value, '://')) {
            $value = strtolower(trim((string) parse_url($value, PHP_URL_HOST)));
        } else {
            $value = preg_replace('#/.*$#', '', $value) ?: $value;
            $value = preg_replace('/:\d+$/', '', $value) ?: $value;
        }

        return trim($value, '.');
    }

    private function rootDomainFromHost(?string $host): string
    {
        $normalized = $this->normalizeHost($host);
        if ($normalized === '' || $normalized === 'localhost' || filter_var($normalized, FILTER_VALIDATE_IP)) {
            return '';
        }

        $parts = array_values(array_filter(explode('.', $normalized)));
        if (count($parts) <= 2) {
            return $normalized;
        }

        $lastTwo = implode('.', array_slice($parts, -2));
        $publicSuffixes = ['ac.id', 'biz.id', 'co.id', 'go.id', 'my.id', 'or.id', 'sch.id', 'web.id'];

        return in_array($lastTwo, $publicSuffixes, true)
            ? implode('.', array_slice($parts, -3))
            : implode('.', array_slice($parts, -2));
    }

    private function publicScheme(): string
    {
        $scheme = strtolower(trim((string) config('tenancy.public_scheme', '')));
        if (in_array($scheme, ['http', 'https'], true)) {
            return $scheme;
        }

        $appScheme = strtolower(trim((string) parse_url((string) config('app.url', ''), PHP_URL_SCHEME)));

        return in_array($appScheme, ['http', 'https'], true) ? $appScheme : 'https';
    }

    public function centralTenantId(): string
    {
        $configuredId = trim((string) config('services.whatsapp.central_tenant_id', ''));
        if ($configuredId !== '' && DB::table('tenants')->where('id', $configuredId)->exists()) {
            return $configuredId;
        }

        $slug = trim((string) config('services.whatsapp.central_tenant_slug', ''));
        if ($slug !== '') {
            $tenantId = DB::table('tenants')->where('slug', $slug)->value('id');
            if ($tenantId) {
                return (string) $tenantId;
            }
        }

        return '';
    }

    private function isCentralTenant(string $tenantId): bool
    {
        return $tenantId !== '' && $tenantId === $this->centralTenantId();
    }

    private function webhookUrl(WhatsAppIntegration $integration): string
    {
        $baseUrl = trim((string) config('services.evolution_api.webhook_base_url', ''));
        if ($baseUrl === '') {
            $baseUrl = trim((string) config('app.url', ''));
        }
        $baseUrl = rtrim($baseUrl, '/');

        return $baseUrl.'/api/whatsapp/webhook/'.$integration->webhook_secret;
    }

    private function safeSetWebhook(WhatsAppIntegration $integration): ?string
    {
        try {
            $this->evolutionApiClient->setWebhook(
                $integration->instance_name,
                $this->webhookUrl($integration),
                self::WEBHOOK_EVENTS
            );

            return null;
        } catch (\Throwable $e) {
            return 'QR tetap diproses, tetapi webhook Evolution belum aktif: '
                .$this->normalizeProviderErrorMessage($e->getMessage());
        }
    }

    private function createInstanceForQr(WhatsAppIntegration $integration, bool $allowReset = true): array
    {
        $payload = [
            'instanceName' => $integration->instance_name,
            'qrcode' => true,
            'integration' => (string) config('services.evolution_api.integration', 'WHATSAPP-BAILEYS'),
        ];

        try {
            return $this->evolutionApiClient->createInstance($payload);
        } catch (\Throwable $e) {
            $providerMessage = $this->normalizeProviderErrorMessage($e->getMessage());
            $message = Str::lower($providerMessage);
            if (! Str::contains($message, ['already in use', 'already exists'])) {
                if ($allowReset && $this->isRecoverableInstanceError($providerMessage)) {
                    ['response' => $connect] = $this->attemptQrConnect($integration->instance_name);
                    if ($this->hasQrPayload($connect)) {
                        return $connect;
                    }

                    $this->forgetRemoteInstance($integration->instance_name);
                    $this->waitForRemoteInstanceAbsence($integration->instance_name, 3, 350);

                    try {
                        return $this->createInstanceForQr($integration, false);
                    } catch (\Throwable $resetException) {
                        throw new RuntimeException(
                            'Evolution gagal membuat instance WhatsApp setelah reset state: '
                            .$this->normalizeProviderErrorMessage($resetException->getMessage())
                        );
                    }
                }

                throw new RuntimeException('Evolution gagal membuat instance WhatsApp: '.$providerMessage);
            }

            $remote = $this->evolutionApiClient->fetchInstance($integration->instance_name);
            if (! $remote) {
                throw new RuntimeException('Evolution menganggap instance sudah ada, tetapi instance tidak ditemukan saat dicek ulang.');
            }

            ['response' => $connect] = $this->attemptQrConnect($integration->instance_name);
            if ($this->hasQrPayload($connect)) {
                return $connect;
            }

            throw new RuntimeException('Evolution instance sudah ada, tetapi QR belum bisa dibuat: '.$providerMessage);
        }
    }

    private function recreateInstanceForQr(WhatsAppIntegration $integration): array
    {
        $instanceName = $integration->instance_name;

        $this->forgetRemoteInstance($instanceName);

        $remote = $this->waitForRemoteInstanceAbsence($instanceName);
        if ($remote) {
            ['response' => $connect] = $this->attemptQrConnect($instanceName);
            if ($this->hasQrPayload($connect)) {
                return $connect;
            }
        }

        return $this->createInstanceForQr($integration);
    }

    private function forgetRemoteInstance(string $instanceName): void
    {
        try {
            $this->evolutionApiClient->logoutInstance($instanceName);
        } catch (\Throwable $e) {
            // Keep going. Some provider states reject logout while still booting.
        }

        try {
            $this->evolutionApiClient->deleteInstance($instanceName);
        } catch (\Throwable $e) {
            // A stale instance may still be recoverable through connect below.
        }
    }

    private function waitForRemoteInstanceAbsence(string $instanceName, int $attempts = 6, int $sleepMilliseconds = 250): ?array
    {
        $remote = null;

        for ($attempt = 0; $attempt < $attempts; $attempt++) {
            $remote = $this->evolutionApiClient->fetchInstance($instanceName);
            if (! $remote) {
                return null;
            }

            usleep($sleepMilliseconds * 1000);
        }

        return $remote;
    }

    private function attemptQrConnect(string $instanceName): array
    {
        try {
            return [
                'response' => $this->evolutionApiClient->connectInstance($instanceName),
                'error' => null,
            ];
        } catch (\Throwable $e) {
            return [
                'response' => [],
                'error' => 'Evolution gagal membuat QR untuk instance: '
                    .$this->normalizeProviderErrorMessage($e->getMessage()),
            ];
        }
    }

    private function isRecoverableInstanceError(string $message): bool
    {
        $message = Str::lower($message);

        return Str::contains($message, [
            'internal server error',
            'http 500',
            'http 502',
            'http 503',
            'http 504',
            'instance',
            'database',
            'prisma',
            'session',
        ]);
    }

    private function extractPairingCode(array $payload): string
    {
        return $this->extractFirstString($payload, [
            'pairingCode',
            'data.pairingCode',
            'qrcode.pairingCode',
        ]);
    }

    private function hasQrPayload(array $payload): bool
    {
        return $this->extractQrCode($payload) !== '' || $this->extractPairingCode($payload) !== '';
    }

    private function makeInstanceName(string $tenantId): string
    {
        $centralInstance = Str::slug((string) config('services.whatsapp.central_instance_name', ''), '-');
        if ($centralInstance !== '' && $this->isCentralTenant($tenantId)) {
            return Str::lower($centralInstance);
        }

        $prefix = Str::slug((string) config('services.evolution_api.instance_prefix', 'edusmart'), '-');
        $tenantSlug = (string) DB::table('tenants')->where('id', $tenantId)->value('slug');
        $tenantSlug = Str::slug($tenantSlug !== '' ? $tenantSlug : substr($tenantId, 0, 12), '-');

        return trim(Str::lower($prefix.'-'.$tenantSlug), '-');
    }

    private function enforceNotificationPolicy(WhatsAppNotificationSetting $settings): void
    {
        if (
            $settings->send_profile_updates
            || $settings->send_assignment_updates
            || $settings->send_extracurricular_updates
            || $settings->send_grade_updates
            || ! $settings->send_attendance
            || $settings->recipient_mode !== 'wali'
        ) {
            $settings->forceFill([
                'send_attendance' => true,
                'send_profile_updates' => false,
                'send_assignment_updates' => false,
                'send_extracurricular_updates' => false,
                'send_grade_updates' => false,
                'recipient_mode' => 'wali',
            ])->save();
        }
    }

    private function resolveEventName(?string $eventSlug, array $payload): string
    {
        if ($eventSlug && trim($eventSlug) !== '') {
            return $this->normalizeEventName(trim($eventSlug));
        }

        $event = $this->extractFirstString($payload, ['event', 'type', 'data.event']);
        if ($event !== '') {
            return $this->normalizeEventName($event);
        }

        return 'UNKNOWN';
    }

    private function normalizeEventName(string $event): string
    {
        return Str::upper(str_replace(['-', '.', ' '], '_', trim($event)));
    }

    private function extractQrCode(array $payload): string
    {
        $value = $this->extractFirstString($payload, [
            'qrcode.base64',
            'data.qrcode.base64',
            'data.base64',
            'base64',
            'qrcode.code',
            'data.qrcode.code',
            'code',
            'qrcode',
        ]);

        $value = trim($value);
        if ($value === '') {
            return '';
        }

        if (str_starts_with($value, 'data:image/')) {
            return $value;
        }

        if (strlen($value) > 100 && preg_match('/^[A-Za-z0-9+\/=]+$/', $value)) {
            return 'data:image/png;base64,'.$value;
        }

        return $value;
    }

    private function extractFirstString(array $payload, array $paths): string
    {
        foreach ($paths as $path) {
            $value = Arr::get($payload, $path);
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        return '';
    }

    private function normalizeConnectionState(string $state): string
    {
        $normalized = Str::lower(trim($state));
        if ($normalized === '') {
            return 'close';
        }

        return match ($normalized) {
            'open', 'connected' => 'open',
            'close', 'closed', 'disconnected', 'logout' => 'close',
            'connecting', 'qr', 'pairing', 'scan', 'awaiting_qr' => 'connecting',
            default => $normalized,
        };
    }

    private function statusFromConnectionState(string $state): string
    {
        return match ($state) {
            'open' => 'connected',
            'connecting' => 'awaiting_qr',
            default => 'disconnected',
        };
    }

    private function normalizeOwnerPhone(string $raw): ?string
    {
        $value = trim($raw);
        if ($value === '') {
            return null;
        }

        $number = explode('@', $value)[0] ?? '';
        $number = preg_replace('/\D+/', '', $number) ?? '';

        return $number !== '' ? $number : null;
    }

    private function normalizeRecipientMode($value): string
    {
        $mode = Str::lower(trim((string) $value));

        return in_array($mode, ['wali', 'siswa', 'wali_and_student'], true)
            ? $mode
            : 'wali';
    }
}
