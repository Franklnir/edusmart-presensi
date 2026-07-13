<?php

namespace App\Services\Backup;

use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Color;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Writer;

class BackupSpreadsheetService
{
    private const MAX_DATA_ROWS_PER_SHEET = 999999;

    private const SENSITIVE_COLUMN_PATTERNS = [
        'password',
        'remember_token',
        'access_token',
        'refresh_token',
        'api_key',
        'secret',
        'private_key',
        'credential',
        'authorization_code',
        'recovery_code',
        'otp',
    ];

    public function makeContents(array $payload): string
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'sismu-backup-');
        if (! is_string($tempPath) || $tempPath === '') {
            throw new \RuntimeException('File sementara Excel tidak dapat dibuat.');
        }

        $writer = new Writer;

        try {
            $writer->openToFile($tempPath);
            $this->writeSummary($writer, $payload);
            $this->writeTableIndex($writer, $payload);
            $this->writeSecurityPolicy($writer);
            $this->writeTables($writer, $payload);
            $writer->close();

            $contents = file_get_contents($tempPath);
            if (! is_string($contents) || $contents === '') {
                throw new \RuntimeException('Workbook Excel backup kosong.');
            }

            return $contents;
        } finally {
            $writer->close();
            @unlink($tempPath);
        }
    }

    private function writeSummary(Writer $writer, array $payload): void
    {
        $sheet = $writer->getCurrentSheet();
        $sheet->setName('Ringkasan');
        $sheet->setColumnWidth(28, 1);
        $sheet->setColumnWidth(58, 2);

        $tenant = is_array($payload['tenant'] ?? null) ? $payload['tenant'] : [];
        $period = is_array($payload['period'] ?? null) ? $payload['period'] : [];
        $summary = is_array($payload['summary'] ?? null) ? $payload['summary'] : [];
        $manifest = is_array($payload['manifest'] ?? null) ? $payload['manifest'] : [];

        $writer->addRow(Row::fromValuesWithStyle(['BACKUP DATA SISMU', 'Ringkasan ekspor tenant'], $this->titleStyle()));
        $writer->addRow(Row::fromValuesWithStyle(['Informasi', 'Nilai'], $this->headerStyle()));

        $rows = [
            ['Tenant ID', $tenant['id'] ?? '-'],
            ['Nama Sekolah', $tenant['name'] ?? '-'],
            ['Mode Backup', $payload['mode_label'] ?? $payload['mode'] ?? '-'],
            ['Periode', $period['label'] ?? '-'],
            ['Tahun Ajaran', $period['tahun_ajaran'] ?? '-'],
            ['Semester', $period['semester'] ?? '-'],
            ['Dibuat Pada', $payload['exported_at'] ?? now()->toIso8601String()],
            ['Jumlah Tabel', $summary['table_count'] ?? 0],
            ['Jumlah Baris', $summary['total_rows'] ?? 0],
            ['Versi Manifest', $manifest['version'] ?? '-'],
            ['Isi File Storage', 'Tidak. Hanya metadata dan referensi URL yang disertakan.'],
            ['Tujuan XLSX', 'Audit dan pengelolaan manusia. Restore wajib menggunakan file JSON.'],
        ];

        foreach ($rows as $row) {
            $writer->addRow(Row::fromValues(array_map(fn ($value) => $this->safeCell($value), $row)));
        }
    }

    private function writeTableIndex(Writer $writer, array $payload): void
    {
        $sheet = $writer->addNewSheetAndMakeItCurrent();
        $sheet->setName('Daftar Tabel');
        $sheet->setColumnWidth(8, 1);
        $sheet->setColumnWidth(42, 2);
        $sheet->setColumnWidth(16, 3);
        $sheet->setColumnWidth(50, 4);

        $writer->addRow(Row::fromValuesWithStyle(['No', 'Tabel', 'Jumlah Baris', 'Sheet'], $this->headerStyle()));
        $tableNumber = 0;
        foreach ($this->tables($payload) as $table) {
            $tableNumber++;
            $rowCount = (int) ($table['row_count'] ?? count((array) ($table['rows'] ?? [])));
            $parts = max(1, (int) ceil($rowCount / self::MAX_DATA_ROWS_PER_SHEET));
            $writer->addRow(Row::fromValues([
                $tableNumber,
                $this->safeCell($table['name'] ?? 'Tabel'),
                $rowCount,
                $parts === 1 ? '1 sheet' : $parts.' sheet',
            ]));
        }
    }

    private function writeSecurityPolicy(Writer $writer): void
    {
        $sheet = $writer->addNewSheetAndMakeItCurrent();
        $sheet->setName('Kebijakan Keamanan');
        $sheet->setColumnWidth(32, 1);
        $sheet->setColumnWidth(80, 2);

        $writer->addRow(Row::fromValuesWithStyle(['Kebijakan', 'Penjelasan'], $this->headerStyle()));
        $policies = [
            ['Kerahasiaan', 'Workbook ini tetap mengandung data sekolah dan harus disimpan dengan akses terbatas.'],
            ['Kolom sensitif', 'Password, token, secret, API key, credential, OTP, dan private key disamarkan menjadi [DISEMBUNYIKAN].'],
            ['Kelengkapan struktur', 'Nama tabel, nama kolom, jumlah baris, serta data non-rahasia tetap disertakan.'],
            ['Proteksi formula', 'Teks yang dapat dieksekusi sebagai formula Excel dinetralisasi saat ekspor.'],
            ['Restore', 'Workbook XLSX tidak digunakan untuk restore otomatis. Gunakan pasangan file JSON yang telah diverifikasi.'],
            ['File storage', 'Isi objek S3/R2/MinIO/Google Drive tidak digandakan; hanya metadata dan referensi URL yang dicatat.'],
        ];
        foreach ($policies as $policy) {
            $writer->addRow(Row::fromValues($policy));
        }
    }

    private function writeTables(Writer $writer, array $payload): void
    {
        $usedNames = ['ringkasan', 'daftar tabel', 'kebijakan keamanan'];
        $tableNumber = 0;

        foreach ($this->tables($payload) as $table) {
            $tableNumber++;
            $name = trim((string) ($table['name'] ?? 'Tabel '.$tableNumber));
            $rows = array_values(array_filter((array) ($table['rows'] ?? []), 'is_array'));
            $columns = $this->columns($table, $rows);
            $chunks = empty($rows) ? [[]] : array_chunk($rows, self::MAX_DATA_ROWS_PER_SHEET);

            foreach ($chunks as $partIndex => $chunk) {
                $part = count($chunks) > 1 ? '-'.($partIndex + 1) : '';
                $sheetName = $this->uniqueSheetName(sprintf('%02d-%s%s', $tableNumber, $name, $part), $usedNames);
                $sheet = $writer->addNewSheetAndMakeItCurrent();
                $sheet->setName($sheetName);

                foreach ($columns as $index => $column) {
                    $sheet->setColumnWidth($this->columnWidth((string) $column), $index + 1);
                }

                $writer->addRow(Row::fromValuesWithStyle(
                    ! empty($columns) ? array_map('strval', $columns) : ['Tidak ada kolom'],
                    $this->headerStyle()
                ));

                foreach ($chunk as $row) {
                    $values = [];
                    foreach ($columns as $column) {
                        $values[] = $this->isSensitiveColumn((string) $column)
                            ? $this->redactedValue($row[$column] ?? null)
                            : $this->safeCell($row[$column] ?? null);
                    }
                    $writer->addRow(Row::fromValues($values));
                }
            }
        }
    }

    private function tables(array $payload): array
    {
        return array_values(array_filter((array) ($payload['tables'] ?? []), 'is_array'));
    }

    private function columns(array $table, array $rows): array
    {
        $columns = array_values(array_filter((array) ($table['columns'] ?? []), fn ($value) => is_string($value) && trim($value) !== ''));
        $seen = array_fill_keys($columns, true);

        foreach ($rows as $row) {
            foreach (array_keys($row) as $column) {
                $column = (string) $column;
                if (! isset($seen[$column])) {
                    $columns[] = $column;
                    $seen[$column] = true;
                }
            }
        }

        return $columns;
    }

    private function safeCell(mixed $value): string|int|float|bool|null
    {
        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) {
            return $value;
        }
        if (is_array($value) || is_object($value)) {
            $value = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
        }

        $value = (string) $value;
        if (preg_match('/^[=+\-@]/', ltrim($value)) === 1) {
            return "'".$value;
        }

        return $value;
    }

    private function redactedValue(mixed $value): string
    {
        return $value === null || $value === '' ? '' : '[DISEMBUNYIKAN]';
    }

    private function isSensitiveColumn(string $column): bool
    {
        $normalized = strtolower(trim($column));
        foreach (self::SENSITIVE_COLUMN_PATTERNS as $pattern) {
            if (str_contains($normalized, $pattern)) {
                return true;
            }
        }

        return $normalized === 'token' || str_ends_with($normalized, '_token');
    }

    private function uniqueSheetName(string $candidate, array &$usedNames): string
    {
        $candidate = preg_replace('~[\\\\/?*:\[\]]+~', '-', trim($candidate)) ?: 'Tabel';
        $candidate = mb_substr($candidate, 0, 31);
        $base = $candidate;
        $suffix = 1;

        while (in_array(strtolower($candidate), $usedNames, true)) {
            $suffix++;
            $tail = '-'.$suffix;
            $candidate = mb_substr($base, 0, 31 - strlen($tail)).$tail;
        }

        $usedNames[] = strtolower($candidate);

        return $candidate;
    }

    private function columnWidth(string $column): float
    {
        return min(45, max(12, mb_strlen($column) + 4));
    }

    private function titleStyle(): Style
    {
        return new Style(fontBold: true, fontSize: 14, fontColor: Color::WHITE, backgroundColor: Color::DARK_BLUE);
    }

    private function headerStyle(): Style
    {
        return new Style(fontBold: true, fontColor: Color::WHITE, backgroundColor: Color::BLUE, shouldWrapText: true);
    }
}
