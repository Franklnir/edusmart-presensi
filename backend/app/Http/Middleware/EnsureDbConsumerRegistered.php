<?php

namespace App\Http\Middleware;

use App\Support\Observability\RequestId;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureDbConsumerRegistered
{
    public function handle(Request $request, Closure $next): Response
    {
        $consumer = trim((string) (
            $request->header('X-Client-Consumer')
            ?: $request->header('X-DB-Consumer')
            ?: 'legacy-supabase-adapter'
        ));
        $allowed = config('api_db.allowed_consumers', []);

        if (in_array($consumer, $allowed, true)) {
            $request->attributes->set('db_proxy_consumer', $consumer);

            return $next($request);
        }

        $requestId = RequestId::get($request);

        return response()->json([
            'success' => false,
            'code' => 'DB_CONSUMER_NOT_REGISTERED',
            'message' => 'Consumer legacy tidak terdaftar.',
            'details' => [],
            'request_id' => $requestId,
        ], 403)->header('X-Request-ID', $requestId);
    }
}
