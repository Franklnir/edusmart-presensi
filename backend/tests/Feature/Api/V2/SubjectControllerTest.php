<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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
        
        DB::table('tenants')->insert(['id' => 'tenant-1', 'slug' => 'testschool', 'name' => 'Test School']);
        $this->tenantId = 'tenant-1';

        $this->adminUser = User::factory()->create(['id' => (string) \Illuminate\Support\Str::uuid()]);
        $this->adminProfile = Profile::create([
            'id' => $this->adminUser->id,
            'tenant_id' => $this->tenantId,
            'nama' => 'Admin Test',
            'email' => $this->adminUser->email,
            'role' => 'admin',
        ]);
        
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
            ['id' => 'bahasa-indonesia', 'nama' => 'Bahasa Indonesia']
        ]);

        $response = $this->actingAs($this->adminUser)
            ->withHeader('X-Tenant', 'testschool')
            ->getJson('/api/v2/subjects');

        dump($response->getContent()); $response->assertStatus(200)
            ->assertJsonCount(2, 'data');
    }

    public function test_can_create_subject()
    {
        $response = $this->actingAs($this->adminUser)
            ->withHeader('X-Tenant', 'testschool')
            ->postJson('/api/v2/subjects', [
                'nama' => 'Fisika Dasar'
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.nama', 'Fisika Dasar');

        $this->assertDatabaseHas('mata_pelajaran', [
            'nama' => 'Fisika Dasar'
        ]);
    }
}
