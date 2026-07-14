<?php

namespace App\Console\Commands;

use App\Contracts\UploadStorageProvider;
use App\Services\Actions\Upload\CleanupUploadArtifacts;
use Illuminate\Console\Command;

class CleanupUploadArtifactsCommand extends Command
{
    protected $signature = 'uploads:cleanup';

    protected $description = 'Expire upload sessions and remove cancelled, failed, or detached objects';

    public function handle(CleanupUploadArtifacts $cleanup, UploadStorageProvider $provider): int
    {
        if (! $provider->ready()) {
            $this->warn('Upload provider belum siap; cleanup dilewati agar object tidak salah sasaran.');

            return self::FAILURE;
        }

        $counts = $cleanup->execute();
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
