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
        {--force : Buat ulang meskipun bulan tersebut sudah ada backup}
        {--sync : Jalankan langsung di proses command, bukan queue}
        {--catch-up : Proses semua bulan periode aktif yang terlewat atau punya data baru}
        {--spacing-minutes= : Jeda antar tenant saat dispatch queue}';

    protected $description = 'Membuat backup database tenant lengkap ke Google Drive sekolah pada akhir bulan.';

    public function handle(TenantBackupService $tenantBackupService): int
    {
        $monthOption = trim((string) ($this->option('month') ?: ''));
        $tenantFilter = trim((string) ($this->option('tenant') ?: ''));
        $force = (bool) $this->option('force');
        $sync = (bool) $this->option('sync');
        $spacingMinutes = $this->normalizeSpacingMinutes($this->option('spacing-minutes'));

        $tenantIds = $tenantFilter !== ''
            ? [$tenantFilter]
            : $tenantBackupService->tenantsEligibleForMonthlyBackupWithDriveRecovery();

        if (empty($tenantIds)) {
            $this->info('Tidak ada tenant dengan Google Drive terhubung.');

            return self::SUCCESS;
        }

        $success = 0;
        $queued = 0;
        $skipped = 0;
        $failed = 0;
        $dispatchIndex = 0;

        foreach (array_values($tenantIds) as $tenantId) {
            $tenantId = $this->resolveTenantId((string) $tenantId);
            if ($tenantId === '') {
                $failed++;
                $this->error('FAIL: tenant tidak ditemukan.');

                continue;
            }

            try {
                $monthKeys = $monthOption !== ''
                    ? [$monthOption]
                    : $tenantBackupService->monthlyCatchUpKeysForTenant($tenantId);

                if (empty($monthKeys)) {
                    $skipped++;
                    $this->line("SKIP {$tenantId}: tidak ada bulan yang perlu backup.");

                    continue;
                }

                foreach ($monthKeys as $monthKey) {
                    if (! $sync) {
                        $delaySeconds = $dispatchIndex * $spacingMinutes * 60;
                        $status = $tenantBackupService->queueMonthlyBackupToGoogleDrive(
                            $tenantId,
                            (string) $monthKey,
                            'system',
                            $force,
                            false,
                            $delaySeconds
                        );
                        $queued++;
                        $dispatchIndex++;
                        $this->info(sprintf(
                            'QUEUE %s: %s delay=%ds job=%s%s',
                            $tenantId,
                            (string) $monthKey,
                            $delaySeconds,
                            (string) ($status['job_id'] ?? '-'),
                            (bool) ($status['already_queued'] ?? false) ? ' already_queued' : ''
                        ));

                        continue;
                    }

                    $file = $tenantBackupService->saveMonthlyBackupToGoogleDrive(
                        $tenantId,
                        (string) $monthKey,
                        'system',
                        $force
                    );
                    $success++;
                    $this->info("OK {$tenantId}: ".($file['drive_file_name'] ?? 'backup.json'));
                }
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
                    'month' => $monthOption ?: 'catch-up',
                    'error' => $message,
                ]);
            }
        }

        $this->info("Selesai. queued={$queued}, sukses={$success}, skip={$skipped}, gagal={$failed}");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function normalizeSpacingMinutes($value): int
    {
        $raw = $value !== null && $value !== ''
            ? (int) $value
            : (int) config('backup.monthly_auto_tenant_spacing_minutes', 4);

        return max(1, min($raw, 60));
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
