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
        'mobile_redirect_schemes' => array_values(array_filter(array_map(
            'trim',
            explode(',', env('GOOGLE_MOBILE_REDIRECT_SCHEMES', 'edusmart-presensi,edusmart'))
        ))),
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
            env('APP_DIRECT_UPLOAD_ENABLED', env('ASSIGNMENT_DIRECT_UPLOAD_ENABLED', false)),
            FILTER_VALIDATE_BOOL
        ),
        'label' => env('APP_OBJECT_STORAGE_LABEL', env('ASSIGNMENT_OBJECT_STORAGE_LABEL', 'Object Storage')),
        'key' => env('APP_OBJECT_STORAGE_ACCESS_KEY_ID', env('ASSIGNMENT_OBJECT_STORAGE_ACCESS_KEY_ID', env('AWS_ACCESS_KEY_ID'))),
        'secret' => env('APP_OBJECT_STORAGE_SECRET_ACCESS_KEY', env('ASSIGNMENT_OBJECT_STORAGE_SECRET_ACCESS_KEY', env('AWS_SECRET_ACCESS_KEY'))),
        'session_token' => env('APP_OBJECT_STORAGE_SESSION_TOKEN', env('ASSIGNMENT_OBJECT_STORAGE_SESSION_TOKEN', env('AWS_SESSION_TOKEN'))),
        'region' => env('APP_OBJECT_STORAGE_REGION', env('ASSIGNMENT_OBJECT_STORAGE_REGION', env('AWS_DEFAULT_REGION', 'us-east-1'))),
        'bucket' => env('APP_OBJECT_STORAGE_BUCKET', env('ASSIGNMENT_OBJECT_STORAGE_BUCKET', env('AWS_BUCKET'))),
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
        'verify_uploads' => filter_var(env('APP_DIRECT_UPLOAD_VERIFY_OBJECTS', true), FILTER_VALIDATE_BOOL),
        'direct_upload_buckets' => array_values(array_filter(array_map(
            'trim',
            explode(
                ',',
                env(
                    'APP_DIRECT_UPLOAD_BUCKETS',
                    env(
                        'ASSIGNMENT_DIRECT_UPLOAD_BUCKETS',
                        'assignments,quiz-media,certificates,sertifikat-files,certificate-templates,sertifikat-templates'
                    )
                )
            )
        ))),
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

    'caddy' => [
        'ask_secret' => env('CADDY_ASK_SECRET'),
        'acme_email' => env('CADDY_ACME_EMAIL'),
        'evolution_host' => env('CADDY_EVOLUTION_HOST'),
    ],

];
