<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'google' => [
        'enabled' => filter_var(env('GOOGLE_AUTH_ENABLED', false), FILTER_VALIDATE_BOOL),
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect_uri' => env('GOOGLE_REDIRECT_URI'),
        'prompt' => env('GOOGLE_AUTH_PROMPT', 'select_account'),
        'drive' => [
            'enabled' => filter_var(env('GOOGLE_DRIVE_ENABLED', env('GOOGLE_AUTH_ENABLED', false)), FILTER_VALIDATE_BOOL),
            'client_id' => env('GOOGLE_DRIVE_CLIENT_ID', env('GOOGLE_CLIENT_ID')),
            'client_secret' => env('GOOGLE_DRIVE_CLIENT_SECRET', env('GOOGLE_CLIENT_SECRET')),
            'redirect_uri' => env('GOOGLE_DRIVE_REDIRECT_URI'),
            'folder_name' => env('GOOGLE_DRIVE_FOLDER_NAME', 'EduSmart Presensi'),
            'share_uploaded_files' => filter_var(env('GOOGLE_DRIVE_SHARE_UPLOADED_FILES', true), FILTER_VALIDATE_BOOL),
            'usage_timezone' => env('GOOGLE_DRIVE_USAGE_TIMEZONE', 'Asia/Jakarta'),
        ],
    ],

    'assignment_object_storage' => [
        'enabled' => filter_var(env('ASSIGNMENT_DIRECT_UPLOAD_ENABLED', false), FILTER_VALIDATE_BOOL),
        'label' => env('ASSIGNMENT_OBJECT_STORAGE_LABEL', 'Object Storage'),
        'key' => env('ASSIGNMENT_OBJECT_STORAGE_ACCESS_KEY_ID', env('AWS_ACCESS_KEY_ID')),
        'secret' => env('ASSIGNMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY', env('AWS_SECRET_ACCESS_KEY')),
        'session_token' => env('ASSIGNMENT_OBJECT_STORAGE_SESSION_TOKEN', env('AWS_SESSION_TOKEN')),
        'region' => env('ASSIGNMENT_OBJECT_STORAGE_REGION', env('AWS_DEFAULT_REGION', 'us-east-1')),
        'bucket' => env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET')),
        'endpoint' => env('ASSIGNMENT_OBJECT_STORAGE_ENDPOINT', env('AWS_ENDPOINT')),
        'use_path_style_endpoint' => filter_var(
            env(
                'ASSIGNMENT_OBJECT_STORAGE_USE_PATH_STYLE_ENDPOINT',
                env('AWS_USE_PATH_STYLE_ENDPOINT', env('AWS_ENDPOINT') ? true : false)
            ),
            FILTER_VALIDATE_BOOL
        ),
        'expires_seconds' => (int) env('ASSIGNMENT_DIRECT_UPLOAD_EXPIRES_SECONDS', 900),
    ],

    'object_storage' => [
        'enabled' => filter_var(
            env('APP_OBJECT_STORAGE_ENABLED') !== null && env('APP_OBJECT_STORAGE_ENABLED') !== ''
                ? env('APP_OBJECT_STORAGE_ENABLED')
                : env('APP_DIRECT_UPLOAD_ENABLED', env('ASSIGNMENT_DIRECT_UPLOAD_ENABLED', false)),
            FILTER_VALIDATE_BOOL
        ),
        'browser_direct_enabled' => filter_var(
            env('APP_DIRECT_UPLOAD_BROWSER_ENABLED') !== null && env('APP_DIRECT_UPLOAD_BROWSER_ENABLED') !== ''
                ? env('APP_DIRECT_UPLOAD_BROWSER_ENABLED')
                : env('APP_DIRECT_UPLOAD_ENABLED', env('ASSIGNMENT_DIRECT_UPLOAD_ENABLED', false)),
            FILTER_VALIDATE_BOOL
        ),
        'label' => env('APP_OBJECT_STORAGE_LABEL', env('ASSIGNMENT_OBJECT_STORAGE_LABEL', 'Object Storage')),
        'key' => env('APP_OBJECT_STORAGE_ACCESS_KEY_ID', env('ASSIGNMENT_OBJECT_STORAGE_ACCESS_KEY_ID', env('AWS_ACCESS_KEY_ID'))),
        'secret' => env('APP_OBJECT_STORAGE_SECRET_ACCESS_KEY', env('ASSIGNMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY', env('AWS_SECRET_ACCESS_KEY'))),
        'session_token' => env('APP_OBJECT_STORAGE_SESSION_TOKEN', env('ASSIGNMENT_OBJECT_STORAGE_SESSION_TOKEN', env('AWS_SESSION_TOKEN'))),
        'region' => env('APP_OBJECT_STORAGE_REGION', env('ASSIGNMENT_OBJECT_STORAGE_REGION', env('AWS_DEFAULT_REGION', 'us-east-1'))),
        'bucket' => env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET'))),
        'bucket_map' => [
            'profile-photos' => env('APP_OBJECT_STORAGE_BUCKET_PROFILE_PHOTOS', env('APP_OBJECT_STORAGE_PROFILE_PHOTOS_BUCKET', env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET', 'profile-photos'))))),
            'assignments' => env('APP_OBJECT_STORAGE_BUCKET_ASSIGNMENTS', env('APP_OBJECT_STORAGE_ASSIGNMENTS_BUCKET', env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET'))))),
            'quiz-media' => env('APP_OBJECT_STORAGE_BUCKET_QUIZ_MEDIA', env('APP_OBJECT_STORAGE_QUIZ_MEDIA_BUCKET', env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET'))))),
            'certificates' => env('APP_OBJECT_STORAGE_BUCKET_CERTIFICATES', env('APP_OBJECT_STORAGE_CERTIFICATES_BUCKET', env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET'))))),
            'sertifikat-files' => env('APP_OBJECT_STORAGE_BUCKET_SERTIFIKAT_FILES', env('APP_OBJECT_STORAGE_SERTIFIKAT_FILES_BUCKET', env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET'))))),
            'certificate-templates' => env('APP_OBJECT_STORAGE_BUCKET_CERTIFICATE_TEMPLATES', env('APP_OBJECT_STORAGE_CERTIFICATE_TEMPLATES_BUCKET', env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET'))))),
            'sertifikat-templates' => env('APP_OBJECT_STORAGE_BUCKET_SERTIFIKAT_TEMPLATES', env('APP_OBJECT_STORAGE_SERTIFIKAT_TEMPLATES_BUCKET', env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET'))))),
        ],
        'endpoint' => env('APP_OBJECT_STORAGE_ENDPOINT', env('ASSIGNMENT_OBJECT_STORAGE_ENDPOINT', env('AWS_ENDPOINT'))),
        'use_path_style_endpoint' => filter_var(
            env(
                'APP_OBJECT_STORAGE_USE_PATH_STYLE_ENDPOINT',
                env(
                    'ASSIGNMENT_OBJECT_STORAGE_USE_PATH_STYLE_ENDPOINT',
                    env('AWS_USE_PATH_STYLE_ENDPOINT', env('AWS_ENDPOINT') ? true : false)
                )
            ),
            FILTER_VALIDATE_BOOL
        ),
        'expires_seconds' => (int) env('APP_DIRECT_UPLOAD_EXPIRES_SECONDS', env('ASSIGNMENT_DIRECT_UPLOAD_EXPIRES_SECONDS', 900)),
        'capacity_bytes' => env('APP_OBJECT_STORAGE_CAPACITY_BYTES'),
        'capacity_gb' => env('APP_OBJECT_STORAGE_CAPACITY_GB'),
        'verify_uploads' => filter_var(env('APP_DIRECT_UPLOAD_VERIFY_OBJECTS', true), FILTER_VALIDATE_BOOL),
        'verify_attempts' => (int) env('APP_DIRECT_UPLOAD_VERIFY_ATTEMPTS', 2),
        'verify_retry_delay_ms' => (int) env('APP_DIRECT_UPLOAD_VERIFY_RETRY_MS', 150),
        'direct_upload_buckets' => array_values(array_filter(array_map(
            'trim',
            explode(
                ',',
                env(
                    'APP_DIRECT_UPLOAD_BUCKETS',
                    env(
                        'ASSIGNMENT_DIRECT_UPLOAD_BUCKETS',
                        'profile-photos,assignments,quiz-media,certificates,sertifikat-files,certificate-templates,sertifikat-templates'
                    )
                )
            )
        ))),
        'inventory_retries' => (int) env('APP_OBJECT_STORAGE_INVENTORY_RETRIES', 1),
    ],

    'evolution_api' => [
        'base_url' => env('EVOLUTION_API_BASE_URL'),
        'api_key' => env('EVOLUTION_API_KEY'),
        'integration' => env('EVOLUTION_API_INTEGRATION', 'WHATSAPP-BAILEYS'),
        'instance_prefix' => env('EVOLUTION_API_INSTANCE_PREFIX', 'edusmart'),
        'public_url' => env('EVOLUTION_PUBLIC_URL'),
        'webhook_base_url' => env('EVOLUTION_API_WEBHOOK_BASE_URL', env('APP_URL')),
        'timeout' => (int) env('EVOLUTION_API_TIMEOUT_SECONDS', 20),
        'verify_ssl' => filter_var(env('EVOLUTION_API_VERIFY_SSL', true), FILTER_VALIDATE_BOOL),
    ],

    'whatsapp' => [
        'provider' => env('WHATSAPP_PROVIDER', 'evolution'),
        'central_enabled' => filter_var(env('WHATSAPP_CENTRAL_ENABLED', true), FILTER_VALIDATE_BOOL),
        'central_tenant_id' => env('WHATSAPP_CENTRAL_TENANT_ID'),
        'central_tenant_slug' => env('WHATSAPP_CENTRAL_TENANT_SLUG'),
        'central_instance_name' => env('WHATSAPP_CENTRAL_INSTANCE_NAME', 'edusmart-admin26'),
        'assignment_missing_lookback_minutes' => (int) env('WHATSAPP_ASSIGNMENT_MISSING_LOOKBACK_MINUTES', 180),
        'assignment_missing_batch_size' => (int) env('WHATSAPP_ASSIGNMENT_MISSING_BATCH_SIZE', 100),
        'daily_alpha_fast_limit' => (int) env('WHATSAPP_DAILY_ALPHA_FAST_LIMIT', 20),
        'daily_alpha_fast_interval_seconds' => (int) env('WHATSAPP_DAILY_ALPHA_FAST_INTERVAL_SECONDS', 15),
        'daily_alpha_batch_per_minute' => (int) env('WHATSAPP_DAILY_ALPHA_BATCH_PER_MINUTE', 10),
        'daily_alpha_fast_max_send_hour' => (int) env('WHATSAPP_DAILY_ALPHA_FAST_MAX_SEND_HOUR', 23),
        'daily_alpha_batch_max_send_hour' => (int) env('WHATSAPP_DAILY_ALPHA_BATCH_MAX_SEND_HOUR', 21),
        'daily_alpha_default_start_time' => env('WHATSAPP_DAILY_ALPHA_DEFAULT_START_TIME', '16:00'),
        'daily_alpha_after_school_buffer_minutes' => (int) env('WHATSAPP_DAILY_ALPHA_AFTER_SCHOOL_BUFFER_MINUTES', 10),
        'retry_max_attempts' => (int) env('WHATSAPP_RETRY_MAX_ATTEMPTS', 3),
        'retry_batch_size' => (int) env('WHATSAPP_RETRY_BATCH_SIZE', 50),
        'send_min_interval_seconds' => (int) env('WHATSAPP_SEND_MIN_INTERVAL_SECONDS', 6),
        'send_throttle_release_max_seconds' => (int) env('WHATSAPP_SEND_THROTTLE_RELEASE_MAX_SECONDS', 120),
    ],

    'fonnte' => [
        'base_url' => env('FONNTE_BASE_URL', 'https://api.fonnte.com'),
        'token' => env('FONNTE_TOKEN'),
        'timeout' => (int) env('FONNTE_TIMEOUT_SECONDS', 20),
    ],

    'caddy' => [
        'ask_secret' => env('CADDY_ASK_SECRET'),
        'acme_email' => env('CADDY_ACME_EMAIL'),
        'evolution_host' => env('CADDY_EVOLUTION_HOST'),
    ],

];
