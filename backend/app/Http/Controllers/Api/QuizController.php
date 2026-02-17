<?php

namespace App\Http\Controllers\Api;

use App\Services\Quiz\QuizScoringService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Support\Carbon;

class QuizController extends ApiController
{
    public function __construct(
        private readonly QuizScoringService $scoringService
    ) {}

    public function submit(Request $request)
    {
        if (!$this->isSiswa($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
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
        if (!$quiz) {
            return response()->json(['error' => 'Quiz tidak ditemukan'], 404);
        }
        if ($quiz->kelas_id !== $kelas) {
            return $this->deny('Quiz bukan untuk kelas ini');
        }

        $now = now();
        $startsAt = $quiz->starts_at ? Carbon::parse($quiz->starts_at) : null;
        if (!$startsAt) {
            return response()->json(['error' => 'Quiz belum dijadwalkan oleh guru'], 403);
        }
        if ($now->lt($startsAt)) {
            return response()->json(['error' => 'Quiz belum dimulai'], 403);
        }

        if ($quiz->is_live) {
            if (!$quiz->duration_minutes) {
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
            if (!$deadlineAt) {
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

        if (!$submission) {
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
                ]
            ]);
        }

        $questions = DB::table('quiz_questions')
            ->where('quiz_id', $quizId)
            ->where('tenant_id', $tenantId)
            ->get();
        $questionIds = $questions->pluck('id')->map(fn ($id) => (string) $id)->all();
        $questionIdMap = array_fill_keys($questionIds, true);

        $optionsByQuestion = [];
        if (!empty($questionIds)) {
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
                if (!is_array($row)) continue;
                $questionId = isset($row['question_id']) ? (string) $row['question_id'] : '';
                $optionId = isset($row['option_id']) ? (string) $row['option_id'] : '';
                if (!$questionId) continue;

                if (!isset($questionIdMap[$questionId])) {
                    return response()->json(['error' => 'Soal tidak valid untuk quiz ini'], 422);
                }

                if ($optionId !== '') {
                    $validOptionIds = $optionsByQuestion[$questionId] ?? [];
                    if (!in_array($optionId, $validOptionIds, true)) {
                        return response()->json(['error' => 'Pilihan jawaban tidak valid'], 422);
                    }
                } else {
                    $optionId = null;
                }

                DB::table('quiz_answers')->updateOrInsert(
                    ['submission_id' => $submissionId, 'question_id' => $questionId],
                    [
                        'id' => $row['id'] ?? (string) Str::uuid(),
                        'option_id' => $optionId,
                        'tenant_id' => $tenantId,
                        'updated_at' => $now,
                        'created_at' => $now,
                    ]
                );
            }
        }

        $result = $this->scoringService->finalizeSubmission($tenantId, $submissionId, $now, 'finished');
        if (!$result) {
            return response()->json(['error' => 'Gagal menyelesaikan quiz'], 500);
        }

        return response()->json([
            'data' => [
                'submission_id' => $result['submission_id'],
                'score' => $result['score'],
                'total_points' => $result['total_points'],
            ]
        ]);
    }

    public function retake(Request $request)
    {
        if (!$this->isGuru($request) && !$this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->input('quiz_id', ''));
        $siswaId = trim((string) $request->input('siswa_id', ''));
        $confirmed = (bool) $request->boolean('confirmed', false);

        if ($quizId === '' || $siswaId === '') {
            return response()->json(['error' => 'quiz_id dan siswa_id wajib diisi'], 422);
        }
        if (!$confirmed) {
            return response()->json(['error' => 'Konfirmasi ulang quiz wajib disetujui'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (!$quiz) {
            return $this->deny('Quiz tidak diizinkan');
        }

        $submission = DB::table('quiz_submissions')
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $siswaId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$submission) {
            return response()->json(['error' => 'Siswa belum memiliki attempt quiz'], 404);
        }

        $siswa = DB::table('profiles')
            ->where('id', $siswaId)
            ->where('tenant_id', $tenantId)
            ->first(['id', 'nama', 'role']);

        if (!$siswa || strtolower((string) ($siswa->role ?? '')) !== 'siswa') {
            return response()->json(['error' => 'Data siswa tidak valid'], 422);
        }

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

        return response()->json([
            'data' => [
                'retake_log_id' => $logId,
                'quiz_id' => $quizId,
                'siswa_id' => $siswaId,
                'siswa_nama' => $siswa->nama,
                'previous_score' => $submission->score !== null ? (int) $submission->score : null,
                'previous_total_points' => $submission->total_points !== null ? (int) $submission->total_points : null,
                'previous_status' => $submission->status,
            ]
        ]);
    }

    public function retakeHistory(Request $request)
    {
        if (!$this->isGuru($request) && !$this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (!$tenantId) {
            return response()->json(['error' => 'Tenant tidak valid'], 400);
        }

        $quizId = trim((string) $request->query('quiz_id', ''));
        if ($quizId === '') {
            return response()->json(['error' => 'quiz_id wajib diisi'], 422);
        }

        $quiz = $this->resolveQuizForRetake($request, $tenantId, $quizId);
        if (!$quiz) {
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

    private function resolveQuizForRetake(Request $request, string $tenantId, string $quizId): ?object
    {
        $query = DB::table('quizzes')
            ->where('id', $quizId)
            ->where('tenant_id', $tenantId);

        if ($this->isGuru($request) && !$this->isAdmin($request)) {
            $query->where('guru_id', $request->user()?->id);
        }

        return $query->first(['id', 'guru_id', 'kelas_id', 'nama']);
    }
}
