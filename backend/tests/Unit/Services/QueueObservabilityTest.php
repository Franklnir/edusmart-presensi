<?php

namespace Tests\Unit\Services;

use App\Services\Observability\QueueObservability;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Tests\TestCase;

class QueueObservabilityTest extends TestCase
{
    public function test_queue_correlation_payload_keeps_request_and_correlation_context_without_payload_data(): void
    {
        $requestId = (string) Str::uuid();
        $correlationId = (string) Str::uuid();
        $request = Request::create('/api/v2/reports/teacher-summary', 'GET', [], [], [], [
            'HTTP_X_REQUEST_ID' => $requestId,
            'HTTP_X_CORRELATION_ID' => $correlationId,
        ]);
        $request->attributes->set('request_id', $requestId);
        $request->attributes->set('tenant_id', 'tenant-a');

        $payload = app(QueueObservability::class)->payloadContext($request);

        $this->assertSame($requestId, $payload['observability']['request_id']);
        $this->assertSame($correlationId, $payload['observability']['correlation_id']);
        $this->assertSame('tenant-a', $payload['observability']['tenant_id']);
        $this->assertArrayNotHasKey('body', $payload['observability']);
    }
}
