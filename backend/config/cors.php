<?php

$isProduction = strtolower((string) env('APP_ENV', 'production')) === 'production';
$defaultOrigins = $isProduction
    ? ''
    : 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000';
$defaultPatterns = $isProduction
    ? ''
    : '#^https?://([a-z0-9-]+\\.)?localhost(:\\d+)?$#,#^https?://127\\.0\\.0\\.1(:\\d+)?$#';

$parseCsv = static fn (string $value): array => array_values(array_unique(array_filter(array_map('trim', explode(',', $value)))));

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => $parseCsv((string) env('CORS_ALLOWED_ORIGINS', $defaultOrigins)),
    'allowed_origins_patterns' => $parseCsv((string) env('CORS_ALLOWED_ORIGIN_PATTERNS', $defaultPatterns)),
    'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'Origin', 'X-Requested-With', 'X-Tenant', 'X-CSRF-TOKEN', 'X-XSRF-TOKEN'],
    'exposed_headers' => [],
    'max_age' => 3600,
    'supports_credentials' => true,
];
