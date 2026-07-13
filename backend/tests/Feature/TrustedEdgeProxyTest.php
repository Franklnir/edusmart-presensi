<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TrustedEdgeProxyTest extends TestCase
{
    use RefreshDatabase;

    public function test_api_is_concealed_when_required_edge_secret_is_missing_or_invalid(): void
    {
        config()->set('tenancy.require_edge_proxy', true);
        config()->set('tenancy.edge_proxy_secret', 'test-edge-secret');

        $this->getJson('/api/health')
            ->assertNotFound()
            ->assertHeader('Cache-Control', 'no-store, private');

        $this->withHeader('X-Sismu-Edge-Secret', 'wrong-secret')
            ->getJson('/api/health')
            ->assertNotFound();
    }

    public function test_api_accepts_matching_edge_secret(): void
    {
        config()->set('tenancy.require_edge_proxy', true);
        config()->set('tenancy.edge_proxy_secret', 'test-edge-secret');

        $this->withHeader('X-Sismu-Edge-Secret', 'test-edge-secret')
            ->getJson('/api/health')
            ->assertOk()
            ->assertHeader('X-Request-ID')
            ->assertHeader('Server-Timing')
            ->assertJsonPath('status', 'ok');
    }

    public function test_edge_requirement_fails_closed_when_secret_is_not_configured(): void
    {
        config()->set('tenancy.require_edge_proxy', true);
        config()->set('tenancy.edge_proxy_secret', '');

        $this->getJson('/api/health')->assertNotFound();
    }
}
