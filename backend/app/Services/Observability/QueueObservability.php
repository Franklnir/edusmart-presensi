<?php

namespace App\Services\Observability;

use App\Support\Observability\RequestId;
use Illuminate\Http\Request;
use Illuminate\Queue\Events\JobExceptionOccurred;
use Illuminate\Queue\Events\JobProcessed;
use Illuminate\Queue\Events\JobProcessing;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

final class QueueObservability
{
    /** @var array<string, int> */
    private array $startedAt = [];

    public function register(): void
    {
        Queue::createPayloadUsing(function (): array {
            $request = ! app()->runningInConsole() && app()->bound('request') ? request() : null;

            return $this->payloadContext($request);
        });

        Queue::before(function (JobProcessing $event): void {
            $jobId = (string) $event->job->getJobId();
            $this->startedAt[$jobId] = hrtime(true);
            $context = $this->context($event->job->payload(), $jobId, $event->job->getQueue());
            Log::withContext($context);
            Log::channel(config('observability.structured_channel', 'structured'))
                ->info('queue_job_started', $context + ['attempts' => $event->job->attempts()]);
        });

        Queue::after(function (JobProcessed $event): void {
            $this->finish($event->job->payload(), (string) $event->job->getJobId(), $event->job->getQueue(), 'queue_job_completed');
        });

        Queue::exceptionOccurred(function (JobExceptionOccurred $event): void {
            $this->finish($event->job->payload(), (string) $event->job->getJobId(), $event->job->getQueue(), 'queue_job_failed', $event->exception);
        });
    }

    private function finish(array $payload, string $jobId, ?string $queue, string $event, ?\Throwable $exception = null): void
    {
        $startedAt = $this->startedAt[$jobId] ?? null;
        $context = $this->context($payload, $jobId, $queue);
        $context['duration_ms'] = $startedAt ? round(max(0, hrtime(true) - $startedAt) / 1_000_000, 2) : null;
        $context['attempts'] = $payload['attempts'] ?? null;
        if ($exception) {
            $context['failure_code'] = Str::limit((string) $exception::class, 120, '');
        }

        Log::channel(config('observability.structured_channel', 'structured'))
            ->log($exception ? 'error' : 'info', $event, $context);
        unset($this->startedAt[$jobId]);
        Log::withoutContext();
    }

    public function payloadContext(?Request $request): array
    {
        return [
            'observability' => [
                'request_id' => $request ? RequestId::get($request) : null,
                'correlation_id' => $request ? RequestId::correlationId($request) : null,
                'tenant_id' => $request?->attributes->get('tenant_id'),
                'actor_id' => $request?->user()?->id,
                'release_sha' => config('app.release_sha', 'unknown'),
            ],
        ];
    }

    private function context(array $payload, string $jobId, ?string $queue): array
    {
        $observability = is_array($payload['observability'] ?? null) ? $payload['observability'] : [];

        return [
            'event' => 'queue_job',
            'job_id' => $jobId,
            'queue' => is_string($queue) ? Str::limit($queue, 120, '') : null,
            'request_id' => $this->safeUuid($observability['request_id'] ?? null),
            'correlation_id' => $this->safeUuid($observability['correlation_id'] ?? null),
            'tenant_id' => $this->safeScalar($observability['tenant_id'] ?? null),
            'actor_id' => $this->safeScalar($observability['actor_id'] ?? null),
            'release_sha' => $this->safeScalar($observability['release_sha'] ?? config('app.release_sha', 'unknown')),
        ];
    }

    private function safeUuid(mixed $value): ?string
    {
        return RequestId::valid(is_string($value) ? $value : null) ? strtolower($value) : null;
    }

    private function safeScalar(mixed $value): ?string
    {
        return is_scalar($value) ? Str::limit((string) $value, 180, '') : null;
    }
}
