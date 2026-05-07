<?php

namespace App\Http\Controllers\Api;

use App\Services\Quiz\QuizScoringService;
use App\Support\AcademicPeriod;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class QuizController extends ApiController
{
    private const DEFAULT_QUIZ_TIMEZONE = 'Asia/Jakarta';

    public function __construct(
        private readonly QuizScoringService $scoringService
    ) {}

    public function submit(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $payload = $request->only(['quiz_id', 'submission_id', 'answers']);
        $quizId = trim((string) ($payload['quiz_id'] ?? ''));
        $submissionId = trim((string) ($payload['submission_id'] ?? ''));
        $answers = $payload['answers'] ?? [];

        if ($quizId === '') {
            return response()->json(['error' => 'quiz_id wajib diisi'], 422);
        }

        $user = $request->user();
        $resolved = $this->resolveStudentQuiz($request, $tenantId, $quizId);
        if ($resolved['response'] !== null) {
            return $resolved['response'];
        }
        $quiz = $resolved['quiz'];
        $now = $this->quizNow($quiz);

        $submission = null;
        if ($submissionId !== '') {
            $submission = DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('quiz_id', $quizId)
                ->where('siswa_id', $user->id)
                ->where('tenant_id', $tenantId)
                ->first();
        }
        if (! $submission) {
            $submission = DB::table('quiz_submissions')
                ->where('quiz_id', $quizId)
                ->where('siswa_id', $user->id)
                ->where('tenant_id', $tenantId)
                ->first();
        }

        if ($submission && $submission->status === 'finished') {
            $result = $this->scoringService->finalizeSubmission($tenantId, (string) $submission->id, $now, 'finished');

            return response()->json([
                'data' => [
                    'submission_id' => $result['submission_id'] ?? (string) $submission->id,
                    'score' => $result['score'] ?? ($submission->score !== null ? (int) $submission->score : null),
                    'total_points' => $result['total_points'] ?? ($submission->total_points !== null ? (int) $submission->total_points : null),
                ],
            ]);
        }

        $availability = $this->quizAvailabilityForStudent($quiz, $now);
        if (! $availability['ok']) {
            if ($submission && in_array((string) ($availability['reason'] ?? ''), ['closed', 'ended'], true)) {
                $result = $this->scoringService->finalizeSubmission($tenantId, (string) $submission->id, $now, 'finished');

                return response()->json([
                    'data' => [
                        'submission_id' => $result['submission_id'] ?? (string) $submission->id,
                        'score' => $result['score'] ?? ($submission->score !== null ? (int) $submission->score : null),
                        'total_points' => $result['total_points'] ?? ($submission->total_points !== null ? (int) $submission->total_points : null),
                        'closed_by_server' => true,
                    ],
                ]);
            }

            return response()->json(['error' => $availability['message']], $availability['code']);
        }

        if (! $submission) {
            $accessResponse = $this->denyIfQuizAccessCodeInvalid($quiz, $request->input('access_code'));
            if ($accessResponse !== null) {
                return $accessResponse;
            }

            $created = $this->createQuizSubmission($tenantId, $quiz, (string) $user->id, $now, $request->input('client_meta'));
            if ($created['response'] !== null) {
                return $created['response'];
            }
            $submission = $created['submission'];
        }
        $submissionId = (string) $submission->id;

        if ($answers !== null && ! is_array($answers)) {
            return response()->json(['error' => 'Format jawaban tidak valid'], 422);
        }

        if (is_array($answers) && count($answers)) {
            foreach ($answers as $row) {
                if (! is_array($row)) {
                    continue;
                }
                $questionId = isset($row['question_id']) ? (string) $row['question_id'] : '';
                $optionId = isset($row['option_id']) ? (string) $row['option_id'] : '';
                $essayAnswerRaw = $row['essay_answer'] ?? null;
                if (! $questionId) {
                    continue;
                }

                $saved = $this->storeSubmissionAnswer(
                    $tenantId,
                    $quizId,
                    $submissionId,
                    $questionId,
                    $optionId,
                    $essayAnswerRaw,
                    $now,
                    isset($row['id']) ? (string) $row['id'] : null
                );
                if (! $saved['ok']) {
                    return response()->json(['error' => $saved['message']], $saved['code']);
                }
            }
        }

        $result = $this->scoringService->finalizeSubmission($tenantId, $submissionId, $now, 'finished');
        if (! $result) {
            return response()->json(['error' => 'Gagal menyelesaikan quiz'], 500);
        }

        return response()->json([
            'data' => [
                'submission_id' => $result['submission_id'],
                'score' => $result['score'],
                'total_points' => $result['total_points'],
            ],
        ]);
    }

    public function startAttempt(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['error' => 'quiz_id wajib diisi'], 422);
        }

        $resolved = $this->resolveStudentQuiz($request, $tenantId, $quizId);
        if ($resolved['response'] !== null) {
            return $resolved['response'];
        }

        $quiz = $resolved['quiz'];
        $now = $this->quizNow($quiz);
        $availability = $this->quizAvailabilityForStudent($quiz, $now);
        if (! $availability['ok']) {
            return response()->json(['error' => $availability['message']], $availability['code']);
        }

        $user = $request->user();
        $submission = DB::table('quiz_submissions')
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $user->id)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $submission) {
            $accessResponse = $this->denyIfQuizAccessCodeInvalid($quiz, $request->input('access_code'));
            if ($accessResponse !== null) {
                return $accessResponse;
            }

            $created = $this->createQuizSubmission($tenantId, $quiz, (string) $user->id, $now, $request->input('client_meta'));
            if ($created['response'] !== null) {
                return $created['response'];
            }
            $submission = $created['submission'];
        }

        $detail = $this->studentQuizDetail($tenantId, $quiz, $submission, $now);

        return response()->json([
            'data' => [
                'submission' => $this->submissionPayload($submission),
                'questions' => $detail['questions'],
                'options_by_question' => $detail['options_by_question'],
                'order' => $detail['order'],
                'timing' => $this->quizTimingPayload($quiz, $now),
            ],
        ]);
    }

    public function saveAnswer(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        $questionId = trim((string) $request->input('question_id', ''));
        if ($quizId === '' || $submissionId === '' || $questionId === '') {
            return response()->json(['error' => 'quiz_id, submission_id, dan question_id wajib diisi'], 422);
        }

        $resolved = $this->resolveStudentQuiz($request, $tenantId, $quizId);
        if ($resolved['response'] !== null) {
            return $resolved['response'];
        }
        $quiz = $resolved['quiz'];
        $now = $this->quizNow($quiz);

        $submission = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $request->user()?->id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $submission) {
            return response()->json(['error' => 'Attempt quiz tidak ditemukan'], 404);
        }
        if ((string) ($submission->status ?? '') === 'finished') {
            return response()->json(['error' => 'Quiz sudah selesai, jawaban tidak bisa diubah'], 422);
        }

        $availability = $this->quizAvailabilityForStudent($quiz, $now);
        if (! $availability['ok']) {
            if (in_array((string) ($availability['reason'] ?? ''), ['closed', 'ended'], true)) {
                $this->scoringService->finalizeSubmission($tenantId, $submissionId, $now, 'finished');
            }

            return response()->json(['error' => $availability['message']], $availability['code']);
        }

        $saved = $this->storeSubmissionAnswer(
            $tenantId,
            $quizId,
            $submissionId,
            $questionId,
            $request->input('option_id'),
            $request->input('essay_answer'),
            $now,
            $request->input('id')
        );
        if (! $saved['ok']) {
            return response()->json(['error' => $saved['message']], $saved['code']);
        }

        if (Schema::hasColumn('quiz_submissions', 'last_saved_at')) {
            DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'last_saved_at' => $now,
                    'updated_at' => $now,
                ]);
        }

        return response()->json([
            'data' => [
                'answer_id' => $saved['answer_id'],
                'submission_id' => $submissionId,
                'question_id' => $questionId,
                'saved_at' => $now->toISOString(),
            ],
        ]);
    }

    public function logViolation(Request $request)
    {
        if (! $this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }
        if (! Schema::hasTable('quiz_violation_logs')) {
            return response()->json(['data' => ['skipped' => true]]);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        if ($quizId === '' || $submissionId === '') {
            return response()->json(['error' => 'quiz_id dan submission_id wajib diisi'], 422);
        }

        $submission = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $request->user()?->id)
            ->where('tenant_id', $tenantId)
            ->first(['id']);
        if (! $submission) {
            return response()->json(['error' => 'Attempt quiz tidak ditemukan'], 404);
        }

        $eventType = trim((string) $request->input('event_type', 'warning'));
        if ($eventType === '') {
            $eventType = 'warning';
        }

        $meta = $request->input('event_meta', $request->input('meta'));
        $logId = (string) Str::uuid();
        DB::table('quiz_violation_logs')->insert([
            'id' => $logId,
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'submission_id' => $submissionId,
            'siswa_id' => $request->user()?->id,
            'event_type' => Str::limit($eventType, 80, ''),
            'event_message' => $request->input('event_message'),
            'event_meta' => $this->encodeJsonOrNull($meta),
            'created_at' => $this->quizNow()->toISOString(),
        ]);

        return response()->json(['data' => ['id' => $logId]]);
    }

    public function publish(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['error' => 'quiz_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForTeacherAction($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $now = $this->quizNow($quiz);
        $activate = $request->has('activate') ? $request->boolean('activate') : true;
        $updates = [
            'is_active' => $activate,
            'updated_at' => $now,
        ];
        if ($activate && Schema::hasColumn('quizzes', 'published_at')) {
            $updates['published_at'] = $now;
        }
        if ($activate && Schema::hasColumn('quizzes', 'closed_at')) {
            $updates['closed_at'] = null;
        }
        if (Schema::hasColumn('quizzes', 'shuffle_questions') && $request->has('shuffle_questions')) {
            $updates['shuffle_questions'] = $request->boolean('shuffle_questions');
        }
        if (Schema::hasColumn('quizzes', 'shuffle_options') && $request->has('shuffle_options')) {
            $updates['shuffle_options'] = $request->boolean('shuffle_options');
        }
        if (Schema::hasColumn('quizzes', 'max_attempts') && $request->has('max_attempts')) {
            $maxAttempts = $request->input('max_attempts');
            if ($maxAttempts === null || $maxAttempts === '') {
                $updates['max_attempts'] = null;
            } elseif (is_numeric($maxAttempts) && (int) $maxAttempts >= 1 && (int) $maxAttempts <= 20) {
                $updates['max_attempts'] = (int) $maxAttempts;
            } else {
                return response()->json(['error' => 'Batas percobaan harus 1 sampai 20'], 422);
            }
        }
        if (Schema::hasColumn('quizzes', 'security_mode') && $request->has('security_mode')) {
            $mode = strtolower(trim((string) $request->input('security_mode', 'standard')));
            if (! in_array($mode, ['standard', 'strict'], true)) {
                return response()->json(['error' => 'Mode keamanan quiz tidak valid'], 422);
            }
            $updates['security_mode'] = $mode;
        }
        if (Schema::hasColumn('quizzes', 'timezone') && $request->has('timezone')) {
            $timezone = trim((string) $request->input('timezone', self::DEFAULT_QUIZ_TIMEZONE));
            if (! $this->isValidTimezone($timezone)) {
                return response()->json(['error' => 'Timezone quiz tidak valid'], 422);
            }
            $updates['timezone'] = $timezone;
        }
        if (Schema::hasColumn('quizzes', 'access_code_hash') && $request->has('access_code')) {
            $accessCode = trim((string) $request->input('access_code', ''));
            $updates['access_code_hash'] = $accessCode === '' ? null : Hash::make($accessCode);
        }

        DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        $fresh = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first();
        $freshPayload = $fresh ? (array) $fresh : null;
        if (is_array($freshPayload)) {
            unset($freshPayload['access_code_hash']);
        }

        return response()->json(['data' => ['quiz' => $freshPayload]]);
    }

    public function close(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['error' => 'quiz_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForTeacherAction($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $now = $this->quizNow($quiz);
        $updates = [
            'is_active' => false,
            'updated_at' => $now,
        ];
        if (Schema::hasColumn('quizzes', 'closed_at')) {
            $updates['closed_at'] = $now;
        }

        DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->update($updates);

        $submissionIds = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('status', 'ongoing')
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->all();

        $finalized = 0;
        foreach ($submissionIds as $submissionId) {
            $result = $this->scoringService->finalizeSubmission($tenantId, $submissionId, $now, 'finished');
            if ($result) {
                $finalized++;
            }
        }

        return response()->json([
            'data' => [
                'quiz_id' => $quizId,
                'closed_at' => $now->toISOString(),
                'finalized_submissions' => $finalized,
            ],
        ]);
    }

    public function gradeEssay(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $freezeResponse = $this->denyIfNilaiFrozen($request, 'Perubahan nilai quiz');
        if ($freezeResponse !== null) {
            return $freezeResponse;
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));
        $questionId = trim((string) $request->input('question_id', ''));
        $essayScoreRaw = $request->input('essay_score');

        if ($quizId === '' || $questionId === '' || $essayScoreRaw === null || $essayScoreRaw === '') {
            return response()->json(['error' => 'quiz_id, question_id, dan essay_score wajib diisi'], 422);
        }

        if ($submissionId === '' && $siswaId === '') {
            return response()->json(['error' => 'submission_id atau siswa_id wajib diisi'], 422);
        }

        if (! is_numeric($essayScoreRaw)) {
            return response()->json(['error' => 'Nilai esai harus berupa angka'], 422);
        }
        $essayScoreNumber = (float) $essayScoreRaw;
        if (! is_finite($essayScoreNumber) || floor($essayScoreNumber) !== $essayScoreNumber) {
            return response()->json(['error' => 'Nilai esai harus bilangan bulat'], 422);
        }
        $essayScore = (int) $essayScoreNumber;

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $submissionQuery = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId);
        if ($submissionId !== '') {
            $submissionQuery->where('id', $submissionId);
        }
        if ($siswaId !== '') {
            $submissionQuery->where('siswa_id', $siswaId);
        }
        $submission = $submissionQuery->first();

        if (! $submission) {
            return response()->json(['error' => 'Submission siswa tidak ditemukan'], 404);
        }
        if ((string) ($submission->status ?? '') !== 'finished') {
            return response()->json(['error' => 'Esai hanya bisa dikoreksi setelah siswa menyelesaikan quiz'], 422);
        }

        $question = DB::table('quiz_questions')
            ->where('id', $questionId)
            ->where('quiz_id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'poin', 'question_type']);
        if (! $question) {
            return response()->json(['error' => 'Soal quiz tidak ditemukan'], 404);
        }

        $questionType = $this->normalizeQuestionType($question->question_type ?? null);
        if ($questionType !== 'essay') {
            return response()->json(['error' => 'Soal ini bukan tipe esai'], 422);
        }

        $maxPoint = max(0, (int) ($question->poin ?? 0));
        if ($essayScore < 0 || $essayScore > $maxPoint) {
            return response()->json(['error' => "Nilai esai harus 0 sampai {$maxPoint}"], 422);
        }

        $answer = DB::table('quiz_answers')
            ->where('submission_id', $submission->id)
            ->where('question_id', $questionId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'essay_answer', 'essay_score', 'poin']);

        if (! $answer) {
            return response()->json(['error' => 'Jawaban esai siswa belum tersedia'], 422);
        }

        $hasEssayAnswer = trim((string) ($answer->essay_answer ?? '')) !== '';
        if (! $hasEssayAnswer && $essayScore > 0) {
            return response()->json(['error' => 'Jawaban esai kosong, nilai harus 0'], 422);
        }
        if ($hasEssayAnswer && $maxPoint > 0 && $essayScore < 1) {
            return response()->json(['error' => 'Nilai esai minimal 1 untuk jawaban terisi'], 422);
        }

        $now = now();
        $oldAnswerData = [
            'essay_score' => $answer->essay_score !== null ? (int) $answer->essay_score : null,
            'poin' => $answer->poin !== null ? (int) $answer->poin : null,
        ];
        $oldSubmissionData = [
            'score' => $submission->score !== null ? (int) $submission->score : null,
            'total_points' => $submission->total_points !== null ? (int) $submission->total_points : null,
            'essay_review_completed_at' => $submission->essay_review_completed_at ?? null,
            'essay_review_completed_by' => $submission->essay_review_completed_by ?? null,
        ];

        DB::table('quiz_answers')
            ->where('id', $answer->id)
            ->where('tenant_id', $tenantId)
            ->update([
                'essay_score' => $essayScore,
                'poin' => $essayScore,
                'updated_at' => $now,
            ]);

        if (Schema::hasColumn('quiz_submissions', 'essay_review_completed_at')) {
            $resetPayload = [
                'essay_review_completed_at' => null,
                'updated_at' => $now,
            ];
            if (Schema::hasColumn('quiz_submissions', 'essay_review_completed_by')) {
                $resetPayload['essay_review_completed_by'] = null;
            }

            DB::table('quiz_submissions')
                ->where('id', $submission->id)
                ->where('tenant_id', $tenantId)
                ->update($resetPayload);
        }

        $result = $this->scoringService->finalizeSubmission(
            $tenantId,
            (string) $submission->id,
            $now,
            'finished',
            true
        );

        $submissionFresh = DB::table('quiz_submissions')
            ->where('id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->first([
                'id',
                'score',
                'total_points',
                'essay_review_completed_at',
                'essay_review_completed_by',
            ]);

        $this->logAudit(
            $request,
            'quiz_answers',
            (string) $answer->id,
            'UPDATE',
            $oldAnswerData,
            [
                'essay_score' => $essayScore,
                'poin' => $essayScore,
            ],
            $tenantId
        );

        $this->logAudit(
            $request,
            'quiz_submissions',
            (string) $submission->id,
            'UPDATE',
            $oldSubmissionData,
            [
                'score' => $submissionFresh?->score !== null ? (int) $submissionFresh->score : null,
                'total_points' => $submissionFresh?->total_points !== null ? (int) $submissionFresh->total_points : null,
                'essay_review_completed_at' => $submissionFresh?->essay_review_completed_at ?? null,
                'essay_review_completed_by' => $submissionFresh?->essay_review_completed_by ?? null,
            ],
            $tenantId
        );

        return response()->json([
            'data' => [
                'quiz_id' => $quizId,
                'submission_id' => (string) $submission->id,
                'siswa_id' => (string) $submission->siswa_id,
                'question_id' => $questionId,
                'essay_score' => $essayScore,
                'max_poin' => $maxPoint,
                'essay_review_completed_at' => null,
                'essay_review_completed_by' => null,
                'score' => $result['score'] ?? null,
                'total_points' => $result['total_points'] ?? null,
            ],
        ]);
    }

    public function completeEssayReview(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        if (! Schema::hasColumn('quiz_submissions', 'essay_review_completed_at')) {
            return response()->json(['error' => 'Fitur selesai koreksi belum tersedia. Jalankan migrasi terbaru.'], 422);
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $freezeResponse = $this->denyIfNilaiFrozen($request, 'Finalisasi koreksi nilai quiz');
        if ($freezeResponse !== null) {
            return $freezeResponse;
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $submissionId = trim((string) $request->input('submission_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));

        if ($quizId === '') {
            return response()->json(['error' => 'quiz_id wajib diisi'], 422);
        }
        if ($submissionId === '' && $siswaId === '') {
            return response()->json(['error' => 'submission_id atau siswa_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $submissionQuery = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId);
        if ($submissionId !== '') {
            $submissionQuery->where('id', $submissionId);
        }
        if ($siswaId !== '') {
            $submissionQuery->where('siswa_id', $siswaId);
        }
        $submission = $submissionQuery->first();

        if (! $submission) {
            return response()->json(['error' => 'Submission siswa tidak ditemukan'], 404);
        }
        if ((string) ($submission->status ?? '') !== 'finished') {
            return response()->json(['error' => 'Koreksi esai hanya untuk submission yang sudah selesai'], 422);
        }

        $essayQuestionIds = DB::table('quiz_questions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('question_type', 'essay')
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->all();

        if (empty($essayQuestionIds)) {
            return response()->json(['error' => 'Quiz ini tidak memiliki soal esai'], 422);
        }

        $answerRows = DB::table('quiz_answers')
            ->where('tenant_id', $tenantId)
            ->where('submission_id', $submission->id)
            ->whereIn('question_id', $essayQuestionIds)
            ->get(['essay_answer', 'essay_score']);

        $pendingCount = 0;
        foreach ($answerRows as $row) {
            $answerText = trim((string) ($row->essay_answer ?? ''));
            if ($answerText === '') {
                continue;
            }
            if ($row->essay_score === null) {
                $pendingCount++;
            }
        }
        if ($pendingCount > 0) {
            return response()->json(['error' => "Masih ada {$pendingCount} jawaban esai yang belum dinilai"], 422);
        }

        $oldSubmissionData = [
            'essay_review_completed_at' => $submission->essay_review_completed_at ?? null,
            'essay_review_completed_by' => $submission->essay_review_completed_by ?? null,
        ];

        $now = now();
        $payload = [
            'essay_review_completed_at' => $now,
            'updated_at' => $now,
        ];
        if (Schema::hasColumn('quiz_submissions', 'essay_review_completed_by')) {
            $payload['essay_review_completed_by'] = $request->user()?->id;
        }

        DB::table('quiz_submissions')
            ->where('id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->update($payload);

        $submissionFresh = DB::table('quiz_submissions')
            ->where('id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'quiz_id', 'siswa_id', 'essay_review_completed_at', 'essay_review_completed_by', 'score', 'total_points']);

        $this->logAudit(
            $request,
            'quiz_submissions',
            (string) $submissionFresh->id,
            'UPDATE',
            $oldSubmissionData,
            [
                'essay_review_completed_at' => $submissionFresh->essay_review_completed_at,
                'essay_review_completed_by' => $submissionFresh->essay_review_completed_by,
                'score' => $submissionFresh->score !== null ? (int) $submissionFresh->score : null,
                'total_points' => $submissionFresh->total_points !== null ? (int) $submissionFresh->total_points : null,
            ],
            $tenantId
        );

        return response()->json([
            'data' => [
                'submission_id' => (string) $submissionFresh->id,
                'quiz_id' => (string) $submissionFresh->quiz_id,
                'siswa_id' => (string) $submissionFresh->siswa_id,
                'essay_review_completed_at' => $submissionFresh->essay_review_completed_at,
                'essay_review_completed_by' => $submissionFresh->essay_review_completed_by,
                'score' => $submissionFresh->score !== null ? (int) $submissionFresh->score : null,
                'total_points' => $submissionFresh->total_points !== null ? (int) $submissionFresh->total_points : null,
            ],
        ]);
    }

    public function retake(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $freezeResponse = $this->denyIfNilaiFrozen($request, 'Reset/retake nilai quiz');
        if ($freezeResponse !== null) {
            return $freezeResponse;
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));
        $confirmed = (bool) $request->boolean('confirmed', false);

        if ($quizId === '' || $siswaId === '') {
            return response()->json(['error' => 'quiz_id dan siswa_id wajib diisi'], 422);
        }
        if (! $confirmed) {
            return response()->json(['error' => 'Konfirmasi ulang quiz wajib disetujui'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $submission = DB::table('quiz_submissions')
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $submission) {
            return response()->json(['error' => 'Siswa belum memiliki attempt quiz'], 404);
        }

        $siswa = DB::table('profiles')
            ->where('id', $siswaId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'nama', 'role']);

        if (! $siswa || strtolower((string) ($siswa->role ?? '')) !== 'siswa') {
            return response()->json(['error' => 'Data siswa tidak valid'], 422);
        }

        $answerRows = DB::table('quiz_answers')
            ->where('submission_id', $submission->id)
            ->where('tenant_id', $tenantId)
            ->get([
                'id',
                'question_id',
                'option_id',
                'essay_answer',
                'essay_score',
                'is_correct',
                'poin',
            ])
            ->map(fn ($row) => (array) $row)
            ->values()
            ->all();

        $now = now();
        $user = $request->user();
        $logId = (string) Str::uuid();

        DB::transaction(function () use ($tenantId, $quizId, $siswaId, $submission, $user, $now, $logId) {
            DB::table('quiz_retake_logs')->insert([
                'id' => $logId,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'guru_id' => $user?->id,
                'submission_id' => $submission->id,
                'previous_score' => $submission->score,
                'previous_total_points' => $submission->total_points,
                'previous_status' => $submission->status,
                'previous_started_at' => $submission->started_at,
                'previous_finished_at' => $submission->finished_at,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('quiz_answers')
                ->where('submission_id', $submission->id)
                ->where('tenant_id', $tenantId)
                ->delete();

            DB::table('quiz_submissions')
                ->where('id', $submission->id)
                ->where('tenant_id', $tenantId)
                ->delete();
        }, 3);

        $this->logAudit(
            $request,
            'quiz_retake_logs',
            $logId,
            'INSERT',
            null,
            [
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'submission_id' => (string) $submission->id,
                'previous_score' => $submission->score !== null ? (int) $submission->score : null,
                'previous_total_points' => $submission->total_points !== null ? (int) $submission->total_points : null,
            ],
            $tenantId
        );

        $this->logAudit(
            $request,
            'quiz_answers',
            (string) $submission->id,
            'DELETE',
            [
                'count' => count($answerRows),
                'rows' => $answerRows,
            ],
            null,
            $tenantId
        );

        $this->logAudit(
            $request,
            'quiz_submissions',
            (string) $submission->id,
            'DELETE',
            (array) $submission,
            null,
            $tenantId
        );

        return response()->json([
            'data' => [
                'retake_log_id' => $logId,
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'siswa_nama' => $siswa->nama,
                'previous_score' => $submission->score !== null ? (int) $submission->score : null,
                'previous_total_points' => $submission->total_points !== null ? (int) $submission->total_points : null,
                'previous_status' => $submission->status,
            ],
        ]);
    }

    public function retakeHistory(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->query('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['error' => 'quiz_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $rows = DB::table('quiz_retake_logs as l')
            ->leftJoin('profiles as s', function ($join) {
                $join->on('s.id', '=', 'l.siswa_id')
                    ->on('s.tenant_id', '=', 'l.tenant_id');
            })
            ->leftJoin('profiles as g', function ($join) {
                $join->on('g.id', '=', 'l.guru_id')
                    ->on('g.tenant_id', '=', 'l.tenant_id');
            })
            ->where('l.tenant_id', $tenantId)
            ->where('l.quiz_id', $quizId)
            ->orderByDesc('l.created_at')
            ->get([
                'l.id',
                'l.quiz_id',
                'l.siswa_id',
                'l.guru_id',
                'l.submission_id',
                'l.previous_score',
                'l.previous_total_points',
                'l.previous_status',
                'l.previous_started_at',
                'l.previous_finished_at',
                'l.created_at',
                's.nama as siswa_nama',
                'g.nama as guru_nama',
            ]);

        return response()->json(['data' => $rows]);
    }

    public function restoreRetakeScore(Request $request)
    {
        if (! $this->isGuru($request) && ! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $freezeResponse = $this->denyIfNilaiFrozen($request, 'Pemulihan nilai quiz');
        if ($freezeResponse !== null) {
            return $freezeResponse;
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));

        if ($quizId === '' || $siswaId === '') {
            return response()->json(['error' => 'quiz_id dan siswa_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (! $quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $siswa = DB::table('profiles')
            ->where('id', $siswaId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'nama', 'role']);

        if (! $siswa || strtolower((string) ($siswa->role ?? '')) !== 'siswa') {
            return response()->json(['error' => 'Data siswa tidak valid'], 422);
        }

        $latestLog = DB::table('quiz_retake_logs')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->first([
                'id',
                'previous_score',
                'previous_total_points',
                'previous_started_at',
                'previous_finished_at',
                'created_at',
            ]);

        if (! $latestLog) {
            return response()->json(['error' => 'Riwayat nilai sebelum ulang tidak ditemukan'], 404);
        }
        if ($latestLog->previous_score === null) {
            return response()->json(['error' => 'Nilai sebelum ulang belum tersedia untuk dipulihkan'], 422);
        }

        $existingSubmission = DB::table('quiz_submissions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->first([
                'id',
                'status',
                'score',
                'total_points',
                'started_at',
                'finished_at',
                'essay_review_completed_at',
                'essay_review_completed_by',
            ]);

        if ($existingSubmission && strtolower(trim((string) ($existingSubmission->status ?? ''))) === 'ongoing') {
            return response()->json(['error' => 'Siswa sedang mengerjakan quiz. Selesaikan atau reset dulu sebelum memulihkan nilai lama'], 422);
        }

        $now = now();
        $score = (int) $latestLog->previous_score;
        $totalPoints = $latestLog->previous_total_points !== null
            ? (int) $latestLog->previous_total_points
            : (int) DB::table('quiz_questions')
                ->where('tenant_id', $tenantId)
                ->where('quiz_id', $quizId)
                ->sum('poin');

        $hasReviewCompletedAt = Schema::hasColumn('quiz_submissions', 'essay_review_completed_at');
        $hasReviewCompletedBy = Schema::hasColumn('quiz_submissions', 'essay_review_completed_by');

        $submissionId = DB::transaction(function () use (
            $tenantId,
            $quizId,
            $siswaId,
            $existingSubmission,
            $latestLog,
            $score,
            $totalPoints,
            $now,
            $hasReviewCompletedAt,
            $hasReviewCompletedBy,
            $request,
            $quiz
        ) {
            $payload = [
                'score' => $score,
                'total_points' => $totalPoints,
                'status' => 'finished',
                'finished_at' => $latestLog->previous_finished_at ?: $now,
                'updated_at' => $now,
            ];
            $payload = array_merge($payload, $this->quizSubmissionAcademicSnapshot($tenantId, $quiz, $siswaId));

            if ($hasReviewCompletedAt) {
                $payload['essay_review_completed_at'] = $now;
                if ($hasReviewCompletedBy) {
                    $payload['essay_review_completed_by'] = $request->user()?->id;
                }
            }

            if ($existingSubmission) {
                DB::table('quiz_submissions')
                    ->where('id', $existingSubmission->id)
                    ->where('tenant_id', $tenantId)
                    ->update($payload);

                return (string) $existingSubmission->id;
            }

            $newSubmissionId = (string) Str::uuid();
            DB::table('quiz_submissions')->insert(array_merge($payload, [
                'id' => $newSubmissionId,
                'tenant_id' => $tenantId,
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'started_at' => $latestLog->previous_started_at ?: ($latestLog->previous_finished_at ?: $now),
                'created_at' => $now,
            ]));

            return $newSubmissionId;
        }, 3);

        $selectColumns = [
            'id',
            'quiz_id',
            'siswa_id',
            'status',
            'score',
            'total_points',
            'started_at',
            'finished_at',
        ];
        if ($hasReviewCompletedAt) {
            $selectColumns[] = 'essay_review_completed_at';
        }
        if ($hasReviewCompletedBy) {
            $selectColumns[] = 'essay_review_completed_by';
        }

        $submissionFresh = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('tenant_id', $tenantId)
            ->first($selectColumns);

        $auditAction = $existingSubmission ? 'UPDATE' : 'INSERT';
        $this->logAudit(
            $request,
            'quiz_submissions',
            (string) $submissionFresh->id,
            $auditAction,
            $existingSubmission ? (array) $existingSubmission : null,
            (array) $submissionFresh,
            $tenantId
        );

        return response()->json([
            'data' => [
                'submission_id' => (string) $submissionFresh->id,
                'quiz_id' => (string) $submissionFresh->quiz_id,
                'siswa_id' => (string) $submissionFresh->siswa_id,
                'siswa_nama' => (string) ($siswa->nama ?? ''),
                'score' => $submissionFresh->score !== null ? (int) $submissionFresh->score : null,
                'total_points' => $submissionFresh->total_points !== null ? (int) $submissionFresh->total_points : null,
                'status' => (string) ($submissionFresh->status ?? ''),
                'essay_review_completed_at' => $hasReviewCompletedAt ? ($submissionFresh->essay_review_completed_at ?? null) : null,
                'essay_review_completed_by' => $hasReviewCompletedBy ? ($submissionFresh->essay_review_completed_by ?? null) : null,
                'restored_from_retake_log_id' => (string) $latestLog->id,
                'restored_from_retake_at' => $latestLog->created_at,
            ],
        ]);
    }

    private function resolveStudentQuiz(Request $request, string $tenantId, string $quizId): array
    {
        $quiz = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $quiz) {
            return [
                'quiz' => null,
                'response' => response()->json(['error' => 'Quiz tidak ditemukan'], 404),
            ];
        }

        if (! $this->quizMatchesActiveAcademicPeriod($quiz, $tenantId)) {
            return [
                'quiz' => null,
                'response' => $this->deny('Quiz bukan periode akademik aktif'),
            ];
        }

        $kelas = $this->profile($request)?->kelas;
        if ((string) ($quiz->kelas_id ?? '') !== (string) ($kelas ?? '')) {
            return [
                'quiz' => null,
                'response' => $this->deny('Quiz bukan untuk kelas ini'),
            ];
        }

        return [
            'quiz' => $quiz,
            'response' => null,
        ];
    }

    private function currentAcademicPeriodForTenant(string $tenantId): array
    {
        $settings = null;
        if (Schema::hasTable('settings')) {
            $settingsQuery = DB::table('settings')->orderBy('id');
            if (Schema::hasColumn('settings', 'tenant_id')) {
                $settingsQuery->where('tenant_id', $tenantId);
            }
            $settings = $settingsQuery->first(['tahun_ajaran', 'semester_aktif']);
        }

        return AcademicPeriod::fromSettings($settings);
    }

    private function quizMatchesActiveAcademicPeriod(object $quiz, string $tenantId): bool
    {
        if (! Schema::hasColumn('quizzes', 'tahun_ajaran') || ! Schema::hasColumn('quizzes', 'semester')) {
            return true;
        }

        $quizYear = AcademicPeriod::normalizeAcademicYear($quiz->tahun_ajaran ?? null);
        $quizSemester = AcademicPeriod::normalizeSemester($quiz->semester ?? null);
        if (! $quizYear || ! $quizSemester) {
            return true;
        }

        $period = $this->currentAcademicPeriodForTenant($tenantId);

        return $quizYear === $period['tahun_ajaran'] && $quizSemester === $period['semester'];
    }

    private function quizSubmissionAcademicSnapshot(string $tenantId, object $quiz, string $siswaId): array
    {
        $snapshot = [];

        if (Schema::hasColumn('quiz_submissions', 'tahun_ajaran')) {
            $year = AcademicPeriod::normalizeAcademicYear($quiz->tahun_ajaran ?? null)
                ?: $this->currentAcademicPeriodForTenant($tenantId)['tahun_ajaran'];
            $snapshot['tahun_ajaran'] = $year;
        }

        if (Schema::hasColumn('quiz_submissions', 'semester')) {
            $semester = AcademicPeriod::normalizeSemester($quiz->semester ?? null)
                ?: $this->currentAcademicPeriodForTenant($tenantId)['semester'];
            $snapshot['semester'] = $semester;
        }

        if (Schema::hasColumn('quiz_submissions', 'angkatan')) {
            $cohort = $this->studentCohortForTenant($tenantId, $siswaId);
            if (! $cohort && Schema::hasColumn('quizzes', 'angkatan')) {
                $cohort = trim((string) ($quiz->angkatan ?? '')) ?: null;
            }
            if ($cohort) {
                $snapshot['angkatan'] = $cohort;
            }
        }

        return $snapshot;
    }

    private function studentCohortForTenant(string $tenantId, string $siswaId): ?string
    {
        if (! Schema::hasColumn('profiles', 'angkatan')) {
            return null;
        }

        $query = DB::table('profiles')->where('id', $siswaId);
        if (Schema::hasColumn('profiles', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first(['angkatan']);

        return trim((string) ($row->angkatan ?? '')) ?: null;
    }

    private function quizNow(?object $quiz = null): Carbon
    {
        return Carbon::now($this->quizTimezone($quiz));
    }

    private function quizTimezone(?object $quiz = null): string
    {
        $timezone = trim((string) ($quiz->timezone ?? ''));
        if ($timezone === '') {
            $timezone = self::DEFAULT_QUIZ_TIMEZONE;
        }

        return $this->isValidTimezone($timezone) ? $timezone : self::DEFAULT_QUIZ_TIMEZONE;
    }

    private function isValidTimezone(string $timezone): bool
    {
        return in_array($timezone, timezone_identifiers_list(), true);
    }

    private function parseQuizDate($value, ?object $quiz = null): ?Carbon
    {
        if (! $value) {
            return null;
        }

        try {
            return Carbon::parse((string) $value)->setTimezone($this->quizTimezone($quiz));
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function quizAvailabilityForStudent(object $quiz, Carbon $now): array
    {
        $closedAt = $this->parseQuizDate($quiz->closed_at ?? null, $quiz);
        if ($closedAt) {
            return [
                'ok' => false,
                'reason' => 'closed',
                'message' => 'Quiz sudah ditutup oleh guru',
                'code' => 403,
                'starts_at' => $this->parseQuizDate($quiz->starts_at ?? null, $quiz),
                'ends_at' => $closedAt,
            ];
        }

        $startsAt = $this->parseQuizDate($quiz->starts_at ?? null, $quiz);
        if (! $startsAt) {
            return [
                'ok' => false,
                'reason' => 'unscheduled',
                'message' => 'Quiz belum dijadwalkan oleh guru',
                'code' => 403,
                'starts_at' => null,
                'ends_at' => null,
            ];
        }
        if ($now->lt($startsAt)) {
            return [
                'ok' => false,
                'reason' => 'scheduled',
                'message' => 'Quiz belum dimulai',
                'code' => 403,
                'starts_at' => $startsAt,
                'ends_at' => null,
            ];
        }

        if ($this->boolValue($quiz->is_live ?? false)) {
            if (! $quiz->duration_minutes) {
                return [
                    'ok' => false,
                    'reason' => 'duration_missing',
                    'message' => 'Durasi quiz belum diatur guru',
                    'code' => 403,
                    'starts_at' => $startsAt,
                    'ends_at' => null,
                ];
            }

            $liveStart = $this->parseQuizDate($quiz->live_started_at ?: ($quiz->starts_at ?? null), $quiz);
            if (! $liveStart || $now->lt($liveStart)) {
                return [
                    'ok' => false,
                    'reason' => 'scheduled',
                    'message' => 'Quiz ulangan belum dimulai',
                    'code' => 403,
                    'starts_at' => $liveStart ?: $startsAt,
                    'ends_at' => null,
                ];
            }

            $endAt = $liveStart->copy()->addMinutes((int) $quiz->duration_minutes);
            if ($now->gt($endAt)) {
                return [
                    'ok' => false,
                    'reason' => 'ended',
                    'message' => 'Quiz ulangan sudah berakhir',
                    'code' => 403,
                    'starts_at' => $liveStart,
                    'ends_at' => $endAt,
                ];
            }

            return [
                'ok' => true,
                'reason' => 'open',
                'message' => null,
                'code' => 200,
                'starts_at' => $liveStart,
                'ends_at' => $endAt,
            ];
        }

        $deadlineAt = $this->parseQuizDate($quiz->deadline_at ?? null, $quiz);
        if (! $deadlineAt) {
            return [
                'ok' => false,
                'reason' => 'deadline_missing',
                'message' => 'Deadline quiz belum diatur guru',
                'code' => 403,
                'starts_at' => $startsAt,
                'ends_at' => null,
            ];
        }
        if ($now->gt($deadlineAt)) {
            return [
                'ok' => false,
                'reason' => 'ended',
                'message' => 'Quiz sudah melewati batas waktu',
                'code' => 403,
                'starts_at' => $startsAt,
                'ends_at' => $deadlineAt,
            ];
        }

        return [
            'ok' => true,
            'reason' => 'open',
            'message' => null,
            'code' => 200,
            'starts_at' => $startsAt,
            'ends_at' => $deadlineAt,
        ];
    }

    private function quizTimingPayload(object $quiz, Carbon $now): array
    {
        $availability = $this->quizAvailabilityForStudent($quiz, $now);

        return [
            'server_time' => $now->toISOString(),
            'timezone' => $this->quizTimezone($quiz),
            'status' => $availability['reason'] ?? 'open',
            'starts_at' => ($availability['starts_at'] ?? null) instanceof Carbon
                ? $availability['starts_at']->toISOString()
                : null,
            'ends_at' => ($availability['ends_at'] ?? null) instanceof Carbon
                ? $availability['ends_at']->toISOString()
                : null,
        ];
    }

    private function denyIfQuizAccessCodeInvalid(object $quiz, $accessCode)
    {
        $hash = trim((string) ($quiz->access_code_hash ?? ''));
        if ($hash === '') {
            return null;
        }

        $code = trim((string) ($accessCode ?? ''));
        if ($code === '' || ! Hash::check($code, $hash)) {
            return response()->json(['error' => 'Kode akses quiz tidak valid'], 403);
        }

        return null;
    }

    private function createQuizSubmission(string $tenantId, object $quiz, string $siswaId, Carbon $now, $clientMeta = null): array
    {
        $attemptNo = $this->nextAttemptNumber($tenantId, (string) $quiz->id, $siswaId);
        $maxAttempts = $this->normalizePositiveInt($quiz->max_attempts ?? null);
        if ($maxAttempts !== null && $attemptNo > $maxAttempts) {
            return [
                'submission' => null,
                'response' => response()->json(['error' => 'Batas percobaan quiz sudah habis'], 403),
            ];
        }

        $submissionId = (string) Str::uuid();
        $payload = [
            'id' => $submissionId,
            'quiz_id' => (string) $quiz->id,
            'siswa_id' => $siswaId,
            'tenant_id' => $tenantId,
            'started_at' => $now,
            'status' => 'ongoing',
            'created_at' => $now,
            'updated_at' => $now,
        ];
        $payload = array_merge($payload, $this->quizSubmissionAcademicSnapshot($tenantId, $quiz, $siswaId));
        if (Schema::hasColumn('quiz_submissions', 'attempt_no')) {
            $payload['attempt_no'] = $attemptNo;
        }
        if (Schema::hasColumn('quiz_submissions', 'access_granted_at')) {
            $payload['access_granted_at'] = $now;
        }
        if (Schema::hasColumn('quiz_submissions', 'client_meta')) {
            $payload['client_meta'] = $this->encodeJsonOrNull($clientMeta);
        }

        try {
            DB::table('quiz_submissions')->insert($payload);
        } catch (\Throwable $e) {
            $existing = DB::table('quiz_submissions')
                ->where('tenant_id', $tenantId)
                ->where('quiz_id', $quiz->id)
                ->where('siswa_id', $siswaId)
                ->first();
            if ($existing) {
                return [
                    'submission' => $existing,
                    'response' => null,
                ];
            }

            throw $e;
        }

        return [
            'submission' => DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->first(),
            'response' => null,
        ];
    }

    private function nextAttemptNumber(string $tenantId, string $quizId, string $siswaId): int
    {
        if (! Schema::hasTable('quiz_retake_logs')) {
            return 1;
        }

        return ((int) DB::table('quiz_retake_logs')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->count()) + 1;
    }

    private function normalizePositiveInt($value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_numeric($value)) {
            return null;
        }

        $intValue = (int) $value;

        return $intValue > 0 ? $intValue : null;
    }

    private function studentQuizDetail(string $tenantId, object $quiz, object $submission, Carbon $now): array
    {
        $questions = DB::table('quiz_questions')
            ->where('quiz_id', $quiz->id)
            ->where('tenant_id', $tenantId)
            ->orderBy('nomor')
            ->orderBy('id')
            ->get();

        $questionIds = $questions->pluck('id')->map(fn ($id) => (string) $id)->all();
        $optionsByQuestion = [];
        if (! empty($questionIds)) {
            $options = DB::table('quiz_options')
                ->whereIn('question_id', $questionIds)
                ->where('tenant_id', $tenantId)
                ->orderBy('question_id')
                ->orderBy('label')
                ->orderBy('id')
                ->get();

            foreach ($options as $option) {
                $qid = (string) $option->question_id;
                $optionsByQuestion[$qid] = $optionsByQuestion[$qid] ?? [];
                $optionsByQuestion[$qid][] = $option;
            }
        }

        $order = $this->decodeAnswerOrder($submission->answer_order ?? null);
        if (! $order) {
            $order = $this->buildAnswerOrder($quiz, (string) $submission->id, $questions, $optionsByQuestion);
            if (Schema::hasColumn('quiz_submissions', 'answer_order')) {
                DB::table('quiz_submissions')
                    ->where('id', $submission->id)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'answer_order' => $this->encodeJsonOrNull($order),
                        'updated_at' => $now,
                    ]);
                $submission->answer_order = $this->encodeJsonOrNull($order);
            }
        }

        return $this->studentQuizPayload($questions, $optionsByQuestion, $order);
    }

    private function decodeAnswerOrder($value): ?array
    {
        if (! $value) {
            return null;
        }
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            if (! is_array($decoded)) {
                return null;
            }
            $value = $decoded;
        } elseif ($value instanceof \stdClass) {
            $value = json_decode(json_encode($value), true);
        }
        if (! is_array($value)) {
            return null;
        }

        $questions = array_values(array_filter(array_map('strval', $value['questions'] ?? [])));
        $options = [];
        foreach (($value['options'] ?? []) as $questionId => $optionIds) {
            if (! is_array($optionIds)) {
                continue;
            }
            $options[(string) $questionId] = array_values(array_filter(array_map('strval', $optionIds)));
        }

        return [
            'questions' => $questions,
            'options' => $options,
        ];
    }

    private function buildAnswerOrder(object $quiz, string $submissionId, $questions, array $optionsByQuestion): array
    {
        $questionIds = $questions->pluck('id')->map(fn ($id) => (string) $id)->all();
        if ($this->boolValue($quiz->shuffle_questions ?? false)) {
            usort($questionIds, fn ($a, $b) => strcmp(
                $this->stableOrderKey($submissionId, 'question', $a),
                $this->stableOrderKey($submissionId, 'question', $b)
            ));
        }

        $options = [];
        foreach ($optionsByQuestion as $questionId => $rows) {
            $optionIds = array_map(fn ($row) => (string) $row->id, $rows);
            if ($this->boolValue($quiz->shuffle_options ?? false)) {
                usort($optionIds, fn ($a, $b) => strcmp(
                    $this->stableOrderKey($submissionId, 'option', $a),
                    $this->stableOrderKey($submissionId, 'option', $b)
                ));
            }
            $options[(string) $questionId] = $optionIds;
        }

        return [
            'questions' => $questionIds,
            'options' => $options,
        ];
    }

    private function stableOrderKey(string $submissionId, string $scope, string $value): string
    {
        return hash_hmac(
            'sha256',
            $scope.'|'.$submissionId.'|'.$value,
            (string) config('app.key', 'edusmart-quiz')
        );
    }

    private function studentQuizPayload($questions, array $optionsByQuestion, array $order): array
    {
        $questionMap = [];
        foreach ($questions as $question) {
            $questionMap[(string) $question->id] = $question;
        }

        $seenQuestions = [];
        $orderedQuestions = [];
        foreach (($order['questions'] ?? []) as $questionId) {
            if (! isset($questionMap[$questionId])) {
                continue;
            }
            $seenQuestions[$questionId] = true;
            $orderedQuestions[] = $this->questionPayload($questionMap[$questionId]);
        }
        foreach ($questions as $question) {
            $questionId = (string) $question->id;
            if (isset($seenQuestions[$questionId])) {
                continue;
            }
            $orderedQuestions[] = $this->questionPayload($question);
        }

        $optionPayload = [];
        foreach ($optionsByQuestion as $questionId => $rows) {
            $optionMap = [];
            foreach ($rows as $row) {
                $optionMap[(string) $row->id] = $row;
            }

            $seenOptions = [];
            $orderedOptions = [];
            foreach (($order['options'][$questionId] ?? []) as $optionId) {
                if (! isset($optionMap[$optionId])) {
                    continue;
                }
                $seenOptions[$optionId] = true;
                $orderedOptions[] = $optionMap[$optionId];
            }
            foreach ($rows as $row) {
                $optionId = (string) $row->id;
                if (isset($seenOptions[$optionId])) {
                    continue;
                }
                $orderedOptions[] = $row;
            }

            $optionPayload[$questionId] = [];
            foreach ($orderedOptions as $index => $option) {
                $payload = (array) $option;
                unset($payload['is_correct'], $payload['tenant_id']);
                $payload['label'] = $this->displayOptionLabel($index);
                $optionPayload[$questionId][] = $payload;
            }
        }

        return [
            'questions' => $orderedQuestions,
            'options_by_question' => $optionPayload,
            'order' => $order,
        ];
    }

    private function questionPayload(object $question): array
    {
        $payload = (array) $question;
        unset($payload['tenant_id']);

        return $payload;
    }

    private function displayOptionLabel(int $index): string
    {
        if ($index >= 0 && $index < 26) {
            return chr(65 + $index);
        }

        return (string) ($index + 1);
    }

    private function submissionPayload(object $submission): array
    {
        $payload = (array) $submission;
        if (isset($payload['answer_order'])) {
            $decoded = $this->decodeAnswerOrder($payload['answer_order']);
            $payload['answer_order'] = $decoded ?: null;
        }
        if (isset($payload['client_meta']) && is_string($payload['client_meta'])) {
            $decoded = json_decode($payload['client_meta'], true);
            $payload['client_meta'] = is_array($decoded) ? $decoded : null;
        }

        return $payload;
    }

    private function storeSubmissionAnswer(
        string $tenantId,
        string $quizId,
        string $submissionId,
        string $questionId,
        $optionIdRaw,
        $essayAnswerRaw,
        Carbon $now,
        $providedAnswerId = null
    ): array {
        $question = DB::table('quiz_questions')
            ->where('id', $questionId)
            ->where('quiz_id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $question) {
            return [
                'ok' => false,
                'message' => 'Soal tidak valid untuk quiz ini',
                'code' => 422,
            ];
        }

        $optionId = null;
        $essayAnswer = null;
        $questionType = $this->normalizeQuestionType($question->question_type ?? null);

        if ($questionType === 'essay') {
            if (is_array($optionIdRaw) || is_object($optionIdRaw)) {
                return [
                    'ok' => false,
                    'message' => 'Jawaban esai tidak boleh memakai opsi pilihan',
                    'code' => 422,
                ];
            }
            if ($optionIdRaw !== null && trim((string) $optionIdRaw) !== '') {
                return [
                    'ok' => false,
                    'message' => 'Jawaban esai tidak boleh memakai opsi pilihan',
                    'code' => 422,
                ];
            }
            if (is_array($essayAnswerRaw) || is_object($essayAnswerRaw)) {
                return [
                    'ok' => false,
                    'message' => 'Jawaban esai tidak valid',
                    'code' => 422,
                ];
            }
            $essayText = trim((string) ($essayAnswerRaw ?? ''));
            $essayAnswer = $essayText === '' ? null : $essayText;
        } else {
            if (is_array($essayAnswerRaw) || is_object($essayAnswerRaw)) {
                return [
                    'ok' => false,
                    'message' => 'Jawaban pilihan ganda tidak menerima jawaban esai',
                    'code' => 422,
                ];
            }
            if ($essayAnswerRaw !== null && trim((string) $essayAnswerRaw) !== '') {
                return [
                    'ok' => false,
                    'message' => 'Jawaban pilihan ganda tidak menerima jawaban esai',
                    'code' => 422,
                ];
            }
            if (is_array($optionIdRaw) || is_object($optionIdRaw)) {
                return [
                    'ok' => false,
                    'message' => 'Pilihan jawaban tidak valid',
                    'code' => 422,
                ];
            }

            $candidateOptionId = trim((string) ($optionIdRaw ?? ''));
            if ($candidateOptionId !== '') {
                $optionExists = DB::table('quiz_options')
                    ->where('id', $candidateOptionId)
                    ->where('question_id', $questionId)
                    ->where('tenant_id', $tenantId)
                    ->exists();
                if (! $optionExists) {
                    return [
                        'ok' => false,
                        'message' => 'Pilihan jawaban tidak valid',
                        'code' => 422,
                    ];
                }
                $optionId = $candidateOptionId;
            }
        }

        $existing = DB::table('quiz_answers')
            ->where('tenant_id', $tenantId)
            ->where('submission_id', $submissionId)
            ->where('question_id', $questionId)
            ->first(['id']);

        $payload = [
            'option_id' => $optionId,
            'tenant_id' => $tenantId,
            'updated_at' => $now,
        ];
        if (Schema::hasColumn('quiz_answers', 'essay_answer')) {
            $payload['essay_answer'] = $essayAnswer;
        }
        if (Schema::hasColumn('quiz_answers', 'saved_at')) {
            $payload['saved_at'] = $now;
        }

        if ($existing) {
            DB::table('quiz_answers')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->update($payload);

            return [
                'ok' => true,
                'answer_id' => (string) $existing->id,
            ];
        }

        $answerId = trim((string) ($providedAnswerId ?? ''));
        if ($answerId === '' || DB::table('quiz_answers')->where('id', $answerId)->where('tenant_id', $tenantId)->exists()) {
            $answerId = (string) Str::uuid();
        }

        DB::table('quiz_answers')->insert(array_merge($payload, [
            'id' => $answerId,
            'submission_id' => $submissionId,
            'question_id' => $questionId,
            'created_at' => $now,
        ]));

        return [
            'ok' => true,
            'answer_id' => $answerId,
        ];
    }

    private function boolValue($value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value)) {
            return $value === 1;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }

    private function encodeJsonOrNull($value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return $json === false ? null : $json;
    }

    private function resolveQuizForTeacherAction(Request $request, string $tenantId, string $quizId): ?object
    {
        $query = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId);

        if ($this->isGuru($request) && ! $this->isAdmin($request)) {
            $query->where('guru_id', $request->user()?->id);
        }

        return $query->first();
    }

    private function resolveQuizForRetake(Request $request, string $tenantId, string $quizId): ?object
    {
        $query = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId);

        if ($this->isGuru($request) && ! $this->isAdmin($request)) {
            $query->where('guru_id', $request->user()?->id);
        }

        return $query->first(['id', 'guru_id', 'kelas_id', 'nama']);
    }

    private function normalizeQuestionType($value): string
    {
        $type = strtolower(trim((string) ($value ?? 'mcq')));
        if (! in_array($type, ['mcq', 'essay'], true)) {
            return 'mcq';
        }

        return $type;
    }
}
