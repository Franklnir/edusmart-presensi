<?php

namespace Tests\Unit;

use App\Services\StagingIsolationGuard;
use RuntimeException;
use Tests\TestCase;

class StagingIsolationGuardTest extends TestCase
{
    public function test_it_does_nothing_outside_staging(): void
    {
        app(StagingIsolationGuard::class)->assertSafe();

        $this->addToAssertionCount(1);
    }

    public function test_it_rejects_a_production_host_in_staging(): void
    {
        $this->app->detectEnvironment(fn () => 'staging');

        config([
            'app.url' => 'https://sismu.biz.id',
            'app.frontend_url' => 'https://staging.example.test',
            'staging.isolation_acknowledged' => true,
            'staging.backend_host' => 'sismu.biz.id',
            'staging.frontend_host' => 'staging.example.test',
            'staging.storage_host' => 'storage-staging.example.test',
        ]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('production-host rejection');

        app(StagingIsolationGuard::class)->assertSafe();
    }

    public function test_it_accepts_an_isolated_staging_configuration(): void
    {
        $this->app->detectEnvironment(fn () => 'staging');

        config([
            'app.url' => 'https://api-staging.example.test',
            'app.frontend_url' => 'https://staging.example.test',
            'staging.isolation_acknowledged' => true,
            'staging.backend_host' => 'api-staging.example.test',
            'staging.frontend_host' => 'staging.example.test',
            'staging.storage_host' => 'storage-staging.example.test',
            'staging.database' => 'edusmart_staging',
            'staging.redis_prefix' => 'edusmart:staging:',
            'staging.storage_bucket' => 'edusmart-staging',
            'database.default' => 'pgsql',
            'database.connections.pgsql.database' => 'edusmart_staging',
            'database.redis.options.prefix' => 'edusmart:staging:acceptance:',
            'cache.default' => 'redis',
            'queue.default' => 'redis',
            'session.driver' => 'redis',
            'services.object_storage.enabled' => true,
            'services.object_storage.endpoint' => 'https://storage-staging.example.test',
            'services.object_storage.bucket' => 'edusmart-staging',
            'services.google.enabled' => false,
            'services.google.drive.enabled' => false,
            'services.whatsapp.central_enabled' => false,
            'rfid.mqtt.enabled' => false,
            'rfid.mosquitto.enabled' => false,
            'mail.default' => 'log',
        ]);

        app(StagingIsolationGuard::class)->assertSafe();

        $this->addToAssertionCount(1);
    }
}
