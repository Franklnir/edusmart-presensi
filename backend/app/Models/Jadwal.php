<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Jadwal extends Model
{
    protected $table = 'jadwal';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'id',
        'tenant_id',
        'kelas_id',
        'hari',
        'mapel',
        'guru_id',
        'guru_nama',
        'jam_mulai',
        'jam_selesai',
        'tahun_ajaran',
        'semester',
        'periode_berlaku',
        'academic_year_id',
    ];
}
