<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class StudentImportBatchTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_can_import_students_in_backend_batch(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Import', 'admin-import-batch@example.com');

        DB::table('kelas')->insert([
            'id' => 'X-1',
            'tenant_id' => $tenantId,
            'nama' => 'X 1',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($admin)->postJson('/api/admin/students/import', [
            'source' => 'file',
            'file_name' => 'siswa.xlsx',
            'rows' => [
                [
                    '__rowNum' => 2,
                    'nama' => 'Siswa Import',
                    'nis' => 'SIS-001',
                    'email' => 'siswa.import@example.com',
                    'kelas' => 'X-1',
                    'jk' => 'L',
                    'tanggal_lahir' => '2010-01-02',
                    'status' => 'active',
                ],
            ],
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.summary.created', 1);
        $response->assertJsonPath('data.summary.updated', 0);
        $response->assertJsonPath('data.summary.failed', 0);

        $historyId = (string) $response->json('data.history_id');
        $this->assertNotSame('', $historyId);

        $profileId = (string) DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('nis', 'SIS-001')
            ->value('id');

        $this->assertNotSame('', $profileId);
        $this->assertDatabaseHas('users', [
            'id' => $profileId,
            'name' => 'Siswa Import',
            'email' => 'siswa.import@example.com',
        ]);
        $this->assertDatabaseHas('profiles', [
            'id' => $profileId,
            'tenant_id' => $tenantId,
            'nama' => 'Siswa Import',
            'email' => 'siswa.import@example.com',
            'role' => 'siswa',
            'kelas' => 'X-1',
            'nis' => 'SIS-001',
            'created_via' => 'import',
            'created_by' => $admin->id,
        ]);
        $this->assertDatabaseHas('import_siswa_histories', [
            'id' => $historyId,
            'tenant_id' => $tenantId,
            'admin_id' => $admin->id,
            'created_rows' => 1,
            'failed_rows' => 0,
        ]);
        $this->assertDatabaseHas('import_siswa_history_items', [
            'history_id' => $historyId,
            'tenant_id' => $tenantId,
            'profile_id' => $profileId,
            'status' => 'created',
            'created_user' => true,
            'nis' => 'SIS-001',
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
