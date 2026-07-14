<?php

namespace App\Http\Middleware;

use App\Services\Db\DbProxyUsageTelemetry;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class TrackDbProxyUsage
{
    public function __construct(private readonly DbProxyUsageTelemetry $telemetry) {}

    public function handle(Request $request, Closure $next): Response
    {
        $startedAt = hrtime(true);

        try {
            $response = $next($request);
            $this->telemetry->record($request, $response->getStatusCode(), $startedAt);

            return $response;
        } catch (Throwable $exception) {
            $this->telemetry->record($request, 500, $startedAt);

            throw $exception;
        }
    }
}
