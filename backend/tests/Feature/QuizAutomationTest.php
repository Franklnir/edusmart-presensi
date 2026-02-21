<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Quiz\QuizScoringService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class QuizAutomationTest extends TestCase
{
    use RefreshDatabase;

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

        $response = $this->actingAs($user)->postJson('/api/db', [
            'table' => 'quiz_submissions',
            'action' => 'insert',
            'payload' => [
                'id' => (string) Str::uuid(),
                'quiz_id' => $quizId,
            ],
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Quiz belum tersedia atau sudah berakhir');
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

        $response = $this->actingAs($siswa)->postJson('/api/db', [
            'table' => 'quiz_submissions',
            'action' => 'insert',
            'payload' => [
                'id' => (string) Str::uuid(),
                'quiz_id' => $quizId,
            ],
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('error', 'Quiz belum tersedia atau sudah berakhir');
    }

    public function test_submit_quiz_calculates_score_from_question_points(): void
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

    public function test_submit_quiz_with_skala_100_ignores_question_weights(): void
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
        DB::table('kelas')->updateOrInsert(
            ['id' => $kelasId],
            [
                'tenant_id' => $tenantId,
                'nama' => $kelasId,
                'grade' => '10',
                'suffix' => 'A',
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
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
