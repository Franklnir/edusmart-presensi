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

    public function test_audit_trail_flags_report_security_anomalies_with_safe_actions(): void
    {
        config()->set('tenancy.root_domain', 'edusmart.test');
        config()->set('tenancy.admin_subdomain', 'admin');
        config()->set('tenancy.admin_hosts', []);
        config()->set('tenancy.allow_root_for_super_admin', false);

        $tenantId = $this->defaultTenantId();
        $superAdmin = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Admin',
            'email' => 'audit-super@example.com',
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

        for ($i = 0; $i < 10; $i++) {
            $this->insertAuditEvent($tenantId, 'auth_events', [
                'event' => 'login_failed_invalid_credentials',
                'email' => 'target@example.com',
                'ip' => '149.22.88.138',
                'host' => 'sismu.biz.id',
            ]);
        }

        $this->insertAuditEvent($tenantId, 'security_events', [
            'event' => 'security_blocked_request',
            'path' => '/.env',
            'host' => 'sismu.biz.id',
            'user_agent' => 'nuclei',
        ]);
        $this->insertAuditEvent($tenantId, 'security_events', [
            'event' => 'security_blocked_request',
            'path' => '/manager',
            'host' => 'wa.sismu.biz.id',
            'user_agent' => 'Mozilla/5.0',
        ]);
        $this->insertAuditEvent($tenantId, 'security_events', [
            'event' => 'security_blocked_request',
            'path' => '/api/db',
            'host' => 'sismu.biz.id',
            'user_agent' => 'curl/8',
        ]);
        $this->insertAuditEvent($tenantId, 'super_admins', [
            'user_id' => (string) Str::uuid(),
            'email' => 'unexpected-super@example.com',
        ]);

        for ($i = 0; $i < 20; $i++) {
            DB::table('rfid_device_events')->insert([
                'tenant_id' => $tenantId,
                'device_id' => 'audit-test-device',
                'event_id' => 'audit-event-'.$i,
                'card_uid' => 'AABBCCDD',
                'mode' => 'auto',
                'source' => 'mqtt',
                'status' => 'error',
                'response_code' => 422,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $response = $this
            ->actingAs($superAdmin)
            ->getJson('http://admin.edusmart.test/api/super/audit-trail');

        $response->assertOk();
        $anomalies = $response->json('data.anomalies') ?? [];
        $codes = array_column($anomalies, 'code');

        foreach ([
            'LOGIN_FAILURE_BURST',
            'SCANNER_TRAFFIC_DETECTED',
            'SENSITIVE_PATH_PROBE_DETECTED',
            'WA_MANAGER_PROBE_DETECTED',
            'API_DB_PROBE_DETECTED',
            'SUPER_ADMIN_MEMBERSHIP_CHANGED',
            'RFID_ERROR_BURST',
        ] as $expectedCode) {
            $this->assertContains($expectedCode, $codes);
        }

        foreach ($anomalies as $anomaly) {
            $this->assertArrayHasKey('recommended_action', $anomaly);
            $this->assertArrayHasKey('auto_remediation', $anomaly);
            $this->assertFalse($anomaly['auto_remediation']);
        }
    }

    private function insertAuditEvent(string $tenantId, string $tableName, array $newData): void
    {
        DB::table('audit_log')->insert([
            'table_name' => $tableName,
            'record_id' => (string) Str::uuid(),
            'action' => 'INSERT',
            'old_data' => null,
            'new_data' => json_encode($newData),
            'user_id' => null,
            'user_role' => null,
            'tenant_id' => $tenantId,
            'timestamp' => now(),
        ]);
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');
    }
}
