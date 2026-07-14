<?php

namespace Tests\Feature\Api\V2;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ExtracurricularControllerTest extends TestCase
{
    use RefreshDatabase;

    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();
        
        $this->tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');

        DB::table('settings')->insert([
            'tenant_id' => $this->tenantId,
            'tahun_ajaran' => '2026/2027',
            'semester_aktif' => 'Ganjil',
            'max_ekskul_per_siswa' => 2,
        ]);
    }

    private function tenantHeaders(): array
    {
        return [
            'X-Tenant' => 'default',
            'Accept' => 'application/json',
        ];
    }

    private function createUser(string $role): User
    {
        $user = User::factory()->create(['id' => (string) Str::uuid()]);
        
        \App\Models\Profile::create([
            'id' => $user->id,
            'tenant_id' => $this->tenantId,
            'role' => $role,
            'email' => $user->email,
            'nama' => 'Test ' . $role,
            'status' => 'active',
        ]);

        return $user;
    }

    public function test_admin_can_create_extracurricular(): void
    {
        $admin = $this->createUser('admin');
        Sanctum::actingAs($admin);

        $payload = [
            'nama' => 'Pramuka',
            'keterangan' => 'Kegiatan Pramuka Wajib',
            'hari' => 'Sabtu',
            'jam_mulai' => '13:00',
            'jam_selesai' => '15:00',
            'registration_deadline_at' => now()->addDays(7)->toDateTimeString(),
        ];

        $response = $this->withHeaders($this->tenantHeaders())
            ->postJson('/api/v2/extracurriculars', $payload);
        
        $response->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.nama', 'Pramuka')
            ->assertJsonPath('data.tahun_ajaran', '2026/2027');

        $this->assertDatabaseHas('ekskul', [
            'tenant_id' => $this->tenantId,
            'nama' => 'Pramuka',
            'tahun_ajaran' => '2026/2027',
        ]);
    }

    public function test_student_cannot_create_extracurricular(): void
    {
        $student = $this->createUser('siswa');
        Sanctum::actingAs($student);

        $this->withHeaders($this->tenantHeaders())
            ->postJson('/api/v2/extracurriculars', ['nama' => 'Pramuka'])
            ->assertStatus(403);
    }

    public function test_student_can_join_extracurricular(): void
    {
        $student = $this->createUser('siswa');
        Sanctum::actingAs($student);

        $ekskulId = (string) Str::uuid();
        DB::table('ekskul')->insert([
            'id' => $ekskulId,
            'tenant_id' => $this->tenantId,
            'nama' => 'Pramuka',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'registration_deadline_at' => now()->addDays(7)->toDateTimeString(),
        ]);

        $this->withHeaders($this->tenantHeaders())
            ->postJson("/api/v2/extracurriculars/{$ekskulId}/join")
            ->assertStatus(200)
            ->assertJsonPath('success', true);

        $this->assertDatabaseHas('ekskul_anggota', [
            'ekskul_id' => $ekskulId,
            'user_id' => $student->id,
        ]);
    }

    public function test_student_cannot_join_past_deadline(): void
    {
        $student = $this->createUser('siswa');
        Sanctum::actingAs($student);

        $ekskulId = (string) Str::uuid();
        DB::table('ekskul')->insert([
            'id' => $ekskulId,
            'tenant_id' => $this->tenantId,
            'nama' => 'Pramuka',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'registration_deadline_at' => now()->subDays(1)->toDateTimeString(),
        ]);

        $this->withHeaders($this->tenantHeaders())
            ->postJson("/api/v2/extracurriculars/{$ekskulId}/join")
            ->assertStatus(400)
            ->assertJsonPath('error.code', 'DEADLINE_PASSED');
    }

    public function test_student_cannot_exceed_max_extracurriculars(): void
    {
        $student = $this->createUser('siswa');
        Sanctum::actingAs($student);

        // Max is set to 2 in setUp
        $ekskul1 = (string) Str::uuid();
        $ekskul2 = (string) Str::uuid();
        $ekskul3 = (string) Str::uuid();

        DB::table('ekskul')->insert([
            ['id' => $ekskul1, 'tenant_id' => $this->tenantId, 'nama' => 'E1', 'tahun_ajaran' => '2026/2027', 'semester' => 'Ganjil'],
            ['id' => $ekskul2, 'tenant_id' => $this->tenantId, 'nama' => 'E2', 'tahun_ajaran' => '2026/2027', 'semester' => 'Ganjil'],
            ['id' => $ekskul3, 'tenant_id' => $this->tenantId, 'nama' => 'E3', 'tahun_ajaran' => '2026/2027', 'semester' => 'Ganjil'],
        ]);

        DB::table('ekskul_anggota')->insert([
            ['ekskul_id' => $ekskul1, 'user_id' => $student->id],
            ['ekskul_id' => $ekskul2, 'user_id' => $student->id],
        ]);

        $this->withHeaders($this->tenantHeaders())
            ->postJson("/api/v2/extracurriculars/{$ekskul3}/join")
            ->assertStatus(400)
            ->assertJsonPath('error.code', 'LIMIT_REACHED');
    }
}
