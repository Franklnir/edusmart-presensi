<?php

return [
    'queue' => trim((string) env('BACKUP_QUEUE', 'backup')) ?: 'backup',
    'job_status_ttl_hours' => max(1, (int) env('BACKUP_JOB_STATUS_TTL_HOURS', 24)),
    'job_timeout_seconds' => max(120, (int) env('BACKUP_JOB_TIMEOUT_SECONDS', 900)),
    'monthly_status_cache_ttl_seconds' => max(5, (int) env('BACKUP_MONTHLY_STATUS_CACHE_TTL_SECONDS', 60)),
    'monthly_auto_start_time' => env('BACKUP_MONTHLY_AUTO_START_TIME', '23:15'),
    'monthly_auto_tenant_spacing_minutes' => max(1, (int) env('BACKUP_MONTHLY_AUTO_TENANT_SPACING_MINUTES', 4)),
    'monthly_active_job_lock_minutes' => max(5, (int) env('BACKUP_MONTHLY_ACTIVE_JOB_LOCK_MINUTES', 45)),
];
