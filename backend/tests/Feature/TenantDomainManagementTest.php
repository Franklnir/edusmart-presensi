<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class TenantDomainManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_super_admin_can_register_tenant_custom_domain_and_resolve_it(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $response = $this
            ->actingAs($superAdmin)
            ->postJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/domains", [
                'host' => 'smabali.sch.id',
                'is_primary' => true,
            ]);

        $response
            ->assertStatus(201)
            ->assertJsonPath('data.host', 'smabali.sch.id')
            ->assertJsonPath('data.tenant_id', $tenantId)
            ->assertJsonPath('data.domain_type', 'tenant');

        $this->getJson('http://smabali.sch.id/api/health')
            ->assertOk()
            ->assertJsonPath('status', 'ok');
    }

    public function test_custom_admin_domain_works_and_unknown_host_is_rejected(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $superAdmin = $this->createSuperAdmin();

        $response = $this
            ->actingAs($superAdmin)
            ->postJson('http://admin.edusmart.test/api/super/domains', [
                'host' => 'panel.grupsekolah.id',
                'is_primary' => true,
            ]);

        $response
            ->assertStatus(201)
            ->assertJsonPath('data.host', 'panel.grupsekolah.id')
            ->assertJsonPath('data.domain_type', 'admin');

        $this
            ->actingAs($superAdmin)
            ->getJson('http://panel.grupsekolah.id/api/super/me')
            ->assertOk()
            ->assertJsonPath('data.is_super_admin', true);

        $this->getJson('http://asing.grupsekolah.id/api/health')
            ->assertStatus(404)
            ->assertJsonPath('error', 'Host tenant belum terdaftar. Tambahkan domain ini dari panel super admin terlebih dahulu.');
    }

    public function test_tls_ask_endpoint_allows_known_hosts_and_rejects_unknown_hosts(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);
        config()->set('services.caddy.ask_secret', 'test-secret');
        config()->set('services.caddy.evolution_host', 'wa.edusmart.test');

        $superAdmin = $this->createSuperAdmin();
        $tenantId = $this->createTenant('SMA Bali', 'bali');

        $this
            ->actingAs($superAdmin)
            ->postJson("http://admin.edusmart.test/api/super/tenants/{$tenantId}/domains", [
                'host' => 'smabali.sch.id',
                'is_primary' => true,
            ])
            ->assertCreated();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=bali.edusmart.test')
            ->assertNoContent();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=smabali.sch.id')
            ->assertNoContent();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=wa.edusmart.test')
            ->assertNoContent();

        $this->get('http://nginx/api/internal/tls/authorize?secret=test-secret&domain=asing.edusmart.test')
            ->assertStatus(403)
            ->assertJsonPath('error', 'Domain belum terdaftar untuk auto TLS.');
    }

    public function test_tls_ask_endpoint_rejects_invalid_secret(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);
        config()->set('services.caddy.ask_secret', 'test-secret');

        $this->createTenant('SMA Bali', 'bali');

        $this->get('http://nginx/api/internal/tls/authorize?secret=salah&domain=bali.edusmart.test')
            ->assertStatus(403)
            ->assertJsonPath('error', 'Permintaan TLS tidak valid.');
    }

    private function createSuperAdmin(): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Admin',
            'email' => 'super-admin@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'created_at' => now(),
        ]);

        return $user;
    }

    private function createTenant(string $name, string $slug): string
    {
        $tenantId = (string) Str::uuid();

        DB::table('tenants')->insert([
            'id' => $tenantId,
            'name' => $name,
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $tenantId;
    }
}
