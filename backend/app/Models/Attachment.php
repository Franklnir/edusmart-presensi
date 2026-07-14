<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Attachment extends Model
{
    use HasFactory;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'actor_id',
        'upload_session_id',
        'purpose',
        'assignment_id',
        'object_key',
        'filename',
        'content_type',
        'size',
        'claimed_by_type',
        'claimed_by_id',
        'claimed_at',
    ];

    protected $casts = [
        'size' => 'integer',
        'assignment_id' => 'integer',
        'claimed_at' => 'datetime',
    ];

    public function uploadSession()
    {
        return $this->belongsTo(UploadSession::class);
    }
}
