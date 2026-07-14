<?php

namespace Tests\Feature\Api\V2;

use App\Models\CertificateTemplate;
use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class CertificateTemplateControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_create_template(): void
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

        $response = $this->actingAs($admin)->postJson('/api/v2/certificate-templates', [
            'nama' => 'Template Default',
            'background_url' => 'https://example.com/bg.png',
        ], ['X-Tenant-Domain' => 'default.localhost']);

        $response->assertCreated();
        $response->assertJsonPath('data.nama', 'Template Default');

        $this->assertDatabaseHas('templat_sertifikat_publik', [
            'tenant_id' => $tenantId,
            'nama' => 'Template Default',
        ]);
    }

    public function test_can_delete_template(): void
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

        $template = CertificateTemplate::query()->create([
            'tenant_id' => $tenantId,
            'nama' => 'Template Default',
            'background_url' => 'https://example.com/bg.png',
        ]);

        $response = $this->actingAs($admin)->deleteJson("/api/v2/certificate-templates/{$template->id}", [], [
            'X-Tenant-Domain' => 'default.localhost'
        ]);

        $response->assertOk();

        $this->assertDatabaseMissing('templat_sertifikat_publik', [
            'id' => $template->id,
        ]);
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');
    }
}
