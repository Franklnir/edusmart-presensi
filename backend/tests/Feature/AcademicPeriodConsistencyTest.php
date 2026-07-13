<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Academic\AcademicPeriodLifecycleService;
use App\Services\Academic\AcademicReferenceConsistencyService;
use App\Services\Academic\AcademicRolloverService;
use App\Support\AcademicPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class AcademicPeriodConsistencyTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_annual_schedule_remains_visible_when_active_semester_changes(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GENAP);
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-schedule-year@example.com', 'X-A');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-schedule-year@example.com', 'X-A');
        $this->seedClass($tenantId, 'X-A');

        DB::table('jadwal')->insert([
            'id' => 'annual-schedule-odd',
            'tenant_id' => $tenantId,
            'kelas_id' => 'X-A',
            'hari' => 'Senin',
            'mapel' => 'Matematika',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Guru Jadwal Tahunan',
            'jam_mulai' => '07:00:00',
            'jam_selesai' => '08:00:00',
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
            'periode_berlaku' => 'tahunan',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ([$teacher, $student] as $actor) {
            $response = $this->actingAs($actor)->postJson('/api/db', [
                'table' => 'jadwal',
                'action' => 'select',
                'columns' => 'id,kelas_id,mapel,tahun_ajaran,semester,periode_berlaku',
            ]);

            $response->assertOk();
            $this->assertSame(
                ['annual-schedule-odd'],
                collect($response->json('data') ?? [])->pluck('id')->all()
            );
        }
    }

    public function test_report_cards_are_isolated_by_term_and_archive_write_is_rejected(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-report-term@example.com', '');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-report-term@example.com', 'X-A');
        $this->seedClass($tenantId, 'X-A');

        $payload = [
            'table' => 'rapot_siswa',
            'action' => 'upsert',
            'onConflict' => 'tenant_id,siswa_id,kelas_id,tahun_pelajaran,semester,jenis',
            'payload' => [
                'id' => (string) Str::uuid(),
                'siswa_id' => $student->id,
                'kelas_id' => 'X-A',
                'jenis' => 'uts',
                'semester' => AcademicPeriod::SEMESTER_GANJIL,
                'tahun_pelajaran' => '2026/2027',
                'jumlah' => 800,
                'rata_rata' => 80,
            ],
        ];

        $this->actingAs($admin)->postJson('/api/db', $payload)->assertOk();

        $archiveAttempt = $payload;
        $archiveAttempt['payload']['id'] = (string) Str::uuid();
        $archiveAttempt['payload']['semester'] = AcademicPeriod::SEMESTER_GENAP;
        $this->actingAs($admin)
            ->postJson('/api/db', $archiveAttempt)
            ->assertStatus(409)
            ->assertJsonPath('code', 'academic_period_locked');

        DB::table('settings')
            ->where('tenant_id', $tenantId)
            ->update(['semester_aktif' => AcademicPeriod::SEMESTER_GENAP, 'updated_at' => now()]);

        $genapPayload = $payload;
        $genapPayload['payload']['id'] = (string) Str::uuid();
        $genapPayload['payload']['semester'] = AcademicPeriod::SEMESTER_GENAP;
        $this->actingAs($admin)->postJson('/api/db', $genapPayload)->assertOk();

        $rows = DB::table('rapot_siswa')
            ->where('tenant_id', $tenantId)
            ->where('siswa_id', $student->id)
            ->where('tahun_pelajaran', '2026/2027')
            ->where('jenis', 'uts')
            ->orderBy('semester')
            ->get();

        $this->assertCount(2, $rows);
        $this->assertEqualsCanonicalizing(
            [AcademicPeriod::SEMESTER_GANJIL, AcademicPeriod::SEMESTER_GENAP],
            $rows->pluck('semester')->all()
        );
    }

    public function test_manual_subject_scores_are_server_scoped_and_isolated_by_term(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-manual-score-term@example.com', 'X-A');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-manual-score-term@example.com', 'X-A');
        $this->seedClass($tenantId, 'X-A');

        $payload = [
            'table' => 'guru_mapel_manual_nilai',
            'action' => 'upsert',
            'onConflict' => 'tenant_id,guru_id,siswa_id,kelas_id,mapel,tahun_ajaran,semester',
            'payload' => [
                'id' => (string) Str::uuid(),
                'siswa_id' => $student->id,
                'kelas_id' => 'X-A',
                'mapel' => 'Matematika',
                'tahun_ajaran' => '2026/2027',
                'nilai_manual' => 81,
                'nilai_uts_manual' => 78,
                'nilai_uas_manual' => 84,
            ],
        ];

        $spoofedPayload = $payload;
        $spoofedPayload['payload']['semester'] = AcademicPeriod::SEMESTER_GENAP;
        $this->actingAs($teacher)
            ->postJson('/api/db', $spoofedPayload)
            ->assertStatus(409)
            ->assertJsonPath('code', 'academic_period_locked');

        $this->actingAs($teacher)->postJson('/api/db', $payload)->assertOk();

        $invalidPayload = $payload;
        $invalidPayload['payload']['id'] = (string) Str::uuid();
        $invalidPayload['payload']['nilai_uts_manual'] = 101;
        $this->actingAs($teacher)
            ->postJson('/api/db', $invalidPayload)
            ->assertStatus(422);

        $ganjilRow = DB::table('guru_mapel_manual_nilai')
            ->where('tenant_id', $tenantId)
            ->where('guru_id', $teacher->id)
            ->where('siswa_id', $student->id)
            ->first();
        $this->assertSame(AcademicPeriod::SEMESTER_GANJIL, $ganjilRow?->semester);

        DB::table('settings')
            ->where('tenant_id', $tenantId)
            ->update(['semester_aktif' => AcademicPeriod::SEMESTER_GENAP, 'updated_at' => now()]);

        $genapPayload = $payload;
        $genapPayload['payload']['id'] = (string) Str::uuid();
        $genapPayload['payload']['nilai_manual'] = 88;
        $genapPayload['payload']['nilai_uts_manual'] = 86;
        $genapPayload['payload']['nilai_uas_manual'] = 92;
        $this->actingAs($teacher)->postJson('/api/db', $genapPayload)->assertOk();

        $rows = DB::table('guru_mapel_manual_nilai')
            ->where('tenant_id', $tenantId)
            ->where('guru_id', $teacher->id)
            ->where('siswa_id', $student->id)
            ->where('tahun_ajaran', '2026/2027')
            ->orderBy('semester')
            ->get();

        $this->assertCount(2, $rows);
        $this->assertEqualsCanonicalizing(
            [AcademicPeriod::SEMESTER_GANJIL, AcademicPeriod::SEMESTER_GENAP],
            $rows->pluck('semester')->all()
        );
        $this->assertSame(81.0, (float) $rows->firstWhere('semester', AcademicPeriod::SEMESTER_GANJIL)?->nilai_manual);
        $this->assertSame(88.0, (float) $rows->firstWhere('semester', AcademicPeriod::SEMESTER_GENAP)?->nilai_manual);
        $this->assertSame(78.0, (float) $rows->firstWhere('semester', AcademicPeriod::SEMESTER_GANJIL)?->nilai_uts_manual);
        $this->assertSame(92.0, (float) $rows->firstWhere('semester', AcademicPeriod::SEMESTER_GENAP)?->nilai_uas_manual);
    }

    public function test_subject_weight_sources_are_isolated_by_term(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-weight-source@example.com', 'X-A');
        $this->seedClass($tenantId, 'X-A');

        DB::table('jadwal')->insert([
            'id' => 'weight-source-schedule',
            'tenant_id' => $tenantId,
            'kelas_id' => 'X-A',
            'hari' => 'Senin',
            'mapel' => 'Matematika',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Guru Sumber Nilai',
            'jam_mulai' => '07:00:00',
            'jam_selesai' => '08:00:00',
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
            'periode_berlaku' => 'tahunan',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $payload = [
            'table' => 'guru_mapel_bobot',
            'action' => 'upsert',
            'onConflict' => 'tenant_id,guru_id,mapel,tahun_ajaran,semester',
            'payload' => [
                'id' => (string) Str::uuid(),
                'mapel' => 'Matematika',
                'tahun_ajaran' => '2026/2027',
                'semester' => AcademicPeriod::SEMESTER_GANJIL,
                'bobot_tugas_pr' => 25,
                'bobot_quiz_reguler' => 15,
                'bobot_quiz_uts' => 20,
                'bobot_quiz_uas' => 30,
                'sumber_uts' => 'manual',
                'sumber_uas' => 'manual',
                'jenis_manual' => 'nilai_tambah',
                'label_manual' => null,
            ],
        ];

        $this->actingAs($teacher)->postJson('/api/db', $payload)->assertOk();

        $ganjilRow = DB::table('guru_mapel_bobot')
            ->where('tenant_id', $tenantId)
            ->where('guru_id', $teacher->id)
            ->where('mapel', 'Matematika')
            ->first();
        $this->assertSame(AcademicPeriod::SEMESTER_GANJIL, $ganjilRow?->semester);
        $this->assertSame('manual', $ganjilRow?->sumber_uts);
        $this->assertSame('manual', $ganjilRow?->sumber_uas);
        $this->assertSame('nilai_tambah', $ganjilRow?->jenis_manual);

        $archivePayload = $payload;
        $archivePayload['payload']['id'] = (string) Str::uuid();
        $archivePayload['payload']['semester'] = AcademicPeriod::SEMESTER_GENAP;
        $this->actingAs($teacher)
            ->postJson('/api/db', $archivePayload)
            ->assertStatus(409)
            ->assertJsonPath('code', 'academic_period_locked');
    }

    public function test_promoted_student_reads_previous_year_schedule_tasks_and_quiz_only_for_historical_class(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-history-read@example.com', 'XI-A');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-history-read@example.com', 'XI-A');
        $this->seedClass($tenantId, 'X-A');
        $this->seedClass($tenantId, 'X-B');
        $this->seedClass($tenantId, 'XI-A');
        $this->seedStudentClassHistory(
            $tenantId,
            $student->id,
            'X-A',
            '2025/2026',
            AcademicPeriod::SEMESTER_GENAP
        );

        DB::table('jadwal')->insert([
            [
                'id' => 'historical-schedule-own',
                'tenant_id' => $tenantId,
                'kelas_id' => 'X-A',
                'hari' => 'Senin',
                'mapel' => 'Biologi',
                'guru_id' => $teacher->id,
                'guru_nama' => 'Guru Riwayat',
                'jam_mulai' => '08:00:00',
                'jam_selesai' => '09:00:00',
                'tahun_ajaran' => '2025/2026',
                'semester' => AcademicPeriod::SEMESTER_GENAP,
                'periode_berlaku' => 'tahunan',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => 'historical-schedule-other',
                'tenant_id' => $tenantId,
                'kelas_id' => 'X-B',
                'hari' => 'Selasa',
                'mapel' => 'Fisika',
                'guru_id' => $teacher->id,
                'guru_nama' => 'Guru Riwayat',
                'jam_mulai' => '09:00:00',
                'jam_selesai' => '10:00:00',
                'tahun_ajaran' => '2025/2026',
                'semester' => AcademicPeriod::SEMESTER_GENAP,
                'periode_berlaku' => 'tahunan',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::table('tugas')->insert([
            [
                'kelas' => 'X-A',
                'judul' => 'Tugas Riwayat Milik Siswa',
                'mapel' => 'Biologi',
                'created_by' => $teacher->id,
                'tahun_ajaran' => '2025/2026',
                'semester' => AcademicPeriod::SEMESTER_GENAP,
                'created_at' => now(),
                'updated_at' => now(),
                'tenant_id' => $tenantId,
            ],
            [
                'kelas' => 'X-B',
                'judul' => 'Tugas Kelas Lain',
                'mapel' => 'Fisika',
                'created_by' => $teacher->id,
                'tahun_ajaran' => '2025/2026',
                'semester' => AcademicPeriod::SEMESTER_GENAP,
                'created_at' => now(),
                'updated_at' => now(),
                'tenant_id' => $tenantId,
            ],
        ]);

        DB::table('quizzes')->insert([
            [
                'id' => 'historical-quiz-own',
                'tenant_id' => $tenantId,
                'guru_id' => $teacher->id,
                'kelas_id' => 'X-A',
                'mapel' => 'Biologi',
                'nama' => 'Quiz Riwayat Milik Siswa',
                'tahun_ajaran' => '2025/2026',
                'semester' => AcademicPeriod::SEMESTER_GENAP,
                'is_live' => false,
                'is_active' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => 'historical-quiz-other',
                'tenant_id' => $tenantId,
                'guru_id' => $teacher->id,
                'kelas_id' => 'X-B',
                'mapel' => 'Fisika',
                'nama' => 'Quiz Kelas Lain',
                'tahun_ajaran' => '2025/2026',
                'semester' => AcademicPeriod::SEMESTER_GENAP,
                'is_live' => false,
                'is_active' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $schedule = $this->actingAs($student)->postJson('/api/db', [
            'table' => 'jadwal',
            'action' => 'select',
            'columns' => 'id,kelas_id,tahun_ajaran',
            'filters' => ['eq' => ['tahun_ajaran' => '2025/2026']],
        ]);
        $schedule->assertOk();
        $this->assertSame(['historical-schedule-own'], collect($schedule->json('data') ?? [])->pluck('id')->all());

        $tasks = $this->actingAs($student)->postJson('/api/db', [
            'table' => 'tugas',
            'action' => 'select',
            'columns' => 'id,kelas,judul,tahun_ajaran,semester',
            'filters' => [
                'eq' => [
                    'tahun_ajaran' => '2025/2026',
                    'semester' => AcademicPeriod::SEMESTER_GENAP,
                ],
            ],
        ]);
        $tasks->assertOk();
        $this->assertSame(['Tugas Riwayat Milik Siswa'], collect($tasks->json('data') ?? [])->pluck('judul')->all());

        $quizDashboard = $this->actingAs($student)->getJson(
            '/api/quiz/dashboard?tahun_ajaran=2025%2F2026&semester=Genap'
        );
        $quizDashboard->assertOk();
        $this->assertSame(
            ['historical-quiz-own'],
            collect($quizDashboard->json('data.rows') ?? [])->pluck('id')->all()
        );

        $this->actingAs($student)
            ->getJson('/api/quiz/historical-quiz-own/detail')
            ->assertOk();

        $this->actingAs($student)
            ->postJson('/api/quiz/start', ['quiz_id' => 'historical-quiz-own'])
            ->assertStatus(403)
            ->assertJsonPath('error', 'Quiz bukan periode akademik aktif');
    }

    public function test_teacher_mutation_preserves_historical_assignments_and_clears_only_active_period(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-teacher-mutation@example.com', 'ADMIN');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-mutation@example.com', '');
        $this->seedClass($tenantId, 'X-HISTORY');
        $this->seedClass($tenantId, 'X-A');

        foreach ([
            ['id' => 'schedule-history', 'year' => '2025/2026', 'semester' => AcademicPeriod::SEMESTER_GENAP],
            ['id' => 'schedule-active', 'year' => '2026/2027', 'semester' => AcademicPeriod::SEMESTER_GANJIL],
        ] as $row) {
            DB::table('jadwal')->insert([
                'id' => $row['id'],
                'tenant_id' => $tenantId,
                'kelas_id' => 'X-A',
                'hari' => 'Senin',
                'mapel' => 'Matematika',
                'guru_id' => $teacher->id,
                'guru_nama' => 'Guru Mutasi',
                'jam_mulai' => '07:00:00',
                'jam_selesai' => '08:00:00',
                'tahun_ajaran' => $row['year'],
                'semester' => $row['semester'],
                'periode_berlaku' => 'tahunan',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->seedClassStructure($tenantId, 'X-HISTORY', '2025/2026', AcademicPeriod::SEMESTER_GENAP, [
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'Guru Mutasi',
        ]);
        $this->seedClassStructure($tenantId, 'X-A', '2026/2027', AcademicPeriod::SEMESTER_GANJIL, [
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'Guru Mutasi',
        ]);

        $this->actingAs($admin)
            ->patchJson('/api/admin/users/'.$teacher->id.'/status', [
                'status' => 'mutasi',
                'reason' => 'Pindah mengajar ke sekolah lain.',
                'role' => 'guru',
            ])
            ->assertOk();

        $this->assertDatabaseHas('jadwal', [
            'id' => 'schedule-history',
            'tenant_id' => $tenantId,
            'tahun_ajaran' => '2025/2026',
            'guru_id' => $teacher->id,
        ]);
        $this->assertDatabaseHas('jadwal', [
            'id' => 'schedule-active',
            'tenant_id' => $tenantId,
            'tahun_ajaran' => '2026/2027',
            'guru_id' => null,
        ]);
        $this->assertDatabaseHas('kelas_struktur', [
            'tenant_id' => $tenantId,
            'kelas_id' => 'X-HISTORY',
            'tahun_ajaran' => '2025/2026',
            'wali_guru_id' => $teacher->id,
        ]);
        $this->assertDatabaseHas('kelas_struktur', [
            'tenant_id' => $tenantId,
            'kelas_id' => 'X-A',
            'tahun_ajaran' => '2026/2027',
            'wali_guru_id' => null,
        ]);
    }

    public function test_student_mutation_preserves_historical_class_leader(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-student-mutation@example.com', 'ADMIN');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-mutation@example.com', 'X-A');
        $this->seedClass($tenantId, 'X-HISTORY');
        $this->seedClass($tenantId, 'X-A');

        $this->seedClassStructure($tenantId, 'X-HISTORY', '2025/2026', AcademicPeriod::SEMESTER_GENAP, [
            'ketua_siswa_id' => $student->id,
            'ketua_siswa_nama' => 'Ketua Lama',
        ]);
        $this->seedClassStructure($tenantId, 'X-A', '2026/2027', AcademicPeriod::SEMESTER_GANJIL, [
            'ketua_siswa_id' => $student->id,
            'ketua_siswa_nama' => 'Ketua Aktif',
        ]);

        $this->actingAs($admin)
            ->patchJson('/api/admin/users/'.$student->id.'/status', [
                'status' => 'mutasi',
                'reason' => 'Pindah mengikuti orang tua.',
                'role' => 'siswa',
            ])
            ->assertOk();

        $this->assertDatabaseHas('kelas_struktur', [
            'tenant_id' => $tenantId,
            'kelas_id' => 'X-HISTORY',
            'tahun_ajaran' => '2025/2026',
            'ketua_siswa_id' => $student->id,
            'ketua_siswa_nama' => 'Ketua Lama',
        ]);
        $this->assertDatabaseHas('kelas_struktur', [
            'tenant_id' => $tenantId,
            'kelas_id' => 'X-A',
            'tahun_ajaran' => '2026/2027',
            'ketua_siswa_id' => null,
            'ketua_siswa_nama' => null,
        ]);
    }

    public function test_archive_mutation_requires_scoped_correction_session_and_is_tenant_isolated(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-correction@example.com', 'ADMIN');
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-correction@example.com', 'X-A');

        $taskId = DB::table('tugas')->insertGetId([
            'tenant_id' => $tenantId,
            'kelas' => 'X-A',
            'judul' => 'Judul Arsip',
            'mapel' => 'Biologi',
            'created_by' => $teacher->id,
            'tahun_ajaran' => '2025/2026',
            'semester' => AcademicPeriod::SEMESTER_GENAP,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $locked = $this->actingAs($admin)->postJson('/api/db', [
            'table' => 'tugas',
            'action' => 'update',
            'filters' => ['eq' => ['id' => $taskId, 'tahun_ajaran' => '2025/2026']],
            'payload' => ['judul' => 'Tidak Boleh Berubah'],
        ]);
        $locked->assertStatus(409)->assertJsonPath('code', 'academic_period_locked');

        $periods = $this->actingAs($admin)->getJson('/api/admin/academic-periods');
        $periods->assertOk();
        $archivedTerm = collect($periods->json('data.years') ?? [])
            ->firstWhere('label', '2025/2026')['terms'][1] ?? null;
        $this->assertIsArray($archivedTerm);

        $session = $this->actingAs($admin)->postJson('/api/admin/academic-periods/correction-sessions', [
            'academic_term_id' => $archivedTerm['id'],
            'reason' => 'Memperbaiki judul tugas arsip berdasarkan berita acara sekolah.',
            'allowed_scopes' => ['tugas'],
            'duration_minutes' => 30,
        ]);
        $session->assertCreated();
        $sessionId = (string) $session->json('data.id');
        $this->assertNotSame('', $sessionId);

        $updated = $this->actingAs($admin)
            ->withHeader('X-Academic-Correction-Session', $sessionId)
            ->postJson('/api/db', [
                'table' => 'tugas',
                'action' => 'update',
                'filters' => [
                    'eq' => [
                        'id' => $taskId,
                        'tahun_ajaran' => '2025/2026',
                        'semester' => AcademicPeriod::SEMESTER_GENAP,
                    ],
                ],
                'payload' => ['judul' => 'Judul Arsip Terkoreksi'],
            ]);
        $updated->assertOk();
        $this->assertDatabaseHas('tugas', ['id' => $taskId, 'judul' => 'Judul Arsip Terkoreksi']);

        $audit = DB::table('audit_log')
            ->where('tenant_id', $tenantId)
            ->where('table_name', 'tugas')
            ->where('action', 'UPDATE')
            ->latest('timestamp')
            ->first();
        $this->assertNotNull($audit);
        $auditAfter = json_decode((string) $audit->new_data, true);
        $this->assertSame('correction', $auditAfter['academic_context']['mode'] ?? null);
        $this->assertSame($sessionId, $auditAfter['academic_context']['correction_session_id'] ?? null);
        $this->assertSame(
            'Memperbaiki judul tugas arsip berdasarkan berita acara sekolah.',
            $auditAfter['academic_context']['reason'] ?? null
        );

        DB::table('academic_correction_sessions')->where('id', $sessionId)->update([
            'expires_at' => now()->subMinute(),
        ]);
        $this->actingAs($admin)
            ->withHeader('X-Academic-Correction-Session', $sessionId)
            ->postJson('/api/db', [
                'table' => 'tugas',
                'action' => 'update',
                'filters' => ['eq' => ['id' => $taskId]],
                'payload' => ['judul' => 'Tidak Boleh Setelah Kedaluwarsa'],
            ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'academic_correction_session_invalid');
        $this->assertDatabaseHas('academic_correction_sessions', ['id' => $sessionId, 'status' => 'expired']);
        $this->assertDatabaseHas('tugas', ['id' => $taskId, 'judul' => 'Judul Arsip Terkoreksi']);

        $otherTenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $otherTenantId,
            'name' => 'Tenant Lain',
            'slug' => 'tenant-lain',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $otherTermId = (string) DB::table('academic_terms')
            ->where('tenant_id', $otherTenantId)
            ->value('id');
        if ($otherTermId === '') {
            $otherYearId = (string) Str::uuid();
            $otherTermId = (string) Str::uuid();
            DB::table('academic_years')->insert([
                'id' => $otherYearId,
                'tenant_id' => $otherTenantId,
                'label' => '2025/2026',
                'starts_at' => '2025-07-01',
                'ends_at' => '2026-06-30',
                'status' => 'closed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('academic_terms')->insert([
                'id' => $otherTermId,
                'tenant_id' => $otherTenantId,
                'academic_year_id' => $otherYearId,
                'semester' => AcademicPeriod::SEMESTER_GENAP,
                'starts_at' => '2026-01-01',
                'ends_at' => '2026-06-30',
                'status' => 'closed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $this->actingAs($admin)
            ->postJson('/api/admin/academic-periods/correction-sessions', [
                'academic_term_id' => $otherTermId,
                'reason' => 'Percobaan akses periode milik tenant lain harus ditolak.',
                'allowed_scopes' => ['tugas'],
            ])
            ->assertNotFound();
    }

    public function test_closed_period_cannot_be_reactivated_and_term_ranges_cannot_overlap(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-07-11 10:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-lifecycle@example.com', 'ADMIN');
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);

        $this->actingAs($admin)->getJson('/api/admin/academic-periods')->assertOk();

        $overlap = $this->actingAs($admin)->postJson('/api/admin/academic-period/apply', [
            'tahun_ajaran' => '2026/2027',
            'semester_aktif' => AcademicPeriod::SEMESTER_GANJIL,
            'periode_ganjil_mulai' => '2026-07-01',
            'periode_ganjil_selesai' => '2027-02-28',
            'periode_genap_mulai' => '2027-01-01',
            'periode_genap_selesai' => '2027-06-30',
            'calendar_confirmed' => true,
        ]);
        $overlap->assertStatus(422)->assertJsonPath('code', 'academic_period_overlap');

        DB::table('settings')->where('tenant_id', $tenantId)->update([
            'tahun_ajaran' => '2027/2028',
            'semester_aktif' => AcademicPeriod::SEMESTER_GANJIL,
        ]);

        $this->actingAs($admin)->getJson('/api/admin/academic-periods')->assertOk();

        $reactivate = $this->actingAs($admin)->postJson('/api/admin/academic-period/apply', [
            'tahun_ajaran' => '2026/2027',
            'semester_aktif' => AcademicPeriod::SEMESTER_GANJIL,
            'periode_ganjil_mulai' => '2026-07-01',
            'periode_ganjil_selesai' => '2026-12-31',
            'periode_genap_mulai' => '2027-01-01',
            'periode_genap_selesai' => '2027-06-30',
            'calendar_confirmed' => true,
        ]);
        $reactivate->assertStatus(409)->assertJsonPath('code', 'academic_period_closed');
    }

    public function test_tenant_payload_and_filters_cannot_escape_resolved_tenant(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-tenant-scope@example.com', 'ADMIN');
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);

        $otherTenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $otherTenantId,
            'name' => 'Sekolah Tenant B',
            'slug' => 'tenant-b-isolation',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $foreignTaskId = DB::table('tugas')->insertGetId([
            'tenant_id' => $otherTenantId,
            'kelas' => 'X-B',
            'judul' => 'Rahasia Tenant B',
            'mapel' => 'Biologi',
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $read = $this->actingAs($admin)->postJson('/api/db', [
            'table' => 'tugas',
            'action' => 'select',
            'filters' => ['eq' => ['id' => $foreignTaskId, 'tenant_id' => $otherTenantId]],
        ]);
        $read->assertOk();
        $this->assertSame([], $read->json('data'));

        $this->actingAs($admin)->postJson('/api/db', [
            'table' => 'tugas',
            'action' => 'insert',
            'payload' => [
                'tenant_id' => $otherTenantId,
                'kelas' => 'X-A',
                'judul' => 'Tetap Milik Tenant A',
                'mapel' => 'Biologi',
            ],
        ])->assertOk();
        $this->assertDatabaseHas('tugas', [
            'tenant_id' => $tenantId,
            'judul' => 'Tetap Milik Tenant A',
        ]);
        $this->assertDatabaseMissing('tugas', [
            'tenant_id' => $otherTenantId,
            'judul' => 'Tetap Milik Tenant A',
        ]);
    }

    public function test_period_activation_keeps_one_active_context_and_rollover_is_idempotent(): void
    {
        $tenantId = $this->defaultTenantId();
        $admin = $this->createUserWithProfile($tenantId, 'admin', 'admin-active-invariant@example.com', 'ADMIN');
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $lifecycle = app(AcademicPeriodLifecycleService::class);
        $lifecycle->listForTenant($tenantId);

        $genap = $this->periodPayload('2026/2027', AcademicPeriod::SEMESTER_GENAP);
        $lifecycle->activate($tenantId, $genap, (string) $admin->id);
        $future = $this->periodPayload('2027/2028', AcademicPeriod::SEMESTER_GANJIL);
        $lifecycle->activate($tenantId, $future, (string) $admin->id);

        $this->assertSame(1, DB::table('academic_years')->where('tenant_id', $tenantId)->where('status', 'active')->count());
        $this->assertSame(1, DB::table('academic_terms')->where('tenant_id', $tenantId)->where('status', 'active')->count());

        $sourceId = DB::table('academic_years')->where('tenant_id', $tenantId)->where('label', '2026/2027')->value('id');
        $targetId = DB::table('academic_years')->where('tenant_id', $tenantId)->where('label', '2027/2028')->value('id');
        $calls = 0;
        $rollover = app(AcademicRolloverService::class);
        DB::transaction(function () use ($rollover, $tenantId, $sourceId, $targetId, $admin, &$calls) {
            $rollover->execute(
                $tenantId,
                $sourceId,
                $targetId,
                '2026/2027',
                '2027/2028',
                (string) $admin->id,
                function () use (&$calls) {
                    $calls++;

                    return ['promoted_students' => 0];
                }
            );
        });

        try {
            DB::transaction(fn () => $rollover->execute(
                $tenantId,
                $sourceId,
                $targetId,
                '2026/2027',
                '2027/2028',
                (string) $admin->id,
                function () use (&$calls) {
                    $calls++;

                    return [];
                }
            ));
            $this->fail('Rollover kedua seharusnya ditolak oleh idempotency key.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('sudah pernah', $e->getMessage());
        }

        $this->assertSame(1, $calls);
        $this->assertSame(1, DB::table('academic_rollover_runs')->where('tenant_id', $tenantId)->count());
    }

    public function test_task_domain_endpoint_uses_server_tenant_and_period_and_conceals_other_tenants(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-01 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-task-domain@example.com', 'X-A');
        $this->seedClass($tenantId, 'X-A');
        DB::table('jadwal')->insert([
            'id' => 'task-domain-schedule',
            'tenant_id' => $tenantId,
            'kelas_id' => 'X-A',
            'hari' => 'Senin',
            'mapel' => 'Biologi',
            'guru_id' => $teacher->id,
            'guru_nama' => 'Guru Domain Tugas',
            'jam_mulai' => '07:00:00',
            'jam_selesai' => '08:00:00',
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GENAP,
            'periode_berlaku' => 'tahunan',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $otherTenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $otherTenantId,
            'name' => 'Tenant Domain B',
            'slug' => 'tenant-domain-b',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $created = $this->actingAs($teacher)->postJson('/api/tugas', [
            'tenant_id' => $otherTenantId,
            'kelas' => 'X-A',
            'mapel' => 'Biologi',
            'judul' => 'Tugas Domain Aman',
            'mulai' => '2026-07-31 07:00:00',
            'deadline' => '2026-08-10 16:00:00',
            'tahun_ajaran' => '2025/2026',
            'semester' => AcademicPeriod::SEMESTER_GENAP,
        ]);
        $created->assertCreated();
        $taskId = (string) $created->json('data.id');
        $this->assertDatabaseHas('tugas', [
            'id' => $taskId,
            'tenant_id' => $tenantId,
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
        ]);

        $foreignTaskId = DB::table('tugas')->insertGetId([
            'tenant_id' => $otherTenantId,
            'kelas' => 'X-A',
            'judul' => 'Tugas Rahasia Tenant B',
            'mapel' => 'Biologi',
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->actingAs($teacher)
            ->getJson('/api/tugas/'.$foreignTaskId)
            ->assertNotFound();

        DB::table('tugas')->where('id', $taskId)->update([
            'tahun_ajaran' => '2025/2026',
            'semester' => AcademicPeriod::SEMESTER_GENAP,
        ]);
        $this->actingAs($teacher)
            ->patchJson('/api/tugas/'.$taskId, ['judul' => 'Tidak Boleh Diubah'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'academic_period_locked');
    }

    public function test_student_submission_rejects_archive_and_stamps_server_period_snapshot(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-01 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-submit-domain@example.com', 'X-A');
        $student = $this->createUserWithProfile($tenantId, 'siswa', 'student-submit-domain@example.com', 'X-A');
        $this->seedClass($tenantId, 'X-A');

        $activeTaskId = DB::table('tugas')->insertGetId([
            'tenant_id' => $tenantId,
            'kelas' => 'X-A',
            'judul' => 'Tugas Aktif',
            'mapel' => 'Biologi',
            'mulai' => '2026-07-31 07:00:00',
            'deadline' => '2026-08-10 16:00:00',
            'created_by' => $teacher->id,
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $submitted = $this->actingAs($student)->postJson('/api/tugas/jawaban/submit', [
            'tugas_id' => $activeTaskId,
            'link_url' => 'https://example.test/jawaban-siswa',
            'tahun_ajaran' => '2025/2026',
            'semester' => AcademicPeriod::SEMESTER_GENAP,
        ]);
        $submitted->assertOk();
        $this->assertDatabaseHas('tugas_jawaban', [
            'tenant_id' => $tenantId,
            'tugas_id' => $activeTaskId,
            'user_id' => $student->id,
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
        ]);

        $archiveTaskId = DB::table('tugas')->insertGetId([
            'tenant_id' => $tenantId,
            'kelas' => 'X-A',
            'judul' => 'Tugas Arsip',
            'mapel' => 'Biologi',
            'mulai' => '2026-07-31 07:00:00',
            'deadline' => '2026-08-10 16:00:00',
            'created_by' => $teacher->id,
            'tahun_ajaran' => '2025/2026',
            'semester' => AcademicPeriod::SEMESTER_GENAP,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->actingAs($student)
            ->postJson('/api/tugas/jawaban/submit', ['tugas_id' => $archiveTaskId])
            ->assertStatus(409)
            ->assertJsonPath('code', 'academic_period_locked');
        $this->assertDatabaseMissing('tugas_jawaban', [
            'tenant_id' => $tenantId,
            'tugas_id' => $archiveTaskId,
            'user_id' => $student->id,
        ]);
    }

    public function test_reference_verifier_detects_drift_and_supports_strict_cutover_gate(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $context = app(AcademicPeriodLifecycleService::class)->currentContext($tenantId);

        $taskId = DB::table('tugas')->insertGetId([
            'tenant_id' => $tenantId,
            'kelas' => 'X-A',
            'judul' => 'Tugas Referensi',
            'mapel' => 'Biologi',
            'tahun_ajaran' => '2026/2027',
            'semester' => AcademicPeriod::SEMESTER_GANJIL,
            'academic_year_id' => $context['academic_year_id'],
            'academic_term_id' => $context['academic_term_id'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $service = app(AcademicReferenceConsistencyService::class);
        $clean = $service->inspect($tenantId);
        $this->assertSame(0, $clean['tables']['tugas']['issues']);

        DB::table('tugas')->where('id', $taskId)->update(['academic_term_id' => null]);
        $drift = $service->inspect($tenantId);
        $this->assertSame(1, $drift['tables']['tugas']['missing_academic_term_id']);
        $this->assertFalse($drift['ready_for_id_reads']);

        $this->artisan('academic:verify-period-refs', [
            '--tenant' => 'default',
            '--strict' => true,
        ])->assertExitCode(1);
    }

    public function test_homeroom_options_follow_historical_assignments_without_report_rows(): void
    {
        $tenantId = $this->defaultTenantId();
        $this->seedSettings($tenantId, '2026/2027', AcademicPeriod::SEMESTER_GANJIL);
        $teacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-homeroom-options@example.com', 'XI-A');
        $otherTeacher = $this->createUserWithProfile($tenantId, 'guru', 'teacher-other-homeroom@example.com', 'XI-B');
        foreach (['X-A', 'XI-A', 'XI-B'] as $classId) {
            $this->seedClass($tenantId, $classId);
        }
        $this->seedClassStructure($tenantId, 'X-A', '2025/2026', AcademicPeriod::SEMESTER_GENAP, [
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'Guru Wali Riwayat',
        ]);
        $this->seedClassStructure($tenantId, 'XI-A', '2026/2027', AcademicPeriod::SEMESTER_GANJIL, [
            'wali_guru_id' => $teacher->id,
            'wali_guru_nama' => 'Guru Wali Aktif',
        ]);
        $this->seedClassStructure($tenantId, 'XI-B', '2026/2027', AcademicPeriod::SEMESTER_GANJIL, [
            'wali_guru_id' => $otherTeacher->id,
            'wali_guru_nama' => 'Guru Lain',
        ]);

        $response = $this->actingAs($teacher)->getJson('/api/reports/homeroom-options');
        $response->assertOk();
        $rows = collect($response->json('data') ?? []);
        $this->assertSame(['2025/2026', '2026/2027'], $rows->pluck('tahun_ajaran')->sort()->values()->all());
        $this->assertSame(['X-A', 'XI-A'], $rows->pluck('kelas_id')->sort()->values()->all());
        $this->assertTrue((bool) $rows->firstWhere('tahun_ajaran', '2026/2027')['is_active']);
        $this->assertFalse((bool) $rows->firstWhere('tahun_ajaran', '2025/2026')['is_active']);
    }

    private function defaultTenantId(): string
    {
        $tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $this->assertNotSame('', $tenantId);

        return $tenantId;
    }

    private function createUserWithProfile(
        string $tenantId,
        string $role,
        string $email,
        string $classId
    ): User {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => $email,
            'password' => Hash::make('password123'),
        ]);

        DB::table('profiles')->insert([
            'id' => $user->id,
            'tenant_id' => $tenantId,
            'email' => $email,
            'nama' => $user->name,
            'role' => $role,
            'kelas' => $classId,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
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
    }

    private function periodPayload(string $year, string $semester): array
    {
        $ganjil = AcademicPeriod::make($year, AcademicPeriod::SEMESTER_GANJIL);
        $genap = AcademicPeriod::make($year, AcademicPeriod::SEMESTER_GENAP);

        return [
            'tahun_ajaran' => $year,
            'semester_aktif' => $semester,
            'periode_ganjil_mulai' => $ganjil['starts_at'],
            'periode_ganjil_selesai' => $ganjil['ends_at'],
            'periode_genap_mulai' => $genap['starts_at'],
            'periode_genap_selesai' => $genap['ends_at'],
        ];
    }

    private function seedClass(string $tenantId, string $classId): void
    {
        DB::table('kelas')->insert([
            'id' => $classId,
            'tenant_id' => $tenantId,
            'nama' => $classId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedStudentClassHistory(
        string $tenantId,
        string $studentId,
        string $classId,
        string $year,
        string $semester
    ): void {
        DB::table('student_class_histories')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'student_id' => $studentId,
            'class_id' => $classId,
            'class_name' => $classId,
            'tahun_ajaran' => $year,
            'semester' => $semester,
            'status' => 'active',
            'source' => 'before_period_change',
            'valid_from' => now()->subYear(),
            'created_at' => now()->subYear(),
            'updated_at' => now()->subYear(),
        ]);
    }

    private function seedClassStructure(
        string $tenantId,
        string $classId,
        string $year,
        string $semester,
        array $values = []
    ): void {
        DB::table('kelas_struktur')->insert(array_merge([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'kelas_id' => $classId,
            'tahun_ajaran' => $year,
            'semester' => $semester,
            'created_at' => now(),
            'updated_at' => now(),
        ], $values));
    }
}
