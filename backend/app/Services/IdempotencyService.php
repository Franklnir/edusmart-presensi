<?php

namespace App\Services;

use BackedEnum;
use DateTimeInterface;
use Illuminate\Contracts\Routing\UrlRoutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class IdempotencyService
{
    private const SAFE_RESPONSE_HEADERS = [
        'content-type',
        'location',
        'retry-after',
    ];

    /**
     * Execute and safely replay an idempotent JSON mutation.
     */
    public function handle(Request $request, ?string $fallbackKey, callable $callback): JsonResponse
    {
        $idempotencyKey = trim((string) $request->header('Idempotency-Key', $fallbackKey ?? ''));
        if ($idempotencyKey === '' || mb_strlen($idempotencyKey) > 255) {
            return $this->error(
                $request,
                'IDEMPOTENCY_KEY_REQUIRED',
                'Header Idempotency-Key wajib diisi dan maksimal 255 karakter.',
                Response::HTTP_UNPROCESSABLE_ENTITY
            );
        }

        $payloadHash = $this->payloadHash($request);
        $cacheKey = $this->cacheKeyFor($request, $idempotencyKey);
        $lockKey = $this->lockKeyFor($request, $idempotencyKey);

        try {
            // Laravel lock implementations compare this cryptographically random
            // owner token on release, so an expired worker cannot release a lock
            // acquired by a newer request.
            $lock = Cache::lock($lockKey, $this->lockSeconds($request), Str::random(40));
            $acquired = $lock->get();
        } catch (Throwable $exception) {
            $this->reportCacheFailure('lock', $cacheKey, $request, $exception);

            return $this->unavailable($request);
        }

        if (! $acquired) {
            return $this->error(
                $request,
                'IDEMPOTENCY_PROCESSING',
                'Permintaan dengan Idempotency-Key ini sedang diproses.',
                Response::HTTP_CONFLICT
            );
        }

        try {
            try {
                $cached = Cache::get($cacheKey);
            } catch (Throwable $exception) {
                $this->reportCacheFailure('read', $cacheKey, $request, $exception);

                return $this->unavailable($request);
            }

            if (is_array($cached)) {
                if (! hash_equals((string) ($cached['payload_hash'] ?? ''), $payloadHash)) {
                    return $this->error(
                        $request,
                        'IDEMPOTENCY_CONFLICT',
                        'Idempotency-Key yang sama telah digunakan dengan payload berbeda.',
                        Response::HTTP_CONFLICT
                    );
                }

                $response = response()->json(
                    array_key_exists('body', $cached) ? $cached['body'] : [],
                    (int) ($cached['status'] ?? Response::HTTP_OK)
                );
                foreach (($cached['headers'] ?? []) as $name => $value) {
                    $response->headers->set($name, $value);
                }
                $response->headers->set('Idempotency-Replayed', 'true');

                return $response;
            }

            $response = $callback();
            if (! $response instanceof JsonResponse) {
                throw new \LogicException('Idempotent callbacks must return a JsonResponse.');
            }

            if ($response->isSuccessful()) {
                $cachedResponse = [
                    'payload_hash' => $payloadHash,
                    'status' => $response->getStatusCode(),
                    'body' => $response->getData(true),
                    'headers' => $this->safeHeaders($response),
                ];

                // Most actions own their DB::transaction and have committed by
                // the time they return. This branch also makes the service safe
                // when a caller deliberately wraps it in an outer transaction.
                if (DB::transactionLevel() > 0) {
                    DB::afterCommit(fn () => $this->storeResponse($cacheKey, $cachedResponse, $request));
                } else {
                    $this->storeResponse($cacheKey, $cachedResponse, $request);
                }
            }

            return $response;
        } finally {
            try {
                $lock->release();
            } catch (Throwable $exception) {
                $this->reportCacheFailure('release', $cacheKey, $request, $exception);
            }
        }
    }

    public function cacheKeyFor(Request $request, string $idempotencyKey): string
    {
        return 'api-v2:idempotency:'.hash('sha256', json_encode([
            'tenant' => (string) $request->attributes->get('tenant_id', 'no-tenant'),
            'actor' => $this->actorIdentity($request),
            'method' => strtoupper($request->method()),
            'route' => $request->route()?->getName() ?: $request->route()?->uri() ?: $request->path(),
            'route_parameters' => $this->routeParameters($request),
            'key' => $idempotencyKey,
        ], JSON_THROW_ON_ERROR));
    }

    public function lockKeyFor(Request $request, string $idempotencyKey): string
    {
        return $this->cacheKeyFor($request, $idempotencyKey).':lock';
    }

    private function actorIdentity(Request $request): string
    {
        if ($request->user()?->id) {
            return 'user:'.$request->user()->id;
        }

        $deviceId = trim((string) $request->header('X-Device-ID', ''));

        return $deviceId !== '' ? 'device:'.$deviceId : 'guest:'.($request->ip() ?: 'unknown');
    }

    private function payloadHash(Request $request): string
    {
        $body = $request->request->all();
        $query = $request->query->all();
        unset($body['idempotency_key'], $query['idempotency_key']);

        return hash('sha256', json_encode(
            $this->canonicalize([
                'body' => $body,
                'query' => $query,
            ]),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        ));
    }

    private function canonicalize(mixed $value): mixed
    {
        if ($value instanceof UrlRoutable) {
            return (string) $value->getRouteKey();
        }

        if ($value instanceof BackedEnum) {
            return $value->value;
        }

        if ($value instanceof DateTimeInterface) {
            return $value->format(DateTimeInterface::ATOM);
        }

        if (! is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->canonicalize($item), $value);
        }

        ksort($value, SORT_STRING);

        return array_map(fn (mixed $item): mixed => $this->canonicalize($item), $value);
    }

    private function routeParameters(Request $request): array
    {
        $route = $request->route();
        if ($route === null) {
            return [];
        }

        return $this->canonicalize($route->parameters());
    }

    private function lockSeconds(Request $request): int
    {
        $default = max(5, (int) config('api_v2.idempotency.lock_seconds', 15));
        $overrides = config('api_v2.idempotency.lock_seconds_by_route', []);
        $routeName = $request->route()?->getName();

        if (! is_string($routeName) || ! is_array($overrides) || ! array_key_exists($routeName, $overrides)) {
            return $default;
        }

        return max(5, (int) $overrides[$routeName]);
    }

    private function storeResponse(string $cacheKey, array $cachedResponse, Request $request): void
    {
        try {
            Cache::put(
                $cacheKey,
                $cachedResponse,
                now()->addSeconds((int) config('api_v2.idempotency.ttl_seconds', 86400))
            );
        } catch (Throwable $exception) {
            // The domain mutation has already committed. Never turn that success
            // into a retry-inducing 5xx; domain uniqueness/state guards remain
            // the final duplicate protection when replay storage is unavailable.
            $this->reportCacheFailure('write_after_commit', $cacheKey, $request, $exception);
        }
    }

    private function unavailable(Request $request): JsonResponse
    {
        return $this->error(
            $request,
            'IDEMPOTENCY_UNAVAILABLE',
            'Layanan pengaman duplikasi sementara tidak tersedia. Silakan coba lagi.',
            Response::HTTP_SERVICE_UNAVAILABLE
        );
    }

    private function reportCacheFailure(string $operation, string $cacheKey, Request $request, Throwable $exception): void
    {
        Log::warning('API V2 idempotency cache operation failed.', [
            'operation' => $operation,
            'cache_identity' => hash('sha256', $cacheKey),
            'route' => $request->route()?->getName(),
            'request_id' => $request->attributes->get('request_id') ?: $request->header('X-Request-ID'),
            'exception_class' => $exception::class,
        ]);
    }

    private function safeHeaders(JsonResponse $response): array
    {
        $headers = [];
        foreach (self::SAFE_RESPONSE_HEADERS as $name) {
            if ($response->headers->has($name)) {
                $headers[$name] = (string) $response->headers->get($name);
            }
        }

        return $headers;
    }

    private function error(Request $request, string $code, string $message, int $status): JsonResponse
    {
        return response()->json([
            'success' => false,
            'code' => $code,
            'message' => $message,
            'error' => $message,
            'errors' => (object) [],
            'request_id' => $request->attributes->get('request_id') ?: $request->header('X-Request-ID'),
        ], $status);
    }
}
