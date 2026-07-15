<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class QuizControllerTest extends TestCase
{
    use RefreshDatabase;

    private User $guruUser;

    private Profile $guruProfile;

    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();

        config(['tenancy.allow_header_override' => true]);

        DB::table('tenants')->insert(['id' => 'tenant-1', 'slug' => 'testschool', 'name' => 'Test School']);
        $this->tenantId = 'tenant-1';

        $this->guruUser = User::factory()->create(['id' => (string) Str::uuid()]);
        DB::table('profiles')->insert([
            'id' => $this->guruUser->id,
            'tenant_id' => $this->tenantId,
            'nama' => 'Guru Test',
            'email' => $this->guruUser->email,
            'role' => 'guru',
        ]);
        $this->guruProfile = Profile::find($this->guruUser->id);

        DB::table('settings')->insert([
            'tenant_id' => $this->tenantId,
            'tahun_ajaran' => '2025/2026',
            'semester_aktif' => 'Ganjil',
        ]);
        DB::table('kelas')->insert([
            'id' => 'X-A',
            'tenant_id' => $this->tenantId,
            'nama' => 'X-A',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('jadwal')->insert([
            'id' => Str::uuid()->toString(),
            'tenant_id' => $this->tenantId,
            'kelas_id' => 'X-A',
            'hari' => 'Senin',
            'mapel' => 'Fisika',
            'guru_id' => $this->guruUser->id,
            'guru_nama' => 'Guru Test',
            'jam_mulai' => '08:00:00',
            'jam_selesai' => '09:00:00',
            'tahun_ajaran' => '2025/2026',
            'periode_berlaku' => 'tahunan',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_can_list_quizzes()
    {
        DB::table('quizzes')->insert([
            [
                'id' => 'quiz-1',
                'tenant_id' => $this->tenantId,
                'nama' => 'Quiz 1',
                'kelas_id' => 'X-A',
                'mapel' => 'Matematika',
                'guru_id' => $this->guruUser->id,
                'tahun_ajaran' => '2025/2026',
                'semester' => 'Ganjil',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->getJson('/api/v2/quizzes');

        $response->assertStatus(200)
            ->assertJsonCount(1, 'data.rows')
            ->assertJsonPath('data.rows.0.id', 'quiz-1');
    }

    public function test_can_create_quiz()
    {
        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->withHeader('Idempotency-Key', 'quiz-create-test-1')
            ->postJson('/api/v2/quizzes', [
                'nama' => 'Quiz Fisika',
                'kelas_id' => 'X-A',
                'mapel' => 'Fisika',
                'duration_minutes' => 60,
                'is_active' => false,
            ]);

        $response->assertStatus(201)
            ->assertJsonPath('data.nama', 'Quiz Fisika');

        $this->assertDatabaseHas('quizzes', [
            'nama' => 'Quiz Fisika',
            'guru_id' => $this->guruUser->id,
        ]);
    }

    public function test_teacher_cannot_create_quiz_for_unassigned_subject(): void
    {
        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->withHeader('Idempotency-Key', 'quiz-unassigned-subject-1')
            ->postJson('/api/v2/quizzes', [
                'nama' => 'Quiz Kimia',
                'kelas_id' => 'X-A',
                'mapel' => 'Kimia',
            ]);

        $response->assertStatus(403);
        $this->assertDatabaseMissing('quizzes', ['nama' => 'Quiz Kimia']);
    }

    public function test_create_ignores_browser_owned_tenant_actor_and_period_fields(): void
    {
        $attackerId = (string) Str::uuid();

        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->withHeader('Idempotency-Key', 'quiz-server-owned-fields-1')
            ->postJson('/api/v2/quizzes', [
                'id' => 'browser-controlled-id',
                'tenant_id' => 'tenant-attacker',
                'guru_id' => $attackerId,
                'tahun_ajaran' => '2099/2100',
                'semester' => 'Genap',
                'nama' => 'Quiz Server Owned',
                'kelas_id' => 'X-A',
                'mapel' => 'Fisika',
            ]);

        $response->assertCreated()
            ->assertJsonPath('data.tenant_id', $this->tenantId)
            ->assertJsonPath('data.guru_id', $this->guruUser->id)
            ->assertJsonPath('data.tahun_ajaran', '2025/2026')
            ->assertJsonPath('data.semester', 'Ganjil');
        $this->assertDatabaseMissing('quizzes', ['id' => 'browser-controlled-id']);
        $this->assertDatabaseHas('quizzes', [
            'nama' => 'Quiz Server Owned',
            'tenant_id' => $this->tenantId,
            'guru_id' => $this->guruUser->id,
        ]);
    }

    public function test_quiz_list_isolated_by_academic_year(): void
    {
        DB::table('quizzes')->insert([
            [
                'id' => 'quiz-current-year',
                'tenant_id' => $this->tenantId,
                'nama' => 'Quiz Current',
                'kelas_id' => 'X-A',
                'mapel' => 'Fisika',
                'guru_id' => $this->guruUser->id,
                'tahun_ajaran' => '2025/2026',
                'semester' => 'Ganjil',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => 'quiz-archived-year',
                'tenant_id' => $this->tenantId,
                'nama' => 'Quiz Archived',
                'kelas_id' => 'X-A',
                'mapel' => 'Fisika',
                'guru_id' => $this->guruUser->id,
                'tahun_ajaran' => '2024/2025',
                'semester' => 'Genap',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->getJson('/api/v2/quizzes?tahun_ajaran=2025%2F2026&semester=Ganjil');

        $response->assertOk()
            ->assertJsonCount(1, 'data.rows')
            ->assertJsonPath('data.rows.0.id', 'quiz-current-year');
    }

    public function test_teacher_cannot_mutate_archived_quiz_without_correction_session(): void
    {
        DB::table('quizzes')->insert([
            'id' => 'quiz-archived-mutation',
            'tenant_id' => $this->tenantId,
            'nama' => 'Quiz Archived Mutation',
            'kelas_id' => 'X-A',
            'mapel' => 'Fisika',
            'guru_id' => $this->guruUser->id,
            'tahun_ajaran' => '2024/2025',
            'semester' => 'Genap',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->withHeader('Idempotency-Key', 'quiz-archived-mutation-1')
            ->patchJson('/api/v2/quizzes/quiz-archived-mutation', ['nama' => 'Tidak boleh']);

        $response->assertStatus(409)
            ->assertJsonPath('code', 'PERIOD_LOCKED');
        $this->assertDatabaseHas('quizzes', ['id' => 'quiz-archived-mutation', 'nama' => 'Quiz Archived Mutation']);
    }

    public function test_cross_tenant_quiz_is_not_visible(): void
    {
        DB::table('tenants')->insert(['id' => 'tenant-2', 'slug' => 'otherschool', 'name' => 'Other School']);
        DB::table('quizzes')->insert([
            'id' => 'quiz-other-tenant',
            'tenant_id' => 'tenant-2',
            'nama' => 'Other Tenant Quiz',
            'kelas_id' => 'X-A',
            'mapel' => 'Fisika',
            'guru_id' => $this->guruUser->id,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Ganjil',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($this->guruUser)
            ->withHeader('X-Tenant', 'testschool')
            ->getJson('/api/v2/quizzes/quiz-other-tenant');

        $response->assertNotFound();
    }

    public function test_student_attempt_is_owner_scoped_and_hides_result_until_visible(): void
    {
        $student = User::factory()->create(['id' => (string) Str::uuid()]);
        DB::table('profiles')->insert([
            'id' => $student->id,
            'tenant_id' => $this->tenantId,
            'nama' => 'Siswa Test',
            'email' => $student->email,
            'role' => 'siswa',
            'kelas' => 'X-A',
        ]);
        $otherStudent = User::factory()->create(['id' => (string) Str::uuid()]);
        DB::table('profiles')->insert([
            'id' => $otherStudent->id,
            'tenant_id' => $this->tenantId,
            'nama' => 'Siswa Lain',
            'email' => $otherStudent->email,
            'role' => 'siswa',
            'kelas' => 'X-A',
        ]);

        DB::table('quizzes')->insert([
            'id' => 'quiz-student-owner',
            'tenant_id' => $this->tenantId,
            'nama' => 'Quiz Owner Scope',
            'kelas_id' => 'X-A',
            'mapel' => 'Fisika',
            'guru_id' => $this->guruUser->id,
            'starts_at' => now()->subMinute(),
            'deadline_at' => now()->addHour(),
            'is_active' => true,
            'is_live' => false,
            'result_visible_to_students' => false,
            'tahun_ajaran' => '2025/2026',
            'semester' => 'Ganjil',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_questions')->insert([
            'id' => 'question-student-owner',
            'tenant_id' => $this->tenantId,
            'quiz_id' => 'quiz-student-owner',
            'nomor' => 1,
            'soal' => 'Soal rahasia',
            'poin' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_options')->insert([
            'id' => 'option-student-owner',
            'tenant_id' => $this->tenantId,
            'question_id' => 'question-student-owner',
            'label' => 'A',
            'text' => 'Jawaban benar',
            'is_correct' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $start = $this->actingAs($student)
            ->withHeader('X-Tenant', 'testschool')
            ->withHeader('Idempotency-Key', 'quiz-v2-student-start-1')
            ->postJson('/api/v2/quizzes/quiz-student-owner/attempts/start', [
                'client_meta' => ['device_id' => 'browser-test'],
            ]);

        $start->assertOk();
        $attemptId = $start->json('data.submission.id');
        $this->assertNotEmpty($attemptId);
        $options = $start->json('data.options_by_question.question-student-owner');
        $this->assertNotEmpty($options);
        $this->assertArrayNotHasKey('is_correct', $options[0]);

        DB::table('quiz_submissions')->where('id', $attemptId)->update([
            'status' => 'finished',
            'score' => 100,
            'total_points' => 10,
            'finished_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_answers')->insert([
            'id' => 'answer-student-owner',
            'submission_id' => $attemptId,
            'question_id' => 'question-student-owner',
            'option_id' => 'option-student-owner',
            'is_correct' => true,
            'poin' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ownAttempt = $this->actingAs($student)
            ->withHeader('X-Tenant', 'testschool')
            ->getJson('/api/v2/quizzes/quiz-student-owner/attempts/'.$attemptId);
        $ownAttempt->assertOk();
        $this->assertArrayNotHasKey('score', $ownAttempt->json('data.submission'));
        $this->assertArrayNotHasKey('is_correct', $ownAttempt->json('data.answers.0'));

        $otherAttempt = $this->actingAs($otherStudent)
            ->withHeader('X-Tenant', 'testschool')
            ->getJson('/api/v2/quizzes/quiz-student-owner/attempts/'.$attemptId);
        $otherAttempt->assertForbidden();
    }
}
