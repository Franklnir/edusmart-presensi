<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('rapot_siswa')) {
            return;
        }

        DB::table('rapot_siswa')
            ->whereIn(DB::raw('LOWER(TRIM(semester))'), ['ganjil', 'semester ganjil', '1', 'semester 1'])
            ->update(['semester' => 'Ganjil']);
        DB::table('rapot_siswa')
            ->whereIn(DB::raw('LOWER(TRIM(semester))'), ['genap', 'semester genap', '2', 'semester 2'])
            ->update(['semester' => 'Genap']);

        Schema::table('rapot_siswa', function (Blueprint $table) {
            $table->dropUnique('rapot_siswa_unique');
            $table->dropIndex('rapot_siswa_lookup_idx');

            $table->unique(
                ['tenant_id', 'siswa_id', 'kelas_id', 'tahun_pelajaran', 'semester', 'jenis'],
                'rapot_siswa_term_unique'
            );
            $table->index(
                ['tenant_id', 'kelas_id', 'tahun_pelajaran', 'semester', 'jenis'],
                'rapot_siswa_term_lookup_idx'
            );
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(
                'ALTER TABLE rapot_siswa ADD CONSTRAINT rapot_siswa_semester_check '.
                "CHECK (semester IS NULL OR semester IN ('Ganjil', 'Genap')) NOT VALID"
            );
            DB::statement(
                'ALTER TABLE rapot_siswa ADD CONSTRAINT rapot_siswa_jenis_check '.
                "CHECK (jenis IN ('uts', 'uas')) NOT VALID"
            );
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('rapot_siswa')) {
            return;
        }

        $wouldCollide = DB::table('rapot_siswa')
            ->select(['tenant_id', 'siswa_id', 'kelas_id', 'jenis', 'tahun_pelajaran'])
            ->groupBy(['tenant_id', 'siswa_id', 'kelas_id', 'jenis', 'tahun_pelajaran'])
            ->havingRaw('COUNT(*) > 1')
            ->exists();
        if ($wouldCollide) {
            throw new RuntimeException(
                'Rollback ditolak: rapot dari lebih dari satu semester akan bertabrakan pada constraint lama.'
            );
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE rapot_siswa DROP CONSTRAINT IF EXISTS rapot_siswa_semester_check');
            DB::statement('ALTER TABLE rapot_siswa DROP CONSTRAINT IF EXISTS rapot_siswa_jenis_check');
        }

        Schema::table('rapot_siswa', function (Blueprint $table) {
            $table->dropUnique('rapot_siswa_term_unique');
            $table->dropIndex('rapot_siswa_term_lookup_idx');

            $table->unique(
                ['tenant_id', 'siswa_id', 'kelas_id', 'jenis', 'tahun_pelajaran'],
                'rapot_siswa_unique'
            );
            $table->index(
                ['tenant_id', 'kelas_id', 'jenis', 'tahun_pelajaran'],
                'rapot_siswa_lookup_idx'
            );
        });
    }
};
