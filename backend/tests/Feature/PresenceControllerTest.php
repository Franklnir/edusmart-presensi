<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class PresenceControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_super_admin_without_profile_ping_does_not_write_presence(): void
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Admin',
            'email' => 'super-presence@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'created_at' => now(),
        ]);

        $response = $this->actingAs($user)->postJson('/api/presence/ping', [
            'device_id' => 'test-device',
            'activity' => true,
        ]);

        $response->assertOk();
        $response->assertJsonPath('data', 'ok');
        $this->assertDatabaseMissing('user_presence', [
            'user_id' => $user->id,
            'device_id' => 'test-device',
        ]);
    }

    public function test_profile_user_ping_writes_presence(): void
    {
        $tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Student Presence',
            'email' => 'student-presence@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => 'siswa',
            'kelas' => 'x-a',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($user)->postJson('/api/presence/ping', [
            'device_id' => 'student-device',
            'activity' => true,
        ]);

        $response->assertOk();
        $this->assertDatabaseHas('user_presence', [
            'tenant_id' => $tenantId,
            'user_id' => $user->id,
            'device_id' => 'student-device',
            'role' => 'siswa',
        ]);
    }

    public function test_admin_monitoring_is_scoped_to_current_tenant(): void
    {
        config(['tenancy.allow_header_override' => true]);

        $tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $otherTenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $otherTenantId,
            'name' => 'Sekolah Lain',
            'slug' => 'sekolah-lain',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $admin = $this->createProfileUser($tenantId, 'admin', 'admin-monitoring@example.com', 'Admin Monitoring');
        $student = $this->createProfileUser($tenantId, 'siswa', 'student-monitoring@example.com', 'Siswa Tenant Ini', 'x-a');
        $teacher = $this->createProfileUser($tenantId, 'guru', 'teacher-monitoring@example.com', 'Guru Tenant Ini');
        $otherStudent = $this->createProfileUser($otherTenantId, 'siswa', 'student-other-monitoring@example.com', 'Siswa Tenant Lain', 'x-b');

        DB::table('user_presence')->insert([
            [
                'tenant_id' => $tenantId,
                'user_id' => $student->id,
                'device_id' => 'student-device',
                'role' => 'siswa',
                'last_seen_at' => now(),
                'activity_count' => 2,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $tenantId,
                'user_id' => $teacher->id,
                'device_id' => 'teacher-device',
                'role' => 'guru',
                'last_seen_at' => now(),
                'activity_count' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $otherTenantId,
                'user_id' => $otherStudent->id,
                'device_id' => 'other-device',
                'role' => 'siswa',
                'last_seen_at' => now(),
                'activity_count' => 9,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this
            ->actingAs($admin)
            ->withHeader('X-Tenant', 'default')
            ->getJson('/api/admin/monitoring');

        $response->assertOk();
        $studentIds = collect($response->json('data.students'))->pluck('id');
        $teacherIds = collect($response->json('data.teachers'))->pluck('id');

        $this->assertTrue($studentIds->contains($student->id));
        $this->assertTrue($teacherIds->contains($teacher->id));
        $this->assertFalse($studentIds->contains($otherStudent->id));
    }

    private function createProfileUser(
        string $tenantId,
        string $role,
        string $email,
        string $name,
        string $kelas = ''
    ): User {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $name,
            'role' => $role,
            'kelas' => $kelas,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
