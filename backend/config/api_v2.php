<?php

return [
    'uploads_enabled' => filter_var(env('API_V2_UPLOADS_ENABLED', false), FILTER_VALIDATE_BOOL),

    'idempotency' => [
        'ttl_seconds' => max(60, (int) env('API_V2_IDEMPOTENCY_TTL_SECONDS', 86400)),
        'lock_seconds' => max(5, (int) env('API_V2_IDEMPOTENCY_LOCK_SECONDS', 15)),
    ],
];
