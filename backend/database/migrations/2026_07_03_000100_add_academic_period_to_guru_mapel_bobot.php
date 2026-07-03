<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('guru_mapel_bobot')) {
            return;
        }

        Schema::table('guru_mapel_bobot', function (Blueprint $table) {
            if (! Schema::hasColumn('guru_mapel_bobot', 'tahun_ajaran')) {
                $table->text('tahun_ajaran')->nullable()->after('mapel');
            }

            if (! Schema::hasColumn('guru_mapel_bobot', 'semester')) {
                $table->text('semester')->nullable()->after('tahun_ajaran');
            }
        });

        $defaultPeriod = DB::table('settings')
            ->orderBy('id')
            ->first(['tahun_ajaran']);
        $defaultYear = trim((string) ($defaultPeriod->tahun_ajaran ?? ''));

        if ($defaultYear === '') {
            $month = (int) now()->format('n');
            $year = (int) now()->format('Y');
            $startYear = $month >= 7 ? $year : $year - 1;
            $defaultYear = $startYear.'/'.($startYear + 1);
        }

        DB::table('guru_mapel_bobot')
            ->where(function ($query) {
                $query->whereNull('tahun_ajaran')->orWhere('tahun_ajaran', '');
            })
            ->update([
                'tahun_ajaran' => $defaultYear,
                'semester' => '',
                'updated_at' => now(),
            ]);

        DB::table('guru_mapel_bobot')
            ->whereNull('semester')
            ->update(['semester' => '']);

        Schema::table('guru_mapel_bobot', function (Blueprint $table) {
            $table->dropUnique('guru_mapel_bobot_unique_tenant_guru_mapel');
            $table->index(['guru_id', 'tahun_ajaran', 'semester', 'mapel'], 'guru_mapel_bobot_period_lookup_idx');
            $table->unique(
                ['tenant_id', 'guru_id', 'mapel', 'tahun_ajaran', 'semester'],
                'guru_mapel_bobot_unique_tenant_guru_mapel_period'
            );
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('guru_mapel_bobot')) {
            return;
        }

        Schema::table('guru_mapel_bobot', function (Blueprint $table) {
            $table->dropUnique('guru_mapel_bobot_unique_tenant_guru_mapel_period');
            $table->dropIndex('guru_mapel_bobot_period_lookup_idx');
            $table->unique(['tenant_id', 'guru_id', 'mapel'], 'guru_mapel_bobot_unique_tenant_guru_mapel');
        });

        Schema::table('guru_mapel_bobot', function (Blueprint $table) {
            if (Schema::hasColumn('guru_mapel_bobot', 'semester')) {
                $table->dropColumn('semester');
            }

            if (Schema::hasColumn('guru_mapel_bobot', 'tahun_ajaran')) {
                $table->dropColumn('tahun_ajaran');
            }
        });
    }
};
