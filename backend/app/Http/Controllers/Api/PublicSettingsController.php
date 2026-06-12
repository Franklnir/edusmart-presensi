<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class PublicSettingsController extends ApiController
{
    private const PUBLIC_COLUMNS = [
        'id',
        'nama_sekolah',
        'logo_url',
        'logo_path',
        'alamat',
        'telepon',
        'email',
        'link_instagram',
        'link_facebook',
        'link_youtube',
        'link_tiktok',
        'tahun_ajaran',
        'semester_aktif',
        'periode_mulai',
        'periode_selesai',
        'registrasi_siswa_aktif',
        'registrasi_guru_aktif',
    ];

    public function show(Request $request)
    {
        if (! Schema::hasTable('settings')) {
            return $this->ok(null);
        }

        $availableColumns = Schema::getColumnListing('settings');
        $columns = array_values(array_filter(
            self::PUBLIC_COLUMNS,
            fn (string $column): bool => in_array($column, $availableColumns, true)
        ));

        if (empty($columns)) {
            return $this->ok(null);
        }

        $query = DB::table('settings')->orderBy('id');
        $tenantId = $this->tenantId($request);
        if ($tenantId && in_array('tenant_id', $availableColumns, true)) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first($columns);

        return $this->ok($row ? (array) $row : null);
    }
}
