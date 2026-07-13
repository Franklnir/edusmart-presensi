<?php

namespace Tests\Feature\Api\V2;

use App\Models\Kelas;
use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ClassControllerTest extends TestCase
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

    public function test_guest_cannot_access_classes(): void
    {
        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/classes');
        $response->assertStatus(401);
    }

    public function test_admin_can_view_own_tenant_classes_with_pagination_and_request_id(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');

        Kelas::create(['id' => 'class-1', 'nama' => 'Class 1', 'tenant_id' => 'tenant-a']);
        Kelas::create(['id' => 'class-2', 'nama' => 'Class 2', 'tenant_id' => 'tenant-b']);

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/classes?per_page=5&sort=nama&order=desc');

        $response->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonStructure(['data', 'meta', 'links', 'request_id', 'message'])
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', 'class-1');
    }

    public function test_admin_cannot_view_other_tenant_class(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Kelas::create(['id' => 'class-b', 'nama' => 'Class B', 'tenant_id' => 'tenant-b']);

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->getJson('/api/v2/classes/class-b');

        $response->assertStatus(404);
    }

    public function test_admin_can_create_class_for_own_tenant(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/classes', [
                'nama' => 'New Class',
                'grade' => 'X',
                'suffix' => 'A',
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.nama', 'New Class')
            ->assertJsonStructure(['request_id']);

        $this->assertDatabaseHas('kelas', [
            'nama' => 'New Class',
            'tenant_id' => 'tenant-a',
        ]);
    }

    public function test_tenant_id_in_payload_cannot_override_server_context(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/classes', [
                'nama' => 'Hacked Class',
                'tenant_id' => 'tenant-b', // Attempt to inject
            ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('kelas', [
            'nama' => 'Hacked Class',
            'tenant_id' => 'tenant-a',
        ]);
    }

    public function test_validation_error_returns_422(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/classes', []); // Missing required 'nama'

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['nama']);
    }

    public function test_admin_can_update_own_class(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Kelas::create(['id' => 'class-1', 'nama' => 'Old Name', 'tenant_id' => 'tenant-a']);

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->putJson('/api/v2/classes/class-1', [
                'nama' => 'Updated Name',
            ]);

        $response->assertOk();
        $this->assertDatabaseHas('kelas', ['id' => 'class-1', 'nama' => 'Updated Name']);
    }

    public function test_admin_cannot_update_other_tenant_class(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Kelas::create(['id' => 'class-b', 'nama' => 'Class B', 'tenant_id' => 'tenant-b']);

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->putJson('/api/v2/classes/class-b', [
                'nama' => 'Hacked Name',
            ]);

        $response->assertStatus(404);
        $this->assertDatabaseHas('kelas', ['id' => 'class-b', 'nama' => 'Class B']);
    }

    public function test_admin_can_delete_empty_class(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        Kelas::create(['id' => 'class-empty', 'nama' => 'Empty', 'tenant_id' => 'tenant-a']);

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->deleteJson('/api/v2/classes/class-empty');

        $response->assertOk()
            ->assertJsonPath('success', true);
        $this->assertDatabaseMissing('kelas', ['id' => 'class-empty']);
    }

    public function test_class_with_students_returns_409_conflict(): void
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $student = $this->createUserWithRole('tenant-a', 'siswa');

        Kelas::create(['id' => 'class-active', 'nama' => 'Active', 'tenant_id' => 'tenant-a']);

        // Link student to class
        DB::table('profiles')->where('id', $student->id)->update(['kelas' => 'class-active']);

        Sanctum::actingAs($admin);

        $response = $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->deleteJson('/api/v2/classes/class-active');

        $response->assertStatus(409)
            ->assertJsonPath('code', 'CLASS_NOT_EMPTY');

        $this->assertDatabaseHas('kelas', ['id' => 'class-active']);
    }

    public function test_student_cannot_mutate_class(): void
    {
        $student = $this->createUserWithRole('tenant-a', 'siswa');
        Kelas::create(['id' => 'class-1', 'nama' => 'Class 1', 'tenant_id' => 'tenant-a']);

        Sanctum::actingAs($student);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->postJson('/api/v2/classes', ['nama' => 'x'])->assertStatus(403);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->putJson('/api/v2/classes/class-1', ['nama' => 'x'])->assertStatus(403);

        $this->withHeaders(['X-Tenant' => 'tenant-a'])
            ->deleteJson('/api/v2/classes/class-1')->assertStatus(403);
    }
}
