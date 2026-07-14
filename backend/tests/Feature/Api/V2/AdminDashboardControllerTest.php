<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminDashboardControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);
        Cache::flush();

        DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-a', 'slug' => 'tenant-a', 'name' => 'Tenant A'],
            ['id' => 'tenant-b', 'slug' => 'tenant-b', 'name' => 'Tenant B'],
        ]);
    }

    public function test_dashboard_requires_an_authenticated_admin(): void
    {
        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/dashboard/admin')
            ->assertUnauthorized();

        $student = $this->createUser('tenant-a', 'siswa');
        Sanctum::actingAs($student);

        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/dashboard/admin')
            ->assertForbidden();
    }

    public function test_dashboard_is_tenant_scoped_and_only_exposes_its_compact_contract(): void
    {
        $admin = $this->createUser('tenant-a', 'admin');
        $this->createUser('tenant-a', 'guru');
        $this->createUser('tenant-a', 'siswa');
        $this->createUser('tenant-b', 'guru');
        $this->createUser('tenant-b', 'siswa');
        $this->seedSettings('tenant-a', '2026/2027', 'Ganjil', 5);
        $this->seedSettings('tenant-b', '2099/2100', 'Genap', 99);
        $this->seedAnnouncement('tenant-a', 'Pengumuman Tenant A');
        $this->seedAnnouncement('tenant-b', 'Pengumuman Tenant B');

        Sanctum::actingAs($admin);

        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/dashboard/admin?tahun_ajaran=2026-2027')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.settings.tahun_ajaran', '2026/2027')
            ->assertJsonPath('data.settings.max_ekskul_per_siswa', 5)
            ->assertJsonPath('data.academic_period.tahun_ajaran', '2026/2027')
            ->assertJsonPath('data.summary.guru', 1)
            ->assertJsonPath('data.summary.siswa', 1)
            ->assertJsonPath('data.announcements.0.judul', 'Pengumuman Tenant A')
            ->assertJsonMissing(['judul' => 'Pengumuman Tenant B'])
            ->assertJsonMissingPath('data.settings.tenant_id')
            ->assertJsonMissingPath('data.people')
            ->assertJsonMissingPath('data.guru');
    }

    public function test_dashboard_rejects_an_invalid_academic_year_filter(): void
    {
        $admin = $this->createUser('tenant-a', 'admin');
        Sanctum::actingAs($admin);

        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/dashboard/admin?tahun_ajaran=not-a-period')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['tahun_ajaran']);
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

    private function seedSettings(string $tenantId, string $year, string $semester, int $maxEskul): void
    {
        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'tahun_ajaran' => $year,
            'semester_aktif' => $semester,
            'periode_ganjil_mulai' => '2026-07-01',
            'periode_ganjil_selesai' => '2026-12-31',
            'periode_genap_mulai' => '2027-01-01',
            'periode_genap_selesai' => '2027-06-30',
            'max_ekskul_per_siswa' => $maxEskul,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedAnnouncement(string $tenantId, string $title): void
    {
        DB::table('pengumuman')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'judul' => $title,
            'keterangan' => 'Ringkasan pengumuman',
            'target' => 'semua',
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
