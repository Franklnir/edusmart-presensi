<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class ProfileProvisionOriginTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_provision_creates_synced_student_with_admin_origin(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Sekolah', 'admin-origin@example.com');

        $response = $this->actingAs($admin)->postJson('/api/admin/users/provision', [
            'nama' => 'Siswa Baru',
            'email' => 'siswa.baru@example.com',
            'password' => 'Str0ng!Passw0rd',
            'role' => 'siswa',
            'nis' => '10001',
            'kelas' => 'X-1',
            'must_change_password' => true,
            'created_via' => 'admin_created',
        ]);

        $response->assertCreated();
        $profileId = (string) $response->json('data.profile.id');

        $this->assertDatabaseHas('users', [
            'id' => $profileId,
            'name' => 'Siswa Baru',
            'email' => 'siswa.baru@example.com',
        ]);
        $this->assertDatabaseHas('profiles', [
            'id' => $profileId,
            'tenant_id' => $tenantId,
            'nama' => 'Siswa Baru',
            'email' => 'siswa.baru@example.com',
            'role' => 'siswa',
            'created_via' => 'admin_created',
            'created_by' => $admin->id,
        ]);
    }

    public function test_import_provision_updates_existing_student_and_syncs_user_identity(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Sekolah', 'admin-import-origin@example.com');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'Nama Lama', 'nama.lama@example.com', [
            'nis' => '20001',
            'created_via' => null,
            'created_by' => null,
        ]);

        $response = $this->actingAs($admin)->postJson('/api/admin/users/provision', [
            'id' => $student->id,
            'nama' => 'Nama Import',
            'email' => 'nama.import@example.com',
            'password' => '01012010',
            'role' => 'siswa',
            'nis' => '20001',
            'kelas' => 'XI-2',
            'sync_existing' => true,
            'created_via' => 'import',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.status', 'updated');

        $this->assertDatabaseHas('users', [
            'id' => $student->id,
            'name' => 'Nama Import',
            'email' => 'nama.import@example.com',
        ]);
        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'nama' => 'Nama Import',
            'email' => 'nama.import@example.com',
            'kelas' => 'XI-2',
            'created_via' => 'import',
            'created_by' => $admin->id,
        ]);
    }

    public function test_import_provision_matches_identifier_case_insensitively(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Sekolah', 'admin-import-case@example.com');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'Guru Lama', 'guru.lama@example.com', [
            'nis' => 'gp001',
            'created_via' => 'import',
        ]);

        $response = $this->actingAs($admin)->postJson('/api/admin/users/provision', [
            'nama' => 'Guru Baru',
            'email' => 'guru.baru@example.com',
            'password' => '01011990',
            'role' => 'guru',
            'nis' => ' GP001 ',
            'sync_existing' => true,
            'created_via' => 'import',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.status', 'updated');

        $this->assertDatabaseHas('profiles', [
            'id' => $teacher->id,
            'tenant_id' => $tenantId,
            'nama' => 'Guru Baru',
            'email' => 'guru.baru@example.com',
            'nis' => 'GP001',
        ]);
    }

    public function test_admin_manual_provision_defaults_to_admin_created_origin(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Sekolah', 'admin-manual-origin@example.com');

        $response = $this
            ->actingAs($admin)
            ->postJson('/api/admin/users/provision', [
                'nama' => 'Siswa Manual',
                'email' => 'siswa.manual@example.com',
                'password' => 'Str0ng!Passw0rd',
                'role' => 'siswa',
                'nis' => '10002',
                'kelas' => 'X-2',
            ]);

        $response->assertCreated();

        $this->assertDatabaseHas('profiles', [
            'tenant_id' => $tenantId,
            'nama' => 'Siswa Manual',
            'email' => 'siswa.manual@example.com',
            'created_via' => 'admin_created',
            'created_by' => $admin->id,
        ]);
    }

    public function test_student_additional_info_age_is_calculated_from_birth_date(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Sekolah', 'admin-age@example.com');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'Siswa Umur', 'siswa-umur@example.com', [
            'usia' => 99,
        ]);
        $birthDate = '2010-04-10';
        $expectedAge = Carbon::parse($birthDate)->age;

        $response = $this->actingAs($admin)->patchJson("/api/students/{$student->id}/additional-info", [
            'nama' => 'Siswa Umur',
            'jk' => 'P',
            'usia' => 99,
            'tanggal_lahir' => $birthDate,
            'agama' => 'Katolik',
            'alamat' => 'Jl. Flamboyan',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.profile.usia', $expectedAge);

        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'tanggal_lahir' => $birthDate,
            'usia' => $expectedAge,
        ]);
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');
    }

    private function createUserWithProfile(
        string $tenantId,
        string $role,
        string $name,
        string $email,
        array $profileOverrides = []
    ): User {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('Str0ng!Passw0rd'),
        ]);

        DB::table('profiles')->insert(array_merge([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $name,
            'role' => $role,
            'status' => 'active',
            'created_via' => 'admin_created',
            'created_at' => now(),
            'updated_at' => now(),
        ], $profileOverrides));

        return $user;
    }
}
