<?php

$isProduction = strtolower((string) env('APP_ENV', 'production')) === 'production';
$defaultOrigins = $isProduction
    ? ''
    : 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://127.0.0.1.nip.io:5173,http://admin26.127.0.0.1.nip.io:5173';
$defaultPatterns = $isProduction
    ? ''
    : '#^https?://([a-z0-9-]+\\.)?localhost(:\\d+)?$#,#^https?://127\\.0\\.0\\.1(:\\d+)?$#,#^https?://([a-z0-9-]+\\.)?127\\.0\\.0\\.1\\.nip\\.io(:\\d+)?$#';

$parseCsv = static fn (string $value): array => array_values(array_unique(array_filter(array_map('trim', explode(',', $value)))));
$mergeLocalDefaults = static fn (string $envValue, string $defaultValue): array => $isProduction
    ? $parseCsv($envValue)
    : array_values(array_unique(array_merge($parseCsv($envValue), $parseCsv($defaultValue))));

$rootDomain = trim(strtolower((string) env('TENANT_ROOT_DOMAIN', '')), '.');
$productionRootPattern = '';
if ($isProduction && $rootDomain !== '') {
    $productionRootPattern = '#^https://([a-z0-9-]+\\.)?'.preg_quote($rootDomain, '#').'$#';
}

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => $mergeLocalDefaults((string) env('CORS_ALLOWED_ORIGINS', ''), $defaultOrigins),
    'allowed_origins_patterns' => array_values(array_unique(array_filter(array_merge(
        $mergeLocalDefaults((string) env('CORS_ALLOWED_ORIGIN_PATTERNS', ''), $defaultPatterns),
        $productionRootPattern !== '' ? [$productionRootPattern] : []
    )))),
    'allowed_headers' => [
        'Accept',
        'Authorization',
        'Content-Type',
        'Origin',
        'X-Requested-With',
        'X-Tenant',
        'X-CSRF-TOKEN',
        'X-XSRF-TOKEN',
        'X-Request-ID',
        'X-Correlation-ID',
        'X-Frontend-Route',
        'X-Client-Consumer',
        'X-Admin-Feature',
        'Idempotency-Key',
        'X-Academic-Correction-Session',
    ],
    'exposed_headers' => ['X-Request-ID', 'X-Correlation-ID'],
    'max_age' => 3600,
    'supports_credentials' => true,
];
