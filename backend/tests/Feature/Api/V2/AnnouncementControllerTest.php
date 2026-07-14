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

class AnnouncementControllerTest extends TestCase
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

    public function test_index_is_tenant_and_role_scoped(): void
    {
        $admin = $this->createUser('tenant-a', 'admin');
        $guru = $this->createUser('tenant-a', 'guru');

        $this->insertAnnouncement('tenant-a', 'Semua A', 'semua');
        $this->insertAnnouncement('tenant-a', 'Guru A', 'guru');
        $this->insertAnnouncement('tenant-a', 'Siswa A', 'siswa');
        $this->insertAnnouncement('tenant-b', 'Semua B', 'semua');

        Sanctum::actingAs($admin);
        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/announcements')
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonMissing(['judul' => 'Semua B']);

        Sanctum::actingAs($guru);
        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/announcements')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonMissing(['judul' => 'Siswa A']);
    }

    public function test_admin_announcement_create_is_idempotent(): void
    {
        $admin = $this->createUser('tenant-a', 'admin');
        Sanctum::actingAs($admin);

        $headers = array_merge($this->tenantHeaders('tenant-a'), [
            'Idempotency-Key' => 'announcement-create-1',
        ]);
        $payload = [
            'judul' => 'Rapat Guru',
            'keterangan' => 'Besok pukul delapan.',
            'target' => 'guru',
        ];

        $this->withHeaders($headers)
            ->postJson('/api/v2/announcements', $payload)
            ->assertCreated()
            ->assertJsonPath('data.judul', 'Rapat Guru');

        $this->withHeaders($headers)
            ->postJson('/api/v2/announcements', $payload)
            ->assertCreated()
            ->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame(1, DB::table('pengumuman')
            ->where('tenant_id', 'tenant-a')
            ->where('judul', 'Rapat Guru')
            ->count());
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

    private function insertAnnouncement(string $tenantId, string $title, string $target): void
    {
        DB::table('pengumuman')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'judul' => $title,
            'keterangan' => 'Keterangan',
            'target' => $target,
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
