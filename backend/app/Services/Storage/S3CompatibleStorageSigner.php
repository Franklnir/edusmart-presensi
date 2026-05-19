<?php

namespace App\Services\Storage;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;

class S3CompatibleStorageSigner
{
    private const DEFAULT_DIRECT_UPLOAD_BUCKETS = [
        'assignments',
        'quiz-media',
        'certificates',
        'sertifikat-files',
        'certificate-templates',
        'sertifikat-templates',
    ];

    public function isEnabled(): bool
    {
        return $this->enabledConfig()
            && $this->accessKey() !== ''
            && $this->secretKey() !== ''
            && $this->hasBucketConfig();
    }

    public function isEnabledForBucket(string $bucket): bool
    {
        return $this->isEnabled()
            && in_array($bucket, $this->directUploadBuckets(), true)
            && $this->bucketFor($bucket) !== '';
    }

    public function label(): string
    {
        $label = trim((string) $this->configString('label', 'Object Storage'));

        return $label !== '' ? $label : 'Object Storage';
    }

    public function expiresSeconds(): int
    {
        $expires = (int) $this->configValue('expires_seconds', 900);

        return max(60, min(3600, $expires));
    }

    public function presignPut(string $objectKey, string $contentType, ?int $expiresSeconds = null, ?string $logicalBucket = null): array
    {
        $contentType = trim($contentType) !== '' ? trim($contentType) : 'application/octet-stream';

        return $this->presign('PUT', $objectKey, $expiresSeconds, [
            'content-type' => $contentType,
        ], $logicalBucket);
    }

    public function presignGet(string $objectKey, ?int $expiresSeconds = null, ?string $logicalBucket = null): array
    {
        return $this->presign('GET', $objectKey, $expiresSeconds, [], $logicalBucket);
    }

    public function verifyUploadedObject(string $objectKey, int $expectedSizeBytes = 0, ?string $logicalBucket = null): array
    {
        if (! $this->shouldVerifyUploads()) {
            return [
                'verified' => false,
                'skipped' => true,
                'size_matches' => true,
                'size_bytes' => null,
            ];
        }

        $signed = $this->presign('HEAD', $objectKey, 300, [], $logicalBucket);
        $response = Http::timeout(10)->head($signed['url']);
        if (! $response->successful()) {
            return [
                'verified' => true,
                'exists' => false,
                'status' => $response->status(),
                'size_matches' => false,
                'size_bytes' => null,
            ];
        }

        $sizeHeader = $response->header('Content-Length');
        $sizeBytes = is_numeric($sizeHeader) ? (int) $sizeHeader : null;
        $sizeMatches = $expectedSizeBytes <= 0 || $sizeBytes === null || $sizeBytes === $expectedSizeBytes;

        return [
            'verified' => true,
            'exists' => true,
            'status' => $response->status(),
            'size_matches' => $sizeMatches,
            'size_bytes' => $sizeBytes,
        ];
    }

    public function deleteObject(string $objectKey, ?string $logicalBucket = null): bool
    {
        if (! $this->isEnabled()) {
            return true;
        }

        $signed = $this->presign('DELETE', $objectKey, 300, [], $logicalBucket);
        $response = Http::timeout(20)->delete($signed['url']);

        return $response->successful() || $response->status() === 404;
    }

    public function putObjectFromFile(string $objectKey, string $sourcePath, string $contentType, ?string $logicalBucket = null): array
    {
        if (! is_readable($sourcePath)) {
            throw new \RuntimeException('File sumber upload tidak bisa dibaca.');
        }

        $contentType = trim($contentType) !== '' ? trim($contentType) : 'application/octet-stream';
        $signed = $this->presignPut($objectKey, $contentType, $this->expiresSeconds(), $logicalBucket);
        $stream = fopen($sourcePath, 'rb');
        if (! is_resource($stream)) {
            throw new \RuntimeException('Stream file upload tidak bisa dibuka.');
        }

        try {
            $response = Http::withHeaders($signed['headers'])
                ->timeout(120)
                ->connectTimeout(10)
                ->withOptions(['body' => $stream])
                ->send($signed['method'], $signed['url']);
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        if (! $response->successful()) {
            throw new \RuntimeException('Object storage menolak upload server-side (HTTP '.$response->status().').');
        }

        return [
            'status' => $response->status(),
            'etag' => $response->header('ETag'),
            'object_key' => $objectKey,
        ];
    }

    private function presign(
        string $method,
        string $objectKey,
        ?int $expiresSeconds = null,
        array $headers = [],
        ?string $logicalBucket = null
    ): array {
        if (! $this->isEnabled()) {
            throw new \RuntimeException('Object storage belum dikonfigurasi.');
        }

        $method = strtoupper($method);
        $expiresSeconds = max(60, min(3600, (int) ($expiresSeconds ?: $this->expiresSeconds())));
        $now = Carbon::now('UTC');
        $amzDate = $now->format('Ymd\THis\Z');
        $dateStamp = $now->format('Ymd');
        $region = $this->region();
        $credentialScope = "{$dateStamp}/{$region}/s3/aws4_request";
        $target = $this->buildTargetUrl($objectKey, $logicalBucket);

        $signedHeaders = array_change_key_case($headers, CASE_LOWER);
        $signedHeaders['host'] = $target['host'];
        ksort($signedHeaders);

        $signedHeaderNames = implode(';', array_keys($signedHeaders));
        $query = [
            'X-Amz-Algorithm' => 'AWS4-HMAC-SHA256',
            'X-Amz-Credential' => $this->accessKey().'/'.$credentialScope,
            'X-Amz-Date' => $amzDate,
            'X-Amz-Expires' => (string) $expiresSeconds,
            'X-Amz-SignedHeaders' => $signedHeaderNames,
        ];

        $sessionToken = $this->sessionToken();
        if ($sessionToken !== '') {
            $query['X-Amz-Security-Token'] = $sessionToken;
        }

        $canonicalQuery = $this->canonicalQuery($query);
        $canonicalHeaders = '';
        foreach ($signedHeaders as $name => $value) {
            $canonicalHeaders .= strtolower($name).':'.$this->normalizeHeaderValue((string) $value)."\n";
        }

        $canonicalRequest = implode("\n", [
            $method,
            $target['canonical_uri'],
            $canonicalQuery,
            $canonicalHeaders,
            $signedHeaderNames,
            'UNSIGNED-PAYLOAD',
        ]);

        $stringToSign = implode("\n", [
            'AWS4-HMAC-SHA256',
            $amzDate,
            $credentialScope,
            hash('sha256', $canonicalRequest),
        ]);

        $signature = hash_hmac(
            'sha256',
            $stringToSign,
            $this->signingKey($dateStamp, $region)
        );

        $url = $target['base_url'].'?'.$canonicalQuery.'&X-Amz-Signature='.$signature;
        $clientHeaders = [];
        foreach ($headers as $name => $value) {
            $clientHeaders[$this->headerCase($name)] = $value;
        }

        return [
            'method' => $method,
            'url' => $url,
            'headers' => $clientHeaders,
            'expiresAt' => $now->copy()->addSeconds($expiresSeconds)->timestamp,
            'objectKey' => $objectKey,
        ];
    }

    private function buildTargetUrl(string $objectKey, ?string $logicalBucket = null): array
    {
        $endpoint = $this->endpoint();
        $parts = parse_url($endpoint);
        if (! is_array($parts) || empty($parts['host'])) {
            throw new \RuntimeException('Endpoint object storage tidak valid.');
        }

        $scheme = $parts['scheme'] ?? 'https';
        $host = strtolower((string) $parts['host']);
        if (! empty($parts['port'])) {
            $host .= ':'.$parts['port'];
        }

        $basePath = trim((string) ($parts['path'] ?? ''), '/');
        $bucket = $this->bucketFor($logicalBucket);
        if ($bucket === '') {
            throw new \RuntimeException('Bucket object storage belum dikonfigurasi.');
        }
        $segments = $this->usePathStyle()
            ? array_values(array_filter([$basePath, $bucket, $objectKey], fn ($segment) => trim((string) $segment) !== ''))
            : array_values(array_filter([$basePath, $objectKey], fn ($segment) => trim((string) $segment) !== ''));

        if (! $this->usePathStyle()) {
            $host = $bucket.'.'.$host;
        }

        $canonicalUri = '/'.implode('/', array_map([$this, 'encodePathSegment'], $segments));

        return [
            'host' => $host,
            'canonical_uri' => $canonicalUri,
            'base_url' => $scheme.'://'.$host.$canonicalUri,
        ];
    }

    private function canonicalQuery(array $query): string
    {
        ksort($query);

        return collect($query)
            ->map(fn ($value, $key) => rawurlencode((string) $key).'='.rawurlencode((string) $value))
            ->implode('&');
    }

    private function encodePathSegment(string $segment): string
    {
        return collect(explode('/', trim($segment, '/')))
            ->map(fn ($part) => rawurlencode($part))
            ->implode('/');
    }

    private function normalizeHeaderValue(string $value): string
    {
        return preg_replace('/\s+/', ' ', trim($value)) ?? trim($value);
    }

    private function headerCase(string $name): string
    {
        return collect(explode('-', strtolower($name)))
            ->map(fn ($part) => ucfirst($part))
            ->implode('-');
    }

    private function signingKey(string $dateStamp, string $region): string
    {
        $dateKey = hash_hmac('sha256', $dateStamp, 'AWS4'.$this->secretKey(), true);
        $regionKey = hash_hmac('sha256', $region, $dateKey, true);
        $serviceKey = hash_hmac('sha256', 's3', $regionKey, true);

        return hash_hmac('sha256', 'aws4_request', $serviceKey, true);
    }

    private function endpoint(): string
    {
        $endpoint = trim((string) $this->configString('endpoint', ''));
        if ($endpoint !== '') {
            return rtrim($endpoint, '/');
        }

        return 'https://s3.'.$this->region().'.amazonaws.com';
    }

    private function usePathStyle(): bool
    {
        return (bool) $this->configValue('use_path_style_endpoint', false);
    }

    private function accessKey(): string
    {
        return trim((string) $this->configString('key', ''));
    }

    private function secretKey(): string
    {
        return trim((string) $this->configString('secret', ''));
    }

    private function sessionToken(): string
    {
        return trim((string) $this->configString('session_token', ''));
    }

    private function region(): string
    {
        $region = trim((string) $this->configString('region', 'us-east-1'));

        return $region !== '' ? $region : 'us-east-1';
    }

    private function bucket(): string
    {
        return trim((string) $this->configString('bucket', ''));
    }

    private function bucketFor(?string $logicalBucket = null): string
    {
        $logicalBucket = trim((string) $logicalBucket);
        if ($logicalBucket !== '') {
            $map = $this->bucketMap();
            if (! empty($map[$logicalBucket])) {
                return $map[$logicalBucket];
            }
        }

        return $this->bucket();
    }

    private function bucketMap(): array
    {
        $map = $this->configValue('bucket_map', []);
        if (! is_array($map)) {
            return [];
        }

        $normalized = [];
        foreach ($map as $logicalBucket => $physicalBucket) {
            $logicalBucket = trim((string) $logicalBucket);
            $physicalBucket = trim((string) $physicalBucket);
            if ($logicalBucket !== '' && $physicalBucket !== '') {
                $normalized[$logicalBucket] = $physicalBucket;
            }
        }

        return $normalized;
    }

    private function hasBucketConfig(): bool
    {
        if ($this->bucket() !== '') {
            return true;
        }

        return ! empty($this->bucketMap());
    }

    private function directUploadBuckets(): array
    {
        $buckets = $this->configValue('direct_upload_buckets', self::DEFAULT_DIRECT_UPLOAD_BUCKETS);
        if (is_string($buckets)) {
            $buckets = explode(',', $buckets);
        }
        if (! is_array($buckets) || empty($buckets)) {
            $buckets = self::DEFAULT_DIRECT_UPLOAD_BUCKETS;
        }

        return array_values(array_unique(array_filter(array_map(
            fn ($bucket) => trim((string) $bucket),
            $buckets
        ))));
    }

    private function shouldVerifyUploads(): bool
    {
        return (bool) $this->configValue('verify_uploads', true);
    }

    private function enabledConfig(): bool
    {
        return (bool) config('services.object_storage.enabled', false)
            || (bool) config('services.assignment_object_storage.enabled', false);
    }

    private function configString(string $key, string $default = ''): string
    {
        $value = $this->configValue($key, $default);

        return trim((string) $value);
    }

    private function configValue(string $key, mixed $default = null): mixed
    {
        $objectValue = config("services.object_storage.{$key}");
        if ($this->filledConfigValue($objectValue)) {
            return $objectValue;
        }

        $assignmentValue = config("services.assignment_object_storage.{$key}");
        if ($this->filledConfigValue($assignmentValue)) {
            return $assignmentValue;
        }

        return $default;
    }

    private function filledConfigValue(mixed $value): bool
    {
        if ($value === null) {
            return false;
        }

        if (is_string($value)) {
            return trim($value) !== '';
        }

        if (is_array($value)) {
            return ! empty($value);
        }

        return true;
    }
}
