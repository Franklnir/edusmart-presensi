<?php

namespace Tests\Feature;

use App\Jobs\FinalizeQuizSubmissionJob;
use App\Models\User;
use App\Services\Quiz\QuizScoringService;
use App\Services\WhatsApp\WhatsAppNotificationService;
use App\Support\AcademicPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class QuizAutomationTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_siswa_cannot_start_quiz_before_starts_at(): void
    {
        $tenantId = $this->defaultTenantId();
        [$user] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $user->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Matematika',
            'nama' => 'Kuis Aljabar',
            'starts_at' => now()->addHour(),
            'deadline_at' => now()->addHours(2),
            'is_live' => false,
            'is_active' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($user)->postJson('/api/quiz/start', [
            'quiz_id' => $quizId,
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Quiz belum dimulai');
    }

    public function test_siswa_cannot_start_quiz_when_schedule_is_not_set(): void
    {
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Matematika',
            'nama' => 'Draft Quiz',
            'starts_at' => null,
            'deadline_at' => null,
            'mode' => 'regular',
            'is_live' => false,
            'is_active' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($siswa)->postJson('/api/quiz/start', [
            'quiz_id' => $quizId,
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Quiz belum dijadwalkan oleh guru');
    }

    public function test_submit_quiz_calculates_score_from_question_points(): void
    {
        config()->set('quiz.async_scoring_enabled', false);
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Fisika',
            'nama' => 'Quiz Gaya',
            'starts_at' => now()->subHour(),
            'deadline_at' => now()->addHour(),
            'is_live' => false,
            'is_active' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $q1 = (string) Str::uuid();
        $q2 = (string) Str::uuid();
        DB::table('quiz_questions')->insert([
            [
                'id' => $q1,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'nomor' => 1,
                'soal' => 'Soal 1',
                'poin' => 20,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $q2,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'nomor' => 2,
                'soal' => 'Soal 2',
                'poin' => 10,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $q1Correct = (string) Str::uuid();
        $q1Wrong = (string) Str::uuid();
        $q2Correct = (string) Str::uuid();
        $q2Wrong = (string) Str::uuid();
        DB::table('quiz_options')->insert([
            [
                'id' => $q1Correct,
                'tenant_id' => $tenantId,
                'question_id' => $q1,
                'label' => 'A',
                'text' => 'Benar',
                'is_correct' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $q1Wrong,
                'tenant_id' => $tenantId,
                'question_id' => $q1,
                'label' => 'B',
                'text' => 'Salah',
                'is_correct' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $q2Correct,
                'tenant_id' => $tenantId,
                'question_id' => $q2,
                'label' => 'A',
                'text' => 'Benar',
                'is_correct' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $q2Wrong,
                'tenant_id' => $tenantId,
                'question_id' => $q2,
                'label' => 'B',
                'text' => 'Salah',
                'is_correct' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this->actingAs($siswa)->postJson('/api/quiz/submit', [
            'quiz_id' => $quizId,
            'answers' => [
                ['question_id' => $q1, 'option_id' => $q1Correct],
                ['question_id' => $q2, 'option_id' => $q2Wrong],
            ],
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.total_points', 30);
        $response->assertJsonPath('data.score', 67);

        $this->assertDatabaseHas('quiz_submissions', [
            'quiz_id' => $quizId,
            'siswa_id' => $siswa->id,
            'status' => 'finished',
            'score' => 67,
            'total_points' => 30,
            'tenant_id' => $tenantId,
        ]);
    }

    public function test_async_submit_marks_submission_finished_and_queues_scoring(): void
    {
        config()->set('quiz.async_scoring_enabled', true);
        Queue::fake();

        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        $questionId = (string) Str::uuid();
        $optionId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'IPA',
            'nama' => 'Quiz Queue',
            'starts_at' => now()->subMinute(),
            'deadline_at' => now()->addHour(),
            'is_live' => false,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_questions')->insert([
            'id' => $questionId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'nomor' => 1,
            'soal' => 'Soal queue',
            'poin' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_options')->insert([
            'id' => $optionId,
            'tenant_id' => $tenantId,
            'question_id' => $questionId,
            'label' => 'A',
            'text' => 'Benar',
            'is_correct' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($siswa)->postJson('/api/quiz/submit', [
            'quiz_id' => $quizId,
            'answers' => [
                ['question_id' => $questionId, 'option_id' => $optionId],
            ],
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.scoring_pending', true);
        $response->assertJsonPath('data.score', null);
        $this->assertDatabaseHas('quiz_submissions', [
            'quiz_id' => $quizId,
            'siswa_id' => $siswa->id,
            'status' => 'finished',
            'score' => null,
        ]);
        $queuedJob = null;
        Queue::assertPushedOn('quiz-scoring', FinalizeQuizSubmissionJob::class, function (FinalizeQuizSubmissionJob $job) use (&$queuedJob) {
            $queuedJob = $job;

            return true;
        });

        $this->assertNotNull($queuedJob);
        $queuedJob->handle(
            app(QuizScoringService::class),
            app(WhatsAppNotificationService::class)
        );
        $this->assertDatabaseHas('quiz_submissions', [
            'quiz_id' => $quizId,
            'siswa_id' => $siswa->id,
            'status' => 'finished',
            'score' => 100,
            'total_points' => 10,
        ]);
    }

    public function test_submit_quiz_with_skala_100_ignores_question_weights(): void
    {
        config()->set('quiz.async_scoring_enabled', false);
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Biologi',
            'nama' => 'Quiz Sel',
            'starts_at' => now()->subHour(),
            'deadline_at' => now()->addHour(),
            'penilaian' => 'skala_100',
            'mode' => 'regular',
            'is_live' => false,
            'is_active' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $q1 = (string) Str::uuid();
        $q2 = (string) Str::uuid();
        DB::table('quiz_questions')->insert([
            [
                'id' => $q1,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'nomor' => 1,
                'soal' => 'Soal 1',
                'poin' => 50,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $q2,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'nomor' => 2,
                'soal' => 'Soal 2',
                'poin' => 5,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $q1Correct = (string) Str::uuid();
        $q1Wrong = (string) Str::uuid();
        $q2Correct = (string) Str::uuid();
        $q2Wrong = (string) Str::uuid();
        DB::table('quiz_options')->insert([
            [
                'id' => $q1Correct,
                'tenant_id' => $tenantId,
                'question_id' => $q1,
                'label' => 'A',
                'text' => 'Benar',
                'is_correct' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $q1Wrong,
                'tenant_id' => $tenantId,
                'question_id' => $q1,
                'label' => 'B',
                'text' => 'Salah',
                'is_correct' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $q2Correct,
                'tenant_id' => $tenantId,
                'question_id' => $q2,
                'label' => 'A',
                'text' => 'Benar',
                'is_correct' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $q2Wrong,
                'tenant_id' => $tenantId,
                'question_id' => $q2,
                'label' => 'B',
                'text' => 'Salah',
                'is_correct' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this->actingAs($siswa)->postJson('/api/quiz/submit', [
            'quiz_id' => $quizId,
            'answers' => [
                ['question_id' => $q1, 'option_id' => $q1Correct],
                ['question_id' => $q2, 'option_id' => $q2Wrong],
            ],
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.score', 50);
        $response->assertJsonPath('data.total_points', 2);
    }

    public function test_guru_cannot_create_quiz_for_non_taught_mapel_or_past_start(): void
    {
        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        $this->seedGuruTeachingMapel($tenantId, $guru->id, 'X-1', 'Matematika');

        $invalidMapelResponse = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'quizzes',
            'action' => 'insert',
            'payload' => [
                'id' => (string) Str::uuid(),
                'kelas_id' => 'X-1',
                'mapel' => 'Fisika',
                'nama' => 'Quiz Fisika',
                'starts_at' => now()->addHour()->toISOString(),
                'deadline_at' => now()->addHours(2)->toISOString(),
                'mode' => 'regular',
                'penilaian' => 'poin',
            ],
        ]);
        $invalidMapelResponse->assertStatus(422);
        $invalidMapelResponse->assertJsonPath('error', 'Kelas dan mapel quiz harus sesuai yang diampu guru');

        $pastStartResponse = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'quizzes',
            'action' => 'insert',
            'payload' => [
                'id' => (string) Str::uuid(),
                'kelas_id' => 'X-1',
                'mapel' => 'Matematika',
                'nama' => 'Quiz Matematika',
                'starts_at' => now()->subHour()->toISOString(),
                'deadline_at' => now()->addHour()->toISOString(),
                'mode' => 'regular',
                'penilaian' => 'poin',
            ],
        ]);
        $pastStartResponse->assertStatus(422);
        $pastStartResponse->assertJsonPath('error', 'Tanggal mulai quiz tidak boleh di masa lalu');
    }

    public function test_guru_can_update_deadline_but_not_content_while_submission_ongoing(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-02-10 10:00:00'));

        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        $this->seedGuruTeachingMapel($tenantId, $guru->id, 'X-1', 'Matematika');
        $period = AcademicPeriod::current();

        $quizId = (string) Str::uuid();
        $questionId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Matematika',
            'nama' => 'Quiz Terkunci',
            'starts_at' => now()->subMinute(),
            'deadline_at' => now()->addHour(),
            'mode' => 'regular',
            'is_live' => false,
            'is_active' => true,
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_questions')->insert([
            'id' => $questionId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'nomor' => 1,
            'soal' => 'Soal awal',
            'poin' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_submissions')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'siswa_id' => $siswa->id,
            'status' => 'ongoing',
            'started_at' => now()->subMinute(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $questionUpdate = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'quiz_questions',
            'action' => 'update',
            'filters' => ['eq' => ['id' => $questionId]],
            'payload' => ['soal' => 'Soal berubah'],
        ]);
        $questionUpdate->assertStatus(409);
        $questionUpdate->assertJsonPath('error', 'Soal quiz tidak bisa diubah saat masih ada siswa yang mengerjakan quiz.');

        $quizUpdate = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'quizzes',
            'action' => 'update',
            'filters' => ['eq' => ['id' => $quizId]],
            'payload' => ['nama' => 'Nama berubah'],
        ]);
        $quizUpdate->assertStatus(422);
        $quizUpdate->assertJsonPath('error', 'Quiz sedang dikerjakan siswa. Hanya deadline yang boleh diubah.');

        $securityUpdate = $this->actingAs($guru)->postJson('/api/quiz/publish', [
            'quiz_id' => $quizId,
            'shuffle_questions' => true,
        ]);
        $securityUpdate->assertStatus(409);
        $securityUpdate->assertJsonPath('error', 'Quiz sedang dikerjakan siswa. Keamanan dan pengaturan non-waktu tidak bisa diubah.');

        $newDeadline = now()->addHours(2)->startOfMinute();
        $deadlineUpdate = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'quizzes',
            'action' => 'update',
            'filters' => ['eq' => ['id' => $quizId]],
            'payload' => ['deadline_at' => $newDeadline->toISOString()],
        ]);
        $deadlineUpdate->assertOk();

        $storedDeadline = DB::table('quizzes')->where('id', $quizId)->value('deadline_at');
        $this->assertSame(
            $newDeadline->timestamp,
            Carbon::parse($storedDeadline)->timestamp
        );
    }

    public function test_guru_cannot_schedule_quiz_outside_academic_year(): void
    {
        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        $this->seedGuruTeachingMapel($tenantId, $guru->id, 'X-1', 'Matematika');
        $period = AcademicPeriod::current();

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Matematika',
            'nama' => 'Quiz Periode',
            'starts_at' => now()->addDay(),
            'deadline_at' => now()->addDays(2),
            'mode' => 'regular',
            'is_live' => false,
            'is_active' => true,
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $outsideStart = now()->addYears(3)->startOfMinute();
        $response = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'quizzes',
            'action' => 'update',
            'filters' => ['eq' => ['id' => $quizId]],
            'payload' => [
                'starts_at' => $outsideStart->toISOString(),
                'deadline_at' => $outsideStart->copy()->addHour()->toISOString(),
            ],
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('tahun periode', (string) $response->json('error'));
    }

    public function test_guru_can_update_draft_quiz_name_and_mode(): void
    {
        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        $this->seedGuruTeachingMapel($tenantId, $guru->id, 'X-1', 'Matematika');
        $period = AcademicPeriod::current();

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Matematika',
            'nama' => 'Quiz Draft',
            'starts_at' => null,
            'deadline_at' => null,
            'mode' => 'regular',
            'is_live' => false,
            'is_active' => false,
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'quizzes',
            'action' => 'update',
            'filters' => ['eq' => ['id' => $quizId]],
            'payload' => [
                'nama' => 'Quiz Draft Edit',
                'mode' => 'uas',
                'is_live' => true,
                'duration_minutes' => 60,
            ],
        ]);

        $response->assertOk();
        $this->assertDatabaseHas('quizzes', [
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'nama' => 'Quiz Draft Edit',
            'mode' => 'uas',
            'is_live' => true,
            'duration_minutes' => 60,
        ]);
    }

    public function test_guru_uts_schedule_deadline_is_derived_from_duration(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-20 09:00:00', 'Asia/Jakarta'));

        $tenantId = $this->defaultTenantId();
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');
        $this->seedGuruTeachingMapel($tenantId, $guru->id, 'X-1', 'Matematika');
        $period = AcademicPeriod::current();

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Matematika',
            'nama' => 'UTS Durasi',
            'starts_at' => now()->addDay(),
            'deadline_at' => now()->addDays(2),
            'mode' => 'uts',
            'is_live' => true,
            'is_active' => true,
            'duration_minutes' => 60,
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $startsAt = now()->addDays(2)->startOfMinute();
        $duration = 19;
        $response = $this->actingAs($guru)->postJson('/api/db', [
            'table' => 'quizzes',
            'action' => 'update',
            'filters' => ['eq' => ['id' => $quizId]],
            'payload' => [
                'starts_at' => $startsAt->toISOString(),
                'duration_minutes' => $duration,
                'deadline_at' => $startsAt->copy()->addHours(3)->toISOString(),
                'is_live' => true,
                'is_active' => true,
            ],
        ]);

        $response->assertOk();

        $fresh = DB::table('quizzes')->where('id', $quizId)->first();
        $this->assertSame('uts', $fresh->mode);
        $this->assertSame($duration, (int) $fresh->duration_minutes);
        $this->assertSame(
            $startsAt->copy()->addMinutes($duration)->timestamp,
            Carbon::parse($fresh->deadline_at)->timestamp
        );
        $this->assertSame(
            $startsAt->timestamp,
            Carbon::parse($fresh->live_started_at)->timestamp
        );
    }

    public function test_expired_ongoing_submission_is_finalized_automatically(): void
    {
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Kimia',
            'nama' => 'Quiz Reaksi',
            'starts_at' => now()->subHours(2),
            'deadline_at' => now()->subMinute(),
            'is_live' => false,
            'is_active' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $questionId = (string) Str::uuid();
        DB::table('quiz_questions')->insert([
            'id' => $questionId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'nomor' => 1,
            'soal' => 'Soal',
            'poin' => 40,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $correctOptionId = (string) Str::uuid();
        DB::table('quiz_options')->insert([
            'id' => $correctOptionId,
            'tenant_id' => $tenantId,
            'question_id' => $questionId,
            'label' => 'A',
            'text' => 'Benar',
            'is_correct' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $submissionId = (string) Str::uuid();
        DB::table('quiz_submissions')->insert([
            'id' => $submissionId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'siswa_id' => $siswa->id,
            'status' => 'ongoing',
            'started_at' => now()->subHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('quiz_answers')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'submission_id' => $submissionId,
            'question_id' => $questionId,
            'option_id' => $correctOptionId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $finalized = app(QuizScoringService::class)->finalizeExpiredSubmissions($tenantId);
        $this->assertSame(1, $finalized);

        $this->assertDatabaseHas('quiz_submissions', [
            'id' => $submissionId,
            'status' => 'finished',
            'score' => 100,
            'total_points' => 40,
            'tenant_id' => $tenantId,
        ]);
    }

    public function test_start_attempt_uses_dedicated_endpoint_and_hides_correct_options(): void
    {
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Matematika',
            'nama' => 'Quiz Profesional',
            'starts_at' => now()->subMinute(),
            'deadline_at' => now()->addHour(),
            'shuffle_questions' => true,
            'shuffle_options' => true,
            'max_attempts' => 1,
            'is_live' => false,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $questionId = (string) Str::uuid();
        DB::table('quiz_questions')->insert([
            'id' => $questionId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'nomor' => 1,
            'soal' => 'Soal aman',
            'poin' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('quiz_options')->insert([
            [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'question_id' => $questionId,
                'label' => 'A',
                'text' => 'Benar',
                'is_correct' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'question_id' => $questionId,
                'label' => 'B',
                'text' => 'Salah',
                'is_correct' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this->actingAs($siswa)->postJson('/api/quiz/start', [
            'quiz_id' => $quizId,
            'client_meta' => ['fullscreen' => true],
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.submission.status', 'ongoing');
        $this->assertArrayNotHasKey('is_correct', $response->json("data.options_by_question.{$questionId}.0"));
        $this->assertDatabaseHas('quiz_submissions', [
            'quiz_id' => $quizId,
            'siswa_id' => $siswa->id,
            'tenant_id' => $tenantId,
            'status' => 'ongoing',
        ]);
    }

    public function test_ongoing_quiz_attempt_is_locked_to_first_device(): void
    {
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'IPA',
            'nama' => 'Quiz Device Lock',
            'starts_at' => now()->subMinute(),
            'deadline_at' => now()->addHour(),
            'is_live' => false,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $questionId = (string) Str::uuid();
        DB::table('quiz_questions')->insert([
            'id' => $questionId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'nomor' => 1,
            'soal' => 'Pilih jawaban',
            'poin' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $optionId = (string) Str::uuid();
        DB::table('quiz_options')->insert([
            'id' => $optionId,
            'tenant_id' => $tenantId,
            'question_id' => $questionId,
            'label' => 'A',
            'text' => 'Benar',
            'is_correct' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $firstStart = $this->actingAs($siswa)->postJson('/api/quiz/start', [
            'quiz_id' => $quizId,
            'client_meta' => ['device_id' => 'device-a', 'device' => 'web'],
        ]);
        $firstStart->assertOk();
        $submissionId = $firstStart->json('data.submission.id');

        $secondStart = $this->actingAs($siswa)->postJson('/api/quiz/start', [
            'quiz_id' => $quizId,
            'client_meta' => ['device_id' => 'device-b', 'device' => 'web'],
        ]);
        $secondStart->assertStatus(409);
        $secondStart->assertJsonPath('code', 'quiz_device_session_locked');

        $sameDeviceAnswer = $this->actingAs($siswa)->postJson('/api/quiz/answer', [
            'quiz_id' => $quizId,
            'submission_id' => $submissionId,
            'question_id' => $questionId,
            'option_id' => $optionId,
            'client_meta' => ['device_id' => 'device-a', 'device' => 'web'],
        ]);
        $sameDeviceAnswer->assertOk();

        $otherDeviceAnswer = $this->actingAs($siswa)->postJson('/api/quiz/answer', [
            'quiz_id' => $quizId,
            'submission_id' => $submissionId,
            'question_id' => $questionId,
            'option_id' => $optionId,
            'client_meta' => ['device_id' => 'device-b', 'device' => 'web'],
        ]);
        $otherDeviceAnswer->assertStatus(409);
        $otherDeviceAnswer->assertJsonPath('code', 'quiz_device_session_locked');
    }

    public function test_save_answer_endpoint_rejects_option_from_other_question(): void
    {
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'IPA',
            'nama' => 'Quiz Validasi',
            'starts_at' => now()->subMinute(),
            'deadline_at' => now()->addHour(),
            'is_live' => false,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $questionA = (string) Str::uuid();
        $questionB = (string) Str::uuid();
        DB::table('quiz_questions')->insert([
            [
                'id' => $questionA,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'nomor' => 1,
                'soal' => 'Soal A',
                'poin' => 10,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $questionB,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'nomor' => 2,
                'soal' => 'Soal B',
                'poin' => 10,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $validOption = (string) Str::uuid();
        $wrongQuestionOption = (string) Str::uuid();
        DB::table('quiz_options')->insert([
            [
                'id' => $validOption,
                'tenant_id' => $tenantId,
                'question_id' => $questionA,
                'label' => 'A',
                'text' => 'Pilihan A',
                'is_correct' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $wrongQuestionOption,
                'tenant_id' => $tenantId,
                'question_id' => $questionB,
                'label' => 'A',
                'text' => 'Pilihan B',
                'is_correct' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $start = $this->actingAs($siswa)->postJson('/api/quiz/start', ['quiz_id' => $quizId]);
        $start->assertOk();
        $submissionId = $start->json('data.submission.id');

        $invalid = $this->actingAs($siswa)->postJson('/api/quiz/answer', [
            'quiz_id' => $quizId,
            'submission_id' => $submissionId,
            'question_id' => $questionA,
            'option_id' => $wrongQuestionOption,
        ]);
        $invalid->assertStatus(422);
        $invalid->assertJsonPath('error', 'Pilihan jawaban tidak valid');

        $valid = $this->actingAs($siswa)->postJson('/api/quiz/answer', [
            'quiz_id' => $quizId,
            'submission_id' => $submissionId,
            'question_id' => $questionA,
            'option_id' => $validOption,
        ]);
        $valid->assertOk();

        $this->assertDatabaseHas('quiz_answers', [
            'submission_id' => $submissionId,
            'question_id' => $questionA,
            'option_id' => $validOption,
            'tenant_id' => $tenantId,
        ]);
    }

    public function test_batch_answer_endpoint_saves_multiple_answers_and_is_idempotent(): void
    {
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'IPA',
            'nama' => 'Quiz Batch',
            'starts_at' => now()->subMinute(),
            'deadline_at' => now()->addHour(),
            'is_live' => false,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $mcqId = (string) Str::uuid();
        $essayId = (string) Str::uuid();
        DB::table('quiz_questions')->insert([
            [
                'id' => $mcqId,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'nomor' => 1,
                'question_type' => 'mcq',
                'soal' => 'Pilihan',
                'poin' => 10,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => $essayId,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'nomor' => 2,
                'question_type' => 'essay',
                'soal' => 'Esai',
                'poin' => 20,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $optionId = (string) Str::uuid();
        DB::table('quiz_options')->insert([
            'id' => $optionId,
            'tenant_id' => $tenantId,
            'question_id' => $mcqId,
            'label' => 'A',
            'text' => 'Benar',
            'is_correct' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $start = $this->actingAs($siswa)->postJson('/api/quiz/start', ['quiz_id' => $quizId]);
        $start->assertOk();
        $submissionId = $start->json('data.submission.id');

        $payload = [
            'quiz_id' => $quizId,
            'submission_id' => $submissionId,
            'answers' => [
                ['question_id' => $mcqId, 'option_id' => $optionId],
                ['question_id' => $essayId, 'essay_answer' => 'Jawaban pertama'],
            ],
        ];

        $first = $this->actingAs($siswa)->postJson('/api/quiz/answers/batch', $payload);
        $first->assertOk();
        $first->assertJsonPath('data.saved_count', 2);

        $payload['answers'][1]['essay_answer'] = 'Jawaban diperbarui';
        $second = $this->actingAs($siswa)->postJson('/api/quiz/answers/batch', $payload);
        $second->assertOk();
        $second->assertJsonPath('data.saved_count', 2);

        $this->assertSame(
            2,
            DB::table('quiz_answers')
                ->where('tenant_id', $tenantId)
                ->where('submission_id', $submissionId)
                ->count()
        );
        $this->assertDatabaseHas('quiz_answers', [
            'tenant_id' => $tenantId,
            'submission_id' => $submissionId,
            'question_id' => $essayId,
            'essay_answer' => 'Jawaban diperbarui',
        ]);
    }

    public function test_close_quiz_endpoint_finalizes_ongoing_submissions(): void
    {
        $tenantId = $this->defaultTenantId();
        [$siswa] = $this->createUserWithProfile($tenantId, 'siswa', 'X-1');
        [$guru] = $this->createUserWithProfile($tenantId, 'guru', 'X-1');

        $quizId = (string) Str::uuid();
        DB::table('quizzes')->insert([
            'id' => $quizId,
            'tenant_id' => $tenantId,
            'guru_id' => $guru->id,
            'kelas_id' => 'X-1',
            'mapel' => 'Kimia',
            'nama' => 'Quiz Tutup',
            'starts_at' => now()->subMinute(),
            'deadline_at' => now()->addHour(),
            'is_live' => false,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $questionId = (string) Str::uuid();
        $optionId = (string) Str::uuid();
        DB::table('quiz_questions')->insert([
            'id' => $questionId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'nomor' => 1,
            'soal' => 'Soal',
            'poin' => 10,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_options')->insert([
            'id' => $optionId,
            'tenant_id' => $tenantId,
            'question_id' => $questionId,
            'label' => 'A',
            'text' => 'Benar',
            'is_correct' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $submissionId = (string) Str::uuid();
        DB::table('quiz_submissions')->insert([
            'id' => $submissionId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'siswa_id' => $siswa->id,
            'status' => 'ongoing',
            'started_at' => now()->subMinute(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('quiz_answers')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'submission_id' => $submissionId,
            'question_id' => $questionId,
            'option_id' => $optionId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($guru)->postJson('/api/quiz/close', [
            'quiz_id' => $quizId,
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.finalized_submissions', 1);
        $this->assertDatabaseHas('quiz_submissions', [
            'id' => $submissionId,
            'tenant_id' => $tenantId,
            'status' => 'finished',
            'score' => 100,
            'total_points' => 10,
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

    private function createUserWithProfile(string $tenantId, string $role, string $kelas): array
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $role.' test',
            'email' => $role.'_'.Str::random(8).'@example.com',
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

        return [$user];
    }

    private function seedGuruTeachingMapel(string $tenantId, string $guruId, string $kelasId, string $mapel): void
    {
        $period = AcademicPeriod::current();

        DB::table('kelas')->updateOrInsert(
            ['id' => $kelasId],
            [
                'tenant_id' => $tenantId,
                'nama' => $kelasId,
                'grade' => '10',
                'suffix' => 'A',
                'tahun_ajaran' => $period['tahun_ajaran'],
                'semester' => $period['semester'],
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        DB::table('jadwal')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'kelas_id' => $kelasId,
            'hari' => 'Senin',
            'mapel' => $mapel,
            'guru_id' => $guruId,
            'guru_nama' => 'Guru Uji',
            'jam_mulai' => '07:00:00',
            'jam_selesai' => '08:00:00',
            'tahun_ajaran' => $period['tahun_ajaran'],
            'semester' => $period['semester'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
