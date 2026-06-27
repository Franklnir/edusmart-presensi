<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $indexes = [
        'profiles_tenant_role_nis_import_idx' => [
            'table' => 'profiles',
            'columns' => ['tenant_id', 'role', 'nis'],
        ],
        'profiles_tenant_role_email_import_idx' => [
            'table' => 'profiles',
            'columns' => ['tenant_id', 'role', 'email'],
        ],
        'absensi_tenant_kelas_tanggal_report_idx' => [
            'table' => 'absensi',
            'columns' => ['tenant_id', 'kelas', 'tanggal'],
        ],
        'eskul_anggota_tenant_eskul_user_idx' => [
            'table' => 'eskul_anggota',
            'columns' => ['tenant_id', 'eskul_id', 'user_id'],
        ],
        'absensi_eskul_tenant_eskul_user_tanggal_idx' => [
            'table' => 'absensi_eskul',
            'columns' => ['tenant_id', 'eskul_id', 'user_id', 'tanggal'],
        ],
        'rfid_scans_tenant_status_created_idx' => [
            'table' => 'rfid_scans',
            'columns' => ['tenant_id', 'status', 'created_at'],
        ],
        'user_presence_tenant_user_seen_idx' => [
            'table' => 'user_presence',
            'columns' => ['tenant_id', 'user_id', 'last_seen_at'],
        ],
    ];

    public function up(): void
    {
        foreach ($this->indexes as $indexName => $definition) {
            $this->createIndexIfColumnsExist(
                $definition['table'],
                $indexName,
                $definition['columns']
            );
        }
    }

    public function down(): void
    {
        foreach (array_keys($this->indexes) as $indexName) {
            DB::statement(sprintf('DROP INDEX IF EXISTS %s', $indexName));
        }
    }

    private function createIndexIfColumnsExist(string $tableName, string $indexName, array $columns): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        foreach ($columns as $column) {
            if (! Schema::hasColumn($tableName, $column)) {
                return;
            }
        }

        DB::statement(sprintf(
            'CREATE INDEX IF NOT EXISTS %s ON %s (%s)',
            $indexName,
            $tableName,
            implode(', ', $columns)
        ));
    }
};
