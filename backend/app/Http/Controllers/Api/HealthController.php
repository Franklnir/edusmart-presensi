<?php

namespace App\Http\Controllers\Api;

use App\Contracts\UploadStorageProvider;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Throwable;

final class HealthController extends ApiController
{
    public function ready(): JsonResponse
    {
        $checks = [
            'database' => $this->checkDatabase(),
            'redis' => $this->checkRedis(),
            'queue' => ['ok' => (string) config('queue.default', '') !== '', 'driver' => (string) config('queue.default', 'unknown')],
            'storage' => $this->checkStorage(),
        ];
        $ready = collect($checks)->every(fn (array $check): bool => (bool) ($check['ok'] ?? false));

        return response()->json([
            'status' => $ready ? 'ready' : 'not_ready',
            'release_sha' => (string) config('app.release_sha', 'unknown'),
            'environment' => (string) config('app.env', 'unknown'),
            'checks' => $checks,
        ], $ready ? 200 : 503);
    }

    private function checkDatabase(): array
    {
        try {
            DB::connection()->getPdo();

            return ['ok' => true, 'status' => 'healthy'];
        } catch (Throwable) {
            return ['ok' => false, 'status' => 'unavailable'];
        }
    }

    private function checkRedis(): array
    {
        try {
            Redis::connection()->ping();

            return ['ok' => true, 'status' => 'healthy'];
        } catch (Throwable) {
            return ['ok' => false, 'status' => 'unavailable'];
        }
    }

    private function checkStorage(): array
    {
        try {
            $provider = app(UploadStorageProvider::class);

            return ['ok' => $provider->ready(), 'provider' => $provider->name()];
        } catch (Throwable) {
            return ['ok' => false, 'provider' => 'unavailable'];
        }
    }
}
