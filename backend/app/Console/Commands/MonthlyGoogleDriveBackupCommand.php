<?php

namespace App\Console\Commands;

use App\Services\Backup\TenantBackupService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class MonthlyGoogleDriveBackupCommand extends Command
{
    protected $signature = 'backup:monthly-google-drive
        {--tenant= : Batasi ke satu tenant id/slug}
        {--month= : Pakai bulan tertentu dalam format YYYY-MM}
        {--force : Buat ulang meskipun bulan tersebut sudah ada backup}';

    protected $description = 'Membuat backup database tenant lengkap ke Google Drive sekolah pada akhir bulan.';

    public function handle(TenantBackupService $tenantBackupService): int
    {
        $monthKey = trim((string) ($this->option('month') ?: $tenantBackupService->currentMonthKey()));
        $tenantFilter = trim((string) ($this->option('tenant') ?: ''));
        $force = (bool) $this->option('force');

        $tenantIds = $tenantFilter !== ''
            ? [$tenantFilter]
            : $tenantBackupService->tenantsEligibleForMonthlyBackup();

        if (empty($tenantIds)) {
            $this->info('Tidak ada tenant dengan Google Drive terhubung.');

            return self::SUCCESS;
        }

        $success = 0;
        $skipped = 0;
        $failed = 0;

        foreach ($tenantIds as $tenantId) {
            $tenantId = $this->resolveTenantId((string) $tenantId);
            if ($tenantId === '') {
                $failed++;
                $this->error('FAIL: tenant tidak ditemukan.');
                continue;
            }
            try {
                $file = $tenantBackupService->saveMonthlyBackupToGoogleDrive(
                    $tenantId,
                    $monthKey,
                    'system',
                    $force
                );
                $success++;
                $this->info("OK {$tenantId}: ".($file['drive_file_name'] ?? 'backup.json'));
            } catch (\Throwable $e) {
                $message = trim((string) $e->getMessage());
                if (str_contains(strtolower($message), 'sudah tersedia')) {
                    $skipped++;
                    $this->line("SKIP {$tenantId}: {$message}");
                    continue;
                }

                $failed++;
                $this->error("FAIL {$tenantId}: {$message}");
                Log::warning('Monthly Google Drive backup failed', [
                    'tenant_id' => $tenantId,
                    'month' => $monthKey,
                    'error' => $message,
                ]);
            }
        }

        $this->info("Selesai. sukses={$success}, skip={$skipped}, gagal={$failed}");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function resolveTenantId(string $value): string
    {
        $value = trim($value);
        if ($value === '') {
            return '';
        }

        try {
            $tenant = DB::table('tenants')
                ->where('id', $value)
                ->orWhere('slug', $value)
                ->first(['id']);

            return (string) ($tenant->id ?? '');
        } catch (\Throwable $e) {
            return $value;
        }
    }
}
