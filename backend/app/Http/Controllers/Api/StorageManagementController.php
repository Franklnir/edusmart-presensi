<?php

namespace App\Http\Controllers\Api;

use App\Services\GoogleDrive\GoogleDriveService;
use App\Services\Storage\StorageManagementService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;

class StorageManagementController extends ApiController
{
    public function __construct(
        private readonly StorageManagementService $storageManagementService,
        private readonly GoogleDriveService $googleDriveService
    ) {}

    public function adminSummary(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '') {
            return $this->deny('Tenant tidak ditemukan', 422);
        }

        return $this->ok($this->storageManagementService->tenantSummary($tenantId, $this->filters($request)));
    }

    public function adminCleanupPreview(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '') {
            return $this->deny('Tenant tidak ditemukan', 422);
        }

        return $this->ok($this->storageManagementService->cleanupPreview($tenantId, $this->cleanupFilters($request)));
    }

    public function adminCleanupExecute(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '') {
            return $this->deny('Tenant tidak ditemukan', 422);
        }

        $result = $this->storageManagementService->executeCleanup(
            $tenantId,
            $this->cleanupFilters($request),
            (string) ($request->user()?->id ?? ''),
            filter_var($request->input('backup', true), FILTER_VALIDATE_BOOLEAN)
        );

        return ($result['ok'] ?? false)
            ? $this->ok($result)
            : response()->json(['error' => $result['message'] ?? 'Cleanup gagal', 'data' => $result], 422);
    }

    public function adminObjectStorageSync(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '') {
            return $this->deny('Tenant tidak ditemukan', 422);
        }

        return $this->ok($this->storageManagementService->syncObjectStorageInventory($tenantId, [
            'bucket' => $request->input('bucket', $request->query('bucket')),
            'max_pages' => $request->input('max_pages', $request->query('max_pages', 5)),
        ]));
    }

    public function restoreTrashFile(Request $request, string $fileId)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny();
        }

        $tenantId = (string) ($this->tenantId($request) ?? '');
        if ($tenantId === '' || ! $this->storageManagementService->restoreFile($tenantId, $fileId)) {
            return response()->json(['error' => 'File trash tidak ditemukan'], 404);
        }

        return $this->ok(['restored' => true]);
    }

    public function superOverview(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        return $this->ok($this->storageManagementService->superOverview());
    }

    public function superTenantSummary(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        return $this->ok([
            'tenant' => $tenant,
            ...$this->storageManagementService->tenantSummary((string) $tenant->id, $this->filters($request)),
        ]);
    }

    public function superUpdateQuota(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $validator = Validator::make($request->all(), [
            'quota_bytes' => ['nullable', 'integer', 'min:0'],
            'max_upload_bytes' => ['nullable', 'integer', 'min:0'],
            'vps_quota_bytes' => ['nullable', 'integer', 'min:0'],
            'vps_max_upload_bytes' => ['nullable', 'integer', 'min:0'],
            'neva_s3_quota_bytes' => ['nullable', 'integer', 'min:0'],
            'neva_s3_max_upload_bytes' => ['nullable', 'integer', 'min:0'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()->first()], 422);
        }

        try {
            return $this->ok($this->storageManagementService->updateQuota(
                (string) $tenant->id,
                $validator->validated(),
                (string) ($request->user()?->id ?? '')
            ));
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }

    public function superCleanupPreview(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        return $this->ok($this->storageManagementService->cleanupPreview((string) $tenant->id, $this->cleanupFilters($request)));
    }

    public function superCleanupExecute(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        $result = $this->storageManagementService->executeCleanup(
            (string) $tenant->id,
            $this->cleanupFilters($request),
            (string) ($request->user()?->id ?? ''),
            filter_var($request->input('backup', true), FILTER_VALIDATE_BOOLEAN)
        );

        return ($result['ok'] ?? false)
            ? $this->ok($result)
            : response()->json(['error' => $result['message'] ?? 'Cleanup gagal', 'data' => $result], 422);
    }

    public function superObjectStorageSync(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        return $this->ok($this->storageManagementService->syncObjectStorageInventory(null, [
            'bucket' => $request->input('bucket', $request->query('bucket')),
            'max_pages' => $request->input('max_pages', $request->query('max_pages', 10)),
        ]));
    }

    public function superTenantObjectStorageSync(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        return $this->ok($this->storageManagementService->syncObjectStorageInventory((string) $tenant->id, [
            'bucket' => $request->input('bucket', $request->query('bucket')),
            'max_pages' => $request->input('max_pages', $request->query('max_pages', 5)),
        ]));
    }

    public function superRestoreTrashFile(Request $request, string $tenantId, string $fileId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        if (! $this->storageManagementService->restoreFile((string) $tenant->id, $fileId)) {
            return response()->json(['error' => 'File trash tidak ditemukan'], 404);
        }

        return $this->ok(['restored' => true]);
    }

    public function superTenantDriveSummary(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        return $this->ok($this->googleDriveService->statusForTenant(
            (string) $tenant->id,
            false,
            $this->driveUsageFilters($request)
        ));
    }

    public function superTenantDriveSync(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        return $this->ok($this->googleDriveService->statusForTenant(
            (string) $tenant->id,
            true,
            $this->driveUsageFilters($request)
        ));
    }

    public function superTenantDriveFiles(Request $request, string $tenantId)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        $tenant = $this->tenantByIdOrSlug($tenantId);
        if (! $tenant) {
            return response()->json(['error' => 'Tenant tidak ditemukan'], 404);
        }

        return $this->ok($this->googleDriveService->filesForTenant(
            (string) $tenant->id,
            $this->driveFileFilters($request)
        ));
    }

    public function superPurgeExpiredTrash(Request $request)
    {
        if (! $this->isSuperAdmin($request)) {
            return $this->deny();
        }

        return $this->ok($this->storageManagementService->purgeExpiredTrash());
    }

    private function filters(Request $request): array
    {
        return [
            'tahun_ajaran' => $request->query('tahun_ajaran', $request->input('tahun_ajaran')),
            'semester' => $request->query('semester', $request->input('semester')),
            'category' => $request->query('category', $request->input('category')),
            'provider' => $request->query('provider', $request->input('provider')),
            'bucket' => $request->query('bucket', $request->input('bucket')),
            'uploaded_by_user_id' => $request->query('uploaded_by_user_id', $request->input('uploaded_by_user_id')),
            'min_bytes' => $request->query('min_bytes', $request->input('min_bytes')),
        ];
    }

    private function cleanupFilters(Request $request): array
    {
        return [
            ...$this->filters($request),
            'older_than_days' => $request->input('older_than_days', $request->query('older_than_days')),
            'largest_percent' => $request->input('largest_percent', $request->query('largest_percent')),
            'mode' => $request->input('mode', $request->query('mode', 'cleanup')),
        ];
    }

    private function driveUsageFilters(Request $request): array
    {
        return [
            'tahun_ajaran' => (string) $request->query('tahun_ajaran', $request->query('tahunAjaran', '')),
            'semester' => (string) $request->query('semester', ''),
        ];
    }

    private function driveFileFilters(Request $request): array
    {
        return [
            ...$this->driveUsageFilters($request),
            'bucket' => (string) $request->query('bucket', ''),
            'kelas' => (string) $request->query('kelas', ''),
            'angkatan' => (string) $request->query('angkatan', ''),
            'q' => (string) $request->query('q', ''),
            'limit' => (int) $request->query('limit', 50),
        ];
    }

    private function tenantByIdOrSlug(string $idOrSlug): ?object
    {
        if (! Schema::hasTable('tenants') || ! Schema::hasColumn('tenants', 'id')) {
            return null;
        }

        $columns = array_values(array_filter(
            ['id', 'name', 'slug', 'status'],
            fn ($column) => Schema::hasColumn('tenants', $column)
        ));
        $query = DB::table('tenants')->where('id', $idOrSlug);
        if (Schema::hasColumn('tenants', 'slug')) {
            $query->orWhere('slug', $idOrSlug);
        }

        $tenant = $query->first($columns);
        if (! $tenant) {
            return null;
        }

        $tenant->name = $tenant->name ?? $tenant->slug ?? $tenant->id;
        $tenant->slug = $tenant->slug ?? '';
        $tenant->status = $tenant->status ?? 'active';

        return $tenant;
    }
}
