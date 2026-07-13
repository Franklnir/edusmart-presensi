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
}
