<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class RequestIdE2ETest extends TestCase
{
    public function test_api_returns_request_id_header_and_body_on_error()
    {
        $response = $this->getJson('/api/db');
        
        $response->assertStatus(401);
        $response->assertHeader('X-Request-ID');
        $this->assertNotEmpty($response->headers->get('X-Request-ID'));
        $response->assertJsonStructure(['request_id']);
        $this->assertEquals($response->headers->get('X-Request-ID'), $response->json('request_id'));
    }

    public function test_api_respects_client_provided_request_id()
    {
        $clientId = (string) Str::uuid();
        
        $response = $this->getJson('/api/db', [
            'X-Request-ID' => $clientId
        ]);
        
        $response->assertStatus(401);
        $response->assertHeader('X-Request-ID', $clientId);
        $response->assertJsonPath('request_id', $clientId);
    }
}
