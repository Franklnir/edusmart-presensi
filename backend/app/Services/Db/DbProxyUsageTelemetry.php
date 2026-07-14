<?php

namespace App\Services\Db;

use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

class DbProxyUsageTelemetry
{
    /**
     * Record a privacy-safe aggregate for legacy DB proxy usage. This is a
     * migration aid, never an audit trail of request payloads or school data.
     */
    public function record(Request $request, int $status, int $startedAt): void
    {
        try {
            $metadata = $this->metadata($request, $status, $startedAt);
            $now = now();

            $updated = DB::table('db_proxy_usage_telemetry')
                ->where('scope_key', $metadata['scope_key'])
                ->update([
                    'request_id' => $metadata['request_id'],
                    'duration_ms' => $metadata['duration_ms'],
                    'last_seen' => $now,
                    'count' => DB::raw('count + 1'),
                ]);

            if ($updated > 0) {
                return;
            }

            try {
                DB::table('db_proxy_usage_telemetry')->insert([
                    ...$metadata,
                    'first_seen' => $now,
                    'last_seen' => $now,
                    'count' => 1,
                ]);
            } catch (QueryException) {
                // Another concurrent proxy request created the same aggregate.
                DB::table('db_proxy_usage_telemetry')
                    ->where('scope_key', $metadata['scope_key'])
                    ->update([
                        'request_id' => $metadata['request_id'],
                        'duration_ms' => $metadata['duration_ms'],
                        'last_seen' => $now,
                        'count' => DB::raw('count + 1'),
                    ]);
            }
        } catch (Throwable $exception) {
            // DB proxy telemetry must not affect a legacy business operation.
            Log::warning('db_proxy_usage_telemetry_failed', [
                'exception_class' => $exception::class,
            ]);
        }
    }

    /**
     * @return array<string, int|string|null>
     */
    private function metadata(Request $request, int $status, int $startedAt): array
    {
        $tenantId = $this->uuidOrNull($request->attributes->get('tenant_id'));
        $actorId = $this->uuidOrNull($request->user()?->id);
        $route = $this->route($request->header('X-Frontend-Route'));
        $consumer = $this->token($request->header('X-DB-Consumer'), 128) ?: 'legacy-supabase-adapter';
        $domain = $this->token($request->input('table'), 128) ?: 'unknown';
        $operation = $this->token($request->input('action', 'select'), 32) ?: 'select';
        $releaseSha = $this->token(config('app.release_sha'), 128) ?: 'unknown';
        $scope = implode('|', [
            $tenantId ?? 'guest',
            $actorId ?? 'anonymous',
            $route ?? 'unknown',
            $consumer,
            $domain,
            $operation,
            max(0, $status),
            $releaseSha,
        ]);

        return [
            'scope_key' => hash('sha256', $scope),
            'request_id' => $this->token($request->attributes->get('request_id') ?: $request->header('X-Request-ID'), 128),
            'tenant_id' => $tenantId,
            'actor_id' => $actorId,
            'frontend_route' => $route,
            'consumer_id' => $consumer,
            'domain' => $domain,
            'operation' => $operation,
            'response_status' => max(0, min(999, $status)),
            'duration_ms' => max(0, min(3_600_000, (int) round((hrtime(true) - $startedAt) / 1_000_000))),
            'release_sha' => $releaseSha,
        ];
    }

    private function uuidOrNull(mixed $value): ?string
    {
        $value = trim((string) $value);

        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value)
            ? strtolower($value)
            : null;
    }

    private function route(mixed $value): ?string
    {
        $value = trim((string) $value);
        if ($value === '' || ! str_starts_with($value, '/')) {
            return null;
        }

        $path = parse_url($value, PHP_URL_PATH);
        $path = is_string($path) ? $path : '';
        $path = preg_replace('#[^A-Za-z0-9_./-]#', '', $path) ?? '';

        return $path !== '' ? substr($path, 0, 512) : null;
    }

    private function token(mixed $value, int $limit): ?string
    {
        $value = trim((string) $value);
        $value = preg_replace('#[^A-Za-z0-9_./:-]#', '', $value) ?? '';

        return $value !== '' ? substr($value, 0, $limit) : null;
    }
}
