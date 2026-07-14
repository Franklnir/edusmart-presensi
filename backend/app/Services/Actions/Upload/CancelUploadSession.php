<?php

namespace App\Services\Actions\Upload;

use App\Contracts\UploadStorageProvider;
use App\Exceptions\UploadException;
use App\Models\UploadSession;
use Illuminate\Support\Facades\DB;
use Throwable;

class CancelUploadSession
{
    public function __construct(private readonly UploadStorageProvider $provider) {}

    public function execute(string $sessionId, string $tenantId, string $actorId): UploadSession
    {
        $session = DB::transaction(function () use ($sessionId, $tenantId, $actorId) {
            $session = UploadSession::whereKey($sessionId)
                ->where('tenant_id', $tenantId)
                ->where('actor_id', $actorId)
                ->lockForUpdate()
                ->firstOrFail();

            if ($session->status === 'cancelled') {
                return $session;
            }
            if ($session->provider !== $this->provider->name() || $session->bucket !== $this->provider->bucket()) {
                throw new UploadException('UPLOAD_PROVIDER_MISMATCH', 'Provider upload session tidak sesuai konfigurasi aktif.', 409);
            }
            if (in_array($session->status, ['completed', 'quarantined', 'expired'], true)) {
                throw new UploadException('UPLOAD_SESSION_NOT_CANCELLABLE', 'Upload session tidak dapat dibatalkan.', 409);
            }
            if ($session->status === 'verifying') {
                throw new UploadException('UPLOAD_SESSION_PROCESSING', 'Upload sedang diverifikasi.', 409);
            }

            $session->update(['status' => 'cancelled', 'cancelled_at' => now(), 'failure_code' => null]);

            return $session->fresh();
        });

        try {
            if ($this->provider->cancel($session->object_key)) {
                $session->update(['object_deleted_at' => now()]);
            } else {
                $session->update(['failure_code' => 'UPLOAD_CANCEL_CLEANUP_PENDING']);
            }
        } catch (Throwable) {
            $session->update(['failure_code' => 'UPLOAD_CANCEL_CLEANUP_PENDING']);
        }

        return $session->fresh();
    }
}
