<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicRolloverExceptionPolicyTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_manage_rollover_exceptions_through_db_api(): void
    {
        $tenantId = $this->defaultTenantId();
        [$admin] = $this->createUserWithProfile($tenantId, 'admin', 'Admin');
        [$student] = $this->createUserWithProfile($tenantId, 'siswa', 'X A MIPA');
        Sanctum::actingAs($admin);

        $select = $this->postJson('/api/db', [
            'table' => 'academic_rollover_exceptions',
            'action' => 'select',
            'columns' => 'student_id,reason',
            'filters' => [
                'eq' => [
                    'source_tahun_ajaran' => '2025/2026',
                    'target_tahun_ajaran' => '2026/2027',
                ],
                'is' => ['resolved_at' => null],
            ],
        ]);

        $select->assertOk()->assertJsonPath('data', []);

        $insert = $this->postJson('/api/db', [
            'table' => 'academic_rollover_exceptions',
            'action' => 'insert',
            'payload' => [[
                'id' => (string) Str::uuid(),
                'student_id' => $student->id,
                'source_tahun_ajaran' => '2025/2026',
                'target_tahun_ajaran' => '2026/2027',
                'reason' => 'Tidak naik kelas',
            ]],
        ]);

        $insert->assertOk();
        $this->assertDatabaseHas('academic_rollover_exceptions', [
            'tenant_id' => $tenantId,
            'student_id' => $student->id,
            'created_by' => $admin->id,
            'source_tahun_ajaran' => '2025/2026',
            'target_tahun_ajaran' => '2026/2027',
        ]);

        $delete = $this->postJson('/api/db', [
            'table' => 'academic_rollover_exceptions',
            'action' => 'delete',
            'filters' => [
                'eq' => [
                    'source_tahun_ajaran' => '2025/2026',
                    'target_tahun_ajaran' => '2026/2027',
                ],
                'is' => ['resolved_at' => null],
            ],
        ]);

        $delete->assertOk()->assertJsonPath('data', 1);
    }

    public function test_rollover_exception_rejects_student_from_other_tenant(): void
    {
        $tenantId = $this->defaultTenantId();
        $otherTenantId = $this->createTenant('tenant-lain');
        [$admin] = $this->createUserWithProfile($tenantId, 'admin', 'Admin');
        [$otherStudent] = $this->createUserWithProfile($otherTenantId, 'siswa', 'X A MIPA');
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/db', [
            'table' => 'academic_rollover_exceptions',
            'action' => 'insert',
            'payload' => [[
                'id' => (string) Str::uuid(),
                'student_id' => $otherStudent->id,
                'source_tahun_ajaran' => '2025/2026',
                'target_tahun_ajaran' => '2026/2027',
                'reason' => 'Tidak naik kelas',
            ]],
        ]);

        $response
            ->assertStatus(422)
            ->assertJsonPath('message', 'Siswa pengecualian harus siswa aktif di sekolah ini');
    }

    public function test_non_admin_cannot_read_rollover_exceptions(): void
    {
        $tenantId = $this->defaultTenantId();
        [$student] = $this->createUserWithProfile($tenantId, 'siswa', 'X A MIPA');
        Sanctum::actingAs($student);

        $response = $this->postJson('/api/db', [
            'table' => 'academic_rollover_exceptions',
            'action' => 'select',
            'columns' => 'student_id,reason',
        ]);

        $response->assertStatus(403);
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createTenant(string $slug): string
    {
        $tenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $tenantId,
            'name' => Str::title(str_replace('-', ' ', $slug)),
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role, string $kelas): array
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => Str::uuid().'@example.com',
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
