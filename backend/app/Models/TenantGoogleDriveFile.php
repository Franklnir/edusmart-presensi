<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TenantGoogleDriveFile extends Model
{
    use HasFactory;

    protected $table = 'tenant_google_drive_files';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'config_id',
        'uploaded_by_user_id',
        'bucket',
        'source_path',
        'storage_value',
        'drive_file_id',
        'drive_file_name',
        'drive_web_view_link',
        'drive_web_content_link',
        'mime_type',
        'extension',
        'size_bytes',
        'uploaded_at',
    ];

    protected $casts = [
        'size_bytes' => 'integer',
        'uploaded_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function config(): BelongsTo
    {
        return $this->belongsTo(TenantGoogleDriveConfig::class, 'config_id');
    }
}
