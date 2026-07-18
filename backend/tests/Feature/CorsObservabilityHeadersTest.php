<?php

namespace Tests\Feature;

use Tests\TestCase;

class CorsObservabilityHeadersTest extends TestCase
{
    public function test_preflight_allows_frontend_observability_and_idempotency_headers(): void
    {
        $response = $this->call('OPTIONS', '/api/v2/academic-context', [], [], [], [
            'HTTP_ORIGIN' => 'http://localhost:5173',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => implode(', ', [
                'x-request-id',
                'x-correlation-id',
                'x-frontend-route',
                'x-client-consumer',
                'x-admin-feature',
                'idempotency-key',
                'x-academic-correction-session',
            ]),
        ]);

        $response->assertNoContent();
        $response->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173');

        $allowedHeaders = strtolower((string) $response->headers->get('Access-Control-Allow-Headers'));
        foreach ([
            'x-request-id',
            'x-correlation-id',
            'x-frontend-route',
            'x-client-consumer',
            'x-admin-feature',
            'idempotency-key',
            'x-academic-correction-session',
        ] as $header) {
            $this->assertStringContainsString($header, $allowedHeaders);
        }
    }
}
