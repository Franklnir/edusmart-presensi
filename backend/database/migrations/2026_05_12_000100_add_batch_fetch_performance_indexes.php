<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $indexes = [
        'profiles_tenant_role_nama_idx' => [
            'table' => 'profiles',
            'columns' => ['tenant_id', 'role', 'nama'],
        ],
        'kelas_struktur_tenant_kelas_idx' => [
            'table' => 'kelas_struktur',
            'columns' => ['tenant_id', 'kelas_id'],
        ],
        'kelas_struktur_tenant_wali_idx' => [
            'table' => 'kelas_struktur',
            'columns' => ['tenant_id', 'wali_guru_id'],
        ],
        'jadwal_tenant_kelas_period_hari_jam_idx' => [
            'table' => 'jadwal',
            'columns' => ['tenant_id', 'kelas_id', 'tahun_ajaran', 'semester', 'hari', 'jam_mulai'],
        ],
        'absensi_tenant_kelas_tanggal_uid_mapel_waktu_idx' => [
            'table' => 'absensi',
            'columns' => ['tenant_id', 'kelas', 'tanggal', 'uid', 'mapel', 'waktu'],
        ],
        'absensi_settings_tenant_kelas_tanggal_period_mapel_idx' => [
            'table' => 'absensi_settings',
            'columns' => ['tenant_id', 'kelas', 'tanggal', 'tahun_ajaran', 'semester', 'mapel'],
        ],
        'jam_kosong_tenant_kelas_tanggal_period_jam_idx' => [
            'table' => 'jam_kosong',
            'columns' => ['tenant_id', 'kelas', 'tanggal', 'tahun_ajaran', 'semester', 'jam_mulai'],
        ],
    ];

    public function up(): void
    {
        foreach ($this->indexes as $name => $definition) {
            if (! $this->canCreateIndex($definition['table'], $definition['columns'])) {
                continue;
            }

            Schema::table($definition['table'], function (Blueprint $table) use ($definition, $name) {
                $table->index($definition['columns'], $name);
            });
        }
    }

    public function down(): void
    {
        foreach ($this->indexes as $name => $definition) {
            if (! Schema::hasTable($definition['table'])) {
                continue;
            }

            Schema::table($definition['table'], function (Blueprint $table) use ($name) {
                try {
                    $table->dropIndex($name);
                } catch (Throwable $e) {
                    // Index may not exist on partially migrated databases.
                }
            });
        }
    }

    private function canCreateIndex(string $table, array $columns): bool
    {
        if (! Schema::hasTable($table)) {
            return false;
        }

        foreach ($columns as $column) {
            if (! Schema::hasColumn($table, $column)) {
                return false;
            }
        }

        return true;
    }
};
