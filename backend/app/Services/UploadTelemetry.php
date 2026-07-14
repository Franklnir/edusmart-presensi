<?php

namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

class UploadTelemetry
{
    /**
     * Record an allowlisted upload event without storage locations, signed URLs,
     * credentials, authorization headers, or object content.
     *
     * @param  array<string, mixed>  $context
     */
    public function record(
        Request $request,
        string $operation,
        string $outcome,
        int $startedAt,
        array $context = []
    ): void {
        $allowed = array_intersect_key($context, array_flip([
            'upload_session_id',
            'attachment_id',
            'purpose',
            'provider',
            'status_transition',
            'size',
            'failure_code',
        ]));

        $payload = array_merge([
            'request_id' => $request->attributes->get('request_id')
                ?: $request->header('X-Request-ID'),
            'tenant_id' => $request->attributes->get('tenant_id'),
            'actor_id' => $request->user()?->id,
            'operation' => $operation,
            'outcome' => $outcome,
            'duration_ms' => round(max(0, hrtime(true) - $startedAt) / 1_000_000, 2),
        ], $allowed);

        try {
            Log::log(
                $outcome === 'failed' ? 'warning' : 'info',
                'api_v2_upload_operation',
                array_filter($payload, static fn (mixed $value): bool => $value !== null && $value !== '')
            );
        } catch (Throwable) {
            // Telemetry must never turn a completed storage side effect into an API failure.
        }
    }
}
