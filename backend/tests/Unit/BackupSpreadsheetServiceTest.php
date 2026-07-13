<?php

namespace Tests\Unit;

use App\Services\Backup\BackupSpreadsheetService;
use Tests\TestCase;

class BackupSpreadsheetServiceTest extends TestCase
{
    private BackupSpreadsheetService $service;

    protected function setUp(): void
    {
        parent::setUp();

        if (! extension_loaded('zip')) {
            $this->markTestSkipped('ext-zip diperlukan oleh OpenSpout XLSX writer (tersedia di Docker produksi).');
        }

        $this->service = new BackupSpreadsheetService;
    }

    private function samplePayload(): array
    {
        return [
            'tenant' => ['id' => 'tenant-1', 'name' => 'Sekolah Test'],
            'exported_at' => '2026-07-13T15:00:00+07:00',
            'mode' => 'full',
            'mode_label' => 'Semua Data',
            'period' => ['label' => 'Semua Data', 'tahun_ajaran' => '2025/2026', 'semester' => '2'],
            'summary' => ['table_count' => 2, 'total_rows' => 5],
            'manifest' => ['version' => 4, 'backup_type' => 'tenant_database'],
            'tables' => [
                [
                    'name' => 'profiles',
                    'columns' => ['id', 'nama', 'email', 'password', 'remember_token'],
                    'row_count' => 3,
                    'rows' => [
                        ['id' => 'u1', 'nama' => 'Andi', 'email' => 'andi@test.com', 'password' => '$2y$hash', 'remember_token' => 'secret123'],
                        ['id' => 'u2', 'nama' => 'Budi', 'email' => 'budi@test.com', 'password' => '$2y$hash2', 'remember_token' => 'abc'],
                        ['id' => 'u3', 'nama' => 'Citra', 'email' => 'citra@test.com', 'password' => null, 'remember_token' => ''],
                    ],
                ],
                [
                    'name' => 'settings',
                    'columns' => ['id', 'nama_sekolah', 'api_key'],
                    'row_count' => 2,
                    'rows' => [
                        ['id' => 's1', 'nama_sekolah' => 'SMK Test', 'api_key' => 'supersecret'],
                        ['id' => 's2', 'nama_sekolah' => 'SMA Test', 'api_key' => ''],
                    ],
                ],
            ],
        ];
    }

    public function test_make_contents_returns_valid_xlsx(): void
    {
        $contents = $this->service->makeContents($this->samplePayload());

        $this->assertIsString($contents);
        $this->assertNotEmpty($contents);
        // XLSX files start with PK (zip magic bytes)
        $this->assertSame('PK', substr($contents, 0, 2), 'File harus berupa ZIP (XLSX)');
    }

    public function test_make_contents_minimum_size(): void
    {
        $contents = $this->service->makeContents($this->samplePayload());

        // A valid XLSX with multiple sheets should be at least a few KB
        $this->assertGreaterThan(1024, strlen($contents), 'XLSX harus lebih dari 1KB untuk payload berisi data');
    }

    public function test_make_contents_with_empty_tables(): void
    {
        $payload = $this->samplePayload();
        $payload['tables'] = [];
        $payload['summary']['table_count'] = 0;
        $payload['summary']['total_rows'] = 0;

        $contents = $this->service->makeContents($payload);

        $this->assertIsString($contents);
        $this->assertNotEmpty($contents);
        $this->assertSame('PK', substr($contents, 0, 2));
    }

    public function test_make_contents_with_formula_injection_protection(): void
    {
        $payload = $this->samplePayload();
        $payload['tables'] = [
            [
                'name' => 'test_formula',
                'columns' => ['id', 'value'],
                'row_count' => 3,
                'rows' => [
                    ['id' => '1', 'value' => '=CMD("calc")'],
                    ['id' => '2', 'value' => '+1+1'],
                    ['id' => '3', 'value' => '-A1'],
                ],
            ],
        ];

        // Should not throw
        $contents = $this->service->makeContents($payload);
        $this->assertNotEmpty($contents);
        $this->assertSame('PK', substr($contents, 0, 2));
    }

    public function test_make_contents_with_large_row_count(): void
    {
        $payload = $this->samplePayload();
        $rows = [];
        for ($i = 0; $i < 500; $i++) {
            $rows[] = ['id' => "id-{$i}", 'nama' => "Siswa {$i}", 'email' => "siswa{$i}@test.com"];
        }

        $payload['tables'] = [
            [
                'name' => 'large_table',
                'columns' => ['id', 'nama', 'email'],
                'row_count' => 500,
                'rows' => $rows,
            ],
        ];

        $contents = $this->service->makeContents($payload);

        $this->assertNotEmpty($contents);
        $this->assertSame('PK', substr($contents, 0, 2));
    }

    public function test_make_contents_with_unicode_data(): void
    {
        $payload = $this->samplePayload();
        $payload['tables'] = [
            [
                'name' => 'unicode_test',
                'columns' => ['id', 'nama'],
                'row_count' => 2,
                'rows' => [
                    ['id' => '1', 'nama' => 'Muhammad Syarif Hidayatullah'],
                    ['id' => '2', 'nama' => '日本語テスト'],
                ],
            ],
        ];

        $contents = $this->service->makeContents($payload);
        $this->assertNotEmpty($contents);
        $this->assertSame('PK', substr($contents, 0, 2));
    }

    public function test_make_contents_with_json_values(): void
    {
        $payload = $this->samplePayload();
        $payload['tables'] = [
            [
                'name' => 'json_test',
                'columns' => ['id', 'metadata'],
                'row_count' => 1,
                'rows' => [
                    ['id' => '1', 'metadata' => ['key' => 'value', 'nested' => ['a' => 1]]],
                ],
            ],
        ];

        $contents = $this->service->makeContents($payload);
        $this->assertNotEmpty($contents);
        $this->assertSame('PK', substr($contents, 0, 2));
    }

    public function test_make_contents_with_null_values(): void
    {
        $payload = $this->samplePayload();
        $payload['tables'] = [
            [
                'name' => 'null_test',
                'columns' => ['id', 'nama', 'phone'],
                'row_count' => 2,
                'rows' => [
                    ['id' => '1', 'nama' => null, 'phone' => null],
                    ['id' => '2', 'nama' => '', 'phone' => ''],
                ],
            ],
        ];

        $contents = $this->service->makeContents($payload);
        $this->assertNotEmpty($contents);
    }

    public function test_make_contents_handles_very_long_sheet_names(): void
    {
        $payload = $this->samplePayload();
        $payload['tables'] = [
            [
                'name' => 'this_is_a_very_long_table_name_that_exceeds_thirty_one_characters_and_should_be_truncated',
                'columns' => ['id'],
                'row_count' => 1,
                'rows' => [['id' => '1']],
            ],
        ];

        $contents = $this->service->makeContents($payload);
        $this->assertNotEmpty($contents);
        $this->assertSame('PK', substr($contents, 0, 2));
    }

    public function test_make_contents_handles_duplicate_table_names(): void
    {
        $payload = $this->samplePayload();
        $payload['tables'] = [
            [
                'name' => 'profiles',
                'columns' => ['id'],
                'row_count' => 1,
                'rows' => [['id' => '1']],
            ],
            [
                'name' => 'profiles',
                'columns' => ['id'],
                'row_count' => 1,
                'rows' => [['id' => '2']],
            ],
        ];

        $contents = $this->service->makeContents($payload);
        $this->assertNotEmpty($contents);
        $this->assertSame('PK', substr($contents, 0, 2));
    }
}
