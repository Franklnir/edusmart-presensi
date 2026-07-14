<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StudentControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);

        DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-a', 'slug' => 'tenant-a', 'name' => 'Tenant A'],
            ['id' => 'tenant-b', 'slug' => 'tenant-b', 'name' => 'Tenant B'],
        ]);
    }

    private function createUserWithRole(string $tenantId, string $role): User
    {
        $user = User::factory()->create(['id' => (string) Str::uuid()]);
        Profile::create([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'role' => $role,
            'email' => "{$role}@example.com",
            'nama' => "Test {$role}",
        ]);

        return $user;
    }

    private function grantTeacherClass(User $teacher, string $tenantId, string $classId, string $subject = 'Matematika'): void
    {
        DB::table('kelas')->insertOrIgnore([
            'id' => $classId,
            'nama' => $classId,
            'tenant_id' => $tenantId,
        ]);
        DB::table('jadwal')->insert([
            'id' => 'schedule-'.Str::uuid(),
            'kelas_id' => $classId,
            'hari' => 'Senin',
            'mapel' => $subject,
            'guru_id' => $teacher->id,
            'guru_nama' => 'Teacher',
            'jam_mulai' => '08:00',
            'jam_selesai' => '09:00',
            'tenant_id' => $tenantId,
        ]);
    }

    public function test_guest_cannot_access_students(): void
    {
        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/students');
        $response->assertStatus(401);
    }

    public function test_admin_can_view_own_tenant_students_with_pagination(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');

        // Add 2 students for tenant-a
        $this->createUserWithRole('tenant-a', 'siswa');
        $this->createUserWithRole('tenant-a', 'siswa');

        // Add 1 student for tenant-b
        $this->createUserWithRole('tenant-b', 'siswa');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/students?per_page=5');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['data', 'meta', 'links', 'request_id', 'message'])
            ->assertJsonCount(2, 'data'); // Should only see 2 students from tenant-a
    }

    public function test_admin_cannot_view_other_tenant_student(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $studentB = $this->createUserWithRole('tenant-b', 'siswa');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/students/'.$studentB->id);

        $response->assertStatus(404);
    }

    public function test_admin_can_create_student_for_own_tenant(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/students', [
                'nama' => 'New Student',
                'email' => 'newstudent@example.com',
                'nis' => '123456',
                'idempotency_key' => (string) Str::uuid(),
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.nama', 'New Student');

        $this->assertDatabaseHas('profiles', [
            'nama' => 'New Student',
            'email' => 'newstudent@example.com',
            'tenant_id' => 'tenant-a',
            'role' => 'siswa',
        ]);

        $this->assertDatabaseHas('users', [
            'email' => 'newstudent@example.com',
        ]);
    }

    public function test_admin_can_update_own_student(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $student = $this->createUserWithRole('tenant-a', 'siswa');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->putJson('/api/v2/students/'.$student->id, [
                'nama' => 'Updated Name',
                'email' => 'updated@example.com',
                'idempotency_key' => (string) Str::uuid(),
            ]);

        $response->assertOk();
        $this->assertDatabaseHas('profiles', ['id' => $student->id, 'nama' => 'Updated Name', 'email' => 'updated@example.com']);
        $this->assertDatabaseHas('users', ['id' => $student->id, 'name' => 'Updated Name', 'email' => 'updated@example.com']);
    }

    public function test_admin_can_deactivate_student(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $student = $this->createUserWithRole('tenant-a', 'siswa');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->patchJson('/api/v2/students/'.$student->id.'/deactivate', [
                'reason' => 'nonaktif',
                'idempotency_key' => (string) Str::uuid(),
            ]);

        $response->assertOk();
        $this->assertDatabaseHas('profiles', ['id' => $student->id, 'status' => 'nonaktif']);
        $this->assertDatabaseHas('users', ['id' => $student->id]);
    }

    public function test_student_cannot_mutate_student(): void
    {
        $student = $this->createUserWithRole('tenant-a', 'siswa');

        Sanctum::actingAs($student);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/students', [
                'nama' => 'x',
                'email' => 'x@x.com',
                'idempotency_key' => (string) Str::uuid(),
            ])->assertStatus(403);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->patchJson('/api/v2/students/'.$student->id.'/deactivate')->assertStatus(403);
    }

    public function test_guru_can_only_list_and_view_students_in_assigned_classes(): void
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        $studentA = $this->createUserWithRole('tenant-a', 'siswa');
        $studentA->profile->update(['kelas' => '10A', 'nis' => 'PRIVATE-A']);
        $studentB = $this->createUserWithRole('tenant-a', 'siswa');
        $studentB->profile->update(['kelas' => '10B', 'nis' => 'PRIVATE-B']);
        $this->grantTeacherClass($guru, 'tenant-a', '10A');

        Sanctum::actingAs($guru);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/students')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $studentA->id)
            ->assertJsonMissingPath('data.0.email')
            ->assertJsonMissingPath('data.0.nis');

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/students/'.$studentB->id)
            ->assertForbidden();
    }

    public function test_student_cannot_list_or_view_another_students_private_profile(): void
    {
        $student = $this->createUserWithRole('tenant-a', 'siswa');
        $other = $this->createUserWithRole('tenant-a', 'siswa');
        Sanctum::actingAs($student);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/students')
            ->assertForbidden();
        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/students/'.$other->id)
            ->assertForbidden();
    }

    public function test_create_ignores_tenant_and_role_from_payload_and_rejects_duplicate_identifiers(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Sanctum::actingAs($admin);

        $payload = [
            'nama' => 'Scoped Student',
            'email' => 'scoped@example.com',
            'nis' => 'NIS-UNIQUE',
            'tenant_id' => 'tenant-b',
            'role' => 'admin',
            'idempotency_key' => (string) Str::uuid(),
        ];
        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/students', $payload)
            ->assertCreated();

        $this->assertDatabaseHas('profiles', [
            'email' => 'scoped@example.com',
            'tenant_id' => 'tenant-a',
            'role' => 'siswa',
        ]);

        $payload['email'] = 'different@example.com';
        $payload['idempotency_key'] = (string) Str::uuid();
        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/students', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('nis');
    }
}
