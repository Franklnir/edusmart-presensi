<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TeacherDashboardControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);

        DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-a', 'slug' => 'tenant-a', 'name' => 'Tenant A'],
            ['id' => 'tenant-b', 'slug' => 'tenant-b', 'name' => 'Tenant B'],
        ]);

        $this->seedSettings('tenant-a', '2026/2027');
        $this->seedSettings('tenant-b', '2026/2027');
    }

    public function test_teacher_report_is_scoped_to_assigned_class_and_academic_year(): void
    {
        $teacher = $this->createUser('tenant-a', 'guru');
        $otherTeacher = $this->createUser('tenant-a', 'guru');
        $this->seedClass('tenant-a', 'class-a');
        $this->seedClass('tenant-a', 'class-b');
        $this->seedSchedule('tenant-a', 'class-a', $teacher->id, 'Matematika', '2026/2027');
        $this->seedSchedule('tenant-a', 'class-b', $otherTeacher->id, 'Biologi', '2026/2027');
        $this->seedSchedule('tenant-a', 'class-a', $teacher->id, 'Sejarah', '2025/2026');

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/reports/dashboard-aggregate?kelas=class-a&tahun_ajaran=2026/2027')
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.jadwalKelasList.0.mapel', 'Matematika')
            ->assertJsonMissing(['mapel' => 'Sejarah']);

        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/reports/dashboard-aggregate?kelas=class-a&tahun_ajaran=2025/2026')
            ->assertOk()
            ->assertJsonPath('data.jadwalKelasList.0.mapel', 'Sejarah')
            ->assertJsonMissing(['mapel' => 'Matematika']);

        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/reports/dashboard-aggregate?kelas=class-b&tahun_ajaran=2026/2027')
            ->assertForbidden()
            ->assertJsonPath('code', 'REPORT_CLASS_ACCESS_DENIED');
    }

    public function test_homeroom_teacher_can_read_class_report_without_teaching_a_subject(): void
    {
        $homeroom = $this->createUser('tenant-a', 'guru');
        $otherTeacher = $this->createUser('tenant-a', 'guru');
        $this->seedClass('tenant-a', 'class-a');
        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => 'tenant-a',
            'kelas_id' => 'class-a',
            'wali_guru_id' => $homeroom->id,
            'wali_guru_nama' => $homeroom->name,
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($homeroom);
        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/reports/dashboard-aggregate?kelas=class-a&tahun_ajaran=2026/2027')
            ->assertOk();

        Sanctum::actingAs($otherTeacher);
        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/reports/dashboard-aggregate?kelas=class-a&tahun_ajaran=2026/2027')
            ->assertForbidden();
    }

    public function test_non_teacher_cannot_load_teacher_report(): void
    {
        $student = $this->createUser('tenant-a', 'siswa');
        $this->seedClass('tenant-a', 'class-a');

        Sanctum::actingAs($student);
        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/reports/dashboard-aggregate?kelas=class-a&tahun_ajaran=2026/2027')
            ->assertForbidden()
            ->assertJsonPath('code', 'REPORT_ACCESS_DENIED');
    }

    public function test_report_cannot_cross_tenant_boundaries(): void
    {
        $teacher = $this->createUser('tenant-a', 'guru');
        $this->seedClass('tenant-a', 'class-a');
        $this->seedClass('tenant-b', 'class-b');
        $this->seedSchedule('tenant-a', 'class-a', $teacher->id, 'Matematika', '2026/2027');

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders('tenant-a'))
            ->getJson('/api/v2/reports/dashboard-aggregate?kelas=class-b&tahun_ajaran=2026/2027')
            ->assertForbidden()
            ->assertJsonPath('code', 'REPORT_CLASS_ACCESS_DENIED');

        $this->withHeaders($this->tenantHeaders('tenant-b'))
            ->getJson('/api/v2/reports/dashboard-aggregate?kelas=class-a&tahun_ajaran=2026/2027')
            ->assertForbidden();
    }

    private function createUser(string $tenantId, string $role): User
    {
        $user = User::factory()->create(['id' => (string) Str::uuid()]);
        Profile::create([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'role' => $role,
            'email' => $user->email,
            'nama' => ucfirst($role).' Pengujian',
            'status' => 'active',
        ]);

        return $user;
    }

    private function seedClass(string $tenantId, string $id): void
    {
        DB::table('kelas')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'nama' => strtoupper($id),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedSchedule(string $tenantId, string $classId, string $teacherId, string $subject, string $year): void
    {
        DB::table('jadwal')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'kelas_id' => $classId,
            'guru_id' => $teacherId,
            'guru_nama' => 'Guru Pengujian',
            'mapel' => $subject,
            'hari' => 'Senin',
            'jam_mulai' => '07:00:00',
            'jam_selesai' => '08:00:00',
            'tahun_ajaran' => $year,
            'periode_berlaku' => 'tahunan',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedSettings(string $tenantId, string $year): void
    {
        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Pengujian',
            'tahun_ajaran' => $year,
            'semester_aktif' => 'Ganjil',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, string> */
    private function tenantHeaders(string $slug): array
    {
        return ['X-Tenant' => $slug];
    }
}
