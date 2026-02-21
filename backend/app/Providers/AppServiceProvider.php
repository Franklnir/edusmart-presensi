<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $clampInt = static fn (string $key, int $default, int $min, int $max): int => max(
            $min,
            min($max, (int) env($key, $default))
        );

        $frontendUrl = rtrim((string) config('app.frontend_url', config('app.url')), '/');

        ResetPassword::createUrlUsing(function (object $user, string $token) use ($frontendUrl): string {
            $email = urlencode((string) ($user->email ?? ''));

            return "{$frontendUrl}/reset-password?token={$token}&email={$email}";
        });

        VerifyEmail::createUrlUsing(function (object $notifiable): string {
            return URL::temporarySignedRoute(
                'verification.verify',
                now()->addMinutes(60),
                [
                    'id' => $notifiable->getKey(),
                    'hash' => sha1((string) $notifiable->getEmailForVerification()),
                ]
            );
        });

        RateLimiter::for('auth', function (Request $request) use ($clampInt) {
            $tenantId = (string) ($request->attributes->get('tenant_id') ?? 'global');
            $identifier = strtolower(trim((string) (
                $request->input('email')
                ?? $request->input('nis')
                ?? $request->ip()
            )));
            $idHash = sha1($identifier);
            $perIdPerMinute = $clampInt('AUTH_RATE_LIMIT_PER_MINUTE', 12, 6, 120);
            $perIpPerMinute = $clampInt('AUTH_IP_RATE_LIMIT_PER_MINUTE', 90, 30, 600);

            return [
                Limit::perMinute($perIdPerMinute)->by("auth-id|{$tenantId}|{$request->ip()}|{$idHash}"),
                Limit::perMinute($perIpPerMinute)->by('auth-ip|'.$request->ip()),
            ];
        });

        RateLimiter::for('api', function (Request $request) use ($clampInt) {
            $key = $request->user()?->id ?: $request->ip();
            $perMinute = $clampInt('API_RATE_LIMIT_PER_MINUTE', 300, 60, 1200);

            return Limit::perMinute($perMinute)->by('api|'.$key);
        });

        RateLimiter::for('db', function (Request $request) use ($clampInt) {
            $tenantId = (string) ($request->attributes->get('tenant_id') ?? 'global');
            $userId = $request->user()?->id;

            if ($userId) {
                $perMinute = $clampInt('DB_RATE_LIMIT_PER_MINUTE', 900, 120, 2400);

                return Limit::perMinute($perMinute)->by("db|auth|{$tenantId}|{$userId}");
            }

            $guestPerMinute = $clampInt('DB_GUEST_RATE_LIMIT_PER_MINUTE', 240, 30, 900);

            return Limit::perMinute($guestPerMinute)->by('db|guest|'.$tenantId.'|'.$request->ip());
        });

        RateLimiter::for('storage', function (Request $request) use ($clampInt) {
            $tenantId = (string) ($request->attributes->get('tenant_id') ?? 'global');
            $userId = $request->user()?->id;

            if ($userId) {
                $writePerMinute = $clampInt('STORAGE_WRITE_RATE_LIMIT_PER_MINUTE', 90, 20, 360);
                $readPerMinute = $clampInt('STORAGE_READ_RATE_LIMIT_PER_MINUTE', 180, 60, 900);
                $bucket = strtolower(trim((string) ($request->input('bucket') ?? $request->query('bucket') ?? '')));
                $path = $request->path();
                $isWrite = str_contains($path, '/storage/upload') || str_contains($path, '/storage/remove');
                $prefix = $isWrite ? 'storage-write' : 'storage-read';
                $rate = $isWrite ? $writePerMinute : $readPerMinute;

                return Limit::perMinute($rate)->by("{$prefix}|{$tenantId}|{$userId}|{$bucket}");
            }

            $guestPerMinute = $clampInt('STORAGE_GUEST_RATE_LIMIT_PER_MINUTE', 60, 10, 180);

            return Limit::perMinute($guestPerMinute)->by('storage-guest|'.$tenantId.'|'.$request->ip());
        });

        RateLimiter::for('super', function (Request $request) {
            $key = $request->user()?->id ?: $request->ip();

            return Limit::perMinute(30)->by('super|'.$key);
        });
    }
}
