<?php

namespace App\Services\Quiz;

use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class QuizScoringService
{
    public function finalizeSubmission(
        string $tenantId,
        string $submissionId,
        ?Carbon $finishedAt = null,
        string $status = 'finished'
    ): ?array {
        $finishedAt = $finishedAt ?: now();

        return DB::transaction(function () use ($tenantId, $submissionId, $finishedAt, $status) {
            $submission = DB::table('quiz_submissions')
                ->where('id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$submission) {
                return null;
            }

            // Idempotent finalize: return current result when already finalized.
            if ($submission->status === 'finished' && $submission->score !== null && $submission->total_points !== null) {
                return [
                    'submission_id' => $submissionId,
                    'score' => (int) $submission->score,
                    'total_points' => (int) $submission->total_points,
                ];
            }

            $questions = DB::table('quiz_questions')
                ->where('quiz_id', $submission->quiz_id)
                ->where('tenant_id', $tenantId)
                ->get();

            $quiz = DB::table('quizzes')
                ->where('id', $submission->quiz_id)
                ->where('tenant_id', $tenantId)
                ->first(['penilaian']);
            $penilaian = strtolower(trim((string) ($quiz->penilaian ?? 'poin')));
            if (!in_array($penilaian, ['poin', 'skala_100'], true)) {
                $penilaian = 'poin';
            }

            $questionIds = $questions->pluck('id')->all();
            $answers = DB::table('quiz_answers')
                ->where('submission_id', $submissionId)
                ->where('tenant_id', $tenantId)
                ->get()
                ->keyBy('question_id');

            $optionsByQuestion = collect();
            if (!empty($questionIds)) {
                $optionsByQuestion = DB::table('quiz_options')
                    ->whereIn('question_id', $questionIds)
                    ->where('tenant_id', $tenantId)
                    ->get()
                    ->groupBy('question_id');
            }

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

        if (!empty($expiredLiveQuizIds)) {
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

        $rows = $submissionQuery->get();
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

            if (!$expired) {
                continue;
            }

            $result = $this->finalizeSubmission((string) $row->tenant_id, (string) $row->submission_id, $now, 'finished');
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
        $correctPoints = 0;
        $totalQuestions = $questions->count();
        $correctQuestions = 0;

        foreach ($questions as $question) {
            $questionId = (string) $question->id;
            $point = max(0, (int) ($question->poin ?? 0));
            $totalPoints += $point;

            $answer = $answersByQuestionId->get($questionId);
            if (!$answer) {
                continue;
            }

            $options = $optionsByQuestionId->get($questionId, collect());
            $isCorrect = false;
            foreach ($options as $option) {
                if ((string) $option->id === (string) ($answer->option_id ?? '')) {
                    $isCorrect = (bool) $option->is_correct;
                    break;
                }
            }

            if ($isCorrect) {
                $correctPoints += $point;
                $correctQuestions++;
            }

            DB::table('quiz_answers')
                ->where('id', $answer->id)
                ->where('tenant_id', $tenantId)
                ->update([
                    'is_correct' => $isCorrect,
                    'poin' => $isCorrect
                        ? ($penilaian === 'skala_100' ? 1 : $point)
                        : 0,
                    'updated_at' => $now,
                ]);
        }

        $score = 0;
        $totalBasis = $totalPoints;

        if ($penilaian === 'skala_100') {
            $totalBasis = $totalQuestions;
            if ($totalQuestions > 0) {
                $score = (int) round(($correctQuestions / $totalQuestions) * 100);
            }
        } elseif ($totalPoints > 0) {
            $score = (int) round(($correctPoints / $totalPoints) * 100);
        }
        $score = max(0, min(100, $score));

        return [$score, $totalBasis];
    }
}
