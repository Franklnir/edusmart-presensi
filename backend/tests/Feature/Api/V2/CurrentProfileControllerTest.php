<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class CurrentProfileControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_provision_creates_profile(): void
    {
        $tenantId = $this->defaultTenantId();
        
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'John Doe',
            'email' => 'john@example.com',
            'password' => bcrypt('password'),
        ]);

        $response = $this->actingAs($user)->postJson('/api/v2/profile/provision', [
            'role' => 'siswa',
            'nama' => 'John Doe',
            'email' => 'john@example.com',
            'idempotency_key' => 'test-idempotency-key-1',
        ], [
            'X-Tenant-Domain' => 'default.localhost',
            'Idempotency-Key' => 'test-idempotency-key-1'
        ]);


        $response->assertCreated();
        $response->assertJsonPath('data.nama', 'John Doe');
        $response->assertJsonPath('data.role', 'siswa');

        $this->assertDatabaseHas('profiles', [
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'role' => 'siswa',
            'nama' => 'John Doe',
            'email' => 'john@example.com',
        ]);
    }

    public function test_provision_returns_existing_profile(): void
    {
        $tenantId = $this->defaultTenantId();
        
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Jane Doe',
            'email' => 'jane@example.com',
            'password' => bcrypt('password'),
        ]);

        Profile::query()->create([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'role' => 'guru',
            'nama' => 'Jane Doe',
            'email' => 'jane@example.com',
            'status' => 'active',
        ]);

        $response = $this->actingAs($user)->postJson('/api/v2/profile/provision', [
            'role' => 'siswa',
            'nama' => 'Jane Hacker',
            'email' => 'jane@example.com',
            'idempotency_key' => 'test-idempotency-key-2',
        ], [
            'X-Tenant-Domain' => 'default.localhost',
            'Idempotency-Key' => 'test-idempotency-key-2'
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.nama', 'Jane Doe');
        $response->assertJsonPath('data.role', 'guru');
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');
    }
}
