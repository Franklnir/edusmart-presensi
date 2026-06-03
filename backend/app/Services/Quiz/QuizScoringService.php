<?php

namespace App\Services\Quiz;

use App\Jobs\FinalizeQuizSubmissionJob;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class QuizScoringService
{
    public function __construct(
        private readonly QuizContentCache $contentCache
    ) {}

    public function finalizeSubmission(
        string $tenantId,
        string $submissionId,
        ?Carbon $finishedAt = null,
        string $status = 'finished',
        bool $forceRecalculate = false
    ): ?array {
        $finishedAt = $finishedAt ?: now();

        return DB::transaction(function () use ($tenantId, $submissionId, $finishedAt, $status, $forceRecalculate) {
            $submission = DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (! $submission) {
                return null;
            }

            // Idempotent finalize: return current result when already finalized.
            if (
                ! $forceRecalculate
                && $submission->status === 'finished'
                && $submission->score !== null
                && $submission->total_points !== null
            ) {
                return [
                    'submission_id' => $submissionId,
                    'score' => (int) $submission->score,
                    'total_points' => (int) $submission->total_points,
                ];
            }

            $questions = $this->contentCache->questions($tenantId, (string) $submission->quiz_id);

            $quiz = DB::table('quizzes')
                ->where('id', $submission->quiz_id)
                ->where('tenant_id', $tenantId)
                ->first(['penilaian']);
            $penilaian = strtolower(trim((string) ($quiz->penilaian ?? 'poin')));
            if (! in_array($penilaian, ['poin', 'skala_100'], true)) {
                $penilaian = 'poin';
            }

            $questionIds = $questions->pluck('id')->all();
            $answers = DB::table('quiz_answers')
                ->where('submission_id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->get()
                ->keyBy('question_id');

            $optionsByQuestion = empty($questionIds)
                ? collect()
                : $this->contentCache
                    ->options($tenantId, (string) $submission->quiz_id)
                    ->whereIn('question_id', $questionIds)
                    ->groupBy('question_id');

            [$score, $totalPoints] = $this->scoreSubmission(
                $questions,
                $answers,
                $optionsByQuestion,
                $tenantId,
                $finishedAt,
                $penilaian
            );

            DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'finished_at' => $finishedAt,
                    'status' => $status,
                    'score' => $score,
                    'total_points' => $totalPoints,
                    'updated_at' => $finishedAt,
                ]);

            return [
                'submission_id' => $submissionId,
                'score' => $score,
                'total_points' => $totalPoints,
            ];
        }, 3);
    }

    public function finalizeExpiredSubmissions(?string $tenantId = null): int
    {
        $now = now();
        $totalFinalized = 0;

        // Auto-close live quizzes that have exceeded their duration.
        $liveQuery = DB::table('quizzes')
            ->select('id', 'tenant_id', 'live_started_at', 'duration_minutes')
            ->where('is_live', true)
            ->where('is_active', true)
            ->whereNotNull('live_started_at')
            ->whereNotNull('duration_minutes');

        if ($tenantId) {
            $liveQuery->where('tenant_id', $tenantId);
        }

        $liveQuizzes = $liveQuery->get();
        $expiredLiveQuizIds = [];
        foreach ($liveQuizzes as $quiz) {
            $endAt = Carbon::parse($quiz->live_started_at)->addMinutes((int) $quiz->duration_minutes);
            if ($now->greaterThanOrEqualTo($endAt)) {
                $expiredLiveQuizIds[] = (string) $quiz->id;
            }
        }

        if (! empty($expiredLiveQuizIds)) {
            $closeQuery = DB::table('quizzes')
                ->whereIn('id', $expiredLiveQuizIds)
                ->where('is_active', true);
            if ($tenantId) {
                $closeQuery->where('tenant_id', $tenantId);
            }
            $closeQuery->update([
                'is_active' => false,
                'updated_at' => $now,
            ]);
        }

        // Finalize all ongoing submissions whose quiz window is closed.
        $submissionQuery = DB::table('quiz_submissions as s')
            ->join('quizzes as q', 'q.id', '=', 's.quiz_id')
            ->select(
                's.id as submission_id',
                's.tenant_id',
                'q.is_live',
                'q.deadline_at',
                'q.live_started_at',
                'q.duration_minutes'
            )
            ->where('s.status', 'ongoing');

        if ($tenantId) {
            $submissionQuery->where('s.tenant_id', $tenantId);
        }

        // Scheduler berjalan setiap menit. Batasi pekerjaan per tick agar satu gelombang
        // deadline besar tidak menahan worker terlalu lama; sisanya diproses tick berikutnya.
        $rows = $submissionQuery
            ->orderBy('s.updated_at')
            ->limit(100)
            ->get();
        foreach ($rows as $row) {
            $expired = false;

            if ($row->is_live) {
                if ($row->live_started_at && $row->duration_minutes) {
                    $endAt = Carbon::parse($row->live_started_at)->addMinutes((int) $row->duration_minutes);
                    $expired = $now->greaterThanOrEqualTo($endAt);
                }
            } else {
                if ($row->deadline_at) {
                    $expired = $now->greaterThanOrEqualTo(Carbon::parse($row->deadline_at));
                }
            }

            if (! $expired) {
                continue;
            }

            if (config('quiz.async_scoring_enabled', false)) {
                try {
                    DB::table('quiz_submissions')
                        ->where('tenant_id', (string) $row->tenant_id)
                        ->where('id', (string) $row->submission_id)
                        ->update([
                            'status' => 'finished',
                            'finished_at' => $now,
                            'updated_at' => $now,
                        ]);
                    FinalizeQuizSubmissionJob::dispatch(
                        (string) $row->tenant_id,
                        (string) $row->submission_id,
                        $now->toISOString(),
                        'finished'
                    );
                    $result = ['submission_id' => (string) $row->submission_id];
                } catch (\Throwable) {
                    $result = $this->finalizeSubmission((string) $row->tenant_id, (string) $row->submission_id, $now, 'finished');
                }
            } else {
                $result = $this->finalizeSubmission((string) $row->tenant_id, (string) $row->submission_id, $now, 'finished');
            }
            if ($result) {
                $totalFinalized++;
            }
        }

        return $totalFinalized;
    }

    private function scoreSubmission(
        Collection $questions,
        Collection $answersByQuestionId,
        Collection $optionsByQuestionId,
        string $tenantId,
        Carbon $now,
        string $penilaian
    ): array {
        $totalPoints = 0;
        $achievedPoints = 0.0;
        $totalScaledQuestions = 0;
        $achievedScaledQuestions = 0.0;
        $answerScoreUpdates = [];

        foreach ($questions as $question) {
            $questionId = (string) $question->id;
            $questionType = strtolower(trim((string) ($question->question_type ?? 'mcq')));
            if (! in_array($questionType, ['mcq', 'essay'], true)) {
                $questionType = 'mcq';
            }
            $point = max(0, (int) ($question->poin ?? 0));
            $answer = $answersByQuestionId->get($questionId);
            $answerPoint = 0;
            $answerIsCorrect = false;
            $includeInScore = true;

            if ($questionType === 'essay') {
                if ($answer && $answer->essay_score !== null) {
                    $essayScore = (int) $answer->essay_score;
                    $answerPoint = max(0, min($point, $essayScore));
                    $answerIsCorrect = $point > 0 && $answerPoint >= $point;
                } else {
                    // Mode poin: esai belum dinilai tetap masuk basis skor sebagai 0.
                    // Mode skala_100: esai belum dinilai dikeluarkan dari basis skor.
                    if ($penilaian !== 'poin') {
                        $includeInScore = false;
                    }
                }
            } else {
                $totalPoints += $point;
                if ($penilaian === 'skala_100') {
                    $totalScaledQuestions++;
                }

                if ($answer) {
                    $options = $optionsByQuestionId->get($questionId, collect());
                    foreach ($options as $option) {
                        if ((string) $option->id === (string) ($answer->option_id ?? '')) {
                            $answerIsCorrect = (bool) $option->is_correct;
                            break;
                        }
                    }
                    $answerPoint = $answerIsCorrect ? $point : 0;
                    if ($penilaian === 'skala_100' && $answerIsCorrect) {
                        $achievedScaledQuestions += 1;
                    }
                }
            }

            if ($questionType === 'essay' && $includeInScore) {
                $totalPoints += $point;
                if ($penilaian === 'skala_100') {
                    $totalScaledQuestions++;
                    if ($point > 0) {
                        $achievedScaledQuestions += min(1, max(0, $answerPoint / $point));
                    }
                }
            }

            if ($includeInScore) {
                $achievedPoints += $answerPoint;
            }

            if ($answer) {
                $answerScoreUpdates[] = array_merge((array) $answer, [
                    'is_correct' => $answerIsCorrect,
                    'poin' => $questionType === 'mcq' && $penilaian === 'skala_100'
                        ? ($answerIsCorrect ? 1 : 0)
                        : $answerPoint,
                    'updated_at' => $now,
                ]);
            }
        }

        if (! empty($answerScoreUpdates)) {
            DB::table('quiz_answers')->upsert(
                $answerScoreUpdates,
                ['id'],
                ['is_correct', 'poin', 'updated_at']
            );
        }

        $score = 0;
        $totalBasis = $totalPoints;

        if ($penilaian === 'skala_100') {
            $totalBasis = $totalScaledQuestions;
            if ($totalScaledQuestions > 0) {
                $score = (int) round(($achievedScaledQuestions / $totalScaledQuestions) * 100);
            }
        } elseif ($totalPoints > 0) {
            $score = (int) round(($achievedPoints / $totalPoints) * 100);
        }
        $score = max(0, min(100, $score));

        return [$score, $totalBasis];
    }
}
