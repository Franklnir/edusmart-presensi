<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Profile extends Model
{
    protected $table = 'profiles';

    protected $primaryKey = 'id';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = [
        'id',
        'tenant_id',
        'email',
        'nama',
        'role',
        'kelas',
        'jk',
        'usia',
        'telp',
        'photo_url',
        'nis',
        'agama',
        'jabatan',
        'alamat',
        'status',
        'must_change_password',
        'alasan_nonaktif',
        'disabled_at',
        'tanggal_lahir',
        'rfid_uid',
        'kelas_change_used',
        'no_hp_siswa',
        'no_hp_wali',
        'deleted_at',
        'photo_path',
        'photo_updated_at',
        'created_at',
        'updated_at',
    ];

    protected $casts = [
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'disabled_at' => 'datetime',
        'tanggal_lahir' => 'date',
        'kelas_change_used' => 'boolean',
        'must_change_password' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'id', 'id');
    }
}
