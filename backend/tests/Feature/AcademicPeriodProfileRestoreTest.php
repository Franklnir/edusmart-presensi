<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AcademicPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicPeriodProfileRestoreTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_period_change_restores_student_roster_from_authoritative_snapshot(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-period@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-period@example.com', 'xi-a', [
            'angkatan' => '2025',
        ]);
        $outsidePeriodStudent = $this->createUserWithProfile($tenantId, 'siswa', 'student-new-period@example.com', 'xi-a', [
            'angkatan' => '2025',
        ]);

        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'xi-a', 'XI A', 'XI', 'A', '2025', '2026/2027', 'Ganjil');
        $this->insertSettingsPeriod($tenantId, '2026/2027', 'Ganjil');
        $this->insertClassSnapshot($tenantId, $student->id, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap', 'active');

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2025/2026', 'Genap', [
            'calendar_confirmed' => true,
        ]));

        $response->assertOk()
            ->assertJsonPath('data.period_snapshot_restored', true)
            ->assertJsonPath('data.student_profile_restores', 1)
            ->assertJsonPath('data.student_profiles_outside_period', 1);

        $this->assertDatabaseHas('settings', [
            'tenant_id' => $tenantId,
            'tahun_ajaran' => '2025/2026',
            'semester_aktif' => 'Genap',
        ]);
        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'kelas' => 'x-a',
            'status' => 'active',
            'angkatan' => '2025',
        ]);
        $this->assertNull(DB::table('profiles')->where('id', $student->id)->value('disabled_at'));
        $this->assertDatabaseHas('profiles', [
            'id' => $outsidePeriodStudent->id,
            'tenant_id' => $tenantId,
            'kelas' => '',
            'status' => 'nonaktif',
        ]);
        $this->assertDatabaseHas('student_class_histories', [
            'tenant_id' => $tenantId,
            'student_id' => $student->id,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Genap',
            'class_id' => 'x-a',
            'status' => 'active',
            'source' => 'period_snapshot_restore',
        ]);
    }

    public function test_period_change_can_restore_alumni_snapshot_without_clearing_rfid(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-alumni-period@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-alumni-period@example.com', 'xii-a', [
            'angkatan' => '2023',
            'rfid_uid' => 'CARD-ALUMNI-001',
        ]);

        $this->insertClass($tenantId, 'xii-a', 'XII A', 'XII', 'A', '2023', '2025/2026', 'Genap');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');
        $this->insertClassSnapshot($tenantId, $student->id, '', '', null, null, '2023', '2026/2027', 'Ganjil', 'alumni');

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2026/2027', 'Ganjil', [
            'auto_rollover' => true,
            'calendar_confirmed' => true,
        ]));

        $response->assertOk()
            ->assertJsonPath('data.period_snapshot_restored', true)
            ->assertJsonPath('data.student_profile_restores', 1);

        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'kelas' => '',
            'status' => 'alumni',
            'angkatan' => '2023',
            'rfid_uid' => 'CARD-ALUMNI-001',
            'tahun_lulus' => 2026,
        ]);
        $this->assertNotNull(DB::table('profiles')->where('id', $student->id)->value('disabled_at'));
    }

    public function test_period_change_rejects_backward_restore_without_authoritative_snapshot(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-reject-period@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-reject-period@example.com', 'xi-a');

        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertSettingsPeriod($tenantId, '2026/2027', 'Ganjil');
        $this->insertClassSnapshot($tenantId, $student->id, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap', 'active', 'profile_update');

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2025/2026', 'Genap', [
            'calendar_confirmed' => true,
        ]));

        $response
            ->assertStatus(422)
            ->assertJsonPath('error', 'Snapshot kelas siswa untuk periode 2025/2026 belum tersedia. Periode tidak diturunkan agar data siswa tidak rusak.');

        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'kelas' => 'xi-a',
            'status' => 'active',
        ]);
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')
            ->where('slug', 'default')
            ->value('id');

        $this->assertNotSame('', $tenantId, 'Tenant default tidak ditemukan di database test');

        return $tenantId;
    }

    private function createUserWithProfile(string $tenantId, string $role, string $email, string $kelas, array $extra = []): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert(array_merge([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => $kelas,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));

        return $user;
    }

    private function insertClass(
        string $tenantId,
        string $id,
        string $name,
        string $grade,
        string $suffix,
        string $cohort,
        string $year,
        string $semester
    ): void {
        DB::table('kelas')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'nama' => $name,
            'grade' => $grade,
            'suffix' => $suffix,
            'angkatan' => $cohort,
            'tahun_ajaran' => $year,
            'semester' => $semester,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertSettingsPeriod(string $tenantId, string $year, string $semester): void
    {
        DB::table('settings')->where('tenant_id', $tenantId)->delete();

        $period = AcademicPeriod::make($year, $semester);
        $ganjil = AcademicPeriod::make($year, 'Ganjil');
        $genap = AcademicPeriod::make($year, 'Genap');

        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Default School',
            'tahun_ajaran' => $year,
            'semester_aktif' => $semester,
            'periode_mulai' => $ganjil['starts_at'],
            'periode_selesai' => $genap['ends_at'],
            'periode_ganjil_mulai' => $ganjil['starts_at'],
            'periode_ganjil_selesai' => $ganjil['ends_at'],
            'periode_genap_mulai' => $genap['starts_at'],
            'periode_genap_selesai' => $genap['ends_at'],
            'jadwal_periode_berlaku' => 'tahunan',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertNotNull($period['starts_at']);
    }

    private function insertClassSnapshot(
        string $tenantId,
        string $studentId,
        string $classId,
        string $className,
        ?string $grade,
        ?string $suffix,
        string $cohort,
        string $year,
        string $semester,
        string $status,
        string $source = 'before_period_change'
    ): void {
        DB::table('student_class_histories')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'student_id' => $studentId,
            'class_id' => $classId,
            'class_name' => $className,
            'grade' => $grade,
            'suffix' => $suffix,
            'angkatan' => $cohort,
            'tahun_ajaran' => $year,
            'semester' => $semester,
            'status' => $status,
            'source' => $source,
            'note' => 'Snapshot test.',
            'valid_from' => now()->subDay(),
            'created_at' => now()->subDay(),
            'updated_at' => now()->subDay(),
        ]);
    }

    private function periodPayload(string $year, string $semester, array $extra = []): array
    {
        $active = AcademicPeriod::make($year, $semester);
        $ganjil = AcademicPeriod::make($year, 'Ganjil');
        $genap = AcademicPeriod::make($year, 'Genap');

        return array_merge([
            'tahun_ajaran' => $year,
            'semester_aktif' => $semester,
            'periode_mulai' => $active['starts_at'],
            'periode_selesai' => $active['ends_at'],
            'periode_ganjil_mulai' => $ganjil['starts_at'],
            'periode_ganjil_selesai' => $ganjil['ends_at'],
            'periode_genap_mulai' => $genap['starts_at'],
            'periode_genap_selesai' => $genap['ends_at'],
        ], $extra);
    }
}
