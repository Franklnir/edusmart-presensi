<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('guru_mapel_manual_nilai')) {
            return;
        }

        if (! Schema::hasColumn('guru_mapel_manual_nilai', 'semester')) {
            Schema::table('guru_mapel_manual_nilai', function (Blueprint $table) {
                $table->string('semester', 40)->nullable()->after('tahun_ajaran');
            });
        }

        Schema::table('guru_mapel_manual_nilai', function (Blueprint $table) {
            $table->dropUnique('guru_mapel_manual_nilai_unique');
            $table->dropIndex('guru_mapel_manual_lookup_idx');

            $table->unique(
                ['tenant_id', 'guru_id', 'siswa_id', 'kelas_id', 'mapel', 'tahun_ajaran', 'semester'],
                'guru_mapel_manual_term_unique'
            );
            $table->index(
                ['tenant_id', 'kelas_id', 'mapel', 'tahun_ajaran', 'semester'],
                'guru_mapel_manual_term_lookup_idx'
            );
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(
                'ALTER TABLE guru_mapel_manual_nilai ADD CONSTRAINT guru_mapel_manual_semester_check '.
                "CHECK (semester IS NULL OR semester IN ('Ganjil', 'Genap')) NOT VALID"
            );
            if (
                Schema::hasColumn('guru_mapel_manual_nilai', 'academic_term_id')
                && Schema::hasColumn('guru_mapel_manual_nilai', 'academic_year_id')
            ) {
                DB::statement(
                    'CREATE TRIGGER guru_mapel_manual_nilai_assign_academic_ref '.
                    'BEFORE INSERT OR UPDATE OF tenant_id, tahun_ajaran, semester ON guru_mapel_manual_nilai '.
                    'FOR EACH ROW EXECUTE FUNCTION sismu_assign_academic_term_ref()'
                );
            }
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('guru_mapel_manual_nilai')) {
            return;
        }

        $wouldCollide = DB::table('guru_mapel_manual_nilai')
            ->select(['tenant_id', 'guru_id', 'siswa_id', 'kelas_id', 'mapel', 'tahun_ajaran'])
            ->groupBy(['tenant_id', 'guru_id', 'siswa_id', 'kelas_id', 'mapel', 'tahun_ajaran'])
            ->havingRaw('COUNT(*) > 1')
            ->exists();
        if ($wouldCollide) {
            throw new RuntimeException(
                'Rollback ditolak: nilai manual dari lebih dari satu semester akan bertabrakan.'
            );
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP TRIGGER IF EXISTS guru_mapel_manual_nilai_assign_academic_ref ON guru_mapel_manual_nilai');
            DB::statement('ALTER TABLE guru_mapel_manual_nilai DROP CONSTRAINT IF EXISTS guru_mapel_manual_semester_check');
        }

        Schema::table('guru_mapel_manual_nilai', function (Blueprint $table) {
            $table->dropUnique('guru_mapel_manual_term_unique');
            $table->dropIndex('guru_mapel_manual_term_lookup_idx');
            $table->unique(
                ['tenant_id', 'guru_id', 'siswa_id', 'kelas_id', 'mapel', 'tahun_ajaran'],
                'guru_mapel_manual_nilai_unique'
            );
            $table->index(
                ['tenant_id', 'kelas_id', 'mapel', 'tahun_ajaran'],
                'guru_mapel_manual_lookup_idx'
            );
            $table->dropColumn('semester');
        });
    }
};
