<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TeacherControllerTest extends TestCase
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
            'email' => "{$user->id}@example.com",
            'nama' => "Test {$role}",
        ]);

        return $user;
    }

    public function test_guest_cannot_access_teachers(): void
    {
        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/teachers');
        $response->assertStatus(401);
    }

    public function test_admin_can_view_own_tenant_teachers(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');

        $this->createUserWithRole('tenant-a', 'guru');
        $this->createUserWithRole('tenant-a', 'guru');
        $this->createUserWithRole('tenant-b', 'guru');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/teachers');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonCount(2, 'data');
    }

    public function test_admin_cannot_view_other_tenant_teacher(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $teacherB = $this->createUserWithRole('tenant-b', 'guru');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/teachers/'.$teacherB->id);

        $response->assertStatus(404);
    }

    public function test_admin_can_create_teacher_for_own_tenant(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/teachers', [
                'nama' => 'New Teacher',
                'email' => 'newteacher@example.com',
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.nama', 'New Teacher');

        $this->assertDatabaseHas('profiles', [
            'nama' => 'New Teacher',
            'email' => 'newteacher@example.com',
            'tenant_id' => 'tenant-a',
            'role' => 'guru',
        ]);

        $this->assertDatabaseHas('users', [
            'email' => 'newteacher@example.com',
        ]);
    }

    public function test_admin_can_update_own_teacher(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $teacher = $this->createUserWithRole('tenant-a', 'guru');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->putJson('/api/v2/teachers/'.$teacher->id, [
                'nama' => 'Updated Teacher Name',
                'email' => 'updated.teacher@example.com',
            ]);

        $response->assertOk();
        $this->assertDatabaseHas('profiles', ['id' => $teacher->id, 'nama' => 'Updated Teacher Name', 'email' => 'updated.teacher@example.com']);
        $this->assertDatabaseHas('users', ['id' => $teacher->id, 'name' => 'Updated Teacher Name', 'email' => 'updated.teacher@example.com']);
    }

    public function test_admin_can_delete_teacher(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $teacher = $this->createUserWithRole('tenant-a', 'guru');

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->deleteJson('/api/v2/teachers/'.$teacher->id);

        $response->assertOk();
        $this->assertDatabaseMissing('profiles', ['id' => $teacher->id]);
        $this->assertDatabaseMissing('users', ['id' => $teacher->id]);
    }

    public function test_teacher_can_view_themselves(): void
    {
        $teacher = $this->createUserWithRole('tenant-a', 'guru');

        Sanctum::actingAs($teacher);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson("/api/v2/teachers/{$teacher->id}");

        $response->assertOk()
            ->assertJsonPath('data.nama', 'Test guru');
    }
}
