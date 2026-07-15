<?php

return [
    'slow_request_threshold_ms' => max(100, (int) env('API_SLOW_REQUEST_THRESHOLD_MS', 1000)),
    'structured_channel' => env('OBSERVABILITY_LOG_CHANNEL', 'structured'),
    'legacy_guard_path' => base_path('config/api-legacy-consumers.json'),
    'frontend_log_retention_days' => max(7, (int) env('FRONTEND_LOG_RETENTION_DAYS', 30)),
];
