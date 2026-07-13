<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('guru_mapel_bobot')) {
            Schema::table('guru_mapel_bobot', function (Blueprint $table) {
                if (
                    Schema::hasTable('academic_terms')
                    && ! Schema::hasColumn('guru_mapel_bobot', 'academic_term_id')
                ) {
                    $table->uuid('academic_term_id')->nullable();
                }
                if (! Schema::hasColumn('guru_mapel_bobot', 'sumber_uts')) {
                    $table->string('sumber_uts', 20)->default('digital')->after('bobot_quiz_uas');
                }
                if (! Schema::hasColumn('guru_mapel_bobot', 'sumber_uas')) {
                    $table->string('sumber_uas', 20)->default('digital')->after('sumber_uts');
                }
                if (! Schema::hasColumn('guru_mapel_bobot', 'jenis_manual')) {
                    $table->string('jenis_manual', 30)->default('absensi')->after('sumber_uas');
                }
                if (! Schema::hasColumn('guru_mapel_bobot', 'label_manual')) {
                    $table->string('label_manual', 120)->nullable()->after('jenis_manual');
                }
            });
        }

        if (Schema::hasTable('guru_mapel_manual_nilai')) {
            Schema::table('guru_mapel_manual_nilai', function (Blueprint $table) {
                if (! Schema::hasColumn('guru_mapel_manual_nilai', 'nilai_uts_manual')) {
                    $table->decimal('nilai_uts_manual', 5, 2)->nullable()->after('nilai_manual');
                }
                if (! Schema::hasColumn('guru_mapel_manual_nilai', 'nilai_uas_manual')) {
                    $table->decimal('nilai_uas_manual', 5, 2)->nullable()->after('nilai_uts_manual');
                }
            });
        }

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        if (Schema::hasTable('guru_mapel_bobot')) {
            if (
                Schema::hasTable('academic_terms')
                && Schema::hasTable('academic_years')
                && Schema::hasColumn('guru_mapel_bobot', 'academic_year_id')
                && Schema::hasColumn('guru_mapel_bobot', 'academic_term_id')
            ) {
                DB::statement(<<<'SQL'
UPDATE guru_mapel_bobot AS weight
SET academic_year_id = term.academic_year_id,
    academic_term_id = term.id
FROM academic_terms AS term
JOIN academic_years AS year
  ON year.id = term.academic_year_id
 AND year.tenant_id = term.tenant_id
WHERE weight.tenant_id = term.tenant_id
  AND year.label = weight.tahun_ajaran
  AND term.semester = weight.semester
  AND weight.semester IN ('Ganjil', 'Genap')
SQL);
                DB::statement('DROP INDEX IF EXISTS guru_mapel_bobot_tenant_academic_ref_idx');
                DB::statement(
                    'CREATE INDEX guru_mapel_bobot_tenant_academic_ref_idx '.
                    'ON guru_mapel_bobot (tenant_id, academic_term_id)'
                );
                DB::statement(
                    'ALTER TABLE guru_mapel_bobot '.
                    'DROP CONSTRAINT IF EXISTS guru_mapel_bobot_tenant_academic_term_fk'
                );
                DB::statement(
                    'ALTER TABLE guru_mapel_bobot '.
                    'ADD CONSTRAINT guru_mapel_bobot_tenant_academic_term_fk '.
                    'FOREIGN KEY (tenant_id, academic_term_id) '.
                    'REFERENCES academic_terms (tenant_id, id) ON DELETE RESTRICT'
                );
                DB::statement('DROP TRIGGER IF EXISTS guru_mapel_bobot_assign_academic_ref ON guru_mapel_bobot');
                DB::statement(
                    'CREATE TRIGGER guru_mapel_bobot_assign_academic_ref '.
                    'BEFORE INSERT OR UPDATE OF tenant_id, tahun_ajaran, semester ON guru_mapel_bobot '.
                    'FOR EACH ROW EXECUTE FUNCTION sismu_assign_academic_term_ref()'
                );
            }

            DB::statement(
                'ALTER TABLE guru_mapel_bobot ADD CONSTRAINT guru_mapel_bobot_sumber_uts_check '.
                "CHECK (sumber_uts IN ('digital', 'manual')) NOT VALID"
            );
            DB::statement(
                'ALTER TABLE guru_mapel_bobot ADD CONSTRAINT guru_mapel_bobot_sumber_uas_check '.
                "CHECK (sumber_uas IN ('digital', 'manual')) NOT VALID"
            );
            DB::statement(
                'ALTER TABLE guru_mapel_bobot ADD CONSTRAINT guru_mapel_bobot_jenis_manual_check '.
                "CHECK (jenis_manual IN ('absensi', 'nilai_tambah', 'lainnya')) NOT VALID"
            );
        }

        if (Schema::hasTable('guru_mapel_manual_nilai')) {
            DB::statement(
                'ALTER TABLE guru_mapel_manual_nilai ADD CONSTRAINT guru_mapel_manual_uts_range_check '.
                'CHECK (nilai_uts_manual IS NULL OR (nilai_uts_manual >= 0 AND nilai_uts_manual <= 100)) NOT VALID'
            );
            DB::statement(
                'ALTER TABLE guru_mapel_manual_nilai ADD CONSTRAINT guru_mapel_manual_uas_range_check '.
                'CHECK (nilai_uas_manual IS NULL OR (nilai_uas_manual >= 0 AND nilai_uas_manual <= 100)) NOT VALID'
            );
            DB::statement(
                'ALTER TABLE guru_mapel_manual_nilai ADD CONSTRAINT guru_mapel_manual_component_range_check '.
                'CHECK (nilai_manual IS NULL OR (nilai_manual >= 0 AND nilai_manual <= 100)) NOT VALID'
            );
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            if (Schema::hasTable('guru_mapel_bobot')) {
                DB::statement('ALTER TABLE guru_mapel_bobot DROP CONSTRAINT IF EXISTS guru_mapel_bobot_sumber_uts_check');
                DB::statement('ALTER TABLE guru_mapel_bobot DROP CONSTRAINT IF EXISTS guru_mapel_bobot_sumber_uas_check');
                DB::statement('ALTER TABLE guru_mapel_bobot DROP CONSTRAINT IF EXISTS guru_mapel_bobot_jenis_manual_check');
            }
            if (Schema::hasTable('guru_mapel_manual_nilai')) {
                DB::statement('ALTER TABLE guru_mapel_manual_nilai DROP CONSTRAINT IF EXISTS guru_mapel_manual_uts_range_check');
                DB::statement('ALTER TABLE guru_mapel_manual_nilai DROP CONSTRAINT IF EXISTS guru_mapel_manual_uas_range_check');
                DB::statement('ALTER TABLE guru_mapel_manual_nilai DROP CONSTRAINT IF EXISTS guru_mapel_manual_component_range_check');
            }
        }

        if (Schema::hasTable('guru_mapel_manual_nilai')) {
            Schema::table('guru_mapel_manual_nilai', function (Blueprint $table) {
                $columns = array_values(array_filter(
                    ['nilai_uts_manual', 'nilai_uas_manual'],
                    fn ($column) => Schema::hasColumn('guru_mapel_manual_nilai', $column)
                ));
                if ($columns !== []) {
                    $table->dropColumn($columns);
                }
            });
        }

        if (Schema::hasTable('guru_mapel_bobot')) {
            Schema::table('guru_mapel_bobot', function (Blueprint $table) {
                $columns = array_values(array_filter(
                    ['sumber_uts', 'sumber_uas', 'jenis_manual', 'label_manual'],
                    fn ($column) => Schema::hasColumn('guru_mapel_bobot', $column)
                ));
                if ($columns !== []) {
                    $table->dropColumn($columns);
                }
            });
        }
    }
};
