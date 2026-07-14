<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class QuizSubmissionController extends Controller
{
    public function submitAnswer(Request $request, string $quizId): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if ($role !== 'siswa') {
            abort(403, 'Unauthorized');
        }

        $tenantId = $request->attributes->get('tenant_id');
        $userId = $request->user()->id;

        $request->validate([
            'submission_id' => 'required|string',
            'question_id' => 'required|string',
            'option_id' => 'nullable|string',
        ]);

        $submissionId = $request->input('submission_id');

        $submission = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $userId)
            ->first();

        if (!$submission || $submission->status !== 'ongoing') {
            return response()->json(['success' => false, 'message' => 'Invalid submission or quiz already finished.'], 403);
        }

        $questionId = $request->input('question_id');
        $optionId = $request->input('option_id');

        return DB::transaction(function () use ($submissionId, $questionId, $optionId) {
            $isCorrect = false;
            $poin = 0;

            if ($optionId) {
                $option = DB::table('quiz_options')->where('id', $optionId)->first();
                if ($option && $option->is_correct) {
                    $isCorrect = true;
                    $question = DB::table('quiz_questions')->where('id', $questionId)->first();
                    $poin = $question ? $question->poin : 0;
                }
            }

            // Upsert quiz answer
            $existingAnswer = DB::table('quiz_answers')
                ->where('submission_id', $submissionId)
                ->where('question_id', $questionId)
                ->first();

            if ($existingAnswer) {
                DB::table('quiz_answers')->where('id', $existingAnswer->id)->update([
                    'option_id' => $optionId,
                    'is_correct' => $isCorrect,
                    'poin' => $poin,
                    'updated_at' => now(),
                ]);
            } else {
                DB::table('quiz_answers')->insert([
                    'id' => (string) Str::uuid(),
                    'submission_id' => $submissionId,
                    'question_id' => $questionId,
                    'option_id' => $optionId,
                    'is_correct' => $isCorrect,
                    'poin' => $poin,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            return response()->json([
                'success' => true,
                'message' => 'Jawaban berhasil disimpan.',
            ]);
        });
    }

    public function finishQuiz(Request $request, string $quizId): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if ($role !== 'siswa') {
            abort(403, 'Unauthorized');
        }

        $userId = $request->user()->id;

        $request->validate([
            'submission_id' => 'required|string',
        ]);

        $submissionId = $request->input('submission_id');

        $submission = DB::table('quiz_submissions')
            ->where('id', $submissionId)
            ->where('quiz_id', $quizId)
            ->where('siswa_id', $userId)
            ->first();

        if (!$submission || $submission->status !== 'ongoing') {
            return response()->json(['success' => false, 'message' => 'Invalid submission or quiz already finished.'], 403);
        }

        return DB::transaction(function () use ($submissionId, $quizId) {
            $answers = DB::table('quiz_answers')->where('submission_id', $submissionId)->get();
            $score = 0;
            $totalPoin = 0;

            foreach ($answers as $ans) {
                if ($ans->is_correct) {
                    $score += $ans->poin;
                }
            }

            $totalPoinResult = DB::table('quiz_questions')->where('quiz_id', $quizId)->sum('poin');

            DB::table('quiz_submissions')->where('id', $submissionId)->update([
                'status' => 'finished',
                'finished_at' => now(),
                'score' => $score,
                'total_points' => $totalPoinResult,
                'updated_at' => now(),
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Quiz berhasil diselesaikan.',
                'score' => $score,
            ]);
        });
    }

    public function logViolation(Request $request, string $quizId): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if ($role !== 'siswa') {
            abort(403, 'Unauthorized');
        }

        $tenantId = $request->attributes->get('tenant_id');
        $userId = $request->user()->id;

        $request->validate([
            'submission_id' => 'required|string',
            'event_type' => 'required|string',
            'event_message' => 'nullable|string',
        ]);

        DB::table('quiz_violation_logs')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $tenantId,
            'quiz_id' => $quizId,
            'submission_id' => $request->input('submission_id'),
            'siswa_id' => $userId,
            'event_type' => $request->input('event_type'),
            'event_message' => $request->input('event_message'),
            'event_meta' => json_encode($request->input('event_meta', [])),
            'created_at' => now(),
        ]);

        return response()->json([
            'success' => true,
        ]);
    }
}
