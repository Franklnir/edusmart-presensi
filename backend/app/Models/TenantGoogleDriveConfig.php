<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TenantGoogleDriveConfig extends Model
{
    use HasFactory;

    protected $table = 'tenant_google_drive_configs';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'connected_by_user_id',
        'status',
        'is_enabled',
        'google_account_email',
        'google_account_name',
        'google_account_picture',
        'drive_folder_id',
        'drive_folder_name',
        'drive_folder_web_url',
        'access_token',
        'refresh_token',
        'token_expires_at',
        'scope',
        'quota_used_bytes',
        'quota_limit_bytes',
        'quota_used_in_drive_bytes',
        'last_checked_at',
        'last_error',
        'metadata',
    ];

    protected $hidden = [
        'access_token',
        'refresh_token',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
        'access_token' => 'encrypted',
        'refresh_token' => 'encrypted',
        'token_expires_at' => 'datetime',
        'last_checked_at' => 'datetime',
        'metadata' => 'array',
        'quota_used_bytes' => 'integer',
        'quota_limit_bytes' => 'integer',
        'quota_used_in_drive_bytes' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function files(): HasMany
    {
        return $this->hasMany(TenantGoogleDriveFile::class, 'config_id');
    }
}
