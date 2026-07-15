<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class UploadSession extends Model
{
    use HasFactory;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'actor_id',
        'purpose',
        'provider',
        'bucket',
        'assignment_id',
        'quiz_id',
        'filename',
        'content_type',
        'size',
        'checksum_sha256',
        'actual_size',
        'object_key',
        'status',
        'failure_code',
        'expires_at',
        'uploaded_at',
        'verifying_at',
        'completed_at',
        'cancelled_at',
        'object_deleted_at',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'size' => 'integer',
        'actual_size' => 'integer',
        'uploaded_at' => 'datetime',
        'verifying_at' => 'datetime',
        'completed_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'object_deleted_at' => 'datetime',
    ];

    public function attachments()
    {
        return $this->hasMany(Attachment::class, 'upload_session_id');
    }
}
