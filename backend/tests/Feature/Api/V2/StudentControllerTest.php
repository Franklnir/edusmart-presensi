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
            ]);

        $response->assertOk();
        $this->assertDatabaseHas('profiles', ['id' => $student->id, 'nama' => 'Updated Name', 'email' => 'updated@example.com']);
        $this->assertDatabaseHas('users', ['id' => $student->id, 'name' => 'Updated Name', 'email' => 'updated@example.com']);
    }

    public function test_admin_can_delete_student(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $student = $this->createUserWithRole('tenant-a', 'siswa');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->deleteJson('/api/v2/students/'.$student->id);

        $response->assertOk();
        $this->assertDatabaseMissing('profiles', ['id' => $student->id]);
        $this->assertDatabaseMissing('users', ['id' => $student->id]);
    }

    public function test_student_cannot_mutate_student(): void
    {
        $student = $this->createUserWithRole('tenant-a', 'siswa');

        Sanctum::actingAs($student);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/students', ['nama' => 'x', 'email' => 'x@x.com'])->assertStatus(403);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->deleteJson('/api/v2/students/'.$student->id)->assertStatus(403);
    }
}
