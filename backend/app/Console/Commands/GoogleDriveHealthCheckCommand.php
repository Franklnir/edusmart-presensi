<?php

namespace App\Console\Commands;

use App\Models\TenantGoogleDriveConfig;
use App\Services\Backup\BackupNotificationService;
use App\Services\GoogleDrive\GoogleDriveService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Schema;

class GoogleDriveHealthCheckCommand extends Command
{
    protected $signature = 'google-drive:health-check {--recover : Coba pulihkan koneksi needs_attention yang masih punya refresh token}';

    protected $description = 'Mengecek kesehatan koneksi Google Drive tenant secara ringan.';

    public function handle(GoogleDriveService $googleDriveService, BackupNotificationService $backupNotificationService): int
    {
        if (! Schema::hasTable('tenant_google_drive_configs')) {
            $this->warn('Tabel konfigurasi Google Drive belum tersedia.');

            return self::SUCCESS;
        }

        $recover = (bool) $this->option('recover');
        $configs = TenantGoogleDriveConfig::query()
            ->where('is_enabled', true)
            ->get(['tenant_id', 'status']);

        $checked = 0;
        $recovered = 0;
        $attention = 0;

        foreach ($configs as $config) {
            $tenantId = trim((string) ($config->tenant_id ?? ''));
            if ($tenantId === '') {
                continue;
            }

            $checked++;
            $status = (string) ($config->status ?? '');
            if ($status === GoogleDriveService::STATUS_CONNECTED || $recover) {
                $result = $googleDriveService->recoverTenantConnection($tenantId, 'scheduled-health-check');
                if (($result['status'] ?? '') === GoogleDriveService::STATUS_CONNECTED) {
                    if ((bool) ($result['recovered'] ?? false)) {
                        $recovered++;
                        $backupNotificationService->googleDriveRecovered($tenantId, $result);
                    }
                    $this->line("OK {$tenantId}: ".($result['message'] ?? 'connected'));

                    continue;
                }

                $attention++;
                $backupNotificationService->googleDriveNeedsAttention($tenantId, $result);
                $this->warn("ATTENTION {$tenantId}: ".($result['last_error'] ?? $result['message'] ?? 'needs_attention'));
            }
        }

        $this->info("Selesai. checked={$checked}, recovered={$recovered}, attention={$attention}");

        return self::SUCCESS;
    }
}
