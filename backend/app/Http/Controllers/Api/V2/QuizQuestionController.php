<?php

namespace App\Http\Controllers\Api\V2;

use App\Http\Controllers\Api\ApiController;
use App\Services\Academic\AcademicContextResolver;
use App\Services\IdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class QuizQuestionController extends ApiController
{
    public function index(Request $request, string $quiz): JsonResponse
    {
        $quizRow = $this->ownedQuiz($request, $quiz);
        if ($quizRow instanceof JsonResponse) {
            return $quizRow;
        }

        $questions = DB::table('quiz_questions')
            ->where('quiz_id', $quiz)
            ->orderBy('nomor')
            ->orderBy('id')
            ->get()
            ->map(function ($question) {
                $question->options = DB::table('quiz_options')
                    ->where('question_id', $question->id)
                    ->orderBy('label')
                    ->get();

                return $question;
            });

        return response()->json(['data' => $questions]);
    }

    public function store(Request $request): JsonResponse
    {
        $role = $this->role($request);
        if (! in_array($role, ['admin', 'guru'], true)) {
            return $this->deny('Quiz hanya dapat dikelola guru atau admin.', 403);
        }

        $validated = $request->validate([
            'quiz_id' => ['required', 'string', 'max:120'],
            'soal' => ['required', 'string', 'max:10000'],
            'nomor' => ['required', 'integer', 'min:1', 'max:1000'],
            'poin' => ['required', 'integer', 'min:0', 'max:1000'],
            'question_type' => ['nullable', 'string', 'in:mcq,essay'],
            'image_path' => ['nullable', 'string', 'max:1000'],
            'options' => ['nullable', 'array', 'max:20'],
            'options.*.label' => ['required_with:options', 'string', 'max:10'],
            'options.*.text' => ['required_with:options', 'string', 'max:5000'],
            'options.*.image_path' => ['nullable', 'string', 'max:1000'],
            'options.*.is_correct' => ['required_with:options', 'boolean'],
        ]);

        $quiz = $this->ownedQuiz($request, $validated['quiz_id']);
        if ($quiz instanceof JsonResponse) {
            return $quiz;
        }
        $periodGuard = $this->quizMutationContext($request, $quiz);
        if ($periodGuard instanceof JsonResponse) {
            return $periodGuard;
        }

        return app(IdempotencyService::class)->handle(
            $request,
            $request->header('Idempotency-Key'),
            fn () => $this->writeQuestion($validated)
        );
    }

    public function update(Request $request, string $question): JsonResponse
    {
        $validated = $request->validate([
            'soal' => ['sometimes', 'string', 'max:10000'],
            'nomor' => ['sometimes', 'integer', 'min:1', 'max:1000'],
            'poin' => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'question_type' => ['sometimes', 'nullable', 'string', 'in:mcq,essay'],
            'image_path' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'options' => ['sometimes', 'nullable', 'array', 'max:20'],
            'options.*.label' => ['required_with:options', 'string', 'max:10'],
            'options.*.text' => ['required_with:options', 'string', 'max:5000'],
            'options.*.image_path' => ['nullable', 'string', 'max:1000'],
            'options.*.is_correct' => ['required_with:options', 'boolean'],
        ]);

        $questionRow = DB::table('quiz_questions')->where('id', $question)->first();
        if (! $questionRow) {
            return response()->json(['message' => 'Soal tidak ditemukan'], 404);
        }
        $quiz = $this->ownedQuiz($request, $questionRow->quiz_id);
        if ($quiz instanceof JsonResponse) {
            return $quiz;
        }
        $periodGuard = $this->quizMutationContext($request, $quiz);
        if ($periodGuard instanceof JsonResponse) {
            return $periodGuard;
        }
        if (DB::table('quiz_submissions')
            ->where('quiz_id', $questionRow->quiz_id)
            ->where('status', 'ongoing')
            ->exists()) {
            return response()->json([
                'message' => 'Soal quiz tidak bisa diubah saat masih ada siswa yang mengerjakan quiz.',
            ], 409);
        }
        if ($validated === []) {
            return response()->json(['message' => 'Tidak ada perubahan soal'], 422);
        }

        return app(IdempotencyService::class)->handle(
            $request,
            $request->header('Idempotency-Key'),
            function () use ($question, $validated) {
                return DB::transaction(function () use ($question, $validated) {
                    $updates = [];
                    foreach (['soal', 'nomor', 'poin', 'question_type', 'image_path'] as $column) {
                        if (array_key_exists($column, $validated) && Schema::hasColumn('quiz_questions', $column)) {
                            $updates[$column] = $validated[$column];
                        }
                    }
                    if ($updates !== []) {
                        $updates['updated_at'] = now();
                        DB::table('quiz_questions')->where('id', $question)->update($updates);
                    }
                    if (array_key_exists('options', $validated)) {
                        $this->replaceOptions($question, $validated['options'] ?? []);
                    }

                    return response()->json([
                        'data' => $this->questionPayload($question),
                    ]);
                });
            }
        );
    }

    public function destroy(Request $request, string $question): JsonResponse
    {
        $questionRow = DB::table('quiz_questions')->where('id', $question)->first();
        if (! $questionRow) {
            return response()->json(['message' => 'Soal tidak ditemukan'], 404);
        }
        $quiz = $this->ownedQuiz($request, $questionRow->quiz_id);
        if ($quiz instanceof JsonResponse) {
            return $quiz;
        }
        $periodGuard = $this->quizMutationContext($request, $quiz);
        if ($periodGuard instanceof JsonResponse) {
            return $periodGuard;
        }

        return app(IdempotencyService::class)->handle(
            $request,
            $request->header('Idempotency-Key'),
            function () use ($question) {
                DB::table('quiz_questions')->where('id', $question)->delete();

                return response()->json(['data' => ['id' => $question, 'deleted' => true]]);
            }
        );
    }

    private function writeQuestion(array $validated): JsonResponse
    {
        return DB::transaction(function () use ($validated) {
            $questionId = (string) Str::uuid();
            $payload = [
                'id' => $questionId,
                'quiz_id' => $validated['quiz_id'],
                'nomor' => $validated['nomor'],
                'soal' => $validated['soal'],
                'poin' => $validated['poin'],
                'created_at' => now(),
                'updated_at' => now(),
            ];
            foreach (['question_type', 'image_path'] as $column) {
                if (Schema::hasColumn('quiz_questions', $column) && array_key_exists($column, $validated)) {
                    $payload[$column] = $validated[$column];
                }
            }
            DB::table('quiz_questions')->insert($payload);
            $this->replaceOptions($questionId, $validated['options'] ?? []);

            return response()->json(['data' => $this->questionPayload($questionId)], 201);
        });
    }

    private function replaceOptions(string $questionId, array $options): void
    {
        DB::table('quiz_options')->where('question_id', $questionId)->delete();
        if ($options === []) {
            return;
        }

        $rows = [];
        foreach ($options as $option) {
            $row = [
                'id' => (string) Str::uuid(),
                'question_id' => $questionId,
                'label' => $option['label'],
                'text' => $option['text'],
                'is_correct' => (bool) $option['is_correct'],
                'created_at' => now(),
                'updated_at' => now(),
            ];
            if (Schema::hasColumn('quiz_options', 'image_path') && array_key_exists('image_path', $option)) {
                $row['image_path'] = $option['image_path'];
            }
            $rows[] = $row;
        }
        DB::table('quiz_options')->insert($rows);
    }

    private function questionPayload(string $questionId): object
    {
        $question = DB::table('quiz_questions')->where('id', $questionId)->first();
        $question->options = DB::table('quiz_options')->where('question_id', $questionId)->orderBy('label')->get();

        return $question;
    }

    private function ownedQuiz(Request $request, string $quizId): object
    {
        $tenantId = (string) $request->attributes->get('tenant_id');
        $quiz = DB::table('quizzes')->where('tenant_id', $tenantId)->where('id', $quizId)->first();
        if (! $quiz) {
            return response()->json(['message' => 'Quiz tidak ditemukan'], 404);
        }

        $role = $this->role($request);
        if (! in_array($role, ['admin', 'guru'], true)) {
            return $this->deny('Quiz hanya dapat dikelola guru atau admin.', 403);
        }
        if ($role === 'guru' && (string) $quiz->guru_id !== (string) $request->user()?->id) {
            return $this->deny('Quiz tidak diizinkan.', 403);
        }

        return $quiz;
    }

    protected function role(Request $request): ?string
    {
        return strtolower((string) ($request->user()?->profile?->role ?? ''));
    }

    private function quizMutationContext(Request $request, object $quiz): array|JsonResponse
    {
        $tenantId = (string) $request->attributes->get('tenant_id');
        try {
            $context = app(AcademicContextResolver::class)->forMutation($request, $tenantId, 'quizzes');
        } catch (\DomainException $exception) {
            return response()->json([
                'message' => $exception->getMessage(),
                'code' => 'PERIOD_LOCKED',
            ], 409);
        }

        foreach (['tahun_ajaran', 'semester', 'academic_year_id', 'academic_term_id'] as $column) {
            if (! Schema::hasColumn('quizzes', $column)) {
                continue;
            }
            $stored = trim((string) ($quiz->{$column} ?? ''));
            $requested = trim((string) ($context[$column] ?? ''));
            if ($stored !== '' && $requested !== '' && $stored !== $requested) {
                return response()->json([
                    'message' => 'Quiz berada pada periode akademik lain.',
                    'code' => 'PERIOD_LOCKED',
                ], 409);
            }
        }

        return $context;
    }
}
