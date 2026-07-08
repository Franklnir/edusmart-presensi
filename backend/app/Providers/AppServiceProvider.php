<?php

namespace App\Providers;

use App\Support\Tenancy\TenantDomainService;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password as PasswordRule;

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

        $frontendUrl = $this->safeFrontendBaseUrl();
        $passwordMinLength = max(12, (int) env('PASSWORD_MIN_LENGTH', 12));

        PasswordRule::defaults(static fn () => PasswordRule::min($passwordMinLength)
            ->letters()
            ->mixedCase()
            ->numbers()
            ->symbols());

        ResetPassword::createUrlUsing(function (object $user, string $token) use ($frontendUrl): string {
            $tenantFrontendUrl = $this->tenantFrontendBaseUrlForUser($user, $frontendUrl);
            $email = urlencode((string) ($user->email ?? ''));

            return "{$tenantFrontendUrl}/reset-password?token={$token}&email={$email}";
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

        RateLimiter::for('rfid', function (Request $request) use ($clampInt) {
            $tenant = strtolower(trim((string) (
                $request->input('tenant_slug')
                ?? $request->query('tenant_slug')
                ?? $request->header(config('tenancy.header', 'X-Tenant'), 'global')
            )));
            $device = strtolower(trim((string) (
                $request->header('X-RFID-Device')
                ?: $request->input('device_id')
                ?: $request->ip()
            )));
            $perMinute = $clampInt('RFID_RATE_LIMIT_PER_MINUTE', 1200, 30, 5000);

            return Limit::perMinute($perMinute)->by('rfid|'.$tenant.'|'.$device.'|'.$request->ip());
        });

        RateLimiter::for('browser-nfc', function (Request $request) use ($clampInt) {
            $tenantId = (string) ($request->attributes->get('tenant_id') ?? 'global');
            $userId = (string) ($request->user()?->id ?: 'guest');
            $perUserPerMinute = $clampInt('BROWSER_NFC_RATE_LIMIT_PER_MINUTE', 180, 30, 600);

            return [
                Limit::perMinute($perUserPerMinute)->by("browser-nfc|{$tenantId}|{$userId}"),
                Limit::perMinute(max($perUserPerMinute * 4, 240))->by("browser-nfc-ip|{$tenantId}|{$request->ip()}"),
            ];
        });

        RateLimiter::for('webhook', function (Request $request) use ($clampInt) {
            $perMinute = $clampInt('WEBHOOK_RATE_LIMIT_PER_MINUTE', 60, 10, 600);

            return Limit::perMinute($perMinute)->by('webhook|'.$request->ip());
        });

        RateLimiter::for('public-directory', function (Request $request) use ($clampInt) {
            $perMinute = $clampInt('PUBLIC_DIRECTORY_RATE_LIMIT_PER_MINUTE', 60, 10, 300);

            return Limit::perMinute($perMinute)->by('public-directory|'.$request->ip());
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
                $isWrite = str_contains($path, '/storage/upload')
                    || str_contains($path, '/storage/direct-upload')
                    || str_contains($path, '/storage/confirm-upload')
                    || str_contains($path, '/storage/remove');
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

        RateLimiter::for('quiz-submit', function (Request $request) {
            $key = $request->user()?->id ?: $request->ip();

            return Limit::perMinute(20)->by('quiz-submit|'.$key);
        });

        RateLimiter::for('quiz-answers', function (Request $request) {
            $key = $request->user()?->id ?: $request->ip();

            return Limit::perMinute(120)->by('quiz-answers|'.$key);
        });
    }

    private function safeFrontendBaseUrl(): string
    {
        $candidates = [
            (string) config('app.frontend_url', ''),
            (string) config('app.url', ''),
        ];

        foreach ($candidates as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '') {
                continue;
            }

            $parts = parse_url($candidate);
            if (! is_array($parts)) {
                continue;
            }

            $scheme = strtolower((string) ($parts['scheme'] ?? ''));
            $host = strtolower(trim((string) ($parts['host'] ?? '')));
            if ($host === '' || ! in_array($scheme, ['http', 'https'], true)) {
                continue;
            }

            $port = isset($parts['port']) ? ':'.((int) $parts['port']) : '';
            $path = trim((string) ($parts['path'] ?? ''));
            $path = $path !== '' && $path !== '/' ? '/'.trim($path, '/') : '';

            return rtrim("{$scheme}://{$host}{$port}{$path}", '/');
        }

        return 'http://localhost:5173';
    }

    private function tenantFrontendBaseUrlForUser(object $user, string $fallbackBaseUrl): string
    {
        $tenantIdentity = $this->resolveTenantIdentityForUser($user);
        if ($tenantIdentity['slug'] === '') {
            return $fallbackBaseUrl;
        }

        $parts = parse_url($fallbackBaseUrl);
        if (! is_array($parts)) {
            return $fallbackBaseUrl;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower(trim((string) ($parts['host'] ?? '')));
        if (! in_array($scheme, ['http', 'https'], true) || $host === '') {
            return $fallbackBaseUrl;
        }

        $resolvedHost = app(TenantDomainService::class)->primaryTenantFrontendHost(
            $tenantIdentity['tenant_id'],
            $tenantIdentity['slug'],
            $host
        );
        if ($resolvedHost === '') {
            return $fallbackBaseUrl;
        }

        $port = isset($parts['port']) ? ':'.((int) $parts['port']) : '';
        $path = trim((string) ($parts['path'] ?? ''));
        $path = $path !== '' && $path !== '/' ? '/'.trim($path, '/') : '';

        return rtrim("{$scheme}://{$resolvedHost}{$port}{$path}", '/');
    }

    private function resolveTenantIdentityForUser(object $user): array
    {
        $userId = trim((string) ($user->id ?? ''));
        if ($userId === '') {
            return ['tenant_id' => '', 'slug' => ''];
        }

        try {
            $row = DB::table('profiles as p')
                ->join('tenants as t', 't.id', '=', 'p.tenant_id')
                ->where('p.id', $userId)
                ->first(['p.tenant_id', 't.slug']);
        } catch (\Throwable $e) {
            return ['tenant_id' => '', 'slug' => ''];
        }

        return [
            'tenant_id' => trim((string) ($row->tenant_id ?? '')),
            'slug' => strtolower(trim((string) ($row->slug ?? ''))),
        ];
    }
}
