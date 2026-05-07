<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $cohortSnapshotTables = [
        'jadwal',
        'tugas',
        'quizzes',
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'jam_kosong',
        'tugas_jawaban',
        'quiz_submissions',
    ];

    private array $gradeSnapshotTables = [
        'tugas_jawaban',
        'quiz_submissions',
    ];

    public function up(): void
    {
        $this->ensureSnapshotColumns();
        $this->backfillClassScopedSnapshots();
        $this->backfillGradeSnapshots();
    }

    public function down(): void
    {
        foreach (array_reverse($this->cohortSnapshotTables) as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                if (Schema::hasColumn($tableName, 'angkatan')) {
                    $table->dropColumn('angkatan');
                }

                if (in_array($tableName, $this->gradeSnapshotTables, true)) {
                    foreach (['semester', 'tahun_ajaran'] as $column) {
                        if (Schema::hasColumn($tableName, $column)) {
                            $table->dropColumn($column);
                        }
                    }
                }
            });
        }
    }

    private function ensureSnapshotColumns(): void
    {
        foreach ($this->cohortSnapshotTables as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                if (in_array($tableName, $this->gradeSnapshotTables, true)) {
                    if (! Schema::hasColumn($tableName, 'tahun_ajaran')) {
                        $table->text('tahun_ajaran')->nullable();
                    }
                    if (! Schema::hasColumn($tableName, 'semester')) {
                        $table->text('semester')->nullable();
                    }
                }

                if (! Schema::hasColumn($tableName, 'angkatan')) {
                    $table->text('angkatan')->nullable();
                }
            });
        }
    }

    private function backfillClassScopedSnapshots(): void
    {
        if (! Schema::hasTable('kelas') || ! Schema::hasColumn('kelas', 'angkatan')) {
            return;
        }

        $this->backfillFromKelas('jadwal', 'kelas_id', ['id', 'kelas_id']);
        $this->backfillFromKelas('tugas', 'kelas', ['id']);
        $this->backfillFromKelas('quizzes', 'kelas_id', ['id']);
        $this->backfillFromKelas('absensi_settings', 'kelas', ['id']);
        $this->backfillFromKelas('jam_kosong', 'kelas', ['id']);
        $this->backfillFromKelas('absensi', 'kelas', ['id']);
        $this->backfillFromKelas('absensi_ajuan', 'kelas', ['id']);
    }

    private function backfillFromKelas(string $tableName, string $classColumn, array $keyColumns): void
    {
        if (
            ! Schema::hasTable($tableName)
            || ! Schema::hasColumn($tableName, 'angkatan')
            || ! Schema::hasColumn($tableName, $classColumn)
        ) {
            return;
        }

        $tableTenantColumn = Schema::hasColumn($tableName, 'tenant_id');
        $kelasTenantColumn = Schema::hasColumn('kelas', 'tenant_id');

        $query = DB::table($tableName.' as target')
            ->join('kelas as k', function ($join) use ($classColumn, $tableTenantColumn, $kelasTenantColumn) {
                $join->on('k.id', '=', 'target.'.$classColumn);
                if ($tableTenantColumn && $kelasTenantColumn) {
                    $join->on('k.tenant_id', '=', 'target.tenant_id');
                }
            })
            ->whereNotNull('k.angkatan')
            ->where('k.angkatan', '!=', '')
            ->where(function ($inner) {
                $inner->whereNull('target.angkatan')->orWhere('target.angkatan', '');
            });

        $selectColumns = array_map(fn ($column) => 'target.'.$column.' as '.$column, $keyColumns);
        if ($tableTenantColumn) {
            $selectColumns[] = 'target.tenant_id as tenant_id';
        }
        $selectColumns[] = 'k.angkatan as angkatan';

        do {
            $rows = (clone $query)
                ->select($selectColumns)
                ->orderBy('target.'.$keyColumns[0])
                ->limit(500)
                ->get();

            foreach ($rows as $row) {
                $update = DB::table($tableName);
                foreach ($keyColumns as $column) {
                    $update->where($column, $row->{$column});
                }
                if ($tableTenantColumn && isset($row->tenant_id)) {
                    $update->where('tenant_id', $row->tenant_id);
                }
                $update->update(['angkatan' => $row->angkatan]);
            }
        } while ($rows->count() === 500);
    }

    private function backfillGradeSnapshots(): void
    {
        $this->backfillTugasJawabanSnapshots();
        $this->backfillQuizSubmissionSnapshots();
    }

    private function backfillTugasJawabanSnapshots(): void
    {
        if (
            ! Schema::hasTable('tugas_jawaban')
            || ! Schema::hasTable('tugas')
            || ! Schema::hasColumn('tugas_jawaban', 'tahun_ajaran')
            || ! Schema::hasColumn('tugas_jawaban', 'semester')
            || ! Schema::hasColumn('tugas_jawaban', 'angkatan')
        ) {
            return;
        }

        $jawabanTenantColumn = Schema::hasColumn('tugas_jawaban', 'tenant_id');
        $tugasTenantColumn = Schema::hasColumn('tugas', 'tenant_id');
        $profileTenantColumn = Schema::hasColumn('profiles', 'tenant_id');

        $query = DB::table('tugas_jawaban as j')
            ->join('tugas as t', function ($join) use ($jawabanTenantColumn, $tugasTenantColumn) {
                $join->on('t.id', '=', 'j.tugas_id');
                if ($jawabanTenantColumn && $tugasTenantColumn) {
                    $join->on('t.tenant_id', '=', 'j.tenant_id');
                }
            })
            ->leftJoin('profiles as p', function ($join) use ($jawabanTenantColumn, $profileTenantColumn) {
                $join->on('p.id', '=', 'j.user_id');
                if ($jawabanTenantColumn && $profileTenantColumn) {
                    $join->on('p.tenant_id', '=', 'j.tenant_id');
                }
            })
            ->where(function ($inner) {
                $inner->whereNull('j.tahun_ajaran')
                    ->orWhere('j.tahun_ajaran', '')
                    ->orWhereNull('j.semester')
                    ->orWhere('j.semester', '')
                    ->orWhereNull('j.angkatan')
                    ->orWhere('j.angkatan', '');
            });

        $selectColumns = [
            'j.id as id',
            't.tahun_ajaran as tahun_ajaran',
            't.semester as semester',
            't.angkatan as tugas_angkatan',
            'p.angkatan as profile_angkatan',
        ];
        if ($jawabanTenantColumn) {
            $selectColumns[] = 'j.tenant_id as tenant_id';
        }

        do {
            $rows = (clone $query)
                ->select($selectColumns)
                ->orderBy('j.id')
                ->limit(500)
                ->get();

            $updatedAny = false;
            foreach ($rows as $row) {
                $payload = [];
                if ($row->tahun_ajaran !== null && $row->tahun_ajaran !== '') {
                    $payload['tahun_ajaran'] = $row->tahun_ajaran;
                }
                if ($row->semester !== null && $row->semester !== '') {
                    $payload['semester'] = $row->semester;
                }
                $cohort = $row->profile_angkatan ?: $row->tugas_angkatan;
                if ($cohort !== null && $cohort !== '') {
                    $payload['angkatan'] = $cohort;
                }
                if (empty($payload)) {
                    continue;
                }

                $update = DB::table('tugas_jawaban')->where('id', $row->id);
                if ($jawabanTenantColumn && isset($row->tenant_id)) {
                    $update->where('tenant_id', $row->tenant_id);
                }
                $update->update($payload);
                $updatedAny = true;
            }
        } while ($updatedAny && $rows->count() === 500);
    }

    private function backfillQuizSubmissionSnapshots(): void
    {
        if (
            ! Schema::hasTable('quiz_submissions')
            || ! Schema::hasTable('quizzes')
            || ! Schema::hasColumn('quiz_submissions', 'tahun_ajaran')
            || ! Schema::hasColumn('quiz_submissions', 'semester')
            || ! Schema::hasColumn('quiz_submissions', 'angkatan')
        ) {
            return;
        }

        $submissionTenantColumn = Schema::hasColumn('quiz_submissions', 'tenant_id');
        $quizTenantColumn = Schema::hasColumn('quizzes', 'tenant_id');
        $profileTenantColumn = Schema::hasColumn('profiles', 'tenant_id');

        $query = DB::table('quiz_submissions as s')
            ->join('quizzes as q', function ($join) use ($submissionTenantColumn, $quizTenantColumn) {
                $join->on('q.id', '=', 's.quiz_id');
                if ($submissionTenantColumn && $quizTenantColumn) {
                    $join->on('q.tenant_id', '=', 's.tenant_id');
                }
            })
            ->leftJoin('profiles as p', function ($join) use ($submissionTenantColumn, $profileTenantColumn) {
                $join->on('p.id', '=', 's.siswa_id');
                if ($submissionTenantColumn && $profileTenantColumn) {
                    $join->on('p.tenant_id', '=', 's.tenant_id');
                }
            })
            ->where(function ($inner) {
                $inner->whereNull('s.tahun_ajaran')
                    ->orWhere('s.tahun_ajaran', '')
                    ->orWhereNull('s.semester')
                    ->orWhere('s.semester', '')
                    ->orWhereNull('s.angkatan')
                    ->orWhere('s.angkatan', '');
            });

        $selectColumns = [
            's.id as id',
            'q.tahun_ajaran as tahun_ajaran',
            'q.semester as semester',
            'q.angkatan as quiz_angkatan',
            'p.angkatan as profile_angkatan',
        ];
        if ($submissionTenantColumn) {
            $selectColumns[] = 's.tenant_id as tenant_id';
        }

        do {
            $rows = (clone $query)
                ->select($selectColumns)
                ->orderBy('s.id')
                ->limit(500)
                ->get();

            $updatedAny = false;
            foreach ($rows as $row) {
                $payload = [];
                if ($row->tahun_ajaran !== null && $row->tahun_ajaran !== '') {
                    $payload['tahun_ajaran'] = $row->tahun_ajaran;
                }
                if ($row->semester !== null && $row->semester !== '') {
                    $payload['semester'] = $row->semester;
                }
                $cohort = $row->profile_angkatan ?: $row->quiz_angkatan;
                if ($cohort !== null && $cohort !== '') {
                    $payload['angkatan'] = $cohort;
                }
                if (empty($payload)) {
                    continue;
                }

                $update = DB::table('quiz_submissions')->where('id', $row->id);
                if ($submissionTenantColumn && isset($row->tenant_id)) {
                    $update->where('tenant_id', $row->tenant_id);
                }
                $update->update($payload);
                $updatedAny = true;
            }
        } while ($updatedAny && $rows->count() === 500);
    }
};
