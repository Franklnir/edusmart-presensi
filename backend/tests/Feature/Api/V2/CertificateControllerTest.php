<?php

namespace Tests\Feature\Api\V2;

use App\Models\Certificate;
use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class CertificateControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_create_certificate(): void
    {
        $tenantId = $this->defaultTenantId();

        $admin = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Admin',
            'email' => 'admin@example.com',
            'password' => bcrypt('password'),
        ]);

        Profile::query()->create([
            'id' => $admin->id,
            'tenant_id' => $tenantId,
            'role' => 'admin',
            'nama' => 'Admin',
            'email' => 'admin@example.com',
            'status' => 'active',
        ]);

        $response = $this->actingAs($admin)->postJson('/api/v2/certificates', [
            'nama_penerima' => 'John Doe',
            'event' => 'Lomba Coding',
            'file_url' => 'https://example.com/cert.pdf',
        ], ['X-Tenant-Domain' => 'default.localhost']);

        $response->assertCreated();
        $response->assertJsonPath('data.nama_penerima', 'John Doe');

        $this->assertDatabaseHas('certificates', [
            'tenant_id' => $tenantId,
            'nama_penerima' => 'John Doe',
            'event' => 'Lomba Coding',
        ]);
    }

    public function test_can_delete_certificate(): void
    {
        $tenantId = $this->defaultTenantId();

        $admin = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Admin',
            'email' => 'admin@example.com',
            'password' => bcrypt('password'),
        ]);

        Profile::query()->create([
            'id' => $admin->id,
            'tenant_id' => $tenantId,
            'role' => 'admin',
            'nama' => 'Admin',
            'email' => 'admin@example.com',
            'status' => 'active',
        ]);

        $cert = Certificate::query()->create([
            'tenant_id' => $tenantId,
            'nama_penerima' => 'Jane Doe',
            'event' => 'Workshop',
            'file_url' => 'https://example.com/cert.pdf',
        ]);

        $response = $this->actingAs($admin)->deleteJson("/api/v2/certificates/{$cert->id}", [], [
            'X-Tenant-Domain' => 'default.localhost',
        ]);

        $response->assertOk();

        $this->assertDatabaseMissing('certificates', [
            'id' => $cert->id,
        ]);
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');
    }
}
