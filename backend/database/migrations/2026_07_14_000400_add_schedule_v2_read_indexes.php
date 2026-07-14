<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $indexes = [
        'jadwal_v2_tenant_year_class_day_time_idx' => [
            'tenant_id', 'tahun_ajaran', 'kelas_id', 'hari', 'jam_mulai', 'id',
        ],
        'jadwal_v2_tenant_year_teacher_day_time_idx' => [
            'tenant_id', 'tahun_ajaran', 'guru_id', 'hari', 'jam_mulai', 'id',
        ],
    ];

    public function up(): void
    {
        if (! Schema::hasTable('jadwal')) {
            return;
        }

        foreach ($this->indexes as $name => $columns) {
            if (! $this->hasColumns($columns)) {
                continue;
            }

            Schema::table('jadwal', function (Blueprint $table) use ($columns, $name) {
                $table->index($columns, $name);
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('jadwal')) {
            return;
        }

        Schema::table('jadwal', function (Blueprint $table) {
            foreach (array_keys($this->indexes) as $name) {
                try {
                    $table->dropIndex($name);
                } catch (Throwable) {
                    // A partially migrated environment may not have the index.
                }
            }
        });
    }

    private function hasColumns(array $columns): bool
    {
        foreach ($columns as $column) {
            if (! Schema::hasColumn('jadwal', $column)) {
                return false;
            }
        }

        return true;
    }
};
