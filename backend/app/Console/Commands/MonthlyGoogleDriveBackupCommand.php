<?php

namespace App\Console\Commands;

use App\Jobs\TenantMonthlyGoogleDriveBackupJob;
use App\Services\Backup\TenantBackupService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class MonthlyGoogleDriveBackupCommand extends Command
{
    protected $signature = 'backup:monthly-google-drive
        {--tenant= : Batasi ke satu tenant id/slug}
        {--month= : Pakai bulan tertentu dalam format YYYY-MM}
        {--force : Buat ulang meskipun bulan tersebut sudah ada backup}
        {--sync : Jalankan langsung di proses command, bukan queue}
        {--spacing-minutes= : Jeda antar tenant saat dispatch queue}';

    protected $description = 'Membuat backup database tenant lengkap ke Google Drive sekolah pada akhir bulan.';

    public function handle(TenantBackupService $tenantBackupService): int
    {
        $monthKey = trim((string) ($this->option('month') ?: $tenantBackupService->currentMonthKey()));
        $tenantFilter = trim((string) ($this->option('tenant') ?: ''));
        $force = (bool) $this->option('force');
        $sync = (bool) $this->option('sync');
        $spacingMinutes = $this->normalizeSpacingMinutes($this->option('spacing-minutes'));

        $tenantIds = $tenantFilter !== ''
            ? [$tenantFilter]
            : $tenantBackupService->tenantsEligibleForMonthlyBackup();

        if (empty($tenantIds)) {
            $this->info('Tidak ada tenant dengan Google Drive terhubung.');

            return self::SUCCESS;
        }

        $success = 0;
        $queued = 0;
        $skipped = 0;
        $failed = 0;

        foreach (array_values($tenantIds) as $index => $tenantId) {
            $tenantId = $this->resolveTenantId((string) $tenantId);
            if ($tenantId === '') {
                $failed++;
                $this->error('FAIL: tenant tidak ditemukan.');

                continue;
            }

            try {
                if (! $sync) {
                    $jobId = (string) Str::uuid();
                    $delaySeconds = $index * $spacingMinutes * 60;
                    $tenantBackupService->putMonthlyBackupJobStatus($tenantId, $jobId, [
                        'status' => 'queued',
                        'progress' => 12,
                        'type' => 'monthly',
                        'month' => $monthKey,
                        'message' => 'Backup bulanan otomatis masuk antrean scheduler.',
                        'queued_at' => now('Asia/Jakarta')->toIso8601String(),
                        'scheduled_for' => now('Asia/Jakarta')->addSeconds($delaySeconds)->toIso8601String(),
                    ]);

                    $job = new TenantMonthlyGoogleDriveBackupJob(
                        $tenantId,
                        'system',
                        $monthKey,
                        $force,
                        false,
                        $jobId
                    );
                    if ($delaySeconds > 0) {
                        $job->delay(now()->addSeconds($delaySeconds));
                    }
                    dispatch($job);

                    $queued++;
                    $this->info("QUEUE {$tenantId}: {$monthKey} delay={$delaySeconds}s job={$jobId}");

                    continue;
                }

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
