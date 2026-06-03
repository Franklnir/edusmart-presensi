<?php

namespace App\Http\Controllers\Api;

use App\Services\Backup\TenantBackupService;
use App\Traits\HasTenantRestoreLogic;
use Illuminate\Http\Request;

class AdminBackupController extends ApiController
{
    use HasTenantRestoreLogic;

    public function __construct(private readonly TenantBackupService $tenantBackupService) {}

    public function backup(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa melakukan backup.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $this->tenantBackupService->buildPayload(
            (string) $tenantId,
            $request->query(),
            (string) ($request->user()?->id ?? ''),
            $this->role($request) ?: null
        );

        return response()->json([
            'data' => $payload,
        ]);
    }

    public function restore(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa melakukan restore.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $backupPayload = $this->normalizeRestoreBackupPayload($request->input('backup'));
        if (! $backupPayload) {
            return $this->deny('Payload backup tidak valid. Gunakan format JSON backup yang benar.', 422);
        }

        $dryRun = filter_var($request->input('dry_run', true), FILTER_VALIDATE_BOOLEAN);
        $truncateBeforeRestore = filter_var($request->input('truncate_before_restore', false), FILTER_VALIDATE_BOOLEAN);
        $includeTables = $request->input('include_tables', []);
        if (! is_array($includeTables)) {
            $includeTables = [];
        }

        if (! $dryRun && ! filter_var($request->input('confirm', false), FILTER_VALIDATE_BOOLEAN)) {
            return $this->deny('Untuk menjalankan restore nyata, kirim confirm=true.', 422);
        }

        try {
            $result = $this->restoreBackupPayloadForTenant(
                (string) $tenantId,
                $backupPayload,
                $dryRun,
                $truncateBeforeRestore,
                $includeTables
            );
        } catch (\Throwable $e) {
            return $this->deny('Restore gagal: '.trim((string) $e->getMessage()), 422);
        }

        if (! $dryRun) {
            $this->logAudit(
                $request,
                'tenant_restore',
                'restore-'.$tenantId,
                'UPDATE',
                null,
                [
                    'type' => 'tenant_restore',
                    'tenant_id' => $tenantId,
                    'summary' => $result['summary'] ?? [],
                ],
                (string) $tenantId
            );
        }

        return response()->json([
            'data' => [
                'tenant_id' => $tenantId,
                'dry_run' => $dryRun,
                'result' => $result,
            ],
        ]);
    }

    public function saveToGoogleDrive(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa menyimpan backup.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $payload = $this->tenantBackupService->buildPayload(
            (string) $tenantId,
            $request->input(),
            (string) ($request->user()?->id ?? ''),
            $this->role($request) ?: null
        );

        try {
            $driveFile = $this->tenantBackupService->savePayloadFormatsToGoogleDrive(
                (string) $tenantId,
                (string) ($request->user()?->id ?? ''),
                $payload
            );
        } catch (\Throwable $e) {
            return $this->deny('Gagal menyimpan backup ke Google Drive: '.trim((string) $e->getMessage()), 422);
        }

        $this->logAudit(
            $request,
            'tenant_backup_google_drive',
            'backup-'.$tenantId,
            'CREATE',
            null,
            [
                'type' => 'tenant_backup_google_drive',
                'tenant_id' => $tenantId,
                'mode' => $payload['mode'] ?? 'full',
                'period' => $payload['period'] ?? null,
                'summary' => $payload['summary'] ?? [],
                'drive_file_id' => $driveFile['drive_file_id'] ?? null,
                'drive_folder_path' => $driveFile['drive_folder_path'] ?? null,
            ],
            (string) $tenantId
        );

        return response()->json([
            'data' => [
                'backup' => [
                    'tenant' => $payload['tenant'],
                    'mode' => $payload['mode'],
                    'mode_label' => $payload['mode_label'],
                    'period' => $payload['period'],
                    'summary' => $payload['summary'],
                    'manifest' => $payload['manifest'],
                ],
                'drive_file' => $driveFile,
            ],
        ]);
    }

    public function monthlyStatus(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa melihat jadwal backup.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        return response()->json([
            'data' => $this->tenantBackupService->monthlyStatus((string) $tenantId),
        ]);
    }

    public function saveMonthlyToGoogleDrive(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa menyimpan backup.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $monthKey = trim((string) $request->input('month'));
        if ($monthKey === '') {
            return $this->deny('Bulan backup wajib dipilih.', 422);
        }

        try {
            $driveFile = $this->tenantBackupService->saveMonthlyBackupToGoogleDrive(
                (string) $tenantId,
                $monthKey,
                (string) ($request->user()?->id ?? ''),
                filter_var($request->input('force', false), FILTER_VALIDATE_BOOLEAN)
            );
        } catch (\Throwable $e) {
            return $this->deny('Gagal menyimpan backup bulanan ke Google Drive: '.trim((string) $e->getMessage()), 422);
        }

        $this->logAudit(
            $request,
            'tenant_monthly_backup_google_drive',
            'backup-monthly-'.$tenantId.'-'.$monthKey,
            'CREATE',
            null,
            [
                'type' => 'tenant_monthly_backup_google_drive',
                'tenant_id' => $tenantId,
                'month' => $monthKey,
                'drive_file_id' => $driveFile['drive_file_id'] ?? null,
                'drive_folder_path' => $driveFile['drive_folder_path'] ?? null,
            ],
            (string) $tenantId
        );

        return response()->json([
            'data' => [
                'month' => $monthKey,
                'drive_file' => $driveFile,
                'monthly_status' => $this->tenantBackupService->monthlyStatus((string) $tenantId),
            ],
        ]);
    }

    public function autoMonthlyToGoogleDrive(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa menyimpan backup.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        try {
            $result = $this->tenantBackupService->autoMonthlyBackupToGoogleDrive(
                (string) $tenantId,
                (string) ($request->user()?->id ?? '')
            );
        } catch (\Throwable $e) {
            return $this->deny('Gagal menjalankan auto backup bulanan ke Google Drive: '.trim((string) $e->getMessage()), 422);
        }

        $this->logAudit(
            $request,
            'tenant_monthly_auto_backup_google_drive',
            'backup-monthly-auto-'.$tenantId,
            'CREATE',
            null,
            [
                'type' => 'tenant_monthly_auto_backup_google_drive',
                'tenant_id' => $tenantId,
                'summary' => $result['summary'] ?? [],
            ],
            (string) $tenantId
        );

        return response()->json([
            'data' => $result,
        ]);
    }
}
