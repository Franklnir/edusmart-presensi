<?php

use App\Http\Middleware\BlockSuspiciousRequests;
use App\Http\Middleware\DenyRootDomainAuthAccess;
use App\Http\Middleware\EnsureSuperAdminAccess;
use App\Http\Middleware\EnsureSuperAdminDomain;
use App\Http\Middleware\EnsureTenantMatchesProfile;
use App\Http\Middleware\ResolveTenant;
use App\Http\Middleware\SecureHeaders;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\HandleCors;
use Illuminate\Http\Request;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withCommands([
        __DIR__.'/../app/Console/Commands',
    ])
    ->withMiddleware(function (Middleware $middleware): void {
        $trustedProxies = trim((string) env('TRUSTED_PROXIES', ''));
        $isProduction = strtolower(trim((string) env('APP_ENV', 'production'))) === 'production';
        if (($trustedProxies === '' || $trustedProxies === '*') && $isProduction) {
            $trustedProxies = [
                '127.0.0.1/32',
                '10.0.0.0/8',
                '172.16.0.0/12',
                '192.168.0.0/16',
            ];
        } elseif ($trustedProxies !== '*' && $trustedProxies !== '') {
            $trustedProxies = array_values(array_filter(array_map('trim', explode(',', $trustedProxies))));
        } else {
            $trustedProxies = '*';
        }

        $middleware->redirectGuestsTo(function (Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return null;
            }

            return '/login';
        });

        $middleware->alias([
            'auth.not_root_domain' => DenyRootDomainAuthAccess::class,
            'super.admin' => EnsureSuperAdminAccess::class,
            'super.domain' => EnsureSuperAdminDomain::class,
        ]);

        $middleware->trustProxies(
            at: $trustedProxies,
            headers: Request::HEADER_X_FORWARDED_FOR
                | Request::HEADER_X_FORWARDED_HOST
                | Request::HEADER_X_FORWARDED_PORT
                | Request::HEADER_X_FORWARDED_PROTO
        );
        $middleware->append(HandleCors::class);
        $middleware->append(SecureHeaders::class);
        $middleware->append(BlockSuspiciousRequests::class);
        $middleware->api(append: [
            EnsureFrontendRequestsAreStateful::class,
            ResolveTenant::class,
            EnsureTenantMatchesProfile::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Force API endpoints to always return JSON errors (no redirect to web login route).
        $exceptions->shouldRenderJsonWhen(function (Request $request, Throwable $e): bool {
            return $request->is('api/*') || $request->expectsJson();
        });
    })->create();
