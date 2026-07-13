<?php

namespace Tests\Unit;

use App\Services\Backup\BackupIntegrityService;
use Tests\TestCase;

class BackupIntegrityServiceTest extends TestCase
{
    private BackupIntegrityService $service;

    protected function setUp(): void
    {
        parent::setUp();
        config(['app.key' => 'base64:' . base64_encode(str_repeat('k', 32))]);
        config(['backup.signing_key' => '']);
        config(['backup.signing_key_id' => 'test']);
        $this->service = new BackupIntegrityService();
    }

    private function samplePayload(): array
    {
        return [
            'tenant' => ['id' => 'tenant-1', 'name' => 'Sekolah Test'],
            'exported_at' => '2026-07-13T15:00:00+07:00',
            'mode' => 'full',
            'mode_label' => 'Semua Data',
            'period' => ['label' => 'Semua Data'],
            'summary' => ['table_count' => 2, 'total_rows' => 15],
            'manifest' => [
                'version' => 4,
                'backup_type' => 'tenant_database',
            ],
            'tables' => [
                [
                    'name' => 'profiles',
                    'columns' => ['id', 'nama', 'email'],
                    'row_count' => 10,
                    'rows' => array_fill(0, 10, ['id' => 'uuid-1', 'nama' => 'Siswa', 'email' => 'siswa@test.com']),
                ],
                [
                    'name' => 'settings',
                    'columns' => ['id', 'nama_sekolah'],
                    'row_count' => 5,
                    'rows' => array_fill(0, 5, ['id' => 'uuid-2', 'nama_sekolah' => 'Test']),
                ],
            ],
            'formats_supported' => ['json', 'xlsx'],
        ];
    }

    public function test_sign_adds_checksum_and_signature(): void
    {
        $payload = $this->samplePayload();
        $signed = $this->service->sign($payload);

        $this->assertArrayHasKey('manifest', $signed);
        $this->assertArrayHasKey('checksum', $signed['manifest']);
        $this->assertArrayHasKey('signature', $signed['manifest']);

        $this->assertSame('sha256', $signed['manifest']['checksum']['algorithm']);
        $this->assertSame('hmac-sha256', $signed['manifest']['signature']['algorithm']);
        $this->assertNotEmpty($signed['manifest']['checksum']['value']);
        $this->assertNotEmpty($signed['manifest']['signature']['value']);
        $this->assertSame(64, strlen($signed['manifest']['checksum']['value']));
        $this->assertSame(64, strlen($signed['manifest']['signature']['value']));
        $this->assertSame('test', $signed['manifest']['signature']['key_id']);
    }

    public function test_verify_valid_signed_payload(): void
    {
        $signed = $this->service->sign($this->samplePayload());
        $result = $this->service->verify($signed);

        $this->assertTrue($result['valid']);
        $this->assertSame('verified_signature', $result['status']);
        $this->assertSame(4, $result['manifest_version']);
    }

    public function test_verify_rejects_tampered_checksum(): void
    {
        $signed = $this->service->sign($this->samplePayload());
        $signed['manifest']['checksum']['value'] = str_repeat('0', 64);

        $result = $this->service->verify($signed);

        $this->assertFalse($result['valid']);
        $this->assertSame('invalid', $result['status']);
        $this->assertStringContainsString('Checksum', $result['message']);
    }

    public function test_verify_rejects_tampered_signature(): void
    {
        $signed = $this->service->sign($this->samplePayload());
        $signed['manifest']['signature']['value'] = str_repeat('a', 64);

        $result = $this->service->verify($signed);

        $this->assertFalse($result['valid']);
        $this->assertSame('invalid', $result['status']);
        $this->assertStringContainsString('tangan', $result['message']);
    }

    public function test_verify_rejects_modified_data(): void
    {
        $signed = $this->service->sign($this->samplePayload());
        $signed['tables'][0]['rows'][] = ['id' => 'injected', 'nama' => 'Hacker', 'email' => 'hacker@evil.com'];

        $result = $this->service->verify($signed);

        $this->assertFalse($result['valid']);
        $this->assertSame('invalid', $result['status']);
    }

    public function test_verify_handles_legacy_payload_without_checksum(): void
    {
        $payload = $this->samplePayload();
        $payload['manifest'] = ['version' => 2];

        $result = $this->service->verify($payload);

        $this->assertFalse($result['valid']);
        $this->assertSame('legacy_unverified', $result['status']);
        $this->assertSame(2, $result['manifest_version']);
    }

    public function test_verify_accepts_v3_checksum_only(): void
    {
        $payload = $this->samplePayload();
        $payload['manifest']['version'] = 3;
        unset($payload['manifest']['checksum'], $payload['manifest']['signature']);

        $checksumPayload = $payload;
        $checksum = hash('sha256', json_encode($checksumPayload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
        $payload['manifest']['checksum'] = [
            'algorithm' => 'sha256',
            'scope' => 'payload_without_checksum_and_signature',
            'generated_at' => now('Asia/Jakarta')->toIso8601String(),
            'value' => $checksum,
        ];

        $result = $this->service->verify($payload);

        $this->assertTrue($result['valid']);
        $this->assertSame('verified_checksum', $result['status']);
        $this->assertSame(3, $result['manifest_version']);
    }

    public function test_sign_is_deterministic(): void
    {
        $payload = $this->samplePayload();
        $first = $this->service->sign($payload);
        $second = $this->service->sign($payload);

        $this->assertSame(
            $first['manifest']['checksum']['value'],
            $second['manifest']['checksum']['value'],
            'Checksum harus konsisten untuk payload yang sama'
        );
    }

    public function test_sign_sets_manifest_version_to_at_least_4(): void
    {
        $payload = $this->samplePayload();
        $payload['manifest']['version'] = 2;
        $signed = $this->service->sign($payload);

        $this->assertGreaterThanOrEqual(4, $signed['manifest']['version']);
    }

    public function test_verify_rejects_empty_checksum_value(): void
    {
        $signed = $this->service->sign($this->samplePayload());
        $signed['manifest']['checksum']['value'] = '';

        $result = $this->service->verify($signed);

        $this->assertFalse($result['valid']);
        $this->assertSame('invalid', $result['status']);
    }

    public function test_verify_rejects_empty_signature_value(): void
    {
        $signed = $this->service->sign($this->samplePayload());
        $signed['manifest']['signature']['value'] = '';

        $result = $this->service->verify($signed);

        $this->assertFalse($result['valid']);
        $this->assertSame('invalid', $result['status']);
    }
}
