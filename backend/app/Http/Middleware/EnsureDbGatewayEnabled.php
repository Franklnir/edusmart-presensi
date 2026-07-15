<?php

namespace App\Http\Middleware;

use App\Support\Observability\RequestId;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureDbGatewayEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (config('api_db.enabled', true)) {
            return $next($request);
        }

        $requestId = RequestId::get($request);

        return response()->json([
            'success' => false,
            'code' => 'API_DB_DEPRECATED',
            'message' => 'Endpoint ini sudah tidak tersedia.',
            'details' => [],
            'request_id' => $requestId,
        ], 410)->header('X-Request-ID', $requestId);
    }
}
