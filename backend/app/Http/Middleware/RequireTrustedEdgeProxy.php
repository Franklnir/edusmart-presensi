<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireTrustedEdgeProxy
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! (bool) config('tenancy.require_edge_proxy', false)) {
            return $next($request);
        }

        $configuredSecret = trim((string) config('tenancy.edge_proxy_secret', ''));
        $headerName = trim((string) config('tenancy.edge_secret_header', 'X-Sismu-Edge-Secret'));
        $receivedSecret = $headerName !== ''
            ? (string) $request->headers->get($headerName, '')
            : '';

        if (
            $configuredSecret === ''
            || $receivedSecret === ''
            || ! hash_equals($configuredSecret, $receivedSecret)
        ) {
            return response()->json([
                'message' => 'Not Found',
            ], 404, [
                'Cache-Control' => 'no-store',
                'X-Robots-Tag' => 'noindex, nofollow',
            ]);
        }

        return $next($request);
    }
}
