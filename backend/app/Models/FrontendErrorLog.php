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
    ];

    protected $casts = [
        'context' => 'array',
    ];
}
