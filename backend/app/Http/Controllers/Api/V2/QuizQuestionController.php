<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class QuizQuestionController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if (!in_array($role, ['admin', 'guru'])) {
            abort(403, 'Unauthorized');
        }

        $tenantId = $request->attributes->get('tenant_id');

        $request->validate([
            'quiz_id' => 'required|string',
            'soal' => 'required|string',
            'nomor' => 'required|integer',
            'poin' => 'required|integer',
            'options' => 'required|array',
            'options.*.label' => 'required|string',
            'options.*.text' => 'required|string',
            'options.*.is_correct' => 'required|boolean',
        ]);

        $quizId = $request->input('quiz_id');

        $quiz = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quizId)->first();
        if (!$quiz || ($role === 'guru' && $quiz->created_by !== $request->user()->id)) {
            abort(403, 'Unauthorized or Quiz not found');
        }

        return DB::transaction(function () use ($request, $quizId) {
            $questionId = (string) Str::uuid();

            DB::table('quiz_questions')->insert([
                'id' => $questionId,
                'quiz_id' => $quizId,
                'nomor' => $request->input('nomor'),
                'soal' => $request->input('soal'),
                'poin' => $request->input('poin'),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $options = $request->input('options');
            $optionsData = [];
            foreach ($options as $opt) {
                $optionsData[] = [
                    'id' => (string) Str::uuid(),
                    'question_id' => $questionId,
                    'label' => $opt['label'],
                    'text' => $opt['text'],
                    'is_correct' => $opt['is_correct'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            DB::table('quiz_options')->insert($optionsData);

            $question = DB::table('quiz_questions')->where('id', $questionId)->first();
            $question->options = DB::table('quiz_options')->where('question_id', $questionId)->get();

            return response()->json([
                'success' => true,
                'message' => 'Soal berhasil ditambahkan.',
                'data' => $question,
            ], 201);
        });
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if (!in_array($role, ['admin', 'guru'])) {
            abort(403, 'Unauthorized');
        }

        $tenantId = $request->attributes->get('tenant_id');

        $question = DB::table('quiz_questions')->where('id', $id)->first();
        if (!$question) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        $quiz = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $question->quiz_id)->first();
        if (!$quiz || ($role === 'guru' && $quiz->created_by !== $request->user()->id)) {
            abort(403, 'Unauthorized');
        }

        $request->validate([
            'soal' => 'required|string',
            'nomor' => 'required|integer',
            'poin' => 'required|integer',
            'options' => 'required|array',
        ]);

        return DB::transaction(function () use ($request, $id, $question) {
            DB::table('quiz_questions')->where('id', $id)->update([
                'nomor' => $request->input('nomor'),
                'soal' => $request->input('soal'),
                'poin' => $request->input('poin'),
                'updated_at' => now(),
            ]);

            // Simple update strategy: delete old options and insert new ones
            DB::table('quiz_options')->where('question_id', $id)->delete();

            $options = $request->input('options');
            $optionsData = [];
            foreach ($options as $opt) {
                $optionsData[] = [
                    'id' => (string) Str::uuid(),
                    'question_id' => $id,
                    'label' => $opt['label'],
                    'text' => $opt['text'],
                    'is_correct' => $opt['is_correct'],
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            DB::table('quiz_options')->insert($optionsData);

            $updatedQuestion = DB::table('quiz_questions')->where('id', $id)->first();
            $updatedQuestion->options = DB::table('quiz_options')->where('question_id', $id)->get();

            return response()->json([
                'success' => true,
                'message' => 'Soal berhasil diperbarui.',
                'data' => $updatedQuestion,
            ]);
        });
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $role = $request->user()?->profile?->role;
        if (!in_array($role, ['admin', 'guru'])) {
            abort(403, 'Unauthorized');
        }

        $tenantId = $request->attributes->get('tenant_id');

        $question = DB::table('quiz_questions')->where('id', $id)->first();
        if (!$question) {
            return response()->json(['success' => false, 'message' => 'Not found'], 404);
        }

        $quiz = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $question->quiz_id)->first();
        if (!$quiz || ($role === 'guru' && $quiz->created_by !== $request->user()->id)) {
            abort(403, 'Unauthorized');
        }

        DB::table('quiz_questions')->where('id', $id)->delete(); // Options cascade delete

        return response()->json([
            'success' => true,
            'message' => 'Soal berhasil dihapus.',
        ]);
    }
}
