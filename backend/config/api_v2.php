<?php

return [
    'uploads_enabled' => filter_var(env('API_V2_UPLOADS_ENABLED', false), FILTER_VALIDATE_BOOL),

    'uploads' => [
        'provider' => env('API_V2_UPLOAD_PROVIDER', 's3-compatible'),
        'logical_bucket' => env('API_V2_UPLOAD_LOGICAL_BUCKET', 'assignments'),
        'session_ttl_minutes' => max(5, min(60, (int) env('API_V2_UPLOAD_SESSION_TTL_MINUTES', 15))),
        'download_ttl_seconds' => max(300, min(900, (int) env('API_V2_ATTACHMENT_DOWNLOAD_TTL_SECONDS', 600))),
        'detached_cleanup_hours' => max(1, (int) env('API_V2_DETACHED_ATTACHMENT_CLEANUP_HOURS', 24)),
    ],

    'idempotency' => [
        'ttl_seconds' => max(60, (int) env('API_V2_IDEMPOTENCY_TTL_SECONDS', 86400)),
        'lock_seconds' => max(5, (int) env('API_V2_IDEMPOTENCY_LOCK_SECONDS', 15)),
        'lock_seconds_by_route' => [
            'uploads.store' => max(5, (int) env('API_V2_IDEMPOTENCY_UPLOAD_LOCK_SECONDS', 60)),
            'uploads.complete' => max(5, (int) env('API_V2_IDEMPOTENCY_UPLOAD_LOCK_SECONDS', 60)),
        ],
    ],
];
