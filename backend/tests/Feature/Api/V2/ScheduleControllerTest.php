<?php

namespace Tests\Feature\Api\V2;

use App\Models\Jadwal;
use App\Models\Kelas;
use App\Models\Profile;
use App\Models\User;
use App\Services\Academic\AcademicPeriodLifecycleService;
use App\Support\AcademicPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ScheduleControllerTest extends TestCase
{
    use RefreshDatabase;

    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);

        $this->tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $this->assertNotSame('', $this->tenantId);
        $this->seedSettings($this->tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
    }

    public function test_guest_cannot_access_schedules(): void
    {
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules')
            ->assertStatus(401);
    }

    public function test_list_is_scoped_by_tenant_year_and_role(): void
    {
        $admin = $this->createUser('admin');
        $teacher = $this->createUser('guru');
        $otherTeacher = $this->createUser('guru');
        $student = $this->createUser('siswa', 'X-A');
        $this->seedClass('X-A');
        $this->seedClass('X-B');

        $this->seedSchedule('class-a-teacher', 'X-A', $teacher->id, 'Matematika');
        $this->seedSchedule('class-b-other', 'X-B', $otherTeacher->id, 'Biologi');
        $this->seedSchedule('old-year', 'X-A', $teacher->id, 'Sejarah', '2025/2026');

        $otherTenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $otherTenantId,
            'slug' => 'tenant-lain',
            'name' => 'Tenant Lain',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Kelas::create(['id' => 'X-C', 'nama' => 'X C', 'tenant_id' => $otherTenantId]);
        $this->seedSchedule('other-tenant', 'X-C', null, 'Fisika', '2026/2027', $otherTenantId);

        Sanctum::actingAs($admin);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules?per_page=20')
            ->assertOk()
            ->assertJsonPath('academic_context.tahun_ajaran', '2026/2027')
            ->assertJsonCount(2, 'data')
            ->assertJsonMissing(['id' => 'old-year'])
            ->assertJsonMissing(['id' => 'other-tenant']);

        Sanctum::actingAs($teacher);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules?per_page=20')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', 'class-a-teacher');

        Sanctum::actingAs($student);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules?per_page=20')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', 'class-a-teacher');
    }

    public function test_student_uses_historical_enrollment_for_archived_year(): void
    {
        $student = $this->createUser('siswa', 'XI-A');
        $teacher = $this->createUser('guru');
        $this->seedClass('XI-A');
        $this->seedClass('X-A');
        $this->seedSchedule('current-schedule', 'XI-A', $teacher->id, 'Biologi');
        $this->seedSchedule('archive-schedule', 'X-A', $teacher->id, 'Sejarah', '2025/2026');
        DB::table('student_class_histories')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'student_id' => $student->id,
            'class_id' => 'X-A',
            'class_name' => 'X A',
            'tahun_ajaran' => '2025/2026',
            'semester' => AcademicPeriod::SEMESTER_GENAP,
            'status' => 'active',
            'source' => 'test',
            'valid_from' => now()->subYear(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($student);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules?tahun_ajaran=2025/2026&semester=Genap')
            ->assertOk()
            ->assertJsonPath('academic_context.mode', 'archive')
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', 'archive-schedule');
    }

    public function test_homeroom_teacher_can_read_class_schedule_but_other_teacher_cannot(): void
    {
        $homeroom = $this->createUser('guru');
        $otherTeacher = $this->createUser('guru');
        $subjectTeacher = $this->createUser('guru');
        $this->seedClass('X-A');
        $this->seedSchedule('homeroom-class-schedule', 'X-A', $subjectTeacher->id, 'Kimia');
        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'kelas_id' => 'X-A',
            'wali_guru_id' => $homeroom->id,
            'wali_guru_nama' => $homeroom->name,
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($homeroom);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules?kelas_id=X-A')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', 'homeroom-class-schedule');

        Sanctum::actingAs($otherTeacher);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules?kelas_id=X-A')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    public function test_schedule_is_annual_for_both_semesters_in_the_same_academic_year(): void
    {
        $admin = $this->createUser('admin');
        $this->seedClass('X-A');
        $this->seedSchedule('annual-schedule', 'X-A', null, 'Bahasa Indonesia');
        Sanctum::actingAs($admin);

        $ganjil = $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules?kelas_id=X-A&semester=Ganjil')
            ->assertOk()
            ->assertJsonPath('academic_context.semester', AcademicPeriod::SEMESTER_GANJIL)
            ->json('data');
        $genap = $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/schedules?kelas_id=X-A&semester=Genap')
            ->assertOk()
            ->assertJsonPath('academic_context.semester', AcademicPeriod::SEMESTER_GENAP)
            ->json('data');

        $this->assertSame(
            collect($ganjil)->pluck('id')->sort()->values()->all(),
            collect($genap)->pluck('id')->sort()->values()->all()
        );
        $this->assertSame('tahunan', $ganjil[0]['periode_berlaku']);
        $this->assertNull($ganjil[0]['semester']);
    }

    public function test_admin_create_uses_server_tenant_year_and_teacher_name(): void
    {
        $admin = $this->createUser('admin');
        $teacher = $this->createUser('guru', '', 'Guru Resmi');
        $this->seedClass('X-A');
        Sanctum::actingAs($admin);

        $payload = [
            'kelas_id' => 'X-A',
            'hari' => 'Senin',
            'mapel' => 'Matematika',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Nama Palsu',
            'jam_mulai' => '07:00',
            'jam_selesai' => '08:00',
            'tenant_id' => (string) Str::uuid(),
            'tahun_ajaran' => '2099/2100',
            'semester' => 'Genap',
        ];

        $response = $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'schedule-create-key']))
            ->postJson('/api/v2/schedules', $payload);

        $response->assertCreated()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.guru_nama', 'Guru Resmi')
            ->assertJsonPath('data.tahun_ajaran', '2026/2027')
            ->assertJsonPath('data.semester', null)
            ->assertJsonPath('data.periode_berlaku', 'tahunan');

        $id = (string) $response->json('data.id');
        $this->assertDatabaseHas('jadwal', [
            'id' => $id,
            'kelas_id' => 'X-A',
            'tenant_id' => $this->tenantId,
            'tahun_ajaran' => '2026/2027',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Guru Resmi',
            'periode_berlaku' => 'tahunan',
        ]);

        $replay = $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'schedule-create-key']))
            ->postJson('/api/v2/schedules', $payload);
        $replay->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
        $this->assertSame(1, DB::table('jadwal')->where('tenant_id', $this->tenantId)->where('mapel', 'Matematika')->count());
    }

    public function test_schedule_conflicts_and_partial_update_are_validated_server_side(): void
    {
        $admin = $this->createUser('admin');
        $teacher = $this->createUser('guru', '', 'Guru Satu');
        $this->seedClass('X-A');
        $this->seedClass('X-B');
        $this->seedSchedule('existing-schedule', 'X-A', $teacher->id, 'Matematika');
        Sanctum::actingAs($admin);

        $base = [
            'hari' => 'Senin',
            'mapel' => 'Biologi',
            'guru_id' => $teacher->id,
            'jam_mulai' => '07:30',
            'jam_selesai' => '08:30',
        ];
        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'too-short']))
            ->postJson('/api/v2/schedules', [...$base, 'kelas_id' => 'X-B', 'jam_mulai' => '09:00', 'jam_selesai' => '09:15'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('jam_selesai');

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'class-conflict']))
            ->postJson('/api/v2/schedules', [...$base, 'kelas_id' => 'X-A'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'SCHEDULE_CLASS_CONFLICT');

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'teacher-conflict']))
            ->postJson('/api/v2/schedules', [...$base, 'kelas_id' => 'X-B'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'SCHEDULE_TEACHER_CONFLICT');

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'adjacent-class-slot']))
            ->postJson('/api/v2/schedules', [
                'kelas_id' => 'X-A',
                'hari' => 'Senin',
                'mapel' => 'Bahasa Indonesia',
                'jam_mulai' => '08:00',
                'jam_selesai' => '08:30',
            ])
            ->assertCreated();

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'partial-update']))
            ->patchJson('/api/v2/schedules/existing-schedule', [
                'kelas_id' => 'X-A',
                'mapel' => 'Matematika Lanjutan',
            ])
            ->assertOk()
            ->assertJsonPath('data.mapel', 'Matematika Lanjutan');
        $this->assertDatabaseHas('jadwal', [
            'id' => 'existing-schedule',
            'kelas_id' => 'X-A',
            'mapel' => 'Matematika Lanjutan',
            'jam_mulai' => '07:00:00',
        ]);
    }

    public function test_non_admin_cannot_mutate_schedule(): void
    {
        $teacher = $this->createUser('guru');
        $this->seedClass('X-A');
        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'teacher-create']))
            ->postJson('/api/v2/schedules', [
                'kelas_id' => 'X-A',
                'hari' => 'Senin',
                'mapel' => 'Matematika',
                'jam_mulai' => '07:00',
                'jam_selesai' => '08:00',
            ])
            ->assertForbidden();
    }

    public function test_schedule_delete_is_idempotent_and_audited(): void
    {
        $admin = $this->createUser('admin');
        $this->seedClass('X-A');
        $this->seedSchedule('delete-schedule', 'X-A', null, 'Seni Budaya');
        Sanctum::actingAs($admin);

        $headers = $this->tenantHeaders(['Idempotency-Key' => 'delete-schedule-key']);
        $this->withHeaders($headers)
            ->deleteJson('/api/v2/schedules/delete-schedule', ['kelas_id' => 'X-A'])
            ->assertOk();
        $this->withHeaders($headers)
            ->deleteJson('/api/v2/schedules/delete-schedule', ['kelas_id' => 'X-A'])
            ->assertOk()
            ->assertHeader('Idempotency-Replayed', 'true');

        $this->assertDatabaseMissing('jadwal', ['id' => 'delete-schedule', 'kelas_id' => 'X-A']);
        $this->assertDatabaseHas('audit_log', [
            'tenant_id' => $this->tenantId,
            'table_name' => 'jadwal',
            'record_id' => 'delete-schedule',
            'action' => 'DELETE',
        ]);
    }

    private function createUser(string $role, string $classId = '', ?string $name = null): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $name ?: ucfirst($role).' Pengujian',
            'email' => Str::uuid().'@example.test',
            'password' => Hash::make('password123'),
        ]);
        Profile::create([
            'id' => $user->id,
            'tenant_id' => $this->tenantId,
            'email' => $user->email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => $classId,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }

    private function seedClass(string $id): void
    {
        Kelas::create(['id' => $id, 'nama' => str_replace('-', ' ', $id), 'tenant_id' => $this->tenantId]);
    }

    private function seedSchedule(
        string $id,
        string $classId,
        ?string $teacherId,
        string $subject,
        string $year = '2026/2027',
        ?string $tenantId = null
    ): void {
        Jadwal::create([
            'id' => $id,
            'tenant_id' => $tenantId ?: $this->tenantId,
            'kelas_id' => $classId,
            'hari' => 'Senin',
            'mapel' => $subject,
            'guru_id' => $teacherId,
            'guru_nama' => $teacherId ? 'Guru Pengujian' : null,
            'jam_mulai' => '07:00:00',
            'jam_selesai' => '08:00:00',
            'tahun_ajaran' => $year,
            'periode_berlaku' => 'tahunan',
        ]);
    }

    private function seedSettings(string $tenantId, string $year, string $semester): void
    {
        $ganjil = AcademicPeriod::make($year, AcademicPeriod::SEMESTER_GANJIL);
        $genap = AcademicPeriod::make($year, AcademicPeriod::SEMESTER_GENAP);
        DB::table('settings')->where('tenant_id', $tenantId)->delete();
        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'Sekolah Pengujian',
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
        app(AcademicPeriodLifecycleService::class)->synchronizeTenant($tenantId);
    }

    private function tenantHeaders(array $additional = []): array
    {
        return ['X-Tenant' => 'default', ...$additional];
    }
}
