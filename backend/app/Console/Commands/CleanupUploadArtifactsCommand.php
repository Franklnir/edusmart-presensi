<?php

namespace App\Console\Commands;

use App\Contracts\UploadStorageProvider;
use App\Services\Actions\Upload\CleanupUploadArtifacts;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class CleanupUploadArtifactsCommand extends Command
{
    protected $signature = 'uploads:cleanup';

    protected $description = 'Expire upload sessions and remove cancelled, failed, or detached objects';

    public function handle(CleanupUploadArtifacts $cleanup, UploadStorageProvider $provider): int
    {
        $startedAt = hrtime(true);
        if (! $provider->ready()) {
            Log::warning('api_v2_upload_cleanup', [
                'provider' => $provider->name(),
                'outcome' => 'failed',
                'failure_code' => 'UPLOAD_PROVIDER_UNAVAILABLE',
                'duration_ms' => round(max(0, hrtime(true) - $startedAt) / 1_000_000, 2),
            ]);
            $this->warn('Upload provider belum siap; cleanup dilewati agar object tidak salah sasaran.');

            return self::FAILURE;
        }

        $counts = $cleanup->execute();
        Log::log($counts['failed'] === 0 ? 'info' : 'warning', 'api_v2_upload_cleanup', [
            'provider' => $provider->name(),
            'outcome' => $counts['failed'] === 0 ? 'succeeded' : 'failed',
            'failure_code' => $counts['failed'] === 0 ? null : 'UPLOAD_CLEANUP_PENDING',
            'duration_ms' => round(max(0, hrtime(true) - $startedAt) / 1_000_000, 2),
            ...$counts,
        ]);
        $this->info(sprintf(
            'expired=%d sessions_cleaned=%d attachments_cleaned=%d failed=%d',
            $counts['expired'],
            $counts['sessions_cleaned'],
            $counts['attachments_cleaned'],
            $counts['failed']
        ));

        return $counts['failed'] === 0 ? self::SUCCESS : self::FAILURE;
    }
}
