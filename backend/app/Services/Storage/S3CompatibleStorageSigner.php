<?php

namespace App\Services\Storage;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;

class S3CompatibleStorageSigner
{
    public function isEnabled(): bool
    {
        return (bool) config('services.assignment_object_storage.enabled', false)
            && $this->accessKey() !== ''
            && $this->secretKey() !== ''
            && $this->bucket() !== '';
    }

    public function label(): string
    {
        $label = trim((string) config('services.assignment_object_storage.label', 'Object Storage'));

        return $label !== '' ? $label : 'Object Storage';
    }

    public function expiresSeconds(): int
    {
        $expires = (int) config('services.assignment_object_storage.expires_seconds', 900);

        return max(60, min(3600, $expires));
    }

    public function presignPut(string $objectKey, string $contentType, ?int $expiresSeconds = null): array
    {
        $contentType = trim($contentType) !== '' ? trim($contentType) : 'application/octet-stream';

        return $this->presign('PUT', $objectKey, $expiresSeconds, [
            'content-type' => $contentType,
        ]);
    }

    public function presignGet(string $objectKey, ?int $expiresSeconds = null): array
    {
        return $this->presign('GET', $objectKey, $expiresSeconds);
    }

    public function deleteObject(string $objectKey): bool
    {
        if (! $this->isEnabled()) {
            return true;
        }

        $signed = $this->presign('DELETE', $objectKey, 300);
        $response = Http::timeout(20)->delete($signed['url']);

        return $response->successful() || $response->status() === 404;
    }

    private function presign(
        string $method,
        string $objectKey,
        ?int $expiresSeconds = null,
        array $headers = []
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
        $target = $this->buildTargetUrl($objectKey);

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

    private function buildTargetUrl(string $objectKey): array
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
        $bucket = $this->bucket();
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
        $endpoint = trim((string) config('services.assignment_object_storage.endpoint', ''));
        if ($endpoint !== '') {
            return rtrim($endpoint, '/');
        }

        return 'https://s3.'.$this->region().'.amazonaws.com';
    }

    private function usePathStyle(): bool
    {
        return (bool) config('services.assignment_object_storage.use_path_style_endpoint', false);
    }

    private function accessKey(): string
    {
        return trim((string) config('services.assignment_object_storage.key', ''));
    }

    private function secretKey(): string
    {
        return trim((string) config('services.assignment_object_storage.secret', ''));
    }

    private function sessionToken(): string
    {
        return trim((string) config('services.assignment_object_storage.session_token', ''));
    }

    private function region(): string
    {
        $region = trim((string) config('services.assignment_object_storage.region', 'us-east-1'));

        return $region !== '' ? $region : 'us-east-1';
    }

    private function bucket(): string
    {
        return trim((string) config('services.assignment_object_storage.bucket', ''));
    }
}
