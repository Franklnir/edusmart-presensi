<?php

namespace App\Services\Storage;

use App\Contracts\UploadStorageProvider;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Storage;

class LocalFakeUploadStorageProvider implements UploadStorageProvider
{
    public function ready(): bool
    {
        return app()->environment('testing');
    }

    public function name(): string
    {
        return 'local-fake';
    }

    public function bucket(): string
    {
        return 'test-uploads';
    }

    public function initiate(
        string $objectKey,
        string $contentType,
        int $size,
        CarbonInterface $expiresAt,
        ?string $checksumSha256 = null
    ): array {
        return [
            'method' => 'PUT',
            'url' => 'https://storage.test/upload/'.rawurlencode($objectKey),
            'headers' => array_filter([
                'Content-Type' => $contentType,
                'X-Checksum-Sha256' => $checksumSha256,
            ]),
            'fields' => [],
            'expires_at' => $expiresAt->toIso8601String(),
        ];
    }

    public function verify(string $objectKey, int $expectedSize, string $expectedContentType): array
    {
        $disk = Storage::disk('local');
        if (! $disk->exists($objectKey)) {
            return ['exists' => false, 'actual_size' => null, 'content_type' => null, 'checksum_sha256' => null];
        }

        $contents = $disk->get($objectKey);

        return [
            'exists' => true,
            'actual_size' => $disk->size($objectKey),
            'content_type' => $disk->mimeType($objectKey) ?: $expectedContentType,
            'checksum_sha256' => base64_encode(hash('sha256', $contents, true)),
        ];
    }

    public function cancel(string $objectKey): bool
    {
        return $this->delete($objectKey);
    }

    public function delete(string $objectKey): bool
    {
        $disk = Storage::disk('local');

        return ! $disk->exists($objectKey) || $disk->delete($objectKey);
    }

    public function temporaryDownloadUrl(string $objectKey, int $ttlSeconds): array
    {
        $ttlSeconds = max(300, min(900, $ttlSeconds));

        return [
            'method' => 'GET',
            'url' => 'https://storage.test/download/'.rawurlencode($objectKey),
            'headers' => [],
            'fields' => [],
            'expires_at' => now()->addSeconds($ttlSeconds)->toIso8601String(),
        ];
    }

    public function signedUrl(string $objectKey, int $ttlSeconds, string $logicalBucket = ''): string
    {
        return 'https://storage.test/signed/'.rawurlencode($objectKey).'?expires='.max(60, $ttlSeconds);
    }
}
