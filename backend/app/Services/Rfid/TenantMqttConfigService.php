<?php

namespace App\Services\Rfid;

use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class TenantMqttConfigService
{
    public function tenantConfig(string $tenantId, string $tenantSlug, bool $includePassword = false): array
    {
        $tenantId = trim($tenantId);
        $tenantSlug = $this->normalizeTenantSlug($tenantSlug);
        $row = $this->findRowByTenantId($tenantId);

        if ($row) {
            return $this->rowToConfig($row, $tenantSlug, $includePassword);
        }

        return $this->globalConfig($tenantSlug, $includePassword);
    }

    public function saveTenantConfig(
        string $tenantId,
        string $tenantSlug,
        array $payload,
        ?string $actorId = null
    ): array {
        $tenantId = trim($tenantId);
        $tenantSlug = $this->normalizeTenantSlug($tenantSlug);
        $existing = $this->findRowByTenantId($tenantId);
        $now = now();
        $provider = $this->normalizeProvider($payload['provider'] ?? ($existing->provider ?? 'custom'));
        $managedByPlatform = (bool) ($payload['managed_by_platform'] ?? ($existing->managed_by_platform ?? false));

        $data = [
            'provider' => $provider,
            'managed_by_platform' => $managedByPlatform,
            'enabled' => (bool) ($payload['enabled'] ?? true),
            'host' => trim((string) ($payload['host'] ?? '')),
            'port' => $this->clampInt($payload['port'] ?? 8883, 1, 65535, 8883),
            'runtime_host' => $this->nullableString($payload['runtime_host'] ?? ($existing->runtime_host ?? null)),
            'runtime_port' => $this->nullableInt($payload['runtime_port'] ?? ($existing->runtime_port ?? null), 1, 65535),
            'runtime_use_tls' => array_key_exists('runtime_use_tls', $payload)
                ? (bool) $payload['runtime_use_tls']
                : ($existing->runtime_use_tls ?? null),
            'username' => $this->nullableString($payload['username'] ?? null),
            'use_tls' => (bool) ($payload['use_tls'] ?? true),
            'tls_verify_peer' => (bool) ($payload['tls_verify_peer'] ?? true),
            'tls_verify_peer_name' => (bool) ($payload['tls_verify_peer_name'] ?? true),
            'tls_allow_self_signed' => (bool) ($payload['tls_allow_self_signed'] ?? false),
            'qos' => $this->clampInt($payload['qos'] ?? 1, 0, 2, 1),
            'client_id_prefix' => $this->nonEmptyString(
                $payload['client_id_prefix'] ?? null,
                'edusmart-rfid-bridge'
            ),
            'scan_topic_template' => $this->nonEmptyString(
                $payload['scan_topic_template'] ?? null,
                'edusmart/{tenant}/rfid/{device}/scan'
            ),
            'response_topic_template' => $this->nonEmptyString(
                $payload['response_topic_template'] ?? null,
                'edusmart/{tenant}/rfid/{device}/response'
            ),
            'mode_topic_template' => $this->nonEmptyString(
                $payload['mode_topic_template'] ?? null,
                'edusmart/{tenant}/rfid/{device}/mode'
            ),
            'connect_timeout' => $this->clampInt($payload['connect_timeout'] ?? 20, 3, 120, 20),
            'socket_timeout' => $this->clampInt($payload['socket_timeout'] ?? 5, 1, 60, 5),
            'keep_alive' => $this->clampInt($payload['keep_alive'] ?? 20, 3, 300, 20),
            'updated_by' => $this->nullableString($actorId),
            'updated_at' => $now,
        ];

        if (array_key_exists('password', $payload) && trim((string) $payload['password']) !== '') {
            $data['password_ciphertext'] = Crypt::encryptString((string) $payload['password']);
        } elseif ((bool) ($payload['clear_password'] ?? false)) {
            $data['password_ciphertext'] = null;
        }

        $this->assertPublishableTopicTemplates($data);
        $this->assertNoActiveScanTopicConflict($tenantId, $tenantSlug, $data);

        if ($existing) {
            DB::table('tenant_mqtt_configs')->where('id', $existing->id)->update($data);
        } else {
            $data['id'] = (string) Str::uuid();
            $data['tenant_id'] = $tenantId;
            $data['created_at'] = $now;
            DB::table('tenant_mqtt_configs')->insert($data);
        }

        return $this->tenantConfig($tenantId, $tenantSlug, false);
    }

    public function provisionMosquittoTenantConfig(
        string $tenantId,
        string $tenantSlug,
        ?string $actorId = null,
        bool $rotatePassword = false
    ): array {
        $mosquitto = $this->mosquittoConfig();
        if (! (bool) ($mosquitto['enabled'] ?? false)) {
            throw new \RuntimeException('Mosquitto platform belum aktif di konfigurasi server.');
        }

        $publicHost = trim((string) ($mosquitto['public_host'] ?? ''));
        if ($publicHost === '') {
            throw new \RuntimeException('RFID_MOSQUITTO_PUBLIC_HOST wajib diisi sebelum generate MQTT sekolah.');
        }

        $bridgePassword = trim((string) ($mosquitto['bridge_password'] ?? ''));
        if ($bridgePassword === '') {
            throw new \RuntimeException('RFID_MOSQUITTO_BRIDGE_PASSWORD wajib diisi agar backend punya credential bridge yang aman.');
        }

        $tenantId = trim($tenantId);
        $tenantSlug = $this->normalizeTenantSlug($tenantSlug);
        $existing = $this->findRowByTenantId($tenantId);
        $existingPasswordSet = trim((string) ($existing->password_ciphertext ?? '')) !== '';
        $existingProvider = $this->normalizeProvider($existing->provider ?? 'custom');
        $existingManagedByPlatform = (bool) ($existing->managed_by_platform ?? false);
        $reuseExistingPlatformCredential = $existing
            && $existingProvider === 'mosquitto'
            && $existingManagedByPlatform
            && ! $rotatePassword;
        $topicPrefix = $this->normalizeTopicPrefix((string) ($mosquitto['topic_prefix'] ?? 'edusmart'));
        $username = $reuseExistingPlatformCredential ? trim((string) ($existing->username ?? '')) : '';
        if ($username === '') {
            $username = $this->buildMosquittoTenantUsername($tenantSlug);
        }

        $payload = [
            'provider' => 'mosquitto',
            'managed_by_platform' => true,
            'enabled' => true,
            'host' => $publicHost,
            'port' => $this->clampInt($mosquitto['public_port'] ?? 8883, 1, 65535, 8883),
            'runtime_host' => trim((string) ($mosquitto['internal_host'] ?? 'mosquitto')),
            'runtime_port' => $this->clampInt($mosquitto['internal_port'] ?? 1883, 1, 65535, 1883),
            'runtime_use_tls' => (bool) ($mosquitto['internal_use_tls'] ?? false),
            'username' => $username,
            'use_tls' => (bool) ($mosquitto['public_use_tls'] ?? true),
            'tls_verify_peer' => true,
            'tls_verify_peer_name' => true,
            'tls_allow_self_signed' => false,
            'qos' => 1,
            'client_id_prefix' => 'edusmart-rfid-bridge',
            'scan_topic_template' => "{$topicPrefix}/{tenant}/rfid/{device}/scan",
            'response_topic_template' => "{$topicPrefix}/{tenant}/rfid/{device}/response",
            'mode_topic_template' => "{$topicPrefix}/{tenant}/rfid/{device}/mode",
            'connect_timeout' => 20,
            'socket_timeout' => 5,
            'keep_alive' => 20,
        ];

        if ($rotatePassword || ! $existingPasswordSet || ! $reuseExistingPlatformCredential) {
            $payload['password'] = $this->generateMosquittoPassword();
        }

        $saved = $this->saveTenantConfig($tenantId, $tenantSlug, $payload, $actorId);
        $sync = $this->syncManagedMosquittoFiles();

        return [
            'config' => $saved,
            'sync' => $sync,
        ];
    }

    public function syncManagedMosquittoFiles(): array
    {
        if (! $this->hasConfigTable() || ! $this->hasConfigColumn('provider')) {
            return [
                'synced' => false,
                'tenant_count' => 0,
                'message' => 'Tabel tenant_mqtt_configs belum mendukung Mosquitto managed config.',
            ];
        }

        $mosquitto = $this->mosquittoConfig();
        if (! (bool) ($mosquitto['enabled'] ?? false)) {
            return [
                'synced' => false,
                'tenant_count' => 0,
                'message' => 'Mosquitto platform tidak aktif.',
            ];
        }

        $this->normalizeManagedMosquittoRows($mosquitto);

        $passwordFile = trim((string) ($mosquitto['password_file'] ?? ''));
        $aclFile = trim((string) ($mosquitto['acl_file'] ?? ''));
        if ($passwordFile === '' || $aclFile === '') {
            throw new \RuntimeException('Path password_file dan acl_file Mosquitto wajib diisi.');
        }

        $rows = DB::table('tenant_mqtt_configs as cfg')
            ->join('tenants as t', 't.id', '=', 'cfg.tenant_id')
            ->where('cfg.provider', 'mosquitto')
            ->where('cfg.managed_by_platform', true)
            ->where('cfg.enabled', true)
            ->whereRaw("trim(coalesce(cfg.host, '')) <> ''")
            ->orderBy('t.slug')
            ->get([
                'cfg.*',
                't.slug as tenant_slug',
                't.name as tenant_name',
            ]);

        $configs = $rows
            ->map(fn ($row) => $this->rowToConfig($row, (string) ($row->tenant_slug ?? ''), true))
            ->values()
            ->all();

        $this->writeMosquittoPasswordFile($passwordFile, $configs, $mosquitto);
        $this->writeMosquittoAclFile($aclFile, $configs, $mosquitto);

        return [
            'synced' => true,
            'tenant_count' => count($configs),
            'password_file' => $passwordFile,
            'acl_file' => $aclFile,
        ];
    }

    public function runtimeConfigs(array $forcedTenants = []): array
    {
        $forced = array_values(array_unique(array_filter(array_map(
            fn ($value) => $this->normalizeTenantSlug((string) $value),
            $forcedTenants
        ))));

        if (! $this->hasConfigTable()) {
            return $this->globalRuntimeConfigs($forced);
        }

        if (! empty($forced)) {
            $tenants = DB::table('tenants')
                ->whereIn(DB::raw('lower(slug)'), $forced)
                ->whereNotIn(DB::raw('lower(coalesce(status, \'active\'))'), ['suspended', 'archived', 'inactive', 'disabled'])
                ->orderBy('slug')
                ->get(['id', 'slug']);

            return $tenants
                ->map(fn ($tenant) => $this->tenantConfig((string) $tenant->id, (string) $tenant->slug, true))
                ->filter(fn (array $cfg) => ($cfg['available'] ?? false) === true)
                ->values()
                ->all();
        }

        $rows = DB::table('tenant_mqtt_configs as cfg')
            ->join('tenants as t', 't.id', '=', 'cfg.tenant_id')
            ->where('cfg.enabled', true)
            ->whereNotIn(DB::raw('lower(coalesce(t.status, \'active\'))'), ['suspended', 'archived', 'inactive', 'disabled'])
            ->whereRaw("trim(coalesce(cfg.host, '')) <> ''")
            ->orderBy('t.slug')
            ->get([
                'cfg.*',
                't.slug as tenant_slug',
            ]);

        if ($rows->isEmpty()) {
            return $this->globalRuntimeConfigs([]);
        }

        return $rows
            ->map(fn ($row) => $this->rowToConfig($row, (string) ($row->tenant_slug ?? ''), true))
            ->filter(fn (array $cfg) => ($cfg['available'] ?? false) === true)
            ->values()
            ->all();
    }

    public function publicConfig(array $config): array
    {
        $public = $config;
        unset(
            $public['password'],
            $public['password_ciphertext'],
            $public['bridge_password'],
            $public['connect_host'],
            $public['connect_port'],
            $public['connect_use_tls']
        );
        $public['password_set'] = (bool) ($config['password_set'] ?? false);

        return $public;
    }

    private function globalRuntimeConfigs(array $forcedTenants): array
    {
        $global = $this->globalConfig('', true);
        if (! ($global['available'] ?? false)) {
            return [];
        }

        if (empty($forcedTenants)) {
            return [$global];
        }

        $tenants = DB::table('tenants')
            ->whereIn(DB::raw('lower(slug)'), $forcedTenants)
            ->whereNotIn(DB::raw('lower(coalesce(status, \'active\'))'), ['suspended', 'archived', 'inactive', 'disabled'])
            ->orderBy('slug')
            ->get(['id', 'slug']);

        return $tenants
            ->map(fn ($tenant) => array_merge($global, [
                'tenant_id' => (string) $tenant->id,
                'tenant_slug' => $this->normalizeTenantSlug((string) $tenant->slug),
            ]))
            ->values()
            ->all();
    }

    private function rowToConfig(object $row, string $tenantSlug, bool $includePassword): array
    {
        $password = $includePassword ? $this->decryptPassword($row->password_ciphertext ?? null) : '';
        $passwordSet = trim((string) ($row->password_ciphertext ?? '')) !== '';
        $host = trim((string) ($row->host ?? ''));
        $enabled = (bool) ($row->enabled ?? false);
        $provider = $this->normalizeProvider($row->provider ?? 'custom');
        $managedByPlatform = (bool) ($row->managed_by_platform ?? false);
        $runtimeHost = $this->nullableString($row->runtime_host ?? null);
        $runtimePort = $this->nullableInt($row->runtime_port ?? null, 1, 65535);
        $runtimeUseTls = $row->runtime_use_tls ?? null;
        $mosquitto = $this->mosquittoConfig();
        $connectHost = $runtimeHost ?: $host;
        $connectPort = $runtimePort ?: (int) ($row->port ?? 8883);
        $connectUseTls = $runtimeUseTls !== null
            ? (bool) $runtimeUseTls
            : (bool) ($row->use_tls ?? true);
        $bridgeUsername = '';
        $bridgePassword = '';

        if ($provider === 'mosquitto' && $managedByPlatform) {
            $connectHost = $runtimeHost ?: trim((string) ($mosquitto['internal_host'] ?? 'mosquitto'));
            $connectPort = $runtimePort ?: (int) ($mosquitto['internal_port'] ?? 1883);
            $connectUseTls = $runtimeUseTls !== null
                ? (bool) $runtimeUseTls
                : (bool) ($mosquitto['internal_use_tls'] ?? false);
            $bridgeUsername = trim((string) ($mosquitto['bridge_username'] ?? 'edusmart_bridge'));
            $bridgePassword = $includePassword ? trim((string) ($mosquitto['bridge_password'] ?? '')) : '';
        }

        $managedPublicUseTls = (bool) ($mosquitto['public_use_tls'] ?? true);
        $effectiveUseTls = $provider === 'mosquitto' && $managedByPlatform
            ? $managedPublicUseTls
            : (bool) ($row->use_tls ?? true);
        $effectiveTlsVerifyPeer = $provider === 'mosquitto' && $managedByPlatform
            ? $managedPublicUseTls
            : (bool) ($row->tls_verify_peer ?? true);
        $effectiveTlsVerifyPeerName = $provider === 'mosquitto' && $managedByPlatform
            ? $managedPublicUseTls
            : (bool) ($row->tls_verify_peer_name ?? true);
        $effectiveTlsAllowSelfSigned = $provider === 'mosquitto' && $managedByPlatform
            ? false
            : (bool) ($row->tls_allow_self_signed ?? false);

        return [
            'source' => 'tenant',
            'tenant_id' => (string) ($row->tenant_id ?? ''),
            'tenant_slug' => $this->normalizeTenantSlug($tenantSlug),
            'provider' => $provider,
            'managed_by_platform' => $managedByPlatform,
            'enabled' => $enabled,
            'configured' => $host !== '',
            'available' => $enabled && $host !== '',
            'host' => $host,
            'port' => (int) ($row->port ?? 8883),
            'runtime_host' => $runtimeHost,
            'runtime_port' => $runtimePort,
            'runtime_use_tls' => $runtimeUseTls !== null ? (bool) $runtimeUseTls : null,
            'connect_host' => $connectHost,
            'connect_port' => $connectPort,
            'connect_use_tls' => $connectUseTls,
            'username' => trim((string) ($row->username ?? '')),
            'password' => $password,
            'password_set' => $passwordSet,
            'bridge_username' => $bridgeUsername,
            'bridge_password' => $bridgePassword,
            'use_tls' => $effectiveUseTls,
            'tls_verify_peer' => $effectiveTlsVerifyPeer,
            'tls_verify_peer_name' => $effectiveTlsVerifyPeerName,
            'tls_allow_self_signed' => $effectiveTlsAllowSelfSigned,
            'qos' => (int) ($row->qos ?? 1),
            'client_id_prefix' => trim((string) ($row->client_id_prefix ?? 'edusmart-rfid-bridge')),
            'scan_topic_template' => trim((string) ($row->scan_topic_template ?? 'edusmart/{tenant}/rfid/{device}/scan')),
            'response_topic_template' => trim((string) ($row->response_topic_template ?? 'edusmart/{tenant}/rfid/{device}/response')),
            'mode_topic_template' => trim((string) ($row->mode_topic_template ?? 'edusmart/{tenant}/rfid/{device}/mode')),
            'connect_timeout' => (int) ($row->connect_timeout ?? 20),
            'socket_timeout' => (int) ($row->socket_timeout ?? 5),
            'keep_alive' => (int) ($row->keep_alive ?? 20),
            'updated_at' => $row->updated_at ?? null,
            'updated_by' => $row->updated_by ?? null,
        ];
    }

    private function globalConfig(string $tenantSlug, bool $includePassword): array
    {
        $cfg = config('rfid.mqtt', []);
        if (! is_array($cfg)) {
            $cfg = [];
        }

        $host = trim((string) ($cfg['host'] ?? ''));
        $password = $includePassword ? trim((string) ($cfg['password'] ?? '')) : '';

        return [
            'source' => 'global',
            'tenant_id' => '',
            'tenant_slug' => $this->normalizeTenantSlug($tenantSlug),
            'provider' => 'custom',
            'managed_by_platform' => false,
            'enabled' => $host !== '' || (bool) ($cfg['enabled'] ?? false),
            'configured' => $host !== '',
            'available' => $host !== '',
            'host' => $host,
            'port' => (int) ($cfg['port'] ?? 8883),
            'runtime_host' => null,
            'runtime_port' => null,
            'runtime_use_tls' => null,
            'connect_host' => $host,
            'connect_port' => (int) ($cfg['port'] ?? 8883),
            'connect_use_tls' => (bool) ($cfg['use_tls'] ?? true),
            'username' => trim((string) ($cfg['username'] ?? '')),
            'password' => $password,
            'password_set' => trim((string) ($cfg['password'] ?? '')) !== '',
            'bridge_username' => '',
            'bridge_password' => '',
            'use_tls' => (bool) ($cfg['use_tls'] ?? true),
            'tls_verify_peer' => (bool) ($cfg['tls_verify_peer'] ?? true),
            'tls_verify_peer_name' => (bool) ($cfg['tls_verify_peer_name'] ?? true),
            'tls_allow_self_signed' => (bool) ($cfg['tls_allow_self_signed'] ?? false),
            'qos' => (int) ($cfg['qos'] ?? 1),
            'client_id_prefix' => trim((string) ($cfg['client_id_prefix'] ?? 'edusmart-rfid-bridge')),
            'scan_topic_template' => trim((string) ($cfg['scan_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/scan')),
            'scan_topic_filter' => trim((string) ($cfg['scan_topic_filter'] ?? '')),
            'response_topic_template' => trim((string) ($cfg['response_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/response')),
            'mode_topic_template' => trim((string) ($cfg['mode_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/mode')),
            'connect_timeout' => (int) ($cfg['connect_timeout'] ?? 20),
            'socket_timeout' => (int) ($cfg['socket_timeout'] ?? 5),
            'keep_alive' => (int) ($cfg['keep_alive'] ?? 20),
            'default_tenant_slug' => trim((string) ($cfg['default_tenant_slug'] ?? '')),
            'device_tenant_map' => $cfg['device_tenant_map'] ?? '{}',
            'updated_at' => null,
            'updated_by' => null,
        ];
    }

    private function findRowByTenantId(string $tenantId): ?object
    {
        if ($tenantId === '' || ! $this->hasConfigTable()) {
            return null;
        }

        return DB::table('tenant_mqtt_configs')
            ->where('tenant_id', $tenantId)
            ->first();
    }

    private function assertPublishableTopicTemplates(array $data): void
    {
        foreach (['scan_topic_template', 'response_topic_template', 'mode_topic_template'] as $key) {
            $topic = trim((string) ($data[$key] ?? ''));
            if ($topic === '') {
                continue;
            }

            if (str_contains($topic, '+') || str_contains($topic, '#')) {
                throw new \RuntimeException('Template topik MQTT RFID tidak boleh berisi wildcard + atau #. Gunakan {tenant} dan {device} untuk scope topik.');
            }

            $this->assertWellFormedMqttTopic($topic, false);
        }
    }

    private function assertNoActiveScanTopicConflict(string $tenantId, string $tenantSlug, array $data): void
    {
        if (! $this->hasConfigTable() || ! (bool) ($data['enabled'] ?? true)) {
            return;
        }

        $host = trim((string) ($data['host'] ?? ''));
        $port = (int) ($data['port'] ?? 0);
        if ($host === '' || $port <= 0) {
            return;
        }

        $scanTopic = $this->renderTopicTemplate(
            (string) ($data['scan_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/scan'),
            $tenantSlug
        );

        $rows = DB::table('tenant_mqtt_configs as cfg')
            ->join('tenants as t', 't.id', '=', 'cfg.tenant_id')
            ->where('cfg.tenant_id', '<>', $tenantId)
            ->where('cfg.enabled', true)
            ->where('cfg.port', $port)
            ->whereRaw('lower(cfg.host) = ?', [Str::lower($host)])
            ->get([
                'cfg.scan_topic_template',
                't.name as tenant_name',
                't.slug as tenant_slug',
            ]);

        foreach ($rows as $row) {
            $otherSlug = $this->normalizeTenantSlug((string) ($row->tenant_slug ?? ''));
            $otherTopic = $this->renderTopicTemplate(
                (string) ($row->scan_topic_template ?? 'edusmart/{tenant}/rfid/{device}/scan'),
                $otherSlug
            );

            if ($scanTopic !== $otherTopic) {
                continue;
            }

            $tenantName = trim((string) ($row->tenant_name ?? $otherSlug));
            throw new \RuntimeException(sprintf(
                'Topik scan MQTT %s sudah dipakai oleh tenant %s pada host/port yang sama.',
                $scanTopic,
                $tenantName !== '' ? $tenantName : $otherSlug
            ));
        }
    }

    private function renderTopicTemplate(string $template, string $tenantSlug, string $deviceId = '+'): string
    {
        $topic = str_replace(
            ['{tenant}', '{device}'],
            [$tenantSlug, $deviceId !== '' ? $deviceId : '+'],
            trim($template)
        );

        return $topic !== '' ? $topic : sprintf('edusmart/%s/rfid/scan', $tenantSlug);
    }

    private function writeMosquittoPasswordFile(string $path, array $configs, array $mosquitto): void
    {
        $bridgeUsername = trim((string) ($mosquitto['bridge_username'] ?? 'edusmart_bridge'));
        $bridgePassword = trim((string) ($mosquitto['bridge_password'] ?? ''));
        $this->assertSafeMosquittoUsername($bridgeUsername);
        if ($bridgePassword === '') {
            throw new \RuntimeException('RFID_MOSQUITTO_BRIDGE_PASSWORD wajib diisi.');
        }

        $users = [$bridgeUsername => $bridgePassword];
        foreach ($configs as $config) {
            $username = trim((string) ($config['username'] ?? ''));
            $password = trim((string) ($config['password'] ?? ''));
            $this->assertSafeMosquittoUsername($username);
            if ($password === '') {
                throw new \RuntimeException(sprintf(
                    'Password MQTT tenant %s belum tersedia.',
                    $config['tenant_slug'] ?? '-'
                ));
            }
            if (array_key_exists($username, $users)) {
                throw new \RuntimeException("Username MQTT {$username} dipakai lebih dari satu credential.");
            }
            $users[$username] = $password;
        }

        $binary = trim((string) ($mosquitto['passwd_binary'] ?? 'mosquitto_passwd'));
        if (! $this->commandExists($binary)) {
            if (app()->environment('testing')) {
                $this->writeTestingPasswordFile($path, $users);

                return;
            }

            throw new \RuntimeException('Binary mosquitto_passwd tidak ditemukan. Pastikan image backend meng-install paket mosquitto.');
        }

        $directory = dirname($path);
        if (! is_dir($directory) && ! mkdir($directory, 0777, true) && ! is_dir($directory)) {
            throw new \RuntimeException("Folder Mosquitto {$directory} tidak bisa dibuat.");
        }

        $temporary = $path.'.tmp.'.Str::lower(Str::random(8));
        @unlink($temporary);
        $first = true;
        foreach ($users as $username => $password) {
            $command = trim(sprintf(
                '%s %s -b %s %s %s',
                escapeshellcmd($binary),
                $first ? '-c' : '',
                escapeshellarg($temporary),
                escapeshellarg($username),
                escapeshellarg($password)
            ));
            $output = [];
            $exitCode = 0;
            exec($command.' 2>&1', $output, $exitCode);
            if ($exitCode !== 0) {
                @unlink($temporary);
                throw new \RuntimeException('Gagal membuat password_file Mosquitto: '.implode(' ', $output));
            }
            $first = false;
        }

        $this->applyMosquittoFilePermissions($temporary);
        if (! rename($temporary, $path)) {
            @unlink($temporary);
            throw new \RuntimeException("File Mosquitto {$path} tidak bisa diganti secara atomic.");
        }
        $this->applyMosquittoFilePermissions($path);
    }

    private function writeMosquittoAclFile(string $path, array $configs, array $mosquitto): void
    {
        $bridgeUsername = trim((string) ($mosquitto['bridge_username'] ?? 'edusmart_bridge'));
        $this->assertSafeMosquittoUsername($bridgeUsername);
        $deviceIdsByTenant = $this->mosquittoAclDeviceIdsByTenant($configs, $mosquitto);

        $lines = [
            '# Generated by EduSmart. Do not edit manually.',
            '',
            'user '.$bridgeUsername,
        ];

        foreach ($configs as $config) {
            $tenantSlug = $this->normalizeTenantSlug((string) ($config['tenant_slug'] ?? ''));
            if ($tenantSlug === '') {
                continue;
            }

            $topics = $this->mosquittoAclTopicsForConfig($config, $tenantSlug, $deviceIdsByTenant, $mosquitto);
            foreach ($topics['scan'] as $scanTopic) {
                $lines[] = 'topic read '.$scanTopic;
            }
            foreach ($topics['response'] as $responseTopic) {
                $lines[] = 'topic write '.$responseTopic;
            }
            foreach ($topics['mode'] as $modeTopic) {
                $lines[] = 'topic write '.$modeTopic;
            }
        }

        foreach ($configs as $config) {
            $tenantSlug = $this->normalizeTenantSlug((string) ($config['tenant_slug'] ?? ''));
            $username = trim((string) ($config['username'] ?? ''));
            if ($tenantSlug === '' || $username === '') {
                continue;
            }

            $lines[] = '';
            $lines[] = 'user '.$username;
            $topics = $this->mosquittoAclTopicsForConfig($config, $tenantSlug, $deviceIdsByTenant, $mosquitto);
            foreach ($topics['scan'] as $scanTopic) {
                $lines[] = 'topic write '.$scanTopic;
            }
            foreach ($topics['response'] as $responseTopic) {
                $lines[] = 'topic read '.$responseTopic;
            }
            foreach ($topics['mode'] as $modeTopic) {
                $lines[] = 'topic read '.$modeTopic;
            }
        }

        $this->atomicWriteFile($path, implode("\n", $lines)."\n", $this->mosquittoFileMode());
    }

    private function mosquittoAclDeviceIdsByTenant(array $configs, array $mosquitto): array
    {
        if (! (bool) ($mosquitto['strict_device_acl'] ?? true)) {
            return [];
        }

        if (! Schema::hasTable('rfid_devices')) {
            return [];
        }

        $tenantIds = array_values(array_unique(array_filter(array_map(
            fn (array $config): string => trim((string) ($config['tenant_id'] ?? '')),
            $configs
        ))));

        if (empty($tenantIds)) {
            return [];
        }

        $rows = DB::table('rfid_devices')
            ->whereIn('tenant_id', $tenantIds)
            ->whereNotIn(DB::raw("lower(coalesce(status, 'active'))"), ['blocked', 'disabled', 'inactive', 'suspended', 'archived'])
            ->orderBy('device_id')
            ->get(['tenant_id', 'device_id']);

        $grouped = [];
        foreach ($rows as $row) {
            $tenantId = trim((string) ($row->tenant_id ?? ''));
            $deviceId = $this->normalizeAclDeviceId((string) ($row->device_id ?? ''));
            if ($tenantId === '' || $deviceId === '') {
                continue;
            }

            $grouped[$tenantId] ??= [];
            $grouped[$tenantId][$deviceId] = true;
        }

        foreach ($grouped as $tenantId => $deviceMap) {
            $grouped[$tenantId] = array_keys($deviceMap);
        }

        return $grouped;
    }

    private function mosquittoAclTopicsForConfig(array $config, string $tenantSlug, array $deviceIdsByTenant, array $mosquitto): array
    {
        $tenantId = trim((string) ($config['tenant_id'] ?? ''));
        $deviceIds = (bool) ($mosquitto['strict_device_acl'] ?? true)
            ? ($deviceIdsByTenant[$tenantId] ?? [])
            : ['+'];

        $topics = [
            'scan' => [],
            'response' => [],
            'mode' => [],
        ];

        foreach ($deviceIds as $deviceId) {
            $deviceId = $deviceId === '+' ? '+' : $this->normalizeAclDeviceId((string) $deviceId);
            if ($deviceId === '') {
                continue;
            }

            $scanTopic = $this->renderTopicTemplate(
                (string) ($config['scan_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/scan'),
                $tenantSlug,
                $deviceId
            );
            $responseTopic = $this->renderTopicTemplate(
                (string) ($config['response_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/response'),
                $tenantSlug,
                $deviceId
            );
            $modeTopic = $this->renderTopicTemplate(
                (string) ($config['mode_topic_template'] ?? 'edusmart/{tenant}/rfid/{device}/mode'),
                $tenantSlug,
                $deviceId
            );

            $this->assertMosquittoAclTopic($scanTopic);
            $this->assertMosquittoAclTopic($responseTopic);
            $this->assertMosquittoAclTopic($modeTopic);

            $topics['scan'][$scanTopic] = true;
            $topics['response'][$responseTopic] = true;
            $topics['mode'][$modeTopic] = true;
        }

        return [
            'scan' => array_keys($topics['scan']),
            'response' => array_keys($topics['response']),
            'mode' => array_keys($topics['mode']),
        ];
    }

    private function normalizeAclDeviceId(string $deviceId): string
    {
        $deviceId = Str::lower(Str::ascii(trim($deviceId)));
        $deviceId = preg_replace('/[^a-z0-9._-]+/', '-', $deviceId) ?: '';
        $deviceId = preg_replace('/-+/', '-', $deviceId) ?: '';

        return trim($deviceId, '-');
    }

    private function normalizeManagedMosquittoRows(array $mosquitto): void
    {
        if (
            ! $this->hasConfigTable()
            || ! $this->hasConfigColumn('provider')
            || ! $this->hasConfigColumn('managed_by_platform')
        ) {
            return;
        }

        $publicUseTls = (bool) ($mosquitto['public_use_tls'] ?? true);
        $payload = [
            'use_tls' => $publicUseTls,
            'tls_verify_peer' => $publicUseTls,
            'tls_verify_peer_name' => $publicUseTls,
            'tls_allow_self_signed' => false,
        ];

        if ($this->hasConfigColumn('updated_at')) {
            $payload['updated_at'] = now();
        }

        DB::table('tenant_mqtt_configs')
            ->where('provider', 'mosquitto')
            ->where('managed_by_platform', true)
            ->update($payload);
    }

    private function atomicWriteFile(string $path, string $contents, int $mode): void
    {
        $directory = dirname($path);
        if (! is_dir($directory) && ! mkdir($directory, 0777, true) && ! is_dir($directory)) {
            throw new \RuntimeException("Folder Mosquitto {$directory} tidak bisa dibuat.");
        }

        $temporary = $path.'.tmp.'.Str::lower(Str::random(8));
        if (file_put_contents($temporary, $contents, LOCK_EX) === false) {
            throw new \RuntimeException("File Mosquitto {$path} tidak bisa ditulis.");
        }
        $this->applyMosquittoFilePermissions($temporary, $mode);

        if (! rename($temporary, $path)) {
            @unlink($temporary);
            throw new \RuntimeException("File Mosquitto {$path} tidak bisa diganti secara atomic.");
        }
        $this->applyMosquittoFilePermissions($path, $mode);
    }

    private function applyMosquittoFilePermissions(string $path, ?int $mode = null): void
    {
        $uid = (int) config('rfid.mosquitto.file_uid', 82);
        $gid = (int) config('rfid.mosquitto.file_gid', 82);
        @chown($path, $uid);
        @chgrp($path, $gid);
        @chmod($path, $mode ?? $this->mosquittoFileMode());
    }

    private function mosquittoFileMode(): int
    {
        $raw = (string) config('rfid.mosquitto.file_mode', '0660');
        $raw = trim($raw);

        return $raw !== '' ? intval($raw, 8) : 0660;
    }

    private function commandExists(string $binary): bool
    {
        if ($binary === '') {
            return false;
        }

        $output = [];
        $exitCode = 0;
        exec('command -v '.escapeshellarg($binary).' 2>/dev/null', $output, $exitCode);

        return $exitCode === 0 && ! empty($output);
    }

    private function writeTestingPasswordFile(string $path, array $users): void
    {
        $lines = [
            '# Testing fallback. Production must use mosquitto_passwd.',
        ];
        foreach ($users as $username => $password) {
            $lines[] = $username.':test-hash-'.hash('sha256', $username.'|'.$password);
        }

        $this->atomicWriteFile($path, implode("\n", $lines)."\n", 0666);
    }

    private function assertSafeMosquittoUsername(string $username): void
    {
        if ($username === '' || ! preg_match('/^[A-Za-z0-9._-]{3,120}$/', $username)) {
            throw new \RuntimeException('Username MQTT Mosquitto hanya boleh berisi huruf, angka, titik, underscore, dan minus.');
        }
    }

    private function assertMosquittoAclTopic(string $topic): void
    {
        if ($topic === '' || str_contains($topic, '#')) {
            throw new \RuntimeException('Topik ACL Mosquitto tidak boleh kosong dan tidak boleh memakai wildcard #.');
        }

        $this->assertWellFormedMqttTopic($topic, true);
    }

    private function assertWellFormedMqttTopic(string $topic, bool $allowSingleLevelWildcard): void
    {
        if (preg_match('/\s/', $topic)) {
            throw new \RuntimeException('Topik MQTT RFID tidak boleh mengandung spasi. Gunakan minus untuk pemisah, misalnya gerbang-2.');
        }

        $segments = explode('/', trim($topic));
        if (empty($segments)) {
            throw new \RuntimeException('Topik MQTT RFID tidak valid.');
        }

        foreach ($segments as $segment) {
            if ($segment === '') {
                throw new \RuntimeException('Topik MQTT RFID tidak boleh memiliki segmen kosong atau garis miring ganda.');
            }

            if (str_contains($segment, '+') && (! $allowSingleLevelWildcard || $segment !== '+')) {
                throw new \RuntimeException('Wildcard + MQTT hanya boleh dipakai sebagai satu segmen penuh pada ACL.');
            }
        }
    }

    private function buildMosquittoTenantUsername(string $tenantSlug): string
    {
        $prefix = trim((string) config('rfid.mosquitto.tenant_username_prefix', 'edusmart'));
        $prefix = preg_replace('/[^A-Za-z0-9._-]+/', '_', $prefix) ?: 'edusmart';
        $slug = preg_replace('/[^A-Za-z0-9._-]+/', '_', $tenantSlug) ?: 'tenant';

        return trim($prefix, '._-').'_'.trim($slug, '._-').'_rfid';
    }

    private function generateMosquittoPassword(): string
    {
        $length = max(24, min(80, (int) config('rfid.mosquitto.password_length', 40)));

        return Str::password($length, true, true, false, false);
    }

    private function normalizeTopicPrefix(string $prefix): string
    {
        $prefix = trim($prefix, "/ \t\n\r\0\x0B");
        $prefix = preg_replace('/\s+/', '-', $prefix) ?: 'edusmart';
        $prefix = preg_replace('#/+#', '/', $prefix) ?: 'edusmart';

        return $prefix !== '' ? $prefix : 'edusmart';
    }

    private function normalizeProvider(mixed $provider): string
    {
        $provider = Str::lower(trim((string) $provider));

        return in_array($provider, ['custom', 'mosquitto'], true) ? $provider : 'custom';
    }

    private function mosquittoConfig(): array
    {
        $cfg = config('rfid.mosquitto', []);

        return is_array($cfg) ? $cfg : [];
    }

    private function hasConfigTable(): bool
    {
        try {
            return Schema::hasTable('tenant_mqtt_configs');
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function hasConfigColumn(string $column): bool
    {
        try {
            return Schema::hasColumn('tenant_mqtt_configs', $column);
        } catch (\Throwable $e) {
            return false;
        }
    }

    private function decryptPassword(mixed $ciphertext): string
    {
        $ciphertext = trim((string) $ciphertext);
        if ($ciphertext === '') {
            return '';
        }

        try {
            return Crypt::decryptString($ciphertext);
        } catch (\Throwable $e) {
            return '';
        }
    }

    private function clampInt(mixed $value, int $min, int $max, int $fallback): int
    {
        $number = is_numeric($value) ? (int) $value : $fallback;

        return max($min, min($max, $number));
    }

    private function nullableInt(mixed $value, int $min, int $max): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_numeric($value)) {
            return null;
        }

        return max($min, min($max, (int) $value));
    }

    private function nullableString(mixed $value): ?string
    {
        $value = trim((string) $value);

        return $value !== '' ? $value : null;
    }

    private function nonEmptyString(mixed $value, string $fallback): string
    {
        $value = trim((string) $value);

        return $value !== '' ? $value : $fallback;
    }

    private function normalizeTenantSlug(string $tenantSlug): string
    {
        $tenantSlug = trim($tenantSlug);

        return $tenantSlug !== '' ? Str::lower($tenantSlug) : '';
    }
}
