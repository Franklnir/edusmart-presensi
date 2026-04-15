<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
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

        $this->assertDatabaseHas('whatsapp_integrations', [
            'tenant_id' => $tenantId,
            'instance_name' => 'edusmart-default',
            'status' => 'awaiting_qr',
        ]);
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

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role, string $email): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => 'admin-room',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
