<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Academic\ExtracurricularPeriodService;
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

        $response->assertOk();

        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'kelas' => 'xi-a',
            'status' => 'active',
        ]);
    }

    public function test_auto_rollover_promotes_smp_and_sma_students_without_reassigning_homeroom_teacher(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-rollover-period@example.com', 'admin');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-rollover-period@example.com', 'guru');

        $this->insertClass($tenantId, 'vii-a', 'VII A', 'VII', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'viii-a', 'VIII A', 'VIII', 'A', '2024', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'ix-a', 'IX A', 'IX', 'A', '2023', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'xi-a', 'XI A', 'XI', 'A', '2024', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'xii-a', 'XII A', 'XII', 'A', '2023', '2025/2026', 'Genap');
        $this->insertClassStructure($tenantId, 'xi-a', $teacher->id, 'Pak Wali Tetap', 'old-ketua', 'Ketua Lama');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');

        $students = [
            'vii' => $this->createUserWithProfile($tenantId, 'siswa', 'student-vii-rollover@example.com', 'vii-a', ['angkatan' => '2025']),
            'viii' => $this->createUserWithProfile($tenantId, 'siswa', 'student-viii-rollover@example.com', 'viii-a', ['angkatan' => '2024']),
            'ix' => $this->createUserWithProfile($tenantId, 'siswa', 'student-ix-rollover@example.com', 'ix-a', ['angkatan' => '2023']),
            'x' => $this->createUserWithProfile($tenantId, 'siswa', 'student-x-rollover@example.com', 'x-a', ['angkatan' => '2025']),
            'xi' => $this->createUserWithProfile($tenantId, 'siswa', 'student-xi-rollover@example.com', 'xi-a', ['angkatan' => '2024']),
            'xii' => $this->createUserWithProfile($tenantId, 'siswa', 'student-xii-rollover@example.com', 'xii-a', ['angkatan' => '2023']),
        ];

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2026/2027', 'Ganjil', [
            'auto_rollover' => true,
            'calendar_confirmed' => true,
        ]));

        $response->assertOk()
            ->assertJsonPath('data.rollover.promoted_students', 4)
            ->assertJsonPath('data.rollover.alumni_students', 2)
            ->assertJsonPath('data.rollover.skipped_students', 0);

        $this->assertDatabaseHas('profiles', ['id' => $students['vii']->id, 'kelas' => 'viii-a', 'status' => 'active', 'angkatan' => '2025']);
        $this->assertDatabaseHas('profiles', ['id' => $students['viii']->id, 'kelas' => 'ix-a', 'status' => 'active', 'angkatan' => '2024']);
        $this->assertDatabaseHas('profiles', ['id' => $students['x']->id, 'kelas' => 'xi-a', 'status' => 'active', 'angkatan' => '2025']);
        $this->assertDatabaseHas('profiles', ['id' => $students['xi']->id, 'kelas' => 'xii-a', 'status' => 'active', 'angkatan' => '2024']);
        $this->assertDatabaseHas('profiles', ['id' => $students['ix']->id, 'kelas' => '', 'status' => 'alumni', 'tahun_lulus' => 2026]);
        $this->assertDatabaseHas('profiles', ['id' => $students['xii']->id, 'kelas' => '', 'status' => 'alumni', 'tahun_lulus' => 2026]);
        $this->assertNotNull(DB::table('profiles')->where('id', $students['ix']->id)->value('disabled_at'));
        $this->assertNotNull(DB::table('profiles')->where('id', $students['xii']->id)->value('disabled_at'));

        $this->assertDatabaseHas('kelas_struktur', [
            'tenant_id' => $tenantId,
            'kelas_id' => 'xi-a',
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'Pak Wali Tetap',
            'ketua_siswa_id' => null,
            'ketua_siswa_nama' => null,
        ]);
        $this->assertDatabaseHas('student_class_histories', [
            'tenant_id' => $tenantId,
            'student_id' => $students['x']->id,
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'class_id' => 'xi-a',
            'status' => 'active',
            'source' => 'auto_rollover',
        ]);
    }

    public function test_auto_rollover_copies_ekskul_catalog_but_resets_members_by_default(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-ekskul-reset@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-ekskul-reset@example.com', 'x-a', [
            'angkatan' => '2025',
        ]);

        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'xi-a', 'XI A', 'XI', 'A', '2025', '2026/2027', 'Ganjil');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');
        $this->insertEskul($tenantId, 'basket-source', 'Basket', '2025/2026', 'Genap');
        DB::table('ekskul_anggota')->insert([
            'tenant_id' => $tenantId,
            'ekskul_id' => 'basket-source',
            'user_id' => $student->id,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Genap',
            'angkatan' => '2025',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2026/2027', 'Ganjil', [
            'auto_rollover' => true,
            'calendar_confirmed' => true,
        ]));

        $response->assertOk()
            ->assertJsonPath('data.rollover.eskul_catalog_copied', 1)
            ->assertJsonPath('data.rollover.eskul_members_copied', 0);

        $targetEskul = DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', '2026/2027')
            ->where('semester', 'Ganjil')
            ->where('nama', 'Basket')
            ->first();

        $this->assertNotNull($targetEskul);
        $this->assertNotSame('basket-source', (string) $targetEskul->id);
        $this->assertDatabaseHas('ekskul', [
            'id' => 'basket-source',
            'tenant_id' => $tenantId,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Genap',
        ]);
        $this->assertDatabaseMissing('ekskul_anggota', [
            'tenant_id' => $tenantId,
            'user_id' => $student->id,
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
        ]);
    }

    public function test_auto_rollover_maps_carried_members_to_new_ekskul_catalog_ids(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-ekskul-copy@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-ekskul-copy@example.com', 'x-a', [
            'angkatan' => '2025',
        ]);

        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'xi-a', 'XI A', 'XI', 'A', '2025', '2026/2027', 'Ganjil');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');
        $this->insertEskul($tenantId, 'pramuka-source', 'Pramuka', '2025/2026', 'Genap');
        DB::table('ekskul_anggota')->insert([
            'tenant_id' => $tenantId,
            'ekskul_id' => 'pramuka-source',
            'user_id' => $student->id,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Genap',
            'angkatan' => '2025',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2026/2027', 'Ganjil', [
            'auto_rollover' => true,
            'carry_eskul_members' => true,
            'calendar_confirmed' => true,
        ]));

        $response->assertOk()
            ->assertJsonPath('data.rollover.eskul_catalog_copied', 1)
            ->assertJsonPath('data.rollover.eskul_members_copied', 1);

        $targetEskulId = (string) DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', '2026/2027')
            ->where('semester', 'Ganjil')
            ->where('nama', 'Pramuka')
            ->value('id');

        $this->assertNotSame('', $targetEskulId);
        $this->assertNotSame('pramuka-source', $targetEskulId);
        $this->assertDatabaseHas('ekskul_anggota', [
            'tenant_id' => $tenantId,
            'ekskul_id' => $targetEskulId,
            'user_id' => $student->id,
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
        ]);
        $this->assertDatabaseMissing('ekskul_anggota', [
            'tenant_id' => $tenantId,
            'ekskul_id' => 'pramuka-source',
            'user_id' => $student->id,
            'tahun_ajaran' => '2026/2027',
        ]);
    }

    public function test_semester_change_copies_catalog_without_copying_members(): void
    {
        Carbon::setTestNow(Carbon::parse('2027-01-10 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-ekskul-semester@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-ekskul-semester@example.com', 'x-a');
        $this->insertSettingsPeriod($tenantId, '2026/2027', 'Ganjil');
        $this->insertEskul($tenantId, 'futsal-ganjil', 'Futsal', '2026/2027', 'Ganjil');
        DB::table('ekskul_anggota')->insert([
            'tenant_id' => $tenantId,
            'ekskul_id' => 'futsal-ganjil',
            'user_id' => $student->id,
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'created_at' => now(),
        ]);

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2026/2027', 'Genap'));

        $response->assertOk()
            ->assertJsonPath('data.semester_only_change', true)
            ->assertJsonPath('data.eskul_catalog_copied', 1);

        $targetEskulId = (string) DB::table('ekskul')
            ->where('tenant_id', $tenantId)
            ->where('tahun_ajaran', '2026/2027')
            ->where('semester', 'Genap')
            ->where('nama', 'Futsal')
            ->value('id');

        $this->assertNotSame('', $targetEskulId);
        $this->assertNotSame('futsal-ganjil', $targetEskulId);
        $this->assertDatabaseMissing('ekskul_anggota', [
            'tenant_id' => $tenantId,
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Genap',
            'user_id' => $student->id,
        ]);
    }

    public function test_empty_active_catalog_repair_is_tenant_scoped_and_idempotent(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-07-11 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $this->insertSettingsPeriod($tenantId, '2026/2027', 'Ganjil');
        $this->insertEskul($tenantId, 'pmr-archive', 'PMR', '2025/2026', 'Genap');

        $service = app(ExtracurricularPeriodService::class);
        $this->assertSame(1, $service->repairEmptyActiveCatalogs());
        $this->assertSame(0, $service->repairEmptyActiveCatalogs());

        $this->assertDatabaseHas('ekskul', [
            'tenant_id' => $tenantId,
            'nama' => 'PMR',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
        ]);
        $this->assertSame(
            1,
            DB::table('ekskul')
                ->where('tenant_id', $tenantId)
                ->where('tahun_ajaran', '2026/2027')
                ->where('semester', 'Ganjil')
                ->count()
        );
    }

    public function test_schedule_copy_is_decided_from_schedule_page_after_rollover(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-copy-schedule@example.com', 'admin');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-copy-schedule@example.com', 'guru');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-copy-schedule@example.com', 'x-a', [
            'angkatan' => '2025',
        ]);

        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'xi-a', 'XI A', 'XI', 'A', '2025', '2026/2027', 'Ganjil');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');
        $this->insertSchedule($tenantId, 'jadwal-source-matematika', 'x-a', $teacher->id, 'MATEMATIKA', 'Senin', '07:00', '08:00', '2025/2026', 'Genap');
        $this->insertSchedule($tenantId, 'jadwal-source-ipa', 'x-a', $teacher->id, 'IPA', 'Selasa', '08:00', '09:00', '2025/2026', 'Genap');

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2026/2027', 'Ganjil', [
            'auto_rollover' => true,
            'calendar_confirmed' => true,
        ]));

        $response->assertOk()
            ->assertJsonPath('data.rollover.promoted_students', 1);

        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'kelas' => 'xi-a',
            'status' => 'active',
        ]);
        $this->assertDatabaseMissing('jadwal', [
            'tenant_id' => $tenantId,
            'mapel' => 'MATEMATIKA',
            'tahun_ajaran' => '2026/2027',
        ]);

        $this->getJson('/api/admin/academic-period/schedule-decision?target_tahun_ajaran=2026/2027')
            ->assertOk()
            ->assertJsonPath('data.requires_decision', true)
            ->assertJsonPath('data.target_schedule_count', 0)
            ->assertJsonPath('data.source_schedule_count', 2);

        $copyResponse = $this->postJson('/api/admin/academic-period/schedule-decision', [
            'action' => 'use_previous',
            'target_tahun_ajaran' => '2026/2027',
            'source_tahun_ajaran' => '2025/2026',
        ]);

        $copyResponse->assertOk()
            ->assertJsonPath('data.requires_decision', false)
            ->assertJsonPath('data.copied_count', 2)
            ->assertJsonPath('data.decision.decision', 'copy_previous');

        $this->assertDatabaseHas('jadwal', [
            'tenant_id' => $tenantId,
            'kelas_id' => 'x-a',
            'mapel' => 'MATEMATIKA',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
        ]);
        $this->assertDatabaseHas('jadwal', [
            'tenant_id' => $tenantId,
            'kelas_id' => 'x-a',
            'mapel' => 'MATEMATIKA',
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Genap',
        ]);
        $this->assertDatabaseHas('academic_schedule_period_decisions', [
            'tenant_id' => $tenantId,
            'target_tahun_ajaran' => '2026/2027',
            'source_tahun_ajaran' => '2025/2026',
            'decision' => 'copy_previous',
            'copied_count' => 2,
        ]);
        $this->assertSame(
            1,
            DB::table('jadwal')
                ->where('tenant_id', $tenantId)
                ->where('kelas_id', 'x-a')
                ->where('mapel', 'IPA')
                ->where('tahun_ajaran', '2026/2027')
                ->where('hari', 'Selasa')
                ->where('jam_mulai', '08:00')
                ->count()
        );
    }

    public function test_auto_rollover_creates_missing_destination_classes_before_promoting_students(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-rollover-create-class@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-rollover-create-class@example.com', 'x-b-mipa', [
            'angkatan' => '2025',
        ]);

        $this->insertClass($tenantId, 'x-b-mipa', 'X B MIPA', 'X', 'B MIPA', '2025', '2025/2026', 'Genap');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2026/2027', 'Ganjil', [
            'auto_rollover' => true,
            'calendar_confirmed' => true,
        ]));

        $response->assertOk()
            ->assertJsonPath('data.rollover.promoted_students', 1)
            ->assertJsonPath('data.rollover.alumni_students', 0)
            ->assertJsonPath('data.rollover.skipped_students', 0)
            ->assertJsonPath('data.rollover.created_target_classes', 1);

        $this->assertDatabaseHas('kelas', [
            'tenant_id' => $tenantId,
            'id' => 'xi-b-mipa',
            'nama' => 'XI B MIPA',
            'grade' => 'XI',
            'suffix' => 'B MIPA',
            'angkatan' => '2025',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'is_active' => true,
        ]);
        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'kelas' => 'xi-b-mipa',
            'status' => 'active',
            'angkatan' => '2025',
        ]);
        $this->assertDatabaseHas('student_class_histories', [
            'tenant_id' => $tenantId,
            'student_id' => $student->id,
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'class_id' => 'xi-b-mipa',
            'status' => 'active',
            'source' => 'auto_rollover',
        ]);
    }

    public function test_period_change_rejects_legacy_manual_rollover_bypass(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-manual-bypass@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-manual-bypass@example.com', 'x-a', [
            'angkatan' => '2025',
        ]);

        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'xi-a', 'XI A', 'XI', 'A', '2025', '2026/2027', 'Ganjil');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');

        Sanctum::actingAs($admin);
        $response = $this->postJson('/api/admin/academic-period/apply', $this->periodPayload('2026/2027', 'Ganjil', [
            'manual_rollover_completed' => true,
            'calendar_confirmed' => true,
        ]));

        $response->assertStatus(409)
            ->assertJsonPath('error', 'Perubahan tahun ajaran harus dijalankan melalui rollover otomatis dari Pengaturan Akademik.');

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
        ]);
    }

    public function test_active_period_roster_repair_previews_and_restores_profiles(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-roster-repair@example.com', 'admin');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-roster-repair@example.com', 'xi-a', [
            'angkatan' => '2024',
        ]);
        $outsidePeriodStudent = $this->createUserWithProfile($tenantId, 'siswa', 'student-outside-roster-repair@example.com', 'xi-a', [
            'angkatan' => '2024',
        ]);

        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'xi-a', 'XI A', 'XI', 'A', '2024', '2025/2026', 'Genap');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');
        $this->insertClassSnapshot($tenantId, $student->id, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap', 'active');

        Sanctum::actingAs($admin);
        $preview = $this->postJson('/api/admin/academic-period/restore-roster', ['apply' => false]);

        $preview->assertOk()
            ->assertJsonPath('data.dry_run', true)
            ->assertJsonPath('data.preview.snapshot_students', 1)
            ->assertJsonPath('data.preview.would_restore', 1)
            ->assertJsonPath('data.preview.would_mark_outside_period', 1);

        $apply = $this->postJson('/api/admin/academic-period/restore-roster', ['apply' => true]);

        $apply->assertOk()
            ->assertJsonPath('data.period_snapshot_restored', true)
            ->assertJsonPath('data.student_profile_restores', 1)
            ->assertJsonPath('data.student_profiles_outside_period', 1);

        $this->assertDatabaseHas('profiles', [
            'id' => $student->id,
            'tenant_id' => $tenantId,
            'kelas' => 'x-a',
            'status' => 'active',
            'angkatan' => '2025',
        ]);
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
            'source' => 'period_snapshot_restore',
        ]);
    }

    public function test_roster_repair_keeps_students_created_inside_period_after_base_snapshot(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-roster-new-student@example.com', 'admin');
        $originalStudent = $this->createUserWithProfile($tenantId, 'siswa', 'student-original-snapshot@example.com', 'x-a', [
            'angkatan' => '2025',
        ]);
        $newStudent = $this->createUserWithProfile($tenantId, 'siswa', 'student-created-inside-period@example.com', 'x-b', [
            'angkatan' => '2025',
        ]);

        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'x-b', 'X B', 'X', 'B', '2025', '2025/2026', 'Genap');
        $this->insertSettingsPeriod($tenantId, '2025/2026', 'Genap');
        $this->insertClassSnapshot($tenantId, $originalStudent->id, 'x-a', 'X A', 'X', 'A', '2025', '2025/2026', 'Genap', 'active', 'before_period_change');
        $this->insertClassSnapshot($tenantId, $newStudent->id, 'x-b', 'X B', 'X', 'B', '2025', '2025/2026', 'Genap', 'active', 'profile_create');

        Sanctum::actingAs($admin);
        $preview = $this->postJson('/api/admin/academic-period/restore-roster', ['apply' => false]);

        $preview->assertOk()
            ->assertJsonPath('data.preview.snapshot_students', 2)
            ->assertJsonPath('data.preview.would_mark_outside_period', 0);

        $apply = $this->postJson('/api/admin/academic-period/restore-roster', ['apply' => true]);

        $apply->assertOk()
            ->assertJsonPath('data.student_profiles_outside_period', 0);

        $this->assertDatabaseHas('profiles', [
            'id' => $newStudent->id,
            'tenant_id' => $tenantId,
            'kelas' => 'x-b',
            'status' => 'active',
            'angkatan' => '2025',
        ]);
    }

    public function test_academic_summary_and_student_options_follow_requested_academic_year_snapshots(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-13 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-summary-period@example.com', 'admin');
        $alumniNow = $this->createUserWithProfile($tenantId, 'siswa', 'student-summary-alumni@example.com', '', [
            'nama' => 'Alumni Sekarang',
            'status' => 'alumni',
            'angkatan' => '2023',
            'tahun_lulus' => 2026,
        ]);
        $activeNow = $this->createUserWithProfile($tenantId, 'siswa', 'student-summary-active@example.com', 'x-a', [
            'nama' => 'Siswa Aktif',
            'angkatan' => '2026',
        ]);

        $this->insertClass($tenantId, 'xii-a', 'XII A', 'XII', 'A', '2023', '2025/2026', 'Genap');
        $this->insertClass($tenantId, 'x-a', 'X A', 'X', 'A', '2026', '2026/2027', 'Ganjil');
        $this->insertSettingsPeriod($tenantId, '2026/2027', 'Ganjil');
        $this->insertClassSnapshot($tenantId, $alumniNow->id, 'xii-a', 'XII A', 'XII', 'A', '2023', '2025/2026', 'Genap', 'active');
        $this->insertClassSnapshot($tenantId, $alumniNow->id, '', '', null, null, '2023', '2026/2027', 'Ganjil', 'alumni', 'auto_rollover');
        $this->insertClassSnapshot($tenantId, $activeNow->id, 'x-a', 'X A', 'X', 'A', '2026', '2026/2027', 'Ganjil', 'active');

        Sanctum::actingAs($admin);

        $pastSummary = $this->getJson('/api/admin/academic-summary?tahun_ajaran=2025/2026&include_students=false');
        $pastSummary->assertOk();
        $pastClasses = collect($pastSummary->json('data.kelas'))->pluck('id')->all();
        $this->assertContains('xii-a', $pastClasses);
        $this->assertNotContains('x-a', $pastClasses);

        $currentSummary = $this->getJson('/api/admin/academic-summary?tahun_ajaran=2026/2027&include_students=false');
        $currentSummary->assertOk();
        $currentClasses = collect($currentSummary->json('data.kelas'))->pluck('id')->all();
        $this->assertContains('x-a', $currentClasses);
        $this->assertNotContains('xii-a', $currentClasses);

        $pastOptions = $this->getJson('/api/admin/student-options?tahun_ajaran=2025/2026&status=active&all=1');
        $pastOptions->assertOk();
        $pastRows = collect($pastOptions->json('data.rows'));
        $this->assertTrue($pastRows->contains(fn ($row) => $row['id'] === $alumniNow->id && $row['kelas'] === 'xii-a'));

        $currentOptions = $this->getJson('/api/admin/student-options?tahun_ajaran=2026/2027&status=active&all=1');
        $currentOptions->assertOk();
        $currentRows = collect($currentOptions->json('data.rows'));
        $this->assertFalse($currentRows->contains(fn ($row) => $row['id'] === $alumniNow->id));
        $this->assertTrue($currentRows->contains(fn ($row) => $row['id'] === $activeNow->id && $row['kelas'] === 'x-a'));

        $currentDashboard = $this->getJson('/api/admin/dashboard-summary?tahun_ajaran=2026/2027');
        $currentDashboard->assertOk()
            ->assertJsonPath('data.siswa', 1)
            ->assertJsonPath('data.kelas', 1);
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

    private function insertClassStructure(
        string $tenantId,
        string $classId,
        string $teacherId,
        string $teacherName,
        ?string $leaderId = null,
        ?string $leaderName = null
    ): void {
        DB::table('kelas_struktur')->insert([
            'kelas_id' => $classId,
            'tenant_id' => $tenantId,
            'wali_guru_id' => $teacherId,
            'wali_guru_nama' => $teacherName,
            'ketua_siswa_id' => $leaderId,
            'ketua_siswa_nama' => $leaderName,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertSchedule(
        string $tenantId,
        string $id,
        string $classId,
        string $teacherId,
        string $mapel,
        string $day,
        string $start,
        string $end,
        string $year,
        string $semester
    ): void {
        DB::table('jadwal')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'kelas_id' => $classId,
            'hari' => $day,
            'mapel' => $mapel,
            'guru_id' => $teacherId,
            'guru_nama' => 'guru test',
            'jam_mulai' => $start,
            'jam_selesai' => $end,
            'tahun_ajaran' => $year,
            'semester' => $semester,
            'periode_berlaku' => 'tahunan',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertEskul(
        string $tenantId,
        string $id,
        string $name,
        string $year,
        string $semester
    ): void {
        DB::table('ekskul')->insert([
            'id' => $id,
            'tenant_id' => $tenantId,
            'nama' => $name,
            'keterangan' => 'Katalog ekskul periode sumber.',
            'hari' => 'Sabtu',
            'jam_mulai' => '08:00',
            'jam_selesai' => '10:00',
            'registration_deadline_at' => Carbon::parse('2026-06-20 23:59:00', 'Asia/Jakarta'),
            'tahun_ajaran' => $year,
            'semester' => $semester,
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
