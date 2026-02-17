<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('absensi_settings')) {
            return;
        }

        $hasTenantColumn = Schema::hasColumn('absensi_settings', 'tenant_id');
        $driver = DB::getDriverName();

        if ($driver === 'pgsql') {
            if ($hasTenantColumn) {
                DB::statement("
                    DELETE FROM absensi_settings a
                    USING absensi_settings b
                    WHERE a.ctid < b.ctid
                      AND a.tenant_id = b.tenant_id
                      AND a.kelas = b.kelas
                      AND a.tanggal = b.tanggal
                      AND a.mapel = b.mapel
                ");
                DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS absensi_settings_unique_key ON absensi_settings (tenant_id, kelas, tanggal, mapel)');
            } else {
                DB::statement("
                    DELETE FROM absensi_settings a
                    USING absensi_settings b
                    WHERE a.ctid < b.ctid
                      AND a.kelas = b.kelas
                      AND a.tanggal = b.tanggal
                      AND a.mapel = b.mapel
                ");
                DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS absensi_settings_unique_key ON absensi_settings (kelas, tanggal, mapel)');
            }
            return;
        }

        Schema::table('absensi_settings', function (Blueprint $table) use ($hasTenantColumn) {
            if ($hasTenantColumn) {
                $table->unique(['tenant_id', 'kelas', 'tanggal', 'mapel'], 'absensi_settings_unique_key');
            } else {
                $table->unique(['kelas', 'tanggal', 'mapel'], 'absensi_settings_unique_key');
            }
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('absensi_settings')) {
            return;
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS absensi_settings_unique_key');
            return;
        }

        Schema::table('absensi_settings', function (Blueprint $table) {
            $table->dropUnique('absensi_settings_unique_key');
        });
    }
};

