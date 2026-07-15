<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class CertificateTemplate extends Model
{
    use HasUuids;

    protected $table = 'templat_sertifikat_publik';

    protected $fillable = [
        'id',
        'tenant_id',
        'nama',
        'deskripsi',
        'background_url',
        'text_color',
        'font_family',
        'font_size',
        'nama_x',
        'nama_y',
        'event_x',
        'event_y',
        'tanggal_x',
        'tanggal_y',
        'is_active',
        'created_by',
        'fields',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'fields' => 'array',
        'font_size' => 'integer',
        'nama_x' => 'integer',
        'nama_y' => 'integer',
        'event_x' => 'integer',
        'event_y' => 'integer',
        'tanggal_x' => 'integer',
        'tanggal_y' => 'integer',
    ];
}
