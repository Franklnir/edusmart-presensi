<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use App\Models\Tugas;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssignmentControllerTest extends TestCase
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

    public function test_guru_can_create_assignment()
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        Sanctum::actingAs($guru);

        $payload = [
            'kelas' => '10A',
            'judul' => 'Tugas Matematika',
            'mapel' => 'Matematika',
            'mulai' => now()->toDateTimeString(),
            'deadline' => now()->addDays(7)->toDateTimeString(),
        ];

        $response = $this->postJson('/api/v2/assignments', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(201)
                 ->assertJsonPath('data.judul', 'Tugas Matematika')
                 ->assertJsonPath('data.created_by', $guru->id);
                 
        $this->assertDatabaseHas('tugas', [
            'judul' => 'Tugas Matematika',
            'created_by' => $guru->id,
        ]);
        
        // Idempotency: Second request with same payload should return 201
        $payload['idempotency_key'] = $response->json('request_id'); // We didn't send idempotency_key in first request, let's just make a new idempotent request pair
        
        $payload['idempotency_key'] = Str::uuid()->toString();
        $response1 = $this->postJson('/api/v2/assignments', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response1->assertStatus(201);
        
        // Retry exact same payload
        $response2 = $this->postJson('/api/v2/assignments', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response2->assertStatus(201);
        
        // Retry same key, different payload -> 409
        $payloadDiff = $payload;
        $payloadDiff['judul'] = 'Berubah';
        $response3 = $this->postJson('/api/v2/assignments', $payloadDiff, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response3->assertStatus(409)->assertJsonPath('code', 'IDEMPOTENCY_CONFLICT');
    }

    public function test_siswa_cannot_create_assignment()
    {
        $siswa = $this->createUserWithRole('tenant-a', 'siswa', ['kelas' => '10A']);
        Sanctum::actingAs($siswa);

        $payload = [
            'kelas' => '10A',
            'judul' => 'Tugas Matematika',
            'mapel' => 'Matematika',
            'mulai' => now()->toDateTimeString(),
            'deadline' => now()->addDays(7)->toDateTimeString(),
        ];

        $response = $this->postJson('/api/v2/assignments', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(403);
    }

    public function test_siswa_can_view_assignments_for_their_class()
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        $siswa = $this->createUserWithRole('tenant-a', 'siswa', ['kelas' => '10A']);
        $siswaB = $this->createUserWithRole('tenant-a', 'siswa', ['kelas' => '10B']);

        Tugas::forceCreate([
            'kelas' => '10A',
            'judul' => 'Tugas 10A',
            'mapel' => 'Matematika',
            'mulai' => now(),
            'deadline' => now()->addDays(7),
            'created_by' => $guru->id,
            'tenant_id' => 'tenant-a',
        ]);

        Sanctum::actingAs($siswa);
        $response = $this->getJson('/api/v2/assignments', [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(200)
                 ->assertJsonCount(1, 'data');

        Sanctum::actingAs($siswaB);
        $response = $this->getJson('/api/v2/assignments', [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(200)
                 ->assertJsonCount(0, 'data');
    }

    public function test_cannot_delete_assignment_with_submissions()
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        
        $tugas = Tugas::forceCreate([
            'kelas' => '10A',
            'judul' => 'Tugas 10A',
            'mapel' => 'Matematika',
            'mulai' => now(),
            'deadline' => now()->addDays(7),
            'created_by' => $guru->id,
            'tenant_id' => 'tenant-a',
        ]);
        
        $siswa = $this->createUserWithRole('tenant-a', 'siswa', ['kelas' => '10A']);

        \App\Models\TugasJawaban::forceCreate([
            'tugas_id' => $tugas->id,
            'user_id' => $siswa->id,
            'status' => 'menunggu',
            'waktu_submit' => now(),
        ]);

        Sanctum::actingAs($guru);
        $response = $this->deleteJson('/api/v2/assignments/' . $tugas->id, [], [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(409)
                 ->assertJsonPath('code', 'ASSIGNMENT_HAS_SUBMISSIONS');
    }
}
