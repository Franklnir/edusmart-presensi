<?php

namespace App\Services\Monitoring;

use App\Jobs\QuizWorkerHeartbeatJob;
use Composer\InstalledVersions;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Horizon\Contracts\JobRepository;
use Laravel\Horizon\Contracts\MasterSupervisorRepository;
use Laravel\Horizon\Contracts\MetricsRepository;
use Laravel\Horizon\Contracts\SupervisorRepository;
use Laravel\Horizon\Contracts\WorkloadRepository;
use Laravel\Horizon\Horizon;
use Throwable;

class QueueMonitoringService
{
    private const DEFAULT_WARNING_BACKLOG = 100;

    private const DEFAULT_CRITICAL_BACKLOG = 500;

    public function snapshot(string $dashboardUrl = ''): array
    {
        $queues = $this->queueStats();
        $redis = $this->redisHealth();
        $horizon = $this->horizonStats($dashboardUrl);
        $databaseFailures = $this->databaseFailedJobs();
        $scheduler = [
            'scheduler' => $this->heartbeat('scheduler:last-heartbeat', 150),
            'quiz_worker' => $this->heartbeat(
                (string) config('quiz.worker_heartbeat_cache_key', 'quiz-worker:last-heartbeat'),
                (int) config('quiz.worker_heartbeat_max_age_seconds', 150)
            ),
        ];

        return [
            'generated_at' => now()->toIso8601String(),
            'status' => $this->overallStatus($redis, $horizon, $queues, $databaseFailures, $scheduler),
            'redis' => $redis,
            'horizon' => $horizon,
            'queues' => $queues,
            'database_failed_jobs' => $databaseFailures,
            'heartbeats' => $scheduler,
        ];
    }

    private function redisHealth(): array
    {
        $started = microtime(true);

        try {
            $pong = Redis::connection()->ping();

            return [
                'ok' => true,
                'status' => 'healthy',
                'latency_ms' => (int) round((microtime(true) - $started) * 1000),
                'response' => is_string($pong) ? $pong : 'PONG',
            ];
        } catch (Throwable $e) {
            return [
                'ok' => false,
                'status' => 'critical',
                'latency_ms' => null,
                'response' => null,
                'message' => $this->shortMessage($e->getMessage()),
            ];
        }
    }

    private function queueStats(): array
    {
        $workload = $this->horizonWorkloadByQueue();

        return collect($this->monitoredQueues())
            ->map(function (string $queue) use ($workload) {
                $raw = $this->redisQueueLengths($queue);
                $total = (int) ($raw['ready'] ?? 0) + (int) ($raw['delayed'] ?? 0) + (int) ($raw['reserved'] ?? 0);
                $limits = $this->queueLimits($queue);
                $status = $this->queueStatus($total, $raw['ok'] ?? false, $limits);
                $load = $workload[$queue] ?? [];

                return [
                    'name' => $queue,
                    'label' => $this->queueLabel($queue),
                    'status' => $status,
                    'ready' => (int) ($raw['ready'] ?? 0),
                    'delayed' => (int) ($raw['delayed'] ?? 0),
                    'reserved' => (int) ($raw['reserved'] ?? 0),
                    'total_backlog' => $total,
                    'wait_seconds' => (int) ($load['wait'] ?? 0),
                    'processes' => (int) ($load['processes'] ?? 0),
                    'warning_backlog' => $limits['warning'],
                    'critical_backlog' => $limits['critical'],
                    'available' => (bool) ($raw['ok'] ?? false),
                    'message' => (string) ($raw['message'] ?? ''),
                ];
            })
            ->values()
            ->all();
    }

    private function redisQueueLengths(string $queue): array
    {
        try {
            $connection = Redis::connection();

            return [
                'ok' => true,
                'ready' => (int) $connection->llen('queues:'.$queue),
                'delayed' => (int) $connection->zcard('queues:'.$queue.':delayed'),
                'reserved' => (int) $connection->zcard('queues:'.$queue.':reserved'),
            ];
        } catch (Throwable $e) {
            return [
                'ok' => false,
                'ready' => 0,
                'delayed' => 0,
                'reserved' => 0,
                'message' => $this->shortMessage($e->getMessage()),
            ];
        }
    }

    private function horizonStats(string $dashboardUrl): array
    {
        $installed = class_exists(Horizon::class);
        $version = null;

        try {
            $version = InstalledVersions::isInstalled('laravel/horizon')
                ? InstalledVersions::getPrettyVersion('laravel/horizon')
                : null;
        } catch (Throwable) {
            $version = null;
        }

        if (! $installed) {
            return [
                'installed' => false,
                'status' => 'not_installed',
                'version' => $version,
                'dashboard_url' => $dashboardUrl,
                'masters' => [],
                'supervisors' => [],
                'counts' => $this->emptyHorizonCounts(),
                'metrics' => [],
                'recent_jobs' => [],
                'pending_jobs' => [],
                'failed_jobs' => [],
            ];
        }

        try {
            $masters = collect(app(MasterSupervisorRepository::class)->all())
                ->map(fn ($master) => [
                    'name' => (string) ($master->name ?? ''),
                    'environment' => (string) ($master->environment ?? ''),
                    'pid' => (string) ($master->pid ?? ''),
                    'status' => (string) ($master->status ?? 'unknown'),
                    'supervisors' => array_values((array) ($master->supervisors ?? [])),
                ])
                ->values()
                ->all();

            $supervisors = collect(app(SupervisorRepository::class)->all())
                ->map(fn ($supervisor) => $this->serializeSupervisor($supervisor))
                ->values()
                ->all();

            $jobs = app(JobRepository::class);

            return [
                'installed' => true,
                'status' => $this->horizonStatus($masters),
                'version' => $version,
                'dashboard_url' => $dashboardUrl,
                'masters' => $masters,
                'supervisors' => $supervisors,
                'counts' => [
                    'recent' => (int) $jobs->countRecent(),
                    'pending' => (int) $jobs->countPending(),
                    'completed' => (int) $jobs->countCompleted(),
                    'failed' => (int) $jobs->countFailed(),
                    'recent_failed' => (int) $jobs->countRecentlyFailed(),
                    'processes' => collect($supervisors)->sum('total_processes'),
                ],
                'metrics' => $this->horizonMetrics(),
                'recent_jobs' => $jobs->getRecent()->take(12)->map(fn ($job) => $this->serializeHorizonJob($job))->values(),
                'pending_jobs' => $jobs->getPending()->take(12)->map(fn ($job) => $this->serializeHorizonJob($job))->values(),
                'failed_jobs' => $jobs->getFailed()->take(8)->map(fn ($job) => $this->serializeHorizonJob($job))->values(),
            ];
        } catch (Throwable $e) {
            return [
                'installed' => true,
                'status' => 'unavailable',
                'version' => $version,
                'dashboard_url' => $dashboardUrl,
                'masters' => [],
                'supervisors' => [],
                'counts' => $this->emptyHorizonCounts(),
                'metrics' => [],
                'recent_jobs' => [],
                'pending_jobs' => [],
                'failed_jobs' => [],
                'message' => $this->shortMessage($e->getMessage()),
            ];
        }
    }

    private function horizonWorkloadByQueue(): array
    {
        try {
            return collect(app(WorkloadRepository::class)->get())
                ->flatMap(function (array $row) {
                    if (! empty($row['split_queues'])) {
                        return collect($row['split_queues'])->mapWithKeys(fn ($queue) => [
                            (string) ($queue['name'] ?? '') => [
                                'wait' => (int) ($queue['wait'] ?? 0),
                                'processes' => (int) ($row['processes'] ?? 0),
                            ],
                        ]);
                    }

                    return [
                        (string) ($row['name'] ?? '') => [
                            'wait' => (int) ($row['wait'] ?? 0),
                            'processes' => (int) ($row['processes'] ?? 0),
                        ],
                    ];
                })
                ->filter(fn ($row, $queue) => $queue !== '')
                ->all();
        } catch (Throwable) {
            return [];
        }
    }

    private function horizonMetrics(): array
    {
        try {
            $metrics = app(MetricsRepository::class);

            return [
                'jobs_per_minute' => round((float) $metrics->jobsProcessedPerMinute(), 2),
                'queue_with_max_runtime' => $metrics->queueWithMaximumRuntime(),
                'queue_with_max_throughput' => $metrics->queueWithMaximumThroughput(),
            ];
        } catch (Throwable) {
            return [
                'jobs_per_minute' => 0,
                'queue_with_max_runtime' => null,
                'queue_with_max_throughput' => null,
            ];
        }
    }

    private function databaseFailedJobs(): array
    {
        if (! Schema::hasTable('failed_jobs')) {
            return [
                'available' => false,
                'total' => 0,
                'last_hour' => 0,
                'last_24h' => 0,
                'recent' => [],
            ];
        }

        $allFailedJobsQuery = DB::table('failed_jobs');
        $query = $this->withoutIgnoredFailedJobs(DB::table('failed_jobs'));
        $hasFailedAt = Schema::hasColumn('failed_jobs', 'failed_at');
        $total = (int) (clone $query)->count();
        $lastHour = $hasFailedAt ? (int) (clone $query)->where('failed_at', '>=', now()->subHour())->count() : $total;
        $lastDay = $hasFailedAt ? (int) (clone $query)->where('failed_at', '>=', now()->subDay())->count() : $total;
        $recentQuery = (clone $query)->select('id', 'uuid', 'connection', 'queue', 'payload', 'exception', 'failed_at');
        $ignoredTotal = max(0, (int) (clone $allFailedJobsQuery)->count() - $total);
        if ($hasFailedAt) {
            $recentQuery->orderByDesc('failed_at');
        } else {
            $recentQuery->orderByDesc('id');
        }

        $recent = $recentQuery
            ->limit(8)
            ->get()
            ->map(fn ($row) => $this->serializeDatabaseFailedJob($row))
            ->values()
            ->all();

        return [
            'available' => true,
            'total' => $total,
            'ignored_total' => $ignoredTotal,
            'last_hour' => $lastHour,
            'last_24h' => $lastDay,
            'recent' => $recent,
        ];
    }

    private function heartbeat(string $key, int $maxAgeSeconds): array
    {
        $value = Cache::get($key);
        $seen = $this->carbonFromValue($value);

        if (! $seen) {
            return [
                'status' => 'unknown',
                'last_seen_at' => null,
                'age_seconds' => null,
                'max_age_seconds' => $maxAgeSeconds,
            ];
        }

        $age = max(0, now()->diffInSeconds($seen));
        $status = $age <= $maxAgeSeconds
            ? 'healthy'
            : ($age <= $maxAgeSeconds * 2 ? 'warning' : 'critical');

        return [
            'status' => $status,
            'last_seen_at' => $seen->toIso8601String(),
            'age_seconds' => $age,
            'max_age_seconds' => $maxAgeSeconds,
        ];
    }

    private function overallStatus(array $redis, array $horizon, array $queues, array $databaseFailures, array $heartbeats): array
    {
        $issues = [];
        $severity = 'healthy';

        $raise = function (string $next) use (&$severity): void {
            $weight = ['healthy' => 0, 'warning' => 1, 'critical' => 2];
            if (($weight[$next] ?? 0) > ($weight[$severity] ?? 0)) {
                $severity = $next;
            }
        };

        if (! ($redis['ok'] ?? false)) {
            $raise('critical');
            $issues[] = 'Redis queue tidak bisa dihubungi.';
        }

        if (($horizon['status'] ?? '') === 'inactive') {
            $raise('warning');
            $issues[] = 'Horizon belum melaporkan master supervisor aktif.';
        } elseif (in_array(($horizon['status'] ?? ''), ['paused', 'unavailable'], true)) {
            $raise('critical');
            $issues[] = 'Horizon tidak dalam status running.';
        }

        foreach ($queues as $queue) {
            if (($queue['status'] ?? '') === 'critical') {
                $raise('critical');
                $issues[] = 'Backlog queue '.$queue['name'].' melewati batas kritikal.';
            } elseif (($queue['status'] ?? '') === 'warning') {
                $raise('warning');
                $issues[] = 'Backlog queue '.$queue['name'].' mulai tinggi.';
            }
        }

        if ((int) ($databaseFailures['last_hour'] ?? 0) > 0) {
            $raise('critical');
            $issues[] = 'Ada failed job dalam 1 jam terakhir.';
        } elseif ((int) ($databaseFailures['last_24h'] ?? 0) > 0) {
            $raise('warning');
            $issues[] = 'Ada failed job dalam 24 jam terakhir.';
        }

        foreach ($heartbeats as $name => $heartbeat) {
            if (($heartbeat['status'] ?? '') === 'critical') {
                $raise('critical');
                $issues[] = str_replace('_', ' ', $name).' heartbeat terlambat.';
            } elseif (($heartbeat['status'] ?? '') === 'warning') {
                $raise('warning');
                $issues[] = str_replace('_', ' ', $name).' heartbeat mulai terlambat.';
            }
        }

        return [
            'level' => $severity,
            'label' => match ($severity) {
                'critical' => 'Perlu Tindakan',
                'warning' => 'Perlu Dipantau',
                default => 'Sehat',
            },
            'issues' => $issues,
        ];
    }

    private function withoutIgnoredFailedJobs(Builder $query): Builder
    {
        foreach ($this->ignoredFailedJobNeedles() as $needle) {
            $query->where(function (Builder $scope) use ($needle): void {
                $scope
                    ->where(function (Builder $payload) use ($needle): void {
                        $payload->whereNull('payload')->orWhere('payload', 'not like', '%'.$needle.'%');
                    })
                    ->where(function (Builder $exception) use ($needle): void {
                        $exception->whereNull('exception')->orWhere('exception', 'not like', '%'.$needle.'%');
                    });
            });
        }

        return $query;
    }

    private function ignoredFailedJobNeedles(): array
    {
        return [
            class_basename(QuizWorkerHeartbeatJob::class),
        ];
    }

    private function monitoredQueues(): array
    {
        $queues = [
            (string) config('queue.connections.redis.queue', 'default'),
            (string) config('backup.queue', 'backup'),
            (string) config('quiz.scoring_queue', 'quiz-scoring'),
        ];

        $extra = array_map('trim', explode(',', (string) env('HORIZON_MONITORED_QUEUES', '')));

        return collect([...$queues, ...$extra])
            ->map(fn ($queue) => trim($queue))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function queueLimits(string $queue): array
    {
        $warning = (int) config('quiz.monitor_warning_queue_size', self::DEFAULT_WARNING_BACKLOG);
        $critical = (int) config('quiz.monitor_critical_queue_size', self::DEFAULT_CRITICAL_BACKLOG);

        if ($queue === (string) config('backup.queue', 'backup')) {
            $warning = max(20, (int) env('BACKUP_MONITOR_WARNING_QUEUE_SIZE', 30));
            $critical = max($warning + 1, (int) env('BACKUP_MONITOR_CRITICAL_QUEUE_SIZE', 100));
        }

        return [
            'warning' => max(1, $warning),
            'critical' => max($warning + 1, $critical),
        ];
    }

    private function queueStatus(int $total, bool $available, array $limits): string
    {
        if (! $available) {
            return 'unknown';
        }

        if ($total >= (int) $limits['critical']) {
            return 'critical';
        }

        if ($total >= (int) $limits['warning']) {
            return 'warning';
        }

        return 'healthy';
    }

    private function horizonStatus(array $masters): string
    {
        if (empty($masters)) {
            return 'inactive';
        }

        return collect($masters)->every(fn ($master) => ($master['status'] ?? '') === 'paused')
            ? 'paused'
            : 'running';
    }

    private function emptyHorizonCounts(): array
    {
        return [
            'recent' => 0,
            'pending' => 0,
            'completed' => 0,
            'failed' => 0,
            'recent_failed' => 0,
            'processes' => 0,
        ];
    }

    private function serializeSupervisor(object $supervisor): array
    {
        $processes = collect((array) ($supervisor->processes ?? []))
            ->map(fn ($count, $queue) => [
                'queue' => (string) $queue,
                'processes' => (int) $count,
            ])
            ->values()
            ->all();

        $options = (array) ($supervisor->options ?? []);

        return [
            'name' => (string) ($supervisor->name ?? ''),
            'master' => (string) ($supervisor->master ?? ''),
            'pid' => (string) ($supervisor->pid ?? ''),
            'status' => (string) ($supervisor->status ?? 'unknown'),
            'queues' => $processes,
            'total_processes' => collect($processes)->sum('processes'),
            'balance' => (string) ($options['balance'] ?? ''),
            'max_processes' => (int) ($options['maxProcesses'] ?? 0),
            'min_processes' => (int) ($options['minProcesses'] ?? 0),
            'timeout' => (int) ($options['timeout'] ?? 0),
            'tries' => (int) ($options['maxTries'] ?? 0),
        ];
    }

    private function serializeHorizonJob(object $job): array
    {
        return [
            'id' => (string) ($job->id ?? ''),
            'index' => (int) ($job->index ?? 0),
            'name' => $this->friendlyJobName((string) ($job->name ?? 'Job')),
            'connection' => (string) ($job->connection ?? ''),
            'queue' => (string) ($job->queue ?? ''),
            'status' => (string) ($job->status ?? 'unknown'),
            'reserved_at' => $this->timestampFromValue($job->reserved_at ?? null),
            'completed_at' => $this->timestampFromValue($job->completed_at ?? null),
            'failed_at' => $this->timestampFromValue($job->failed_at ?? null),
            'delay' => (int) ($job->delay ?? 0),
            'exception' => $this->shortMessage((string) ($job->exception ?? '')),
        ];
    }

    private function serializeDatabaseFailedJob(object $row): array
    {
        $payload = json_decode((string) ($row->payload ?? ''), true);
        $name = is_array($payload)
            ? (string) (data_get($payload, 'displayName') ?: data_get($payload, 'job') ?: 'Failed Job')
            : 'Failed Job';

        return [
            'id' => (string) ($row->id ?? ''),
            'uuid' => (string) ($row->uuid ?? ''),
            'name' => $this->friendlyJobName($name),
            'connection' => (string) ($row->connection ?? ''),
            'queue' => (string) ($row->queue ?? ''),
            'failed_at' => $this->carbonFromValue($row->failed_at ?? null)?->toIso8601String(),
            'exception' => $this->shortMessage((string) ($row->exception ?? '')),
        ];
    }

    private function queueLabel(string $queue): string
    {
        return match ($queue) {
            (string) config('quiz.scoring_queue', 'quiz-scoring') => 'Quiz Scoring',
            (string) config('backup.queue', 'backup') => 'Backup',
            'default' => 'Default',
            default => Str::headline(str_replace(['-', '_'], ' ', $queue)),
        };
    }

    private function friendlyJobName(string $name): string
    {
        $base = class_basename($name ?: 'Job');

        return Str::headline(str_replace('Job', ' Job', $base));
    }

    private function timestampFromValue($value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_numeric($value)) {
            return Carbon::createFromTimestamp((float) $value)->toIso8601String();
        }

        return $this->carbonFromValue($value)?->toIso8601String();
    }

    private function carbonFromValue($value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return Carbon::parse($value);
        } catch (Throwable) {
            return null;
        }
    }

    private function shortMessage(string $message): string
    {
        $clean = trim(preg_replace('/\s+/', ' ', $message) ?: '');

        return $clean === '' ? '' : Str::limit($clean, 180);
    }
}
