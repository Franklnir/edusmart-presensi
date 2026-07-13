<?php

namespace Tests\Unit;

use App\Services\Rfid\MqttBridgeService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

class MqttBridgeServiceTest extends TestCase
{
    public function test_client_id_is_stable_and_tenant_scoped(): void
    {
        $service = (new ReflectionClass(MqttBridgeService::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod($service, 'stableClientId');

        $config = [
            'tenant_id' => '11111111-1111-1111-1111-111111111111',
            'tenant_slug' => 'sman3bogor',
            'client_id_prefix' => 'edusmart-rfid-bridge',
        ];

        $first = $method->invoke($service, $config);
        $second = $method->invoke($service, $config);
        $other = $method->invoke($service, array_merge($config, [
            'tenant_id' => '22222222-2222-2222-2222-222222222222',
            'tenant_slug' => 'sekolah-lain',
        ]));

        $this->assertSame($first, $second);
        $this->assertNotSame($first, $other);
        $this->assertLessThanOrEqual(96, strlen($first));
        $this->assertStringContainsString('sman3bogor', $first);
    }

    public function test_runtime_metadata_does_not_force_connection_reload(): void
    {
        $service = (new ReflectionClass(MqttBridgeService::class))->newInstanceWithoutConstructor();
        $method = new \ReflectionMethod($service, 'configFingerprint');
        $config = [
            'connect_host' => 'mosquitto',
            'connect_port' => 1883,
            'bridge_username' => 'bridge',
            'bridge_password' => 'secret',
            'scan_topic_template' => 'edusmart/{tenant}/rfid/{device}/scan',
            'updated_at' => '2026-07-13 10:00:00',
        ];

        $first = $method->invoke($service, $config);
        $metadataOnly = $method->invoke($service, array_merge($config, [
            'updated_at' => '2026-07-13 10:01:00',
            'updated_by' => 'admin-id',
        ]));
        $changedCredential = $method->invoke($service, array_merge($config, [
            'bridge_password' => 'rotated-secret',
        ]));

        $this->assertSame($first, $metadataOnly);
        $this->assertNotSame($first, $changedCredential);
    }
}
