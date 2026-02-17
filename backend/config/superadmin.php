<?php

return [
    'emails' => array_filter(array_map('trim', explode(',', env('SUPER_ADMIN_EMAILS', '')))),
    'ids' => array_filter(array_map('trim', explode(',', env('SUPER_ADMIN_IDS', '')))),
    'allow_email_fallback' => filter_var(env('SUPER_ADMIN_ALLOW_EMAIL_FALLBACK', false), FILTER_VALIDATE_BOOL),
];
