<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AcademicPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class DelegatedAdminAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    public function test_delegated_teacher_cannot_use_feature_header_as_general_admin(): void
    {
        $tenantId = $this->defaultTenantId();
        $teacher = $this->createUserWithProfile($tenantId, 'guru');

        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Aman',
            'scan_manual_enabled' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('admin_feature_permissions')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'target_type' => 'teacher',
            'target_teacher_id' => $teacher->id,
            'target_label' => 'Guru Delegated',
            'target_class_id' => '',
            'feature_key' => 'scan-kehadiran',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($teacher)
            ->withHeader('X-Admin-Feature', 'scan-kehadiran')
            ->postJson('/api/db', [
                'table' => 'settings',
                'action' => 'update',
                'filters' => [
                    'eq' => ['tenant_id' => $tenantId],
                ],
                'payload' => [
                    'nama_sekolah' => 'Diubah Guru',
                ],
            ])
            ->assertForbidden();

        $this->assertDatabaseHas('settings', [
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Aman',
        ]);

        $this->actingAs($teacher)
            ->withHeader('X-Admin-Feature', 'scan-kehadiran')
            ->postJson('/api/admin/feature-permissions', [
                'target_type' => 'teacher',
                'teacher_id' => $teacher->id,
                'features' => ['guru'],
            ])
            ->assertForbidden();
    }

    public function test_explicit_delegated_scan_access_still_works(): void
    {
        $tenantId = $this->defaultTenantId();
        $teacher = $this->createUserWithProfile($tenantId, 'guru');

        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Aman',
            'scan_manual_enabled' => false,
            'scan_always_active' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('admin_feature_permissions')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'target_type' => 'position',
            'target_teacher_id' => $teacher->id,
            'target_label' => 'Guru Piket',
            'target_class_id' => '',
            'feature_key' => 'scan-kehadiran',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($teacher)
            ->patchJson('/api/admin/scan-settings', [
                'scan_always_active' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.can_update_settings', true);

        $this->assertDatabaseHas('settings', [
            'tenant_id' => $tenantId,
            'scan_always_active' => true,
        ]);
    }

    public function test_delegated_scan_sub_permission_can_read_scan_pages_without_general_admin_access(): void
    {
        $tenantId = $this->defaultTenantId();
        $teacher = $this->createUserWithProfile($tenantId, 'guru');

        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Aman',
            'scan_manual_enabled' => false,
            'scan_always_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('admin_feature_permissions')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'target_type' => 'teacher',
            'target_teacher_id' => $teacher->id,
            'target_label' => 'Guru Live Scan',
            'target_class_id' => '',
            'feature_key' => 'scan-kehadiran-live',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($teacher)
            ->getJson('/api/admin/scan-settings')
            ->assertOk()
            ->assertJsonPath('data.can_update_settings', false);

        $this->actingAs($teacher)
            ->getJson('/api/admin/scan-session-summary')
            ->assertOk();

        $this->actingAs($teacher)
            ->patchJson('/api/admin/scan-settings', [
                'scan_always_active' => false,
            ])
            ->assertForbidden();
    }

    public function test_homeroom_scan_access_uses_active_academic_year_without_semester_lock(): void
    {
        $tenantId = $this->defaultTenantId();
        $teacher = $this->createUserWithProfile($tenantId, 'guru');

        DB::table('settings')->where('tenant_id', $tenantId)->delete();
        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Aman',
            'tahun_ajaran' => '2026/2027',
            'semester_aktif' => AcademicPeriod::SEMESTER_GENAP,
            'scan_manual_enabled' => false,
            'scan_always_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('kelas')->updateOrInsert(
            ['id' => 'X-1'],
            [
                'nama' => 'X-1',
                'grade' => 'X',
                'suffix' => '1',
                'tenant_id' => $tenantId,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'kelas_id' => 'X-1',
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'Guru Tahun Lalu',
            'tahun_ajaran' => '2025/2026',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($teacher)
            ->getJson('/api/admin/scan-settings')
            ->assertForbidden();

        DB::table('kelas_struktur')
            ->where('tenant_id', $tenantId)
            ->where('kelas_id', 'X-1')
            ->update([
                'wali_guru_nama' => 'Guru Tahun Ini',
                'tahun_ajaran' => '2026/2027',
                'semester' => AcademicPeriod::SEMESTER_GANJIL,
                'updated_at' => now(),
            ]);

        $this->actingAs($teacher)
            ->getJson('/api/admin/scan-settings')
            ->assertOk();
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => $role.'_'.Str::random(8).'@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => 'X-1',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
