<?php

namespace App\Http\Controllers\Api;

use App\Contracts\UploadStorageProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

class PublicSettingsController extends ApiController
{
    private const PUBLIC_LOGO_TTL_SECONDS = 3600;

    private const PUBLIC_LOGO_MAX_BYTES = 5 * 1024 * 1024;

    private const PUBLIC_LOGO_MIME_TYPES = [
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp',
    ];

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
            $settings['logo_url'] = $this->publicLogoUrl($request, $rawLogo);

            // Public consumers only need the usable URL. Do not make guests
            // retry a private object key through the authenticated signer.
            $settings['logo_path'] = null;
        }

        return $this->ok($settings);
    }

    public function logo(Request $request)
    {
        $rawLogo = $this->tenantLogoValue($request);
        $objectPath = $rawLogo === null ? null : $this->objectPath($rawLogo);

        if ($objectPath !== null) {
            try {
                $signedUrl = $this->storage->signedUrl(
                    $objectPath,
                    self::PUBLIC_LOGO_TTL_SECONDS,
                    'profile-photos'
                );
                $response = Http::timeout(8)->get($signedUrl);
                $mime = strtolower(trim(explode(';', (string) $response->header('Content-Type'))[0]));
                $body = $response->body();

                if (
                    $response->successful()
                    && in_array($mime, self::PUBLIC_LOGO_MIME_TYPES, true)
                    && strlen($body) <= self::PUBLIC_LOGO_MAX_BYTES
                ) {
                    return response($body, 200, [
                        'Cache-Control' => 'public, max-age=300',
                        'Content-Type' => $mime,
                        'X-Content-Type-Options' => 'nosniff',
                    ]);
                }
            } catch (\Throwable) {
                // Missing or unavailable tenant branding falls through to the
                // bundled logo so a public page never renders a broken image.
            }
        }

        return response((string) file_get_contents(public_path('logo-sismu.png')), 200, [
            'Cache-Control' => 'public, max-age=60',
            'Content-Type' => 'image/png',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function publicLogoUrl(Request $request, string $rawLogo): ?string
    {
        if (filter_var($rawLogo, FILTER_VALIDATE_URL)) {
            $scheme = strtolower((string) parse_url($rawLogo, PHP_URL_SCHEME));

            return in_array($scheme, ['http', 'https'], true) ? $rawLogo : null;
        }

        if ($this->objectPath($rawLogo) === null) {
            return null;
        }

        return rtrim($request->getSchemeAndHttpHost(), '/').'/api/public/logo';
    }

    private function tenantLogoValue(Request $request): ?string
    {
        if (! Schema::hasTable('settings')) {
            return null;
        }

        $availableColumns = Schema::getColumnListing('settings');
        $columns = array_values(array_intersect(['logo_url', 'logo_path'], $availableColumns));
        if ($columns === []) {
            return null;
        }

        $query = DB::table('settings')->orderBy('id');
        $tenantId = $this->tenantId($request);
        if ($tenantId && in_array('tenant_id', $availableColumns, true)) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first($columns);
        if (! $row) {
            return null;
        }

        $settings = (array) $row;
        $rawLogo = trim((string) ($settings['logo_url'] ?? ''));
        if ($rawLogo === '') {
            $rawLogo = trim((string) ($settings['logo_path'] ?? ''));
        }

        return $rawLogo !== '' ? $rawLogo : null;
    }

    private function objectPath(string $rawLogo): ?string
    {
        if (filter_var($rawLogo, FILTER_VALIDATE_URL)) {
            return null;
        }

        $objectPath = ltrim((string) parse_url($rawLogo, PHP_URL_PATH), '/');
        if (
            $objectPath === ''
            || strlen($objectPath) > 500
            || str_contains($objectPath, '..')
            || str_contains($objectPath, '//')
            || ! preg_match('#^[A-Za-z0-9._/\-]+$#', $objectPath)
        ) {
            return null;
        }

        return $objectPath;
    }
}
