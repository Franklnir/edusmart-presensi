<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Attachment extends Model
{
    use HasFactory, SoftDeletes;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'actor_id',
        'upload_session_id',
        'purpose',
        'provider',
        'bucket',
        'assignment_id',
        'object_key',
        'filename',
        'content_type',
        'size',
        'actual_size',
        'checksum_sha256',
        'status',
        'claimed_by_type',
        'claimed_by_id',
        'claimed_at',
    ];

    protected $casts = [
        'size' => 'integer',
        'actual_size' => 'integer',
        'assignment_id' => 'integer',
        'claimed_at' => 'datetime',
    ];

    public function uploadSession()
    {
        return $this->belongsTo(UploadSession::class);
    }
}
