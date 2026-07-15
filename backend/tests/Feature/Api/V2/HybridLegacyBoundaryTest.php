<?php

namespace Tests\Feature\Api\V2;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\TestCase;

class HybridLegacyBoundaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_legacy_routes_remain_registered_for_hybrid_consumers(): void
    {
        $uris = collect(Route::getRoutes())
            ->map(static fn ($route): string => ltrim($route->uri(), '/'))
            ->values();

        $this->assertTrue($uris->contains('api/db'));
        $this->assertTrue($uris->contains('api/db/batch'));
    }

    public function test_registered_read_is_tenant_scoped_and_records_request_telemetry(): void
    {
        $tenantA = $this->defaultTenantId();
        $tenantB = (string) Str::uuid();
        $this->seedTenant($tenantB, 'tenant-hybrid-b');
        $admin = $this->createUser($tenantA, 'admin', 'hybrid-admin@example.com');

        DB::table('settings')->insert([
            [
                'tenant_id' => $tenantA,
                'nama_sekolah' => 'Tenant A',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $tenantB,
                'nama_sekolah' => 'Tenant B',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
        $requestId = (string) Str::uuid();

        $response = $this->actingAs($admin)
            ->withHeader('X-Client-Consumer', 'legacy-supabase-adapter')
            ->withHeader('X-Request-ID', $requestId)
            ->postJson('/api/db', [
                'table' => 'settings',
                'action' => 'select',
                'columns' => 'tenant_id,nama_sekolah',
            ]);

        $response
            ->assertOk()
            ->assertHeader('X-Request-ID', $requestId);
        $this->assertSame([$tenantA], collect($response->json('data'))->pluck('tenant_id')->all());
        $this->assertDatabaseHas('db_proxy_usage_telemetry', [
            'tenant_id' => $tenantA,
            'actor_id' => $admin->id,
            'consumer_id' => 'legacy-supabase-adapter',
            'response_status' => 200,
            'request_id' => $requestId,
        ]);
    }

    public function test_migrated_legacy_write_is_blocked_with_request_id_without_fallback(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUser($tenantId, 'admin', 'hybrid-write@example.com');
        $requestId = (string) Str::uuid();

        $response = $this->actingAs($admin)
            ->withHeader('X-Client-Consumer', 'legacy-supabase-adapter')
            ->withHeader('X-Request-ID', $requestId)
            ->postJson('/api/db', [
                'table' => 'guru_mapel_bobot',
                'action' => 'upsert',
                'payload' => [
                    'mapel' => 'Matematika',
                    'bobot_tugas_pr' => 40,
                ],
            ]);

        $response
            ->assertStatus(410)
            ->assertJsonPath('code', 'DB_LEGACY_WRITE_BLOCKED')
            ->assertJsonPath('request_id', $requestId)
            ->assertHeader('X-Request-ID', $requestId);
        $this->assertDatabaseMissing('guru_mapel_bobot', ['tenant_id' => $tenantId, 'mapel' => 'Matematika']);
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')->where('slug', 'default')->value('id');
    }

    private function seedTenant(string $id, string $slug): void
    {
        DB::table('tenants')->insert([
            'id' => $id,
            'name' => $slug,
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createUser(string $tenantId, string $role, string $email): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' hybrid',
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $user->name,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
