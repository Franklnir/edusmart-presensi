<?php

namespace App\Services\GoogleDrive;

use App\Models\TenantGoogleDriveConfig;
use App\Models\TenantGoogleDriveFile;
use App\Support\AcademicPeriod;
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

    private const DRIVE_UPLOAD_BUCKETS = [
        'assignments',
        'quiz-media',
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

    public function canUploadAssignmentDocument(Request $request, string $bucket, UploadedFile $file): bool
    {
        return $this->canUploadStorageFile($request, $bucket, $file);
    }

    public function canUploadStorageFile(Request $request, string $bucket, UploadedFile $file): bool
    {
        $fileName = (string) ($file->getClientOriginalName() ?: '');
        $mime = (string) ($file->getMimeType() ?: $file->getClientMimeType() ?: '');

        return $this->canUploadStorageFileMetadata($request, $bucket, $fileName, $mime);
    }

    public function canUploadAssignmentDocumentMetadata(Request $request, string $bucket, string $fileName, string $mime = ''): bool
    {
        return $this->canUploadStorageFileMetadata($request, $bucket, $fileName, $mime);
    }

    public function canUploadStorageFileMetadata(Request $request, string $bucket, string $fileName, string $mime = ''): bool
    {
        if (! $this->canRouteBucketFileToDrive($bucket, $fileName, $mime)) {
            return false;
        }
        if (! $this->providerConfigured() || ! $this->tablesReady()) {
            return false;
        }

        $tenantId = trim((string) $request->attributes->get('tenant_id', ''));
        if ($tenantId === '') {
            return false;
        }

        $config = TenantGoogleDriveConfig::query()
            ->where('tenant_id', $tenantId)
            ->where('is_enabled', true)
            ->first();

        return $config
            && $config->status === self::STATUS_CONNECTED
            && trim((string) ($config->refresh_token ?? '')) !== '';
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

    public function statusForTenant(string $tenantId, bool $refresh = false, array $usageFilters = []): array
    {
        $tenantId = trim($tenantId);
        if (! $this->tablesReady()) {
            return $this->publicStatus($tenantId, null, false, $usageFilters);
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

        return $this->publicStatus($tenantId, $config, false, $usageFilters);
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

    public function filesForTenant(string $tenantId, array $filters = []): array
    {
        $tenantId = trim($tenantId);
        if ($tenantId === '' || ! $this->tablesReady()) {
            return [
                'rows' => [],
                'total' => 0,
                'limit' => 0,
            ];
        }

        $limit = max(1, min(100, (int) ($filters['limit'] ?? 50)));
        $bucket = trim((string) ($filters['bucket'] ?? ''));
        $tahunAjaran = AcademicPeriod::normalizeAcademicYear($filters['tahun_ajaran'] ?? null);
        $semester = AcademicPeriod::normalizeSemester($filters['semester'] ?? null);
        $kelas = trim((string) ($filters['kelas'] ?? ''));
        $angkatan = trim((string) ($filters['angkatan'] ?? ''));
        $search = trim((string) ($filters['q'] ?? ''));

        $hasTahunAjaran = Schema::hasColumn('tenant_google_drive_files', 'tahun_ajaran');
        $hasSemester = Schema::hasColumn('tenant_google_drive_files', 'semester');
        $hasKelas = Schema::hasColumn('tenant_google_drive_files', 'kelas');
        $hasAngkatan = Schema::hasColumn('tenant_google_drive_files', 'angkatan');
        $hasTaskId = Schema::hasColumn('tenant_google_drive_files', 'task_id');

        $query = TenantGoogleDriveFile::query()
            ->where('tenant_id', $tenantId);

        if ($bucket !== '' && $bucket !== 'all') {
            $query->where('bucket', $bucket);
        }
        if ($tahunAjaran && $hasTahunAjaran) {
            $query->where('tahun_ajaran', $tahunAjaran);
        }
        if ($semester && $hasSemester) {
            $query->where('semester', $semester);
        }
        if ($kelas !== '' && $hasKelas) {
            $query->where('kelas', $kelas);
        }
        if ($angkatan !== '' && $hasAngkatan) {
            $query->where('angkatan', $angkatan);
        }
        if ($search !== '') {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], $search).'%';
            $query->where(function ($subQuery) use ($like, $hasKelas, $hasAngkatan, $hasTaskId) {
                $subQuery
                    ->where('drive_file_name', 'like', $like)
                    ->orWhere('source_path', 'like', $like)
                    ->orWhere('extension', 'like', $like);

                if ($hasKelas) {
                    $subQuery->orWhere('kelas', 'like', $like);
                }
                if ($hasAngkatan) {
                    $subQuery->orWhere('angkatan', 'like', $like);
                }
                if ($hasTaskId) {
                    $subQuery->orWhere('task_id', 'like', $like);
                }
            });
        }

        $total = (clone $query)->count();
        $rows = $query
            ->orderByDesc('uploaded_at')
            ->limit($limit)
            ->get()
            ->map(function (TenantGoogleDriveFile $file) {
                $bucket = (string) ($file->bucket ?? '');
                $moduleLabel = match ($bucket) {
                    'quiz-media' => 'Quiz',
                    'assignments' => 'Tugas',
                    default => $bucket !== '' ? $bucket : 'File',
                };

                return [
                    'id' => (string) $file->id,
                    'bucket' => $bucket,
                    'module_label' => $moduleLabel,
                    'drive_file_name' => (string) ($file->drive_file_name ?? ''),
                    'drive_web_view_link' => (string) ($file->drive_web_view_link ?? ''),
                    'drive_web_content_link' => (string) ($file->drive_web_content_link ?? ''),
                    'mime_type' => (string) ($file->mime_type ?? ''),
                    'extension' => (string) ($file->extension ?? ''),
                    'size_bytes' => (int) ($file->size_bytes ?? 0),
                    'size_label' => $this->formatBytes((int) ($file->size_bytes ?? 0)),
                    'uploaded_at' => $file->uploaded_at?->toIso8601String(),
                    'tahun_ajaran' => (string) ($file->tahun_ajaran ?? ''),
                    'semester' => (string) ($file->semester ?? ''),
                    'angkatan' => (string) ($file->angkatan ?? ''),
                    'kelas' => (string) ($file->kelas ?? ''),
                    'task_id' => (string) ($file->task_id ?? ''),
                    'source_path' => (string) ($file->source_path ?? ''),
                ];
            })
            ->values()
            ->all();

        return [
            'rows' => $rows,
            'total' => $total,
            'limit' => $limit,
            'filters' => [
                'bucket' => $bucket,
                'tahun_ajaran' => $tahunAjaran,
                'semester' => $semester,
                'kelas' => $kelas,
                'angkatan' => $angkatan,
                'q' => $search,
            ],
        ];
    }

    public function uploadAssignmentDocumentIfAvailable(
        Request $request,
        string $bucket,
        string $sourcePath,
        UploadedFile $file
    ): ?array {
        return $this->uploadStorageFileIfAvailable($request, $bucket, $sourcePath, $file);
    }

    public function uploadStorageFileIfAvailable(
        Request $request,
        string $bucket,
        string $sourcePath,
        UploadedFile $file
    ): ?array {
        if (! $this->shouldSendBucketFileToDrive($bucket, $file)) {
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
        $schoolFolderId = trim((string) ($config->drive_folder_id ?? ''));
        if ($schoolFolderId === '') {
            throw new RuntimeException('Folder Google Drive sekolah belum siap.');
        }
        $targetFolder = $this->ensureStorageUploadFolder($accessToken, $schoolFolderId, $bucket, $sourcePath, $tenantId);
        $folderId = (string) ($targetFolder['id'] ?? $schoolFolderId);
        $folderPath = (string) ($targetFolder['path'] ?? '');
        $usageSnapshot = $this->storageUsageSnapshot($bucket, $sourcePath, $tenantId);

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
                'module' => $bucket === 'quiz-media' ? 'quiz' : 'assignment',
                'folder_path' => $folderPath,
                'tahun_ajaran' => (string) ($usageSnapshot['tahun_ajaran'] ?? ''),
                'semester' => (string) ($usageSnapshot['semester'] ?? ''),
                'kelas' => (string) ($usageSnapshot['kelas'] ?? ''),
                'angkatan' => (string) ($usageSnapshot['angkatan'] ?? ''),
                'task_id' => (string) ($usageSnapshot['task_id'] ?? ''),
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
        $recordPayload = [
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
        ];

        foreach (['tahun_ajaran', 'semester', 'angkatan', 'kelas', 'task_id'] as $column) {
            if (Schema::hasColumn('tenant_google_drive_files', $column)) {
                $recordPayload[$column] = $usageSnapshot[$column] ?? null;
            }
        }

        $record->fill($recordPayload);
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
            'providerLabel' => 'Google Drive',
            'driveFileId' => $fileId,
            'driveFileName' => $record->drive_file_name,
            'driveWebViewLink' => $webViewLink,
            'driveWebContentLink' => (string) ($fileInfo['webContentLink'] ?? ''),
            'driveFolderId' => $folderId,
            'driveFolderPath' => $folderPath,
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

    public function downloadStoredFile(string $tenantId, string $bucket, string $storageValue): ?array
    {
        $record = $this->storedFileRecord($tenantId, $bucket, $storageValue);
        if (! $record) {
            return null;
        }

        $config = TenantGoogleDriveConfig::query()
            ->where('tenant_id', trim($tenantId))
            ->first();
        if (! $config || ! $config->refresh_token) {
            throw new RuntimeException('Google Drive sekolah belum tersambung.');
        }

        $token = $this->validAccessToken($config);
        $response = Http::withToken($token)
            ->timeout(30)
            ->get('https://www.googleapis.com/drive/v3/files/'.rawurlencode((string) $record->drive_file_id), [
                'alt' => 'media',
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal mengunduh file Google Drive.'));
        }

        $mime = trim((string) ($record->mime_type ?? ''));
        if ($mime === '') {
            $mime = trim((string) ($response->header('Content-Type') ?: 'application/octet-stream'));
        }

        return [
            'contents' => $response->body(),
            'mime_type' => $mime ?: 'application/octet-stream',
            'filename' => (string) ($record->drive_file_name ?? 'file'),
            'size_bytes' => (int) ($record->size_bytes ?? 0),
        ];
    }

    private function storedFileRecord(string $tenantId, string $bucket, string $storageValue): ?TenantGoogleDriveFile
    {
        $tenantId = trim($tenantId);
        $bucket = trim($bucket);
        $fileId = $this->fileIdFromUrl($storageValue);
        if ($tenantId === '' || $bucket === '' || $fileId === '' || ! $this->tablesReady()) {
            return null;
        }

        return TenantGoogleDriveFile::query()
            ->where('tenant_id', $tenantId)
            ->where('bucket', $bucket)
            ->where('drive_file_id', $fileId)
            ->first();
    }

    private function publicStatus(
        string $tenantId,
        ?TenantGoogleDriveConfig $config,
        bool $summaryOnly = false,
        array $usageFilters = []
    ): array {
        $stats = $this->driveUploadStats($tenantId, $usageFilters);
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
            'app_storage_all' => [
                'uploaded_bytes' => (int) $stats['all_bytes'],
                'uploaded_label' => $this->formatBytes((int) $stats['all_bytes']),
                'files' => (int) $stats['all_files'],
            ],
            'usage_filter' => $stats['filter'],
            'usage_by_semester' => $stats['by_semester'],
            'usage_by_class' => $stats['by_class'],
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

        $token = $this->validAccessToken($config);
        $folderId = trim((string) ($config->drive_folder_id ?? ''));
        if ($folderId !== '') {
            $folder = $this->fetchExistingFolder($token, $folderId);
            if ($folder) {
                $config->fill([
                    'drive_folder_name' => (string) ($folder['name'] ?? $config->drive_folder_name),
                    'drive_folder_web_url' => (string) ($folder['webViewLink'] ?? $config->drive_folder_web_url),
                    'status' => self::STATUS_CONNECTED,
                    'last_error' => null,
                ]);
                $config->save();

                return $config->fresh();
            }

            $config->fill([
                'drive_folder_id' => null,
                'drive_folder_web_url' => null,
            ]);
            $config->save();
        }

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

    private function fetchExistingFolder(string $accessToken, string $folderId): ?array
    {
        $response = Http::withToken($accessToken)
            ->acceptJson()
            ->timeout(20)
            ->get('https://www.googleapis.com/drive/v3/files/'.rawurlencode($folderId), [
                'fields' => 'id,name,mimeType,webViewLink,trashed',
            ]);

        if ($response->successful()) {
            $data = (array) $response->json();
            $isFolder = (string) ($data['mimeType'] ?? '') === self::DRIVE_FOLDER_MIME;
            $isTrashed = (bool) ($data['trashed'] ?? false);

            return $isFolder && ! $isTrashed ? $data : null;
        }

        if (in_array($response->status(), [403, 404], true)) {
            return null;
        }

        throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal memeriksa folder Google Drive sekolah.'));
    }

    private function ensureAssignmentUploadFolder(string $accessToken, string $schoolFolderId, string $sourcePath, string $tenantId): array
    {
        return $this->ensureStorageUploadFolder($accessToken, $schoolFolderId, 'assignments', $sourcePath, $tenantId);
    }

    private function ensureStorageUploadFolder(
        string $accessToken,
        string $schoolFolderId,
        string $bucket,
        string $sourcePath,
        string $tenantId
    ): array
    {
        $segments = $this->assignmentFolderSegments($sourcePath, $tenantId);
        if ($bucket === 'quiz-media') {
            $segments = $this->quizFolderSegments($sourcePath, $tenantId);
        }
        $parentId = $schoolFolderId;
        $path = [];

        foreach ($segments as $segment) {
            $folderName = $this->safeDriveFolderName($segment);
            if ($folderName === '') {
                continue;
            }

            $folder = $this->findChildFolder($accessToken, $parentId, $folderName)
                ?: $this->createChildFolder($accessToken, $parentId, $folderName, $sourcePath);

            $parentId = (string) ($folder['id'] ?? $parentId);
            $path[] = (string) ($folder['name'] ?? $folderName);
        }

        return [
            'id' => $parentId,
            'path' => implode('/', $path),
        ];
    }

    private function assignmentFolderSegments(string $sourcePath, string $tenantId): array
    {
        $parts = array_values(array_filter(explode('/', trim($sourcePath, '/')), static fn ($part) => trim($part) !== ''));
        $first = (string) ($parts[0] ?? '');
        $period = $this->periodFolderSegments($tenantId);

        if ($first === 'tugas_lampiran') {
            $teacherId = $this->folderLabel('Guru', (string) ($parts[1] ?? 'tanpa-user'));

            return array_merge(['Tugas'], $period, ['Lampiran Guru', $teacherId]);
        }

        $task = $this->assignmentTaskSnapshot($first, $tenantId);
        $taskYear = AcademicPeriod::normalizeAcademicYear($task['tahun_ajaran'] ?? null);
        $taskSemester = AcademicPeriod::normalizeSemester($task['semester'] ?? null);
        if ($taskYear || $taskSemester) {
            $period = $this->formatPeriodFolderSegments(
                $taskYear ?: 'Aktif',
                $taskSemester ?: 'Aktif'
            );
        }
        $taskId = $this->folderLabel('Tugas', $first !== '' ? $first : 'tanpa-id');
        $cohort = trim((string) ($task['angkatan'] ?? ''));
        $class = trim((string) ($task['kelas'] ?? ''));
        $filename = (string) ($parts[1] ?? '');
        $studentId = 'tanpa-user';
        if (preg_match('/^([0-9a-fA-F-]{32,36})-/', $filename, $matches)) {
            $studentId = (string) $matches[1];
        }

        $segments = array_merge(['Tugas'], $period);
        if ($cohort !== '') {
            $segments[] = $this->folderLabel('Angkatan', $cohort);
        }
        if ($class !== '') {
            $segments[] = $this->folderLabel('Kelas', $class);
        }

        return array_merge($segments, ['Jawaban Siswa', $taskId, $this->folderLabel('Siswa', $studentId)]);
    }

    private function quizFolderSegments(string $sourcePath, string $tenantId): array
    {
        $path = $this->quizMediaPathParts($sourcePath);
        $quizId = (string) ($path['quiz_id'] ?? '');
        $teacherId = (string) ($path['teacher_id'] ?? 'tanpa-user');
        $filename = (string) ($path['filename'] ?? '');
        $quiz = $this->quizSnapshot($quizId, $tenantId);

        $period = $this->periodFolderSegments($tenantId);
        $quizYear = AcademicPeriod::normalizeAcademicYear($quiz['tahun_ajaran'] ?? null);
        $quizSemester = AcademicPeriod::normalizeSemester($quiz['semester'] ?? null);
        if ($quizYear || $quizSemester) {
            $period = $this->formatPeriodFolderSegments(
                $quizYear ?: 'Aktif',
                $quizSemester ?: 'Aktif'
            );
        }

        $segments = array_merge(['Quiz'], $period);
        $cohort = trim((string) ($quiz['angkatan'] ?? ''));
        $class = trim((string) ($quiz['kelas_id'] ?? ''));
        $subject = trim((string) ($quiz['mapel'] ?? ''));
        if ($cohort !== '') {
            $segments[] = $this->folderLabel('Angkatan', $cohort);
        }
        if ($class !== '') {
            $segments[] = $this->folderLabel('Kelas', $class);
        }
        if ($subject !== '') {
            $segments[] = $this->folderLabel('Mapel', $subject);
        }

        $segments[] = $this->folderLabel('Quiz', $quizId !== '' ? $quizId : 'tanpa-id');
        $segments[] = $this->folderLabel('Guru', $teacherId);
        $segments[] = str_starts_with(strtolower($filename), 'option-') ? 'Gambar Opsi' : 'Gambar Soal';

        return $segments;
    }

    private function periodFolderSegments(string $tenantId): array
    {
        $period = $this->tenantActivePeriod($tenantId);

        return $this->formatPeriodFolderSegments(
            (string) ($period['tahun_ajaran'] ?? 'Aktif'),
            (string) ($period['semester'] ?? 'Aktif')
        );
    }

    private function formatPeriodFolderSegments(string $tahunAjaran, string $semester): array
    {
        return [
            'Tahun Ajaran '.str_replace('/', '-', $tahunAjaran ?: 'Aktif'),
            'Semester '.($semester ?: 'Aktif'),
        ];
    }

    private function assignmentUsageSnapshot(string $sourcePath, string $tenantId): array
    {
        $parts = array_values(array_filter(explode('/', trim($sourcePath, '/')), static fn ($part) => trim($part) !== ''));
        $first = (string) ($parts[0] ?? '');
        $taskId = $first !== 'tugas_lampiran' ? $first : '';
        $task = $taskId !== '' ? $this->assignmentTaskSnapshot($taskId, $tenantId) : [];

        $period = [];
        if (! empty($task['tahun_ajaran']) || ! empty($task['semester'])) {
            $period = AcademicPeriod::make($task['tahun_ajaran'] ?? null, $task['semester'] ?? null);
        } else {
            $period = $this->tenantActivePeriod($tenantId);
        }

        return [
            'task_id' => $taskId ?: null,
            'tahun_ajaran' => $period['tahun_ajaran'] ?? null,
            'semester' => $period['semester'] ?? null,
            'angkatan' => $task['angkatan'] ?? null,
            'kelas' => $task['kelas'] ?? null,
        ];
    }

    private function storageUsageSnapshot(string $bucket, string $sourcePath, string $tenantId): array
    {
        if ($bucket === 'quiz-media') {
            return $this->quizUsageSnapshot($sourcePath, $tenantId);
        }

        return $this->assignmentUsageSnapshot($sourcePath, $tenantId);
    }

    private function quizUsageSnapshot(string $sourcePath, string $tenantId): array
    {
        $path = $this->quizMediaPathParts($sourcePath);
        $quizId = (string) ($path['quiz_id'] ?? '');
        $quiz = $this->quizSnapshot($quizId, $tenantId);

        $period = [];
        if (! empty($quiz['tahun_ajaran']) || ! empty($quiz['semester'])) {
            $period = AcademicPeriod::make($quiz['tahun_ajaran'] ?? null, $quiz['semester'] ?? null);
        } else {
            $period = $this->tenantActivePeriod($tenantId);
        }

        return [
            'task_id' => null,
            'tahun_ajaran' => $period['tahun_ajaran'] ?? null,
            'semester' => $period['semester'] ?? null,
            'angkatan' => $quiz['angkatan'] ?? null,
            'kelas' => $quiz['kelas_id'] ?? null,
        ];
    }

    private function quizMediaPathParts(string $sourcePath): array
    {
        $parts = array_values(array_filter(explode('/', trim($sourcePath, '/')), static fn ($part) => trim($part) !== ''));
        if (($parts[0] ?? '') === 'quiz-media') {
            return [
                'teacher_id' => (string) ($parts[1] ?? ''),
                'quiz_id' => (string) ($parts[2] ?? ''),
                'filename' => (string) ($parts[3] ?? ''),
            ];
        }

        return [
            'teacher_id' => (string) ($parts[0] ?? ''),
            'quiz_id' => (string) ($parts[1] ?? ''),
            'filename' => (string) ($parts[2] ?? ''),
        ];
    }

    private function tenantActivePeriod(string $tenantId): array
    {
        $period = AcademicPeriod::current();
        if (
            $tenantId === ''
            || ! Schema::hasTable('settings')
            || ! Schema::hasColumn('settings', 'tahun_ajaran')
            || ! Schema::hasColumn('settings', 'semester_aktif')
        ) {
            return $period;
        }

        $query = DB::table('settings');
        if (Schema::hasColumn('settings', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $columns = array_values(array_filter(
            [
                'tahun_ajaran',
                'semester_aktif',
                'periode_mulai',
                'periode_selesai',
                'periode_ganjil_mulai',
                'periode_ganjil_selesai',
                'periode_genap_mulai',
                'periode_genap_selesai',
            ],
            fn ($column) => Schema::hasColumn('settings', $column)
        ));
        $settings = $query->orderBy('id')->first($columns ?: ['tahun_ajaran', 'semester_aktif']);

        return $settings ? AcademicPeriod::fromSettings($settings) : $period;
    }

    private function assignmentTaskSnapshot(string $taskId, string $tenantId): array
    {
        $taskId = trim($taskId);
        if ($taskId === '' || ! Schema::hasTable('tugas')) {
            return [];
        }

        $columns = array_values(array_filter(
            ['kelas', 'tahun_ajaran', 'semester', 'angkatan'],
            fn ($column) => Schema::hasColumn('tugas', $column)
        ));
        if (empty($columns)) {
            return [];
        }

        $query = DB::table('tugas')->where('id', $taskId);
        if ($tenantId !== '' && Schema::hasColumn('tugas', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first($columns);
        if (! $row) {
            return [];
        }

        return (array) $row;
    }

    private function quizSnapshot(string $quizId, string $tenantId): array
    {
        $quizId = trim($quizId);
        if ($quizId === '' || ! Schema::hasTable('quizzes')) {
            return [];
        }

        $columns = array_values(array_filter(
            ['nama', 'mapel', 'kelas_id', 'tahun_ajaran', 'semester', 'angkatan'],
            fn ($column) => Schema::hasColumn('quizzes', $column)
        ));
        if (empty($columns)) {
            return [];
        }

        $query = DB::table('quizzes')->where('id', $quizId);
        if ($tenantId !== '' && Schema::hasColumn('quizzes', 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first($columns);
        if (! $row) {
            return [];
        }

        return (array) $row;
    }

    private function folderLabel(string $prefix, string $value): string
    {
        $cleanValue = trim($value);
        if ($cleanValue === '') {
            $cleanValue = 'tanpa-id';
        }

        return $prefix.' '.$cleanValue;
    }

    private function findChildFolder(string $accessToken, string $parentId, string $folderName): ?array
    {
        $query = sprintf(
            "'%s' in parents and mimeType = '%s' and name = '%s' and trashed = false",
            $this->driveQueryLiteral($parentId),
            self::DRIVE_FOLDER_MIME,
            $this->driveQueryLiteral($folderName)
        );

        $response = Http::withToken($accessToken)
            ->acceptJson()
            ->timeout(20)
            ->get('https://www.googleapis.com/drive/v3/files', [
                'q' => $query,
                'spaces' => 'drive',
                'pageSize' => 1,
                'fields' => 'files(id,name,webViewLink)',
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal memeriksa struktur folder Google Drive.'));
        }

        $files = (array) ($response->json('files') ?? []);
        $folder = $files[0] ?? null;

        return is_array($folder) ? $folder : null;
    }

    private function createChildFolder(string $accessToken, string $parentId, string $folderName, string $sourcePath): array
    {
        $response = Http::withToken($accessToken)
            ->acceptJson()
            ->timeout(20)
            ->post('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', [
                'name' => $folderName,
                'mimeType' => self::DRIVE_FOLDER_MIME,
                'parents' => [$parentId],
                'description' => 'Folder EduSmart Presensi untuk '.$sourcePath,
            ]);

        if (! $response->successful()) {
            throw new RuntimeException($this->googleErrorMessage($response->json(), 'Gagal membuat struktur folder Google Drive.'));
        }

        return (array) $response->json();
    }

    private function driveQueryLiteral(string $value): string
    {
        return str_replace(['\\', "'"], ['\\\\', "\\'"], $value);
    }

    private function safeDriveFolderName(string $value): string
    {
        $name = preg_replace('/[<>:"\/\\\\|?*\x00-\x1F]+/', '-', trim($value)) ?: '';
        $name = preg_replace('/\s+/', ' ', $name) ?: '';
        $name = trim($name, " .-\t\n\r\0\x0B");

        return Str::limit($name, 100, '');
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
        return $this->shouldSendFileMetadataToDrive(
            (string) $file->getClientOriginalName(),
            (string) ($file->getMimeType() ?: $file->getClientMimeType() ?: '')
        );
    }

    private function shouldSendBucketFileToDrive(string $bucket, UploadedFile $file): bool
    {
        return $this->canRouteBucketFileToDrive(
            $bucket,
            (string) $file->getClientOriginalName(),
            (string) ($file->getMimeType() ?: $file->getClientMimeType() ?: '')
        );
    }

    private function canRouteBucketFileToDrive(string $bucket, string $fileName, string $mime = ''): bool
    {
        if (! in_array($bucket, self::DRIVE_UPLOAD_BUCKETS, true)) {
            return false;
        }

        if ($bucket === 'quiz-media') {
            return $this->isImageFileMetadata($fileName, $mime);
        }

        return $this->shouldSendFileMetadataToDrive($fileName, $mime);
    }

    private function shouldSendFileMetadataToDrive(string $fileName, string $mime = ''): bool
    {
        $extension = $this->fileExtension($fileName);
        $mime = strtolower(trim($mime));

        if ($mime !== '' && str_starts_with($mime, 'image/')) {
            return true;
        }

        return in_array($extension, array_merge(self::DOCUMENT_EXTENSIONS, self::IMAGE_EXTENSIONS), true);
    }

    private function isImageFileMetadata(string $fileName, string $mime = ''): bool
    {
        $extension = $this->fileExtension($fileName);
        $mime = strtolower(trim($mime));

        if ($mime !== '' && str_starts_with($mime, 'image/')) {
            return true;
        }

        return in_array($extension, self::IMAGE_EXTENSIONS, true);
    }

    private function driveUploadStats(string $tenantId, array $filters = []): array
    {
        if ($tenantId === '' || ! Schema::hasTable('tenant_google_drive_files')) {
            return [
                'today_bytes' => 0,
                'today_files' => 0,
                'total_bytes' => 0,
                'total_files' => 0,
                'all_bytes' => 0,
                'all_files' => 0,
                'filter' => [
                    'tahun_ajaran' => '',
                    'semester' => '',
                ],
                'by_semester' => [],
                'by_class' => [],
            ];
        }

        $timezone = (string) $this->driveConfig('usage_timezone', 'Asia/Jakarta');
        $startOfDay = Carbon::now($timezone)->startOfDay()->utc();
        $year = AcademicPeriod::normalizeAcademicYear($filters['tahun_ajaran'] ?? null) ?: '';
        $semester = AcademicPeriod::normalizeSemester($filters['semester'] ?? null) ?: '';

        $baseQuery = DB::table('tenant_google_drive_files')
            ->where('tenant_id', $tenantId);
        $this->applyDriveUsageFilters($baseQuery, $year, $semester);

        $total = (clone $baseQuery)
            ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
            ->first();

        $allTotal = DB::table('tenant_google_drive_files')
            ->where('tenant_id', $tenantId)
            ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
            ->first();

        $today = (clone $baseQuery)
            ->where('uploaded_at', '>=', $startOfDay)
            ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
            ->first();

        $bySemester = [];
        if (
            Schema::hasColumn('tenant_google_drive_files', 'tahun_ajaran')
            && Schema::hasColumn('tenant_google_drive_files', 'semester')
        ) {
            $semesterRows = DB::table('tenant_google_drive_files')
                ->where('tenant_id', $tenantId)
                ->when($year !== '', fn ($query) => $query->where('tahun_ajaran', $year))
                ->select('tahun_ajaran', 'semester')
                ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
                ->groupBy('tahun_ajaran', 'semester')
                ->orderBy('tahun_ajaran', 'desc')
                ->orderBy('semester')
                ->get();

            $bySemester = $semesterRows->map(fn ($row) => [
                'tahun_ajaran' => (string) ($row->tahun_ajaran ?? ''),
                'semester' => (string) ($row->semester ?? ''),
                'uploaded_bytes' => (int) ($row->bytes ?? 0),
                'uploaded_label' => $this->formatBytes((int) ($row->bytes ?? 0)),
                'files' => (int) ($row->files ?? 0),
            ])->values()->all();
        }

        $byClass = [];
        if (
            Schema::hasColumn('tenant_google_drive_files', 'kelas')
            && Schema::hasColumn('tenant_google_drive_files', 'tahun_ajaran')
            && Schema::hasColumn('tenant_google_drive_files', 'semester')
        ) {
            $classQuery = DB::table('tenant_google_drive_files')
                ->where('tenant_id', $tenantId);
            $this->applyDriveUsageFilters($classQuery, $year, $semester);

            $classRows = $classQuery
                ->select('tahun_ajaran', 'semester', 'kelas', 'angkatan')
                ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
                ->groupBy('tahun_ajaran', 'semester', 'kelas', 'angkatan')
                ->orderBy('kelas')
                ->get();

            $byClass = $classRows->map(fn ($row) => [
                'tahun_ajaran' => (string) ($row->tahun_ajaran ?? ''),
                'semester' => (string) ($row->semester ?? ''),
                'kelas' => (string) ($row->kelas ?? ''),
                'angkatan' => (string) ($row->angkatan ?? ''),
                'uploaded_bytes' => (int) ($row->bytes ?? 0),
                'uploaded_label' => $this->formatBytes((int) ($row->bytes ?? 0)),
                'files' => (int) ($row->files ?? 0),
            ])->values()->all();
        }

        return [
            'today_bytes' => (int) ($today->bytes ?? 0),
            'today_files' => (int) ($today->files ?? 0),
            'total_bytes' => (int) ($total->bytes ?? 0),
            'total_files' => (int) ($total->files ?? 0),
            'all_bytes' => (int) ($allTotal->bytes ?? 0),
            'all_files' => (int) ($allTotal->files ?? 0),
            'filter' => [
                'tahun_ajaran' => $year,
                'semester' => $semester,
            ],
            'by_semester' => $bySemester,
            'by_class' => $byClass,
        ];
    }

    private function applyDriveUsageFilters($query, string $year, string $semester): void
    {
        if ($year !== '' && Schema::hasColumn('tenant_google_drive_files', 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $year);
        }
        if ($semester !== '' && Schema::hasColumn('tenant_google_drive_files', 'semester')) {
            $query->where('semester', $semester);
        }
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
