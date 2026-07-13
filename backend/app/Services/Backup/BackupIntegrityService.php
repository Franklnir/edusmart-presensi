<?php

namespace App\Services\Backup;

use Illuminate\Support\Str;

class BackupIntegrityService
{
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

    public function sign(array $payload): array
    {
        $payload['manifest'] = is_array($payload['manifest'] ?? null) ? $payload['manifest'] : [];
        $payload['manifest']['version'] = max(4, (int) ($payload['manifest']['version'] ?? 0));
        unset($payload['manifest']['checksum'], $payload['manifest']['signature']);

        $payload['manifest']['checksum'] = [
            'algorithm' => 'sha256',
            'scope' => 'payload_without_checksum_and_signature',
            'generated_at' => now('Asia/Jakarta')->toIso8601String(),
            'value' => hash('sha256', $this->encode($payload)),
        ];

        $payload['manifest']['signature'] = [
            'algorithm' => 'hmac-sha256',
            'scope' => 'payload_without_signature',
            'key_id' => (string) config('backup.signing_key_id', 'primary'),
            'value' => hash_hmac('sha256', $this->encode($payload), $this->signingKey()),
        ];

        return $payload;
    }

    public function verify(array $payload): array
    {
        $manifest = is_array($payload['manifest'] ?? null) ? $payload['manifest'] : [];
        $checksum = is_array($manifest['checksum'] ?? null) ? $manifest['checksum'] : [];
        $signature = is_array($manifest['signature'] ?? null) ? $manifest['signature'] : [];
        $version = (int) ($manifest['version'] ?? 0);

        if (empty($checksum)) {
            return [
                'valid' => false,
                'status' => 'legacy_unverified',
                'message' => 'Backup lama tidak memiliki checksum dan hanya boleh digunakan untuk pratinjau.',
                'manifest_version' => $version,
            ];
        }

        if (strtolower((string) ($checksum['algorithm'] ?? '')) !== 'sha256') {
            return $this->invalid('Algoritma checksum backup tidak didukung.', $version);
        }

        $expectedChecksum = trim((string) ($checksum['value'] ?? ''));
        $checksumPayload = $payload;
        unset($checksumPayload['manifest']['checksum'], $checksumPayload['manifest']['signature']);
        $actualChecksum = hash('sha256', $this->encode($checksumPayload));

        if ($expectedChecksum === '' || ! hash_equals($expectedChecksum, $actualChecksum)) {
            return $this->invalid('Checksum backup tidak cocok. File mungkin rusak atau telah diubah.', $version);
        }

        if ($version < 4 && empty($signature)) {
            return [
                'valid' => true,
                'status' => 'verified_checksum',
                'message' => 'Checksum backup versi lama valid.',
                'manifest_version' => $version,
            ];
        }

        if (strtolower((string) ($signature['algorithm'] ?? '')) !== 'hmac-sha256') {
            return $this->invalid('Tanda tangan backup tidak tersedia atau tidak didukung.', $version);
        }

        $expectedSignature = trim((string) ($signature['value'] ?? ''));
        $signaturePayload = $payload;
        unset($signaturePayload['manifest']['signature']);
        $actualSignature = hash_hmac('sha256', $this->encode($signaturePayload), $this->signingKey());

        if ($expectedSignature === '' || ! hash_equals($expectedSignature, $actualSignature)) {
            return $this->invalid('Tanda tangan backup tidak cocok. Restore diblokir untuk melindungi data.', $version);
        }

        return [
            'valid' => true,
            'status' => 'verified_signature',
            'message' => 'Checksum dan tanda tangan backup valid.',
            'manifest_version' => $version,
            'key_id' => (string) ($signature['key_id'] ?? ''),
        ];
    }

    private function invalid(string $message, int $version): array
    {
        return [
            'valid' => false,
            'status' => 'invalid',
            'message' => $message,
            'manifest_version' => $version,
        ];
    }

    private function encode(array $payload): string
    {
        return json_encode($payload, self::JSON_FLAGS | JSON_THROW_ON_ERROR);
    }

    private function signingKey(): string
    {
        $key = trim((string) config('backup.signing_key', ''));
        if ($key === '') {
            $key = trim((string) config('app.key', ''));
        }

        if (Str::startsWith($key, 'base64:')) {
            $decoded = base64_decode(Str::after($key, 'base64:'), true);
            if (is_string($decoded) && $decoded !== '') {
                return $decoded;
            }
        }

        if ($key === '') {
            throw new \RuntimeException('BACKUP_SIGNING_KEY atau APP_KEY belum dikonfigurasi.');
        }

        return $key;
    }
}
