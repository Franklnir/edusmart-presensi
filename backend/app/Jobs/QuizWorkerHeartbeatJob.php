<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;

class QuizWorkerHeartbeatJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 15;

    public function __construct()
    {
        $this->onQueue((string) config('quiz.scoring_queue', 'quiz-scoring'));
    }

    public function handle(): void
    {
        Cache::put(
            (string) config('quiz.worker_heartbeat_cache_key', 'quiz-worker:last-heartbeat'),
            now()->toISOString(),
            now()->addMinutes(10)
        );
    }
}
