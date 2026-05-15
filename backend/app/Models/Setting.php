<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Setting extends Model
{
    use HasFactory;

    protected $table = 'settings';

    protected $fillable = [
        'tenant_id',
        'nama_sekolah',
        'logo_url',
        'logourl',
        'registrasisiswaaktif',
        'registrasiguruaktif',
        'registrasiadminaktif',
        'tahun_ajaran',
        'semester_aktif',
        'periode_mulai',
        'periode_selesai',
        'periode_ganjil_mulai',
        'periode_ganjil_selesai',
        'periode_genap_mulai',
        'periode_genap_selesai',
        'email',
        'telepon',
        'alamat',
        'registrasi_siswa_aktif',
        'registrasi_guru_aktif',
        'registrasi_admin_aktif',
        'scan_manual_enabled',
        'scan_always_active',
        'manual_jam_masuk_mulai',
        'manual_jam_masuk_selesai',
        'manual_jam_pulang_mulai',
        'manual_jam_pulang_selesai',
        'visi',
        'misi',
        'link_instagram',
        'link_facebook',
        'link_youtube',
        'link_tiktok',
        'auto_alpha_enabled',
        'logo_path',
        'logo_updated_at',
    ];

    protected $casts = [
        'registrasisiswaaktif' => 'boolean',
        'registrasiguruaktif' => 'boolean',
        'registrasiadminaktif' => 'boolean',
        'registrasi_siswa_aktif' => 'boolean',
        'registrasi_guru_aktif' => 'boolean',
        'registrasi_admin_aktif' => 'boolean',
        'scan_manual_enabled' => 'boolean',
        'scan_always_active' => 'boolean',
        'auto_alpha_enabled' => 'boolean',
        'periode_mulai' => 'date',
        'periode_selesai' => 'date',
        'periode_ganjil_mulai' => 'date',
        'periode_ganjil_selesai' => 'date',
        'periode_genap_mulai' => 'date',
        'periode_genap_selesai' => 'date',
    ];
}
