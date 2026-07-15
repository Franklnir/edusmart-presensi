<?php

namespace Tests\Feature\Api\V2;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class LegacyDbRouteRemovalTest extends TestCase
{
    public function test_legacy_database_proxy_routes_remain_registered_for_hybrid_consumers(): void
    {
        $uris = collect(Route::getRoutes())
            ->map(static fn ($route): string => ltrim($route->uri(), '/'))
            ->values();

        $this->assertTrue($uris->contains('api/db'));
        $this->assertTrue($uris->contains('api/db/batch'));
    }
}
