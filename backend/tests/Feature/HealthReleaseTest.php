<?php

namespace Tests\Feature;

use Tests\TestCase;

class HealthReleaseTest extends TestCase
{
    public function test_health_exposes_only_safe_release_metadata(): void
    {
        config(['app.release_sha' => '9adf23a0-test']);

        $this->getJson('/api/health')
            ->assertOk()
            ->assertExactJson([
                'status' => 'ok',
                'release_sha' => '9adf23a0-test',
            ]);
    }

    public function test_readiness_exposes_safe_dependency_status_only(): void
    {
        config(['app.release_sha' => '9adf23a0-test']);

        $response = $this->getJson('/api/ready');

        $this->assertContains($response->status(), [200, 503]);
        $response->assertJsonStructure([
            'status',
            'release_sha',
            'environment',
            'checks' => [
                'database' => ['ok', 'status'],
                'redis' => ['ok', 'status'],
                'queue' => ['ok', 'driver'],
                'storage' => ['ok', 'provider'],
            ],
        ])->assertJsonPath('release_sha', '9adf23a0-test');

        $this->assertStringNotContainsString('password', strtolower($response->getContent()));
        $this->assertStringNotContainsString('host', strtolower($response->getContent()));
    }
}
