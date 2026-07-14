<?php

namespace App\Services\Actions\Upload;

use App\Contracts\UploadStorageProvider;
use App\Models\Attachment;
use App\Models\UploadSession;
use Throwable;

class CleanupUploadArtifacts
{
    public function __construct(private readonly UploadStorageProvider $provider) {}

    /** @return array{expired: int, sessions_cleaned: int, attachments_cleaned: int, failed: int} */
    public function execute(): array
    {
        $counts = ['expired' => 0, 'sessions_cleaned' => 0, 'attachments_cleaned' => 0, 'failed' => 0];

        UploadSession::whereIn('status', ['pending', 'uploading', 'uploaded', 'verifying'])
            ->where('expires_at', '<=', now())
            ->limit(500)
            ->get()
            ->each(function (UploadSession $session) use (&$counts) {
                if ($session->update(['status' => 'expired', 'failure_code' => null])) {
                    $counts['expired']++;
                }
            });

        UploadSession::whereIn('status', ['cancelled', 'expired', 'failed', 'quarantined'])
            ->whereNull('object_deleted_at')
            ->where('provider', $this->provider->name())
            ->where('bucket', $this->provider->bucket())
            ->limit(500)
            ->get()
            ->each(function (UploadSession $session) use (&$counts) {
                try {
                    if ($this->provider->delete($session->object_key)) {
                        $session->update(['failure_code' => null, 'object_deleted_at' => now()]);
                        $counts['sessions_cleaned']++;

                        return;
                    }
                } catch (Throwable) {
                    // Count and persist the retry marker below.
                }

                $session->update(['failure_code' => 'UPLOAD_CLEANUP_PENDING']);
                $counts['failed']++;
            });

        $detachedBefore = now()->subHours((int) config('api_v2.uploads.detached_cleanup_hours', 24));
        Attachment::where(function ($query) use ($detachedBefore) {
            $query->where('status', 'delete_pending')
                ->orWhere(function ($query) use ($detachedBefore) {
                    $query->where('status', 'active')
                        ->whereNull('claimed_at')
                        ->where('created_at', '<=', $detachedBefore);
                });
        })
            ->where('provider', $this->provider->name())
            ->where('bucket', $this->provider->bucket())
            ->limit(500)
            ->get()
            ->each(function (Attachment $attachment) use (&$counts) {
                $attachment->update(['status' => 'delete_pending']);
                try {
                    if ($this->provider->delete($attachment->object_key)) {
                        $attachment->update(['status' => 'deleted']);
                        $attachment->delete();
                        $counts['attachments_cleaned']++;

                        return;
                    }
                } catch (Throwable) {
                    // The delete_pending record is the durable retry marker.
                }

                $counts['failed']++;
            });

        return $counts;
    }
}
