<?php

namespace App\Http\Controllers\Api;

use App\Contracts\UploadStorageProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class PublicSettingsController extends ApiController
{
    private const PUBLIC_LOGO_TTL_SECONDS = 3600;

    private const PUBLIC_COLUMNS = [
        'nama_sekolah',
        'logo_url',
        'logo_path',
        'tahun_ajaran',
        'semester_aktif',
        'periode_mulai',
        'periode_selesai',
    ];

    public function __construct(
        private readonly UploadStorageProvider $storage
    ) {}

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
        if (! $row) {
            return $this->ok(null);
        }

        $settings = (array) $row;
        $rawLogo = trim((string) ($settings['logo_url'] ?? ''));
        if ($rawLogo === '') {
            $rawLogo = trim((string) ($settings['logo_path'] ?? ''));
        }
        if ($rawLogo !== '') {
            $settings['logo_url'] = $this->publicLogoUrl($rawLogo);

            // Public consumers only need the usable URL. Do not make guests
            // retry a private object key through the authenticated signer.
            $settings['logo_path'] = null;
        }

        return $this->ok($settings);
    }

    private function publicLogoUrl(string $rawLogo): ?string
    {
        if (filter_var($rawLogo, FILTER_VALIDATE_URL)) {
            $scheme = strtolower((string) parse_url($rawLogo, PHP_URL_SCHEME));

            return in_array($scheme, ['http', 'https'], true) ? $rawLogo : null;
        }

        $objectPath = ltrim((string) parse_url($rawLogo, PHP_URL_PATH), '/');
        if ($objectPath === '' || str_contains($objectPath, '..')) {
            return null;
        }

        try {
            $url = $this->storage->signedUrl(
                $objectPath,
                self::PUBLIC_LOGO_TTL_SECONDS,
                'profile-photos'
            );

            return filter_var($url, FILTER_VALIDATE_URL) ? $url : null;
        } catch (\Throwable) {
            // Branding must never make the public login endpoint fail.
            return null;
        }
    }
}
