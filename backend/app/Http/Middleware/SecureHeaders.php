<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecureHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        /** @var Response $response */
        $response = $next($request);
        $isApiResponse = $request->is('api/*') || $request->is('sanctum/*') || $request->expectsJson();

        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
        $isGooglePopupHtml = $request->is('api/auth/google/callback')
            || $request->is('api/auth/google/finalize-login');

        $response->headers->set(
            'Cross-Origin-Opener-Policy',
            $isGooglePopupHtml ? 'same-origin-allow-popups' : 'same-origin'
        );
        $response->headers->set('Cross-Origin-Resource-Policy', 'same-site');
        $response->headers->set('X-Permitted-Cross-Domain-Policies', 'none');

        if ($isApiResponse && $isGooglePopupHtml) {
            $response->headers->set(
                'Content-Security-Policy',
                "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
            );
        } elseif ($isApiResponse) {
            $response->headers->set(
                'Content-Security-Policy',
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            );
        }

        // Apply HSTS only when request is served via HTTPS.
        if ($request->isSecure()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
        }

        // Authenticated API payloads can contain tenant or profile data, so avoid
        // browser/proxy reuse even for read-only endpoints like /api/auth/me.
        if ($isApiResponse && $request->user()) {
            $response->headers->set('Cache-Control', 'no-store, private');
            $response->headers->set('Pragma', 'no-cache');
            $response->headers->set('Expires', '0');
        }

        return $response;
    }
}
