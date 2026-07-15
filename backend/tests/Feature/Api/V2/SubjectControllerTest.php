<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class SubjectControllerTest extends TestCase
{
    use RefreshDatabase;

    private User $adminUser;

    private Profile $adminProfile;

    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');

        $this->adminUser = User::factory()->create(['id' => (string) Str::uuid()]);
        DB::table('profiles')->insert([
            'id' => $this->adminUser->id,
            'tenant_id' => $this->tenantId,
            'nama' => 'Admin Test',
            'email' => $this->adminUser->email,
            'role' => 'admin',
        ]);
        $this->adminProfile = Profile::find($this->adminUser->id);

        // Setup academic setting
        DB::table('settings')->insert([
            'tenant_id' => $this->tenantId,
            'tahun_ajaran' => '2025/2026',
            'semester_aktif' => 'ganjil',
        ]);
    }

    public function test_can_list_subjects()
    {
        DB::table('mata_pelajaran')->insert([
            ['id' => 'matematika', 'nama' => 'Matematika'],
            ['id' => 'bahasa-indonesia', 'nama' => 'Bahasa Indonesia'],
        ]);

        $response = $this->actingAs($this->adminUser)
            ->withHeader('X-Tenant', 'default')
            ->getJson('/api/v2/subjects');

        $response->assertStatus(200)
            ->assertJsonCount(2, 'data');
    }

    public function test_can_create_subject()
    {
        $response = $this->actingAs($this->adminUser)
            ->withHeader('X-Tenant', 'default')
            ->postJson('/api/v2/subjects', [
                'nama' => 'Fisika Dasar',
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.nama', 'Fisika Dasar');

        $this->assertDatabaseHas('mata_pelajaran', [
            'nama' => 'Fisika Dasar',
        ]);
    }
}
