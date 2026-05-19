<?php

namespace App\Http\Controllers\Api;

use App\Services\GoogleDrive\GoogleDriveService;
use App\Services\Storage\S3CompatibleStorageSigner;
use App\Services\Storage\StorageManagementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class StorageController extends ApiController
{
    public function __construct(
        private readonly GoogleDriveService $googleDriveService,
        private readonly S3CompatibleStorageSigner $objectStorageSigner,
        private readonly StorageManagementService $storageManagementService
    ) {}

    private array $tenantColumnCache = [];

    private const PROFILE_IMAGE_MAX_BYTES = 50 * 1024;

    private const ASSIGNMENT_IMAGE_MAX_BYTES = 680 * 1024;

    private const ASSIGNMENT_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;

    private const ASSIGNMENT_PRESENTATION_MAX_BYTES = 5 * 1024 * 1024;

    private const ASSIGNMENT_LOCAL_DOCUMENT_MAX_BYTES = 3 * 1024 * 1024;

    private const ASSIGNMENT_LOCAL_PRESENTATION_MAX_BYTES = 5 * 1024 * 1024;

    private const QUIZ_MEDIA_IMAGE_MAX_BYTES = 70 * 1024;

    private const MAX_SIGNED_URL_EXPIRES_SECONDS = 3600;

    private const MIN_SIGNED_URL_EXPIRES_SECONDS = 60;

    private const MAX_STORAGE_PATH_LENGTH = 240;

    private const DANGEROUS_EXTENSIONS = [
        'php', 'php3', 'php4', 'php5', 'php7', 'php8', 'phtml', 'phar',
        'exe', 'dll', 'so', 'bat', 'cmd', 'com', 'msi', 'ps1', 'vbs', 'wsf', 'hta', 'sh',
        'cgi', 'pl', 'py', 'rb', 'jar', 'asp', 'aspx', 'jsp',
    ];

    private const ASSIGNMENT_DOCUMENT_EXTENSIONS = [
        'pdf', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'txt',
    ];

    private const ASSIGNMENT_PRESENTATION_EXTENSIONS = [
        'ppt', 'pptx', 'odp',
    ];

    private const UPLOAD_POLICY = [
        'profile-photos' => [
            'max_bytes' => 2 * 1024 * 1024,
            'extensions' => ['jpg', 'jpeg', 'png', 'webp'],
            'mimes' => ['image/jpeg', 'image/png', 'image/webp'],
        ],
        'assignments' => [
            'max_bytes' => 15 * 1024 * 1024,
            'extensions' => ['pdf', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx', 'odp', 'txt', 'jpg', 'jpeg', 'png', 'webp'],
            'mimes' => [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.oasis.opendocument.text',
                'application/rtf',
                'text/rtf',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'application/vnd.oasis.opendocument.presentation',
                'text/plain',
                'image/jpeg',
                'image/png',
                'image/webp',
            ],
        ],
        'quiz-media' => [
            'max_bytes' => 2 * 1024 * 1024,
            'extensions' => ['jpg', 'jpeg', 'png'],
            'mimes' => ['image/jpeg', 'image/png'],
        ],
        'certificates' => [
            'max_bytes' => 10 * 1024 * 1024,
            'extensions' => ['pdf', 'jpg', 'jpeg', 'png'],
            'mimes' => ['application/pdf', 'image/jpeg', 'image/png'],
        ],
        'sertifikat-files' => [
            'max_bytes' => 10 * 1024 * 1024,
            'extensions' => ['pdf', 'jpg', 'jpeg', 'png'],
            'mimes' => ['application/pdf', 'image/jpeg', 'image/png'],
        ],
        'certificate-templates' => [
            'max_bytes' => 8 * 1024 * 1024,
            'extensions' => ['pdf', 'jpg', 'jpeg', 'png'],
            'mimes' => ['application/pdf', 'image/jpeg', 'image/png'],
        ],
        'sertifikat-templates' => [
            'max_bytes' => 8 * 1024 * 1024,
            'extensions' => ['pdf', 'jpg', 'jpeg', 'png'],
            'mimes' => ['application/pdf', 'image/jpeg', 'image/png'],
        ],
    ];

    private array $allowedBuckets = [
        'profile-photos',
        'assignments',
        'quiz-media',
        'certificates',
        'sertifikat-files',
        'certificate-templates',
        'sertifikat-templates',
    ];

    public function upload(Request $request)
    {
        $bucket = $request->input('bucket');
        $path = $request->input('path');
        $file = $request->file('file');
        $upsert = filter_var($request->input('upsert', false), FILTER_VALIDATE_BOOLEAN);
        $fastLocal = filter_var($request->input('fast_local', false), FILTER_VALIDATE_BOOLEAN);
        $objectStorageRelayError = null;

        if (! $bucket || ! $path || ! $file) {
            return $this->deny('Bucket, path, dan file wajib diisi', 422);
        }

        if (! in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        if (! $file instanceof UploadedFile || ! $file->isValid()) {
            return $this->deny('File upload tidak valid', 422);
        }

        $path = $this->sanitizePath($path);
        if (! $path) {
            return $this->deny('Path tidak valid', 422);
        }

        if (! $this->canWrite($request, $bucket, $path)) {
            return $this->deny('Akses upload ditolak');
        }

        $quizMediaTypeError = $this->validateQuizMediaTypePolicy($bucket, $file);
        if ($quizMediaTypeError) {
            return $quizMediaTypeError;
        }

        $uploadPolicyError = $this->validateUploadPolicy($bucket, $file);
        if ($uploadPolicyError) {
            return $uploadPolicyError;
        }

        $usesDrive = ! $fastLocal && $this->googleDriveService->canUploadStorageFile(
            $request,
            $bucket,
            $file
        );
        $assignmentFileSizeError = $this->validateAssignmentFileSizePolicy($bucket, $file, $usesDrive);
        if ($assignmentFileSizeError) {
            return $assignmentFileSizeError;
        }

        $imageRuleError = $this->validateImageSizePolicy($bucket, $path, $file);
        if ($imageRuleError) {
            return $imageRuleError;
        }

        if ($fastLocal && $this->objectStorageEnabledForBucket($bucket)) {
            $quotaError = $this->storageManagementService->assertUploadAllowed(
                (string) ($this->tenantId($request) ?? ''),
                (int) ($file->getSize() ?: 0),
                'object_storage'
            );
            if ($quotaError) {
                return response()->json(['error' => $quotaError], 422);
            }

            try {
                return $this->uploadObjectStorageViaServer($request, $bucket, $path, $file);
            } catch (\Throwable $e) {
                $objectStorageRelayError = $e->getMessage();
            }
        }

        if (! $fastLocal) {
            try {
                $driveUpload = $this->googleDriveService->uploadStorageFileIfAvailable(
                    $request,
                    $bucket,
                    $path,
                    $file
                );
                if (is_array($driveUpload)) {
                    return response()->json(['data' => $driveUpload]);
                }
            } catch (\Throwable $e) {
                $localLimitError = $this->validateAssignmentFileSizePolicy(
                    $bucket,
                    $file,
                    false,
                    'Google Drive sekolah tidak terhubung/penuh. Karena file akan disimpan di VPS, '
                );
                if ($localLimitError) {
                    return $localLimitError;
                }
            }
        }

        $quotaError = $this->storageManagementService->assertUploadAllowed(
            (string) ($this->tenantId($request) ?? ''),
            (int) ($file->getSize() ?: 0),
            'local'
        );
        if ($quotaError) {
            return response()->json(['error' => $quotaError], 422);
        }

        $storage = Storage::disk('local');
        $fullPath = $this->buildStoragePath($bucket, $path);

        if (! $upsert && $storage->exists($fullPath)) {
            return response()->json(['error' => 'File sudah ada'], 409);
        }

        $stream = fopen($file->getRealPath(), 'rb');
        if (! $stream) {
            return $this->deny('Gagal membaca file upload', 422);
        }

        try {
            $storage->put($fullPath, $stream);
        } finally {
            fclose($stream);
        }

        $uploadedSizeBytes = (int) ($storage->size($fullPath) ?: 0);
        $this->storageManagementService->registerUploadedFile($request, [
            'bucket' => $bucket,
            'path' => $path,
            'provider' => 'local',
            'file_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getMimeType() ?: $file->getClientMimeType(),
            'extension' => $this->normalizeExtension($file),
            'size_bytes' => $uploadedSizeBytes,
            'metadata' => array_filter([
                'object_storage_relay_failed' => $objectStorageRelayError !== null,
                'object_storage_relay_error' => $objectStorageRelayError,
            ]),
        ]);

        return response()->json([
            'data' => [
                'path' => $path,
                'fullPath' => $path,
                'bucket' => $bucket,
                'provider' => 'local',
                'providerLabel' => 'VPS',
                'uploadedSizeBytes' => $uploadedSizeBytes,
                'uploadedSizeLabel' => $this->formatBytes($uploadedSizeBytes),
                'fallbackReason' => $objectStorageRelayError ? 'object_storage_relay_failed' : null,
            ],
        ]);
    }

    private function uploadObjectStorageViaServer(
        Request $request,
        string $bucket,
        string $path,
        UploadedFile $file
    ): JsonResponse {
        $fileName = $file->getClientOriginalName() ?: basename($path);
        $mime = $this->resolveMetadataMime(
            $fileName,
            $file->getMimeType() ?: $file->getClientMimeType() ?: ''
        );
        $objectKey = $this->buildStoragePath($bucket, $path);
        $uploadedSizeBytes = (int) ($file->getSize() ?: 0);

        $quotaError = $this->storageManagementService->assertUploadAllowed(
            (string) ($this->tenantId($request) ?? ''),
            $uploadedSizeBytes,
            'object_storage'
        );
        if ($quotaError) {
            throw new \RuntimeException($quotaError);
        }

        $putResult = $this->objectStorageSigner->putObjectFromFile(
            $objectKey,
            $file->getRealPath(),
            $mime,
            $bucket
        );

        $verification = $this->objectStorageSigner->verifyUploadedObject(
            $objectKey,
            $uploadedSizeBytes,
            $bucket
        );

        if (($verification['verified'] ?? false) && ! ($verification['exists'] ?? false)) {
            throw new \RuntimeException('File object storage belum ditemukan setelah upload server-side.');
        }

        if (($verification['verified'] ?? false) && ! ($verification['size_matches'] ?? true)) {
            throw new \RuntimeException('Ukuran file object storage tidak sesuai setelah upload server-side.');
        }

        $this->storageManagementService->registerUploadedFile($request, [
            'bucket' => $bucket,
            'path' => $path,
            'provider' => 'object_storage',
            'file_name' => $fileName,
            'mime_type' => $mime,
            'extension' => $this->normalizeExtension($file),
            'size_bytes' => $uploadedSizeBytes,
            'metadata' => [
                'server_relay' => true,
                'object_key' => $objectKey,
                'etag' => $putResult['etag'] ?? null,
                'verified' => (bool) ($verification['verified'] ?? false),
                'verified_size_bytes' => $verification['size_bytes'] ?? null,
            ],
        ]);

        return response()->json([
            'data' => [
                'path' => $path,
                'fullPath' => $path,
                'bucket' => $bucket,
                'objectKey' => $objectKey,
                'provider' => 'object_storage',
                'providerLabel' => $this->objectStorageSigner->label(),
                'uploadedSizeBytes' => $uploadedSizeBytes,
                'uploadedSizeLabel' => $this->formatBytes($uploadedSizeBytes),
                'serverRelay' => true,
            ],
        ]);
    }

    public function directUpload(Request $request)
    {
        $bucket = trim((string) $request->input('bucket', ''));
        $path = trim((string) $request->input('path', ''));
        $fileName = trim((string) $request->input('filename', ''));
        $mime = trim((string) $request->input('mime_type', $request->input('mime', '')));
        $sizeBytes = max(0, (int) $request->input('size_bytes', 0));

        if ($bucket === '') {
            return $this->deny('Bucket wajib diisi', 422);
        }

        if (! in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        if (! $this->objectStorageBrowserDirectEnabledForBucket($bucket)) {
            return response()->json([
                'data' => [
                    'available' => false,
                    'bucket' => $bucket,
                    'provider' => 'api',
                    'providerLabel' => 'Server',
                ],
            ]);
        }

        if ($path === '' || $fileName === '' || $sizeBytes <= 0) {
            return $this->deny('Bucket, path, nama file, dan ukuran file wajib diisi', 422);
        }

        $path = $this->sanitizePath($path);
        if (! $path) {
            return $this->deny('Path tidak valid', 422);
        }

        if (! $this->canWrite($request, $bucket, $path)) {
            return $this->deny('Akses upload ditolak');
        }

        $mime = $this->resolveMetadataMime($fileName, $mime);
        $policyError = $this->validateUploadMetadataPolicy($bucket, $fileName, $mime, $sizeBytes);
        if ($policyError) {
            return $policyError;
        }

        $assignmentSizeError = $this->validateAssignmentMetadataSizePolicy($bucket, $fileName, $sizeBytes);
        if ($assignmentSizeError) {
            return $assignmentSizeError;
        }

        $imageSizeError = $this->validateMetadataImageSizePolicy($bucket, $fileName, $mime, $sizeBytes);
        if ($imageSizeError) {
            return $imageSizeError;
        }

        $quotaError = $this->storageManagementService->assertUploadAllowed(
            (string) ($this->tenantId($request) ?? ''),
            $sizeBytes,
            'object_storage'
        );
        if ($quotaError) {
            return response()->json(['error' => $quotaError], 422);
        }

        $objectKey = $this->buildStoragePath($bucket, $path);
        try {
            $signed = $this->objectStorageSigner->presignPut(
                $objectKey,
                $mime,
                $this->objectStorageSigner->expiresSeconds(),
                $bucket
            );
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Gagal membuat signed upload URL: '.$e->getMessage(),
            ], 422);
        }

        return response()->json([
            'data' => [
                'available' => true,
                'bucket' => $bucket,
                'path' => $path,
                'fullPath' => $path,
                'objectKey' => $objectKey,
                'provider' => 'object_storage',
                'providerLabel' => $this->objectStorageSigner->label(),
                'contentType' => $mime,
                'maxBytes' => $this->maxUploadBytesForBucket($bucket),
                'upload' => [
                    'method' => $signed['method'],
                    'url' => $signed['url'],
                    'headers' => $signed['headers'],
                    'expiresAt' => $signed['expiresAt'],
                ],
            ],
        ]);
    }

    public function confirmUpload(Request $request)
    {
        $bucket = trim((string) $request->input('bucket', ''));
        $path = trim((string) $request->input('path', ''));
        $provider = trim((string) $request->input('provider', 'object_storage')) ?: 'object_storage';
        $fileName = trim((string) $request->input('filename', ''));
        $mime = trim((string) $request->input('mime_type', $request->input('mime', '')));
        $sizeBytes = max(0, (int) $request->input('size_bytes', 0));

        if ($bucket === '' || $path === '' || $sizeBytes <= 0) {
            return $this->deny('Bucket, path, dan ukuran file wajib diisi', 422);
        }
        if (! in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }
        if ($provider !== 'object_storage') {
            return $this->deny('Provider confirm upload tidak valid', 422);
        }
        if (! $this->objectStorageEnabledForBucket($bucket)) {
            return $this->deny('Direct upload untuk bucket ini belum aktif', 422);
        }

        $path = $this->sanitizePath($path);
        if (! $path) {
            return $this->deny('Path tidak valid', 422);
        }
        if (! $this->canWrite($request, $bucket, $path)) {
            return $this->deny('Akses upload ditolak');
        }

        $quotaError = $this->storageManagementService->assertUploadAllowed(
            (string) ($this->tenantId($request) ?? ''),
            $sizeBytes,
            'object_storage'
        );
        if ($quotaError) {
            return response()->json(['error' => $quotaError], 422);
        }

        $objectKey = trim((string) $request->input('object_key'));
        if ($objectKey === '') {
            $objectKey = $this->buildStoragePath($bucket, $path);
        }

        try {
            $verification = $this->objectStorageSigner->verifyUploadedObject($objectKey, $sizeBytes, $bucket);
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Gagal memverifikasi file object storage: '.$e->getMessage(),
            ], 422);
        }

        if (($verification['verified'] ?? false) && ! ($verification['exists'] ?? false)) {
            return response()->json([
                'error' => 'File object storage belum ditemukan. Tunggu upload selesai lalu coba lagi.',
            ], 422);
        }

        if (($verification['verified'] ?? false) && ! ($verification['size_matches'] ?? true)) {
            return response()->json([
                'error' => 'Ukuran file object storage tidak sesuai metadata upload.',
            ], 422);
        }

        $this->storageManagementService->registerUploadedFile($request, [
            'bucket' => $bucket,
            'path' => $path,
            'provider' => $provider,
            'file_name' => $fileName ?: basename($path),
            'mime_type' => $this->resolveMetadataMime($fileName ?: basename($path), $mime),
            'extension' => $this->extensionFromFileName($fileName ?: basename($path)),
            'size_bytes' => $sizeBytes,
            'metadata' => [
                'confirmed_from_client' => true,
                'object_key' => $objectKey,
                'verified' => (bool) ($verification['verified'] ?? false),
                'verified_size_bytes' => $verification['size_bytes'] ?? null,
            ],
        ]);

        return response()->json([
            'data' => [
                'bucket' => $bucket,
                'path' => $path,
                'provider' => $provider,
                'uploadedSizeBytes' => $sizeBytes,
                'uploadedSizeLabel' => $this->formatBytes($sizeBytes),
            ],
        ]);
    }

    public function uploadDestination(Request $request)
    {
        $bucket = trim((string) $request->input('bucket', ''));
        $fileName = trim((string) $request->input('filename', ''));
        $mime = trim((string) $request->input('mime_type', $request->input('mime', '')));

        if ($bucket === '' || $fileName === '') {
            return $this->deny('Bucket dan nama file wajib diisi', 422);
        }

        if (! in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        if ($this->objectStorageEnabledForBucket($bucket)) {
            return response()->json([
                'data' => [
                    'bucket' => $bucket,
                    'provider' => 'object_storage',
                    'providerLabel' => $this->objectStorageSigner->label(),
                ],
            ]);
        }

        $usesDrive = $this->googleDriveService->canUploadStorageFileMetadata(
            $request,
            $bucket,
            $fileName,
            $mime
        );

        return response()->json([
            'data' => [
                'bucket' => $bucket,
                'provider' => $usesDrive ? 'google_drive' : 'local',
                'providerLabel' => $usesDrive ? 'Google Drive' : 'VPS',
            ],
        ]);
    }

    public function remove(Request $request)
    {
        $bucket = $request->input('bucket');
        $paths = $request->input('paths');
        if (! $paths) {
            $path = $request->input('path');
            $paths = $path ? [$path] : [];
        }

        if (! $bucket || empty($paths)) {
            return $this->deny('Bucket dan path wajib diisi', 422);
        }

        if (! in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        $storage = Storage::disk('local');
        foreach ($paths as $path) {
            $rawPath = trim((string) $path);
            if ($this->isDriveBackedBucket($bucket) && $this->googleDriveService->isGoogleDriveUrl($rawPath)) {
                if (! $this->canWriteGoogleDriveUrl($request, $rawPath)) {
                    return $this->deny('Akses hapus Google Drive ditolak');
                }

                try {
                    $this->googleDriveService->deleteStoredFile(
                        (string) ($this->tenantId($request) ?? ''),
                        $rawPath
                    );
                } catch (\Throwable $e) {
                    return response()->json([
                        'error' => 'Gagal menghapus file Google Drive: '.$e->getMessage(),
                    ], 422);
                }

                continue;
            }

            $path = $this->sanitizePath($rawPath);
            if (! $path) {
                continue;
            }

            if (! $this->canWrite($request, $bucket, $path)) {
                return $this->deny('Akses hapus ditolak');
            }

            $fullPath = $this->buildStoragePath($bucket, $path);
            if ($storage->exists($fullPath)) {
                $storage->delete($fullPath);
            }

            if ($this->objectStorageEnabledForBucket($bucket)) {
                try {
                    if (! $this->objectStorageSigner->deleteObject($fullPath, $bucket)) {
                        return response()->json(['error' => 'Gagal menghapus file dari object storage'], 422);
                    }
                } catch (\Throwable $e) {
                    return response()->json([
                        'error' => 'Gagal menghapus file object storage: '.$e->getMessage(),
                    ], 422);
                }
            }

            $this->storageManagementService->markRemoved(
                (string) ($this->tenantId($request) ?? ''),
                $bucket,
                $path
            );
        }

        return response()->json(['data' => 'deleted']);
    }

    public function signed(Request $request)
    {
        $bucket = $request->query('bucket');
        $path = $request->query('path');
        $expiresIn = $this->normalizeExpiresIn($request->query('expires'));

        if (! $bucket || ! $path) {
            return $this->deny('Bucket dan path wajib diisi', 422);
        }

        if (! in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        $path = $this->sanitizePath($path);
        if (! $path) {
            return $this->deny('Path tidak valid', 422);
        }

        if (! $this->canRead($request, $bucket, $path)) {
            return $this->deny('Akses baca ditolak');
        }

        $storage = Storage::disk('local');
        $fullPath = $this->buildStoragePath($bucket, $path);
        if ($this->objectStorageEnabledForBucket($bucket) && ! $storage->exists($fullPath)) {
            try {
                $signed = $this->objectStorageSigner->presignGet($fullPath, $expiresIn, $bucket);

                return response()->json([
                    'data' => [
                        'signedUrl' => $signed['url'],
                        'expiresAt' => $signed['expiresAt'],
                        'provider' => 'object_storage',
                        'providerLabel' => $this->objectStorageSigner->label(),
                    ],
                ]);
            } catch (\Throwable $e) {
                return response()->json([
                    'error' => 'Gagal membuat URL file object storage: '.$e->getMessage(),
                ], 422);
            }
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        $userId = (string) ($request->user()?->id ?? '');
        $expiresAt = now()->addSeconds($expiresIn)->timestamp;
        $signature = $this->signObjectAccess($bucket, $path, $expiresAt, $tenantId, $userId);

        // Return relative path to keep the same browser origin (host+port).
        // This prevents signed URL from accidentally pointing to host port 80 when app runs on custom port.
        $url = '/api/storage/object?bucket='.urlencode($bucket)
            .'&path='.urlencode($path)
            .'&expires='.$expiresAt
            .'&sig='.$signature;

        return response()->json([
            'data' => [
                'signedUrl' => $url,
                'expiresAt' => $expiresAt,
            ],
        ]);
    }

    public function object(Request $request)
    {
        $bucket = $request->query('bucket');
        $path = $request->query('path');
        $expires = $request->query('expires');
        $signature = (string) $request->query('sig', '');

        if (! $bucket || ! $path) {
            return $this->deny('Bucket dan path wajib diisi', 422);
        }

        if (! in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        $rawPath = trim((string) $path);
        if ($this->isDriveBackedBucket((string) $bucket) && $this->googleDriveService->isGoogleDriveUrl($rawPath)) {
            return $this->googleDriveObject($request, (string) $bucket, $rawPath, $expires, $signature);
        }

        $path = $this->sanitizePath($path);
        if (! $path) {
            return $this->deny('Path tidak valid', 422);
        }

        $userId = (string) ($request->user()?->id ?? '');
        if ($userId === '') {
            if (! $this->hasValidObjectSignature($bucket, $path, $expires, $signature, (string) ($this->tenantId($request) ?? ''), '')) {
                return $this->deny('URL file tidak valid atau sudah kedaluwarsa', 403);
            }
        }

        if (! $this->canRead($request, $bucket, $path)) {
            return $this->deny('Akses baca ditolak');
        }

        $storage = Storage::disk('local');
        $fullPath = $this->buildStoragePath($bucket, $path);

        if (! $storage->exists($fullPath)) {
            if ($this->objectStorageEnabledForBucket($bucket)) {
                try {
                    $signed = $this->objectStorageSigner->presignGet($fullPath, $this->normalizeExpiresIn($expires), $bucket);

                    return redirect()->away($signed['url']);
                } catch (\Throwable $e) {
                    return response()->json([
                        'error' => 'Gagal membaca file object storage: '.$e->getMessage(),
                    ], 422);
                }
            }

            return $this->deny('File tidak ditemukan', 404);
        }

        $mime = $storage->mimeType($fullPath) ?: 'application/octet-stream';
        $stream = $storage->readStream($fullPath);
        if (! is_resource($stream)) {
            return $this->deny('Gagal membaca file', 500);
        }

        $filename = str_replace('"', '', basename($path));
        $dispositionType = $this->isInlineRenderableMime($mime) ? 'inline' : 'attachment';
        $cacheControl = $request->user()
            ? 'no-store, private'
            : 'public, max-age=300, stale-while-revalidate=60';

        $headers = [
            'Content-Type' => $mime,
            'Content-Disposition' => $dispositionType.'; filename="'.$filename.'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => $cacheControl,
            'X-Frame-Options' => 'SAMEORIGIN',
        ];
        $size = $storage->size($fullPath);
        if ($size !== false && $size !== null) {
            $headers['Content-Length'] = (string) $size;
        }

        return response()->stream(function () use ($stream) {
            try {
                fpassthru($stream);
            } finally {
                if (is_resource($stream)) {
                    fclose($stream);
                }
            }
        }, 200, $headers);
    }

    private function buildStoragePath(string $bucket, string $path): string
    {
        return 'private/'.$bucket.'/'.ltrim($path, '/');
    }

    private function isDriveBackedBucket(string $bucket): bool
    {
        return in_array($bucket, ['assignments', 'quiz-media'], true);
    }

    private function googleDriveObject(Request $request, string $bucket, string $url, $expires, string $signature)
    {
        $userId = (string) ($request->user()?->id ?? '');
        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($userId === '') {
            if (! $this->hasValidObjectSignature($bucket, $url, $expires, $signature, $tenantId, '')) {
                return $this->deny('URL file tidak valid atau sudah kedaluwarsa', 403);
            }
        }

        if (! $this->canReadGoogleDriveUrl($request, $bucket, $url)) {
            return $this->deny('Akses baca ditolak');
        }

        try {
            $file = $this->googleDriveService->downloadStoredFile($tenantId, $bucket, $url);
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Gagal membaca file Google Drive: '.$e->getMessage(),
            ], 422);
        }

        if (! is_array($file)) {
            return $this->deny('File tidak ditemukan', 404);
        }

        $mime = (string) ($file['mime_type'] ?? 'application/octet-stream');
        $contents = (string) ($file['contents'] ?? '');
        $filename = str_replace('"', '', (string) ($file['filename'] ?? 'file'));
        $dispositionType = $this->isInlineRenderableMime($mime) ? 'inline' : 'attachment';
        $cacheControl = $request->user()
            ? 'no-store, private'
            : 'public, max-age=300, stale-while-revalidate=60';

        return response($contents, 200, [
            'Content-Type' => $mime ?: 'application/octet-stream',
            'Content-Disposition' => $dispositionType.'; filename="'.$filename.'"',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => $cacheControl,
            'X-Frame-Options' => 'SAMEORIGIN',
        ]);
    }

    private function sanitizePath(string $path): ?string
    {
        $path = trim((string) $path);
        if ($path === '') {
            return null;
        }

        $path = str_replace('\\', '/', $path);
        $path = ltrim($path, '/');
        if ($path === '' || strlen($path) > self::MAX_STORAGE_PATH_LENGTH) {
            return null;
        }

        if (str_contains($path, "\0") || str_contains($path, '..') || str_contains($path, '//') || str_contains($path, '://')) {
            return null;
        }

        if (! preg_match('#^[A-Za-z0-9._/\-]+$#', $path)) {
            return null;
        }

        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return null;
            }
            if (str_starts_with($segment, '.')) {
                return null;
            }
        }

        return $path;
    }

    private function canRead(Request $request, string $bucket, string $path): bool
    {
        $user = $request->user();
        $profile = $this->profile($request);
        $userId = $user?->id;
        $tenantId = $this->tenantId($request);

        if ($this->isAdmin($request)) {
            return true;
        }

        if (! $user) {
            // Guest access is limited strictly to school logo path.
            if ($bucket === 'profile-photos' && $this->isLogoPath($request, $path)) {
                return true;
            }

            return false;
        }

        if ($bucket === 'profile-photos') {
            return true;
        }

        if ($bucket === 'assignments') {
            if ($this->isGuru($request) && $userId && Str::startsWith($path, 'tugas_lampiran/'.$userId.'/')) {
                return true;
            }
            if ($this->isSiswa($request) && $userId && preg_match('/^[^\/]+\/'.preg_quote($userId, '/').'-/i', $path)) {
                return true;
            }

            if ($this->isSiswa($request)) {
                $kelas = $profile?->kelas;
                if ($kelas) {
                    $existsQuery = DB::table('tugas')->where('kelas', $kelas);
                    $this->applyTenantScope($existsQuery, 'tugas', $tenantId);
                    $exists = $this->queryHasMatchingPath($existsQuery, 'file_url', $path);
                    if ($exists) {
                        return true;
                    }
                }

                $ownQuery = DB::table('tugas_jawaban')->where('user_id', $userId);
                $this->applyTenantScope($ownQuery, 'tugas_jawaban', $tenantId);
                $own = $this->queryHasMatchingPath($ownQuery, 'file_url', $path);
                if (! $own && Schema::hasColumn('tugas_jawaban', 'file_urls')) {
                    $own = $this->queryHasMatchingPath($ownQuery, 'file_urls', $path);
                }
                if ($own) {
                    return true;
                }
            }

            if ($this->isGuru($request)) {
                $ownAttachmentQuery = DB::table('tugas')->where('created_by', $userId);
                $this->applyTenantScope($ownAttachmentQuery, 'tugas', $tenantId);
                $ownAttachment = $this->queryHasMatchingPath($ownAttachmentQuery, 'file_url', $path);
                if ($ownAttachment) {
                    return true;
                }

                $existsQuery = DB::table('tugas_jawaban')
                    ->join('tugas', 'tugas.id', '=', 'tugas_jawaban.tugas_id')
                    ->where('tugas.created_by', $userId);
                $this->applyTenantScope($existsQuery, 'tugas', $tenantId);
                $this->applyTenantScope($existsQuery, 'tugas_jawaban', $tenantId);
                $exists = $this->queryHasMatchingPath($existsQuery, 'tugas_jawaban.file_url', $path);
                if (! $exists && Schema::hasColumn('tugas_jawaban', 'file_urls')) {
                    $exists = $this->queryHasMatchingPath($existsQuery, 'tugas_jawaban.file_urls', $path);
                }
                if ($exists) {
                    return true;
                }
            }
        }

        if ($bucket === 'quiz-media') {
            // Quiz question media is readable for authenticated users in tenant scope.
            return true;
        }

        if (in_array($bucket, ['certificates', 'sertifikat-files'], true)) {
            $certQuery = DB::table('certificates')->where('user_id', $userId);
            $this->applyTenantScope($certQuery, 'certificates', $tenantId);

            return $this->queryHasMatchingPath($certQuery, 'file_url', $path);
        }

        return false;
    }

    private function canWriteGoogleDriveUrl(Request $request, string $url): bool
    {
        $user = $request->user();
        $userId = $user?->id;
        $tenantId = $this->tenantId($request);

        if (! $user || ! $userId || ! $tenantId) {
            return false;
        }

        if ($this->isAdmin($request)) {
            return true;
        }

        $fileId = $this->googleDriveService->fileIdFromUrl($url);
        if ($fileId === '') {
            return false;
        }

        if (Schema::hasTable('tenant_google_drive_files')) {
            $record = DB::table('tenant_google_drive_files')
                ->where('tenant_id', $tenantId)
                ->where('drive_file_id', $fileId)
                ->first(['uploaded_by_user_id', 'storage_value']);

            if ($record && (string) ($record->uploaded_by_user_id ?? '') === (string) $userId) {
                return true;
            }
        }

        if ($this->isGuru($request)) {
            $ownAttachmentQuery = DB::table('tugas')
                ->where('created_by', $userId)
                ->where('file_url', $url);
            $this->applyTenantScope($ownAttachmentQuery, 'tugas', $tenantId);
            if ($ownAttachmentQuery->exists()) {
                return true;
            }
        }

        if ($this->isSiswa($request)) {
            $ownAnswerQuery = DB::table('tugas_jawaban')
                ->where('user_id', $userId)
                ->where('file_url', $url);
            $this->applyTenantScope($ownAnswerQuery, 'tugas_jawaban', $tenantId);
            if ($ownAnswerQuery->exists()) {
                return true;
            }

            if (Schema::hasColumn('tugas_jawaban', 'file_urls')) {
                $ownAnswerUrlsQuery = DB::table('tugas_jawaban')->where('user_id', $userId);
                $this->applyTenantScope($ownAnswerUrlsQuery, 'tugas_jawaban', $tenantId);
                if ($this->queryHasMatchingPath($ownAnswerUrlsQuery, 'file_urls', $url)) {
                    return true;
                }
            }
        }

        return false;
    }

    private function canReadGoogleDriveUrl(Request $request, string $bucket, string $url): bool
    {
        $user = $request->user();
        $userId = $user?->id;
        $tenantId = $this->tenantId($request);

        if (! $user || ! $userId || ! $tenantId) {
            return false;
        }

        $fileId = $this->googleDriveService->fileIdFromUrl($url);
        if ($fileId === '') {
            return false;
        }

        if (! Schema::hasTable('tenant_google_drive_files')) {
            return false;
        }

        $record = DB::table('tenant_google_drive_files')
            ->where('tenant_id', $tenantId)
            ->where('bucket', $bucket)
            ->where('drive_file_id', $fileId)
            ->first(['uploaded_by_user_id', 'source_path']);

        if (! $record) {
            return false;
        }

        if ($this->isAdmin($request)) {
            return true;
        }

        if ($bucket === 'quiz-media') {
            return true;
        }

        if ((string) ($record->uploaded_by_user_id ?? '') === (string) $userId) {
            return true;
        }

        $sourcePath = trim((string) ($record->source_path ?? ''));
        if ($sourcePath !== '' && ! $this->googleDriveService->isGoogleDriveUrl($sourcePath)) {
            return $this->canRead($request, $bucket, $sourcePath);
        }

        return false;
    }

    private function canWrite(Request $request, string $bucket, string $path): bool
    {
        $user = $request->user();
        $userId = $user?->id;

        if (! $user) {
            return false;
        }
        if ($this->isAdmin($request)) {
            return true;
        }

        if ($bucket === 'profile-photos') {
            return $userId && Str::startsWith($path, 'profiles/'.$userId.'/');
        }

        if ($bucket === 'assignments') {
            if ($this->isGuru($request) && $userId && Str::startsWith($path, 'tugas_lampiran/'.$userId.'/')) {
                return true;
            }
            if ($this->isSiswa($request) && $userId && preg_match('/^[^\/]+\/'.preg_quote($userId, '/').'-/i', $path)) {
                return true;
            }

            return false;
        }

        if ($bucket === 'quiz-media') {
            return $this->isGuru($request) && $userId && Str::startsWith($path, 'quiz-media/'.$userId.'/');
        }

        return false;
    }

    private function isLogoPath(Request $request, string $path): bool
    {
        if ($path === 'logo_sekolah.png') {
            return true;
        }

        $tenantId = $this->tenantId($request);
        $query = DB::table('settings')->orderBy('id');
        if ($tenantId) {
            $this->applyTenantScope($query, 'settings', $tenantId);
        }

        $logoPath = $query->value('logo_path');
        if ($logoPath && $logoPath === $path) {
            return true;
        }

        $logoUrl = $query->value('logo_url');
        if ($logoUrl && $this->matchesStoredPath($logoUrl, $path)) {
            return true;
        }

        $logoLegacy = $query->value('logourl');
        if ($logoLegacy && $this->matchesStoredPath($logoLegacy, $path)) {
            return true;
        }

        return false;
    }

    private function matchesStoredPath(?string $stored, string $path): bool
    {
        if (! $stored) {
            return false;
        }

        $normalizedPath = ltrim(str_replace('\\', '/', $path), '/');
        if ($normalizedPath === '') {
            return false;
        }

        $candidate = trim((string) $stored);
        if ($candidate === '') {
            return false;
        }

        if (str_starts_with($candidate, '[')) {
            $items = json_decode($candidate, true);
            if (is_array($items)) {
                foreach ($items as $item) {
                    if (is_string($item) && $this->matchesStoredPath($item, $path)) {
                        return true;
                    }
                }
            }
        }

        $candidateNormalized = ltrim(str_replace('\\', '/', $candidate), '/');
        if ($candidateNormalized === $normalizedPath) {
            return true;
        }
        if (str_ends_with($candidateNormalized, '/'.$normalizedPath)) {
            return true;
        }

        if (filter_var($candidate, FILTER_VALIDATE_URL)) {
            $parts = parse_url($candidate);
            if (is_array($parts)) {
                $query = (string) ($parts['query'] ?? '');
                if ($query !== '') {
                    parse_str($query, $params);
                    $queryPath = $params['path'] ?? null;
                    if (is_string($queryPath)) {
                        $queryPath = ltrim(str_replace('\\', '/', $queryPath), '/');
                        if ($queryPath === $normalizedPath) {
                            return true;
                        }
                    }
                }

                $urlPath = ltrim(str_replace('\\', '/', (string) ($parts['path'] ?? '')), '/');
                if ($urlPath !== '' && ($urlPath === $normalizedPath || str_ends_with($urlPath, '/'.$normalizedPath))) {
                    return true;
                }
            }
        }

        $decoded = ltrim(str_replace('\\', '/', rawurldecode($candidateNormalized)), '/');
        if ($decoded === $normalizedPath) {
            return true;
        }
        if (str_ends_with($decoded, '/'.$normalizedPath)) {
            return true;
        }

        return false;
    }

    private function queryHasMatchingPath($query, string $column, string $path): bool
    {
        $column = trim($column);
        if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/', $column)) {
            return false;
        }

        $columnAlias = str_contains($column, '.') ? explode('.', $column)[1] : $column;
        $candidateQuery = clone $query;
        $candidateQuery->select($column)->whereNotNull($column);

        foreach ($candidateQuery->cursor() as $row) {
            $stored = (string) ($row->{$columnAlias} ?? '');
            if ($this->matchesStoredPath($stored, $path)) {
                return true;
            }
        }

        return false;
    }

    private function isInlineRenderableMime(string $mime): bool
    {
        $mime = strtolower(trim($mime));
        if ($mime === '') {
            return false;
        }

        if ($mime === 'image/svg+xml') {
            return false;
        }

        if (str_starts_with($mime, 'image/')) {
            return true;
        }

        return in_array($mime, ['application/pdf', 'text/plain'], true);
    }

    private function validateImageSizePolicy(string $bucket, string $path, $file): ?JsonResponse
    {
        if (! $this->isImageUpload($file)) {
            return null;
        }

        $maxBytes = $this->resolveImageMaxBytes($bucket, $path);
        if (! $maxBytes) {
            return null;
        }

        $actualBytes = (int) ($file->getSize() ?: 0);
        if ($actualBytes <= $maxBytes) {
            return null;
        }

        $bucketLabel = $bucket === 'assignments'
            ? 'gambar tugas'
            : ($bucket === 'quiz-media' ? 'gambar quiz' : 'foto profil/logo');

        return response()->json([
            'error' => sprintf(
                'Ukuran %s maksimal %s. File saat ini %s.',
                $bucketLabel,
                $this->formatBytes($maxBytes),
                $this->formatBytes($actualBytes)
            ),
        ], 422);
    }

    private function resolveImageMaxBytes(string $bucket, string $path): ?int
    {
        if ($bucket === 'assignments') {
            return self::ASSIGNMENT_IMAGE_MAX_BYTES;
        }

        if ($bucket === 'profile-photos') {
            if (Str::startsWith($path, 'profiles/') || str_contains(strtolower($path), 'logo')) {
                return self::PROFILE_IMAGE_MAX_BYTES;
            }
        }

        if ($bucket === 'quiz-media') {
            return self::QUIZ_MEDIA_IMAGE_MAX_BYTES;
        }

        return null;
    }

    private function validateQuizMediaTypePolicy(string $bucket, $file): ?JsonResponse
    {
        if ($bucket !== 'quiz-media') {
            return null;
        }
        if (! $file) {
            return response()->json(['error' => 'File gambar wajib diisi'], 422);
        }

        $ext = strtolower((string) $file->getClientOriginalExtension());
        $mime = strtolower((string) ($file->getMimeType() ?: $file->getClientMimeType() ?: ''));
        $allowedExt = ['jpg', 'jpeg', 'png'];
        $allowedMime = ['image/jpeg', 'image/png'];

        if (! in_array($ext, $allowedExt, true)) {
            return response()->json(['error' => 'Format file quiz hanya JPG atau PNG'], 422);
        }

        if ($mime !== '' && ! in_array($mime, $allowedMime, true)) {
            return response()->json(['error' => 'File quiz harus berupa gambar JPG atau PNG'], 422);
        }

        return null;
    }

    private function validateAssignmentFileSizePolicy(
        string $bucket,
        UploadedFile $file,
        bool $usesDrive = false,
        string $messagePrefix = ''
    ): ?JsonResponse {
        if ($bucket !== 'assignments') {
            return null;
        }

        $extension = $this->normalizeExtension($file);
        $maxBytes = null;
        $label = null;

        if (in_array($extension, self::ASSIGNMENT_DOCUMENT_EXTENSIONS, true)) {
            $maxBytes = $usesDrive
                ? self::ASSIGNMENT_DOCUMENT_MAX_BYTES
                : self::ASSIGNMENT_LOCAL_DOCUMENT_MAX_BYTES;
            $label = 'PDF/dokumen';
        } elseif (in_array($extension, self::ASSIGNMENT_PRESENTATION_EXTENSIONS, true)) {
            $maxBytes = $usesDrive
                ? self::ASSIGNMENT_PRESENTATION_MAX_BYTES
                : self::ASSIGNMENT_LOCAL_PRESENTATION_MAX_BYTES;
            $label = 'PPT/presentasi';
        }

        if (! $maxBytes || ! $label) {
            return null;
        }

        $actualBytes = (int) ($file->getSize() ?: 0);
        if ($actualBytes <= $maxBytes) {
            return null;
        }

        return response()->json([
            'error' => $messagePrefix.sprintf(
                'Ukuran %s maksimal %s. File saat ini %s.',
                $label,
                $this->formatBytes($maxBytes),
                $this->formatBytes($actualBytes)
            ),
        ], 422);
    }

    private function validateUploadPolicy(string $bucket, UploadedFile $file): ?JsonResponse
    {
        $policy = self::UPLOAD_POLICY[$bucket] ?? null;
        if (! is_array($policy)) {
            return response()->json(['error' => 'Kebijakan upload untuk bucket ini belum tersedia'], 422);
        }

        $maxBytes = (int) ($policy['max_bytes'] ?? 0);
        $fileBytes = (int) ($file->getSize() ?: 0);
        if ($maxBytes > 0 && $fileBytes > $maxBytes) {
            return response()->json([
                'error' => sprintf(
                    'Ukuran file melebihi batas (%s). Maksimal %s.',
                    $this->formatBytes($fileBytes),
                    $this->formatBytes($maxBytes)
                ),
            ], 422);
        }

        $extension = $this->normalizeExtension($file);
        if ($extension === '' || in_array($extension, self::DANGEROUS_EXTENSIONS, true)) {
            return response()->json(['error' => 'Ekstensi file tidak diizinkan'], 422);
        }

        $allowedExtensions = array_map('strtolower', (array) ($policy['extensions'] ?? []));
        if (! empty($allowedExtensions) && ! in_array($extension, $allowedExtensions, true)) {
            return response()->json(['error' => 'Ekstensi file tidak sesuai kebijakan bucket'], 422);
        }

        $mime = $this->normalizeMime($file);
        if ($mime === '') {
            return response()->json(['error' => 'MIME type file tidak valid'], 422);
        }

        $allowedMimes = array_map('strtolower', (array) ($policy['mimes'] ?? []));
        if (! empty($allowedMimes) && ! in_array($mime, $allowedMimes, true)) {
            return response()->json(['error' => 'Tipe file tidak diizinkan'], 422);
        }

        return null;
    }

    private function validateUploadMetadataPolicy(
        string $bucket,
        string $fileName,
        string $mime,
        int $fileBytes
    ): ?JsonResponse {
        $policy = self::UPLOAD_POLICY[$bucket] ?? null;
        if (! is_array($policy)) {
            return response()->json(['error' => 'Kebijakan upload untuk bucket ini belum tersedia'], 422);
        }

        $maxBytes = (int) ($policy['max_bytes'] ?? 0);
        if ($maxBytes > 0 && $fileBytes > $maxBytes) {
            return response()->json([
                'error' => sprintf(
                    'Ukuran file melebihi batas (%s). Maksimal %s.',
                    $this->formatBytes($fileBytes),
                    $this->formatBytes($maxBytes)
                ),
            ], 422);
        }

        $extension = $this->extensionFromFileName($fileName);
        if ($extension === '' || in_array($extension, self::DANGEROUS_EXTENSIONS, true)) {
            return response()->json(['error' => 'Ekstensi file tidak diizinkan'], 422);
        }

        $allowedExtensions = array_map('strtolower', (array) ($policy['extensions'] ?? []));
        if (! empty($allowedExtensions) && ! in_array($extension, $allowedExtensions, true)) {
            return response()->json(['error' => 'Ekstensi file tidak sesuai kebijakan bucket'], 422);
        }

        $mime = strtolower(trim($mime));
        if ($mime === '') {
            return response()->json(['error' => 'MIME type file tidak valid'], 422);
        }

        $allowedMimes = array_map('strtolower', (array) ($policy['mimes'] ?? []));
        if (! empty($allowedMimes) && ! in_array($mime, $allowedMimes, true)) {
            return response()->json(['error' => 'Tipe file tidak diizinkan'], 422);
        }

        return null;
    }

    private function validateAssignmentMetadataSizePolicy(
        string $bucket,
        string $fileName,
        int $fileBytes
    ): ?JsonResponse {
        if ($bucket !== 'assignments') {
            return null;
        }

        $extension = $this->extensionFromFileName($fileName);
        $maxBytes = null;
        $label = null;

        if (in_array($extension, self::ASSIGNMENT_DOCUMENT_EXTENSIONS, true)) {
            $maxBytes = self::ASSIGNMENT_DOCUMENT_MAX_BYTES;
            $label = 'PDF/dokumen';
        } elseif (in_array($extension, self::ASSIGNMENT_PRESENTATION_EXTENSIONS, true)) {
            $maxBytes = self::ASSIGNMENT_PRESENTATION_MAX_BYTES;
            $label = 'PPT/presentasi';
        }

        if (! $maxBytes || ! $label || $fileBytes <= $maxBytes) {
            return null;
        }

        return response()->json([
            'error' => sprintf(
                'Ukuran %s maksimal %s. File saat ini %s.',
                $label,
                $this->formatBytes($maxBytes),
                $this->formatBytes($fileBytes)
            ),
        ], 422);
    }

    private function validateMetadataImageSizePolicy(
        string $bucket,
        string $fileName,
        string $mime,
        int $fileBytes
    ): ?JsonResponse {
        $extension = $this->extensionFromFileName($fileName);
        $isImage = str_starts_with(strtolower($mime), 'image/')
            || in_array($extension, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif'], true);
        if (! $isImage) {
            return null;
        }

        $maxBytes = $bucket === 'assignments' ? self::ASSIGNMENT_IMAGE_MAX_BYTES : null;
        if (! $maxBytes || $fileBytes <= $maxBytes) {
            return null;
        }

        return response()->json([
            'error' => sprintf(
                'Ukuran gambar tugas maksimal %s. File saat ini %s.',
                $this->formatBytes($maxBytes),
                $this->formatBytes($fileBytes)
            ),
        ], 422);
    }

    private function maxUploadBytesForBucket(string $bucket): int
    {
        return (int) (self::UPLOAD_POLICY[$bucket]['max_bytes'] ?? 0);
    }

    private function objectStorageEnabledForBucket(string $bucket): bool
    {
        return $this->objectStorageSigner->isEnabledForBucket($bucket);
    }

    private function objectStorageBrowserDirectEnabledForBucket(string $bucket): bool
    {
        return $this->objectStorageSigner->isBrowserDirectEnabledForBucket($bucket);
    }

    private function resolveMetadataMime(string $fileName, string $mime): string
    {
        $mime = strtolower(trim($mime));
        if ($mime !== '') {
            return $mime;
        }

        return $this->mimeForExtension($this->extensionFromFileName($fileName));
    }

    private function extensionFromFileName(string $fileName): string
    {
        return strtolower(trim((string) pathinfo($fileName, PATHINFO_EXTENSION)));
    }

    private function mimeForExtension(string $extension): string
    {
        return match (strtolower($extension)) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'pdf' => 'application/pdf',
            'doc' => 'application/msword',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'odt' => 'application/vnd.oasis.opendocument.text',
            'rtf' => 'application/rtf',
            'xls' => 'application/vnd.ms-excel',
            'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt' => 'application/vnd.ms-powerpoint',
            'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'odp' => 'application/vnd.oasis.opendocument.presentation',
            'txt' => 'text/plain',
            default => '',
        };
    }

    private function normalizeMime(UploadedFile $file): string
    {
        return strtolower(trim((string) ($file->getMimeType() ?: $file->getClientMimeType() ?: '')));
    }

    private function normalizeExtension(UploadedFile $file): string
    {
        return strtolower(trim((string) $file->getClientOriginalExtension()));
    }

    private function normalizeExpiresIn($value): int
    {
        if (! is_numeric($value)) {
            return 900;
        }

        return max(
            self::MIN_SIGNED_URL_EXPIRES_SECONDS,
            min(self::MAX_SIGNED_URL_EXPIRES_SECONDS, (int) $value)
        );
    }

    private function signObjectAccess(string $bucket, string $path, int $expiresAt, string $tenantId, string $userId): string
    {
        $payload = implode('|', [$bucket, $path, $expiresAt, $tenantId, $userId]);

        return hash_hmac('sha256', $payload, $this->signatureKey());
    }

    private function hasValidObjectSignature(
        string $bucket,
        string $path,
        $expires,
        string $signature,
        string $tenantId,
        string $userId
    ): bool {
        if (! is_numeric($expires) || $signature === '' || ! preg_match('/^[a-f0-9]{64}$/', $signature)) {
            return false;
        }

        $expiresAt = (int) $expires;
        if ($expiresAt < now()->timestamp || $expiresAt > now()->addSeconds(self::MAX_SIGNED_URL_EXPIRES_SECONDS + 120)->timestamp) {
            return false;
        }

        $expected = $this->signObjectAccess($bucket, $path, $expiresAt, $tenantId, $userId);

        return hash_equals($expected, $signature);
    }

    private function signatureKey(): string
    {
        $appKey = (string) config('app.key', '');
        if (str_starts_with($appKey, 'base64:')) {
            $decoded = base64_decode(substr($appKey, 7), true);
            if ($decoded !== false && $decoded !== '') {
                return $decoded;
            }
        }

        return $appKey !== '' ? $appKey : hash('sha256', __FILE__.php_uname('n'));
    }

    private function isImageUpload($file): bool
    {
        if (! $file) {
            return false;
        }

        $mime = strtolower((string) ($file->getMimeType() ?: $file->getClientMimeType() ?: ''));
        if (str_starts_with($mime, 'image/')) {
            return true;
        }

        $ext = strtolower((string) $file->getClientOriginalExtension());

        return in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif'], true);
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB'];
        $size = $bytes;
        $idx = 0;

        while ($size >= 1024 && $idx < count($units) - 1) {
            $size = $size / 1024;
            $idx++;
        }

        $precision = $idx === 0 ? 0 : 2;

        return round($size, $precision).' '.$units[$idx];
    }

    private function applyTenantScope($query, string $table, ?string $tenantId): void
    {
        if (! $tenantId || ! $this->hasTenantColumn($table)) {
            return;
        }

        $query->where($table.'.tenant_id', $tenantId);
    }

    private function hasTenantColumn(string $table): bool
    {
        if (array_key_exists($table, $this->tenantColumnCache)) {
            return $this->tenantColumnCache[$table];
        }

        try {
            $this->tenantColumnCache[$table] = Schema::hasColumn($table, 'tenant_id');
        } catch (\Throwable $e) {
            $this->tenantColumnCache[$table] = false;
        }

        return $this->tenantColumnCache[$table];
    }
}
