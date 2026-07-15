<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AcademicPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class ProfileIdentitySyncTest extends TestCase
{
    use RefreshDatabase;

    public function test_legacy_profile_update_is_blocked_without_snapshot_side_effects(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Sekolah', 'admin-sync@example.com');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'Bu Rina Lama', 'rina.lama@example.com');
        $now = now();
        $period = AcademicPeriod::current();

        DB::table('kelas')->insert([
            'id' => 'X-1',
            'nama' => 'X-1',
            'grade' => 'X',
            'suffix' => '1',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
        ]);

        DB::table('jadwal')->insert([
            'id' => 'senin-1',
            'kelas_id' => 'X-1',
            'hari' => 'Senin',
            'mapel' => 'Matematika',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Bu Rina Lama (rina.lama@example.com)',
            'jam_mulai' => '07:00',
            'jam_selesai' => '08:00',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('kelas_struktur')->insert([
            'kelas_id' => 'X-1',
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'Bu Rina Lama (rina.lama@example.com)',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('struktur_sekolah')->insert([
            'id' => 'wakasek',
            'jabatan' => 'Wakasek',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Bu Rina Lama (rina.lama@example.com)',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('organisasi')->insert([
            'id' => 'osis',
            'nama' => 'OSIS',
            'pembina_guru_id' => $teacher->id,
            'pembina_guru_nama' => 'Bu Rina Lama (rina.lama@example.com)',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($admin)->postJson('/api/db', [
            'table' => 'profiles',
            'action' => 'update',
            'payload' => [
                'nama' => 'Bu Rina Baru',
                'email' => 'rina.baru@example.com',
                'updated_at' => $now->copy()->addMinute()->toISOString(),
            ],
            'filters' => [
                'eq' => ['id' => $teacher->id],
            ],
        ]);

        $response
            ->assertStatus(410)
            ->assertJsonPath('code', 'DB_LEGACY_WRITE_BLOCKED')
            ->assertHeader('X-Request-ID', $response->json('request_id'));

        $this->assertDatabaseHas('profiles', [
            'id' => $teacher->id,
            'nama' => 'Bu Rina Lama',
            'email' => 'rina.lama@example.com',
        ]);
    }

    public function test_ilike_filter_supports_schedule_conflict_queries(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Jadwal', 'admin-jadwal@example.com');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'Pak Dedi', 'dedi@example.com');
        $now = now();
        $period = AcademicPeriod::current();

        DB::table('kelas')->insert([
            'id' => 'XI-1',
            'nama' => 'XI-1',
            'grade' => 'XI',
            'suffix' => '1',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
        ]);

        DB::table('jadwal')->insert([
            'id' => 'selasa-1',
            'kelas_id' => 'XI-1',
            'hari' => 'Selasa',
            'mapel' => 'Fisika',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Pak Dedi',
            'jam_mulai' => '09:00',
            'jam_selesai' => '10:00',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
        ]);

        $response = $this->actingAs($admin)->postJson('/api/db', [
            'table' => 'jadwal',
            'action' => 'select',
            'filters' => [
                'ilike' => ['mapel' => 'fisika'],
                'eq' => ['hari' => 'Selasa'],
            ],
        ]);

        $response->assertOk();
        $response->assertJsonCount(1, 'data');
        $response->assertJsonPath('data.0.mapel', 'Fisika');
    }

    public function test_legacy_student_profile_update_is_blocked_without_snapshot_side_effects(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'Admin Siswa', 'admin-siswa@example.com');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'Nama Lama', 'siswa-sync@example.com');
        $now = now();

        DB::table('kelas')->insert([
            'id' => 'XII-1',
            'nama' => 'XII-1',
            'grade' => 'XII',
            'suffix' => '1',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('kelas_struktur')->insert([
            'kelas_id' => 'XII-1',
            'ketua_siswa_id' => $student->id,
            'ketua_siswa_nama' => 'Nama Lama',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('organisasi')->insert([
            'id' => 'pmr',
            'nama' => 'PMR',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('organisasi_anggota')->insert([
            'organisasi_id' => 'pmr',
            'siswa_id' => $student->id,
            'nama' => 'Nama Lama',
            'kelas' => 'XII-1',
            'created_at' => $now,
            'updated_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('absensi')->insert([
            'kelas' => 'XII-1',
            'tanggal' => '2026-05-03',
            'uid' => $student->id,
            'mapel' => 'Biologi',
            'status' => 'Hadir',
            'nama' => 'Nama Lama',
            'waktu' => $now,
            'tenant_id' => $tenantId,
        ]);

        DB::table('absensi_ajuan')->insert([
            'id' => (string) Str::uuid(),
            'kelas' => 'XII-1',
            'tanggal' => '2026-05-03',
            'uid' => $student->id,
            'nama' => 'Nama Lama',
            'alasan' => 'Sakit',
            'mapel' => 'Biologi',
            'status_guru' => 'pending',
            'created_at' => $now,
            'tenant_id' => $tenantId,
        ]);

        $response = $this->actingAs($admin)->postJson('/api/db', [
            'table' => 'profiles',
            'action' => 'update',
            'payload' => [
                'nama' => 'Nama Baru',
                'updated_at' => $now->copy()->addMinute()->toISOString(),
            ],
            'filters' => [
                'eq' => ['id' => $student->id],
            ],
        ]);

        $response
            ->assertStatus(410)
            ->assertJsonPath('code', 'DB_LEGACY_WRITE_BLOCKED')
            ->assertHeader('X-Request-ID', $response->json('request_id'));

        $this->assertDatabaseHas('users', ['id' => $student->id, 'name' => 'Nama Lama']);
        $this->assertDatabaseHas('profiles', ['id' => $student->id, 'nama' => 'Nama Lama']);
    }

    private function defaultTenantId(): string
    {
        return (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');
    }

    private function createUserWithProfile(string $tenantId, string $role, string $name, string $email): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $name,
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }
}
