<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class AuthSuperAdminHardeningTest extends TestCase
{
    use RefreshDatabase;

    public function test_register_rejects_reserved_super_admin_email(): void
    {
        config()->set('superadmin.emails', ['root@example.com']);

        $response = $this->postJson('/api/auth/register', [
            'nama' => 'User Biasa',
            'email' => 'root@example.com',
            'password' => 'Str0ng!Passw0rd',
            'role' => 'siswa',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Email ini tidak bisa digunakan untuk registrasi');
    }

    public function test_update_account_rejects_reserved_super_admin_email(): void
    {
        config()->set('superadmin.emails', ['root@example.com']);

        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'kelas-a', 'usera@example.com');

        $response = $this->actingAs($user)->postJson('/api/auth/update-account', [
            'email' => 'root@example.com',
            'password' => 'NewStr0ng!Passw0rd',
            'password_confirmation' => 'NewStr0ng!Passw0rd',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Email ini tidak bisa digunakan');
    }

    public function test_tenant_mismatch_not_bypassed_by_super_admin_email_fallback(): void
    {
        config()->set('superadmin.emails', ['reserved@example.com']);
        config()->set('superadmin.allow_email_fallback', true);
        config()->set('tenancy.allow_header_override', true);

        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'kelas-a', 'reserved@example.com');

        DB::table('tenants')->insert([
            'id' => (string) Str::uuid(),
            'name' => 'Other School',
            'slug' => 'other-school',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($user)->getJson('/api/auth/me', [
            'X-Tenant' => 'other-school',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Akses tenant ditolak');
    }

    public function test_forgot_password_returns_generic_response_for_super_admin_email(): void
    {
        config()->set('superadmin.emails', ['root@example.com']);

        $response = $this
            ->withServerVariables(['REMOTE_ADDR' => '10.10.10.1'])
            ->postJson('/api/auth/forgot-password', [
                'email' => 'root@example.com',
            ]);

        $response->assertOk();
        $response->assertJsonPath('data', 'Jika email terdaftar dan memenuhi syarat, link reset password akan dikirim.');
    }

    public function test_forgot_password_returns_generic_response_for_admin_role(): void
    {
        $tenantId = $this->defaultTenantId();
        [$adminUser] = $this->createUserWithProfile($tenantId, 'admin', 'x-a', 'admin@example.com');

        $response = $this
            ->withServerVariables(['REMOTE_ADDR' => '10.10.10.2'])
            ->postJson('/api/auth/forgot-password', [
                'email' => $adminUser->email,
            ]);

        $response->assertOk();
        $response->assertJsonPath('data', 'Jika email terdaftar dan memenuhi syarat, link reset password akan dikirim.');
    }

    public function test_forgot_password_allows_guru_and_siswa_roles(): void
    {
        $tenantId = $this->defaultTenantId();
        [$guruUser] = $this->createUserWithProfile($tenantId, 'guru', 'x-a', 'guru@example.com');
        [$siswaUser] = $this->createUserWithProfile($tenantId, 'siswa', 'x-a', 'siswa@example.com');

        $guruResponse = $this
            ->withServerVariables(['REMOTE_ADDR' => '10.10.10.3'])
            ->postJson('/api/auth/forgot-password', [
                'email' => $guruUser->email,
            ]);
        $guruResponse->assertStatus(200);

        $siswaResponse = $this
            ->withServerVariables(['REMOTE_ADDR' => '10.10.10.4'])
            ->postJson('/api/auth/forgot-password', [
                'email' => $siswaUser->email,
            ]);
        $siswaResponse->assertStatus(200);
    }

    public function test_public_register_rejects_admin_role_even_when_setting_enabled(): void
    {
        $tenantId = $this->defaultTenantId();
        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'registrasi_admin_aktif' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/auth/register', [
            'nama' => 'Admin Publik',
            'email' => 'public-admin@example.com',
            'password' => 'Str0ng!Passw0rd',
            'role' => 'admin',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Registrasi admin publik tidak diizinkan. Admin baru harus dibuat dari panel admin.');
        $this->assertDatabaseMissing('users', [
            'email' => 'public-admin@example.com',
        ]);
    }

    public function test_reset_password_rejects_admin_role(): void
    {
        $tenantId = $this->defaultTenantId();
        [$adminUser] = $this->createUserWithProfile($tenantId, 'admin', 'x-a', 'admin-reset@example.com');

        $response = $this
            ->withServerVariables(['REMOTE_ADDR' => '10.10.10.5'])
            ->postJson('/api/auth/reset-password', [
                'email' => $adminUser->email,
                'token' => 'dummy-token',
                'password' => 'NewStr0ng!Passw0rd',
                'password_confirmation' => 'NewStr0ng!Passw0rd',
            ]);

        $response->assertStatus(400);
        $response->assertJsonPath('error', 'Token reset tidak valid, sudah kedaluwarsa, atau akun tidak memenuhi syarat untuk reset mandiri.');
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role, string $kelas, string $email): array
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
            'kelas' => $kelas,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$user];
    }
}
