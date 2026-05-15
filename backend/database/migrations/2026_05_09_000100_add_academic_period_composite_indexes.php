<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Composite indexes for academic period scoped queries.
     *
     * The DbController applies automatic `WHERE tenant_id = ? AND tahun_ajaran = ? AND semester = ?`
     * scoping on every select for these tables.  Without a composite index the database performs a
     * sequential scan, which is the primary cause of the ~1 s TTFB on /api/db.
     */
    private array $tables = [
        'jadwal',
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'jam_kosong',
        'tugas',
        'quizzes',
        'kelas',
    ];

    public function up(): void
    {
        foreach ($this->tables as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            $hasTenantId = Schema::hasColumn($tableName, 'tenant_id');
            $hasTahunAjaran = Schema::hasColumn($tableName, 'tahun_ajaran');
            $hasSemester = Schema::hasColumn($tableName, 'semester');

            if (! $hasTahunAjaran || ! $hasSemester) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName, $hasTenantId) {
                $indexName = "{$tableName}_academic_period_idx";

                if ($hasTenantId) {
                    $table->index(['tenant_id', 'tahun_ajaran', 'semester'], $indexName);
                } else {
                    $table->index(['tahun_ajaran', 'semester'], $indexName);
                }
            });
        }

        // Index on settings for the frequently queried tahun_ajaran / semester_aktif lookup.
        if (
            Schema::hasTable('settings') &&
            Schema::hasColumn('settings', 'tenant_id') &&
            Schema::hasColumn('settings', 'tahun_ajaran')
        ) {
            Schema::table('settings', function (Blueprint $table) {
                $table->index(['tenant_id', 'tahun_ajaran'], 'settings_tenant_tahun_idx');
            });
        }
    }

    public function down(): void
    {
        foreach ($this->tables as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                $indexName = "{$tableName}_academic_period_idx";

                try {
                    $table->dropIndex($indexName);
                } catch (Throwable $e) {
                    // ignore if index doesn't exist
                }
            });
        }

        if (Schema::hasTable('settings')) {
            Schema::table('settings', function (Blueprint $table) {
                try {
                    $table->dropIndex('settings_tenant_tahun_idx');
                } catch (Throwable $e) {
                    // ignore if index doesn't exist
                }
            });
        }
    }
};
