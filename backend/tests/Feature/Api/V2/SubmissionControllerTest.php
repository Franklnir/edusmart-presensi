<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use App\Models\Tugas;
use App\Models\TugasJawaban;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class SubmissionControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);

        \Illuminate\Support\Facades\DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-a', 'slug' => 'tenant-a', 'name' => 'Tenant A'],
            ['id' => 'tenant-b', 'slug' => 'tenant-b', 'name' => 'Tenant B'],
        ]);
    }

    private function createUserWithRole(string $tenantId, string $role, array $extraProfile = []): User
    {
        $user = User::factory()->create(['id' => Str::uuid()->toString()]);
        Profile::forceCreate(array_merge([
            'id' => $user->id,
            'email' => $user->email,
            'tenant_id' => $tenantId,
            'role' => $role,
            'nama' => "Test $role",
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $extraProfile));
        return $user;
    }

    public function test_siswa_can_submit_assignment()
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        $siswa = $this->createUserWithRole('tenant-a', 'siswa', ['kelas' => '10A']);

        $tugas = Tugas::forceCreate([
            'kelas' => '10A',
            'judul' => 'Tugas Matematika',
            'mapel' => 'Matematika',
            'mulai' => now(),
            'deadline' => now()->addDays(7),
            'created_by' => $guru->id,
            'tenant_id' => 'tenant-a',
        ]);

        Sanctum::actingAs($siswa);

        $payload = [
            'tugas_id' => $tugas->id,
            'komentar_siswa' => 'Ini jawaban saya pak',
        ];

        $response = $this->postJson('/api/v2/submissions', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(201)
                 ->assertJsonPath('data.tugas_id', $tugas->id)
                 ->assertJsonPath('data.user_id', $siswa->id);

        $this->assertDatabaseHas('tugas_jawaban', [
            'tugas_id' => $tugas->id,
            'user_id' => $siswa->id,
            'komentar_siswa' => 'Ini jawaban saya pak',
        ]);
        
        // Idempotency: Retry exact same payload
        $payload['idempotency_key'] = $response->json('request_id');
        $payload['idempotency_key'] = Str::uuid()->toString();
        $response1 = $this->postJson('/api/v2/submissions', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response1->assertStatus(201);
        
        $response2 = $this->postJson('/api/v2/submissions', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response2->assertStatus(201);
        
        // Retry same key, diff payload
        $payloadDiff = $payload;
        $payloadDiff['komentar_siswa'] = 'Komentar baru';
        $response3 = $this->postJson('/api/v2/submissions', $payloadDiff, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response3->assertStatus(409)->assertJsonPath('code', 'IDEMPOTENCY_CONFLICT');
    }

    public function test_guru_can_grade_submission()
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        $siswa = $this->createUserWithRole('tenant-a', 'siswa', ['kelas' => '10A']);

        $tugas = Tugas::forceCreate([
            'kelas' => '10A',
            'judul' => 'Tugas Matematika',
            'mapel' => 'Matematika',
            'mulai' => now(),
            'deadline' => now()->addDays(7),
            'created_by' => $guru->id,
            'tenant_id' => 'tenant-a',
        ]);

        $jawaban = TugasJawaban::forceCreate([
            'tugas_id' => $tugas->id,
            'user_id' => $siswa->id,
            'status' => 'menunggu',
            'waktu_submit' => now(),
        ]);

        Sanctum::actingAs($guru);

        $payload = [
            'nilai' => 95,
        ];

        $response = $this->patchJson("/api/v2/submissions/{$jawaban->id}/grade", $payload, [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(200)
                 ->assertJsonPath('data.nilai', 95)
                 ->assertJsonPath('data.dinilai_oleh', $guru->id);
    }
}
