<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class EnsureDbGatewayEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        if (config('api_db.enabled', true)) {
            return $next($request);
        }

        $requestId = (string) (
            $request->attributes->get('request_id')
            ?: $request->header('X-Request-ID')
            ?: Str::uuid()
        );

        return response()->json([
            'success' => false,
            'code' => 'API_DB_DEPRECATED',
            'message' => 'Endpoint ini sudah tidak tersedia.',
            'request_id' => $requestId,
        ], 410)->header('X-Request-ID', $requestId);
    }
}
