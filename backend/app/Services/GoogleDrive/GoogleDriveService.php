<?php

namespace App\Services\GoogleDrive;

use App\Models\TenantGoogleDriveConfig;
use App\Models\TenantGoogleDriveFile;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;

class GoogleDriveService
{
    public const STATUS_CONNECTED = 'connected';

    public const STATUS_DISCONNECTED = 'disconnected';

    public const STATUS_NEEDS_ATTENTION = 'needs_attention';

    private const OAUTH_STATE_CACHE_PREFIX = 'google_drive_oauth_state:';

    private const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

    private const DOCUMENT_EXTENSIONS = [
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'odt', 'rtf', 'odp',
    ];

    private const IMAGE_EXTENSIONS = [
        'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif',
    ];

    public function providerConfigured(): bool
    {
        return (bool) $this->driveConfig('enabled', false)
            && $this->clientId() !== ''
            && $this->clientSecret() !== '';
    }

    public function requiredScopes(): array
    {
        return [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.metadata.readonly',
        ];
    }

    public function authorizationUrl(Request $request, string $tenantId, string $userId, string $returnUrl): array
    {
        if (! $this->providerConfigured()) {
            throw new RuntimeException('Google Drive belum dikonfigurasi di server.');
        }
        if (! $this->tablesReady()) {
            throw new RuntimeException('Tabel Google Drive belum dimigrasikan.');
        }

        $tenantId = trim($tenantId);
        $userId = trim($userId);
        if ($tenantId === '' || $userId === '') {
            throw new RuntimeException('Tenant atau user tidak valid.');
        }

        $state = Str::random(48);
        $redirectUri = $this->redirectUri($request);
        $safeReturnUrl = $this->safeReturnUrl($request, $returnUrl);

        Cache::put($this->stateCacheKey($state), [
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'return_url' => $safeReturnUrl,
            'redirect_uri' => $redirectUri,
            'created_at' => now()->toIso8601String(),
        ], now()->addMinutes(10));

        $query = http_build_query([
            'client_id' => $this->clientId(),
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'scope' => implode(' ', $this->requiredScopes()),
            'access_type' => 'offline',
            'include_granted_scopes' => 'true',
            'prompt' => 'consent',
            'state' => $state,
        ], '', '&', PHP_QUERY_RFC3986);

        return [
            'authorization_url' => 'https://accounts.google.com/o/oauth2/v2/auth?'.$query,
            'expires_at' => now()->addMinutes(10)->toIso8601String(),
        ];
    }

    public function consumeOAuthCallback(Request $request): array
    {
        $state = trim((string) $request->query('state', ''));
        if ($state === '') {
            throw new RuntimeException('State OAuth Google Drive tidak ditemukan.');
        }
        if (! $this->tablesReady()) {
            throw new RuntimeException('Tabel Google Drive belum dimigrasikan.');
        }

        $payload = Cache::pull($this->stateCacheKey($state));
        if (! is_array($payload)) {
            throw new RuntimeException('Sesi sambungkan Google Drive sudah kedaluwarsa.');
        }

        $googleError = trim((string) $request->query('error', ''));
        if ($googleError !== '') {
            throw new RuntimeException('Sambungkan Google Drive dibatalkan atau ditolak.');
        }

        $code = trim((string) $request->query('code', ''));
        if ($code === '') {
            throw new RuntimeException('Kode OAuth Google Drive tidak ditemukan.');
        }

        $tenantId = trim((string) ($payload['tenant_id'] ?? ''));
        $userId = trim((string) ($payload['user_id'] ?? ''));
        $redirectUri = trim((string) ($payload['redirect_uri'] ?? '')) ?: $this->redirectUri($request);

        if ($tenantId === '' || $userId === '') {
            throw new RuntimeException('Payload OAuth Google Drive tidak valid.');
        }

        $token = $this->exchangeAuthorizationCode($code, $redirectUri);
        $accessToken = trim((string) ($token['access_token'] ?? ''));
        if ($accessToken === '') {
            throw new RuntimeException('Access token Google Drive tidak diterima.');
        }

        $profile = $this->fetchGoogleProfile($accessToken);
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        $folderName = $this->defaultFolderName((string) ($tenant->name ?? 'Sekolah'));

        $config = TenantGoogleDriveConfig::query()->firstOrNew(['tenant_id' => $tenantId]);
        if (! $config->exists) {
            $config->id = (string) Str::uuid();
            $config->drive_folder_name = $folderName;
        }

        $existingRefreshToken = trim((string) ($config->refresh_token ?? ''));
        $refreshToken = trim((string) ($token['refresh_token'] ?? '')) ?: $existingRefreshToken;
        if ($refreshToken === '') {
            throw new RuntimeException('Refresh token tidak diterima. Coba sambungkan ulang dan pilih izinkan akses.');
        }

        $config->fill([
            'connected_by_user_id' => $userId,
            'status' => self::STATUS_CONNECTED,
            'is_enabled' => true,
            'google_account_email' => $profile['email'] ?? null,
            'google_account_name' => $profile['name'] ?? null,
            'google_account_picture' => $profile['picture'] ?? null,
            'access_token' => $accessToken,
            'refresh_token' => $refreshToken,
            'token_expires_at' => $this->tokenExpiresAt($token),
            'scope' => trim((string) ($token['scope'] ?? implode(' ', $this->requiredScopes()))),
            'last_error' => null,
        ]);
        $config->save();

        $this->ensureSchoolFolder($config->fresh());
        $this->syncQuota($config->fresh());

        return [
            'return_url' => (string) ($payload['return_url'] ?? ''),
            'status' => $this->statusForTenant($tenantId, false),
        ];
    }

    public function statusForTenant(string $tenantId, bool $refresh = false): array
    {
        $tenantId = trim($tenantId);
        if (! $this->tablesReady()) {
            return $this->publicStatus($tenantId, null);
        }
        $config = $tenantId !== ''
            ? TenantGoogleDriveConfig::query()->where('tenant_id', $tenantId)->first()
            : null;

        if ($refresh && $config) {
            try {
                $this->ensureSchoolFolder($config);
                $this->syncQuota($config->fresh());
                $config = $config->fresh();
            } catch (\Throwable $e) {
                $config->fill([
                    'status' => self::STATUS_NEEDS_ATTENTION,
                    'last_checked_at' => now(),
                    'last_error' => $this->shortError($e->getMessage()),
                ]);
                $config->save();
                $config = $config->fresh();
            }
        }

        return $this->publicStatus($tenantId, $config);
    }

    public function summaryForTenant(string $tenantId): array
    {
        $tenantId = trim($tenantId);
        if (! $this->tablesReady()) {
            return $this->publicStatus($tenantId, null, true);
        }
        $config = $tenantId !== ''
            ? TenantGoogleDriveConfig::query()->where('tenant_id', $tenantId)->first()
            : null;

        return $this->publicStatus($tenantId, $config, true);
    }

    public function disconnectTenant(string $tenantId): array
    {
        if (! $this->tablesReady()) {
            return $this->publicStatus($tenantId, null);
        }

        $config = TenantGoogleDriveConfig::query()->where('tenant_id', $tenantId)->first();
        if (! $config) {
            return $this->publicStatus($tenantId, null);
        }

        $config->fill([
            'status' => self::STATUS_DISCONNECTED,
            'is_enabled' => false,
            'access_token' => null,
            'refresh_token' => null,
            'token_expires_at' => null,
            'last_error' => null,
            'last_checked_at' => now(),
        ]);
        $config->save();

        return $this->publicStatus($tenantId, $config->fresh());
    }

    public function uploadAssignmentDocumentIfAvailable(
        Request $request,
        string $bucket,
        string $sourcePath,
        UploadedFile $file
    ): ?array {
        if ($bucket !== 'assignments' || ! $this->shouldSendFileToDrive($file)) {
            return null;
        }

        if (! $this->providerConfigured()) {
            return null;
        }
        if (! $this->tablesReady()) {
            return null;
        }

        $tenantId = trim((string) $request->attributes->get('tenant_id', ''));
        if ($tenantId === '') {
            return null;
        }

        $config = TenantGoogleDriveConfig::query()
            ->where('tenant_id', $tenantId)
            ->where('is_enabled', true)
            ->first();

        if (! $config || $config->status !== self::STATUS_CONNECTED || ! $config->refresh_token) {
            return null;
        }

        $config = $this->ensureSchoolFolder($config);
        $accessToken = $this->validAccessToken($config);
        $folderId = trim((string) ($config->drive_folder_id ?? ''));
        if ($folderId === '') {
            throw new RuntimeException('Folder Google Drive sekolah belum siap.');
        }

        $safeName = $this->safeFilename($file->getClientOriginalName() ?: basename($sourcePath));
        $mime = (string) ($file->getMimeType() ?: $file->getClientMimeType() ?: 'application/octet-stream');
        $sizeBytes = (int) ($file->getSize() ?: 0);

        $metadata = [
            'name' => $safeName,
            'parents' => [$folderId],
            'description' => 'Upload EduSmart Presensi: '.$sourcePath,
            'appProperties' => [
                'tenant_id' => $tenantId,
                'source_path' => $sourcePath,
                'bucket' => $bucket,
            ],
        ];

        $created = $this->multipartUpload($accessToken, $metadata, $file, $mime);
        $fileId = trim((string) ($created['id'] ?? ''));
        if ($fileId === '') {
            throw new RuntimeException('Google Drive tidak mengembalikan ID file.');
        }

        $shareWarning = null;
        if ((bool) $this->driveConfig('share_uploaded_files', true)) {
            try {
                $this->shareFileWithLink($accessToken, $fileId);
            } catch (\Throwable $e) {
                $shareWarning = $this->shortError($e->getMessage());
            }
        }

        $fileInfo = $this->fetchDriveFile($accessToken, $fileId);
        $webViewLink = (string) ($fileInfo['webViewLink'] ?? $created['webViewLink'] ?? '');
        if ($webViewLink === '') {
            $webViewLink = 'https://drive.google.com/file/d/'.$fileId.'/view';
        }

        $record = TenantGoogleDriveFile::query()->firstOrNew([
            'tenant_id' => $tenantId,
            'drive_file_id' => $fileId,
        ]);
        if (! $record->exists) {
            $record->id = (string) Str::uuid();
        }
        $record->fill([
            'config_id' => $config->id,
            'uploaded_by_user_id' => $request->user()?->id,
            'bucket' => $bucket,
            'source_path' => $sourcePath,
            'storage_value' => $webViewLink,
            'drive_file_name' => (string) ($fileInfo['name'] ?? $safeName),
            'drive_web_view_link' => $webViewLink,
            'drive_web_content_link' => (string) ($fileInfo['webContentLink'] ?? ''),
            'mime_type' => (string) ($fileInfo['mimeType'] ?? $mime),
            'extension' => $this->fileExtension($safeName),
            'size_bytes' => $sizeBytes,
            'uploaded_at' => now(),
        ]);
        $record->save();

        try {
            $this->syncQuota($config->fresh());
        } catch (\Throwable $e) {
            // Upload sudah berhasil; status quota akan disegarkan saat admin cek kesiapan.
        }
        if ($shareWarning) {
            $config->fill([
                'last_checked_at' => now(),
                'last_error' => $shareWarning,
            ]);
            $config->save();
        }

        return [
            'path' => $webViewLink,
            'fullPath' => $webViewLink,
            'bucket' => $bucket,
            'provider' => 'google_drive',
            'driveFileId' => $fileId,
            'driveFileName' => $record->drive_file_name,
            'driveWebViewLink' => $webViewLink,
            'uploadedSizeBytes' => $sizeBytes,
            'uploadedSizeLabel' => $this->formatBytes($sizeBytes),
        ];
    }

    public function isGoogleDriveUrl(string $value): bool
    {
        $value = trim($value);
        if ($value === '' || ! filter_var($value, FILTER_VALIDATE_URL)) {
            return false;
        }

        $host = strtolower((string) parse_url($value, PHP_URL_HOST));

        return $host === 'drive.google.com' || $host === 'docs.google.com';
    }

    public function fileIdFromUrl(string $value): string
    {
        if (! $this->isGoogleDriveUrl($value)) {
            return '';
        }

        $path = (string) parse_url($value, PHP_URL_PATH);
        if (preg_match('#/file/d/([^/]+)#i', $path, $matches)) {
            return preg_replace('/[^A-Za-z0-9_-]/', '', (string) $matches[1]) ?: '';
        }

        $query = (string) parse_url($value, PHP_URL_QUERY);
        if ($query !== '') {
            parse_str($query, $params);
            if (! empty($params['id']) && is_string($params['id'])) {
                return preg_replace('/[^A-Za-z0-9_-]/', '', $params['id']) ?: '';
            }
        }

        return '';
    }

    public function deleteStoredFile(string $tenantId, string $storageValue): bool
    {
        $tenantId = trim($tenantId);
        $fileId = $this->fileIdFromUrl($storageValue);
        if ($tenantId === '' || $fileId === '') {
            return false;
        }
        if (! $this->tablesReady()) {
            return false;
        }

        $record = TenantGoogleDriveFile::query()
            ->where('tenant_id', $tenantId)
            ->where('drive_file_id', $fileId)
            ->first();

        if (! $record) {
            return false;
        }

        $config = TenantGoogleDriveConfig::query()->where('tenant_id', $tenantId)->first();
        if ($config && $config->refresh_token) {
            try {
                $token = $this->validAccessToken($config);
                $response = Http::withToken($token)
                    ->timeout(20)
                    ->delete('https://www.googleapis.com/drive/v3/files/'.rawurlencode($fileId));

                if (! $response->successful() && $response->status() !== 404) {
                    throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal menghapus file Google Drive.'));
                }
            } catch (\Throwable $e) {
                $config->fill([
                    'status' => self::STATUS_NEEDS_ATTENTION,
                    'last_checked_at' => now(),
                    'last_error' => $this->shortError($e->getMessage()),
                ]);
                $config->save();
                throw $e;
            }
        }

        $record->delete();

        return true;
    }

    private function publicStatus(string $tenantId, ?TenantGoogleDriveConfig $config, bool $summaryOnly = false): array
    {
        $stats = $this->driveUploadStats($tenantId);
        $configured = $config !== null
            && $config->is_enabled
            && $config->status === self::STATUS_CONNECTED
            && trim((string) ($config->refresh_token ?? '')) !== '';
        $ready = $configured && trim((string) ($config->drive_folder_id ?? '')) !== '';

        $quotaUsed = (int) ($config?->quota_used_bytes ?? 0);
        $quotaLimit = $config?->quota_limit_bytes !== null ? (int) $config->quota_limit_bytes : null;
        $quotaPercent = $quotaLimit && $quotaLimit > 0
            ? round(min(100, ($quotaUsed / $quotaLimit) * 100), 2)
            : null;

        $base = [
            'provider_configured' => $this->providerConfigured(),
            'configured' => $configured,
            'ready' => $ready,
            'status' => (string) ($config?->status ?? self::STATUS_DISCONNECTED),
            'status_label' => $this->statusLabel((string) ($config?->status ?? self::STATUS_DISCONNECTED), $ready),
            'is_enabled' => (bool) ($config?->is_enabled ?? false),
            'account_email' => $config?->google_account_email,
            'folder_name' => $config?->drive_folder_name,
            'folder_url' => $config?->drive_folder_web_url,
            'last_checked_at' => $config?->last_checked_at?->toIso8601String(),
            'last_error' => $config?->last_error,
            'quota' => [
                'used_bytes' => $quotaUsed,
                'used_label' => $this->formatBytes($quotaUsed),
                'limit_bytes' => $quotaLimit,
                'limit_label' => $quotaLimit ? $this->formatBytes($quotaLimit) : 'Tidak terbatas',
                'percent' => $quotaPercent,
            ],
            'today' => [
                'uploaded_bytes' => (int) $stats['today_bytes'],
                'uploaded_label' => $this->formatBytes((int) $stats['today_bytes']),
                'files' => (int) $stats['today_files'],
            ],
            'app_storage' => [
                'uploaded_bytes' => (int) $stats['total_bytes'],
                'uploaded_label' => $this->formatBytes((int) $stats['total_bytes']),
                'files' => (int) $stats['total_files'],
            ],
        ];

        if (! $summaryOnly) {
            $base['required_scopes'] = $this->requiredScopes();
            $base['share_uploaded_files'] = (bool) $this->driveConfig('share_uploaded_files', true);
        }

        return $base;
    }

    private function exchangeAuthorizationCode(string $code, string $redirectUri): array
    {
        $response = Http::asForm()
            ->timeout(20)
            ->post('https://oauth2.googleapis.com/token', [
                'code' => $code,
                'client_id' => $this->clientId(),
                'client_secret' => $this->clientSecret(),
                'redirect_uri' => $redirectUri,
                'grant_type' => 'authorization_code',
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal menukar kode Google Drive.'));
        }

        return (array) $response->json();
    }

    private function fetchGoogleProfile(string $accessToken): array
    {
        $response = Http::withToken($accessToken)
            ->timeout(15)
            ->get('https://www.googleapis.com/oauth2/v3/userinfo');

        if (! $response->successful()) {
            return [];
        }

        return (array) $response->json();
    }

    private function ensureSchoolFolder(TenantGoogleDriveConfig $config): TenantGoogleDriveConfig
    {
        if (! $this->providerConfigured()) {
            throw new RuntimeException('Google Drive belum dikonfigurasi di server.');
        }

        $folderId = trim((string) ($config->drive_folder_id ?? ''));
        if ($folderId !== '') {
            return $config;
        }

        $token = $this->validAccessToken($config);
        $folderName = trim((string) ($config->drive_folder_name ?? '')) ?: $this->defaultFolderName('Sekolah');
        $response = Http::withToken($token)
            ->acceptJson()
            ->timeout(20)
            ->post('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', [
                'name' => $folderName,
                'mimeType' => self::DRIVE_FOLDER_MIME,
                'description' => 'Folder penyimpanan EduSmart Presensi untuk sekolah.',
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal membuat folder Google Drive sekolah.'));
        }

        $data = (array) $response->json();
        $config->fill([
            'drive_folder_id' => (string) ($data['id'] ?? ''),
            'drive_folder_name' => (string) ($data['name'] ?? $folderName),
            'drive_folder_web_url' => (string) ($data['webViewLink'] ?? ''),
            'status' => self::STATUS_CONNECTED,
            'last_error' => null,
        ]);
        $config->save();

        return $config->fresh();
    }

    private function syncQuota(TenantGoogleDriveConfig $config): TenantGoogleDriveConfig
    {
        $token = $this->validAccessToken($config);
        $response = Http::withToken($token)
            ->timeout(20)
            ->get('https://www.googleapis.com/drive/v3/about', [
                'fields' => 'storageQuota,user(displayName,emailAddress,photoLink)',
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal membaca quota Google Drive.'));
        }

        $data = (array) $response->json();
        $quota = (array) ($data['storageQuota'] ?? []);
        $driveUser = (array) ($data['user'] ?? []);

        $config->fill([
            'status' => self::STATUS_CONNECTED,
            'google_account_email' => $driveUser['emailAddress'] ?? $config->google_account_email,
            'google_account_name' => $driveUser['displayName'] ?? $config->google_account_name,
            'google_account_picture' => $driveUser['photoLink'] ?? $config->google_account_picture,
            'quota_used_bytes' => $this->nullableInt($quota['usage'] ?? null),
            'quota_limit_bytes' => $this->nullableInt($quota['limit'] ?? null),
            'quota_used_in_drive_bytes' => $this->nullableInt($quota['usageInDrive'] ?? null),
            'last_checked_at' => now(),
            'last_error' => null,
        ]);
        $config->save();

        return $config->fresh();
    }

    private function validAccessToken(TenantGoogleDriveConfig $config): string
    {
        $accessToken = trim((string) ($config->access_token ?? ''));
        $expiresAt = $config->token_expires_at;
        if ($accessToken !== '' && $expiresAt && $expiresAt->gt(now()->addMinute())) {
            return $accessToken;
        }

        $refreshToken = trim((string) ($config->refresh_token ?? ''));
        if ($refreshToken === '') {
            throw new RuntimeException('Refresh token Google Drive tidak tersedia.');
        }

        $response = Http::asForm()
            ->timeout(20)
            ->post('https://oauth2.googleapis.com/token', [
                'client_id' => $this->clientId(),
                'client_secret' => $this->clientSecret(),
                'refresh_token' => $refreshToken,
                'grant_type' => 'refresh_token',
            ]);

        if (! $response->successful()) {
            $config->fill([
                'status' => self::STATUS_NEEDS_ATTENTION,
                'last_checked_at' => now(),
                'last_error' => $this->googleErrorMessage($response->json(), 'Token Google Drive perlu disambungkan ulang.'),
            ]);
            $config->save();

            throw new RuntimeException((string) $config->last_error);
        }

        $token = (array) $response->json();
        $newAccessToken = trim((string) ($token['access_token'] ?? ''));
        if ($newAccessToken === '') {
            throw new RuntimeException('Google Drive tidak mengembalikan access token baru.');
        }

        $config->fill([
            'access_token' => $newAccessToken,
            'token_expires_at' => $this->tokenExpiresAt($token),
            'scope' => trim((string) ($token['scope'] ?? $config->scope)),
            'status' => self::STATUS_CONNECTED,
            'last_error' => null,
        ]);
        $config->save();

        return $newAccessToken;
    }

    private function multipartUpload(string $accessToken, array $metadata, UploadedFile $file, string $mime): array
    {
        $boundary = 'edusmart_drive_'.Str::random(24);
        $contents = file_get_contents($file->getRealPath());
        if ($contents === false) {
            throw new RuntimeException('Gagal membaca file upload untuk Google Drive.');
        }

        $body = "--{$boundary}\r\n"
            ."Content-Type: application/json; charset=UTF-8\r\n\r\n"
            .json_encode($metadata, JSON_UNESCAPED_SLASHES)
            ."\r\n--{$boundary}\r\n"
            ."Content-Type: {$mime}\r\n\r\n"
            .$contents
            ."\r\n--{$boundary}--";

        $response = Http::withToken($accessToken)
            ->withHeaders([
                'Content-Type' => 'multipart/related; boundary='.$boundary,
            ])
            ->timeout(60)
            ->withBody($body, 'multipart/related; boundary='.$boundary)
            ->post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,webContentLink,createdTime');

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal upload file ke Google Drive sekolah.'));
        }

        return (array) $response->json();
    }

    private function shareFileWithLink(string $accessToken, string $fileId): void
    {
        $response = Http::withToken($accessToken)
            ->acceptJson()
            ->timeout(20)
            ->post('https://www.googleapis.com/drive/v3/files/'.rawurlencode($fileId).'/permissions?fields=id', [
                'role' => 'reader',
                'type' => 'anyone',
                'allowFileDiscovery' => false,
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'File berhasil diupload, tetapi link preview Google Drive belum bisa dibagikan.'));
        }
    }

    private function fetchDriveFile(string $accessToken, string $fileId): array
    {
        $response = Http::withToken($accessToken)
            ->timeout(20)
            ->get('https://www.googleapis.com/drive/v3/files/'.rawurlencode($fileId), [
                'fields' => 'id,name,mimeType,size,webViewLink,webContentLink,createdTime',
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal membaca metadata file Google Drive.'));
        }

        return (array) $response->json();
    }

    private function shouldSendFileToDrive(UploadedFile $file): bool
    {
        $extension = $this->fileExtension($file->getClientOriginalName());
        $mime = strtolower(trim((string) ($file->getMimeType() ?: $file->getClientMimeType() ?: '')));

        if ($mime !== '' && str_starts_with($mime, 'image/')) {
            return false;
        }
        if (in_array($extension, self::IMAGE_EXTENSIONS, true)) {
            return false;
        }

        return in_array($extension, self::DOCUMENT_EXTENSIONS, true);
    }

    private function driveUploadStats(string $tenantId): array
    {
        if ($tenantId === '' || ! Schema::hasTable('tenant_google_drive_files')) {
            return [
                'today_bytes' => 0,
                'today_files' => 0,
                'total_bytes' => 0,
                'total_files' => 0,
            ];
        }

        $timezone = (string) $this->driveConfig('usage_timezone', 'Asia/Jakarta');
        $startOfDay = Carbon::now($timezone)->startOfDay()->utc();

        $total = DB::table('tenant_google_drive_files')
            ->where('tenant_id', $tenantId)
            ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
            ->first();

        $today = DB::table('tenant_google_drive_files')
            ->where('tenant_id', $tenantId)
            ->where('uploaded_at', '>=', $startOfDay)
            ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
            ->first();

        return [
            'today_bytes' => (int) ($today->bytes ?? 0),
            'today_files' => (int) ($today->files ?? 0),
            'total_bytes' => (int) ($total->bytes ?? 0),
            'total_files' => (int) ($total->files ?? 0),
        ];
    }

    private function redirectUri(Request $request): string
    {
        $configured = trim((string) $this->driveConfig('redirect_uri', ''));
        if ($configured !== '') {
            return $configured;
        }

        return rtrim($request->getSchemeAndHttpHost(), '/').'/api/admin/google-drive/callback';
    }

    private function safeReturnUrl(Request $request, string $returnUrl): string
    {
        $fallback = rtrim((string) config('app.frontend_url', config('app.url')), '/').'/admin/pengaturan';
        $raw = trim($returnUrl) ?: $fallback;

        if (str_starts_with($raw, '/')) {
            $raw = rtrim($request->getSchemeAndHttpHost(), '/').$raw;
        }

        $parts = parse_url($raw);
        if (! is_array($parts)) {
            return $fallback;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if (! in_array($scheme, ['http', 'https'], true)) {
            return $fallback;
        }

        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($this->isAllowedReturnHost($host, strtolower($request->getHost()))) {
            return $raw;
        }

        return $fallback;
    }

    private function isAllowedReturnHost(string $host, string $requestHost): bool
    {
        if ($host === '' || $requestHost === '') {
            return false;
        }
        if ($host === $requestHost || $host === 'localhost' || $host === '127.0.0.1' || str_ends_with($host, '.localhost')) {
            return true;
        }

        foreach ([(string) config('app.url'), (string) config('app.frontend_url')] as $configuredUrl) {
            $configuredHost = strtolower((string) parse_url($configuredUrl, PHP_URL_HOST));
            if ($configuredHost !== '' && $host === $configuredHost) {
                return true;
            }
        }

        $rootDomain = strtolower(trim((string) config('tenancy.root_domain', '')));
        if ($rootDomain !== '' && ($host === $rootDomain || str_ends_with($host, '.'.$rootDomain))) {
            return true;
        }

        return false;
    }

    private function stateCacheKey(string $state): string
    {
        return self::OAUTH_STATE_CACHE_PREFIX.$state;
    }

    private function tablesReady(): bool
    {
        return Schema::hasTable('tenant_google_drive_configs')
            && Schema::hasTable('tenant_google_drive_files');
    }

    private function clientId(): string
    {
        return trim((string) $this->driveConfig('client_id', ''));
    }

    private function clientSecret(): string
    {
        return trim((string) $this->driveConfig('client_secret', ''));
    }

    private function driveConfig(string $key, $default = null)
    {
        return config('services.google.drive.'.$key, $default);
    }

    private function tokenExpiresAt(array $token): Carbon
    {
        $expiresIn = max(60, (int) ($token['expires_in'] ?? 3600));

        return now()->addSeconds($expiresIn);
    }

    private function defaultFolderName(string $schoolName): string
    {
        $base = trim((string) $this->driveConfig('folder_name', 'EduSmart Presensi'));
        $school = trim($schoolName);
        if ($school === '' || strtolower($school) === 'sekolah') {
            return $base ?: 'EduSmart Presensi';
        }

        return trim(($base ?: 'EduSmart Presensi').' - '.$school);
    }

    private function statusLabel(string $status, bool $ready): string
    {
        if ($ready) {
            return 'Siap dipakai';
        }

        return match ($status) {
            self::STATUS_CONNECTED => 'Tersambung, perlu cek folder',
            self::STATUS_NEEDS_ATTENTION => 'Perlu perhatian',
            default => 'Belum tersambung',
        };
    }

    private function safeFilename(string $name): string
    {
        $name = trim($name) ?: 'file';
        $name = preg_replace('/\s+/', '_', $name) ?: 'file';
        $name = preg_replace('/[^A-Za-z0-9._-]/', '', $name) ?: 'file';

        return substr($name, 0, 150) ?: 'file';
    }

    private function fileExtension(string $name): string
    {
        $extension = strtolower(pathinfo(parse_url($name, PHP_URL_PATH) ?: $name, PATHINFO_EXTENSION));

        return preg_replace('/[^a-z0-9]/', '', $extension) ?: '';
    }

    private function nullableInt($value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_numeric($value)) {
            return null;
        }

        return max(0, (int) $value);
    }

    private function googleErrorMessage($payload, string $fallback): string
    {
        if (is_array($payload)) {
            $error = $payload['error'] ?? null;
            if (is_array($error)) {
                $message = trim((string) ($error['message'] ?? ''));
                if ($message !== '') {
                    return $this->shortError($message);
                }
            }

            if (is_string($error) && trim($error) !== '') {
                return $this->shortError($error);
            }

            $message = trim((string) ($payload['error_description'] ?? $payload['message'] ?? ''));
            if ($message !== '') {
                return $this->shortError($message);
            }
        }

        return $fallback;
    }

    private function shortError(string $message): string
    {
        $message = trim($message);
        if ($message === '') {
            return 'Terjadi kesalahan Google Drive.';
        }

        return Str::limit($message, 500, '');
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $size = (float) $bytes;
        $index = 0;
        while ($size >= 1024 && $index < count($units) - 1) {
            $size /= 1024;
            $index++;
        }

        return round($size, $index === 0 ? 0 : 2).' '.$units[$index];
    }
}
