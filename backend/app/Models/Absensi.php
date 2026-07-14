<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Absensi extends Model
{
    protected $table = 'absensi';

    public $timestamps = false;

    protected $fillable = [
        'kelas',
        'tanggal',
        'uid',
        'mapel',
        'status',
        'nama',
        'waktu',
        'komentar',
        'oleh',
        'dikonfirmasi',
    ];

    protected $casts = [
        'tanggal' => 'date',
        'waktu' => 'datetime',
    ];

    public function profile()
    {
        return $this->belongsTo(Profile::class, 'uid', 'id');
    }
}
