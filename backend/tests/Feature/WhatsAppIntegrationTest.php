<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\WhatsApp\WhatsAppIntegrationService;
use App\Services\WhatsApp\WhatsAppNotificationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class WhatsAppIntegrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_generate_qr_for_own_tenant(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.evolution_api.webhook_base_url', 'https://edusmart.example.com');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin@example.com');

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([], 200),
            'https://evolution.test/instance/create' => Http::response([
                'instance' => ['instanceName' => 'edusmart-default'],
            ], 201),
            'https://evolution.test/webhook/set/*' => Http::response(['success' => true], 200),
            'https://evolution.test/instance/connect/*' => Http::response([
                'code' => '2@TEST-QR-CODE',
            ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/connect');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'awaiting_qr');
        $response->assertJsonPath('data.integration.qr_code', '2@TEST-QR-CODE');

        $integration = DB::table('whatsapp_integrations')
            ->where('tenant_id', $tenantId)
            ->first();

        $this->assertNotNull($integration);
        $this->assertDatabaseHas('whatsapp_integrations', [
            'tenant_id' => $tenantId,
            'instance_name' => 'edusmart-default',
            'status' => 'awaiting_qr',
        ]);

        Http::assertSent(function ($request) use ($integration) {
            return $request->url() === 'https://evolution.test/webhook/set/edusmart-default'
                && $request['webhook']['enabled'] === true
                && $request['webhook']['url'] === 'https://edusmart.example.com/api/whatsapp/webhook/'.$integration->webhook_secret
                && $request['webhook']['webhookByEvents'] === true
                && $request['webhook']['webhookBase64'] === true
                && $request['webhook']['events'] === ['QRCODE_UPDATED', 'CONNECTION_UPDATE'];
        });
    }

    public function test_admin_can_prepare_qr_even_when_connect_endpoint_returns_error(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.evolution_api.webhook_base_url', 'https://edusmart.example.com');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-timeout@example.com');

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([], 200),
            'https://evolution.test/instance/create' => Http::response([
                'instance' => ['instanceName' => 'edusmart-default'],
            ], 201),
            'https://evolution.test/webhook/set/*' => Http::response(['success' => true], 200),
            'https://evolution.test/instance/connect/*' => Http::response([
                'message' => 'Gateway timeout',
            ], 504),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/connect');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'awaiting_qr');
        $response->assertJsonPath('data.integration.connection_state', 'connecting');
        $response->assertJsonPath('data.integration.qr_code', null);
        $response->assertJsonPath('data.integration.last_error', 'Gateway timeout');
    }

    public function test_admin_can_generate_qr_even_when_webhook_setup_fails(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.evolution_api.webhook_base_url', 'https://edusmart.example.com');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-webhook-fails@example.com');

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([], 200),
            'https://evolution.test/instance/create' => Http::response([
                'instance' => ['instanceName' => 'edusmart-default'],
            ], 201),
            'https://evolution.test/webhook/set/*' => Http::response([
                'message' => 'Internal Server Error',
            ], 500),
            'https://evolution.test/instance/connect/*' => Http::response([
                'base64' => 'data:image/png;base64,QR-WEBHOOK-FAILED',
            ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/connect');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'awaiting_qr');
        $response->assertJsonPath('data.integration.qr_code', 'data:image/png;base64,QR-WEBHOOK-FAILED');
        $this->assertStringContainsString(
            'QR tetap diproses',
            (string) $response->json('data.integration.last_error')
        );
    }

    public function test_admin_can_generate_qr_when_provider_fetch_returns_not_found(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.evolution_api.webhook_base_url', 'https://edusmart.example.com');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-not-found@example.com');

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([
                'status' => 404,
                'error' => 'Not Found',
            ], 404),
            'https://evolution.test/instance/create' => Http::response([
                'instance' => ['instanceName' => 'edusmart-default'],
            ], 201),
            'https://evolution.test/webhook/set/*' => Http::response(['success' => true], 200),
            'https://evolution.test/instance/connect/*' => Http::response([
                'base64' => 'data:image/png;base64,QR-NOT-FOUND',
                'count' => 1,
            ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/connect');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'awaiting_qr');
        $response->assertJsonPath('data.integration.qr_code', 'data:image/png;base64,QR-NOT-FOUND');
    }

    public function test_admin_generate_qr_recreates_non_open_instance_before_connecting(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.evolution_api.webhook_base_url', 'https://edusmart.example.com');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-recreate@example.com');

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'disconnected',
            'connection_state' => 'close',
            'webhook_secret' => 'secret-webhook-token-recreate',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::sequence()
                ->push([
                    [
                        'name' => 'edusmart-default',
                        'connectionStatus' => 'close',
                    ],
                ], 200)
                ->push([
                    'status' => 404,
                    'error' => 'Not Found',
                ], 404),
            'https://evolution.test/instance/logout/*' => Http::response(['success' => true], 200),
            'https://evolution.test/instance/delete/*' => Http::response(['success' => true], 200),
            'https://evolution.test/instance/create' => Http::response([
                'instance' => ['instanceName' => 'edusmart-default'],
            ], 201),
            'https://evolution.test/webhook/set/*' => Http::response(['success' => true], 200),
            'https://evolution.test/instance/connect/*' => Http::sequence()
                ->push([
                    'count' => 0,
                ], 200)
                ->push([
                    'pairingCode' => 'PAIR-RESET',
                ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/connect');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'awaiting_qr');
        $response->assertJsonPath('data.integration.pairing_code', 'PAIR-RESET');

        $recorded = Http::recorded();
        $this->assertCount(9, $recorded);
        $this->assertSame('https://evolution.test/instance/fetchInstances?instanceName=edusmart-default', $recorded[0][0]->url());
        $this->assertSame('https://evolution.test/webhook/set/edusmart-default', $recorded[1][0]->url());
        $this->assertSame('https://evolution.test/instance/connect/edusmart-default', $recorded[2][0]->url());
        $this->assertSame('https://evolution.test/instance/logout/edusmart-default', $recorded[3][0]->url());
        $this->assertSame('https://evolution.test/instance/delete/edusmart-default', $recorded[4][0]->url());
        $this->assertSame('https://evolution.test/instance/fetchInstances?instanceName=edusmart-default', $recorded[5][0]->url());
        $this->assertSame('https://evolution.test/instance/create', $recorded[6][0]->url());
        $this->assertSame('https://evolution.test/webhook/set/edusmart-default', $recorded[7][0]->url());
        $this->assertSame('https://evolution.test/instance/connect/edusmart-default', $recorded[8][0]->url());
    }

    public function test_admin_generate_qr_reuses_existing_connecting_instance_before_recreate(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.evolution_api.webhook_base_url', 'https://edusmart.example.com');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-connecting-instance@example.com');

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'awaiting_qr',
            'connection_state' => 'connecting',
            'webhook_secret' => 'secret-webhook-token-connecting-instance',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([
                [
                    'name' => 'edusmart-default',
                    'connectionStatus' => 'connecting',
                ],
            ], 200),
            'https://evolution.test/webhook/set/*' => Http::response(['success' => true], 200),
            'https://evolution.test/instance/connect/*' => Http::response([
                'base64' => 'data:image/png;base64,QR-EXISTING',
                'pairingCode' => 'PAIR-EXISTING',
                'count' => 1,
            ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/connect');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'awaiting_qr');
        $response->assertJsonPath('data.integration.qr_code', 'data:image/png;base64,QR-EXISTING');
        $response->assertJsonPath('data.integration.pairing_code', 'PAIR-EXISTING');

        Http::assertSentCount(3);
    }

    public function test_admin_generate_qr_keeps_connected_instance_connected(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.evolution_api.webhook_base_url', 'https://edusmart.example.com');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-open-instance@example.com');

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'connected',
            'connection_state' => 'open',
            'connected_phone' => '6281234567890',
            'connected_name' => 'Admin Device',
            'webhook_secret' => 'secret-webhook-token-open-instance',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([
                [
                    'name' => 'edusmart-default',
                    'connectionStatus' => 'open',
                    'number' => '6281234567890',
                    'profileName' => 'Admin Device',
                ],
            ], 200),
            'https://evolution.test/webhook/set/*' => Http::response(['success' => true], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/connect');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'connected');
        $response->assertJsonPath('data.integration.connection_state', 'open');
        $response->assertJsonPath('data.integration.last_error', 'WhatsApp sudah terhubung. Logout dulu jika ingin membuat QR baru.');

        Http::assertSentCount(2);
    }

    public function test_webhook_updates_connection_state_to_connected(): void
    {
        $tenantId = $this->defaultTenantId();

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'awaiting_qr',
            'connection_state' => 'connecting',
            'webhook_secret' => 'secret-webhook-token',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/whatsapp/webhook/secret-webhook-token/connection-update', [
            'data' => [
                'status' => 'open',
                'owner' => '6281234567890@s.whatsapp.net',
                'profileName' => 'Tenant Demo',
            ],
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('whatsapp_integrations', [
            'tenant_id' => $tenantId,
            'status' => 'connected',
            'connection_state' => 'open',
            'connected_phone' => '6281234567890',
            'connected_name' => 'Tenant Demo',
        ]);
    }

    public function test_sync_accepts_evolution_v211_instance_shape(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-sync@example.com');

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'disconnected',
            'connection_state' => 'close',
            'webhook_secret' => 'secret-webhook-token-sync',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([
                [
                    'name' => 'edusmart-default',
                    'connectionStatus' => 'open',
                    'number' => '6281234567890',
                    'profileName' => 'Tenant Demo',
                ],
            ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/sync');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'connected');
        $response->assertJsonPath('data.integration.connected_phone', '6281234567890');
        $response->assertJsonPath('data.integration.connected_name', 'Tenant Demo');
    }

    public function test_sync_accepts_nested_evolution_instance_response_shape(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-sync-nested@example.com');

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'disconnected',
            'connection_state' => 'close',
            'webhook_secret' => 'secret-webhook-token-sync-nested',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([
                'data' => [
                    [
                        'instance' => [
                            'instanceName' => 'edusmart-default',
                            'connectionStatus' => 'open',
                            'ownerJid' => '6281234567891@s.whatsapp.net',
                            'profileName' => 'Tenant Nested',
                        ],
                    ],
                ],
            ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/sync');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'connected');
        $response->assertJsonPath('data.integration.connected_phone', '6281234567891');
        $response->assertJsonPath('data.integration.connected_name', 'Tenant Nested');
    }

    public function test_webhook_accepts_dotted_event_payload_names(): void
    {
        $tenantId = $this->defaultTenantId();

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'awaiting_qr',
            'connection_state' => 'connecting',
            'webhook_secret' => 'secret-webhook-token-dot-event',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/whatsapp/webhook/secret-webhook-token-dot-event', [
            'event' => 'connection.update',
            'data' => [
                'name' => 'edusmart-default',
                'connectionStatus' => 'open',
                'number' => '6281234567892',
                'profileName' => 'Tenant Dot Event',
            ],
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('whatsapp_integrations', [
            'tenant_id' => $tenantId,
            'status' => 'connected',
            'connection_state' => 'open',
            'connected_phone' => '6281234567892',
            'connected_name' => 'Tenant Dot Event',
        ]);
    }

    public function test_webhook_accepts_evolution_v211_connection_payload_shape(): void
    {
        $tenantId = $this->defaultTenantId();

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'awaiting_qr',
            'connection_state' => 'connecting',
            'webhook_secret' => 'secret-webhook-token-v211',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/whatsapp/webhook/secret-webhook-token-v211/connection-update', [
            'data' => [
                'name' => 'edusmart-default',
                'connectionStatus' => 'open',
                'number' => '6281234567890',
                'profileName' => 'Tenant Demo V2',
            ],
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('whatsapp_integrations', [
            'tenant_id' => $tenantId,
            'status' => 'connected',
            'connection_state' => 'open',
            'connected_phone' => '6281234567890',
            'connected_name' => 'Tenant Demo V2',
        ]);
    }

    public function test_sync_refreshes_qr_from_connect_endpoint_while_waiting_scan(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-qr-sync@example.com');

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'awaiting_qr',
            'connection_state' => 'connecting',
            'webhook_secret' => 'secret-webhook-token-qr-sync',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([
                [
                    'name' => 'edusmart-default',
                    'connectionStatus' => 'close',
                ],
            ], 200),
            'https://evolution.test/instance/connect/*' => Http::response([
                'base64' => 'data:image/png;base64,TEST-QR-IMAGE',
                'pairingCode' => 'PAIR1234',
                'count' => 1,
            ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/sync');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'awaiting_qr');
        $response->assertJsonPath('data.integration.connection_state', 'connecting');
        $response->assertJsonPath('data.integration.qr_code', 'data:image/png;base64,TEST-QR-IMAGE');
        $response->assertJsonPath('data.integration.pairing_code', 'PAIR1234');
    }

    public function test_sync_does_not_reconnect_when_instance_is_plainly_disconnected(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-no-reconnect@example.com');

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'disconnected',
            'connection_state' => 'close',
            'webhook_secret' => 'secret-webhook-token-no-reconnect',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([
                [
                    'name' => 'edusmart-default',
                    'connectionStatus' => 'close',
                ],
            ], 200),
            'https://evolution.test/instance/connect/*' => Http::response([
                'base64' => 'data:image/png;base64,SHOULD-NOT-BE-CALLED',
            ], 200),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/sync');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'disconnected');
        $response->assertJsonPath('data.integration.connection_state', 'close');
        $response->assertJsonPath('data.integration.qr_code', null);

        Http::assertSentCount(1);
    }

    public function test_logout_clears_local_state_even_when_provider_logout_fails(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-logout@example.com');

        DB::table('whatsapp_integrations')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'connected',
            'connection_state' => 'open',
            'qr_code' => '2@OLD-QR',
            'pairing_code' => 'PAIR-123',
            'connected_phone' => '6281234567890',
            'connected_name' => 'Admin Device',
            'webhook_secret' => 'secret-webhook-token-logout',
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://evolution.test/instance/logout/*' => Http::response(['error' => 'not found'], 404),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/logout');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'disconnected');
        $response->assertJsonPath('data.integration.qr_code', null);

        $this->assertDatabaseHas('whatsapp_integrations', [
            'tenant_id' => $tenantId,
            'status' => 'disconnected',
            'connection_state' => 'close',
            'qr_code' => null,
            'pairing_code' => null,
            'connected_phone' => null,
        ]);
    }

    public function test_overview_uses_current_platform_domain_for_evolution_public_url(): void
    {
        config()->set('app.url', 'https://sismu.biz.id');
        config()->set('tenancy.public_scheme', 'https');
        config()->set('services.evolution_api.public_url', 'https://wa.xiaozhiscig.biz.id');

        $tenantId = $this->defaultTenantId();
        $service = app(WhatsAppIntegrationService::class);

        $overview = $service->overview($tenantId, 'sman3bogor.sismu.biz.id');

        $this->assertSame('https://wa.sismu.biz.id', $overview['provider']['public_url']);
    }

    public function test_generate_qr_returns_clear_gateway_error_without_server_error(): void
    {
        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.evolution_api.webhook_base_url', 'https://edusmart.example.com');

        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'admin', 'admin-provider-failure@example.com');

        Http::fake([
            'https://evolution.test/instance/fetchInstances*' => Http::response([
                'message' => 'Evolution API error HTTP 502',
            ], 502),
        ]);

        Sanctum::actingAs($user);

        $response = $this->postJson('/api/admin/whatsapp/connect');

        $response->assertOk();
        $response->assertJsonPath('data.integration.status', 'disconnected');
        $response->assertJsonPath('data.integration.last_error', 'Evolution API error HTTP 502');
    }

    public function test_assignment_submission_mutation_does_not_send_whatsapp_anymore(): void
    {
        Queue::fake();

        $tenantId = $this->defaultTenantId();
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-submit@example.com', [
            'kelas' => 'x-a-mipa',
            'no_hp_wali' => '081234567890',
        ]);
        $this->createConnectedWhatsApp($tenantId, [
            'send_assignment_updates' => true,
        ]);

        $taskId = 9101;
        DB::table('tugas')->insert([
            'id' => $taskId,
            'tenant_id' => $tenantId,
            'kelas' => 'x-a-mipa',
            'judul' => 'Latihan submit',
            'mapel' => 'BIOLOGI',
            'deadline' => now()->addHour(),
            'created_by' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        app(WhatsAppNotificationService::class)->handleTableMutation($tenantId, 'tugas_jawaban', 'insert', [], [[
            'id' => 9901,
            'tenant_id' => $tenantId,
            'tugas_id' => $taskId,
            'user_id' => $student->id,
            'status' => 'menunggu',
            'waktu_submit' => now(),
        ]]);

        $this->assertDatabaseCount('whatsapp_message_logs', 0);
    }

    public function test_closed_assignment_warning_queues_only_missing_students_once(): void
    {
        Queue::fake();

        config()->set('services.evolution_api.base_url', 'https://evolution.test');
        config()->set('services.evolution_api.api_key', 'secret-key');
        config()->set('services.whatsapp.assignment_missing_lookback_minutes', 180);

        $tenantId = $this->defaultTenantId();
        $missing = $this->createUserWithProfile($tenantId, 'siswa', 'student-missing@example.com', [
            'nama' => 'Siswa Belum',
            'kelas' => 'x-a-mipa',
            'no_hp_wali' => '081234567890',
        ]);
        $submitted = $this->createUserWithProfile($tenantId, 'siswa', 'student-done@example.com', [
            'nama' => 'Siswa Selesai',
            'kelas' => 'x-a-mipa',
            'no_hp_wali' => '081111111111',
        ]);
        $this->createConnectedWhatsApp($tenantId, [
            'send_assignment_updates' => true,
        ]);

        $taskId = 9102;
        DB::table('tugas')->insert([
            'id' => $taskId,
            'tenant_id' => $tenantId,
            'kelas' => 'x-a-mipa',
            'judul' => 'Latihan deadline',
            'mapel' => 'BIOLOGI',
            'deadline' => now()->subMinute(),
            'created_by' => null,
            'created_at' => now()->subDay(),
            'updated_at' => now(),
        ]);

        DB::table('tugas_jawaban')->insert([
            'tenant_id' => $tenantId,
            'tugas_id' => $taskId,
            'user_id' => $submitted->id,
            'status' => 'menunggu',
            'waktu_submit' => now()->subMinutes(5),
        ]);

        $service = app(WhatsAppNotificationService::class);

        $first = $service->queueClosedAssignmentWarnings($tenantId);
        $second = $service->queueClosedAssignmentWarnings($tenantId);

        $this->assertSame(1, $first['queued']);
        $this->assertSame(0, $second['queued']);
        $this->assertDatabaseHas('whatsapp_message_logs', [
            'tenant_id' => $tenantId,
            'category' => 'assignment_missing',
            'event_key' => 'assignment-missing:'.$taskId.':'.$missing->id,
            'normalized_phone' => '6281234567890',
            'target_profile_id' => $missing->id,
            'status' => 'queued',
        ]);
        $this->assertDatabaseMissing('whatsapp_message_logs', [
            'tenant_id' => $tenantId,
            'event_key' => 'assignment-missing:'.$taskId.':'.$submitted->id,
        ]);
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role, string $email, array $profileOverrides = []): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => (string) ($profileOverrides['nama'] ?? $role.' test'),
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert(array_merge([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => 'admin-room',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $profileOverrides));

        return $user;
    }

    private function createConnectedWhatsApp(string $tenantId, array $settingsOverrides = []): void
    {
        $integrationId = (string) Str::uuid();

        DB::table('whatsapp_integrations')->insert([
            'id' => $integrationId,
            'tenant_id' => $tenantId,
            'provider' => 'evolution',
            'instance_name' => 'edusmart-default',
            'status' => 'connected',
            'connection_state' => 'open',
            'connected_phone' => '628999999999',
            'connected_name' => 'Admin Device',
            'webhook_secret' => 'secret-webhook-token-'.$integrationId,
            'is_enabled' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('whatsapp_notification_settings')->insert(array_merge([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'integration_id' => $integrationId,
            'is_enabled' => true,
            'send_attendance' => true,
            'send_profile_updates' => false,
            'send_assignment_updates' => false,
            'send_extracurricular_updates' => false,
            'send_grade_updates' => false,
            'recipient_mode' => 'wali',
            'created_at' => now(),
            'updated_at' => now(),
        ], $settingsOverrides));
    }
}
