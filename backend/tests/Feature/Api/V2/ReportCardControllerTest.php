<?php

namespace Tests\Feature\Api\V2;

use App\Support\AcademicPeriod;
use App\Models\Profile;
use App\Models\User;
use App\Services\Academic\AcademicPeriodLifecycleService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReportCardControllerTest extends TestCase
{
    use RefreshDatabase;

    private string $tenantId = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $this->seedSettings('2026/2027', 'Ganjil');
    }

    public function test_teacher_can_preview_report_card(): void
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

        DB::table('guru_mapel_manual_nilai')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'guru_id' => $teacher->id,
            'siswa_id' => $student->id,
            'kelas_id' => 'Kelas 10',
            'mapel' => 'Fisika',
            'tahun_ajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'nilai_manual' => 88.5,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders())
            ->getJson("/api/v2/report-cards/{$student->id}/preview?kelas_id=Kelas 10")
            ->assertOk()
            ->assertJsonPath('data.siswa_id', $student->id)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.mapel', 'Fisika')
            ->assertJsonPath('data.items.0.nilai', 88.5);
    }

    public function test_teacher_cannot_preview_other_class(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 11']);

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders())
            ->getJson("/api/v2/report-cards/{$student->id}/preview?kelas_id=Kelas 11")
            ->assertStatus(403)
            ->assertJsonPath('code', 'CLASS_ACCESS_DENIED');
    }

    public function test_teacher_can_upsert_report_card_item_for_assigned_subject(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
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
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'report-item-1']))
            ->putJson("/api/v2/report-cards/{$student->id}/items?tahun_ajaran=2026/2027&semester=Ganjil", [
                'kelas_id' => 'Kelas 10',
                'jenis' => 'uts',
                'mapel' => 'Fisika',
                'kkm' => 75,
                'nilai' => 88,
                'predikat' => 'B',
                'keterangan' => 'Baik',
                'tenant_id' => 'tenant-yang-tidak-boleh-dipercaya',
                'sent_by' => 'aktor-yang-tidak-boleh-dipercaya',
            ])
            ->assertOk()
            ->assertJsonPath('data.siswa_id', $student->id)
            ->assertJsonPath('data.mapel', 'Fisika')
            ->assertJsonPath('data.jenis', 'uts');

        $report = DB::table('rapot_siswa')
            ->where('tenant_id', $this->tenantId)
            ->where('siswa_id', $student->id)
            ->first();
        $this->assertNotNull($report);
        $this->assertSame('2026/2027', $report->tahun_pelajaran);
        $this->assertSame('Ganjil', $report->semester);
        $this->assertDatabaseHas('rapot_siswa_items', [
            'tenant_id' => $this->tenantId,
            'rapot_id' => $report->id,
            'mapel' => 'Fisika',
            'nilai' => 88,
            'sent_by' => $teacher->id,
        ]);
    }

    public function test_teacher_cannot_upsert_report_card_item_for_unassigned_subject(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);
        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'report-item-2']))
            ->putJson("/api/v2/report-cards/{$student->id}/items?tahun_ajaran=2026/2027&semester=Ganjil", [
                'kelas_id' => 'Kelas 10',
                'jenis' => 'uas',
                'mapel' => 'Kimia',
                'nilai' => 80,
            ])
            ->assertStatus(403)
            ->assertJsonPath('code', 'CLASS_ACCESS_DENIED');
    }

    public function test_report_card_list_is_tenant_scoped(): void
    {
        DB::table('tenants')->insertOrIgnore([
            'id' => 'tenant-report-other',
            'slug' => 'tenant-report-other',
            'name' => 'Tenant Report Other',
        ]);
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);
        $otherStudent = User::factory()->create(['id' => (string) Str::uuid()]);
        Profile::create([
            'id' => $otherStudent->id,
            'tenant_id' => 'tenant-report-other',
            'role' => 'siswa',
            'email' => $otherStudent->email,
            'nama' => 'Other Student',
            'kelas' => 'Kelas 10',
            'status' => 'active',
        ]);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);

        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'kelas_id' => 'Kelas 10',
            'wali_guru_id' => $teacher->id,
            'tahun_ajaran' => '2026/2027',
            'tenant_id' => $this->tenantId,
        ]);
        DB::table('rapot_siswa')->insert([
            [
                'id' => (string) Str::uuid(),
                'tenant_id' => $this->tenantId,
                'siswa_id' => $student->id,
                'kelas_id' => 'Kelas 10',
                'jenis' => 'uts',
                'tahun_pelajaran' => '2026/2027',
                'semester' => 'Ganjil',
                'status' => 'draft',
            ],
            [
                'id' => (string) Str::uuid(),
                'tenant_id' => 'tenant-report-other',
                'siswa_id' => $otherStudent->id,
                'kelas_id' => 'Kelas 10',
                'jenis' => 'uts',
                'tahun_pelajaran' => '2026/2027',
                'semester' => 'Ganjil',
                'status' => 'draft',
            ],
        ]);

        Sanctum::actingAs($teacher);
        $response = $this->withHeaders($this->tenantHeaders())
            ->getJson('/api/v2/report-cards?kelas_id=Kelas 10&tahun_ajaran=2026/2027&semester=Ganjil')
            ->assertOk();

        $ids = collect($response->json('data'))->pluck('siswa_id')->all();
        $this->assertContains($student->id, $ids);
        $this->assertNotContains($otherStudent->id, $ids);
    }

    public function test_homeroom_teacher_can_update_metadata(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);

        // Insert into kelas_struktur as homeroom teacher
        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'kelas_id' => 'Kelas 10',
            'wali_guru_id' => $teacher->id,
            'tahun_ajaran' => '2026/2027',
            'tenant_id' => $this->tenantId,
        ]);

        Sanctum::actingAs($teacher);

        $payload = [
            'kelas_id' => 'Kelas 10',
            'sakit' => 2,
            'izin' => 1,
            'alpa' => 0,
            'catatan_wali_kelas' => 'Tingkatkan belajar',
            'keputusan' => 'Naik Kelas',
        ];

        $this->withHeaders($this->tenantHeaders([
            'Idempotency-Key' => 'update-meta-1',
        ]))
            ->putJson("/api/v2/report-cards/{$student->id}/metadata", $payload)
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertDatabaseHas('rapot_siswa', [
            'siswa_id' => $student->id,
            'sakit' => 2,
            'catatan_wali_kelas' => 'Tingkatkan belajar',
        ]);
    }

    public function test_non_homeroom_cannot_update_metadata(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);

        // Teacher is in jadwal but NOT homeroom
        DB::table('jadwal')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'guru_id' => $teacher->id,
            'kelas_id' => 'Kelas 10',
            'mapel' => 'Fisika',
            'hari' => 'Senin',
            'jam_mulai' => '07:00:00',
            'jam_selesai' => '08:30:00',
            'tahun_ajaran' => '2026/2027',
        ]);

        Sanctum::actingAs($teacher);

        $payload = [
            'kelas_id' => 'Kelas 10',
            'sakit' => 2,
        ];

        $this->withHeaders($this->tenantHeaders())
            ->putJson("/api/v2/report-cards/{$student->id}/metadata", $payload)
            ->assertStatus(403)
            ->assertJsonPath('code', 'NOT_HOMEROOM_TEACHER');
    }

    public function test_homeroom_teacher_can_finalize_report_card(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);

        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'kelas_id' => 'Kelas 10',
            'wali_guru_id' => $teacher->id,
            'tahun_ajaran' => '2026/2027',
            'tenant_id' => $this->tenantId,
        ]);

        // Insert draft report card
        DB::table('rapot_siswa')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'siswa_id' => $student->id,
            'kelas_id' => 'Kelas 10',
            'jenis' => 'akademik',
            'tahun_pelajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'status' => 'draft',
        ]);

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders([
            'Idempotency-Key' => 'finalize-1',
        ]))
            ->postJson("/api/v2/report-cards/{$student->id}/finalize?kelas_id=Kelas 10")
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertDatabaseHas('rapot_siswa', [
            'siswa_id' => $student->id,
            'status' => 'finalized',
        ]);
    }

    public function test_homeroom_teacher_can_publish_report_card(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);

        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'kelas_id' => 'Kelas 10',
            'wali_guru_id' => $teacher->id,
            'tahun_ajaran' => '2026/2027',
            'tenant_id' => $this->tenantId,
        ]);

        // Insert finalized report card
        DB::table('rapot_siswa')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'siswa_id' => $student->id,
            'kelas_id' => 'Kelas 10',
            'jenis' => 'akademik',
            'tahun_pelajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'status' => 'finalized',
        ]);

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders([
            'Idempotency-Key' => 'publish-1',
        ]))
            ->postJson("/api/v2/report-cards/{$student->id}/publish?kelas_id=Kelas 10")
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertDatabaseHas('rapot_siswa', [
            'siswa_id' => $student->id,
            'status' => 'published',
        ]);
    }

    public function test_print_report_card(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);

        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'kelas_id' => 'Kelas 10',
            'wali_guru_id' => $teacher->id,
            'tahun_ajaran' => '2026/2027',
            'tenant_id' => $this->tenantId,
        ]);

        // Insert published report card with snapshot
        DB::table('rapot_siswa')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'siswa_id' => $student->id,
            'kelas_id' => 'Kelas 10',
            'jenis' => 'akademik',
            'tahun_pelajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'status' => 'published',
            'snapshot_data' => json_encode(['items' => []]),
        ]);

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders())
            ->getJson("/api/v2/report-cards/{$student->id}/print?kelas_id=Kelas 10")
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.status', 'published')
            ->assertJsonStructure([
                'data' => [
                    'id', 'siswa_id', 'kelas_id', 'tahun_pelajaran', 'semester', 'status', 'snapshot'
                ]
            ]);
    }

    public function test_student_cannot_finalize_or_reopen(): void
    {
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        Sanctum::actingAs($student);

        $this->withHeaders($this->tenantHeaders())
            ->postJson("/api/v2/report-cards/{$student->id}/finalize?kelas_id=Kelas 10")
            ->assertStatus(403)
            ->assertJsonPath('code', 'ACCESS_DENIED');
            
        $this->withHeaders($this->tenantHeaders())
            ->postJson("/api/v2/report-cards/{$student->id}/reopen?kelas_id=Kelas 10")
            ->assertStatus(403)
            ->assertJsonPath('code', 'ACCESS_DENIED');
    }

    public function test_print_blocked_for_draft(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);

        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'kelas_id' => 'Kelas 10',
            'wali_guru_id' => $teacher->id,
            'tahun_ajaran' => '2026/2027',
            'tenant_id' => $this->tenantId,
        ]);

        DB::table('rapot_siswa')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenantId,
            'siswa_id' => $student->id,
            'kelas_id' => 'Kelas 10',
            'jenis' => 'akademik',
            'tahun_pelajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'status' => 'draft',
        ]);

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders())
            ->getJson("/api/v2/report-cards/{$student->id}/print?kelas_id=Kelas 10")
            ->assertStatus(403)
            ->assertJsonPath('code', 'REPORT_DRAFT');
    }

    public function test_reopen_clears_snapshot_and_saves_history(): void
    {
        $teacher = $this->createUser('guru');
        $student = $this->createUser('siswa');
        $student->profile->update(['kelas' => 'Kelas 10']);

        DB::table('kelas')->insertOrIgnore([
            'id' => 'Kelas 10',
            'tenant_id' => $this->tenantId,
            'nama' => 'Kelas 10',
        ]);

        DB::table('kelas_struktur')->insert([
            'id' => (string) Str::uuid(),
            'kelas_id' => 'Kelas 10',
            'wali_guru_id' => $teacher->id,
            'tahun_ajaran' => '2026/2027',
            'tenant_id' => $this->tenantId,
        ]);

        $reportId = (string) Str::uuid();
        DB::table('rapot_siswa')->insert([
            'id' => $reportId,
            'tenant_id' => $this->tenantId,
            'siswa_id' => $student->id,
            'kelas_id' => 'Kelas 10',
            'jenis' => 'akademik',
            'tahun_pelajaran' => '2026/2027',
            'semester' => 'Ganjil',
            'status' => 'published',
            'snapshot_data' => json_encode(['items' => []]),
        ]);

        Sanctum::actingAs($teacher);

        $this->withHeaders($this->tenantHeaders(['Idempotency-Key' => 'reopen-1']))
            ->postJson("/api/v2/report-cards/{$student->id}/reopen?kelas_id=Kelas 10")
            ->assertOk()
            ->assertJsonPath('success', true);

        $this->assertDatabaseHas('rapot_siswa', [
            'id' => $reportId,
            'status' => 'draft',
            'snapshot_data' => null,
        ]);

        $this->assertDatabaseHas('rapot_siswa_snapshots_history', [
            'rapot_siswa_id' => $reportId,
            'reason' => 'reopen_to_draft',
        ]);
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
