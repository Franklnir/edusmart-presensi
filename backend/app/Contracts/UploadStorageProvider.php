<?php

namespace App\Contracts;

use Carbon\CarbonInterface;

interface UploadStorageProvider
{
    public function ready(): bool;

    public function name(): string;

    public function bucket(): string;

    /** @return array{method: string, url: string, headers: array<string, string>, fields: array<string, string>, expires_at: string} */
    public function initiate(
        string $objectKey,
        string $contentType,
        int $size,
        CarbonInterface $expiresAt,
        ?string $checksumSha256 = null
    ): array;

    /** @return array{exists: bool, actual_size: int|null, content_type: string|null, checksum_sha256: string|null} */
    public function verify(string $objectKey, int $expectedSize, string $expectedContentType): array;

    public function cancel(string $objectKey): bool;

    public function delete(string $objectKey): bool;

    /** @return array{method: string, url: string, headers: array<string, string>, fields: array<string, string>, expires_at: string} */
    public function temporaryDownloadUrl(string $objectKey, int $ttlSeconds): array;
}
