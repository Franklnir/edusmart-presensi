<?php

namespace App\Services\Quiz;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

class QuizContentCache
{
    public function bundle(string $tenantId, string $quizId): array
    {
        if (! config('quiz.content_cache_enabled', true)) {
            return $this->loadBundle($tenantId, $quizId);
        }

        try {
            $key = $this->key($tenantId, $quizId);
            $cached = Cache::get($key);
            if (is_array($cached)) {
                return $cached;
            }

            // Satu request mengisi cache, request lain menunggu sebentar agar ratusan
            // siswa tidak menembakkan query soal yang sama secara bersamaan.
            return Cache::lock($key.':lock', 10)->block(3, function () use ($key, $tenantId, $quizId): array {
                $cached = Cache::get($key);
                if (is_array($cached)) {
                    return $cached;
                }

                $bundle = $this->loadBundle($tenantId, $quizId);
                Cache::put(
                    $key,
                    $bundle,
                    now()->addSeconds((int) config('quiz.content_cache_ttl_seconds', 300))
                );

                return $bundle;
            });
        } catch (Throwable) {
            return $this->loadBundle($tenantId, $quizId);
        }
    }

    public function questions(string $tenantId, string $quizId): Collection
    {
        return collect($this->bundle($tenantId, $quizId)['questions'] ?? [])
            ->map(fn (array $row) => (object) $row);
    }

    public function options(string $tenantId, string $quizId): Collection
    {
        return collect($this->bundle($tenantId, $quizId)['options'] ?? [])
            ->map(fn (array $row) => (object) $row);
    }

    public function forget(string $tenantId, string $quizId): void
    {
        if ($tenantId === '' || $quizId === '') {
            return;
        }

        try {
            Cache::forget($this->key($tenantId, $quizId));
        } catch (Throwable) {
            // Cache failure must never block teachers from editing quiz content.
        }
    }

    public function forgetMany(string $tenantId, array $quizIds): void
    {
        foreach (array_values(array_unique(array_filter(array_map('strval', $quizIds)))) as $quizId) {
            $this->forget($tenantId, $quizId);
        }
    }

    private function loadBundle(string $tenantId, string $quizId): array
    {
        $questions = DB::table('quiz_questions')
            ->where('tenant_id', $tenantId)
            ->where('quiz_id', $quizId)
            ->orderBy('nomor')
            ->orderBy('id')
            ->get();

        $questionIds = $questions->pluck('id')->all();
        $options = empty($questionIds)
            ? collect()
            : DB::table('quiz_options')
                ->where('tenant_id', $tenantId)
                ->whereIn('question_id', $questionIds)
                ->orderBy('question_id')
                ->orderBy('label')
                ->orderBy('id')
                ->get();

        return [
            'questions' => $questions->map(fn ($row) => (array) $row)->all(),
            'options' => $options->map(fn ($row) => (array) $row)->all(),
        ];
    }

    private function key(string $tenantId, string $quizId): string
    {
        return "quiz-content:v1:{$tenantId}:{$quizId}";
    }
}
