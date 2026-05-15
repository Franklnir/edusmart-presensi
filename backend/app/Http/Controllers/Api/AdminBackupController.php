<?php

namespace App\Http\Controllers\Api;

use App\Traits\HasTenantBackupLogic;
use App\Traits\HasTenantRestoreLogic;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminBackupController extends ApiController
{
    use HasTenantBackupLogic;
    use HasTenantRestoreLogic;

    public function backup(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa melakukan backup.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $mode = $this->normalizeBackupMode($request->query('mode'));
        $periodScope = $this->normalizeBackupPeriodScope((string) $tenantId, $request->query());

        $tables = match ($mode) {
            'students' => $this->buildStudentBackupTables($tenantId, $periodScope),
            'teachers' => $this->buildTeacherBackupTables($tenantId, $periodScope),
            'classes' => $this->buildClassBackupTables($tenantId, $periodScope),
            default => $this->buildFullBackupTables($tenantId, $periodScope),
        };

        $totalRows = 0;
        foreach ($tables as $tableInfo) {
            $totalRows += (int) ($tableInfo['row_count'] ?? 0);
        }

        $tenantName = null;
        try {
            if ($this->hasTable('settings') && $this->tableHasColumn('settings', 'tenant_id')) {
                $tenantName = DB::table('settings')
                    ->where('tenant_id', $tenantId)
                    ->orderBy('id')
                    ->value('nama_sekolah');
            }
        } catch (\Throwable $e) {
            $tenantName = null;
        }

        return response()->json([
            'data' => [
                'tenant' => [
                    'id' => $tenantId,
                    'name' => $tenantName ?: 'Sekolah',
                ],
                'exported_at' => now()->toIso8601String(),
                'mode' => $mode,
                'mode_label' => $this->backupModeLabel($mode),
                'period' => $this->backupPeriodPayload($periodScope),
                'summary' => [
                    'table_count' => count($tables),
                    'total_rows' => $totalRows,
                ],
                'manifest' => [
                    'version' => 2,
                    'backup_type' => 'tenant_database',
                    'tenant_scoped' => true,
                    'contains_storage_files' => false,
                    'contains_linked_users' => true,
                    'restore_strategy' => 'id_or_unique_key_upsert',
                    'notes' => [
                        'Backup berisi data database tenant dan metadata file, bukan isi file storage.',
                        'Restore mengarah ke tenant aktif admin, bukan tenant asal di file JSON.',
                    ],
                ],
                'tables' => $tables,
                'formats_supported' => ['xlsx', 'json', 'csv', 'html'],
                'generated_by' => [
                    'user_id' => (string) ($request->user()?->id ?? ''),
                    'role' => $this->role($request) ?: null,
                ],
            ],
        ]);
    }

    public function restore(Request $request)
    {
        if (! $this->isAdmin($request)) {
            return $this->deny('Akses ditolak. Hanya admin sekolah yang bisa melakukan restore.');
        }

        $tenantId = $this->resolveOwnedTenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $backupPayload = $this->normalizeRestoreBackupPayload($request->input('backup'));
        if (! $backupPayload) {
            return $this->deny('Payload backup tidak valid. Gunakan format JSON backup yang benar.', 422);
        }

        $dryRun = filter_var($request->input('dry_run', true), FILTER_VALIDATE_BOOLEAN);
        $truncateBeforeRestore = filter_var($request->input('truncate_before_restore', false), FILTER_VALIDATE_BOOLEAN);
        $includeTables = $request->input('include_tables', []);
        if (! is_array($includeTables)) {
            $includeTables = [];
        }

        if (! $dryRun && ! filter_var($request->input('confirm', false), FILTER_VALIDATE_BOOLEAN)) {
            return $this->deny('Untuk menjalankan restore nyata, kirim confirm=true.', 422);
        }

        try {
            $result = $this->restoreBackupPayloadForTenant(
                (string) $tenantId,
                $backupPayload,
                $dryRun,
                $truncateBeforeRestore,
                $includeTables
            );
        } catch (\Throwable $e) {
            return $this->deny('Restore gagal: '.trim((string) $e->getMessage()), 422);
        }

        if (! $dryRun) {
            $this->logAudit(
                $request,
                'tenant_restore',
                'restore-'.$tenantId,
                'UPDATE',
                null,
                [
                    'type' => 'tenant_restore',
                    'tenant_id' => $tenantId,
                    'summary' => $result['summary'] ?? [],
                ],
                (string) $tenantId
            );
        }

        return response()->json([
            'data' => [
                'tenant_id' => $tenantId,
                'dry_run' => $dryRun,
                'result' => $result,
            ],
        ]);
    }
}
