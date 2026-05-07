<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class AttendanceQrApiTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_teacher_can_create_qr_and_student_scans_during_active_class(): void
    {
        $this->configureQrSigningKey();
        $tenantId = $this->defaultTenantId();
        Carbon::setTestNow(Carbon::parse('2026-04-30 08:15:00', 'Asia/Jakarta'));

        $guru = $this->createUserWithProfile($tenantId, 'guru', 'x-a', 'guru-qr@example.com');
        $siswa = $this->createUserWithProfile($tenantId, 'siswa', 'x-a', 'siswa-qr@example.com');
        $this->createClass($tenantId, 'x-a');
        $this->createSchedule($tenantId, $guru->id, 'jadwal-qr-1', 'x-a');

        $sessionResponse = $this->actingAs($guru)->postJson('/api/attendance-qr/session', [
            'jadwal_id' => 'jadwal-qr-1',
            'kelas_id' => 'x-a',
        ]);

        $sessionResponse->assertOk()
            ->assertJsonPath('data.success', true)
            ->assertJsonPath('data.schedule.mapel', 'Matematika');

        $token = $sessionResponse->json('data.token');

        $scanResponse = $this->actingAs($siswa)->postJson('/api/attendance-qr/scan', [
            'token' => $token,
        ]);

        $scanResponse->assertOk()
            ->assertJsonPath('data.success', true)
            ->assertJsonPath('data.nama', 'siswa test')
            ->assertJsonPath('data.mapel', 'Matematika')
            ->assertJsonPath('data.guru', 'guru test')
            ->assertJsonPath('data.hari', 'Kamis')
            ->assertJsonPath('data.tanggal', 30)
            ->assertJsonPath('data.bulan', 'April')
            ->assertJsonPath('data.tahun', 2026);

        $this->assertDatabaseHas('absensi', [
            'tenant_id' => $tenantId,
            'kelas' => 'x-a',
            'tanggal' => '2026-04-30',
            'uid' => $siswa->id,
            'mapel' => 'Matematika',
            'status' => 'Hadir',
            'nama' => 'siswa test',
        ]);
    }

    public function test_qr_scan_fails_when_class_time_has_ended_even_if_token_is_still_fresh(): void
    {
        $this->configureQrSigningKey();
        $tenantId = $this->defaultTenantId();
        Carbon::setTestNow(Carbon::parse('2026-04-30 08:59:40', 'Asia/Jakarta'));

        $guru = $this->createUserWithProfile($tenantId, 'guru', 'x-a', 'guru-ended@example.com');
        $siswa = $this->createUserWithProfile($tenantId, 'siswa', 'x-a', 'siswa-ended@example.com');
        $this->createClass($tenantId, 'x-a');
        $this->createSchedule($tenantId, $guru->id, 'jadwal-ended-1', 'x-a');

        $sessionResponse = $this->actingAs($guru)->postJson('/api/attendance-qr/session', [
            'jadwal_id' => 'jadwal-ended-1',
            'kelas_id' => 'x-a',
        ]);
        $sessionResponse->assertOk();

        Carbon::setTestNow(Carbon::parse('2026-04-30 09:00:30', 'Asia/Jakarta'));

        $scanResponse = $this->actingAs($siswa)->postJson('/api/attendance-qr/scan', [
            'token' => $sessionResponse->json('data.token'),
        ]);

        $scanResponse->assertStatus(422)
            ->assertJsonPath('success', false)
            ->assertJsonPath('reason', 'class_ended')
            ->assertJsonPath('error', 'Jam pelajaran sudah selesai. Absensi QR ditutup.');

        $this->assertDatabaseMissing('absensi', [
            'uid' => $siswa->id,
            'mapel' => 'Matematika',
            'tanggal' => '2026-04-30',
        ]);
    }

    public function test_qr_scan_rejects_a_student_from_another_tenant(): void
    {
        $this->configureQrSigningKey();
        config(['tenancy.allow_header_override' => true]);
        Carbon::setTestNow(Carbon::parse('2026-04-30 08:15:00', 'Asia/Jakarta'));

        $tenantA = $this->createTenant('sma-bali');
        $tenantB = $this->createTenant('sma-lombok');

        $guru = $this->createUserWithProfile($tenantA->id, 'guru', 'x-a-bali', 'guru-bali@example.com');
        $siswaLainTenant = $this->createUserWithProfile($tenantB->id, 'siswa', 'x-a-bali', 'siswa-lombok@example.com');
        $this->createClass($tenantA->id, 'x-a-bali');
        $this->createSchedule($tenantA->id, $guru->id, 'jadwal-bali-1', 'x-a-bali');

        $sessionResponse = $this->withHeaders(['X-Tenant' => 'sma-bali'])
            ->actingAs($guru)
            ->postJson('/api/attendance-qr/session', [
                'jadwal_id' => 'jadwal-bali-1',
                'kelas_id' => 'x-a-bali',
            ]);
        $sessionResponse->assertOk();

        $scanResponse = $this->withHeaders(['X-Tenant' => 'sma-lombok'])
            ->actingAs($siswaLainTenant)
            ->postJson('/api/attendance-qr/scan', [
                'token' => $sessionResponse->json('data.token'),
            ]);

        $scanResponse->assertStatus(403)
            ->assertJsonPath('success', false)
            ->assertJsonPath('reason', 'tenant_mismatch');
    }

    private function configureQrSigningKey(): void
    {
        config(['app.key' => 'base64:'.base64_encode(str_repeat('q', 32))]);
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')->where('slug', 'default')->value('id');
    }

    private function createTenant(string $slug): object
    {
        $id = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $id,
            'name' => strtoupper(str_replace('-', ' ', $slug)),
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return (object) [
            'id' => $id,
            'slug' => $slug,
        ];
    }

    private function createUserWithProfile(string $tenantId, string $role, string $kelas, string $email): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => $kelas,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }

    private function createClass(string $tenantId, string $classId): void
    {
        DB::table('kelas')->insert([
            'id' => $classId,
            'tenant_id' => $tenantId,
            'nama' => strtoupper(str_replace('-', ' ', $classId)),
            'grade' => 'X',
            'suffix' => 'A',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createSchedule(string $tenantId, string $guruId, string $scheduleId, string $classId): void
    {
        DB::table('jadwal')->insert([
            'id' => $scheduleId,
            'tenant_id' => $tenantId,
            'kelas_id' => $classId,
            'hari' => 'Kamis',
            'mapel' => 'Matematika',
            'guru_id' => $guruId,
            'guru_nama' => 'guru test',
            'jam_mulai' => '08:00:00',
            'jam_selesai' => '09:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
