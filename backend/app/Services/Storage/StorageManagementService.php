<?php

namespace App\Services\Storage;

use App\Support\AcademicPeriod;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class StorageManagementService
{
    private const MANAGED_STATUSES = ['active', 'trash'];

    private const CATEGORY_LABELS = [
        'tugas' => 'Tugas',
        'kuis' => 'Kuis',
        'materi' => 'Materi',
        'video' => 'Video',
        'dokumen' => 'Dokumen',
        'lampiran' => 'Lampiran',
        'arsip' => 'Arsip',
        'profil' => 'Profil',
        'sertifikat' => 'Sertifikat',
    ];

    public function tablesReady(): bool
    {
        return Schema::hasTable('tenant_storage_quotas')
            && Schema::hasTable('storage_files')
            && Schema::hasTable('storage_cleanup_jobs');
    }

    public function serverCapacity(): array
    {
        $path = storage_path('app');
        $total = @disk_total_space($path);
        $free = @disk_free_space($path);
        $totalBytes = is_numeric($total) ? (int) $total : 0;
        $freeBytes = is_numeric($free) ? (int) $free : 0;
        $usedBytes = max(0, $totalBytes - $freeBytes);
        $allocatedBytes = $this->allocatedQuotaBytes();

        return [
            'total_bytes' => $totalBytes,
            'total_label' => $this->formatBytes($totalBytes),
            'used_bytes' => $usedBytes,
            'used_label' => $this->formatBytes($usedBytes),
            'free_bytes' => $freeBytes,
            'free_label' => $this->formatBytes($freeBytes),
            'allocated_quota_bytes' => $allocatedBytes,
            'allocated_quota_label' => $this->formatBytes($allocatedBytes),
            'remaining_after_allocated_bytes' => max(0, $totalBytes - $allocatedBytes),
            'remaining_after_allocated_label' => $this->formatBytes(max(0, $totalBytes - $allocatedBytes)),
            'disk_percent' => $totalBytes > 0 ? round(($usedBytes / $totalBytes) * 100, 2) : 0,
        ];
    }

    public function quotaForTenant(string $tenantId): array
    {
        $row = $this->tablesReady()
            ? DB::table('tenant_storage_quotas')->where('tenant_id', $tenantId)->first()
            : null;

        $quotaBytes = $row?->quota_bytes !== null ? (int) $row->quota_bytes : null;
        $maxUploadBytes = $row?->max_upload_bytes !== null ? (int) $row->max_upload_bytes : null;
        $usedBytes = $this->tenantUsedBytes($tenantId);
        $remainingBytes = $quotaBytes !== null ? max(0, $quotaBytes - $usedBytes) : null;

        return [
            'quota_bytes' => $quotaBytes,
            'quota_label' => $quotaBytes !== null ? $this->formatBytes($quotaBytes) : 'Tidak dibatasi',
            'max_upload_bytes' => $maxUploadBytes,
            'max_upload_label' => $maxUploadBytes !== null ? $this->formatBytes($maxUploadBytes) : 'Default sistem',
            'used_bytes' => $usedBytes,
            'used_label' => $this->formatBytes($usedBytes),
            'remaining_bytes' => $remainingBytes,
            'remaining_label' => $remainingBytes !== null ? $this->formatBytes($remainingBytes) : 'Tidak dibatasi',
            'percent' => $quotaBytes && $quotaBytes > 0 ? round(min(100, ($usedBytes / $quotaBytes) * 100), 2) : null,
            'notes' => $row?->notes ?? null,
        ];
    }

    public function assertUploadAllowed(string $tenantId, int $incomingBytes): ?string
    {
        if ($tenantId === '' || $incomingBytes <= 0 || ! $this->tablesReady()) {
            return null;
        }

        $quota = $this->quotaForTenant($tenantId);
        $maxUploadBytes = $quota['max_upload_bytes'];
        if ($maxUploadBytes !== null && $incomingBytes > $maxUploadBytes) {
            return 'Ukuran file melebihi batas upload sekolah (maksimal '.$this->formatBytes($maxUploadBytes).').';
        }

        $quotaBytes = $quota['quota_bytes'];
        if ($quotaBytes !== null && ($quota['used_bytes'] + $incomingBytes) > $quotaBytes) {
            return 'Kuota storage sekolah penuh. Sisa kuota '.$quota['remaining_label'].'.';
        }

        return null;
    }

    public function registerUploadedFile(Request $request, array $payload): void
    {
        if (! $this->tablesReady()) {
            return;
        }

        $tenantId = trim((string) ($payload['tenant_id'] ?? $request->attributes->get('tenant_id', '')));
        $bucket = trim((string) ($payload['bucket'] ?? ''));
        $path = $this->normalizeObjectPath((string) ($payload['path'] ?? ''));
        $provider = trim((string) ($payload['provider'] ?? 'local')) ?: 'local';
        if ($tenantId === '' || $bucket === '' || $path === '' || $provider === 'google_drive') {
            return;
        }

        $fileName = trim((string) ($payload['file_name'] ?? basename($path)));
        $mime = trim((string) ($payload['mime_type'] ?? ''));
        $extension = strtolower(trim((string) ($payload['extension'] ?? pathinfo($fileName ?: $path, PATHINFO_EXTENSION))));
        $sizeBytes = max(0, (int) ($payload['size_bytes'] ?? 0));
        $snapshot = $this->academicSnapshotForFile($tenantId, $bucket, $path, $payload);
        $category = $this->categoryForFile($bucket, $path, $mime, $extension, $payload['category'] ?? null);
        $user = $request->user();
        $role = $this->profileRole((string) ($user?->id ?? ''), $tenantId);
        $now = now();

        $identity = [
            'tenant_id' => $tenantId,
            'bucket' => $bucket,
            'path_hash' => $this->pathHash($path),
        ];
        $existingId = DB::table('storage_files')->where($identity)->value('id');
        $values = [
            'path' => $path,
            'provider' => $provider,
            'category' => $category,
            'file_name' => $fileName ?: null,
            'mime_type' => $mime ?: null,
            'extension' => $extension ?: null,
            'size_bytes' => $sizeBytes,
            'uploaded_by_user_id' => $user?->id,
            'uploaded_by_role' => $role ?: null,
            'source_table' => $payload['source_table'] ?? $snapshot['source_table'] ?? null,
            'source_id' => $payload['source_id'] ?? $snapshot['source_id'] ?? null,
            'tahun_ajaran' => $snapshot['tahun_ajaran'] ?? null,
            'semester' => $snapshot['semester'] ?? null,
            'periode_key' => $snapshot['periode_key'] ?? null,
            'kelas' => $snapshot['kelas'] ?? null,
            'status' => 'active',
            'uploaded_at' => $payload['uploaded_at'] ?? $now,
            'trashed_at' => null,
            'trash_expires_at' => null,
            'deleted_at' => null,
            'trash_path' => null,
            'duplicate_key' => $this->duplicateKey($fileName, $mime, $sizeBytes),
            'metadata' => json_encode($payload['metadata'] ?? [], JSON_UNESCAPED_SLASHES),
            'updated_at' => $now,
        ];
        if (! $existingId) {
            $values['id'] = (string) ($payload['id'] ?? Str::uuid());
            $values['created_at'] = $now;
        }

        DB::table('storage_files')->updateOrInsert($identity, $values);
    }

    public function markRemoved(string $tenantId, string $bucket, string $path): void
    {
        if (! $this->tablesReady()) {
            return;
        }

        $path = $this->normalizeObjectPath($path);
        if ($tenantId === '' || $bucket === '' || $path === '') {
            return;
        }

        DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->where('bucket', $bucket)
            ->where('path_hash', $this->pathHash($path))
            ->update([
                'status' => 'deleted',
                'deleted_at' => now(),
                'updated_at' => now(),
            ]);
    }

    public function superOverview(): array
    {
        $tenantRows = Schema::hasTable('tenants')
            ? DB::table('tenants')->select('id', 'name', 'slug', 'status')->orderBy('name')->get()
            : collect();

        $tenants = $tenantRows->map(function ($tenant) {
            $summary = $this->tenantSummary((string) $tenant->id);

            return [
                'id' => $tenant->id,
                'name' => $tenant->name,
                'slug' => $tenant->slug,
                'status' => $tenant->status,
                'quota' => $summary['quota'],
                'usage' => $summary['usage'],
                'top_category' => $summary['top_category'],
                'prediction' => $summary['prediction'],
            ];
        })->values()->all();

        $totalUsed = array_sum(array_map(fn ($row) => (int) ($row['usage']['total_bytes'] ?? 0), $tenants));
        $topTenants = collect($tenants)
            ->sortByDesc(fn ($row) => (int) ($row['usage']['total_bytes'] ?? 0))
            ->take(8)
            ->values()
            ->all();

        return [
            'server' => $this->serverCapacity(),
            'total_used_bytes' => $totalUsed,
            'total_used_label' => $this->formatBytes($totalUsed),
            'tenant_count' => count($tenants),
            'tenants' => $tenants,
            'top_tenants' => $topTenants,
            'by_category' => $this->globalCategoryStats(),
            'computed_at' => now()->toIso8601String(),
        ];
    }

    public function tenantSummary(string $tenantId, array $filters = []): array
    {
        $usage = $this->tenantUsage($tenantId, $filters);
        $quota = $this->quotaForTenant($tenantId);
        $recommendations = $this->recommendations($tenantId, $usage, $quota);
        $largest = $this->largestFiles($tenantId, $filters);
        $byUser = $this->byUploader($tenantId, $filters);
        $duplicates = $this->duplicateGroups($tenantId);

        return [
            'quota' => $quota,
            'usage' => $usage,
            'top_category' => $usage['by_category'][0] ?? null,
            'largest_files' => $largest,
            'by_uploader' => $byUser,
            'duplicates' => $duplicates,
            'recommendations' => $recommendations,
            'prediction' => $this->fullPrediction($tenantId, $quota),
            'trash' => $this->trashSummary($tenantId),
            'trash_files' => $this->trashFiles($tenantId),
            'active_period' => $this->activePeriod($tenantId),
            'computed_at' => now()->toIso8601String(),
        ];
    }

    public function updateQuota(string $tenantId, array $payload, ?string $userId = null): array
    {
        if (! $this->tablesReady()) {
            return $this->quotaForTenant($tenantId);
        }

        $now = now();
        $exists = DB::table('tenant_storage_quotas')->where('tenant_id', $tenantId)->exists();
        $values = [
            'quota_bytes' => $this->nullableBytes($payload['quota_bytes'] ?? null),
            'max_upload_bytes' => $this->nullableBytes($payload['max_upload_bytes'] ?? null),
            'notes' => trim((string) ($payload['notes'] ?? '')) ?: null,
            'updated_by_user_id' => $userId,
            'updated_at' => $now,
        ];
        if (! $exists) {
            $values['id'] = (string) ($payload['id'] ?? Str::uuid());
            $values['created_at'] = $now;
        }

        DB::table('tenant_storage_quotas')->updateOrInsert(['tenant_id' => $tenantId], $values);

        return $this->quotaForTenant($tenantId);
    }

    public function cleanupPreview(string $tenantId, array $filters = []): array
    {
        $validation = $this->validateCleanupScope($tenantId, $filters);
        if ($validation !== null) {
            return [
                'allowed' => false,
                'message' => $validation,
                'files' => 0,
                'bytes' => 0,
                'bytes_label' => '0 B',
                'candidates' => [],
            ];
        }

        $candidates = $this->cleanupCandidates($tenantId, $filters);
        $bytes = array_sum(array_map(fn ($row) => (int) ($row['size_bytes'] ?? 0), $candidates));

        return [
            'allowed' => true,
            'message' => 'Cleanup aman untuk diproses ke Trash.',
            'files' => count($candidates),
            'bytes' => $bytes,
            'bytes_label' => $this->formatBytes($bytes),
            'candidates' => array_slice($candidates, 0, 50),
        ];
    }

    public function executeCleanup(string $tenantId, array $filters = [], ?string $userId = null, bool $backup = true): array
    {
        $preview = $this->cleanupPreview($tenantId, $filters);
        if (! ($preview['allowed'] ?? false)) {
            return [
                'ok' => false,
                'message' => $preview['message'] ?? 'Cleanup tidak diizinkan.',
                'preview' => $preview,
            ];
        }

        $candidates = $this->cleanupCandidates($tenantId, $filters);
        $backupPath = $backup ? $this->createCleanupBackup($tenantId, $candidates) : null;
        $now = now();
        $trashExpiresAt = $now->copy()->addDays(30);
        $affectedBytes = 0;
        $affectedFiles = 0;

        foreach ($candidates as $file) {
            $affectedBytes += (int) ($file['size_bytes'] ?? 0);
            $affectedFiles++;
            $trashPath = $this->moveLocalFileToTrash($tenantId, $file);

            DB::table('storage_files')
                ->where('id', $file['id'])
                ->where('tenant_id', $tenantId)
                ->update([
                    'status' => 'trash',
                    'trashed_at' => $now,
                    'trash_expires_at' => $trashExpiresAt,
                    'trash_path' => $trashPath,
                    'updated_at' => $now,
                ]);
        }

        $jobId = (string) Str::uuid();
        DB::table('storage_cleanup_jobs')->insert([
            'id' => $jobId,
            'tenant_id' => $tenantId,
            'requested_by_user_id' => $userId,
            'requested_by_role' => $this->profileRole((string) $userId, $tenantId),
            'mode' => trim((string) ($filters['mode'] ?? 'cleanup')),
            'status' => 'trashed',
            'filters' => json_encode($filters, JSON_UNESCAPED_SLASHES),
            'preview' => json_encode($preview, JSON_UNESCAPED_SLASHES),
            'affected_files' => $affectedFiles,
            'affected_bytes' => $affectedBytes,
            'backup_path' => $backupPath,
            'executed_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [
            'ok' => true,
            'job_id' => $jobId,
            'files' => $affectedFiles,
            'bytes' => $affectedBytes,
            'bytes_label' => $this->formatBytes($affectedBytes),
            'backup_path' => $backupPath,
            'trash_expires_at' => $trashExpiresAt->toIso8601String(),
        ];
    }

    public function restoreFile(string $tenantId, string $fileId): bool
    {
        if (! $this->tablesReady()) {
            return false;
        }

        $file = DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->where('id', $fileId)
            ->where('status', 'trash')
            ->first();
        if (! $file) {
            return false;
        }

        $storage = Storage::disk('local');
        $trashPath = trim((string) ($file->trash_path ?? ''));
        $originalPath = 'private/'.$file->bucket.'/'.ltrim((string) $file->path, '/');
        if ($trashPath !== '' && $storage->exists($trashPath) && ! $storage->exists($originalPath)) {
            $storage->move($trashPath, $originalPath);
        }

        DB::table('storage_files')->where('id', $fileId)->update([
            'status' => 'active',
            'trashed_at' => null,
            'trash_expires_at' => null,
            'trash_path' => null,
            'updated_at' => now(),
        ]);

        return true;
    }

    public function purgeExpiredTrash(): array
    {
        if (! $this->tablesReady()) {
            return ['files' => 0, 'bytes' => 0, 'bytes_label' => '0 B'];
        }

        $rows = DB::table('storage_files')
            ->where('status', 'trash')
            ->whereNotNull('trash_expires_at')
            ->where('trash_expires_at', '<=', now())
            ->limit(500)
            ->get();

        $storage = Storage::disk('local');
        $files = 0;
        $bytes = 0;
        foreach ($rows as $row) {
            $trashPath = trim((string) ($row->trash_path ?? ''));
            if ($trashPath !== '' && $storage->exists($trashPath)) {
                $storage->delete($trashPath);
            }
            $bytes += (int) ($row->size_bytes ?? 0);
            $files++;
            DB::table('storage_files')->where('id', $row->id)->update([
                'status' => 'deleted',
                'deleted_at' => now(),
                'updated_at' => now(),
            ]);
        }

        return [
            'files' => $files,
            'bytes' => $bytes,
            'bytes_label' => $this->formatBytes($bytes),
        ];
    }

    public function formatBytes(int $bytes): string
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

    private function tenantUsage(string $tenantId, array $filters = []): array
    {
        $localRows = $this->tablesReady()
            ? $this->storageRowsQuery($tenantId, $filters)
                ->select('category')
                ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
                ->groupBy('category')
                ->get()
                ->map(fn ($row) => [
                    'category' => (string) ($row->category ?? 'dokumen'),
                    'bytes' => (int) ($row->bytes ?? 0),
                    'files' => (int) ($row->files ?? 0),
                ])
            : collect();

        $driveRows = $this->driveCategoryRows($tenantId, $filters);
        $merged = [];
        foreach ($localRows->merge($driveRows) as $row) {
            $category = $row['category'] ?: 'dokumen';
            $merged[$category] ??= ['category' => $category, 'bytes' => 0, 'files' => 0];
            $merged[$category]['bytes'] += (int) $row['bytes'];
            $merged[$category]['files'] += (int) $row['files'];
        }

        $byCategory = collect(array_values($merged))
            ->map(fn ($row) => [
                ...$row,
                'label' => self::CATEGORY_LABELS[$row['category']] ?? Str::title($row['category']),
                'bytes_label' => $this->formatBytes((int) $row['bytes']),
            ])
            ->sortByDesc('bytes')
            ->values()
            ->all();

        $totalBytes = array_sum(array_map(fn ($row) => (int) $row['bytes'], $byCategory));
        $totalFiles = array_sum(array_map(fn ($row) => (int) $row['files'], $byCategory));

        return [
            'total_bytes' => $totalBytes,
            'total_label' => $this->formatBytes($totalBytes),
            'total_files' => $totalFiles,
            'by_category' => $byCategory,
            'by_period' => $this->periodStats($tenantId, $filters),
        ];
    }

    private function tenantUsedBytes(string $tenantId): int
    {
        if ($tenantId === '') {
            return 0;
        }

        $bytes = 0;
        if ($this->tablesReady()) {
            $bytes += (int) DB::table('storage_files')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', self::MANAGED_STATUSES)
                ->sum('size_bytes');
        }
        if (Schema::hasTable('tenant_google_drive_files')) {
            $bytes += (int) DB::table('tenant_google_drive_files')
                ->where('tenant_id', $tenantId)
                ->sum('size_bytes');
        }

        return $bytes;
    }

    private function storageRowsQuery(string $tenantId, array $filters = [])
    {
        $query = DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', self::MANAGED_STATUSES);

        foreach (['category', 'tahun_ajaran', 'semester', 'uploaded_by_user_id'] as $field) {
            $value = trim((string) ($filters[$field] ?? ''));
            if ($value !== '' && $value !== 'all') {
                $query->where($field, $value);
            }
        }

        $minBytes = isset($filters['min_bytes']) ? (int) $filters['min_bytes'] : 0;
        if ($minBytes > 0) {
            $query->where('size_bytes', '>=', $minBytes);
        }

        return $query;
    }

    private function driveCategoryRows(string $tenantId, array $filters = [])
    {
        if (! Schema::hasTable('tenant_google_drive_files')) {
            return collect();
        }

        $query = DB::table('tenant_google_drive_files')
            ->where('tenant_id', $tenantId);
        foreach (['tahun_ajaran', 'semester', 'uploaded_by_user_id'] as $field) {
            $value = trim((string) ($filters[$field] ?? ''));
            if ($value !== '' && $value !== 'all' && Schema::hasColumn('tenant_google_drive_files', $field)) {
                $query->where($field, $value);
            }
        }
        $category = trim((string) ($filters['category'] ?? ''));
        if ($category !== '' && $category !== 'all') {
            $bucket = $category === 'kuis' ? 'quiz-media' : ($category === 'tugas' || $category === 'lampiran' ? 'assignments' : '');
            if ($bucket !== '') {
                $query->where('bucket', $bucket);
            }
        }

        return $query
            ->select('bucket')
            ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
            ->groupBy('bucket')
            ->get()
            ->map(fn ($row) => [
                'category' => $this->categoryForFile((string) ($row->bucket ?? ''), '', '', '', null),
                'bytes' => (int) ($row->bytes ?? 0),
                'files' => (int) ($row->files ?? 0),
            ]);
    }

    private function periodStats(string $tenantId, array $filters = []): array
    {
        $rows = $this->tablesReady()
            ? $this->storageRowsQuery($tenantId, $filters)
                ->select('tahun_ajaran', 'semester')
                ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
                ->groupBy('tahun_ajaran', 'semester')
                ->get()
                ->map(fn ($row) => [
                    'tahun_ajaran' => (string) ($row->tahun_ajaran ?? ''),
                    'semester' => (string) ($row->semester ?? ''),
                    'bytes' => (int) ($row->bytes ?? 0),
                    'files' => (int) ($row->files ?? 0),
                ])
            : collect();

        if (Schema::hasTable('tenant_google_drive_files')) {
            $drive = DB::table('tenant_google_drive_files')
                ->where('tenant_id', $tenantId)
                ->select('tahun_ajaran', 'semester')
                ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
                ->groupBy('tahun_ajaran', 'semester')
                ->get()
                ->map(fn ($row) => [
                    'tahun_ajaran' => (string) ($row->tahun_ajaran ?? ''),
                    'semester' => (string) ($row->semester ?? ''),
                    'bytes' => (int) ($row->bytes ?? 0),
                    'files' => (int) ($row->files ?? 0),
                ]);
            $rows = $rows->merge($drive);
        }

        $merged = [];
        foreach ($rows as $row) {
            $key = ($row['tahun_ajaran'] ?: '-').'|'.($row['semester'] ?: '-');
            $merged[$key] ??= [
                'tahun_ajaran' => $row['tahun_ajaran'],
                'semester' => $row['semester'],
                'bytes' => 0,
                'files' => 0,
            ];
            $merged[$key]['bytes'] += $row['bytes'];
            $merged[$key]['files'] += $row['files'];
        }

        return collect(array_values($merged))
            ->map(fn ($row) => [
                ...$row,
                'bytes_label' => $this->formatBytes((int) $row['bytes']),
            ])
            ->sortByDesc('bytes')
            ->values()
            ->all();
    }

    private function largestFiles(string $tenantId, array $filters = []): array
    {
        if (! $this->tablesReady()) {
            return [];
        }

        return $this->storageRowsQuery($tenantId, $filters)
            ->orderByDesc('size_bytes')
            ->limit(15)
            ->get()
            ->map(fn ($row) => $this->fileRowPayload($row))
            ->all();
    }

    private function byUploader(string $tenantId, array $filters = []): array
    {
        if (! $this->tablesReady()) {
            return [];
        }

        $query = $this->storageRowsQuery($tenantId, $filters)
            ->leftJoin('profiles as p', 'p.id', '=', 'storage_files.uploaded_by_user_id')
            ->select('storage_files.uploaded_by_user_id', 'p.nama', 'p.email', 'p.role')
            ->selectRaw('coalesce(sum(storage_files.size_bytes), 0) as bytes, count(*) as files')
            ->groupBy('storage_files.uploaded_by_user_id', 'p.nama', 'p.email', 'p.role')
            ->orderByDesc('bytes')
            ->limit(12);

        return $query->get()->map(fn ($row) => [
            'user_id' => $row->uploaded_by_user_id,
            'nama' => $row->nama ?: 'Tidak diketahui',
            'email' => $row->email,
            'role' => $row->role,
            'bytes' => (int) ($row->bytes ?? 0),
            'bytes_label' => $this->formatBytes((int) ($row->bytes ?? 0)),
            'files' => (int) ($row->files ?? 0),
        ])->all();
    }

    private function duplicateGroups(string $tenantId): array
    {
        if (! $this->tablesReady()) {
            return [];
        }

        return DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNotNull('duplicate_key')
            ->select('duplicate_key')
            ->selectRaw('count(*) as files, coalesce(sum(size_bytes), 0) as bytes, max(file_name) as sample_name')
            ->groupBy('duplicate_key')
            ->havingRaw('count(*) > 1')
            ->orderByDesc('bytes')
            ->limit(10)
            ->get()
            ->map(fn ($row) => [
                'duplicate_key' => $row->duplicate_key,
                'sample_name' => $row->sample_name,
                'files' => (int) ($row->files ?? 0),
                'bytes' => (int) ($row->bytes ?? 0),
                'bytes_label' => $this->formatBytes((int) ($row->bytes ?? 0)),
            ])
            ->all();
    }

    private function trashSummary(string $tenantId): array
    {
        if (! $this->tablesReady()) {
            return ['files' => 0, 'bytes' => 0, 'bytes_label' => '0 B'];
        }

        $row = DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->where('status', 'trash')
            ->selectRaw('count(*) as files, coalesce(sum(size_bytes), 0) as bytes')
            ->first();

        return [
            'files' => (int) ($row->files ?? 0),
            'bytes' => (int) ($row->bytes ?? 0),
            'bytes_label' => $this->formatBytes((int) ($row->bytes ?? 0)),
        ];
    }

    private function trashFiles(string $tenantId): array
    {
        if (! $this->tablesReady()) {
            return [];
        }

        return DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->where('status', 'trash')
            ->orderByDesc('trashed_at')
            ->limit(20)
            ->get()
            ->map(fn ($row) => [
                ...$this->fileRowPayload($row),
                'trashed_at' => $row->trashed_at ?? null,
                'trash_expires_at' => $row->trash_expires_at ?? null,
            ])
            ->all();
    }

    private function recommendations(string $tenantId, array $usage, array $quota): array
    {
        $recommendations = [];
        $largestPeriod = $usage['by_period'][0] ?? null;
        if ($largestPeriod && (int) ($largestPeriod['bytes'] ?? 0) > 0) {
            $recommendations[] = [
                'type' => 'period',
                'severity' => 'info',
                'message' => 'Periode '.$largestPeriod['tahun_ajaran'].' '.$largestPeriod['semester'].' memakai '.$largestPeriod['bytes_label'].' storage.',
            ];
        }

        $topCategory = $usage['by_category'][0] ?? null;
        if ($topCategory) {
            $recommendations[] = [
                'type' => 'category',
                'severity' => (int) ($topCategory['bytes'] ?? 0) > 1024 * 1024 * 1024 ? 'warning' : 'info',
                'message' => 'Kategori terbesar saat ini: '.$topCategory['label'].' ('.$topCategory['bytes_label'].').',
            ];
        }

        if (($quota['percent'] ?? 0) >= 85) {
            $recommendations[] = [
                'type' => 'quota',
                'severity' => 'danger',
                'message' => 'Storage sekolah sudah melewati 85%. Jadwalkan cleanup semester lama atau tambah kuota.',
            ];
        }

        $prediction = $this->fullPrediction($tenantId, $quota);
        if (($prediction['days_until_full'] ?? null) !== null && $prediction['days_until_full'] <= 30) {
            $recommendations[] = [
                'type' => 'prediction',
                'severity' => 'warning',
                'message' => 'Dengan pertumbuhan saat ini, storage diprediksi penuh sekitar '.$prediction['days_until_full'].' hari lagi.',
            ];
        }

        return $recommendations;
    }

    private function fullPrediction(string $tenantId, array $quota): array
    {
        $quotaBytes = $quota['quota_bytes'] ?? null;
        $remaining = $quota['remaining_bytes'] ?? null;
        if (! $quotaBytes || $remaining === null || ! $this->tablesReady()) {
            return ['daily_growth_bytes' => 0, 'daily_growth_label' => '0 B', 'days_until_full' => null];
        }

        $since = now()->subDays(30);
        $recentBytes = (int) DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('uploaded_at', '>=', $since)
            ->sum('size_bytes');
        $daily = (int) ceil($recentBytes / 30);
        $days = $daily > 0 ? (int) floor($remaining / $daily) : null;

        return [
            'daily_growth_bytes' => $daily,
            'daily_growth_label' => $this->formatBytes($daily),
            'days_until_full' => $days,
        ];
    }

    private function cleanupCandidates(string $tenantId, array $filters): array
    {
        if (! $this->tablesReady()) {
            return [];
        }

        $query = $this->storageRowsQuery($tenantId, $filters)->where('status', 'active');
        $active = $this->activePeriod($tenantId);
        $activeYear = $active['tahun_ajaran'] ?? null;
        $activeSemester = $active['semester'] ?? null;
        if ($activeYear && $activeSemester) {
            $query->where(function ($periodQuery) use ($activeYear, $activeSemester) {
                $periodQuery
                    ->whereNull('tahun_ajaran')
                    ->orWhere('tahun_ajaran', '<>', $activeYear)
                    ->orWhereNull('semester')
                    ->orWhere('semester', '<>', $activeSemester);
            });
        }

        $olderThanDays = (int) ($filters['older_than_days'] ?? 0);
        if ($olderThanDays > 0) {
            $query->where('uploaded_at', '<=', now()->subDays($olderThanDays));
        }

        $query->orderByDesc('size_bytes');
        $rows = $query->limit(500)->get()->map(fn ($row) => $this->fileRowPayload($row))->all();
        $percent = max(0, min(100, (int) ($filters['largest_percent'] ?? 0)));
        if ($percent > 0 && ! empty($rows)) {
            $take = max(1, (int) ceil(count($rows) * ($percent / 100)));
            $rows = array_slice($rows, 0, $take);
        }

        return $rows;
    }

    private function validateCleanupScope(string $tenantId, array $filters): ?string
    {
        $year = AcademicPeriod::normalizeAcademicYear($filters['tahun_ajaran'] ?? null);
        $semester = AcademicPeriod::normalizeSemester($filters['semester'] ?? null);
        $active = $this->activePeriod($tenantId);

        if ($year && $semester && $year === $active['tahun_ajaran'] && $semester === $active['semester']) {
            return 'Cleanup semester aktif tidak diizinkan. Pilih semester/periode yang sudah selesai.';
        }
        if ($year && ! $semester && $year === $active['tahun_ajaran']) {
            return 'Cleanup tahun ajaran aktif harus memilih semester yang sudah selesai.';
        }
        if (! $year && $semester && $semester === $active['semester']) {
            return 'Cleanup semester aktif harus menyertakan tahun ajaran lama yang sudah selesai.';
        }

        $hasSafeScope = $year || $semester || trim((string) ($filters['category'] ?? '')) !== ''
            || (int) ($filters['older_than_days'] ?? 0) >= 30
            || (int) ($filters['largest_percent'] ?? 0) > 0;

        if (! $hasSafeScope) {
            return 'Cleanup wajib memakai filter periode/kategori/umur file agar tidak menjadi penghapusan massal.';
        }

        return null;
    }

    private function createCleanupBackup(string $tenantId, array $candidates): ?string
    {
        if (empty($candidates) || ! class_exists(\ZipArchive::class)) {
            return null;
        }

        $storage = Storage::disk('local');
        $backupPath = 'private/storage-backups/'.$tenantId.'/cleanup-'.now()->format('Ymd-His').'-'.Str::random(8).'.zip';
        $absolutePath = storage_path('app/'.$backupPath);
        @mkdir(dirname($absolutePath), 0775, true);

        $zip = new \ZipArchive;
        if ($zip->open($absolutePath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            return null;
        }

        $zip->addFromString('manifest.json', json_encode([
            'tenant_id' => $tenantId,
            'created_at' => now()->toIso8601String(),
            'files' => $candidates,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        foreach ($candidates as $file) {
            if (($file['provider'] ?? 'local') !== 'local') {
                continue;
            }
            $fullPath = 'private/'.$file['bucket'].'/'.ltrim($file['path'], '/');
            if ($storage->exists($fullPath)) {
                $zip->addFile(storage_path('app/'.$fullPath), 'files/'.$file['bucket'].'/'.ltrim($file['path'], '/'));
            }
        }

        $zip->close();

        return $backupPath;
    }

    private function moveLocalFileToTrash(string $tenantId, array $file): ?string
    {
        if (($file['provider'] ?? 'local') !== 'local') {
            return null;
        }

        $storage = Storage::disk('local');
        $fullPath = 'private/'.$file['bucket'].'/'.ltrim((string) $file['path'], '/');
        if (! $storage->exists($fullPath)) {
            return null;
        }

        $trashPath = 'private/.trash/'.$tenantId.'/'.$file['id'].'/'.basename((string) $file['path']);
        $storage->move($fullPath, $trashPath);

        return $trashPath;
    }

    private function fileRowPayload(object $row): array
    {
        return [
            'id' => $row->id,
            'bucket' => $row->bucket,
            'path' => $row->path,
            'provider' => $row->provider,
            'category' => $row->category,
            'category_label' => self::CATEGORY_LABELS[$row->category] ?? Str::title((string) $row->category),
            'file_name' => $row->file_name ?: basename((string) $row->path),
            'mime_type' => $row->mime_type,
            'size_bytes' => (int) ($row->size_bytes ?? 0),
            'size_label' => $this->formatBytes((int) ($row->size_bytes ?? 0)),
            'uploaded_by_user_id' => $row->uploaded_by_user_id ?? null,
            'tahun_ajaran' => $row->tahun_ajaran ?? null,
            'semester' => $row->semester ?? null,
            'kelas' => $row->kelas ?? null,
            'status' => $row->status ?? 'active',
            'uploaded_at' => $row->uploaded_at ?? null,
        ];
    }

    private function activePeriod(string $tenantId): array
    {
        $settings = null;
        if (Schema::hasTable('settings')) {
            $query = DB::table('settings')->orderBy('id');
            if (Schema::hasColumn('settings', 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }
            $settings = $query->first();
        }

        return AcademicPeriod::fromSettings($settings);
    }

    private function academicSnapshotForFile(string $tenantId, string $bucket, string $path, array $payload = []): array
    {
        $snapshot = [
            'tahun_ajaran' => AcademicPeriod::normalizeAcademicYear($payload['tahun_ajaran'] ?? null),
            'semester' => AcademicPeriod::normalizeSemester($payload['semester'] ?? null),
            'periode_key' => $payload['periode_key'] ?? null,
            'kelas' => trim((string) ($payload['kelas'] ?? '')) ?: null,
        ];

        if ($bucket === 'assignments' && preg_match('#^([0-9]+)\/#', $path, $matches) && Schema::hasTable('tugas')) {
            $task = DB::table('tugas')->where('id', $matches[1])->first();
            if ($task) {
                $snapshot['source_table'] = 'tugas';
                $snapshot['source_id'] = (string) $task->id;
                $snapshot['kelas'] = $snapshot['kelas'] ?: ($task->kelas ?? null);
                $snapshot['tahun_ajaran'] = $snapshot['tahun_ajaran'] ?: AcademicPeriod::normalizeAcademicYear($task->tahun_ajaran ?? null);
                $snapshot['semester'] = $snapshot['semester'] ?: AcademicPeriod::normalizeSemester($task->semester ?? null);
            }
        }

        $active = $this->activePeriod($tenantId);
        $snapshot['tahun_ajaran'] = $snapshot['tahun_ajaran'] ?: $active['tahun_ajaran'];
        $snapshot['semester'] = $snapshot['semester'] ?: $active['semester'];
        $snapshot['periode_key'] = $snapshot['periode_key'] ?: (($snapshot['tahun_ajaran'] ?? '').'|'.($snapshot['semester'] ?? ''));

        return $snapshot;
    }

    private function categoryForFile(string $bucket, string $path, string $mime, string $extension, $explicit): string
    {
        $explicit = trim((string) ($explicit ?? ''));
        if ($explicit !== '') {
            return $explicit;
        }
        if (str_starts_with(strtolower($mime), 'video/') || in_array($extension, ['mp4', 'mov', 'mkv', 'webm'], true)) {
            return 'video';
        }
        if ($bucket === 'quiz-media') {
            return 'kuis';
        }
        if ($bucket === 'assignments') {
            return str_starts_with($path, 'tugas_lampiran/') ? 'lampiran' : 'tugas';
        }
        if (str_contains($bucket, 'certificate') || str_contains($bucket, 'sertifikat')) {
            return 'sertifikat';
        }
        if ($bucket === 'profile-photos') {
            return 'profil';
        }

        return 'dokumen';
    }

    private function globalCategoryStats(): array
    {
        if (! $this->tablesReady()) {
            return [];
        }

        return DB::table('storage_files')
            ->whereIn('status', self::MANAGED_STATUSES)
            ->select('category')
            ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
            ->groupBy('category')
            ->orderByDesc('bytes')
            ->get()
            ->map(fn ($row) => [
                'category' => $row->category,
                'label' => self::CATEGORY_LABELS[$row->category] ?? Str::title((string) $row->category),
                'bytes' => (int) ($row->bytes ?? 0),
                'bytes_label' => $this->formatBytes((int) ($row->bytes ?? 0)),
                'files' => (int) ($row->files ?? 0),
            ])
            ->all();
    }

    private function allocatedQuotaBytes(): int
    {
        if (! Schema::hasTable('tenant_storage_quotas')) {
            return 0;
        }

        return (int) DB::table('tenant_storage_quotas')->sum('quota_bytes');
    }

    private function profileRole(string $userId, string $tenantId): ?string
    {
        if ($userId === '' || ! Schema::hasTable('profiles')) {
            return null;
        }

        $query = DB::table('profiles')->where('id', $userId);
        if (Schema::hasColumn('profiles', 'tenant_id') && $tenantId !== '') {
            $query->where('tenant_id', $tenantId);
        }

        return $query->value('role');
    }

    private function normalizeObjectPath(string $path): string
    {
        $path = str_replace('\\', '/', trim($path));
        $path = ltrim($path, '/');
        foreach (['private/', 'storage/app/private/', 'app/private/'] as $prefix) {
            if (str_starts_with($path, $prefix)) {
                $path = substr($path, strlen($prefix));
            }
        }

        return $path;
    }

    private function pathHash(string $path): string
    {
        return hash('sha256', $this->normalizeObjectPath($path));
    }

    private function duplicateKey(string $fileName, string $mime, int $sizeBytes): string
    {
        return hash('sha256', strtolower(trim($fileName)).'|'.strtolower(trim($mime)).'|'.$sizeBytes);
    }

    private function nullableBytes($value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        $bytes = (int) $value;

        return $bytes > 0 ? $bytes : null;
    }
}
