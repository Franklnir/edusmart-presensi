<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class StorageController extends ApiController
{
    private array $tenantColumnCache = [];

    private const PROFILE_IMAGE_MAX_BYTES = 50 * 1024;
    private const ASSIGNMENT_IMAGE_MAX_BYTES = 100 * 1024;

    private array $allowedBuckets = [
        'profile-photos',
        'assignments',
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

        if (!$bucket || !$path || !$file) {
            return $this->deny('Bucket, path, dan file wajib diisi', 422);
        }

        if (!in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        $path = $this->sanitizePath($path);
        if (!$path) return $this->deny('Path tidak valid', 422);

        if (!$this->canWrite($request, $bucket, $path)) {
            return $this->deny('Akses upload ditolak');
        }

        $imageRuleError = $this->validateImageSizePolicy($bucket, $path, $file);
        if ($imageRuleError) {
            return $imageRuleError;
        }

        $storage = Storage::disk('local');
        $fullPath = $this->buildStoragePath($bucket, $path);

        if (!$upsert && $storage->exists($fullPath)) {
            return response()->json(['error' => 'File sudah ada'], 409);
        }

        $storage->put($fullPath, file_get_contents($file->getRealPath()));
        $uploadedSizeBytes = (int) ($storage->size($fullPath) ?: 0);

        return response()->json([
            'data' => [
                'path' => $path,
                'fullPath' => $path,
                'bucket' => $bucket,
                'uploadedSizeBytes' => $uploadedSizeBytes,
                'uploadedSizeLabel' => $this->formatBytes($uploadedSizeBytes),
            ]
        ]);
    }

    public function remove(Request $request)
    {
        $bucket = $request->input('bucket');
        $paths = $request->input('paths');
        if (!$paths) {
            $path = $request->input('path');
            $paths = $path ? [$path] : [];
        }

        if (!$bucket || empty($paths)) {
            return $this->deny('Bucket dan path wajib diisi', 422);
        }

        if (!in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        $storage = Storage::disk('local');
        foreach ($paths as $path) {
            $path = $this->sanitizePath($path);
            if (!$path) continue;

            if (!$this->canWrite($request, $bucket, $path)) {
                return $this->deny('Akses hapus ditolak');
            }

            $fullPath = $this->buildStoragePath($bucket, $path);
            if ($storage->exists($fullPath)) {
                $storage->delete($fullPath);
            }
        }

        return response()->json(['data' => 'deleted']);
    }

    public function signed(Request $request)
    {
        $bucket = $request->query('bucket');
        $path = $request->query('path');

        if (!$bucket || !$path) {
            return $this->deny('Bucket dan path wajib diisi', 422);
        }

        if (!in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        $path = $this->sanitizePath($path);
        if (!$path) return $this->deny('Path tidak valid', 422);

        if (!$this->canRead($request, $bucket, $path)) {
            return $this->deny('Akses baca ditolak');
        }

        // Return relative path to keep the same browser origin (host+port).
        // This prevents signed URL from accidentally pointing to host port 80 when app runs on custom port.
        $url = '/api/storage/object?bucket=' . urlencode($bucket) . '&path=' . urlencode($path);
        return response()->json(['data' => ['signedUrl' => $url]]);
    }

    public function object(Request $request)
    {
        $bucket = $request->query('bucket');
        $path = $request->query('path');

        if (!$bucket || !$path) {
            return $this->deny('Bucket dan path wajib diisi', 422);
        }

        if (!in_array($bucket, $this->allowedBuckets, true)) {
            return $this->deny('Bucket tidak diizinkan', 400);
        }

        $path = $this->sanitizePath($path);
        if (!$path) return $this->deny('Path tidak valid', 422);

        if (!$this->canRead($request, $bucket, $path)) {
            return $this->deny('Akses baca ditolak');
        }

        $storage = Storage::disk('local');
        $fullPath = $this->buildStoragePath($bucket, $path);

        if (!$storage->exists($fullPath)) {
            return $this->deny('File tidak ditemukan', 404);
        }

        $mime = $storage->mimeType($fullPath) ?: 'application/octet-stream';
        $contents = $storage->get($fullPath);
        $filename = str_replace('"', '', basename($path));
        $dispositionType = $this->isInlineRenderableMime($mime) ? 'inline' : 'attachment';

        return response($contents, 200, [
            'Content-Type' => $mime,
            'Content-Disposition' => $dispositionType . '; filename="' . $filename . '"',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function buildStoragePath(string $bucket, string $path): string
    {
        return 'private/' . $bucket . '/' . ltrim($path, '/');
    }

    private function sanitizePath(string $path): ?string
    {
        $path = str_replace('\\', '/', $path);
        $path = ltrim($path, '/');
        if ($path === '' || str_contains($path, '..')) return null;
        return $path;
    }

    private function canRead(Request $request, string $bucket, string $path): bool
    {
        $user = $request->user();
        $profile = $this->profile($request);
        $userId = $user?->id;
        $tenantId = $this->tenantId($request);

        if ($this->isAdmin($request)) return true;

        if (!$user) {
            // allow public read for logo
            return $bucket === 'profile-photos' && $this->isLogoPath($request, $path);
        }

        if ($bucket === 'profile-photos') {
            return true;
        }

        if ($bucket === 'assignments') {
            if ($this->isGuru($request) && $userId && Str::startsWith($path, 'tugas_lampiran/' . $userId . '/')) return true;
            if ($this->isSiswa($request) && $userId && preg_match('/^[^\/]+\/' . preg_quote($userId, '/') . '-/i', $path)) return true;

            if ($this->isSiswa($request)) {
                $kelas = $profile?->kelas;
                if ($kelas) {
                    $existsQuery = DB::table('tugas')->where('kelas', $kelas);
                    $this->applyTenantScope($existsQuery, 'tugas', $tenantId);
                    $exists = $this->queryHasMatchingPath($existsQuery, 'file_url', $path);
                    if ($exists) return true;
                }

                $ownQuery = DB::table('tugas_jawaban')->where('user_id', $userId);
                $this->applyTenantScope($ownQuery, 'tugas_jawaban', $tenantId);
                $own = $this->queryHasMatchingPath($ownQuery, 'file_url', $path);
                if ($own) return true;
            }

            if ($this->isGuru($request)) {
                $ownAttachmentQuery = DB::table('tugas')->where('created_by', $userId);
                $this->applyTenantScope($ownAttachmentQuery, 'tugas', $tenantId);
                $ownAttachment = $this->queryHasMatchingPath($ownAttachmentQuery, 'file_url', $path);
                if ($ownAttachment) return true;

                $existsQuery = DB::table('tugas_jawaban')
                    ->join('tugas', 'tugas.id', '=', 'tugas_jawaban.tugas_id')
                    ->where('tugas.created_by', $userId);
                $this->applyTenantScope($existsQuery, 'tugas', $tenantId);
                $this->applyTenantScope($existsQuery, 'tugas_jawaban', $tenantId);
                $exists = $this->queryHasMatchingPath($existsQuery, 'tugas_jawaban.file_url', $path);
                if ($exists) return true;
            }
        }

        if (in_array($bucket, ['certificates', 'sertifikat-files'], true)) {
            $certQuery = DB::table('certificates')->where('user_id', $userId);
            $this->applyTenantScope($certQuery, 'certificates', $tenantId);
            return $this->queryHasMatchingPath($certQuery, 'file_url', $path);
        }

        return false;
    }

    private function canWrite(Request $request, string $bucket, string $path): bool
    {
        $user = $request->user();
        $userId = $user?->id;

        if (!$user) return false;
        if ($this->isAdmin($request)) return true;

        if ($bucket === 'profile-photos') {
            return $userId && Str::startsWith($path, 'profiles/' . $userId . '/');
        }

        if ($bucket === 'assignments') {
            if ($this->isGuru($request) && $userId && Str::startsWith($path, 'tugas_lampiran/' . $userId . '/')) return true;
            if ($this->isSiswa($request) && $userId && preg_match('/^[^\/]+\/' . preg_quote($userId, '/') . '-/i', $path)) return true;
            return false;
        }

        return false;
    }

    private function isLogoPath(Request $request, string $path): bool
    {
        if ($path === 'logo_sekolah.png') return true;

        $tenantId = $this->tenantId($request);
        $query = DB::table('settings')->orderBy('id');
        if ($tenantId) {
            $this->applyTenantScope($query, 'settings', $tenantId);
        }

        $logoPath = $query->value('logo_path');
        if ($logoPath && $logoPath === $path) return true;

        $logoUrl = $query->value('logo_url');
        if ($logoUrl && $this->matchesStoredPath($logoUrl, $path)) return true;

        $logoLegacy = $query->value('logourl');
        if ($logoLegacy && $this->matchesStoredPath($logoLegacy, $path)) return true;

        return false;
    }

    private function matchesStoredPath(?string $stored, string $path): bool
    {
        if (!$stored) return false;

        $normalizedPath = ltrim(str_replace('\\', '/', $path), '/');
        if ($normalizedPath === '') return false;

        $candidate = trim((string) $stored);
        if ($candidate === '') return false;

        $candidateNormalized = ltrim(str_replace('\\', '/', $candidate), '/');
        if ($candidateNormalized === $normalizedPath) return true;
        if (str_ends_with($candidateNormalized, '/' . $normalizedPath)) return true;

        if (filter_var($candidate, FILTER_VALIDATE_URL)) {
            $parts = parse_url($candidate);
            if (is_array($parts)) {
                $query = (string) ($parts['query'] ?? '');
                if ($query !== '') {
                    parse_str($query, $params);
                    $queryPath = $params['path'] ?? null;
                    if (is_string($queryPath)) {
                        $queryPath = ltrim(str_replace('\\', '/', $queryPath), '/');
                        if ($queryPath === $normalizedPath) return true;
                    }
                }

                $urlPath = ltrim(str_replace('\\', '/', (string) ($parts['path'] ?? '')), '/');
                if ($urlPath !== '' && ($urlPath === $normalizedPath || str_ends_with($urlPath, '/' . $normalizedPath))) {
                    return true;
                }
            }
        }

        $decoded = ltrim(str_replace('\\', '/', rawurldecode($candidateNormalized)), '/');
        if ($decoded === $normalizedPath) return true;
        if (str_ends_with($decoded, '/' . $normalizedPath)) return true;

        return false;
    }

    private function queryHasMatchingPath($query, string $column, string $path): bool
    {
        $alias = 'matched_path_value';
        $candidateQuery = clone $query;
        $candidateQuery->selectRaw($column . ' as ' . $alias)->whereNotNull($column);

        foreach ($candidateQuery->cursor() as $row) {
            $stored = (string) ($row->{$alias} ?? '');
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

    private function validateImageSizePolicy(string $bucket, string $path, $file): ?\Illuminate\Http\JsonResponse
    {
        if (!$this->isImageUpload($file)) {
            return null;
        }

        $maxBytes = $this->resolveImageMaxBytes($bucket, $path);
        if (!$maxBytes) {
            return null;
        }

        $actualBytes = (int) ($file->getSize() ?: 0);
        if ($actualBytes <= $maxBytes) {
            return null;
        }

        $bucketLabel = $bucket === 'assignments'
            ? 'gambar tugas'
            : 'foto profil/logo';

        return response()->json([
            'error' => sprintf(
                'Ukuran %s maksimal %s. File saat ini %s.',
                $bucketLabel,
                $this->formatBytes($maxBytes),
                $this->formatBytes($actualBytes)
            )
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

        return null;
    }

    private function isImageUpload($file): bool
    {
        if (!$file) return false;

        $mime = strtolower((string) ($file->getMimeType() ?: $file->getClientMimeType() ?: ''));
        if (str_starts_with($mime, 'image/')) {
            return true;
        }

        $ext = strtolower((string) $file->getClientOriginalExtension());
        return in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif'], true);
    }

    private function formatBytes(int $bytes): string
    {
        if ($bytes <= 0) return '0 B';

        $units = ['B', 'KB', 'MB', 'GB'];
        $size = $bytes;
        $idx = 0;

        while ($size >= 1024 && $idx < count($units) - 1) {
            $size = $size / 1024;
            $idx++;
        }

        $precision = $idx === 0 ? 0 : 2;
        return round($size, $precision) . ' ' . $units[$idx];
    }

    private function applyTenantScope($query, string $table, ?string $tenantId): void
    {
        if (!$tenantId || !$this->hasTenantColumn($table)) {
            return;
        }

        $query->where($table . '.tenant_id', $tenantId);
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
