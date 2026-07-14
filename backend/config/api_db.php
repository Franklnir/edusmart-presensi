<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Legacy database gateway lifecycle
    |--------------------------------------------------------------------------
    |
    | Keep this enabled while the migration matrix has active consumers. Once
    | static and runtime observation both reach zero, staging can set this to
    | false and receive a deliberate 410 response before route removal.
    |
    */
    'enabled' => filter_var(env('API_DB_ENABLED', true), FILTER_VALIDATE_BOOL),
];
