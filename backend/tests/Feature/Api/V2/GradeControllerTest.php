<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use App\Services\Academic\AcademicPeriodLifecycleService;
use App\Support\AcademicPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class GradeControllerTest extends TestCase
{
    use RefreshDatabase;

    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();
        config(['tenancy.allow_header_override' => true]);
        Cache::flush();

        $this->tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $this->assertNotSame('', $this->tenantId);
        $this->seedSettings('2026/2027', AcademicPeriod::SEMESTER_GANJIL);
    }

    public function test_teacher_can_read_only_own_tenant_and_own_weights(): void
    {
        $teacher = $this->createUser('guru');
        $otherTeacher = $this->createUser('guru');
        $this->insertWeight($teacher->id, 'Matematika');
        $this->insertWeight($otherTeacher->id, 'Biologi');

        Sanctum::actingAs($teacher);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/grades/weights?tahun_ajaran=2026/2027&semester=Ganjil')
            ->assertOk()
            ->assertJsonPath('academic_context.tahun_ajaran', '2026/2027')
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.mapel', 'Matematika')
            ->assertJsonMissing(['mapel' => 'Biologi']);
    }

    public function test_teacher_upsert_is_idempotent_and_server_scoped(): void
    {
        $teacher = $this->createUser('guru');
        Sanctum::actingAs($teacher);

        $payload = $this->weightPayload([
            'mapel' => 'Bahasa Indonesia',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
        ]);
        $headers = $this->tenantHeaders(['Idempotency-Key' => 'grade-weight-upsert-1']);

        $this->withHeaders($headers)
            ->putJson('/api/v2/grades/weights', $payload)
            ->assertOk()
            ->assertJsonPath('data.guru_id', $teacher->id)
            ->assertJsonPath('data.tahun_ajaran', '2026/2027')
            ->assertJsonPath('data.semester', 'Ganjil');

        $this->withHeaders($headers)
            ->putJson('/api/v2/grades/weights', $payload)
            ->assertOk()
            ->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame(1, DB::table('guru_mapel_bobot')
            ->where('tenant_id', $this->tenantId)
            ->where('guru_id', $teacher->id)
            ->where('mapel', 'Bahasa Indonesia')
            ->count());
        $this->assertDatabaseHas('audit_log', [
            'tenant_id' => $this->tenantId,
            'table_name' => 'guru_mapel_bobot',
            'record_id' => DB::table('guru_mapel_bobot')->where('guru_id', $teacher->id)->value('id'),
            'action' => 'INSERT',
        ]);
    }

    public function test_admin_can_upsert_for_a_teacher_in_the_same_tenant(): void
    {
        $admin = $this->createUser('admin');
        $teacher = $this->createUser('guru');
        Sanctum::actingAs($admin);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'admin-grade-weight-1']))
            ->putJson('/api/v2/grades/weights', $this->weightPayload([
                'guru_id' => $teacher->id,
                'mapel' => 'Fisika',
            ]))
            ->assertOk()
            ->assertJsonPath('data.guru_id', $teacher->id);
    }

    public function test_weights_over_one_hundred_percent_are_rejected(): void
    {
        $teacher = $this->createUser('guru');
        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'invalid-grade-weight-1']))
            ->putJson('/api/v2/grades/weights', $this->weightPayload([
                'bobot_tugas_pr' => 40,
                'bobot_quiz_reguler' => 30,
                'bobot_quiz_uts' => 20,
                'bobot_quiz_uas' => 20,
            ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('bobot_tugas_pr');
    }

    public function test_archive_weight_mutation_is_locked_without_correction_session(): void
    {
        $teacher = $this->createUser('guru');
        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'archive-grade-weight-1']))
            ->putJson('/api/v2/grades/weights', $this->weightPayload([
                'tahun_ajaran' => '2025/2026',
                'semester' => 'Genap',
            ]))
            ->assertStatus(409)
            ->assertJsonPath('code', 'academic_period_locked');
    }

    public function test_teacher_can_read_only_own_manual_scores(): void
    {
        $teacher = $this->createUser('guru');
        $otherTeacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $this->insertManualScore($teacher->id, $student->id, 'Kelas 10', 'Fisika');
        $this->insertManualScore($otherTeacher->id, $student->id, 'Kelas 10', 'Biologi');

        Sanctum::actingAs($teacher);
        $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/grades/manual-scores?tahun_ajaran=2026/2027&semester=Ganjil')
            ->assertOk()
            ->assertJsonPath('academic_context.tahun_ajaran', '2026/2027')
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.mapel', 'Fisika')
            ->assertJsonMissing(['mapel' => 'Biologi']);
    }

    public function test_teacher_upsert_manual_score_is_idempotent_and_server_scoped(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);
        
        DB::table('kelas')->insert([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
            'grade' => '10',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        
        DB::table('jadwal')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'guru_id' => $teacher->id,
            'kelas_id' => 'Kelas 10',
            'mapel' => 'Fisika',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'hari' => 'Senin',
            'jam_mulai' => '07:00:00',
            'jam_selesai' => '08:30:00',
            'created_at' => now(),
            'updated_at' => now()
        ]);

        Sanctum::actingAs($teacher);

        $payload = $this->manualScorePayload([
            'siswa_id' => $student->id,
            'kelas_id' => 'Kelas 10',
            'mapel' => 'Fisika',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
        ]);
        $headers = $this->tenantHeaders(['Idempotency-Key' => 'manual-score-upsert-1']);

        $this->withHeaders($headers)
            ->putJson('/api/v2/grades/manual-scores', $payload)
            ->assertOk()
            ->assertJsonPath('data.guru_id', $teacher->id)
            ->assertJsonPath('data.siswa_id', $student->id);

        $this->withHeaders($headers)
            ->putJson('/api/v2/grades/manual-scores', $payload)
            ->assertOk()
            ->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame(1, DB::table('guru_mapel_manual_nilai')
            ->where('tenant_id', $this->tenantId)
            ->where('guru_id', $teacher->id)
            ->where('siswa_id', $student->id)
            ->count());
    }

    public function test_manual_score_is_rejected_if_teacher_does_not_teach_class(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 11']);
        
        Sanctum::actingAs($teacher);

        $payload = $this->manualScorePayload([
            'siswa_id' => $student->id,
            'kelas_id' => 'Kelas 11',
            'mapel' => 'Kimia',
        ]);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'manual-score-upsert-2']))
            ->putJson('/api/v2/grades/manual-scores', $payload)
            ->assertStatus(403)
            ->assertJsonPath('code', 'GRADE_TEACHING_ASSIGNMENT_REQUIRED');
    }

    private function createUser(string $role): User
    {
        $user = User::factory()->create(['id' => (string) Str::uuid()]);
        Profile::create([
            'id' => $user->id,
            'tenant_id' => $this->tenantId,
            'role' => $role,
            'email' => $user->email,
            'nama' => "Pengguna {$role}",
            'status' => 'active',
        ]);

        return $user;
    }

    private function insertWeight(string $guruId, string $mapel): void
    {
        DB::table('guru_mapel_bobot')->insert($this->weightPayload([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'guru_id' => $guruId,
            'mapel' => $mapel,
        ]));
    }

    private function insertManualScore(string $guruId, string $siswaId, string $kelasId, string $mapel): void
    {
        DB::table('guru_mapel_manual_nilai')->insert($this->manualScorePayload([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'guru_id' => $guruId,
            'siswa_id' => $siswaId,
            'kelas_id' => $kelasId,
            'mapel' => $mapel,
        ]));
    }

    /** @return array<string, mixed> */
    private function manualScorePayload(array $overrides = []): array
    {
        return array_merge([
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'nilai_manual' => 85.5,
            'nilai_uts_manual' => 80.0,
            'nilai_uas_manual' => 90.0,
            'catatan' => 'Baik',
        ], $overrides);
    }

    /** @return array<string, mixed> */
    private function weightPayload(array $overrides = []): array
    {
        return array_merge([
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'mapel' => 'Matematika',
            'bobot_tugas_pr' => 30,
            'bobot_quiz_reguler' => 20,
            'bobot_quiz_uts' => 20,
            'bobot_quiz_uas' => 30,
            'sumber_uts' => 'digital',
            'sumber_uas' => 'digital',
            'jenis_manual' => 'absensi',
            'label_manual' => null,
        ], $overrides);
    }

    private function seedSettings(string $year, string $semester): void
    {
        $ganjil = AcademicPeriod::make($year, AcademicPeriod::SEMESTER_GANJIL);
        $genap = AcademicPeriod::make($year, AcademicPeriod::SEMESTER_GENAP);
        DB::table('settings')->where('tenant_id', $this->tenantId)->delete();
        DB::table('settings')->insert([
            'tenant_id' => $this->tenantId,
            'nama_sekolah' => 'Sekolah Pengujian',
            'tahun_ajaran' => $year,
            'semester_aktif' => $semester,
            'periode_mulai' => $ganjil['starts_at'],
            'periode_selesai' => $genap['ends_at'],
            'periode_ganjil_mulai' => $ganjil['starts_at'],
            'periode_ganjil_selesai' => $ganjil['ends_at'],
            'periode_genap_mulai' => $genap['starts_at'],
            'periode_genap_selesai' => $genap['ends_at'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        app(AcademicPeriodLifecycleService::class)->synchronizeTenant($this->tenantId);
    }

    /** @return array<string, string> */
    private function tenantHeaders(array $additional = []): array
    {
        return ['X-Tenant' => 'default', ...$additional];
    }
}
