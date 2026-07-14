<?php

namespace App\Services;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

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
        $lock = Cache::lock($this->lockKeyFor($request, $idempotencyKey), (int) config('api_v2.idempotency.lock_seconds', 15));

        if (! $lock->get()) {
            return $this->error(
                $request,
                'IDEMPOTENCY_PROCESSING',
                'Permintaan dengan Idempotency-Key ini sedang diproses.',
                Response::HTTP_CONFLICT
            );
        }

        try {
            $cached = Cache::get($cacheKey);
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
                    $cached['body'] ?? [],
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
                Cache::put($cacheKey, [
                    'payload_hash' => $payloadHash,
                    'status' => $response->getStatusCode(),
                    'body' => $response->getData(true),
                    'headers' => $this->safeHeaders($response),
                ], now()->addSeconds((int) config('api_v2.idempotency.ttl_seconds', 86400)));
            }

            return $response;
        } finally {
            $lock->release();
        }
    }

    public function cacheKeyFor(Request $request, string $idempotencyKey): string
    {
        return 'api-v2:idempotency:'.hash('sha256', json_encode([
            'tenant' => (string) $request->attributes->get('tenant_id', 'no-tenant'),
            'actor' => $this->actorIdentity($request),
            'method' => strtoupper($request->method()),
            'route' => $request->route()?->getName() ?: $request->path(),
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
        $payload = $request->all();
        unset($payload['idempotency_key']);

        return hash('sha256', json_encode(
            $this->canonicalize($payload),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        ));
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->canonicalize($item), $value);
        }

        ksort($value, SORT_STRING);

        return array_map(fn (mixed $item): mixed => $this->canonicalize($item), $value);
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
            'request_id' => $request->header('X-Request-ID'),
        ], $status);
    }
}
