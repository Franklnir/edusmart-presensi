<?php

namespace Tests\Feature\Api\V2;

use App\Models\Absensi;
use App\Models\Profile;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AttendanceControllerTest extends TestCase
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

    private function createUserWithRole(string $tenantId, string $role): User
    {
        $user = User::factory()->create([
            'id' => Str::uuid()->toString()
        ]);
        Profile::forceCreate([
            'id' => $user->id,
            'email' => $user->email,
            'tenant_id' => $tenantId,
            'role' => $role,
            'nama' => 'Test ' . $role,
        ]);
        return $user;
    }

    public function test_admin_can_list_tenant_attendances()
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $studentA = $this->createUserWithRole('tenant-a', 'siswa');
        $studentB = $this->createUserWithRole('tenant-b', 'siswa');

        Absensi::forceCreate([
            'uid' => $studentA->id,
            'kelas' => '10A',
            'tanggal' => Carbon::today(),
            'status' => 'Hadir',
            'mapel' => 'Matematika'
        ]);

        Absensi::forceCreate([
            'uid' => $studentB->id,
            'kelas' => '10B',
            'tanggal' => Carbon::today(),
            'status' => 'Hadir',
            'mapel' => 'Fisika'
        ]);
        
        Sanctum::actingAs($admin);

        $response = $this->getJson('/api/v2/attendance', [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(200)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.uid', $studentA->id)
            ->assertJsonStructure([
                'success',
                'message',
                'request_id'
            ]);
    }

    public function test_guru_can_create_attendance_with_idempotency_key()
    {
        $guru = $this->createUserWithRole('tenant-a', 'guru');
        $student = $this->createUserWithRole('tenant-a', 'siswa');
        
        Sanctum::actingAs($guru);

        $payload = [
            'uid' => $student->id,
            'kelas' => '10A',
            'tanggal' => Carbon::today()->format('Y-m-d'),
            'status' => 'Hadir',
            'mapel' => 'Biologi',
            'idempotency_key' => Str::uuid()->toString(),
        ];

        // First request
        $response1 = $this->postJson('/api/v2/attendance', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response1->assertStatus(201);

        // Second request with same idempotency key AND SAME PAYLOAD
        $response2 = $this->postJson('/api/v2/attendance', $payload, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response2->assertStatus(201) // Idempotent! returns cached 201
            ->assertJsonPath('success', true);
            
        // Third request with SAME idempotency key BUT DIFFERENT payload
        $payloadDiff = $payload;
        $payloadDiff['kelas'] = '10B';
        $response3 = $this->postJson('/api/v2/attendance', $payloadDiff, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response3->assertStatus(409)
            ->assertJsonPath('code', 'IDEMPOTENCY_CONFLICT');
            
        // Fourth request with different idempotency key but same attendance logic (duplicate attendance on same day)
        $payload2 = $payload;
        $payload2['idempotency_key'] = Str::uuid()->toString();
        $response4 = $this->postJson('/api/v2/attendance', $payload2, [
            'X-Tenant' => 'tenant-a'
        ]);
        $response4->assertStatus(409)
            ->assertJsonPath('code', 'ATTENDANCE_ALREADY_EXISTS');
    }

    public function test_guest_cannot_access_attendance()
    {
        $response = $this->getJson('/api/v2/attendance', [
            'X-Tenant' => 'tenant-a'
        ]);
        $response->assertStatus(401);
    }

    public function test_cannot_create_attendance_for_other_tenant_student()
    {
        $admin = $this->createUserWithRole('tenant-a', 'admin');
        $studentOtherTenant = $this->createUserWithRole('tenant-b', 'siswa');

        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/v2/attendance', [
            'uid' => $studentOtherTenant->id,
            'kelas' => '10A',
            'tanggal' => Carbon::today()->format('Y-m-d'),
            'status' => 'Hadir',
            'idempotency_key' => Str::uuid()->toString(),
        ], [
            'X-Tenant' => 'tenant-a'
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['uid']);
    }

    public function test_siswa_cannot_create_or_update_attendance()
    {
        $siswa = $this->createUserWithRole('tenant-a', 'siswa');

        Sanctum::actingAs($siswa);

        $responseCreate = $this->postJson('/api/v2/attendance', [
            'uid' => $siswa->id,
            'kelas' => '10A',
            'tanggal' => Carbon::today()->format('Y-m-d'),
            'status' => 'Hadir',
            'idempotency_key' => Str::uuid()->toString(),
        ], [
            'X-Tenant' => 'tenant-a'
        ]);

        $responseCreate->assertStatus(403);
    }
}
