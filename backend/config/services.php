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
