<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class AuthSecurityDeviceTest extends TestCase
{
    use RefreshDatabase;

    public function test_security_overview_lists_sessions_tokens_and_login_history(): void
    {
        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile($tenantId, 'guru', 'x-a', 'guru-security@example.com');

        DB::table('sessions')->insert([
            'id' => 'web-session-a',
            'user_id' => $user->id,
            'ip_address' => '10.1.1.10',
            'user_agent' => 'Mozilla/5.0 Chrome/125.0 Windows NT 10.0',
            'payload' => 'payload',
            'last_activity' => now()->timestamp,
        ]);

        DB::table('personal_access_tokens')->insert([
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
            'name' => 'mobile-guru-20260621',
            'token' => hash('sha256', 'mobile-token-a'),
            'abilities' => json_encode(['mobile', 'guru']),
            'last_used_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('audit_log')->insert([
            'table_name' => 'auth_events',
            'record_id' => (string) Str::uuid(),
            'action' => 'INSERT',
            'new_data' => json_encode([
                'event' => 'login_success',
                'ip' => '10.1.1.10',
                'host' => 'sekolah.test',
                'user_agent' => 'Mozilla/5.0 Chrome/125.0 Windows NT 10.0',
            ]),
            'user_id' => $user->id,
            'user_role' => 'guru',
            'tenant_id' => $tenantId,
            'timestamp' => now(),
        ]);

        $response = $this->actingAs($user)->getJson('/api/auth/security');

        $response->assertOk();
        $response->assertJsonPath('data.summary.active_web_sessions', 1);
        $response->assertJsonPath('data.summary.active_api_tokens', 1);
        $response->assertJsonPath('data.login_history.0.event', 'login_success');
        $response->assertJsonPath('data.web_sessions.0.ip_address', '10.1.1.10');
        $response->assertJsonPath('data.api_tokens.0.name', 'mobile-guru-20260621');
    }

    public function test_logout_other_devices_requires_password_and_revokes_sessions_and_tokens(): void
    {
        $tenantId = $this->defaultTenantId();
        $user = $this->createUserWithProfile(
            $tenantId,
            'siswa',
            'x-a',
            'siswa-security@example.com',
            'CurrentStr0ng!Pass'
        );

        DB::table('sessions')->insert([
            [
                'id' => 'web-session-a',
                'user_id' => $user->id,
                'ip_address' => '10.1.1.10',
                'user_agent' => 'Mozilla/5.0 Chrome/125.0 Windows NT 10.0',
                'payload' => 'payload',
                'last_activity' => now()->timestamp,
            ],
            [
                'id' => 'web-session-b',
                'user_id' => $user->id,
                'ip_address' => '10.1.1.11',
                'user_agent' => 'Mozilla/5.0 Safari/605.1.15 iPhone',
                'payload' => 'payload',
                'last_activity' => now()->timestamp,
            ],
        ]);

        DB::table('personal_access_tokens')->insert([
            [
                'tokenable_type' => User::class,
                'tokenable_id' => $user->id,
                'name' => 'mobile-siswa-a',
                'token' => hash('sha256', 'mobile-token-a'),
                'abilities' => json_encode(['mobile', 'siswa']),
                'last_used_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tokenable_type' => User::class,
                'tokenable_id' => $user->id,
                'name' => 'mobile-siswa-b',
                'token' => hash('sha256', 'mobile-token-b'),
                'abilities' => json_encode(['mobile', 'siswa']),
                'last_used_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $wrongPassword = $this->actingAs($user)->postJson('/api/auth/logout-other-devices', [
            'password' => 'wrong-password',
        ]);

        $wrongPassword->assertStatus(422);
        $this->assertSame(2, DB::table('sessions')->where('user_id', $user->id)->count());
        $this->assertSame(2, DB::table('personal_access_tokens')->where('tokenable_id', $user->id)->count());

        $response = $this->actingAs($user)->postJson('/api/auth/logout-other-devices', [
            'password' => 'CurrentStr0ng!Pass',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.web_sessions_revoked', 2);
        $response->assertJsonPath('data.api_tokens_revoked', 2);
        $this->assertSame(0, DB::table('sessions')->where('user_id', $user->id)->count());
        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $user->id)->count());
        $this->assertDatabaseHas('audit_log', [
            'table_name' => 'auth_events',
            'user_id' => $user->id,
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

    private function createUserWithProfile(
        string $tenantId,
        string $role,
        string $kelas,
        string $email,
        string $password = 'password123'
    ): User {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' security test',
            'email' => $email,
            'password' => Hash::make($password),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => $kelas,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
