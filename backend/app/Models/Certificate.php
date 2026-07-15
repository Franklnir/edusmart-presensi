<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class Certificate extends Model
{
    use HasUuids;

    protected $table = 'certificates';

    public $timestamps = false;

    protected $fillable = [
        'id',
        'tenant_id',
        'user_id',
        'nama_penerima',
        'email',
        'kelas',
        'event',
        'event_date',
        'file_url',
        'sent',
        'sent_at',
        'issued_at',
    ];

    protected $casts = [
        'event_date' => 'date',
        'sent' => 'boolean',
        'sent_at' => 'datetime',
        'issued_at' => 'datetime',
    ];
}
