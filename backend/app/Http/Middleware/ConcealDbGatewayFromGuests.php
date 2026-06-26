<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

class ConcealDbGatewayFromGuests
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user('sanctum') ?? $request->user();
        if ($user !== null) {
            Auth::setUser($user);

            return $next($request);
        }

        if ($this->hasAuthenticationHint($request)) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        return response()->json(['message' => 'Not Found'], 404);
    }

    private function hasAuthenticationHint(Request $request): bool
    {
        if (trim((string) $request->bearerToken()) !== '') {
            return true;
        }

        return false;
    }
}
