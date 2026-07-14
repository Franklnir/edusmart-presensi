<?php

namespace App\Services;

use RuntimeException;

class StagingIsolationGuard
{
    private const FORBIDDEN_HOSTS = [
        'sismu.biz.id',
        'origin.sismu.biz.id',
    ];

    public function assertSafe(): void
    {
        if (! app()->environment('staging')) {
            return;
        }

        $this->require((bool) config('staging.isolation_acknowledged'), 'isolation acknowledgement');

        $frontendHost = $this->host((string) config('app.frontend_url'));
        $backendHost = $this->host((string) config('app.url'));
        $storageHost = $this->host((string) config('services.object_storage.endpoint'));

        $this->requireExpectedHost($frontendHost, (string) config('staging.frontend_host'), 'frontend');
        $this->requireExpectedHost($backendHost, (string) config('staging.backend_host'), 'backend');
        $this->requireExpectedHost($storageHost, (string) config('staging.storage_host'), 'storage');

        $expectedDatabase = trim((string) config('staging.database'));
        $database = trim((string) config('database.connections.'.config('database.default').'.database'));
        $this->require($expectedDatabase !== '' && hash_equals($expectedDatabase, $database), 'database isolation');

        $redisPrefix = (string) config('database.redis.options.prefix');
        $expectedPrefix = (string) config('staging.redis_prefix', 'edusmart:staging:');
        $this->require($expectedPrefix !== '' && str_starts_with($redisPrefix, $expectedPrefix), 'Redis prefix isolation');
        $this->require(config('cache.default') === 'redis', 'Redis cache');
        $this->require(config('queue.default') === 'redis', 'Redis queue');
        $this->require(config('session.driver') === 'redis', 'Redis session');

        $expectedBucket = trim((string) config('staging.storage_bucket'));
        $bucket = trim((string) config('services.object_storage.bucket'));
        $this->require($expectedBucket !== '' && hash_equals($expectedBucket, $bucket), 'storage bucket isolation');
        $this->require((bool) config('services.object_storage.enabled'), 'object storage provider');

        $this->require(in_array(config('mail.default'), ['array', 'log'], true), 'safe mailer');
        $this->require(! (bool) config('services.google.enabled'), 'Google OAuth disabled');
        $this->require(! (bool) config('services.google.drive.enabled'), 'Google Drive disabled');
        $this->require(! (bool) config('services.whatsapp.central_enabled'), 'WhatsApp disabled');
        $this->require(! (bool) config('rfid.mqtt.enabled'), 'RFID MQTT disabled');
        $this->require(! (bool) config('rfid.mosquitto.enabled'), 'Mosquitto disabled');
    }

    private function requireExpectedHost(string $actual, string $expected, string $label): void
    {
        $expected = strtolower(trim($expected));
        $this->require($actual !== '' && $expected !== '' && hash_equals($expected, $actual), $label.' host isolation');
        $this->require(! in_array($actual, self::FORBIDDEN_HOSTS, true), $label.' production-host rejection');
    }

    private function host(string $url): string
    {
        return rtrim(strtolower((string) parse_url(trim($url), PHP_URL_HOST)), '.');
    }

    private function require(bool $condition, string $label): void
    {
        if (! $condition) {
            throw new RuntimeException('Staging isolation preflight failed: '.$label.'.');
        }
    }
}
