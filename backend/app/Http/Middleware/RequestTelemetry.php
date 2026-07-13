<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

class RequestTelemetry
{
    public function handle(Request $request, Closure $next): Response
    {
        $startedAt = hrtime(true);
        $requestId = trim((string) $request->headers->get('X-Request-ID', ''));
        if ($requestId === '' || ! preg_match('/^[a-zA-Z0-9._:-]{8,128}$/', $requestId)) {
            $requestId = (string) Str::uuid();
        }

        $request->attributes->set('request_id', $requestId);
        Log::withContext(['request_id' => $requestId]);

        $response = $next($request);
        $durationMs = max(0, (hrtime(true) - $startedAt) / 1_000_000);
        $timing = 'app;dur='.number_format($durationMs, 1, '.', '');
        $existingTiming = trim((string) $response->headers->get('Server-Timing', ''));

        $response->headers->set('X-Request-ID', $requestId);
        $response->headers->set('Server-Timing', $existingTiming !== '' ? $existingTiming.', '.$timing : $timing);

        return $response;
    }
}
