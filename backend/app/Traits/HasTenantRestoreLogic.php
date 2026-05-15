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
            'manifest' => is_array($raw['manifest'] ?? null) ? $raw['manifest'] : null,
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
            'conflicts' => 0,
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
            $linkedUserIds = $this->linkedUserIdsFromBackupTables($tables);

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
                    'conflicts' => 0,
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

                $isUsersTable = $tableName === 'users';

                if (! $isUsersTable && ! Schema::hasColumn($tableName, 'tenant_id')) {
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

                if (! $isUsersTable && $truncateBeforeRestore && ! $dryRun) {
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
                    if ($isUsersTable) {
                        $this->restoreLinkedUserRow($tenantId, $row, $linkedUserIds, $dryRun, $result, $summary, $index);

                        continue;
                    }

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
                        if ($hasIdColumn && $this->tenantRowIdConflictExists($tableName, $tenantId, $row['id'] ?? null)) {
                            $this->recordRestoreConflict(
                                $result,
                                $summary,
                                $index,
                                'ID sudah dipakai tenant lain, baris dilewati agar tidak menimpa data sekolah lain.'
                            );

                            continue;
                        }

                        $existingQuery = $this->resolveExistingTenantRestoreQuery($tableName, $tenantId, $row, $columnSet);
                        $this->applyRestoreUpsert($tableName, $row, $existingQuery, $dryRun, $result, $summary);
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

            return array_values(array_unique(array_merge(['users'], $tables)));
        }

        if (method_exists($this, 'getBackupTableOrder')) {
            /** @var array $tables */
            $tables = $this->getBackupTableOrder();

            return array_values(array_unique(array_merge(['users'], $tables)));
        }

        return ['users'];
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

    private function applyRestoreUpsert(
        string $tableName,
        array $row,
        $existingQuery,
        bool $dryRun,
        array &$result,
        array &$summary
    ): void {
        if ($existingQuery) {
            if ($dryRun) {
                $result['would_update'] += 1;
                $summary['would_update'] += 1;

                return;
            }

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

            return;
        }

        if ($dryRun) {
            $result['would_insert'] += 1;
            $summary['would_insert'] += 1;

            return;
        }

        DB::table($tableName)->insert($row);
        $result['inserted'] += 1;
        $summary['inserted'] += 1;
    }

    private function resolveExistingTenantRestoreQuery(string $tableName, string $tenantId, array $row, array $columnSet)
    {
        if (isset($columnSet['id']) && isset($row['id']) && $row['id'] !== null && $row['id'] !== '') {
            $query = DB::table($tableName)
                ->where('tenant_id', $tenantId)
                ->where('id', (string) $row['id']);

            if ($query->exists()) {
                return $query;
            }
        }

        foreach ($this->restoreConflictKeySets($tableName, $columnSet) as $columns) {
            $rawColumns = array_values(array_map('strval', $columns));
            $tenantOnly = $rawColumns === ['tenant_id'];
            $columns = array_values(array_filter(
                $rawColumns,
                fn ($column) => $column !== 'tenant_id' && isset($columnSet[$column])
            ));

            if ($tenantOnly) {
                $query = DB::table($tableName)->where('tenant_id', $tenantId);
                if ($query->exists()) {
                    return $query;
                }

                continue;
            }

            if (empty($columns)) {
                continue;
            }

            $hasAllValues = true;
            foreach ($columns as $column) {
                if (! array_key_exists($column, $row) || $row[$column] === null || $row[$column] === '') {
                    $hasAllValues = false;
                    break;
                }
            }
            if (! $hasAllValues) {
                continue;
            }

            $query = DB::table($tableName)->where('tenant_id', $tenantId);
            foreach ($columns as $column) {
                $query->where($column, $row[$column]);
            }

            if ($query->exists()) {
                return $query;
            }
        }

        return null;
    }

    private function tenantRowIdConflictExists(string $tableName, string $tenantId, $id): bool
    {
        if ($id === null || $id === '' || ! Schema::hasColumn($tableName, 'id') || ! Schema::hasColumn($tableName, 'tenant_id')) {
            return false;
        }

        return DB::table($tableName)
            ->where('id', (string) $id)
            ->where(function ($query) use ($tenantId) {
                $query->where('tenant_id', '<>', $tenantId)
                    ->orWhereNull('tenant_id');
            })
            ->exists();
    }

    private function restoreConflictKeySets(string $tableName, array $columnSet): array
    {
        $sets = $this->manualRestoreConflictKeySets($tableName);

        try {
            foreach (Schema::getIndexes($tableName) as $index) {
                if (! (($index['unique'] ?? false) || ($index['primary'] ?? false))) {
                    continue;
                }

                $columns = array_values(array_filter(
                    array_map('strval', $index['columns'] ?? []),
                    fn ($column) => $column !== 'id' && isset($columnSet[$column])
                ));

                if (! empty($columns)) {
                    $sets[] = $columns;
                }
            }
        } catch (\Throwable $e) {
            // Database lama/driver tertentu mungkin belum mendukung introspeksi index.
        }

        $unique = [];
        foreach ($sets as $columns) {
            $columns = array_values(array_unique(array_map('strval', $columns)));
            sort($columns);
            if (empty($columns)) {
                continue;
            }
            $unique[implode('|', $columns)] = $columns;
        }

        return array_values($unique);
    }

    private function manualRestoreConflictKeySets(string $tableName): array
    {
        return match ($tableName) {
            'settings',
            'absensi_rfid_settings',
            'tenant_google_drive_configs',
            'tenant_mqtt_configs',
            'whatsapp_integrations',
            'whatsapp_notification_settings' => [['tenant_id']],
            'profiles' => [['email'], ['rfid_uid']],
            'allowed_registrations' => [['email', 'role']],
            'registration_otps' => [['email', 'purpose']],
            'kelas_struktur' => [['kelas_id']],
            'absensi' => [['kelas', 'tanggal', 'uid', 'mapel']],
            'absensi_settings' => [['kelas', 'tanggal', 'mapel']],
            'absensi_scan_temp' => [['tanggal', 'siswa_id', 'sesi']],
            'quiz_submissions' => [['quiz_id', 'siswa_id']],
            'quiz_answers' => [['submission_id', 'question_id']],
            'osis_anggota' => [['siswa_id']],
            'rfid_devices' => [['device_id']],
            'rfid_device_events' => [['device_id', 'event_id']],
            'tenant_domains' => [['host']],
            'tenant_google_drive_files' => [['drive_file_id'], ['storage_value']],
            'whatsapp_message_logs' => [['event_key', 'normalized_phone']],
            default => [],
        };
    }

    private function linkedUserIdsFromBackupTables(array $tables): array
    {
        $ids = [];
        foreach ($tables as $tableInfo) {
            $tableName = trim((string) ($tableInfo['name'] ?? ''));
            if (! in_array($tableName, ['profiles', 'admin_users'], true)) {
                continue;
            }

            foreach (($tableInfo['rows'] ?? []) as $row) {
                if (! is_array($row)) {
                    continue;
                }
                $id = trim((string) ($row['id'] ?? ''));
                if ($id !== '') {
                    $ids[$id] = true;
                }
            }
        }

        return array_fill_keys(array_keys($ids), true);
    }

    private function restoreLinkedUserRow(
        string $tenantId,
        array $row,
        array $linkedUserIds,
        bool $dryRun,
        array &$result,
        array &$summary,
        int $rowIndex
    ): void {
        $userId = trim((string) ($row['id'] ?? ''));
        if ($userId === '' || ! isset($linkedUserIds[$userId])) {
            $this->recordRestoreConflict(
                $result,
                $summary,
                $rowIndex,
                'User tidak direferensikan oleh profiles/admin_users di backup ini, baris dilewati.'
            );

            return;
        }

        if ($this->linkedUserBelongsToAnotherTenant($tenantId, $userId)) {
            $this->recordRestoreConflict(
                $result,
                $summary,
                $rowIndex,
                'User ID sudah terhubung ke tenant lain, baris dilewati.'
            );

            return;
        }

        $existingQuery = DB::table('users')->where('id', $userId);
        $this->applyRestoreUpsert('users', $row, $existingQuery->exists() ? $existingQuery : null, $dryRun, $result, $summary);
    }

    private function linkedUserBelongsToAnotherTenant(string $tenantId, string $userId): bool
    {
        foreach (['profiles', 'admin_users'] as $tableName) {
            if (! Schema::hasTable($tableName) || ! Schema::hasColumn($tableName, 'id') || ! Schema::hasColumn($tableName, 'tenant_id')) {
                continue;
            }

            if (DB::table($tableName)
                ->where('id', $userId)
                ->where('tenant_id', '<>', $tenantId)
                ->exists()
            ) {
                return true;
            }
        }

        return false;
    }

    private function recordRestoreConflict(array &$result, array &$summary, int $rowIndex, string $message): void
    {
        $result['conflicts'] += 1;
        $summary['conflicts'] += 1;
        $result['skipped'] += 1;
        $summary['skipped'] += 1;

        if (count($result['messages']) < 5) {
            $rowNum = $rowIndex + 1;
            $result['messages'][] = "Baris {$rowNum}: {$message}";
        }
    }
}
