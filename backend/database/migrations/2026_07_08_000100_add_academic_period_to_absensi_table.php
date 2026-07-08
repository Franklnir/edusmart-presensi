<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('absensi')) {
            return;
        }

        Schema::table('absensi', function (Blueprint $table) {
            if (! Schema::hasColumn('absensi', 'tahun_ajaran')) {
                $column = $table->text('tahun_ajaran')->nullable();
                if (Schema::hasColumn('absensi', 'tenant_id')) {
                    $column->after('tenant_id');
                }
            }
            if (! Schema::hasColumn('absensi', 'semester')) {
                $table->text('semester')->nullable()->after('tahun_ajaran');
            }
            if (! Schema::hasColumn('absensi', 'angkatan')) {
                $table->text('angkatan')->nullable()->after('semester');
            }
        });

        $this->backfillPeriodColumns();
        $this->backfillCohortColumn();
        $this->addIndexes();
    }

    public function down(): void
    {
        if (! Schema::hasTable('absensi')) {
            return;
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS absensi_tenant_kelas_tanggal_period_mapel_idx');
            DB::statement('DROP INDEX IF EXISTS absensi_tenant_period_class_idx');
        }

        Schema::table('absensi', function (Blueprint $table) {
            foreach (['angkatan', 'semester', 'tahun_ajaran'] as $column) {
                if (Schema::hasColumn('absensi', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    private function backfillPeriodColumns(): void
    {
        if (
            ! Schema::hasColumn('absensi', 'tahun_ajaran')
            || ! Schema::hasColumn('absensi', 'semester')
            || ! Schema::hasColumn('absensi', 'tanggal')
        ) {
            return;
        }

        DB::table('absensi')
            ->where(function ($query) {
                $query->whereNull('tahun_ajaran')
                    ->orWhere('tahun_ajaran', '')
                    ->orWhereNull('semester')
                    ->orWhere('semester', '');
            })
            ->orderBy('id')
            ->chunkById(500, function ($rows) {
                foreach ($rows as $row) {
                    $period = $this->periodForDate($row->tanggal ?? null);
                    if (! $period) {
                        continue;
                    }

                    DB::table('absensi')
                        ->where('id', $row->id)
                        ->update([
                            'tahun_ajaran' => $period['tahun_ajaran'],
                            'semester' => $period['semester'],
                        ]);
                }
            });
    }

    private function backfillCohortColumn(): void
    {
        if (
            ! Schema::hasTable('kelas')
            || ! Schema::hasColumn('absensi', 'angkatan')
            || ! Schema::hasColumn('absensi', 'kelas')
            || ! Schema::hasColumn('kelas', 'angkatan')
        ) {
            return;
        }

        $kelasRows = DB::table('kelas')
            ->select(array_values(array_filter([
                Schema::hasColumn('kelas', 'tenant_id') ? 'tenant_id' : null,
                'id',
                Schema::hasColumn('kelas', 'nama') ? 'nama' : null,
                'angkatan',
            ])))
            ->get();

        $cohortByKey = [];
        foreach ($kelasRows as $kelas) {
            $tenantId = (string) ($kelas->tenant_id ?? '');
            $angkatan = trim((string) ($kelas->angkatan ?? ''));
            if ($angkatan === '') {
                continue;
            }

            foreach ([$kelas->id ?? null, $kelas->nama ?? null] as $classKey) {
                $classKey = trim((string) $classKey);
                if ($classKey !== '') {
                    $cohortByKey[$tenantId.'|'.$classKey] = $angkatan;
                }
            }
        }

        if (empty($cohortByKey)) {
            return;
        }

        DB::table('absensi')
            ->where(function ($query) {
                $query->whereNull('angkatan')
                    ->orWhere('angkatan', '');
            })
            ->orderBy('id')
            ->chunkById(500, function ($rows) use ($cohortByKey) {
                foreach ($rows as $row) {
                    $tenantId = (string) ($row->tenant_id ?? '');
                    $kelas = trim((string) ($row->kelas ?? ''));
                    $angkatan = $cohortByKey[$tenantId.'|'.$kelas] ?? $cohortByKey['|'.$kelas] ?? null;
                    if (! $angkatan) {
                        continue;
                    }

                    DB::table('absensi')
                        ->where('id', $row->id)
                        ->update(['angkatan' => $angkatan]);
                }
            });
    }

    private function addIndexes(): void
    {
        if (
            DB::getDriverName() === 'pgsql'
            && Schema::hasColumn('absensi', 'tenant_id')
            && Schema::hasColumn('absensi', 'kelas')
            && Schema::hasColumn('absensi', 'tanggal')
            && Schema::hasColumn('absensi', 'tahun_ajaran')
            && Schema::hasColumn('absensi', 'semester')
            && Schema::hasColumn('absensi', 'mapel')
        ) {
            DB::statement('CREATE INDEX IF NOT EXISTS absensi_tenant_kelas_tanggal_period_mapel_idx ON absensi (tenant_id, kelas, tanggal, tahun_ajaran, semester, mapel)');
            DB::statement('CREATE INDEX IF NOT EXISTS absensi_tenant_period_class_idx ON absensi (tenant_id, tahun_ajaran, semester, kelas)');
        }
    }

    private function periodForDate($value): ?array
    {
        try {
            $date = Carbon::parse($value, 'Asia/Jakarta');
        } catch (Throwable $e) {
            return null;
        }

        $startYear = $date->month >= 7 ? $date->year : $date->year - 1;
        $semester = $date->month >= 7
            ? AcademicPeriod::SEMESTER_GANJIL
            : AcademicPeriod::SEMESTER_GENAP;

        return AcademicPeriod::make($startYear.'/'.($startYear + 1), $semester);
    }
};
