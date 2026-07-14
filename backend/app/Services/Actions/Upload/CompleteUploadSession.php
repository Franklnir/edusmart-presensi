<?php

namespace App\Services\Actions\Upload;

use App\Contracts\UploadStorageProvider;
use App\Exceptions\UploadException;
use App\Models\Attachment;
use App\Models\UploadSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class CompleteUploadSession
{
    public function __construct(private readonly UploadStorageProvider $provider) {}

    public function execute(string $sessionId, string $tenantId, string $actorId): Attachment
    {
        $transition = DB::transaction(function () use ($sessionId, $tenantId, $actorId) {
            $session = UploadSession::whereKey($sessionId)
                ->where('tenant_id', $tenantId)
                ->where('actor_id', $actorId)
                ->lockForUpdate()
                ->firstOrFail();

            if ($session->status === 'completed') {
                return $session;
            }
            if ($session->expires_at->isPast()) {
                $session->update(['status' => 'expired', 'failure_code' => 'UPLOAD_SESSION_EXPIRED']);

                return new UploadException('UPLOAD_SESSION_EXPIRED', 'Upload session telah kedaluwarsa.', 409);
            }
            if ($session->provider !== $this->provider->name() || $session->bucket !== $this->provider->bucket()) {
                return new UploadException('UPLOAD_PROVIDER_MISMATCH', 'Provider upload session tidak sesuai konfigurasi aktif.', 409);
            }
            if ($session->status === 'verifying') {
                return new UploadException('UPLOAD_SESSION_PROCESSING', 'Upload sedang diverifikasi.', 409);
            }
            if (! in_array($session->status, ['pending', 'uploading', 'uploaded'], true)) {
                return new UploadException('UPLOAD_SESSION_NOT_COMPLETABLE', 'Upload session tidak dapat diselesaikan.', 409);
            }

            $session->update(['status' => 'verifying', 'verifying_at' => now(), 'failure_code' => null]);

            return $session->fresh();
        });

        if ($transition instanceof UploadException) {
            throw $transition;
        }

        $session = $transition;

        if ($session->status === 'completed') {
            return Attachment::where('upload_session_id', $session->id)->firstOrFail();
        }

        try {
            $verification = $this->provider->verify(
                $session->object_key,
                (int) $session->size,
                $session->content_type
            );
        } catch (Throwable) {
            $this->returnToUploading($session, 'UPLOAD_VERIFY_UNAVAILABLE');
            throw new UploadException('UPLOAD_PROVIDER_UNAVAILABLE', 'Provider upload sementara tidak dapat memverifikasi object.', 503);
        }

        if (! $verification['exists']) {
            $this->returnToUploading($session, 'UPLOAD_OBJECT_NOT_FOUND');
            throw new UploadException('UPLOAD_OBJECT_NOT_FOUND', 'Object upload belum tersedia.', 422);
        }

        $actualSize = $verification['actual_size'];
        if ($actualSize === null || (int) $actualSize !== (int) $session->size) {
            $this->quarantine($session, 'UPLOAD_SIZE_MISMATCH', $actualSize);
            throw new UploadException('UPLOAD_SIZE_MISMATCH', 'Ukuran object tidak sesuai metadata session.', 422);
        }

        $actualMime = strtolower(trim((string) ($verification['content_type'] ?? '')));
        if ($actualMime === '' || $actualMime !== strtolower($session->content_type)) {
            $this->quarantine($session, 'UPLOAD_MIME_MISMATCH', $actualSize);
            throw new UploadException('UPLOAD_MIME_MISMATCH', 'MIME object tidak sesuai metadata session.', 422);
        }

        $actualChecksum = $verification['checksum_sha256'] ?? null;
        if ($session->checksum_sha256 !== null
            && (! is_string($actualChecksum) || ! hash_equals($session->checksum_sha256, $actualChecksum))) {
            $this->quarantine($session, 'UPLOAD_CHECKSUM_MISMATCH', $actualSize);
            throw new UploadException('UPLOAD_CHECKSUM_MISMATCH', 'Checksum object tidak sesuai metadata session.', 422);
        }

        return DB::transaction(function () use ($session, $actualSize, $actualChecksum) {
            $locked = UploadSession::whereKey($session->id)->lockForUpdate()->firstOrFail();
            if ($locked->status === 'completed') {
                return Attachment::where('upload_session_id', $locked->id)->firstOrFail();
            }
            if ($locked->status !== 'verifying') {
                throw new UploadException('UPLOAD_SESSION_STATE_CHANGED', 'Status upload berubah selama verifikasi.', 409);
            }

            $locked->update([
                'status' => 'uploaded',
                'actual_size' => $actualSize,
                'uploaded_at' => now(),
            ]);

            $attachment = Attachment::firstOrCreate(
                ['upload_session_id' => $locked->id],
                [
                    'id' => (string) Str::uuid(),
                    'tenant_id' => $locked->tenant_id,
                    'actor_id' => $locked->actor_id,
                    'purpose' => $locked->purpose,
                    'provider' => $locked->provider,
                    'bucket' => $locked->bucket,
                    'assignment_id' => $locked->assignment_id,
                    'object_key' => $locked->object_key,
                    'filename' => $locked->filename,
                    'content_type' => $locked->content_type,
                    'size' => $locked->size,
                    'actual_size' => $actualSize,
                    'checksum_sha256' => $actualChecksum ?: $locked->checksum_sha256,
                    'status' => 'active',
                ]
            );

            $locked->update(['status' => 'completed', 'completed_at' => now()]);

            return $attachment;
        });
    }

    private function returnToUploading(UploadSession $session, string $failureCode): void
    {
        UploadSession::whereKey($session->id)->where('status', 'verifying')->update([
            'status' => 'uploading',
            'failure_code' => $failureCode,
        ]);
    }

    private function quarantine(UploadSession $session, string $failureCode, ?int $actualSize): void
    {
        UploadSession::whereKey($session->id)->where('status', 'verifying')->update([
            'status' => 'quarantined',
            'failure_code' => $failureCode,
            'actual_size' => $actualSize,
        ]);
    }
}
