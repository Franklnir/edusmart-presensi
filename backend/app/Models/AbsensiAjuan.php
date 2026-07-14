<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AbsensiAjuan extends Model
{
    use HasFactory, HasUuids;

    protected $table = 'absensi_ajuan';

    const UPDATED_AT = null;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'tenant_id',
        'kelas',
        'tanggal',
        'uid',
        'nama',
        'alasan',
        'mapel',
        'status_guru',
        'kategori_final',
        'guru_id',
        'guru_nama',
        'waktu_respon',
        'tahun_ajaran',
        'semester',
    ];

    protected $casts = [
        'tanggal' => 'date',
        'waktu_respon' => 'datetime',
    ];

    public function profile(): BelongsTo
    {
        return $this->belongsTo(Profile::class, 'uid', 'id');
    }

    public function guru(): BelongsTo
    {
        return $this->belongsTo(Profile::class, 'guru_id', 'id');
    }
}
