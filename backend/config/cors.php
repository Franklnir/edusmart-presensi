<?php

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => explode(',', env('CORS_ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000')),
    'allowed_origins_patterns' => array_values(array_filter(array_map('trim', array_merge(
        explode(',', env('CORS_ALLOWED_ORIGIN_PATTERNS', '')),
        [
            '#^https?://([a-z0-9-]+\\.)?localhost(:\\d+)?$#',
            '#^https?://127\\.0\\.0\\.1(:\\d+)?$#',
        ],
    )))),
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => true,
];
