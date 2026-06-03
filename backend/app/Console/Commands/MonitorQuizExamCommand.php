<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Schema;
use Throwable;

class MonitorQuizExamCommand extends Command
{
    protected $signature = 'quiz:monitor {--tenant= : Batasi ke tenant ID tertentu}';

    protected $description = 'Tampilkan kesehatan database, cache, queue worker, dan submission quiz saat ujian';

    public function handle(): int
    {
        try {
            $tenantId = trim((string) $this->option('tenant'));
            $submissionQuery = DB::table('quiz_submissions');
            if ($tenantId !== '') {
                $submissionQuery->where('tenant_id', $tenantId);
            }

            $statusCounts = (clone $submissionQuery)
                ->selectRaw('status, count(*) as total')
                ->groupBy('status')
                ->pluck('total', 'status')
                ->map(fn ($value) => (int) $value)
                ->all();
        } catch (Throwable $e) {
            $this->components->error('Database quiz tidak dapat diakses: '.$e->getMessage());

            return self::FAILURE;
        }

        $queueSize = $this->queueSize();
        $failedJobs = Schema::hasTable('failed_jobs') ? (int) DB::table('failed_jobs')->count() : 0;
        $warningSize = (int) config('quiz.monitor_warning_queue_size', 100);
        $criticalSize = (int) config('quiz.monitor_critical_queue_size', 500);
        $cacheHealthy = $this->cacheHealthy();
        $workerHeartbeat = $this->workerHeartbeat();
        $workerHealthy = ! config('quiz.async_scoring_enabled', false) || $workerHeartbeat['healthy'];

        $this->components->info('Quiz exam monitoring');
        $this->table(
            ['Komponen', 'Nilai', 'Status'],
            [
                ['Database', DB::connection()->getDatabaseName(), 'OK'],
                ['Cache store', (string) config('cache.default'), $cacheHealthy ? 'OK' : 'GAGAL'],
                ['Queue connection', (string) config('queue.default'), $queueSize < 0 ? 'GAGAL' : 'OK'],
                ['Queue backlog', (string) $queueSize, $queueSize < 0 ? 'GAGAL' : ($queueSize >= $criticalSize ? 'KRITIS' : ($queueSize >= $warningSize ? 'PERINGATAN' : 'OK'))],
                ['Scoring worker', $workerHeartbeat['label'], $workerHealthy ? 'OK' : 'GAGAL'],
                ['Failed jobs', (string) $failedJobs, $failedJobs > 0 ? 'PERIKSA' : 'OK'],
                ['Submission ongoing', (string) ($statusCounts['ongoing'] ?? 0), 'INFO'],
                ['Submission finished', (string) ($statusCounts['finished'] ?? 0), 'INFO'],
            ]
        );

        if ($queueSize < 0 || $queueSize >= $criticalSize || ! $cacheHealthy || ! $workerHealthy) {
            $this->components->error('Kondisi ujian membutuhkan perhatian segera.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }

    private function queueSize(): int
    {
        try {
            if (config('queue.default') === 'redis') {
                $queue = (string) config('quiz.scoring_queue', 'quiz-scoring');

                return (int) Redis::connection()->llen('queues:'.$queue);
            }

            return Schema::hasTable('jobs') ? (int) DB::table('jobs')->count() : 0;
        } catch (Throwable) {
            return -1;
        }
    }

    private function cacheHealthy(): bool
    {
        try {
            $key = 'quiz-monitor:health';
            Cache::put($key, 'ok', 10);

            return Cache::get($key) === 'ok';
        } catch (Throwable) {
            return false;
        }
    }

    private function workerHeartbeat(): array
    {
        if (! config('quiz.async_scoring_enabled', false)) {
            return ['healthy' => true, 'label' => 'async scoring nonaktif'];
        }

        try {
            $value = Cache::get((string) config('quiz.worker_heartbeat_cache_key', 'quiz-worker:last-heartbeat'));
            if (! is_string($value) || trim($value) === '') {
                return ['healthy' => false, 'label' => 'belum ada heartbeat'];
            }

            $age = Carbon::parse($value)->diffInSeconds(now());
            $maxAge = (int) config('quiz.worker_heartbeat_max_age_seconds', 150);

            return [
                'healthy' => $age <= $maxAge,
                'label' => $age.' detik lalu',
            ];
        } catch (Throwable) {
            return ['healthy' => false, 'label' => 'heartbeat tidak terbaca'];
        }
    }
}
