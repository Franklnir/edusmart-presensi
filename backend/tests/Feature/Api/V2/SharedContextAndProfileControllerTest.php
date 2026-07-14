<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SharedContextAndProfileControllerTest extends TestCase
{
    use RefreshDatabase;

    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);
        $this->tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
    }

    public function test_shared_v2_endpoints_require_an_authenticated_tenant_member(): void
    {
        $this->withHeaders($this->tenantHeaders())->getJson('/api/v2/academic-context')->assertUnauthorized();
        $this->withHeaders($this->tenantHeaders())->getJson('/api/v2/profile')->assertUnauthorized();
    }

    public function test_academic_context_is_read_from_current_tenant_only(): void
    {
        $user = $this->createUser('siswa');
        $otherTenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $otherTenantId,
            'slug' => 'tenant-lain',
            'name' => 'Tenant Lain',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->seedSettings($this->tenantId, '2026/2027', 'Ganjil');
        $this->seedSettings($otherTenantId, '2099/2100', 'Genap');

        Sanctum::actingAs($user);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/academic-context')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('meta.configured', true)
            ->assertJsonPath('data.tahun_ajaran', '2026/2027')
            ->assertJsonPath('data.semester_aktif', 'Ganjil')
            ->assertJsonMissing(['tahun_ajaran' => '2099/2100']);
    }

    public function test_current_profile_update_is_self_scoped_idempotent_and_audited_without_values(): void
    {
        $student = $this->createUser('siswa');
        Sanctum::actingAs($student);

        $payload = [
            'jk' => 'p',
            'agama' => 'Islam',
            'no_hp_siswa' => '081234567890',
            'no_hp_wali' => '081298765432',
            'tenant_id' => (string) Str::uuid(),
            'role' => 'admin',
        ];

        $response = $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'profile-update-key']))
            ->patchJson('/api/v2/profile', $payload);

        $response->assertOk()
            ->assertJsonPath('data.id', $student->id)
            ->assertJsonPath('data.jk', 'P')
            ->assertJsonPath('data.no_hp_siswa', '081234567890')
            ->assertJsonPath('data.role', 'siswa')
            ->assertJsonMissingPath('data.photo_path')
            ->assertJsonMissingPath('data.photo_url');

        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $this->tenantId,
            'role' => 'siswa',
            'jk' => 'P',
        ]);
        $this->assertDatabaseHas('audit_log', [
            'tenant_id' => $this->tenantId,
            'table_name' => 'profiles',
            'record_id' => $student->id,
            'action' => 'UPDATE',
        ]);
        $this->assertDatabaseMissing('audit_log', ['new_data' => json_encode($payload)]);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'profile-update-key']))
            ->patchJson('/api/v2/profile', $payload)
            ->assertOk()
            ->assertHeader('Idempotency-Replayed', 'true');
    }

    public function test_student_cannot_change_identity_fields_through_current_profile_resource(): void
    {
        $student = $this->createUser('siswa');
        Sanctum::actingAs($student);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'profile-identity-key']))
            ->patchJson('/api/v2/profile', ['nama' => 'Nama Pengganti'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.profile.0', 'Field profil ini tidak dapat diubah dari akun Anda.');

        $this->assertDatabaseHas('profiles', ['id' => $student->id, 'nama' => 'Pengguna Siswa']);
    }

    private function createUser(string $role): User
    {
        $user = User::factory()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Pengguna '.ucfirst($role),
        ]);
        Profile::create([
            'id' => $user->id,
            'tenant_id' => $this->tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }

    private function seedSettings(string $tenantId, string $year, string $semester): void
    {
        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
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

    /** @param array<string, string> $headers */
    private function tenantHeaders(array $headers = []): array
    {
        return array_merge(['X-Tenant' => 'default'], $headers);
    }
}
