<?php

namespace Tests\Unit\Services;

use App\Services\IdempotencyService;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class IdempotencyServiceTest extends TestCase
{
    private IdempotencyService $service;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'cache.default' => 'array',
            'api_v2.idempotency.ttl_seconds' => 60,
            'api_v2.idempotency.lock_seconds' => 5,
        ]);
        Cache::clear();
        $this->service = app(IdempotencyService::class);
    }

    public function test_same_key_and_canonical_payload_replays_response(): void
    {
        $executions = 0;
        $first = $this->request(['b' => 2, 'a' => 1]);
        $second = $this->request(['a' => 1, 'b' => 2]);

        $firstResponse = $this->service->handle($first, 'same-key', function () use (&$executions) {
            $executions++;

            return response()->json(['ok' => true], 201);
        });
        $secondResponse = $this->service->handle($second, 'same-key', function () use (&$executions) {
            $executions++;

            return response()->json(['ok' => false], 201);
        });

        $this->assertSame(201, $firstResponse->getStatusCode());
        $this->assertSame(201, $secondResponse->getStatusCode());
        $this->assertSame('true', $secondResponse->headers->get('Idempotency-Replayed'));
        $this->assertSame(1, $executions);
    }

    public function test_same_key_and_different_payload_conflicts(): void
    {
        $this->service->handle($this->request(['value' => 1]), 'same-key', fn () => response()->json(['ok' => true], 201));

        $response = $this->service->handle(
            $this->request(['value' => 2]),
            'same-key',
            fn () => response()->json(['ok' => false], 201)
        );

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame('IDEMPOTENCY_CONFLICT', $response->getData(true)['code']);
    }

    public function test_tenant_actor_and_route_are_isolated(): void
    {
        $executions = 0;
        $requests = [
            $this->request(['value' => 1], 'tenant-a', 'actor-a', 'records.store'),
            $this->request(['value' => 1], 'tenant-b', 'actor-a', 'records.store'),
            $this->request(['value' => 1], 'tenant-a', 'actor-b', 'records.store'),
            $this->request(['value' => 1], 'tenant-a', 'actor-a', 'other.store'),
        ];

        foreach ($requests as $request) {
            $this->service->handle($request, 'shared-key', function () use (&$executions) {
                $executions++;

                return response()->json(['ok' => true], 201);
            });
        }

        $this->assertSame(4, $executions);
    }

    public function test_same_route_and_key_are_isolated_by_normalized_resource_parameter(): void
    {
        $executions = 0;

        foreach (['record-a', 'record-b'] as $recordId) {
            $response = $this->service->handle(
                $this->request(['value' => 1], resourceId: $recordId),
                'shared-resource-key',
                function () use (&$executions, $recordId) {
                    $executions++;

                    return response()->json(['record' => $recordId], 200);
                }
            );

            $this->assertSame($recordId, $response->getData(true)['record']);
        }

        $this->assertSame(2, $executions);
    }

    public function test_query_parameters_that_change_operation_are_part_of_payload_hash(): void
    {
        $this->service->handle(
            $this->request(['value' => 1], query: ['mode' => 'draft']),
            'query-key',
            fn () => response()->json(['ok' => true], 202)
        );

        $response = $this->service->handle(
            $this->request(['value' => 1], query: ['mode' => 'publish']),
            'query-key',
            fn () => response()->json(['ok' => false], 202)
        );

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame('IDEMPOTENCY_CONFLICT', $response->getData(true)['code']);
    }

    public function test_successful_json_responses_replay_for_relevant_status_codes(): void
    {
        foreach ([200, 201, 202, 204] as $status) {
            $executions = 0;
            $key = "status-{$status}";
            $callback = function () use (&$executions, $status) {
                $executions++;

                return response()->json($status === 204 ? null : ['status' => $status], $status);
            };

            $first = $this->service->handle($this->request(['status' => $status]), $key, $callback);
            $replay = $this->service->handle($this->request(['status' => $status]), $key, $callback);

            $this->assertSame($status, $first->getStatusCode());
            $this->assertSame($status, $replay->getStatusCode());
            $this->assertSame('true', $replay->headers->get('Idempotency-Replayed'));
            $this->assertSame(1, $executions);
        }
    }

    public function test_server_error_is_not_cached(): void
    {
        $executions = 0;
        foreach ([1, 2] as $attempt) {
            $response = $this->service->handle($this->request(['attempt' => 'same']), 'failure-key', function () use (&$executions) {
                $executions++;

                return response()->json(['ok' => false], 500);
            });
            $this->assertSame(500, $response->getStatusCode(), "Attempt {$attempt} should remain a failure.");
        }

        $this->assertSame(2, $executions);
    }

    public function test_only_allowlisted_response_headers_are_replayed(): void
    {
        $request = $this->request(['value' => 1]);
        $this->service->handle($request, 'header-key', fn () => response()
            ->json(['ok' => true], 201)
            ->header('Location', '/api/v2/records/1')
            ->header('Authorization', 'Bearer must-not-be-cached')
            ->header('Set-Cookie', 'secret=value'));

        $replayed = $this->service->handle(
            $this->request(['value' => 1]),
            'header-key',
            fn () => response()->json(['ok' => false], 500)
        );

        $this->assertSame('/api/v2/records/1', $replayed->headers->get('Location'));
        $this->assertFalse($replayed->headers->has('Authorization'));
        $this->assertFalse($replayed->headers->has('Set-Cookie'));
    }

    public function test_active_lock_returns_structured_conflict(): void
    {
        $request = $this->request(['value' => 1]);
        $lock = Cache::lock($this->service->lockKeyFor($request, 'locked-key'), 5);
        $this->assertTrue($lock->get());

        try {
            $response = $this->service->handle(
                $request,
                'locked-key',
                fn () => response()->json(['ok' => true], 201)
            );
        } finally {
            $lock->release();
        }

        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame('IDEMPOTENCY_PROCESSING', $response->getData(true)['code']);
    }

    public function test_expired_lock_can_be_safely_acquired_by_a_new_owner(): void
    {
        $request = $this->request(['value' => 1]);
        $oldLock = Cache::lock($this->service->lockKeyFor($request, 'expired-lock-key'), 5, 'old-owner');
        $this->assertTrue($oldLock->get());

        $this->travel(6)->seconds();

        $response = $this->service->handle(
            $request,
            'expired-lock-key',
            fn () => response()->json(['ok' => true], 201)
        );

        $this->assertSame(201, $response->getStatusCode());
        $this->assertFalse($oldLock->release());
    }

    public function test_unavailable_cache_fails_closed_before_callback_runs(): void
    {
        $executions = 0;
        Cache::shouldReceive('lock')->once()->andThrow(new RuntimeException('cache offline'));

        $response = $this->service->handle(
            $this->request(['value' => 1]),
            'cache-offline-key',
            function () use (&$executions) {
                $executions++;

                return response()->json(['ok' => true], 201);
            }
        );

        $this->assertSame(503, $response->getStatusCode());
        $this->assertSame('IDEMPOTENCY_UNAVAILABLE', $response->getData(true)['code']);
        $this->assertSame(0, $executions);
    }

    public function test_commit_success_is_preserved_when_replay_cache_write_fails(): void
    {
        $executions = 0;
        $lock = Mockery::mock();
        $lock->shouldReceive('get')->once()->andReturnTrue();
        $lock->shouldReceive('release')->once()->andReturnTrue();

        Cache::shouldReceive('lock')->once()->andReturn($lock);
        Cache::shouldReceive('get')->once()->andReturnNull();
        Cache::shouldReceive('put')->once()->andThrow(new RuntimeException('cache write failed'));

        $response = $this->service->handle(
            $this->request(['value' => 1]),
            'write-failure-key',
            function () use (&$executions) {
                $executions++;

                return response()->json(['committed' => true], 201);
            }
        );

        $this->assertSame(201, $response->getStatusCode());
        $this->assertTrue($response->getData(true)['committed']);
        $this->assertSame(1, $executions);
    }

    public function test_response_inside_rolled_back_outer_transaction_is_not_cached(): void
    {
        $executions = 0;

        try {
            DB::transaction(function () use (&$executions) {
                $this->service->handle(
                    $this->request(['value' => 1]),
                    'rollback-key',
                    function () use (&$executions) {
                        $executions++;

                        return response()->json(['ok' => true], 201);
                    }
                );

                throw new RuntimeException('rollback');
            });
        } catch (RuntimeException $exception) {
            $this->assertSame('rollback', $exception->getMessage());
        }

        $response = $this->service->handle(
            $this->request(['value' => 1]),
            'rollback-key',
            function () use (&$executions) {
                $executions++;

                return response()->json(['ok' => true], 201);
            }
        );

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame(2, $executions);
    }

    public function test_header_key_takes_precedence_and_missing_key_is_rejected(): void
    {
        $request = $this->request(['value' => 1]);
        $request->headers->set('Idempotency-Key', 'header-key');
        $executions = 0;

        $this->service->handle($request, 'body-key', function () use (&$executions) {
            $executions++;

            return response()->json(['ok' => true], 201);
        });
        $this->service->handle($this->request(['value' => 1]), 'header-key', function () use (&$executions) {
            $executions++;

            return response()->json(['ok' => true], 201);
        });

        $missing = $this->service->handle(
            $this->request(['value' => 1]),
            null,
            fn () => response()->json(['ok' => true], 201)
        );

        $this->assertSame(1, $executions);
        $this->assertSame(422, $missing->getStatusCode());
        $this->assertSame('IDEMPOTENCY_KEY_REQUIRED', $missing->getData(true)['code']);
    }

    public function test_cached_response_expires_at_configured_ttl(): void
    {
        $executions = 0;
        $callback = function () use (&$executions) {
            $executions++;

            return response()->json(['execution' => $executions], 201);
        };

        $this->service->handle($this->request(['value' => 1]), 'ttl-key', $callback);
        $this->travel(61)->seconds();
        $response = $this->service->handle($this->request(['value' => 1]), 'ttl-key', $callback);

        $this->assertSame(2, $executions);
        $this->assertSame(2, $response->getData(true)['execution']);
        $this->assertFalse($response->headers->has('Idempotency-Replayed'));
    }

    private function request(
        array $payload,
        string $tenant = 'tenant-a',
        string $actor = 'actor-a',
        string $routeName = 'records.store',
        ?string $resourceId = null,
        array $query = []
    ): Request {
        $path = '/api/v2/records'.($resourceId === null ? '' : "/{$resourceId}");
        if ($query !== []) {
            $path .= '?'.http_build_query($query);
        }

        $request = Request::create($path, 'POST', $payload);
        $request->attributes->set('tenant_id', $tenant);
        $request->setUserResolver(fn () => (object) ['id' => $actor]);

        $route = new Route(
            ['POST'],
            $resourceId === null ? 'api/v2/records' : 'api/v2/records/{record}',
            fn () => null
        );
        $route->name($routeName);
        $route->bind($request);
        $request->setRouteResolver(fn () => $route);

        return $request;
    }
}
