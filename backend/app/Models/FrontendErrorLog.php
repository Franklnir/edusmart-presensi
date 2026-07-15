<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class FrontendErrorLog extends Model
{
    protected $fillable = [
        'level',
        'message',
        'context',
        'url',
        'user_agent',
        'ip_address',
        'user_id',
        'tenant_id',
        'request_id',
        'correlation_id',
        'error_code',
        'domain',
        'route_name',
        'response_status',
        'duration_ms',
        'release_sha',
    ];

    protected $casts = [
        'context' => 'array',
        'response_status' => 'integer',
        'duration_ms' => 'integer',
    ];
}
