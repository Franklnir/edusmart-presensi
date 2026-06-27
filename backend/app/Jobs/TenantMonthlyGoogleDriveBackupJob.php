<?php

namespace App\Jobs;

use App\Services\Backup\TenantBackupService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Throwable;

class TenantMonthlyGoogleDriveBackupJob implements ShouldQueue
{
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 2;

    public array $backoff = [60, 300];

    public int $timeout;

    public function __construct(
        public readonly string $tenantId,
        public readonly string $userId,
        public readonly ?string $monthKey,
        public readonly bool $force = false,
        public readonly bool $auto = false,
        public readonly string $jobId = ''
    ) {
        $this->timeout = (int) config('backup.job_timeout_seconds', 900);
        $this->onQueue((string) config('backup.queue', 'backup'));
    }

    public function tags(): array
    {
        return [
            'tenant:'.$this->tenantId,
            'backup:monthly',
            'queue:'.(string) config('backup.queue', 'backup'),
        ];
    }

    public function handle(TenantBackupService $tenantBackupService): void
    {
        $tenantBackupService->putMonthlyBackupJobStatus($this->tenantId, $this->jobId, [
            'status' => 'running',
            'progress' => 35,
            'message' => $this->auto
                ? 'Auto backup sedang berjalan di background.'
                : 'Backup bulanan sedang berjalan di background.',
            'started_at' => now('Asia/Jakarta')->toIso8601String(),
        ]);

        try {
            $result = $this->auto
                ? $tenantBackupService->autoMonthlyBackupToGoogleDrive($this->tenantId, $this->userId)
                : $tenantBackupService->saveMonthlyBackupToGoogleDrive(
                    $this->tenantId,
                    (string) $this->monthKey,
                    $this->userId,
                    $this->force
                );

            $tenantBackupService->putMonthlyBackupJobStatus($this->tenantId, $this->jobId, [
                'status' => 'finished',
                'progress' => 100,
                'message' => $this->auto
                    ? (string) data_get($result, 'summary.message', 'Auto backup selesai.')
                    : 'Backup bulanan berhasil disimpan ke Google Drive.',
                'result' => $result,
                'monthly_status' => $tenantBackupService->monthlyStatus($this->tenantId, true),
                'finished_at' => now('Asia/Jakarta')->toIso8601String(),
            ]);
            $tenantBackupService->releaseMonthlyBackupActiveJob($this->tenantId, $this->monthKey, $this->auto, $this->jobId);
        } catch (Throwable $e) {
            $message = trim((string) $e->getMessage()) ?: 'Backup gagal diproses.';

            if ($this->attempts() < $this->tries) {
                $tenantBackupService->putMonthlyBackupJobStatus($this->tenantId, $this->jobId, [
                    'status' => 'retrying',
                    'progress' => 45,
                    'message' => 'Backup gagal sementara dan akan dicoba ulang: '.$message,
                    'last_error' => $message,
                ]);

                throw $e;
            }

            $status = $tenantBackupService->backupFailureStatus($message);
            if ($status === 'needs_attention') {
                $tenantBackupService->markGoogleDriveNeedsAttention($this->tenantId, $message);
            }

            $tenantBackupService->putMonthlyBackupJobStatus($this->tenantId, $this->jobId, [
                'status' => $status,
                'progress' => 100,
                'message' => $status === 'needs_attention'
                    ? 'Google Drive perlu disambungkan ulang: '.$message
                    : $message,
                'last_error' => $message,
                'failed_at' => now('Asia/Jakarta')->toIso8601String(),
                'monthly_status' => $tenantBackupService->monthlyStatus($this->tenantId, true),
            ]);
            $tenantBackupService->releaseMonthlyBackupActiveJob($this->tenantId, $this->monthKey, $this->auto, $this->jobId);
        }
    }

    public function failed(Throwable $e): void
    {
        $tenantBackupService = app(TenantBackupService::class);
        $message = trim((string) $e->getMessage()) ?: 'Backup gagal diproses.';
        $status = $tenantBackupService->backupFailureStatus($message);
        if ($status === 'needs_attention') {
            $tenantBackupService->markGoogleDriveNeedsAttention($this->tenantId, $message);
        }
        $tenantBackupService->putMonthlyBackupJobStatus($this->tenantId, $this->jobId, [
            'status' => $status,
            'progress' => 100,
            'message' => $status === 'needs_attention'
                ? 'Google Drive perlu disambungkan ulang: '.$message
                : $message,
            'last_error' => $message,
            'failed_at' => now('Asia/Jakarta')->toIso8601String(),
        ]);
        $tenantBackupService->releaseMonthlyBackupActiveJob($this->tenantId, $this->monthKey, $this->auto, $this->jobId);
    }
}
