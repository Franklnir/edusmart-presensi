<?php

namespace App\Http\Controllers\Api;

use App\Services\Quiz\QuizScoringService;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class QuizController extends ApiController
{
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
        $profile = $this->profile($request);
        $kelas = $profile?->kelas;

        $quiz = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (! $quiz) {
            return response()->json(['error' => 'Quiz tidak ditemukan'], 404);
        }
        if ($quiz->kelas_id !== $kelas) {
            return $this->deny('Quiz bukan untuk kelas ini');
        }

        $now = now();
        $startsAt = $quiz->starts_at ? Carbon::parse($quiz->starts_at) : null;
        if (! $startsAt) {
            return response()->json(['error' => 'Quiz belum dijadwalkan oleh guru'], 403);
        }
        if ($now->lt($startsAt)) {
            return response()->json(['error' => 'Quiz belum dimulai'], 403);
        }

        if ($quiz->is_live) {
            if (! $quiz->duration_minutes) {
                return response()->json(['error' => 'Durasi quiz belum diatur guru'], 403);
            }
            $liveStart = Carbon::parse($quiz->live_started_at ?: $quiz->starts_at);
            if ($now->lt($liveStart)) {
                return response()->json(['error' => 'Quiz ulangan belum dimulai'], 403);
            }
            $endAt = $liveStart->copy()->addMinutes((int) $quiz->duration_minutes);
            if ($now->gt($endAt)) {
                return response()->json(['error' => 'Quiz ulangan sudah berakhir'], 403);
            }
        } else {
            $deadlineAt = $quiz->deadline_at ? Carbon::parse($quiz->deadline_at) : null;
            if (! $deadlineAt) {
                return response()->json(['error' => 'Deadline quiz belum diatur guru'], 403);
            }
            if ($now->gt($deadlineAt)) {
                return response()->json(['error' => 'Quiz sudah melewati batas waktu'], 403);
            }
        }

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
            $submissionId = (string) Str::uuid();
            DB::table('quiz_submissions')->insert([
                'id' => $submissionId,
                'quiz_id' => $quizId,
                'siswa_id' => $user->id,
                'tenant_id' => $tenantId,
                'started_at' => $now,
                'status' => 'ongoing',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        } elseif ($submission->status === 'finished') {
            $result = $this->scoringService->finalizeSubmission($tenantId, (string) $submission->id, $now, 'finished');

            return response()->json([
                'data' => [
                    'submission_id' => $result['submission_id'] ?? (string) $submission->id,
                    'score' => $result['score'] ?? ($submission->score !== null ? (int) $submission->score : null),
                    'total_points' => $result['total_points'] ?? ($submission->total_points !== null ? (int) $submission->total_points : null),
                ],
            ]);
        }

        $questions = DB::table('quiz_questions')
            ->where('quiz_id', $quizId)
            ->where('tenant_id', $tenantId)
            ->get();
        $questionIds = $questions->pluck('id')->map(fn ($id) => (string) $id)->all();
        $questionMap = [];
        foreach ($questions as $question) {
            $questionMap[(string) $question->id] = $question;
        }

        $optionsByQuestion = [];
        if (! empty($questionIds)) {
            $options = DB::table('quiz_options')
                ->whereIn('question_id', $questionIds)
                ->where('tenant_id', $tenantId)
                ->get(['id', 'question_id']);
            foreach ($options as $opt) {
                $qid = (string) $opt->question_id;
                $optionsByQuestion[$qid] = $optionsByQuestion[$qid] ?? [];
                $optionsByQuestion[$qid][] = (string) $opt->id;
            }
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

                $question = $questionMap[$questionId] ?? null;
                if (! $question) {
                    return response()->json(['error' => 'Soal tidak valid untuk quiz ini'], 422);
                }

                $questionType = $this->normalizeQuestionType($question->question_type ?? null);
                $essayAnswer = null;

                if ($questionType === 'essay') {
                    if ($optionId !== '') {
                        return response()->json(['error' => 'Jawaban esai tidak boleh memakai opsi pilihan'], 422);
                    }
                    if (is_array($essayAnswerRaw) || is_object($essayAnswerRaw)) {
                        return response()->json(['error' => 'Jawaban esai tidak valid'], 422);
                    }
                    $essayAnswer = trim((string) ($essayAnswerRaw ?? ''));
                    if ($essayAnswer === '') {
                        $essayAnswer = null;
                    }
                    $optionId = null;
                } else {
                    if ($essayAnswerRaw !== null && trim((string) $essayAnswerRaw) !== '') {
                        return response()->json(['error' => 'Jawaban pilihan ganda tidak menerima jawaban esai'], 422);
                    }

                    if ($optionId !== '') {
                        $validOptionIds = $optionsByQuestion[$questionId] ?? [];
                        if (! in_array($optionId, $validOptionIds, true)) {
                            return response()->json(['error' => 'Pilihan jawaban tidak valid'], 422);
                        }
                    } else {
                        $optionId = null;
                    }
                }

                DB::table('quiz_answers')->updateOrInsert(
                    ['submission_id' => $submissionId, 'question_id' => $questionId],
                    [
                        'id' => $row['id'] ?? (string) Str::uuid(),
                        'option_id' => $optionId,
                        'essay_answer' => $essayAnswer,
                        'tenant_id' => $tenantId,
                        'updated_at' => $now,
                        'created_at' => $now,
                    ]
                );
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
            $request
        ) {
            $payload = [
                'score' => $score,
                'total_points' => $totalPoints,
                'status' => 'finished',
                'finished_at' => $latestLog->previous_finished_at ?: $now,
                'updated_at' => $now,
            ];

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
