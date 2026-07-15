<?php

namespace App\Services\Actions\Upload;

use App\Contracts\UploadStorageProvider;
use App\Exceptions\UploadException;
use App\Models\Profile;
use App\Models\Tugas;
use App\Models\UploadSession;
use Illuminate\Support\Str;
use Throwable;

class CreateUploadSession
{
    public function __construct(private readonly UploadStorageProvider $provider) {}

    /** @return array{session: UploadSession, instruction: array} */
    public function execute(array $data, Profile $actor, string $tenantId, ?Tugas $assignment): array
    {
        $sessionId = (string) Str::uuid();
        $extension = strtolower(pathinfo($data['filename'], PATHINFO_EXTENSION));
        $baseName = Str::slug(pathinfo($data['filename'], PATHINFO_FILENAME)) ?: 'file';
        $finalFilename = $baseName.'-'.Str::lower(Str::random(12)).'.'.$extension;
        $assignmentSegment = $assignment?->id ?: 'pending';
        if ($data['purpose'] === 'quiz_media_attachment') {
            $objectKey = "tenants/{$tenantId}/quizzes/{$data['quiz_id']}/{$sessionId}/{$finalFilename}";
        } else {
            $ownerSegment = $data['purpose'] === 'submission_attachment' ? '/submissions/'.$actor->id : '';
            $objectKey = "tenants/{$tenantId}/assignments/{$assignmentSegment}{$ownerSegment}/{$sessionId}/{$finalFilename}";
        }
        $expiresAt = now()->addMinutes((int) config('api_v2.uploads.session_ttl_minutes', 15));

        $session = UploadSession::create([
            'id' => $sessionId,
            'tenant_id' => $tenantId,
            'actor_id' => $actor->id,
            'purpose' => $data['purpose'],
            'provider' => $this->provider->name(),
            'bucket' => $this->provider->bucket(),
            'assignment_id' => $assignment?->id,
            'quiz_id' => $data['quiz_id'] ?? null,
            'filename' => $data['filename'],
            'content_type' => $data['content_type'],
            'size' => $data['size'],
            'checksum_sha256' => $data['checksum_sha256'] ?? null,
            'object_key' => $objectKey,
            'status' => 'pending',
            'expires_at' => $expiresAt,
        ]);

        try {
            $instruction = $this->provider->initiate(
                $objectKey,
                $data['content_type'],
                (int) $data['size'],
                $expiresAt,
                $data['checksum_sha256'] ?? null
            );
        } catch (Throwable) {
            $session->update(['status' => 'failed', 'failure_code' => 'UPLOAD_INITIATE_FAILED']);

            throw new UploadException(
                'UPLOAD_PROVIDER_UNAVAILABLE',
                'Provider upload sementara tidak dapat membuat instruksi.',
                503
            );
        }

        $session->update(['status' => 'uploading']);

        return ['session' => $session->fresh(), 'instruction' => $instruction];
    }
}
