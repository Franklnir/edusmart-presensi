<?php

use Laravel\Sanctum\Sanctum;

$isProduction = strtolower((string) env('APP_ENV', 'production')) === 'production';

$normalizeHost = static function (?string $value): ?string {
    $value = trim((string) $value);
    if ($value === '') {
        return null;
    }

    if (! str_contains($value, '://')) {
        $value = 'https://'.$value;
    }

    $host = parse_url($value, PHP_URL_HOST);
    if (! is_string($host) || trim($host) === '') {
        return null;
    }

    $port = parse_url($value, PHP_URL_PORT);

    return is_int($port) ? $host.':'.$port : $host;
};

$defaultStateful = array_values(array_unique(array_filter([
    $normalizeHost((string) env('FRONTEND_URL', '')),
    $normalizeHost((string) env('APP_URL', '')),
    $normalizeHost((string) Sanctum::currentApplicationUrlWithPort()),
])));

if (! $isProduction) {
    $defaultStateful = array_values(array_unique(array_filter(array_merge($defaultStateful, [
        'localhost',
        'localhost:3000',
        'localhost:5173',
        '127.0.0.1',
        '127.0.0.1:8000',
        '::1',
        '*.localhost',
        '*.localhost:3000',
        '*.localhost:5173',
    ]))));
}

$expandStatefulEntry = static function (?string $value) use ($normalizeHost): array {
    $value = trim((string) $value);
    if ($value === '') {
        return [];
    }

    if (str_contains($value, '://')) {
        $host = $normalizeHost($value);

        return $host ? [$host] : [];
    }

    if (str_starts_with($value, '.')) {
        $base = ltrim($value, '.');

        return $base === '' ? [] : [$base, '*.'.$base];
    }

    if (str_starts_with($value, '*.') && strlen($value) > 2) {
        $base = substr($value, 2);

        return [$base, $value];
    }

    return [$value];
};

$rawStateful = array_map('trim', explode(
    ',',
    (string) env('SANCTUM_STATEFUL_DOMAINS', implode(',', $defaultStateful))
));

$stateful = [];
foreach ($rawStateful as $entry) {
    foreach ($expandStatefulEntry($entry) as $expandedEntry) {
        $stateful[] = $expandedEntry;
    }
}

return [
    'stateful' => array_values(array_unique(array_filter($stateful))),

    'guard' => ['web'],

    'expiration' => null,

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    'middleware' => [
        'authenticate_session' => Laravel\Sanctum\Http\Middleware\AuthenticateSession::class,
        'encrypt_cookies' => Illuminate\Cookie\Middleware\EncryptCookies::class,
        'verify_csrf_token' => Illuminate\Foundation\Http\Middleware\VerifyCsrfToken::class,
    ],
];
