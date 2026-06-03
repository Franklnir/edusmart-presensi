<?php

return [
    'content_cache_enabled' => filter_var(env('QUIZ_CONTENT_CACHE_ENABLED', true), FILTER_VALIDATE_BOOL),
    'content_cache_ttl_seconds' => max(30, (int) env('QUIZ_CONTENT_CACHE_TTL_SECONDS', 300)),
    'async_scoring_enabled' => filter_var(env('QUIZ_ASYNC_SCORING_ENABLED', false), FILTER_VALIDATE_BOOL),
    'scoring_queue' => trim((string) env('QUIZ_SCORING_QUEUE', 'quiz-scoring')) ?: 'quiz-scoring',
    'worker_heartbeat_cache_key' => 'quiz-worker:last-heartbeat',
    'worker_heartbeat_max_age_seconds' => max(30, (int) env('QUIZ_WORKER_HEARTBEAT_MAX_AGE_SECONDS', 150)),
    'monitor_warning_queue_size' => max(1, (int) env('QUIZ_MONITOR_WARNING_QUEUE_SIZE', 100)),
    'monitor_critical_queue_size' => max(1, (int) env('QUIZ_MONITOR_CRITICAL_QUEUE_SIZE', 500)),
];
