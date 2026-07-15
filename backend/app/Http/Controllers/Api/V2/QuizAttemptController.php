<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Api\QuizController as LegacyQuizController;
use App\Services\IdempotencyService;
use Illuminate\Http\Request;

/**
 * V2 transport for the existing, tenant-aware Quiz attempt workflow.
 *
 * The legacy controller contains the scoring, deadline, device-session,
 * strict-violation, retake, and audit rules. Keeping this adapter thin avoids
 * maintaining a second implementation of those security-sensitive rules.
 */
class QuizAttemptController extends LegacyQuizController
{
    public function start(Request $request, string $quiz)
    {
        $request->request->set('quiz_id', $quiz);

        return $this->idempotent($request, fn () => parent::startAttempt($request));
    }

    public function answer(Request $request, string $quiz, string $attempt)
    {
        $request->request->add([
            'quiz_id' => $quiz,
            'submission_id' => $attempt,
        ]);

        return $this->idempotent($request, fn () => parent::saveAnswer($request));
    }

    public function batch(Request $request, string $quiz, string $attempt)
    {
        $request->request->add([
            'quiz_id' => $quiz,
            'submission_id' => $attempt,
        ]);

        return $this->idempotent($request, fn () => parent::saveAnswersBatch($request));
    }

    public function submit(Request $request)
    {
        $quiz = (string) $request->route('quiz');
        $attempt = (string) $request->route('attempt');
        $request->request->add([
            'quiz_id' => $quiz,
            'submission_id' => $attempt,
        ]);

        return $this->idempotent($request, fn () => parent::submit($request));
    }

    public function violation(Request $request, string $quiz, string $attempt)
    {
        $request->request->add([
            'quiz_id' => $quiz,
            'submission_id' => $attempt,
        ]);

        return $this->idempotent($request, fn () => parent::logViolation($request));
    }

    public function gradeEssay(Request $request)
    {
        $quiz = (string) $request->route('quiz');
        $attempt = (string) $request->route('attempt');
        $request->request->add([
            'quiz_id' => $quiz,
            'submission_id' => $attempt,
        ]);

        return $this->idempotent($request, fn () => parent::gradeEssay($request));
    }

    public function completeEssayReview(Request $request)
    {
        $quiz = (string) $request->route('quiz');
        $attempt = (string) $request->route('attempt');
        $request->request->add([
            'quiz_id' => $quiz,
            'submission_id' => $attempt,
        ]);

        return $this->idempotent($request, fn () => parent::completeEssayReview($request));
    }

    public function retake(Request $request)
    {
        $quiz = (string) $request->route('quiz');
        $request->request->set('quiz_id', $quiz);

        return $this->idempotent($request, fn () => parent::retake($request));
    }

    public function restoreRetakeScore(Request $request)
    {
        $quiz = (string) $request->route('quiz');
        $request->request->set('quiz_id', $quiz);

        return $this->idempotent($request, fn () => parent::restoreRetakeScore($request));
    }

    private function idempotent(Request $request, callable $callback)
    {
        return app(IdempotencyService::class)->handle(
            $request,
            $request->header('Idempotency-Key'),
            $callback
        );
    }
}
