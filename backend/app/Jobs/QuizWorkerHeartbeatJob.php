<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Throwable;

class QuizWorkerHeartbeatJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 15;

    public function __construct()
    {
        $this->onQueue((string) config('quiz.scoring_queue', 'quiz-scoring'));
    }

    public function tags(): array
    {
        return ['heartbeat', 'quiz-worker'];
    }

    public function backoff(): array
    {
        return [5, 15];
    }

    public function handle(): void
    {
        try {
            Cache::put(
                (string) config('quiz.worker_heartbeat_cache_key', 'quiz-worker:last-heartbeat'),
                now()->toISOString(),
                now()->addMinutes(10)
            );
        } catch (Throwable) {
            // Stale heartbeat monitoring already reports this condition; keep diagnostic jobs out of failed_jobs noise.
        }
    }
}
