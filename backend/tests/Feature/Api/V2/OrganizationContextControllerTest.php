<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OrganizationContextControllerTest extends TestCase
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

    public function test_context_requires_authentication(): void
    {
        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/organizations')
            ->assertUnauthorized();
    }

    public function test_context_is_tenant_scoped_and_returns_only_shell_data(): void
    {
        $guru = $this->createUser('tenant-a', 'guru');
        $this->seedSettings('tenant-a', '2026/2027', 'Ganjil', 'SMA A');
        $this->seedSettings('tenant-b', '2099/2100', 'Genap', 'SMA B');

        DB::table('admin_feature_permissions')->insert([
            [
                'id' => (string) Str::uuid(),
                'tenant_id' => 'tenant-a',
                'target_type' => 'teacher',
                'target_teacher_id' => $guru->id,
                'target_label' => 'Guru A',
                'target_class_id' => '',
                'feature_key' => 'reports.view',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => (string) Str::uuid(),
                'tenant_id' => 'tenant-b',
                'target_type' => 'teacher',
                'target_teacher_id' => $guru->id,
                'target_label' => 'Guru B',
                'target_class_id' => '',
                'feature_key' => 'students.manage',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        Sanctum::actingAs($guru);

        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/organizations')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.organization.name', 'SMA A')
            ->assertJsonPath('data.academic_context.tahun_ajaran', '2026/2027')
            ->assertJsonPath('data.academic_context.semester', 'Ganjil')
            ->assertJsonPath('data.delegated_features.0', 'reports.view')
            ->assertJsonMissing(['feature_key' => 'students.manage'])
            ->assertJsonMissingPath('data.organization.tenant_id')
            ->assertJsonMissingPath('data.delegated_features.1');
    }

    private function createUser(string $tenantId, string $role): User
    {
        $user = User::factory()->create(['id' => (string) Str::uuid()]);
        Profile::create([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'role' => $role,
            'email' => $user->email,
            'nama' => "Pengguna {$role}",
            'status' => 'active',
        ]);

        return $user;
    }

    private function seedSettings(string $tenantId, string $year, string $semester, string $name): void
    {
        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => $name,
            'tahun_ajaran' => $year,
            'semester_aktif' => $semester,
            'periode_ganjil_mulai' => '2026-07-01',
            'periode_ganjil_selesai' => '2026-12-31',
            'periode_genap_mulai' => '2027-01-01',
            'periode_genap_selesai' => '2027-06-30',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, string> */
    private function tenantHeaders(string $tenantSlug): array
    {
        return ['X-Tenant' => $tenantSlug];
    }
}
