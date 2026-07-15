<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class RequestIdE2ETest extends TestCase
{
    use RefreshDatabase;

    public function test_api_returns_request_id_header_and_body_on_error()
    {
        $response = $this->getJson('/api/auth/me');

        $response->assertStatus(401);
        $response->assertHeader('X-Request-ID');
        $this->assertNotEmpty($response->headers->get('X-Request-ID'));
        $response->assertJsonStructure(['success', 'code', 'message', 'details', 'request_id']);
        $this->assertSame($response->headers->get('X-Request-ID'), $response->json('request_id'));
    }

    public function test_api_respects_client_provided_request_id()
    {
        $clientId = (string) Str::uuid();

        $response = $this->getJson('/api/auth/me', [
            'X-Request-ID' => $clientId,
        ]);

        $response->assertStatus(401);
        $response->assertHeader('X-Request-ID', $clientId);
    }

    public function test_invalid_client_request_id_is_replaced_with_a_uuid(): void
    {
        $response = $this->getJson('/api/auth/me', [
            'X-Request-ID' => 'client-controlled-value',
        ]);

        $requestId = (string) $response->headers->get('X-Request-ID');
        $this->assertNotSame('client-controlled-value', $requestId);
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
            $requestId
        );
    }
}
