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
        private readonly EvolutionApiClient $evolutionApiClient
    ) {}

    public function providerConfigured(): bool
    {
        return $this->evolutionApiClient->isConfigured();
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
                'send_profile_updates' => true,
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

        return $settings;
    }

    public function overview(string $tenantId): array
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
                'name' => 'Evolution API',
                'public_url' => trim((string) config('services.evolution_api.public_url', '')) ?: null,
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
            'send_profile_updates' => (bool) ($payload['send_profile_updates'] ?? $settings->send_profile_updates),
            'send_assignment_updates' => (bool) ($payload['send_assignment_updates'] ?? $settings->send_assignment_updates),
            'send_extracurricular_updates' => (bool) ($payload['send_extracurricular_updates'] ?? $settings->send_extracurricular_updates),
            'send_grade_updates' => (bool) ($payload['send_grade_updates'] ?? $settings->send_grade_updates),
            'recipient_mode' => $this->normalizeRecipientMode($payload['recipient_mode'] ?? $settings->recipient_mode),
        ]);
        $settings->save();

        return $settings->fresh();
    }

    public function requestQr(string $tenantId): array
    {
        $this->evolutionApiClient->assertConfigured();

        $integration = $this->getOrCreateIntegration($tenantId);
        $this->getOrCreateNotificationSettings($tenantId, $integration);

        $remote = $this->evolutionApiClient->fetchInstance($integration->instance_name);
        if ($remote && $this->normalizeConnectionState((string) ($remote['status'] ?? $remote['connectionStatus'] ?? '')) === 'open') {
            $this->evolutionApiClient->setWebhook(
                $integration->instance_name,
                $this->webhookUrl($integration),
                self::WEBHOOK_EVENTS
            );

            $this->applyRemoteSnapshot($integration, $remote);
            $integration->fill([
                'last_error' => 'WhatsApp sudah terhubung. Logout dulu jika ingin membuat QR baru.',
                'last_synced_at' => now(),
            ]);
            $integration->save();

            return $this->overview($tenantId);
        }

        $created = [];
        $connect = [];
        if (! $remote) {
            $created = $this->createInstanceForQr($integration);
            $this->evolutionApiClient->setWebhook(
                $integration->instance_name,
                $this->webhookUrl($integration),
                self::WEBHOOK_EVENTS
            );
        } else {
            $this->applyRemoteSnapshot($integration, $remote);

            $this->evolutionApiClient->setWebhook(
                $integration->instance_name,
                $this->webhookUrl($integration),
                self::WEBHOOK_EVENTS
            );

            ['response' => $connect, 'error' => $connectError] = $this->attemptQrConnect($integration->instance_name);
            if (! $this->hasQrPayload($connect) && $this->shouldRecreateRemoteInstance($remote)) {
                $created = $this->recreateInstanceForQr($integration);
                $this->evolutionApiClient->setWebhook(
                    $integration->instance_name,
                    $this->webhookUrl($integration),
                    self::WEBHOOK_EVENTS
                );
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

        $integration->fill([
            // Evolution v2 may deliver the QR via webhook instead of connect response.
            'status' => 'awaiting_qr',
            'connection_state' => 'connecting',
            'qr_code' => $qrCode !== '' ? $qrCode : null,
            'pairing_code' => $pairingCode ?: null,
            'qr_updated_at' => $hasFreshQr ? now() : null,
            'last_synced_at' => now(),
            'last_error' => $connectError,
        ]);
        $integration->save();

        return $this->overview($tenantId);
    }

    public function synchronize(string $tenantId): array
    {
        $integration = $this->getOrCreateIntegration($tenantId);
        $this->syncIntegration($integration, true);

        return $this->overview($tenantId);
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
        if (! $this->providerConfigured()) {
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

    public function logout(string $tenantId): array
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

        return $this->overview($tenantId);
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

    private function webhookUrl(WhatsAppIntegration $integration): string
    {
        $baseUrl = trim((string) config('services.evolution_api.webhook_base_url', ''));
        if ($baseUrl === '') {
            $baseUrl = trim((string) config('app.url', ''));
        }
        $baseUrl = rtrim($baseUrl, '/');

        return $baseUrl.'/api/whatsapp/webhook/'.$integration->webhook_secret;
    }

    private function createInstanceForQr(WhatsAppIntegration $integration): array
    {
        $payload = [
            'instanceName' => $integration->instance_name,
            'qrcode' => true,
            'integration' => (string) config('services.evolution_api.integration', 'WHATSAPP-BAILEYS'),
            'webhook' => [
                'url' => $this->webhookUrl($integration),
                'enabled' => true,
                'byEvents' => true,
                'base64' => true,
                'events' => self::WEBHOOK_EVENTS,
            ],
        ];

        try {
            return $this->evolutionApiClient->createInstance($payload);
        } catch (\Throwable $e) {
            $message = Str::lower($e->getMessage());
            if (! Str::contains($message, ['already in use', 'already exists'])) {
                throw $e;
            }

            $remote = $this->evolutionApiClient->fetchInstance($integration->instance_name);
            if (! $remote) {
                throw $e;
            }

            ['response' => $connect] = $this->attemptQrConnect($integration->instance_name);
            if ($this->hasQrPayload($connect)) {
                return $connect;
            }

            throw $e;
        }
    }

    private function recreateInstanceForQr(WhatsAppIntegration $integration): array
    {
        $instanceName = $integration->instance_name;

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

        $remote = $this->waitForRemoteInstanceAbsence($instanceName);
        if ($remote) {
            ['response' => $connect] = $this->attemptQrConnect($instanceName);
            if ($this->hasQrPayload($connect)) {
                return $connect;
            }
        }

        return $this->createInstanceForQr($integration);
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
                'error' => $this->normalizeProviderErrorMessage($e->getMessage()),
            ];
        }
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
        $prefix = Str::slug((string) config('services.evolution_api.instance_prefix', 'edusmart'), '-');
        $tenantSlug = (string) DB::table('tenants')->where('id', $tenantId)->value('slug');
        $tenantSlug = Str::slug($tenantSlug !== '' ? $tenantSlug : substr($tenantId, 0, 12), '-');

        return trim(Str::lower($prefix.'-'.$tenantSlug), '-');
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
