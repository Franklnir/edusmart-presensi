<?php

namespace App\Services\Storage;

use App\Support\AcademicPeriod;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class StorageManagementService
{
    private const MANAGED_STATUSES = ['active', 'trash'];

    private const PROVIDER_VPS = 'local';

    private const PROVIDER_NEVA_S3 = 'object_storage';

    private const PROVIDER_LABELS = [
        self::PROVIDER_VPS => 'VPS',
        self::PROVIDER_NEVA_S3 => 'Neva Cloud S3',
    ];

    private const CLEANUP_MINIMUM_PERIOD_GAP = 1;

    private const CLEANUP_MINIMUM_FILE_AGE_DAYS = 90;

    private const CLEANUP_SAFE_CATEGORIES = ['tugas', 'kuis', 'lampiran'];

    private const CLEANUP_SAFE_BUCKETS = ['assignments', 'quiz-media'];

    private const CLEANUP_SAFE_EXTENSIONS = [
        'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'odt', 'ods', 'odp', 'rtf',
        'jpg', 'jpeg', 'png', 'webp', 'gif',
    ];

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

    public function __construct(
        private readonly S3CompatibleStorageSigner $objectStorageSigner
    ) {}

    public function tablesReady(): bool
    {
        return $this->quotaTableReady()
            && $this->storageFilesReady()
            && $this->cleanupJobsReady();
    }

    public function serverCapacity(): array
    {
        $path = storage_path('app');
        $total = @disk_total_space($path);
        $free = @disk_free_space($path);
        $totalBytes = is_numeric($total) ? (int) $total : 0;
        $freeBytes = is_numeric($free) ? (int) $free : 0;
        $usedBytes = max(0, $totalBytes - $freeBytes);
        $allocatedBytes = $this->allocatedQuotaBytes(self::PROVIDER_VPS);

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

    public function objectStorageCapacity(): array
    {
        $capacityBytes = $this->configuredObjectStorageCapacityBytes();
        $snapshotTotals = $this->latestProviderSnapshotTotals(self::PROVIDER_NEVA_S3);
        $usedBytes = $snapshotTotals['total_bytes'] ?? $this->providerUsedBytes(self::PROVIDER_NEVA_S3);
        $allocatedBytes = $this->allocatedQuotaBytes(self::PROVIDER_NEVA_S3);
        $remainingBytes = $capacityBytes !== null ? max(0, $capacityBytes - $usedBytes) : null;
        $remainingAfterAllocatedBytes = $capacityBytes !== null ? max(0, $capacityBytes - $allocatedBytes) : null;

        return [
            ...$this->objectStorageStatus(),
            'capacity_bytes' => $capacityBytes,
            'capacity_label' => $capacityBytes !== null ? $this->formatBytes($capacityBytes) : 'Belum diset',
            'used_bytes' => $usedBytes,
            'used_label' => $this->formatBytes($usedBytes),
            'allocated_quota_bytes' => $allocatedBytes,
            'allocated_quota_label' => $this->formatBytes($allocatedBytes),
            'remaining_bytes' => $remainingBytes,
            'remaining_label' => $remainingBytes !== null ? $this->formatBytes($remainingBytes) : 'Belum diset',
            'remaining_after_allocated_bytes' => $remainingAfterAllocatedBytes,
            'remaining_after_allocated_label' => $remainingAfterAllocatedBytes !== null ? $this->formatBytes($remainingAfterAllocatedBytes) : 'Belum diset',
            'percent' => $capacityBytes && $capacityBytes > 0 ? round(min(100, ($usedBytes / $capacityBytes) * 100), 2) : null,
            'tracked_bytes' => $snapshotTotals['tracked_bytes'] ?? $usedBytes,
            'tracked_label' => $this->formatBytes((int) ($snapshotTotals['tracked_bytes'] ?? $usedBytes)),
            'untracked_bytes' => $snapshotTotals['untracked_bytes'] ?? 0,
            'untracked_label' => $this->formatBytes((int) ($snapshotTotals['untracked_bytes'] ?? 0)),
            'total_files' => $snapshotTotals['total_files'] ?? null,
            'tracked_files' => $snapshotTotals['tracked_files'] ?? null,
            'untracked_files' => $snapshotTotals['untracked_files'] ?? 0,
            'last_scanned_at' => $snapshotTotals['last_scanned_at'] ?? null,
            'bucket_snapshots' => $this->latestProviderBucketSnapshots(self::PROVIDER_NEVA_S3),
        ];
    }

    private function objectStorageStatus(): array
    {
        $bucketMap = config('services.object_storage.bucket_map', []);
        if (! is_array($bucketMap)) {
            $bucketMap = [];
        }

        return [
            'provider' => self::PROVIDER_NEVA_S3,
            'label' => (string) config('services.object_storage.label', 'Neva Cloud S3'),
            'enabled' => (bool) config('services.object_storage.enabled', false),
            'browser_direct_enabled' => (bool) config('services.object_storage.browser_direct_enabled', false),
            'verify_objects' => (bool) config('services.object_storage.verify_uploads', true),
            'endpoint' => (string) config('services.object_storage.endpoint', ''),
            'bucket_map' => array_filter($bucketMap),
        ];
    }

    public function quotaForTenant(string $tenantId): array
    {
        $row = $this->quotaTableReady()
            ? DB::table('tenant_storage_quotas')->where('tenant_id', $tenantId)->first()
            : null;

        $providers = $this->providerQuotasForTenant($tenantId, $row);
        $quotaBytes = $this->sumNullableBytes(array_column($providers, 'quota_bytes'));
        $maxUploadBytes = $this->maxNullableBytes(array_column($providers, 'max_upload_bytes'));
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
            'notes' => $row->notes ?? null,
            'providers' => $providers,
        ];
    }

    public function assertUploadAllowed(string $tenantId, int $incomingBytes, string $provider = self::PROVIDER_VPS): ?string
    {
        if ($tenantId === '' || $incomingBytes <= 0 || ! $this->tablesReady()) {
            return null;
        }

        $quota = $this->providerQuotaForTenant($tenantId, $provider);
        $providerLabel = (string) ($quota['label'] ?? 'storage');
        $maxUploadBytes = $quota['max_upload_bytes'];
        if ($maxUploadBytes !== null && $incomingBytes > $maxUploadBytes) {
            return 'Ukuran file melebihi batas upload '.$providerLabel.' sekolah (maksimal '.$this->formatBytes($maxUploadBytes).').';
        }

        $quotaBytes = $quota['quota_bytes'];
        if ($quotaBytes !== null && ($quota['used_bytes'] + $incomingBytes) > $quotaBytes) {
            return 'Kuota '.$providerLabel.' sekolah penuh. Sisa kuota '.$quota['remaining_label'].'.';
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
        $tenantRows = $this->safeSection('tenant_list', collect(), function () {
            if (! Schema::hasTable('tenants') || ! Schema::hasColumn('tenants', 'id')) {
                return collect();
            }

            $columns = array_values(array_filter(
                ['id', 'name', 'slug', 'status'],
                fn ($column) => Schema::hasColumn('tenants', $column)
            ));

            return DB::table('tenants')
                ->select($columns)
                ->orderBy(Schema::hasColumn('tenants', 'name') ? 'name' : 'id')
                ->get();
        });

        $tenants = $tenantRows->map(function ($tenant) {
            $tenantId = (string) ($tenant->id ?? '');
            $summary = $this->safeSection(
                'tenant_overview',
                $this->emptyTenantOverview(),
                fn () => $this->tenantOverviewSummary($tenantId),
                ['tenant_id' => $tenantId]
            );
            $name = (string) ($tenant->name ?? $tenant->slug ?? $tenantId);

            return [
                'id' => $tenantId,
                'name' => $name !== '' ? $name : 'Sekolah',
                'slug' => (string) ($tenant->slug ?? ''),
                'status' => (string) ($tenant->status ?? 'active'),
                'quota' => $summary['quota'],
                'providers' => $summary['providers'] ?? ($summary['quota']['providers'] ?? []),
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
            'object_storage' => $this->objectStorageCapacity(),
            'total_used_bytes' => $totalUsed,
            'total_used_label' => $this->formatBytes($totalUsed),
            'tenant_count' => count($tenants),
            'tenants' => $tenants,
            'top_tenants' => $topTenants,
            'by_category' => $this->safeSection('global_category_stats', [], fn () => $this->globalCategoryStats()),
            'computed_at' => now()->toIso8601String(),
        ];
    }

    public function tenantSummary(string $tenantId, array $filters = []): array
    {
        $context = ['tenant_id' => $tenantId];
        $usage = $this->safeSection('tenant_usage', $this->emptyUsage(), fn () => $this->tenantUsage($tenantId, $filters), $context);
        $quota = $this->safeSection('tenant_quota', $this->emptyQuota($tenantId), fn () => $this->quotaForTenant($tenantId), $context);
        $recommendations = $this->safeSection('tenant_recommendations', [], fn () => $this->recommendations($tenantId, $usage, $quota), $context);
        $largest = $this->safeSection('largest_files', [], fn () => $this->largestFiles($tenantId, $filters), $context);
        $byUser = $this->safeSection('by_uploader', [], fn () => $this->byUploader($tenantId, $filters), $context);
        $duplicates = $this->safeSection('duplicate_groups', [], fn () => $this->duplicateGroups($tenantId), $context);
        $providerSummaries = $this->safeSection('provider_summaries', $this->emptyProviderSummaries($tenantId), fn () => [
            'vps' => $this->providerSummary($tenantId, self::PROVIDER_VPS, $filters),
            'neva_s3' => $this->providerSummary($tenantId, self::PROVIDER_NEVA_S3, $filters),
        ], $context);

        return [
            'quota' => $quota,
            'usage' => $usage,
            'providers' => $quota['providers'] ?? [],
            'provider_summaries' => $providerSummaries,
            'object_storage' => $providerSummaries['neva_s3'] ?? $this->providerSummary($tenantId, self::PROVIDER_NEVA_S3, $filters),
            'object_storage_status' => $this->objectStorageStatus(),
            'top_category' => $usage['by_category'][0] ?? null,
            'largest_files' => $largest,
            'by_uploader' => $byUser,
            'duplicates' => $duplicates,
            'recommendations' => $recommendations,
            'period_options' => $this->safeSection('period_options', [], fn () => $this->periodStats($tenantId), $context),
            'prediction' => $this->safeSection('full_prediction', $this->emptyPrediction(), fn () => $this->fullPrediction($tenantId, $quota), $context),
            'trash' => $this->safeSection('trash_summary', $this->emptyTrash(), fn () => $this->trashSummary($tenantId), $context),
            'trash_files' => $this->safeSection('trash_files', [], fn () => $this->trashFiles($tenantId), $context),
            'active_period' => $this->safeSection('active_period', AcademicPeriod::current(), fn () => $this->activePeriod($tenantId), $context),
            'computed_at' => now()->toIso8601String(),
        ];
    }

    private function tenantOverviewSummary(string $tenantId): array
    {
        $usage = $this->tenantUsage($tenantId, [], false);
        $quota = $this->quotaForTenant($tenantId);

        return [
            'quota' => $quota,
            'providers' => $quota['providers'] ?? [],
            'usage' => $usage,
            'top_category' => $usage['by_category'][0] ?? null,
            'prediction' => $this->fullPrediction($tenantId, $quota),
        ];
    }

    public function updateQuota(string $tenantId, array $payload, ?string $userId = null): array
    {
        if (! $this->quotaTableReady()) {
            return $this->quotaForTenant($tenantId);
        }

        $now = now();
        $exists = DB::table('tenant_storage_quotas')->where('tenant_id', $tenantId)->exists();
        $values = [];
        $vpsQuota = $payload['vps_quota_bytes'] ?? $payload['quota_bytes'] ?? null;
        $vpsMaxUpload = $payload['vps_max_upload_bytes'] ?? $payload['max_upload_bytes'] ?? null;
        $nevaQuota = $payload['neva_s3_quota_bytes'] ?? null;
        $nevaMaxUpload = $payload['neva_s3_max_upload_bytes'] ?? null;
        $normalizedVpsQuota = $this->nullableBytes($vpsQuota);
        $normalizedVpsMaxUpload = $this->nullableBytes($vpsMaxUpload);
        $normalizedNevaQuota = $this->nullableBytes($nevaQuota);
        $normalizedNevaMaxUpload = $this->nullableBytes($nevaMaxUpload);

        $this->assertQuotaAllocationWithinCapacity($tenantId, self::PROVIDER_VPS, $normalizedVpsQuota);
        $this->assertQuotaAllocationWithinCapacity($tenantId, self::PROVIDER_NEVA_S3, $normalizedNevaQuota);

        if ($this->tableHasColumn('tenant_storage_quotas', 'quota_bytes')) {
            $values['quota_bytes'] = $normalizedVpsQuota;
        }
        if ($this->tableHasColumn('tenant_storage_quotas', 'max_upload_bytes')) {
            $values['max_upload_bytes'] = $normalizedVpsMaxUpload;
        }
        if ($this->tableHasColumn('tenant_storage_quotas', 'vps_quota_bytes')) {
            $values['vps_quota_bytes'] = $normalizedVpsQuota;
        }
        if ($this->tableHasColumn('tenant_storage_quotas', 'vps_max_upload_bytes')) {
            $values['vps_max_upload_bytes'] = $normalizedVpsMaxUpload;
        }
        if ($this->tableHasColumn('tenant_storage_quotas', 'neva_s3_quota_bytes')) {
            $values['neva_s3_quota_bytes'] = $normalizedNevaQuota;
        }
        if ($this->tableHasColumn('tenant_storage_quotas', 'neva_s3_max_upload_bytes')) {
            $values['neva_s3_max_upload_bytes'] = $normalizedNevaMaxUpload;
        }
        if ($this->tableHasColumn('tenant_storage_quotas', 'notes')) {
            $values['notes'] = trim((string) ($payload['notes'] ?? '')) ?: null;
        }
        if ($this->tableHasColumn('tenant_storage_quotas', 'updated_by_user_id')) {
            $values['updated_by_user_id'] = $userId;
        }
        if ($this->tableHasColumn('tenant_storage_quotas', 'updated_at')) {
            $values['updated_at'] = $now;
        }
        if (! $exists && $this->tableHasColumn('tenant_storage_quotas', 'id')) {
            $values['id'] = (string) ($payload['id'] ?? Str::uuid());
        }
        if (! $exists && $this->tableHasColumn('tenant_storage_quotas', 'created_at')) {
            $values['created_at'] = $now;
        }

        if (! empty($values)) {
            DB::table('tenant_storage_quotas')->updateOrInsert(['tenant_id' => $tenantId], $values);
        }

        return $this->quotaForTenant($tenantId);
    }

    private function providerQuotasForTenant(string $tenantId, ?object $row = null): array
    {
        return [
            'vps' => $this->providerQuotaForTenant($tenantId, self::PROVIDER_VPS, $row),
            'neva_s3' => $this->providerQuotaForTenant($tenantId, self::PROVIDER_NEVA_S3, $row),
        ];
    }

    private function providerQuotaForTenant(string $tenantId, string $provider, ?object $row = null): array
    {
        $provider = $this->normalizeProvider($provider);
        if ($row === null && $this->quotaTableReady()) {
            $row = DB::table('tenant_storage_quotas')->where('tenant_id', $tenantId)->first();
        }

        if ($provider === self::PROVIDER_NEVA_S3) {
            $quotaBytes = $this->rowNullableInt($row, 'neva_s3_quota_bytes');
            $maxUploadBytes = $this->rowNullableInt($row, 'neva_s3_max_upload_bytes');
            $key = 'neva_s3';
        } else {
            $quotaBytes = $this->rowNullableInt($row, 'vps_quota_bytes');
            $maxUploadBytes = $this->rowNullableInt($row, 'vps_max_upload_bytes');

            if ($quotaBytes === null) {
                $quotaBytes = $this->rowNullableInt($row, 'quota_bytes');
            }
            if ($maxUploadBytes === null) {
                $maxUploadBytes = $this->rowNullableInt($row, 'max_upload_bytes');
            }
            $key = 'vps';
        }

        $usedBytes = $this->tenantUsedBytes($tenantId, $provider);
        $remainingBytes = $quotaBytes !== null ? max(0, $quotaBytes - $usedBytes) : null;

        return [
            'key' => $key,
            'provider' => $provider,
            'label' => self::PROVIDER_LABELS[$provider] ?? Str::title(str_replace('_', ' ', $provider)),
            'quota_bytes' => $quotaBytes,
            'quota_label' => $quotaBytes !== null ? $this->formatBytes($quotaBytes) : 'Tidak dibatasi',
            'max_upload_bytes' => $maxUploadBytes,
            'max_upload_label' => $maxUploadBytes !== null ? $this->formatBytes($maxUploadBytes) : 'Default sistem',
            'used_bytes' => $usedBytes,
            'used_label' => $this->formatBytes($usedBytes),
            'remaining_bytes' => $remainingBytes,
            'remaining_label' => $remainingBytes !== null ? $this->formatBytes($remainingBytes) : 'Tidak dibatasi',
            'percent' => $quotaBytes && $quotaBytes > 0 ? round(min(100, ($usedBytes / $quotaBytes) * 100), 2) : null,
        ];
    }

    private function providerSummary(string $tenantId, string $provider, array $filters = []): array
    {
        $provider = $this->normalizeProvider($provider);
        $providerFilters = [
            ...$filters,
            'provider' => $provider,
        ];
        $quota = $this->providerQuotaForTenant($tenantId, $provider);
        $usage = $this->tenantUsage($tenantId, $providerFilters);

        return [
            'provider' => $provider,
            'label' => self::PROVIDER_LABELS[$provider] ?? Str::title(str_replace('_', ' ', $provider)),
            'quota' => $quota,
            'usage' => $usage,
            'top_category' => $usage['by_category'][0] ?? null,
            'largest_files' => $this->largestFiles($tenantId, $providerFilters),
            'by_uploader' => $this->byUploader($tenantId, $providerFilters),
            'bucket_usage' => $this->bucketUsage($tenantId, $provider, $providerFilters, $quota),
        ];
    }

    public function syncObjectStorageInventory(?string $tenantId = null, array $options = []): array
    {
        if (! $this->objectStorageSigner->isEnabled()) {
            return [
                'ok' => false,
                'message' => 'Neva Cloud S3 belum aktif atau credential belum lengkap.',
                'buckets' => [],
            ];
        }
        if (! $this->storageFilesReady()) {
            return [
                'ok' => false,
                'message' => 'Metadata storage belum siap. Jalankan migrasi storage terlebih dahulu.',
                'buckets' => [],
            ];
        }

        $bucketFilter = trim((string) ($options['bucket'] ?? ''));
        $maxPages = max(1, min(50, (int) ($options['max_pages'] ?? 10)));
        $tenantScoped = $tenantId !== null && $tenantId !== '';
        $buckets = $this->objectStorageSigner->configuredBuckets();
        if ($bucketFilter !== '' && $bucketFilter !== 'all') {
            $buckets = array_filter(
                $buckets,
                fn ($physicalBucket, $logicalBucket) => (string) $logicalBucket === $bucketFilter,
                ARRAY_FILTER_USE_BOTH
            );
        }
        $buckets = array_filter(
            $buckets,
            fn ($physicalBucket, $logicalBucket) => $this->objectStorageSigner->isEnabledForBucket((string) $logicalBucket),
            ARRAY_FILTER_USE_BOTH
        );
        if (empty($buckets)) {
            return [
                'ok' => false,
                'message' => $bucketFilter !== ''
                    ? 'Bucket Neva Cloud S3 belum aktif atau tidak ditemukan: '.$bucketFilter.'.'
                    : 'Belum ada bucket Neva Cloud S3 yang aktif untuk discan.',
                'buckets' => [],
            ];
        }

        $results = [];
        $totalBytes = 0;
        $totalFiles = 0;
        $trackedBytes = 0;
        $trackedFiles = 0;
        $untrackedBytes = 0;
        $untrackedFiles = 0;

        foreach ($buckets as $logicalBucket => $physicalBucket) {
            $logicalBucket = (string) $logicalBucket;
            $physicalBucket = (string) $physicalBucket;
            $prefix = 'private/'.$logicalBucket.'/';
            $token = null;
            $pages = 0;
            $bucketTotalBytes = 0;
            $bucketTotalFiles = 0;
            $bucketTrackedBytes = 0;
            $bucketTrackedFiles = 0;
            $bucketUntrackedBytes = 0;
            $bucketUntrackedFiles = 0;
            $truncated = false;
            $error = null;

            do {
                try {
                    $page = $this->objectStorageSigner->listObjects($logicalBucket, $prefix, $token);
                    $pages++;
                } catch (\Throwable $e) {
                    $error = $this->shortError($e->getMessage());
                    Log::warning('object_storage_inventory_scan_failed', [
                        'tenant_id' => $tenantId,
                        'logical_bucket' => $logicalBucket,
                        'physical_bucket' => $physicalBucket,
                        'error' => $error,
                    ]);
                    break;
                }
                foreach (($page['objects'] ?? []) as $object) {
                    $key = (string) ($object['key'] ?? '');
                    if ($key === '' || ! str_starts_with($key, $prefix)) {
                        continue;
                    }

                    $path = substr($key, strlen($prefix));
                    if ($path === '') {
                        continue;
                    }

                    $sizeBytes = max(0, (int) ($object['size'] ?? 0));
                    $matchedRows = $this->syncObjectStorageMetadataRow($tenantId, $logicalBucket, $path, $object);
                    if ($matchedRows > 0) {
                        $bucketTotalBytes += $sizeBytes;
                        $bucketTotalFiles++;
                        $bucketTrackedBytes += $sizeBytes;
                        $bucketTrackedFiles++;
                    } elseif (! $tenantScoped) {
                        $bucketTotalBytes += $sizeBytes;
                        $bucketTotalFiles++;
                        $bucketUntrackedBytes += $sizeBytes;
                        $bucketUntrackedFiles++;
                    }
                }

                $truncated = (bool) ($page['is_truncated'] ?? false);
                $token = $page['next_continuation_token'] ?? null;
            } while ($truncated && $token && $pages < $maxPages);

            $result = [
                'logical_bucket' => $logicalBucket,
                'physical_bucket' => $physicalBucket,
                'total_bytes' => $bucketTotalBytes,
                'total_label' => $this->formatBytes($bucketTotalBytes),
                'total_files' => $bucketTotalFiles,
                'tracked_bytes' => $bucketTrackedBytes,
                'tracked_label' => $this->formatBytes($bucketTrackedBytes),
                'tracked_files' => $bucketTrackedFiles,
                'untracked_bytes' => $bucketUntrackedBytes,
                'untracked_label' => $this->formatBytes($bucketUntrackedBytes),
                'untracked_files' => $bucketUntrackedFiles,
                'pages' => $pages,
                'truncated' => $truncated,
                'error' => $error,
                'scanned_at' => now()->toIso8601String(),
            ];

            if (($tenantId === null || $tenantId === '') && $error === null) {
                $this->saveObjectStorageSnapshot($result);
            }

            $results[] = $result;
            $totalBytes += $bucketTotalBytes;
            $totalFiles += $bucketTotalFiles;
            $trackedBytes += $bucketTrackedBytes;
            $trackedFiles += $bucketTrackedFiles;
            $untrackedBytes += $bucketUntrackedBytes;
            $untrackedFiles += $bucketUntrackedFiles;
        }

        $failedBuckets = array_values(array_filter($results, fn ($bucket) => ! empty($bucket['error'])));

        return [
            'ok' => count($failedBuckets) === 0,
            'message' => count($failedBuckets) > 0
                ? 'Sync Neva Cloud S3 selesai sebagian. Ada bucket yang belum bisa dibaca.'
                : 'Sync Neva Cloud S3 selesai.',
            'tenant_id' => $tenantId,
            'total_bytes' => $totalBytes,
            'total_label' => $this->formatBytes($totalBytes),
            'total_files' => $totalFiles,
            'tracked_bytes' => $trackedBytes,
            'tracked_label' => $this->formatBytes($trackedBytes),
            'tracked_files' => $trackedFiles,
            'untracked_bytes' => $untrackedBytes,
            'untracked_label' => $this->formatBytes($untrackedBytes),
            'untracked_files' => $untrackedFiles,
            'buckets' => $results,
            'failed_buckets' => $failedBuckets,
        ];
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

        $minimumAgeDays = $this->cleanupMinimumAgeDays($filters);
        $candidates = $this->cleanupCandidates($tenantId, $filters);
        $bytes = array_sum(array_map(fn ($row) => (int) ($row['size_bytes'] ?? 0), $candidates));
        $provider = $this->normalizeProvider((string) ($filters['provider'] ?? self::PROVIDER_VPS));
        $providerLabel = self::PROVIDER_LABELS[$provider] ?? 'Storage';
        $bucket = trim((string) ($filters['bucket'] ?? ''));

        return [
            'allowed' => true,
            'message' => 'Cleanup aman untuk '.$providerLabel.' bucket '.$bucket.'. Hanya file tugas/quiz/lampiran yang sesuai periode dan berumur minimal '.$minimumAgeDays.' hari yang dipilih.',
            'files' => count($candidates),
            'bytes' => $bytes,
            'bytes_label' => $this->formatBytes($bytes),
            'minimum_age_days' => $minimumAgeDays,
            'safe_categories' => self::CLEANUP_SAFE_CATEGORIES,
            'safe_extensions' => self::CLEANUP_SAFE_EXTENSIONS,
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
            $trashPath = $this->moveCleanupFileToTrash($tenantId, $file);
            if ($trashPath === null) {
                continue;
            }

            $affectedBytes += (int) ($file['size_bytes'] ?? 0);
            $affectedFiles++;

            $updates = ['status' => 'trash'];
            if ($this->tableHasColumn('storage_files', 'trashed_at')) {
                $updates['trashed_at'] = $now;
            }
            if ($this->tableHasColumn('storage_files', 'trash_expires_at')) {
                $updates['trash_expires_at'] = $trashExpiresAt;
            }
            if ($this->tableHasColumn('storage_files', 'trash_path')) {
                $updates['trash_path'] = $trashPath;
            }
            if ($this->tableHasColumn('storage_files', 'updated_at')) {
                $updates['updated_at'] = $now;
            }

            DB::table('storage_files')
                ->where('id', $file['id'])
                ->where('tenant_id', $tenantId)
                ->update($updates);
        }

        $jobId = (string) Str::uuid();
        $job = [
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
        ];
        $job = array_filter(
            $job,
            fn ($value, $column) => $this->tableHasColumn('storage_cleanup_jobs', (string) $column),
            ARRAY_FILTER_USE_BOTH
        );
        if (! empty($job)) {
            DB::table('storage_cleanup_jobs')->insert($job);
        }

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
        if (! $this->storageFilesReady()) {
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

        $updates = ['status' => 'active'];
        foreach (['trashed_at', 'trash_expires_at', 'trash_path'] as $column) {
            if ($this->tableHasColumn('storage_files', $column)) {
                $updates[$column] = null;
            }
        }
        if ($this->tableHasColumn('storage_files', 'updated_at')) {
            $updates['updated_at'] = now();
        }
        DB::table('storage_files')->where('id', $fileId)->update($updates);

        return true;
    }

    public function purgeExpiredTrash(): array
    {
        if (
            ! $this->storageFilesReady()
            || ! $this->tableHasColumn('storage_files', 'trash_expires_at')
            || ! $this->tableHasColumn('storage_files', 'uploaded_at')
        ) {
            return ['files' => 0, 'bytes' => 0, 'bytes_label' => '0 B'];
        }

        $rows = DB::table('storage_files')
            ->where('status', 'trash')
            ->whereNotNull('trash_expires_at')
            ->where('trash_expires_at', '<=', now())
            ->whereNotNull('uploaded_at')
            ->where('uploaded_at', '<=', now()->subDays(self::CLEANUP_MINIMUM_FILE_AGE_DAYS))
            ->limit(500)
            ->get();

        $storage = Storage::disk('local');
        $files = 0;
        $bytes = 0;
        foreach ($rows as $row) {
            $provider = (string) ($row->provider ?? self::PROVIDER_VPS);
            if ($provider === self::PROVIDER_NEVA_S3) {
                $deleted = $this->objectStorageSigner->deleteObject(
                    $this->objectKeyForFile($row),
                    (string) ($row->bucket ?? '')
                );
                if (! $deleted) {
                    continue;
                }
            } else {
                $trashPath = trim((string) ($row->trash_path ?? ''));
                if ($trashPath !== '' && $storage->exists($trashPath)) {
                    $storage->delete($trashPath);
                }
            }
            $bytes += (int) ($row->size_bytes ?? 0);
            $files++;
            $updates = ['status' => 'deleted'];
            if ($this->tableHasColumn('storage_files', 'deleted_at')) {
                $updates['deleted_at'] = now();
            }
            if ($this->tableHasColumn('storage_files', 'updated_at')) {
                $updates['updated_at'] = now();
            }
            DB::table('storage_files')->where('id', $row->id)->update($updates);
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

    private function tenantUsage(string $tenantId, array $filters = [], bool $includePeriods = true): array
    {
        $localRows = $this->storageFilesReady()
            && $this->tableHasColumn('storage_files', 'category')
            && $this->tableHasColumn('storage_files', 'size_bytes')
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

        $merged = [];
        foreach ($localRows as $row) {
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
            'by_period' => $includePeriods ? $this->periodStats($tenantId, $filters) : [],
        ];
    }

    private function tenantUsedBytes(string $tenantId, ?string $provider = null): int
    {
        if ($tenantId === '') {
            return 0;
        }

        $bytes = 0;
        if ($this->storageFilesReady()) {
            $query = DB::table('storage_files')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', self::MANAGED_STATUSES);

            if ($provider !== null && $this->tableHasColumn('storage_files', 'provider')) {
                $query->where('provider', $this->normalizeProvider($provider));
            }

            $bytes += (int) $query->sum('size_bytes');
        }

        return $bytes;
    }

    private function providerUsedBytes(string $provider): int
    {
        if (! $this->storageFilesReady() || ! $this->tableHasColumn('storage_files', 'provider')) {
            return 0;
        }

        return (int) DB::table('storage_files')
            ->whereIn('status', self::MANAGED_STATUSES)
            ->where('provider', $this->normalizeProvider($provider))
            ->sum('size_bytes');
    }

    private function storageRowsQuery(string $tenantId, array $filters = [])
    {
        $query = DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', self::MANAGED_STATUSES);

        foreach (['category', 'tahun_ajaran', 'semester', 'uploaded_by_user_id', 'provider', 'bucket'] as $field) {
            $value = trim((string) ($filters[$field] ?? ''));
            if ($value !== '' && $value !== 'all' && $this->tableHasColumn('storage_files', $field)) {
                $query->where($field, $field === 'provider' ? $this->normalizeProvider($value) : $value);
            }
        }

        $minBytes = isset($filters['min_bytes']) ? (int) $filters['min_bytes'] : 0;
        if ($minBytes > 0 && $this->tableHasColumn('storage_files', 'size_bytes')) {
            $query->where('size_bytes', '>=', $minBytes);
        }

        return $query;
    }

    private function bucketUsage(string $tenantId, string $provider, array $filters = [], array $quota = []): array
    {
        if (
            ! $this->storageFilesReady()
            || ! $this->tableHasColumn('storage_files', 'bucket')
            || ! $this->tableHasColumn('storage_files', 'size_bytes')
        ) {
            return [];
        }

        $provider = $this->normalizeProvider($provider);
        $rows = $this->storageRowsQuery($tenantId, [
            ...$filters,
            'provider' => $provider,
        ])
            ->select('bucket')
            ->selectRaw('coalesce(sum(size_bytes), 0) as bytes, count(*) as files')
            ->groupBy('bucket')
            ->get()
            ->keyBy(fn ($row) => (string) ($row->bucket ?? ''));

        $knownBuckets = $provider === self::PROVIDER_NEVA_S3
            ? array_keys($this->objectStorageSigner->configuredBuckets())
            : self::CLEANUP_SAFE_BUCKETS;
        $knownBuckets = array_values(array_unique(array_filter([
            ...$knownBuckets,
            ...$rows->keys()->all(),
        ])));

        $quotaBytes = $quota['quota_bytes'] ?? null;
        $providerUsedBytes = (int) ($quota['used_bytes'] ?? 0);

        return collect($knownBuckets)
            ->map(function (string $bucket) use ($rows, $quotaBytes, $providerUsedBytes) {
                $row = $rows->get($bucket);
                $bytes = (int) ($row->bytes ?? 0);
                $files = (int) ($row->files ?? 0);
                $remainingAfterBucket = $quotaBytes !== null ? max(0, (int) $quotaBytes - $bytes) : null;
                $remainingAfterProvider = $quotaBytes !== null ? max(0, (int) $quotaBytes - $providerUsedBytes) : null;

                return [
                    'bucket' => $bucket,
                    'label' => $this->bucketLabel($bucket),
                    'bytes' => $bytes,
                    'bytes_label' => $this->formatBytes($bytes),
                    'files' => $files,
                    'remaining_after_bucket_bytes' => $remainingAfterBucket,
                    'remaining_after_bucket_label' => $remainingAfterBucket !== null ? $this->formatBytes($remainingAfterBucket) : 'Tidak dibatasi',
                    'remaining_after_provider_bytes' => $remainingAfterProvider,
                    'remaining_after_provider_label' => $remainingAfterProvider !== null ? $this->formatBytes($remainingAfterProvider) : 'Tidak dibatasi',
                    'quota_bytes' => $quotaBytes,
                    'quota_label' => $quotaBytes !== null ? $this->formatBytes((int) $quotaBytes) : 'Tidak dibatasi',
                    'percent' => $quotaBytes && $quotaBytes > 0 ? round(min(100, ($bytes / $quotaBytes) * 100), 2) : null,
                ];
            })
            ->sortByDesc('bytes')
            ->values()
            ->all();
    }

    private function syncObjectStorageMetadataRow(?string $tenantId, string $bucket, string $path, array $object): int
    {
        $query = DB::table('storage_files')
            ->where('bucket', $bucket)
            ->where('path_hash', $this->pathHash($path))
            ->where('provider', self::PROVIDER_NEVA_S3);

        if ($tenantId !== null && $tenantId !== '') {
            $query->where('tenant_id', $tenantId);
        }

        $rows = $query->limit(20)->get();
        if ($rows->isEmpty()) {
            return 0;
        }

        $now = now();
        foreach ($rows as $row) {
            $metadata = json_decode((string) ($row->metadata ?? '{}'), true);
            if (! is_array($metadata)) {
                $metadata = [];
            }
            $metadata['s3_synced_at'] = $now->toIso8601String();
            $metadata['s3_last_modified'] = $object['last_modified'] ?? null;
            $metadata['s3_etag'] = $object['etag'] ?? null;
            $metadata['object_key'] = 'private/'.$bucket.'/'.ltrim($path, '/');

            $updates = [
                'size_bytes' => max(0, (int) ($object['size'] ?? 0)),
                'metadata' => json_encode($metadata, JSON_UNESCAPED_SLASHES),
            ];
            if ($this->tableHasColumn('storage_files', 'updated_at')) {
                $updates['updated_at'] = $now;
            }
            if (
                $this->tableHasColumn('storage_files', 'uploaded_at')
                && empty($row->uploaded_at)
                && ! empty($object['last_modified'])
            ) {
                $updates['uploaded_at'] = $object['last_modified'];
            }

            DB::table('storage_files')->where('id', $row->id)->update($updates);
        }

        return $rows->count();
    }

    private function saveObjectStorageSnapshot(array $snapshot): void
    {
        if (! Schema::hasTable('storage_provider_snapshots')) {
            return;
        }

        $now = now();
        $values = [
            'provider' => self::PROVIDER_NEVA_S3,
            'logical_bucket' => (string) ($snapshot['logical_bucket'] ?? ''),
            'physical_bucket' => (string) ($snapshot['physical_bucket'] ?? ''),
            'total_bytes' => max(0, (int) ($snapshot['total_bytes'] ?? 0)),
            'total_files' => max(0, (int) ($snapshot['total_files'] ?? 0)),
            'tracked_bytes' => max(0, (int) ($snapshot['tracked_bytes'] ?? 0)),
            'tracked_files' => max(0, (int) ($snapshot['tracked_files'] ?? 0)),
            'untracked_bytes' => max(0, (int) ($snapshot['untracked_bytes'] ?? 0)),
            'untracked_files' => max(0, (int) ($snapshot['untracked_files'] ?? 0)),
            'scanned_at' => $now,
            'metadata' => json_encode([
                'pages' => $snapshot['pages'] ?? 0,
                'truncated' => (bool) ($snapshot['truncated'] ?? false),
            ], JSON_UNESCAPED_SLASHES),
            'updated_at' => $now,
        ];

        $existing = DB::table('storage_provider_snapshots')
            ->where('provider', self::PROVIDER_NEVA_S3)
            ->where('logical_bucket', $values['logical_bucket'])
            ->exists();

        if (! $existing) {
            $values['id'] = (string) Str::uuid();
            $values['created_at'] = $now;
        }

        DB::table('storage_provider_snapshots')->updateOrInsert(
            [
                'provider' => self::PROVIDER_NEVA_S3,
                'logical_bucket' => $values['logical_bucket'],
            ],
            $values
        );
    }

    private function driveRowsQuery(string $tenantId, array $filters = [])
    {
        $query = DB::table('tenant_google_drive_files')
            ->where('tenant_id', $tenantId);

        foreach (['tahun_ajaran', 'semester', 'uploaded_by_user_id'] as $field) {
            $value = trim((string) ($filters[$field] ?? ''));
            if ($value !== '' && $value !== 'all' && $this->tableHasColumn('tenant_google_drive_files', $field)) {
                $query->where($field, $value);
            }
        }

        $category = trim((string) ($filters['category'] ?? ''));
        if ($category !== '' && $category !== 'all' && $this->tableHasColumn('tenant_google_drive_files', 'bucket')) {
            $bucket = match ($category) {
                'kuis' => 'quiz-media',
                'tugas', 'lampiran' => 'assignments',
                default => '',
            };
            if ($bucket !== '') {
                $query->where('bucket', $bucket);
            }
        }

        $minBytes = isset($filters['min_bytes']) ? (int) $filters['min_bytes'] : 0;
        if ($minBytes > 0 && $this->tableHasColumn('tenant_google_drive_files', 'size_bytes')) {
            $query->where('size_bytes', '>=', $minBytes);
        }

        return $query;
    }

    private function driveCategoryRows(string $tenantId, array $filters = [])
    {
        if (
            ! Schema::hasTable('tenant_google_drive_files')
            || ! $this->tableHasColumn('tenant_google_drive_files', 'bucket')
            || ! $this->tableHasColumn('tenant_google_drive_files', 'size_bytes')
        ) {
            return collect();
        }

        $query = $this->driveRowsQuery($tenantId, $filters);

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
        $rows = (
            $this->tablesReady()
            && $this->tableHasColumn('storage_files', 'tahun_ajaran')
            && $this->tableHasColumn('storage_files', 'semester')
            && $this->tableHasColumn('storage_files', 'size_bytes')
        )
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
        if (! $this->storageFilesReady() || ! $this->tableHasColumn('storage_files', 'size_bytes')) {
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
        if (
            ! $this->storageFilesReady()
            || ! $this->tableHasColumn('storage_files', 'uploaded_by_user_id')
            || ! $this->tableHasColumn('storage_files', 'size_bytes')
        ) {
            return [];
        }

        $hasProfiles = Schema::hasTable('profiles') && Schema::hasColumn('profiles', 'id');
        $profileColumns = [
            'nama' => $hasProfiles && Schema::hasColumn('profiles', 'nama'),
            'email' => $hasProfiles && Schema::hasColumn('profiles', 'email'),
            'role' => $hasProfiles && Schema::hasColumn('profiles', 'role'),
        ];
        $selectColumns = ['storage_files.uploaded_by_user_id'];
        $groupColumns = ['storage_files.uploaded_by_user_id'];
        if ($profileColumns['nama']) {
            $selectColumns[] = 'p.nama';
            $groupColumns[] = 'p.nama';
        }
        if ($profileColumns['email']) {
            $selectColumns[] = 'p.email';
            $groupColumns[] = 'p.email';
        }
        if ($profileColumns['role']) {
            $selectColumns[] = 'p.role';
            $groupColumns[] = 'p.role';
        }

        $query = $this->storageRowsQuery($tenantId, $filters);
        if ($hasProfiles) {
            $query->leftJoin('profiles as p', 'p.id', '=', 'storage_files.uploaded_by_user_id');
        }

        $query
            ->select($selectColumns)
            ->selectRaw('coalesce(sum(storage_files.size_bytes), 0) as bytes, count(*) as files')
            ->groupBy($groupColumns)
            ->orderByDesc('bytes')
            ->limit(12);

        return $query->get()->map(fn ($row) => [
            'user_id' => $row->uploaded_by_user_id ?? null,
            'nama' => ($row->nama ?? null) ?: 'Tidak diketahui',
            'email' => $row->email ?? null,
            'role' => $row->role ?? null,
            'bytes' => (int) ($row->bytes ?? 0),
            'bytes_label' => $this->formatBytes((int) ($row->bytes ?? 0)),
            'files' => (int) ($row->files ?? 0),
        ])->all();
    }

    private function duplicateGroups(string $tenantId): array
    {
        if (
            ! $this->storageFilesReady()
            || ! $this->tableHasColumn('storage_files', 'duplicate_key')
            || ! $this->tableHasColumn('storage_files', 'file_name')
            || ! $this->tableHasColumn('storage_files', 'size_bytes')
        ) {
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
        if (! $this->storageFilesReady() || ! $this->tableHasColumn('storage_files', 'size_bytes')) {
            return $this->emptyTrash();
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
        if (! $this->storageFilesReady()) {
            return [];
        }

        $query = DB::table('storage_files')
            ->where('tenant_id', $tenantId)
            ->where('status', 'trash')
            ->when($this->tableHasColumn('storage_files', 'trashed_at'), fn ($trashQuery) => $trashQuery->orderByDesc('trashed_at'))
            ->limit(20);

        return $query
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
        if (! $quotaBytes || $remaining === null || ! $this->storageFilesReady() || ! $this->tableHasColumn('storage_files', 'uploaded_at')) {
            return $this->emptyPrediction();
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
        if (! $this->storageFilesReady()) {
            return [];
        }

        $provider = $this->normalizeProvider((string) ($filters['provider'] ?? self::PROVIDER_VPS));
        $bucket = trim((string) ($filters['bucket'] ?? ''));

        $query = $this->storageRowsQuery($tenantId, [
            ...$filters,
            'provider' => $provider,
            'bucket' => $bucket,
        ])->where('status', 'active');
        $query->whereIn('category', self::CLEANUP_SAFE_CATEGORIES);
        $query->whereIn('bucket', self::CLEANUP_SAFE_BUCKETS);

        $active = $this->activePeriod($tenantId);
        $activeYear = $active['tahun_ajaran'] ?? null;
        $activeSemester = $active['semester'] ?? null;
        if (
            $activeYear
            && $activeSemester
            && $this->tableHasColumn('storage_files', 'tahun_ajaran')
            && $this->tableHasColumn('storage_files', 'semester')
        ) {
            $query->where(function ($periodQuery) use ($activeYear, $activeSemester) {
                $periodQuery
                    ->whereNull('tahun_ajaran')
                    ->orWhere('tahun_ajaran', '<>', $activeYear)
                    ->orWhereNull('semester')
                    ->orWhere('semester', '<>', $activeSemester);
            });
        }

        $minimumAgeDays = $this->cleanupMinimumAgeDays($filters);
        $query
            ->whereNotNull('uploaded_at')
            ->where('uploaded_at', '<=', now()->subDays($minimumAgeDays));

        if ($this->tableHasColumn('storage_files', 'extension')) {
            $query->whereIn(DB::raw('lower(extension)'), self::CLEANUP_SAFE_EXTENSIONS);
        }

        if ($this->tableHasColumn('storage_files', 'size_bytes')) {
            $query->orderByDesc('size_bytes');
        }
        $rows = $query
            ->limit(500)
            ->get()
            ->map(fn ($row) => $this->fileRowPayload($row))
            ->filter(fn ($row) => $this->isSafeCleanupFile($row) && $this->cleanupFileIsAvailable($row))
            ->values()
            ->all();
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
        $activeYear = AcademicPeriod::normalizeAcademicYear($active['tahun_ajaran'] ?? null);
        $activeSemester = AcademicPeriod::normalizeSemester($active['semester'] ?? null);

        if (! $year || ! $semester) {
            return 'Cleanup wajib memilih tahun ajaran dan semester tertentu. Data storage hanya boleh dihapus setelah periodenya lewat minimal 1 semester.';
        }

        foreach (['id', 'bucket', 'path', 'provider', 'category', 'uploaded_at', 'tahun_ajaran', 'semester'] as $column) {
            if (! $this->tableHasColumn('storage_files', $column)) {
                return 'Metadata storage belum lengkap untuk cleanup aman. Jalankan migrasi storage dulu sebelum cleanup.';
            }
        }

        $rawProvider = trim((string) ($filters['provider'] ?? ''));
        if ($rawProvider === '') {
            return 'Pilih provider storage terlebih dahulu sebelum cleanup.';
        }

        if (! in_array(strtolower($rawProvider), ['local', 'vps', 'neva', 'neva_s3', 's3', 'object-storage', 'object_storage'], true)) {
            return 'Pilih provider storage yang valid sebelum cleanup.';
        }

        $provider = $this->normalizeProvider($rawProvider);
        if (! in_array($provider, [self::PROVIDER_VPS, self::PROVIDER_NEVA_S3], true)) {
            return 'Pilih provider storage yang valid sebelum cleanup.';
        }

        $bucket = trim((string) ($filters['bucket'] ?? ''));
        if ($bucket === '' || $bucket === 'all' || ! in_array($bucket, self::CLEANUP_SAFE_BUCKETS, true)) {
            return 'Pilih bucket yang aman untuk cleanup: assignments atau quiz-media.';
        }

        $category = trim((string) ($filters['category'] ?? ''));
        if ($category !== '' && $category !== 'all' && ! in_array($category, self::CLEANUP_SAFE_CATEGORIES, true)) {
            return 'Cleanup hanya boleh untuk file storage tugas, quiz, atau lampiran tugas.';
        }

        if (! $activeYear || ! $activeSemester) {
            return 'Periode aktif sekolah belum valid. Atur periode akademik aktif sebelum menjalankan cleanup storage.';
        }

        $targetRank = $this->semesterRank($year, $semester);
        $activeRank = $this->semesterRank($activeYear, $activeSemester);
        if ($targetRank === null || $activeRank === null) {
            return 'Periode cleanup tidak valid. Pilih tahun ajaran dan semester yang sudah selesai.';
        }

        if (($activeRank - $targetRank) < self::CLEANUP_MINIMUM_PERIOD_GAP) {
            return 'Cleanup tidak diizinkan untuk semester aktif atau semester yang belum lewat minimal 1 semester.';
        }

        return null;
    }

    private function cleanupMinimumAgeDays(array $filters): int
    {
        return max(self::CLEANUP_MINIMUM_FILE_AGE_DAYS, (int) ($filters['older_than_days'] ?? 0));
    }

    private function semesterRank(?string $year, ?string $semester): ?int
    {
        $normalizedYear = AcademicPeriod::normalizeAcademicYear($year);
        $normalizedSemester = AcademicPeriod::normalizeSemester($semester);
        if (! $normalizedYear || ! $normalizedSemester) {
            return null;
        }

        $startYear = (int) substr($normalizedYear, 0, 4);
        $semesterOffset = $normalizedSemester === AcademicPeriod::SEMESTER_GENAP ? 1 : 0;

        return ($startYear * 2) + $semesterOffset;
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

    private function moveCleanupFileToTrash(string $tenantId, array $file): ?string
    {
        if (($file['provider'] ?? 'local') === self::PROVIDER_NEVA_S3) {
            return 's3://'.$file['bucket'].'/'.$this->objectKeyForFile($file);
        }

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
        $category = (string) ($row->category ?? 'dokumen');
        $path = (string) ($row->path ?? '');
        $bucket = (string) ($row->bucket ?? '');

        return [
            'id' => (string) ($row->id ?? ''),
            'bucket' => $bucket,
            'path' => $path,
            'provider' => (string) ($row->provider ?? 'local'),
            'category' => $category,
            'category_label' => self::CATEGORY_LABELS[$category] ?? Str::title($category),
            'file_name' => ($row->file_name ?? null) ?: basename($path),
            'mime_type' => $row->mime_type ?? null,
            'extension' => strtolower((string) ($row->extension ?? pathinfo(($row->file_name ?? null) ?: $path, PATHINFO_EXTENSION))),
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

    private function isSafeCleanupFile(array $row): bool
    {
        $extension = strtolower(trim((string) ($row['extension'] ?? '')));
        if ($extension === '') {
            $extension = strtolower(pathinfo((string) (($row['file_name'] ?? '') ?: ($row['path'] ?? '')), PATHINFO_EXTENSION));
        }

        return in_array((string) ($row['provider'] ?? ''), [self::PROVIDER_VPS, self::PROVIDER_NEVA_S3], true)
            && in_array((string) ($row['bucket'] ?? ''), self::CLEANUP_SAFE_BUCKETS, true)
            && in_array((string) ($row['category'] ?? ''), self::CLEANUP_SAFE_CATEGORIES, true)
            && in_array($extension, self::CLEANUP_SAFE_EXTENSIONS, true)
            && AcademicPeriod::normalizeAcademicYear($row['tahun_ajaran'] ?? null) !== null
            && AcademicPeriod::normalizeSemester($row['semester'] ?? null) !== null;
    }

    private function cleanupFileIsAvailable(array $row): bool
    {
        if (($row['provider'] ?? 'local') === self::PROVIDER_NEVA_S3) {
            return $this->objectStorageSigner->isEnabledForBucket((string) ($row['bucket'] ?? ''));
        }

        $bucket = trim((string) ($row['bucket'] ?? ''));
        $path = ltrim((string) ($row['path'] ?? ''), '/');
        if ($bucket === '' || $path === '') {
            return false;
        }

        return Storage::disk('local')->exists('private/'.$bucket.'/'.$path);
    }

    private function objectKeyForFile(array|object $file): string
    {
        $bucket = is_array($file) ? ($file['bucket'] ?? '') : ($file->bucket ?? '');
        $path = is_array($file) ? ($file['path'] ?? '') : ($file->path ?? '');

        return 'private/'.trim((string) $bucket, '/').'/'.ltrim((string) $path, '/');
    }

    private function activePeriod(string $tenantId): array
    {
        $settings = null;
        if (Schema::hasTable('settings')) {
            $query = DB::table('settings');
            if (Schema::hasColumn('settings', 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }
            if (Schema::hasColumn('settings', 'id')) {
                $query->orderBy('id');
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
        if (
            ! $this->storageFilesReady()
            || ! $this->tableHasColumn('storage_files', 'category')
            || ! $this->tableHasColumn('storage_files', 'size_bytes')
        ) {
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

    private function assertQuotaAllocationWithinCapacity(string $tenantId, string $provider, ?int $newQuotaBytes): void
    {
        if (! $this->quotaTableReady() || $newQuotaBytes === null) {
            return;
        }

        $provider = $this->normalizeProvider($provider);
        $capacityBytes = null;
        $column = null;
        $label = self::PROVIDER_LABELS[$provider] ?? 'Storage';
        if ($provider === self::PROVIDER_NEVA_S3) {
            $capacityBytes = $this->configuredObjectStorageCapacityBytes();
            $column = 'neva_s3_quota_bytes';
        } elseif ($provider === self::PROVIDER_VPS) {
            $capacity = $this->serverCapacity();
            $capacityBytes = (int) ($capacity['total_bytes'] ?? 0);
            $column = $this->tableHasColumn('tenant_storage_quotas', 'vps_quota_bytes')
                ? 'vps_quota_bytes'
                : 'quota_bytes';
        }

        if (! $capacityBytes || $capacityBytes <= 0 || ! $column || ! $this->tableHasColumn('tenant_storage_quotas', $column)) {
            return;
        }

        $allocatedOther = (int) DB::table('tenant_storage_quotas')
            ->where('tenant_id', '<>', $tenantId)
            ->sum($column);
        $proposedTotal = $allocatedOther + $newQuotaBytes;
        if ($proposedTotal <= $capacityBytes) {
            return;
        }

        $remainingForTenant = max(0, $capacityBytes - $allocatedOther);
        throw new \InvalidArgumentException(
            'Kuota '.$label.' melebihi kapasitas platform. Maksimal tambahan untuk sekolah ini '.$this->formatBytes($remainingForTenant).'.'
        );
    }

    private function allocatedQuotaBytes(?string $provider = null): int
    {
        if (! $this->quotaTableReady()) {
            return 0;
        }

        $provider = $provider !== null ? $this->normalizeProvider($provider) : null;
        $column = match ($provider) {
            self::PROVIDER_VPS => $this->tableHasColumn('tenant_storage_quotas', 'vps_quota_bytes')
                ? 'vps_quota_bytes'
                : 'quota_bytes',
            self::PROVIDER_NEVA_S3 => 'neva_s3_quota_bytes',
            default => null,
        };

        if ($column !== null) {
            return $this->tableHasColumn('tenant_storage_quotas', $column)
                ? (int) DB::table('tenant_storage_quotas')->sum($column)
                : 0;
        }

        $columns = array_values(array_filter([
            $this->tableHasColumn('tenant_storage_quotas', 'vps_quota_bytes') ? 'vps_quota_bytes' : 'quota_bytes',
            $this->tableHasColumn('tenant_storage_quotas', 'neva_s3_quota_bytes') ? 'neva_s3_quota_bytes' : null,
        ]));

        return array_reduce($columns, fn ($total, $quotaColumn) => $total + (int) DB::table('tenant_storage_quotas')->sum($quotaColumn), 0);
    }

    private function latestProviderSnapshotTotals(string $provider): array
    {
        if (! Schema::hasTable('storage_provider_snapshots')) {
            return [];
        }

        $rows = DB::table('storage_provider_snapshots')
            ->where('provider', $this->normalizeProvider($provider))
            ->get();
        if ($rows->isEmpty()) {
            return [];
        }

        return [
            'total_bytes' => (int) $rows->sum('total_bytes'),
            'total_files' => (int) $rows->sum('total_files'),
            'tracked_bytes' => (int) $rows->sum('tracked_bytes'),
            'tracked_files' => (int) $rows->sum('tracked_files'),
            'untracked_bytes' => (int) $rows->sum('untracked_bytes'),
            'untracked_files' => (int) $rows->sum('untracked_files'),
            'last_scanned_at' => $rows->max('scanned_at'),
        ];
    }

    private function latestProviderBucketSnapshots(string $provider): array
    {
        if (! Schema::hasTable('storage_provider_snapshots')) {
            return [];
        }

        return DB::table('storage_provider_snapshots')
            ->where('provider', $this->normalizeProvider($provider))
            ->orderBy('logical_bucket')
            ->get()
            ->map(fn ($row) => [
                'logical_bucket' => (string) ($row->logical_bucket ?? ''),
                'label' => $this->bucketLabel((string) ($row->logical_bucket ?? '')),
                'physical_bucket' => (string) ($row->physical_bucket ?? ''),
                'total_bytes' => (int) ($row->total_bytes ?? 0),
                'total_label' => $this->formatBytes((int) ($row->total_bytes ?? 0)),
                'total_files' => (int) ($row->total_files ?? 0),
                'tracked_bytes' => (int) ($row->tracked_bytes ?? 0),
                'tracked_label' => $this->formatBytes((int) ($row->tracked_bytes ?? 0)),
                'tracked_files' => (int) ($row->tracked_files ?? 0),
                'untracked_bytes' => (int) ($row->untracked_bytes ?? 0),
                'untracked_label' => $this->formatBytes((int) ($row->untracked_bytes ?? 0)),
                'untracked_files' => (int) ($row->untracked_files ?? 0),
                'scanned_at' => $row->scanned_at ?? null,
            ])
            ->all();
    }

    private function bucketLabel(string $bucket): string
    {
        return match ($bucket) {
            'assignments' => 'Tugas',
            'quiz-media' => 'Media Quiz',
            'certificates' => 'Sertifikat',
            'sertifikat-files' => 'File Sertifikat',
            'certificate-templates', 'sertifikat-templates' => 'Template Sertifikat',
            default => Str::title(str_replace(['-', '_'], ' ', $bucket)),
        };
    }

    private function profileRole(string $userId, string $tenantId): ?string
    {
        if ($userId === '' || ! Schema::hasTable('profiles') || ! Schema::hasColumn('profiles', 'id') || ! Schema::hasColumn('profiles', 'role')) {
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

    private function rowNullableInt(?object $row, string $key): ?int
    {
        if (! $row || ! property_exists($row, $key) || $row->{$key} === null || $row->{$key} === '') {
            return null;
        }

        $value = (int) $row->{$key};

        return $value > 0 ? $value : null;
    }

    private function sumNullableBytes(array $values): ?int
    {
        $filtered = array_values(array_filter(
            $values,
            fn ($value) => $value !== null && $value !== ''
        ));
        if (empty($filtered)) {
            return null;
        }

        return array_sum(array_map(fn ($value) => max(0, (int) $value), $filtered));
    }

    private function maxNullableBytes(array $values): ?int
    {
        $filtered = array_values(array_filter(
            $values,
            fn ($value) => $value !== null && $value !== ''
        ));
        if (empty($filtered)) {
            return null;
        }

        return max(array_map(fn ($value) => max(0, (int) $value), $filtered));
    }

    private function normalizeProvider(string $provider): string
    {
        $provider = strtolower(trim($provider));

        return match ($provider) {
            'neva', 'neva_s3', 's3', 'object-storage', 'object_storage' => self::PROVIDER_NEVA_S3,
            'local', 'vps' => self::PROVIDER_VPS,
            default => self::PROVIDER_VPS,
        };
    }

    private function configuredObjectStorageCapacityBytes(): ?int
    {
        $bytes = $this->firstFilledValue(
            config('services.object_storage.capacity_bytes'),
            getenv('APP_OBJECT_STORAGE_CAPACITY_BYTES') ?: null,
            $_ENV['APP_OBJECT_STORAGE_CAPACITY_BYTES'] ?? null,
            $_SERVER['APP_OBJECT_STORAGE_CAPACITY_BYTES'] ?? null
        );
        if ($bytes !== null) {
            $value = $this->parseStorageCapacityBytes($bytes, 1);
            if ($value !== null) {
                return $value;
            }
        }

        $gb = $this->firstFilledValue(
            config('services.object_storage.capacity_gb'),
            getenv('APP_OBJECT_STORAGE_CAPACITY_GB') ?: null,
            $_ENV['APP_OBJECT_STORAGE_CAPACITY_GB'] ?? null,
            $_SERVER['APP_OBJECT_STORAGE_CAPACITY_GB'] ?? null
        );
        if ($gb !== null) {
            $value = $this->parseStorageCapacityBytes($gb, 1024 * 1024 * 1024);
            if ($value !== null) {
                return $value;
            }
        }

        return null;
    }

    private function firstFilledValue(mixed ...$values): mixed
    {
        foreach ($values as $value) {
            if ($value === null) {
                continue;
            }
            if (is_string($value) && trim($value) === '') {
                continue;
            }

            return $value;
        }

        return null;
    }

    private function parseStorageCapacityBytes(mixed $value, int $multiplier): ?int
    {
        $raw = trim((string) $value);
        if ($raw === '') {
            return null;
        }

        $normalized = preg_replace('/[^0-9.,]/', '', $raw) ?? '';
        $normalized = str_replace(',', '.', $normalized);
        if ($normalized === '' || ! is_numeric($normalized)) {
            return null;
        }

        $number = (float) $normalized;

        return $number > 0 ? (int) round($number * $multiplier) : null;
    }

    private function quotaTableReady(): bool
    {
        return Schema::hasTable('tenant_storage_quotas')
            && Schema::hasColumn('tenant_storage_quotas', 'tenant_id');
    }

    private function storageFilesReady(): bool
    {
        return Schema::hasTable('storage_files')
            && Schema::hasColumn('storage_files', 'tenant_id')
            && Schema::hasColumn('storage_files', 'status')
            && Schema::hasColumn('storage_files', 'size_bytes');
    }

    private function cleanupJobsReady(): bool
    {
        return Schema::hasTable('storage_cleanup_jobs');
    }

    private function tableHasColumn(string $table, string $column): bool
    {
        return Schema::hasTable($table) && Schema::hasColumn($table, $column);
    }

    private function safeSection(string $section, mixed $fallback, callable $callback, array $context = []): mixed
    {
        try {
            return $callback();
        } catch (\Throwable $e) {
            Log::warning('storage_manager_section_failed', [
                ...$context,
                'section' => $section,
                'error' => $this->shortError($e->getMessage()),
            ]);

            return $fallback;
        }
    }

    private function emptyTenantOverview(): array
    {
        return [
            'quota' => $this->emptyQuota(''),
            'providers' => $this->emptyProviderQuotas(''),
            'usage' => $this->emptyUsage(),
            'top_category' => null,
            'prediction' => $this->emptyPrediction(),
        ];
    }

    private function emptyQuota(string $tenantId): array
    {
        $usedBytes = $this->tenantUsedBytes($tenantId);

        return [
            'quota_bytes' => null,
            'quota_label' => 'Tidak dibatasi',
            'max_upload_bytes' => null,
            'max_upload_label' => 'Default sistem',
            'used_bytes' => $usedBytes,
            'used_label' => $this->formatBytes($usedBytes),
            'remaining_bytes' => null,
            'remaining_label' => 'Tidak dibatasi',
            'percent' => null,
            'notes' => null,
            'providers' => $this->emptyProviderQuotas($tenantId),
        ];
    }

    private function emptyProviderQuotas(string $tenantId): array
    {
        return [
            'vps' => $this->emptyProviderQuota($tenantId, self::PROVIDER_VPS, 'vps'),
            'neva_s3' => $this->emptyProviderQuota($tenantId, self::PROVIDER_NEVA_S3, 'neva_s3'),
        ];
    }

    private function emptyProviderQuota(string $tenantId, string $provider, string $key): array
    {
        $usedBytes = $this->tenantUsedBytes($tenantId, $provider);

        return [
            'key' => $key,
            'provider' => $provider,
            'label' => self::PROVIDER_LABELS[$provider] ?? Str::title(str_replace('_', ' ', $provider)),
            'quota_bytes' => null,
            'quota_label' => 'Tidak dibatasi',
            'max_upload_bytes' => null,
            'max_upload_label' => 'Default sistem',
            'used_bytes' => $usedBytes,
            'used_label' => $this->formatBytes($usedBytes),
            'remaining_bytes' => null,
            'remaining_label' => 'Tidak dibatasi',
            'percent' => null,
        ];
    }

    private function emptyProviderSummaries(string $tenantId): array
    {
        return [
            'vps' => [
                'provider' => self::PROVIDER_VPS,
                'label' => self::PROVIDER_LABELS[self::PROVIDER_VPS],
                'quota' => $this->emptyProviderQuota($tenantId, self::PROVIDER_VPS, 'vps'),
                'usage' => $this->emptyUsage(),
                'top_category' => null,
                'largest_files' => [],
                'by_uploader' => [],
            ],
            'neva_s3' => [
                'provider' => self::PROVIDER_NEVA_S3,
                'label' => self::PROVIDER_LABELS[self::PROVIDER_NEVA_S3],
                'quota' => $this->emptyProviderQuota($tenantId, self::PROVIDER_NEVA_S3, 'neva_s3'),
                'usage' => $this->emptyUsage(),
                'top_category' => null,
                'largest_files' => [],
                'by_uploader' => [],
            ],
        ];
    }

    private function emptyUsage(): array
    {
        return [
            'total_bytes' => 0,
            'total_label' => '0 B',
            'total_files' => 0,
            'by_category' => [],
            'by_period' => [],
        ];
    }

    private function emptyTrash(): array
    {
        return ['files' => 0, 'bytes' => 0, 'bytes_label' => '0 B'];
    }

    private function emptyPrediction(): array
    {
        return ['daily_growth_bytes' => 0, 'daily_growth_label' => '0 B', 'days_until_full' => null];
    }

    private function shortError(string $message): string
    {
        $message = trim($message);

        return Str::limit($message !== '' ? $message : 'Unknown error', 300);
    }
}
