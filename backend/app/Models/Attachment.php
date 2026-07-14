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
        'upload_session_id',
        'object_key',
        'filename',
        'content_type',
        'size',
    ];

    protected $casts = [
        'size' => 'integer',
    ];

    public function uploadSession()
    {
        return $this->belongsTo(UploadSession::class);
    }
}
