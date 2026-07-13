<?php

namespace App\Console\Commands;

use App\Models\TenantGoogleDriveConfig;
use App\Services\GoogleDrive\GoogleDriveService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ProtectGoogleDriveBackupsCommand extends Command
{
    protected $signature = 'backup:protect-google-drive
        {--tenant= : Batasi ke satu tenant id/slug}
        {--dry-run : Hanya laporkan izin publik tanpa mencabutnya}';

    protected $description = 'Memastikan file backup Google Drive tenant tidak memiliki izin publik atau domain.';

    public function handle(GoogleDriveService $googleDriveService): int
    {
        $tenantFilter = trim((string) ($this->option('tenant') ?: ''));
        $tenantIds = $tenantFilter !== ''
            ? [$this->resolveTenantId($tenantFilter)]
            : TenantGoogleDriveConfig::query()
                ->where('is_enabled', true)
                ->pluck('tenant_id')
                ->map(fn ($value) => trim((string) $value))
                ->filter()
                ->unique()
                ->values()
                ->all();

        $failed = 0;
        foreach (array_filter($tenantIds) as $tenantId) {
            try {
                $result = $googleDriveService->protectTenantBackupFiles((string) $tenantId, (bool) $this->option('dry-run'));
                $this->info(sprintf(
                    'OK %s: checked=%d public=%d revoked=%d errors=%d',
                    $tenantId,
                    (int) ($result['files_checked'] ?? 0),
                    (int) ($result['public_permissions_found'] ?? 0),
                    (int) ($result['permissions_revoked'] ?? 0),
                    (int) ($result['errors'] ?? 0)
                ));
                if ((int) ($result['errors'] ?? 0) > 0) {
                    $failed++;
                }
            } catch (\Throwable $e) {
                $failed++;
                $this->error('FAIL '.$tenantId.': '.trim((string) $e->getMessage()));
            }
        }

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function resolveTenantId(string $value): string
    {
        $tenant = DB::table('tenants')
            ->where('id', $value)
            ->orWhere('slug', $value)
            ->first(['id']);

        return trim((string) ($tenant->id ?? ''));
    }
}
