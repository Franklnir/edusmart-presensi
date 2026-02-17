<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('absensi')) {
            return;
        }

        $hasTenant = Schema::hasColumn('absensi', 'tenant_id');
        $columns = $hasTenant
            ? 'tenant_id, kelas, tanggal, uid, mapel'
            : 'kelas, tanggal, uid, mapel';

        $driver = DB::getDriverName();
        if ($driver === 'pgsql') {
            if ($hasTenant) {
                DB::statement('DELETE FROM absensi a USING absensi b WHERE a.id < b.id AND a.kelas = b.kelas AND a.tanggal = b.tanggal AND a.uid = b.uid AND a.mapel = b.mapel AND a.tenant_id IS NOT DISTINCT FROM b.tenant_id');
            } else {
                DB::statement('DELETE FROM absensi a USING absensi b WHERE a.id < b.id AND a.kelas = b.kelas AND a.tanggal = b.tanggal AND a.uid = b.uid AND a.mapel = b.mapel');
            }
        } elseif ($driver === 'mysql') {
            if ($hasTenant) {
                DB::statement('DELETE a FROM absensi a INNER JOIN absensi b ON a.id < b.id AND a.kelas = b.kelas AND a.tanggal = b.tanggal AND a.uid = b.uid AND a.mapel = b.mapel AND ((a.tenant_id IS NULL AND b.tenant_id IS NULL) OR a.tenant_id = b.tenant_id)');
            } else {
                DB::statement('DELETE a FROM absensi a INNER JOIN absensi b ON a.id < b.id AND a.kelas = b.kelas AND a.tanggal = b.tanggal AND a.uid = b.uid AND a.mapel = b.mapel');
            }
        }

        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS absensi_unique_key ON absensi ({$columns})");
    }

    public function down(): void
    {
        if (!Schema::hasTable('absensi')) {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS absensi_unique_key');
    }
};
