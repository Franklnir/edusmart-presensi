<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class ApiDocumentationRouteCoverageTest extends TestCase
{
    public function test_api_endpoint_catalog_matches_registered_application_routes(): void
    {
        $documented = $this->documentedRoutes();
        $registered = $this->registeredApplicationApiRoutes();

        $this->assertSame(
            [],
            array_values(array_diff($registered, $documented)),
            'Route API aktif berikut belum masuk docs/api-endpoints.md'
        );

        $this->assertSame(
            [],
            array_values(array_diff($documented, $registered)),
            'Route berikut terdokumentasi tetapi tidak aktif di Laravel route list'
        );
    }

    private function documentedRoutes(): array
    {
        $path = dirname(base_path()).'/docs/api-endpoints.md';
        $this->assertFileExists($path);

        preg_match_all('/\| `(GET|POST|PUT|PATCH|DELETE)` \| `(\/api\/[^`]+)` \|/', file_get_contents($path), $matches, PREG_SET_ORDER);

        return $this->sortRoutes(array_map(
            fn (array $match) => $match[1].' '.$match[2],
            $matches
        ));
    }

    private function registeredApplicationApiRoutes(): array
    {
        $routes = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (! str_starts_with($uri, 'api/')) {
                continue;
            }

            foreach ($route->methods() as $method) {
                if (! in_array($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true)) {
                    continue;
                }

                $routes[] = $method.' /'.$uri;
            }
        }

        return $this->sortRoutes($routes);
    }

    private function sortRoutes(array $routes): array
    {
        $routes = array_values(array_unique($routes));
        sort($routes);

        return $routes;
    }
}
