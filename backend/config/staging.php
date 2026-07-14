<?php

return [
    'isolation_acknowledged' => filter_var(env('STAGING_ISOLATION_ACK', false), FILTER_VALIDATE_BOOL),
    'frontend_host' => env('STAGING_EXPECTED_FRONTEND_HOST'),
    'backend_host' => env('STAGING_EXPECTED_BACKEND_HOST'),
    'storage_host' => env('STAGING_EXPECTED_STORAGE_HOST'),
    'database' => env('STAGING_EXPECTED_DATABASE'),
    'redis_prefix' => env('STAGING_EXPECTED_REDIS_PREFIX', 'edusmart:staging:'),
    'storage_bucket' => env('STAGING_EXPECTED_STORAGE_BUCKET'),
    'test_password' => env('STAGING_TEST_PASSWORD'),
];
