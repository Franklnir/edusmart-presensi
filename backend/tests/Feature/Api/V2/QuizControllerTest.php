<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class QuizControllerTest extends TestCase
{
    use RefreshDatabase;

    private User $guruUser;
    private Profile $guruProfile;
    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();
        
        config(['tenancy.allow_header_override' => true]);

        DB::table('tenants')->insert(['id' => 'tenant-1', 'slug' => 'testschool', 'name' => 'Test School']);
        $this->tenantId = 'tenant-1';

        $this->guruUser = User::factory()->create(['id' => (string) \Illuminate\Support\Str::uuid()]);
        DB::table('profiles')->insert([
            'id' => $this->guruUser->id,
            'tenant_id' => $this->tenantId,
            'nama' => 'Guru Test',
            'email' => $this->guruUser->email,
            'role' => 'guru',
        ]);
        $this->guruProfile = Profile::find($this->guruUser->id);
        
        DB::table('settings')->insert([
            'tenant_id' => $this->tenantId,
            'tahun_ajaran' => '2025/2026',
            'semester_aktif' => 'ganjil',
        ]);
    }

    public function test_can_list_quizzes()
    {
        DB::table('quizzes')->insert([
            [
                'id' => 'quiz-1',
                'tenant_id' => $this->tenantId,
                'nama' => 'Quiz 1',
                'kelas_id' => 'X-A',
                'mapel' => 'Matematika',
                'guru_id' => $this->guruUser->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        ]);

        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->getJson('/api/v2/quizzes');

        $response->assertStatus(200)
            ->assertJsonCount(1, 'data');
    }

    public function test_can_create_quiz()
    {
        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->postJson('/api/v2/quizzes', [
                'nama' => 'Quiz Fisika',
                'kelas_id' => 'X-A',
                'mapel' => 'Fisika',
                'duration_minutes' => 60,
                'is_active' => false
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.nama', 'Quiz Fisika');

        $this->assertDatabaseHas('quizzes', [
            'nama' => 'Quiz Fisika',
            'guru_id' => $this->guruUser->id
        ]);
    }
}
