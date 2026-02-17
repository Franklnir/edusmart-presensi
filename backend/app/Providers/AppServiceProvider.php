<?php

namespace App\Providers;

use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\URL;

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

        RateLimiter::for('auth', function (Request $request) {
            $tenantId = (string) ($request->attributes->get('tenant_id') ?? 'global');
            $identifier = strtolower(trim((string) (
                $request->input('email')
                ?? $request->input('nis')
                ?? $request->ip()
            )));
            $idHash = sha1($identifier);
            $perIdPerMinute = max(6, (int) env('AUTH_RATE_LIMIT_PER_MINUTE', 12));
            $perIpPerMinute = max(60, (int) env('AUTH_IP_RATE_LIMIT_PER_MINUTE', 90));

            return [
                Limit::perMinute($perIdPerMinute)->by("auth-id|{$tenantId}|{$request->ip()}|{$idHash}"),
                Limit::perMinute($perIpPerMinute)->by('auth-ip|' . $request->ip()),
            ];
        });

        RateLimiter::for('api', function (Request $request) {
            $key = $request->user()?->id ?: $request->ip();
            $perMinute = max(180, (int) env('API_RATE_LIMIT_PER_MINUTE', 300));
            return Limit::perMinute($perMinute)->by('api|' . $key);
        });

        RateLimiter::for('db', function (Request $request) {
            $tenantId = (string) ($request->attributes->get('tenant_id') ?? 'global');
            $userId = $request->user()?->id;

            if ($userId) {
                $perMinute = max(240, (int) env('DB_RATE_LIMIT_PER_MINUTE', 1200));
                return Limit::perMinute($perMinute)->by("db|auth|{$tenantId}|{$userId}");
            }

            $guestPerMinute = max(120, (int) env('DB_GUEST_RATE_LIMIT_PER_MINUTE', 360));
            return Limit::perMinute($guestPerMinute)->by('db|guest|' . $tenantId . '|' . $request->ip());
        });

        RateLimiter::for('super', function (Request $request) {
            $key = $request->user()?->id ?: $request->ip();
            return Limit::perMinute(30)->by('super|' . $key);
        });
    }
}
