<?php

namespace App\Services\Storage;

use App\Contracts\UploadStorageProvider;
use Carbon\CarbonInterface;

class S3CompatibleUploadStorageProvider implements UploadStorageProvider
{
    public function __construct(private readonly S3CompatibleStorageSigner $signer) {}

    public function ready(): bool
    {
        return $this->signer->isBrowserDirectEnabledForBucket($this->logicalBucket())
            && $this->signer->canVerifyUploads();
    }

    public function name(): string
    {
        return 's3-compatible';
    }

    public function bucket(): string
    {
        return $this->signer->physicalBucketFor($this->logicalBucket());
    }

    public function initiate(
        string $objectKey,
        string $contentType,
        int $size,
        CarbonInterface $expiresAt,
        ?string $checksumSha256 = null
    ): array {
        $seconds = max(60, now()->diffInSeconds($expiresAt, false));
        $instruction = $this->signer->presignPut(
            $objectKey,
            $contentType,
            $seconds,
            $this->logicalBucket(),
            $checksumSha256
        );

        return [
            'method' => $instruction['method'],
            'url' => $instruction['url'],
            'headers' => $instruction['headers'] ?? [],
            'fields' => [],
            'expires_at' => $expiresAt->toIso8601String(),
        ];
    }

    public function verify(string $objectKey, int $expectedSize, string $expectedContentType): array
    {
        $result = $this->signer->verifyUploadedObject($objectKey, $expectedSize, $this->logicalBucket());

        return [
            'exists' => (bool) ($result['exists'] ?? false),
            'actual_size' => isset($result['size_bytes']) ? (int) $result['size_bytes'] : null,
            'content_type' => $result['content_type'] ?? null,
            'checksum_sha256' => $result['checksum_sha256'] ?? null,
        ];
    }

    public function cancel(string $objectKey): bool
    {
        return $this->delete($objectKey);
    }

    public function delete(string $objectKey): bool
    {
        return $this->signer->deleteObject($objectKey, $this->logicalBucket());
    }

    public function temporaryDownloadUrl(string $objectKey, int $ttlSeconds): array
    {
        $ttlSeconds = max(300, min(900, $ttlSeconds));
        $instruction = $this->signer->presignGet($objectKey, $ttlSeconds, $this->logicalBucket());

        return [
            'method' => 'GET',
            'url' => $instruction['url'],
            'headers' => $instruction['headers'] ?? [],
            'fields' => [],
            'expires_at' => now()->addSeconds($ttlSeconds)->toIso8601String(),
        ];
    }

    private function logicalBucket(): string
    {
        return (string) config('api_v2.uploads.logical_bucket', 'assignments');
    }

    public function signedUrl(string $objectKey, int $ttlSeconds, string $logicalBucket = ''): string
    {
        $ttlSeconds = max(60, min(86400, $ttlSeconds));
        $bucket = $logicalBucket !== '' ? $logicalBucket : $this->logicalBucket();
        $instruction = $this->signer->presignGet($objectKey, $ttlSeconds, $bucket);
        return $instruction['url'] ?? '';
    }
}
