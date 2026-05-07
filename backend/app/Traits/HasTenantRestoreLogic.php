<?php

namespace App\Traits;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

trait HasTenantRestoreLogic
{
    protected function normalizeRestoreBackupPayload($raw): ?array
    {
        if (is_string($raw)) {
            $trimmed = trim($raw);
            if ($trimmed === '') {
                return null;
            }

            try {
                $decoded = json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
                $raw = $decoded;
            } catch (\Throwable $e) {
                return null;
            }
        }

        if (! is_array($raw)) {
            return null;
        }

        $tables = $raw['tables'] ?? null;
        if (! is_array($tables)) {
            return null;
        }

        return [
            'tenant' => is_array($raw['tenant'] ?? null) ? $raw['tenant'] : null,
            'mode' => isset($raw['mode']) ? (string) $raw['mode'] : null,
            'period' => is_array($raw['period'] ?? null) ? $raw['period'] : null,
            'tables' => $tables,
        ];
    }

    protected function restoreBackupPayloadForTenant(
        string $tenantId,
        array $backupPayload,
        bool $dryRun = true,
        bool $truncateBeforeRestore = false,
        array $requestedTables = []
    ): array {
        $allowedTables = array_values(array_unique(array_filter($this->resolveAllowedRestoreTables(), fn ($item) => is_string($item) && trim($item) !== '')));
        $allowedSet = array_fill_keys($allowedTables, true);

        $includeSet = [];
        foreach ($requestedTables as $item) {
            $name = trim((string) $item);
            if ($name !== '') {
                $includeSet[$name] = true;
            }
        }

        $summary = [
            'dry_run' => $dryRun,
            'truncate_before_restore' => $truncateBeforeRestore,
            'tables_total' => 0,
            'tables_applied' => 0,
            'incoming_rows' => 0,
            'would_insert' => 0,
            'would_update' => 0,
            'inserted' => 0,
            'updated' => 0,
            'deleted_before_restore' => 0,
            'skipped' => 0,
            'errors' => 0,
        ];

        $warnings = [];
        $tableResults = [];

        $executor = function () use (
            $tenantId,
            $backupPayload,
            $allowedSet,
            $includeSet,
            $dryRun,
            $truncateBeforeRestore,
            &$summary,
            &$warnings,
            &$tableResults
        ) {
            $tables = is_array($backupPayload['tables'] ?? null) ? $backupPayload['tables'] : [];
            $summary['tables_total'] = count($tables);

            foreach ($tables as $tableInfo) {
                $tableName = trim((string) ($tableInfo['name'] ?? ''));
                $rows = is_array($tableInfo['rows'] ?? null) ? $tableInfo['rows'] : [];

                if ($tableName === '') {
                    $warnings[] = 'Ada entri tabel backup tanpa nama, dilewati.';

                    continue;
                }

                if (! isset($allowedSet[$tableName])) {
                    $warnings[] = "Tabel {$tableName} tidak ada di daftar restore yang diizinkan, dilewati.";

                    continue;
                }

                if (! empty($includeSet) && ! isset($includeSet[$tableName])) {
                    continue;
                }

                $result = [
                    'table' => $tableName,
                    'incoming_rows' => count($rows),
                    'would_insert' => 0,
                    'would_update' => 0,
                    'inserted' => 0,
                    'updated' => 0,
                    'deleted_before_restore' => 0,
                    'skipped' => 0,
                    'errors' => 0,
                    'messages' => [],
                ];

                if (! Schema::hasTable($tableName)) {
                    $result['errors'] += 1;
                    $result['messages'][] = 'Tabel tidak ditemukan di database.';
                    $summary['errors'] += 1;
                    $tableResults[] = $result;

                    continue;
                }

                if (! Schema::hasColumn($tableName, 'tenant_id')) {
                    $result['errors'] += 1;
                    $result['messages'][] = 'Tabel tidak memiliki kolom tenant_id.';
                    $summary['errors'] += 1;
                    $tableResults[] = $result;

                    continue;
                }

                $columns = Schema::getColumnListing($tableName);
                $columnSet = array_fill_keys($columns, true);
                $hasIdColumn = isset($columnSet['id']);
                $hasCreatedAt = isset($columnSet['created_at']);
                $hasUpdatedAt = isset($columnSet['updated_at']);

                if ($truncateBeforeRestore && ! $dryRun) {
                    $deletedRows = DB::table($tableName)->where('tenant_id', $tenantId)->delete();
                    $result['deleted_before_restore'] += (int) $deletedRows;
                    $summary['deleted_before_restore'] += (int) $deletedRows;
                }

                foreach ($rows as $index => $rawRow) {
                    $summary['incoming_rows'] += 1;

                    if (! is_array($rawRow)) {
                        $result['skipped'] += 1;
                        $summary['skipped'] += 1;

                        continue;
                    }

                    $row = $this->buildRestorableRow($rawRow, $columnSet);
                    $row['tenant_id'] = $tenantId;

                    if ($hasCreatedAt && ! array_key_exists('created_at', $row)) {
                        $row['created_at'] = now();
                    }
                    if ($hasUpdatedAt && ! array_key_exists('updated_at', $row)) {
                        $row['updated_at'] = now();
                    }

                    if (count($row) <= 1) {
                        $result['skipped'] += 1;
                        $summary['skipped'] += 1;

                        continue;
                    }

                    try {
                        if ($hasIdColumn && isset($row['id']) && $row['id'] !== null && $row['id'] !== '') {
                            $identifier = (string) $row['id'];
                            $existingQuery = DB::table($tableName)
                                ->where('tenant_id', $tenantId)
                                ->where('id', $identifier);

                            $exists = $existingQuery->exists();
                            if ($exists) {
                                if ($dryRun) {
                                    $result['would_update'] += 1;
                                    $summary['would_update'] += 1;
                                } else {
                                    $updatePayload = $row;
                                    unset($updatePayload['id']);
                                    if (! empty($updatePayload)) {
                                        $existingQuery->update($updatePayload);
                                        $result['updated'] += 1;
                                        $summary['updated'] += 1;
                                    } else {
                                        $result['skipped'] += 1;
                                        $summary['skipped'] += 1;
                                    }
                                }
                            } else {
                                if ($dryRun) {
                                    $result['would_insert'] += 1;
                                    $summary['would_insert'] += 1;
                                } else {
                                    DB::table($tableName)->insert($row);
                                    $result['inserted'] += 1;
                                    $summary['inserted'] += 1;
                                }
                            }
                        } else {
                            if ($dryRun) {
                                $result['would_insert'] += 1;
                                $summary['would_insert'] += 1;
                            } else {
                                DB::table($tableName)->insert($row);
                                $result['inserted'] += 1;
                                $summary['inserted'] += 1;
                            }
                        }
                    } catch (\Throwable $e) {
                        $result['errors'] += 1;
                        $summary['errors'] += 1;

                        if (count($result['messages']) < 5) {
                            $rowNum = $index + 1;
                            $result['messages'][] = "Baris {$rowNum}: ".trim((string) $e->getMessage());
                        }
                    }
                }

                if (($result['incoming_rows'] > 0 || $result['deleted_before_restore'] > 0) && ($result['errors'] === 0 || $dryRun)) {
                    $summary['tables_applied'] += 1;
                }

                $tableResults[] = $result;
            }

            if (! $dryRun && $summary['errors'] > 0) {
                throw new \RuntimeException('Restore dibatalkan karena ada baris yang gagal diproses. Jalankan dry-run untuk melihat detail.');
            }
        };

        if ($dryRun) {
            $executor();
        } else {
            DB::transaction($executor);
        }

        return [
            'summary' => $summary,
            'tables' => $tableResults,
            'warnings' => $warnings,
        ];
    }

    private function resolveAllowedRestoreTables(): array
    {
        if (method_exists($this, 'backupTablesForTenant')) {
            /** @var array $tables */
            $tables = $this->backupTablesForTenant();

            return $tables;
        }

        if (method_exists($this, 'getBackupTableOrder')) {
            /** @var array $tables */
            $tables = $this->getBackupTableOrder();

            return $tables;
        }

        return [];
    }

    private function buildRestorableRow(array $row, array $columnSet): array
    {
        $normalized = [];
        foreach ($row as $key => $value) {
            $column = (string) $key;
            if ($column === '' || ! isset($columnSet[$column]) || $column === 'tenant_id') {
                continue;
            }

            if (is_array($value) || is_object($value)) {
                $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $normalized[$column] = $encoded === false ? null : $encoded;

                continue;
            }

            $normalized[$column] = $value;
        }

        return $normalized;
    }
}
