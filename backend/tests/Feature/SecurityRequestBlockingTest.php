<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class SecurityRequestBlockingTest extends TestCase
{
    use RefreshDatabase;

    public function test_sqlmap_user_agent_is_blocked_before_auth_login(): void
    {
        config()->set('security.scanner_block.enabled', true);
        config()->set('security.scanner_block.audit', true);
        config()->set('security.scanner_block.blocked_user_agents', ['sqlmap']);

        $response = $this
            ->withHeader('User-Agent', 'sqlmap/1.9.8.9#dev (https://sqlmap.org)')
            ->postJson('/api/auth/login', [
                'email' => 'test@example.com',
                'password' => 'password',
            ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Permintaan diblokir oleh proteksi keamanan.');

        $this->assertSame(1, DB::table('audit_log')
            ->where('table_name', 'security_events')
            ->where('action', 'INSERT')
            ->count());
    }

    public function test_configured_ip_is_blocked(): void
    {
        config()->set('security.scanner_block.enabled', true);
        config()->set('security.scanner_block.blocked_ips', ['112.215.152.210']);

        $response = $this
            ->withServerVariables(['REMOTE_ADDR' => '112.215.152.210'])
            ->getJson('/api/health');

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Permintaan diblokir oleh proteksi keamanan.');
    }

    public function test_normal_api_request_is_not_blocked(): void
    {
        config()->set('security.scanner_block.enabled', true);
        config()->set('security.scanner_block.blocked_ips', []);
        config()->set('security.scanner_block.blocked_user_agents', ['sqlmap']);

        $response = $this
            ->withHeader('User-Agent', 'Mozilla/5.0')
            ->getJson('/api/health');

        $response->assertOk();
        $response->assertJsonPath('status', 'ok');
    }

    public function test_audit_trail_flags_scanner_traffic_anomaly(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $tenantId = $this->defaultTenantId();
        $superAdmin = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Admin',
            'email' => 'super@example.com',
            'password' => Hash::make('Str0ng!Passw0rd'),
        ]);

        DB::table('profiles')->insert([
            'id' => $superAdmin->id,
            'tenant_id' => $tenantId,
            'email' => $superAdmin->email,
            'nama' => $superAdmin->name,
            'role' => 'admin',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $superAdmin->id,
            'email' => $superAdmin->email,
            'name' => $superAdmin->name,
            'created_at' => now(),
        ]);

        DB::table('audit_log')->insert([
            'table_name' => 'auth_events',
            'record_id' => (string) Str::uuid(),
            'action' => 'INSERT',
            'old_data' => null,
            'new_data' => json_encode([
                'event' => 'login_denied_non_super_admin_on_admin_host',
                'user_agent' => 'sqlmap/1.9.8.9#dev (https://sqlmap.org)',
                'ip' => '112.215.152.210',
            ]),
            'user_id' => null,
            'user_role' => null,
            'tenant_id' => $tenantId,
            'timestamp' => now(),
        ]);

        $response = $this
            ->actingAs($superAdmin)
            ->getJson('http://admin.edusmart.test/api/super/audit-trail');

        $response->assertOk();
        $this->assertContains(
            'SCANNER_TRAFFIC_DETECTED',
            array_column($response->json('data.anomalies') ?? [], 'code')
        );
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');
    }
}
