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
}
