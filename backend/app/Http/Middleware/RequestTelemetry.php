<?php

namespace App\Http\Middleware;

use App\Support\Observability\RequestId;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

class RequestTelemetry
{
    public function handle(Request $request, Closure $next): Response
    {
        $startedAt = hrtime(true);
        $requestId = RequestId::resolve($request);
        $correlationId = RequestId::correlationId($request);
        $context = ['request_id' => $requestId];
        if ($correlationId) {
            $context['correlation_id'] = $correlationId;
        }
        Log::withContext($context);

        try {
            $response = $next($request);
            $durationMs = $this->durationMs($startedAt);
            $timing = 'app;dur='.number_format($durationMs, 1, '.', '');
            $existingTiming = trim((string) $response->headers->get('Server-Timing', ''));

            $response->headers->set(RequestId::HEADER, $requestId);
            if ($correlationId) {
                $response->headers->set(RequestId::CORRELATION_HEADER, $correlationId);
            }
            $this->normalizeJsonRequestId($response, $requestId);
            $response->headers->set('Server-Timing', $existingTiming !== '' ? $existingTiming.', '.$timing : $timing);
            $this->logAccess($request, $response->getStatusCode(), $durationMs);

            return $response;
        } catch (Throwable $exception) {
            $this->logAccess($request, $this->exceptionStatus($exception), $this->durationMs($startedAt), $exception);
            throw $exception;
        } finally {
            Log::withoutContext();
        }
    }

    private function durationMs(int $startedAt): float
    {
        return round(max(0, hrtime(true) - $startedAt) / 1_000_000, 2);
    }

    private function normalizeJsonRequestId(Response $response, string $requestId): void
    {
        if (! method_exists($response, 'getData') || ! method_exists($response, 'setData')) {
            return;
        }

        try {
            $payload = $response->getData(true);
            if (! is_array($payload)) {
                return;
            }

            if (! array_key_exists('request_id', $payload)) {
                return;
            }

            $payload['request_id'] = $requestId;
            $response->setData($payload);
        } catch (Throwable) {
            // Streaming and non-JSON responses are intentionally left alone.
        }
    }

    private function logAccess(Request $request, int $status, float $durationMs, ?Throwable $exception = null): void
    {
        if (! str_starts_with($request->path(), 'api/')) {
            return;
        }

        $route = $request->route();
        $payload = [
            'event' => 'api_request',
            'method' => strtoupper($request->method()),
            'route_name' => is_object($route) ? ($route->getName() ?: null) : null,
            'path_template' => is_object($route) ? ($route->uri() ?: null) : $request->path(),
            'response_status' => $status,
            'duration_ms' => $durationMs,
            'tenant_id' => $request->attributes->get('tenant_id'),
            'actor_id' => $request->user()?->id,
            'actor_role' => $request->user()?->profile?->role,
            'domain' => $this->domain($request),
            'controller_action' => is_object($route) ? $route->getActionName() : null,
            'client_ip' => $request->ip(),
            'user_agent' => substr(trim((string) $request->userAgent()), 0, 240),
            'release_sha' => config('app.release_sha', 'unknown'),
        ];
        if ($exception) {
            $payload['exception_class'] = $exception::class;
        }

        $slow = $durationMs >= config('observability.slow_request_threshold_ms', 1000);
        $level = $exception || $status >= 500
            ? 'error'
            : ($slow || in_array($status, [409, 429], true) ? 'warning' : 'info');
        try {
            Log::channel(config('observability.structured_channel', 'structured'))
                ->log($level, $slow ? 'slow_api_request' : 'api_request', $payload);
        } catch (Throwable) {
            // Observability must never turn a successful API response into a 500.
        }
    }

    private function domain(Request $request): string
    {
        $path = $request->path();

        return str_starts_with($path, 'api/v2/')
            ? (explode('/', substr($path, 7))[0] ?: 'v2')
            : (explode('/', substr($path, 4))[0] ?: 'api');
    }

    private function exceptionStatus(Throwable $exception): int
    {
        if ($exception instanceof ValidationException) {
            return 422;
        }
        if ($exception instanceof HttpExceptionInterface) {
            return $exception->getStatusCode();
        }

        return 500;
    }
}
