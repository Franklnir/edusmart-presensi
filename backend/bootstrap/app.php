<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->redirectGuestsTo(function (Request $request) {
            if ($request->is('api/*') || $request->expectsJson()) {
                return null;
            }
            return '/login';
        });

        $middleware->alias([
            'super.domain' => \App\Http\Middleware\EnsureSuperAdminDomain::class,
        ]);

        $middleware->trustProxies(at: '*');
        $middleware->append(\Illuminate\Http\Middleware\HandleCors::class);
        $middleware->append(\App\Http\Middleware\SecureHeaders::class);
        $middleware->api(append: [
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
            \App\Http\Middleware\ResolveTenant::class,
            \App\Http\Middleware\EnsureTenantMatchesProfile::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Force API endpoints to always return JSON errors (no redirect to web login route).
        $exceptions->shouldRenderJsonWhen(function (Request $request, \Throwable $e): bool {
            return $request->is('api/*') || $request->expectsJson();
        });
    })->create();
