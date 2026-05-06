<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $periodTables = [
        'kelas',
        'jadwal',
        'tugas',
        'quizzes',
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'jam_kosong',
    ];

    public function up(): void
    {
        $this->ensureAcademicColumns();
        $this->backfillSettingsPeriod();
        $this->backfillPeriodTables();
        $this->backfillCohorts();
    }

    public function down(): void
    {
        foreach ($this->periodTables as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                foreach (['semester', 'tahun_ajaran'] as $column) {
                    if (Schema::hasColumn($tableName, $column)) {
                        $table->dropColumn($column);
                    }
                }

                if ($tableName === 'kelas') {
                    foreach (['is_active', 'angkatan'] as $column) {
                        if (Schema::hasColumn($tableName, $column)) {
                            $table->dropColumn($column);
                        }
                    }
                }
            });
        }

        if (Schema::hasTable('profiles')) {
            Schema::table('profiles', function (Blueprint $table) {
                foreach (['tahun_lulus', 'angkatan'] as $column) {
                    if (Schema::hasColumn('profiles', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }

    private function ensureAcademicColumns(): void
    {
        foreach ($this->periodTables as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                if ($tableName === 'kelas') {
                    if (! Schema::hasColumn($tableName, 'angkatan')) {
                        $table->text('angkatan')->nullable();
                    }
                    if (! Schema::hasColumn($tableName, 'is_active')) {
                        $table->boolean('is_active')->default(true);
                    }
                }

                if (! Schema::hasColumn($tableName, 'tahun_ajaran')) {
                    $table->text('tahun_ajaran')->nullable();
                }
                if (! Schema::hasColumn($tableName, 'semester')) {
                    $table->text('semester')->nullable();
                }
            });
        }

        if (! Schema::hasTable('profiles')) {
            return;
        }

        Schema::table('profiles', function (Blueprint $table) {
            if (! Schema::hasColumn('profiles', 'angkatan')) {
                $table->text('angkatan')->nullable();
            }
            if (! Schema::hasColumn('profiles', 'tahun_lulus')) {
                $table->integer('tahun_lulus')->nullable();
            }
        });
    }

    private function backfillSettingsPeriod(): void
    {
        if (! Schema::hasTable('settings')) {
            return;
        }

        $current = AcademicPeriod::current();
        DB::table('settings')
            ->where(function ($query) {
                $query->whereNull('tahun_ajaran')
                    ->orWhere('tahun_ajaran', '');
            })
            ->update(['tahun_ajaran' => $current['tahun_ajaran']]);

        DB::table('settings')
            ->where(function ($query) {
                $query->whereNull('semester_aktif')
                    ->orWhere('semester_aktif', '');
            })
            ->update(['semester_aktif' => $current['semester']]);
    }

    private function backfillPeriodTables(): void
    {
        $current = AcademicPeriod::current();
        $settingsRows = Schema::hasTable('settings')
            ? DB::table('settings')->get(['tenant_id', 'tahun_ajaran', 'semester_aktif'])
            : collect();

        if ($settingsRows->isEmpty()) {
            $settingsRows = collect([(object) [
                'tenant_id' => null,
                'tahun_ajaran' => $current['tahun_ajaran'],
                'semester_aktif' => $current['semester'],
            ]]);
        }

        foreach ($settingsRows as $settings) {
            $period = AcademicPeriod::fromSettings($settings);
            $tenantId = $settings->tenant_id ?? null;

            foreach ($this->periodTables as $tableName) {
                if (! Schema::hasTable($tableName) || ! Schema::hasColumn($tableName, 'tahun_ajaran')) {
                    continue;
                }

                $query = DB::table($tableName)
                    ->where(function ($inner) {
                        $inner->whereNull('tahun_ajaran')
                            ->orWhere('tahun_ajaran', '')
                            ->orWhereNull('semester')
                            ->orWhere('semester', '');
                    });

                if ($tenantId && Schema::hasColumn($tableName, 'tenant_id')) {
                    $query->where('tenant_id', $tenantId);
                }

                $query->update([
                    'tahun_ajaran' => $period['tahun_ajaran'],
                    'semester' => $period['semester'],
                ]);
            }
        }
    }

    private function backfillCohorts(): void
    {
        if (! Schema::hasTable('kelas') || ! Schema::hasColumn('kelas', 'angkatan')) {
            return;
        }

        $current = AcademicPeriod::current();
        $academicStartYear = (int) substr($current['tahun_ajaran'], 0, 4);

        DB::table('kelas')
            ->where(function ($query) {
                $query->whereNull('angkatan')->orWhere('angkatan', '');
            })
            ->orderBy('id')
            ->chunk(500, function ($rows) use ($academicStartYear) {
                foreach ($rows as $row) {
                    $cohort = $this->inferCohortYear($row->grade ?? $row->nama ?? $row->id ?? '', $academicStartYear);
                    DB::table('kelas')->where('id', $row->id)->update(['angkatan' => $cohort]);
                }
            });

        if (! Schema::hasTable('profiles') || ! Schema::hasColumn('profiles', 'angkatan')) {
            return;
        }

        DB::table('profiles')
            ->where('role', 'siswa')
            ->where(function ($query) {
                $query->whereNull('angkatan')->orWhere('angkatan', '');
            })
            ->orderBy('id')
            ->chunk(500, function ($rows) use ($academicStartYear) {
                foreach ($rows as $row) {
                    $cohort = $this->inferCohortYear($row->kelas ?? '', $academicStartYear);
                    DB::table('profiles')->where('id', $row->id)->update(['angkatan' => $cohort]);
                }
            });
    }

    private function inferCohortYear($classValue, int $academicStartYear): string
    {
        $grade = strtoupper(trim((string) $classValue));
        if (preg_match('/^(XII|XI|X|IX|VIII|VII)\b/', $grade, $matches)) {
            $grade = $matches[1];
        }

        $offset = match ($grade) {
            'VIII', 'XI' => -1,
            'IX', 'XII' => -2,
            default => 0,
        };

        return (string) ($academicStartYear + $offset);
    }
};
