<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->addSemesterPeriodColumns();
        $this->addDriveUsageDimensionColumns();
        $this->backfillDriveUsageDimensions();
    }

    public function down(): void
    {
        if (Schema::hasTable('tenant_google_drive_files')) {
            try {
                Schema::table('tenant_google_drive_files', function (Blueprint $table) {
                    $table->dropIndex('tenant_drive_files_period_class_idx');
                    $table->dropIndex('tenant_drive_files_period_idx');
                });
            } catch (Throwable $e) {
                // Indexes may not exist on older/local databases.
            }

            Schema::table('tenant_google_drive_files', function (Blueprint $table) {
                foreach ([
                    'task_id',
                    'kelas',
                    'angkatan',
                    'semester',
                    'tahun_ajaran',
                ] as $column) {
                    if (Schema::hasColumn('tenant_google_drive_files', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        if (Schema::hasTable('settings')) {
            Schema::table('settings', function (Blueprint $table) {
                foreach ([
                    'periode_genap_selesai',
                    'periode_genap_mulai',
                    'periode_ganjil_selesai',
                    'periode_ganjil_mulai',
                ] as $column) {
                    if (Schema::hasColumn('settings', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }

    private function addSemesterPeriodColumns(): void
    {
        if (! Schema::hasTable('settings')) {
            return;
        }

        Schema::table('settings', function (Blueprint $table) {
            if (! Schema::hasColumn('settings', 'periode_ganjil_mulai')) {
                $table->date('periode_ganjil_mulai')->nullable()->after('periode_selesai');
            }
            if (! Schema::hasColumn('settings', 'periode_ganjil_selesai')) {
                $table->date('periode_ganjil_selesai')->nullable()->after('periode_ganjil_mulai');
            }
            if (! Schema::hasColumn('settings', 'periode_genap_mulai')) {
                $table->date('periode_genap_mulai')->nullable()->after('periode_ganjil_selesai');
            }
            if (! Schema::hasColumn('settings', 'periode_genap_selesai')) {
                $table->date('periode_genap_selesai')->nullable()->after('periode_genap_mulai');
            }
        });

        DB::table('settings')->orderBy('id')->chunkById(200, function ($rows) {
            foreach ($rows as $row) {
                $tahunAjaran = AcademicPeriod::normalizeAcademicYear($row->tahun_ajaran ?? null)
                    ?: AcademicPeriod::current()['tahun_ajaran'];
                $ganjil = AcademicPeriod::make($tahunAjaran, AcademicPeriod::SEMESTER_GANJIL);
                $genap = AcademicPeriod::make($tahunAjaran, AcademicPeriod::SEMESTER_GENAP);
                $activeSemester = AcademicPeriod::normalizeSemester($row->semester_aktif ?? null);

                $updates = [
                    'periode_ganjil_mulai' => $ganjil['starts_at'],
                    'periode_ganjil_selesai' => $ganjil['ends_at'],
                    'periode_genap_mulai' => $genap['starts_at'],
                    'periode_genap_selesai' => $genap['ends_at'],
                ];

                if ($activeSemester === AcademicPeriod::SEMESTER_GANJIL) {
                    $updates['periode_ganjil_mulai'] = $row->periode_mulai ?? $updates['periode_ganjil_mulai'];
                    $updates['periode_ganjil_selesai'] = $row->periode_selesai ?? $updates['periode_ganjil_selesai'];
                } elseif ($activeSemester === AcademicPeriod::SEMESTER_GENAP) {
                    $updates['periode_genap_mulai'] = $row->periode_mulai ?? $updates['periode_genap_mulai'];
                    $updates['periode_genap_selesai'] = $row->periode_selesai ?? $updates['periode_genap_selesai'];
                }

                DB::table('settings')->where('id', $row->id)->update($updates);
            }
        });
    }

    private function addDriveUsageDimensionColumns(): void
    {
        if (! Schema::hasTable('tenant_google_drive_files')) {
            return;
        }

        Schema::table('tenant_google_drive_files', function (Blueprint $table) {
            if (! Schema::hasColumn('tenant_google_drive_files', 'tahun_ajaran')) {
                $table->text('tahun_ajaran')->nullable()->after('uploaded_by_user_id');
            }
            if (! Schema::hasColumn('tenant_google_drive_files', 'semester')) {
                $table->text('semester')->nullable()->after('tahun_ajaran');
            }
            if (! Schema::hasColumn('tenant_google_drive_files', 'angkatan')) {
                $table->text('angkatan')->nullable()->after('semester');
            }
            if (! Schema::hasColumn('tenant_google_drive_files', 'kelas')) {
                $table->text('kelas')->nullable()->after('angkatan');
            }
            if (! Schema::hasColumn('tenant_google_drive_files', 'task_id')) {
                $table->text('task_id')->nullable()->after('kelas');
            }
        });

        try {
            Schema::table('tenant_google_drive_files', function (Blueprint $table) {
                $table->index(['tenant_id', 'tahun_ajaran', 'semester'], 'tenant_drive_files_period_idx');
                $table->index(['tenant_id', 'tahun_ajaran', 'semester', 'kelas'], 'tenant_drive_files_period_class_idx');
            });
        } catch (Throwable $e) {
            // Some restored databases may already have equivalent indexes.
        }
    }

    private function backfillDriveUsageDimensions(): void
    {
        if (! Schema::hasTable('tenant_google_drive_files') || ! Schema::hasTable('tugas')) {
            return;
        }

        DB::table('tenant_google_drive_files')
            ->where(function ($query) {
                $query->whereNull('tahun_ajaran')
                    ->orWhereNull('semester')
                    ->orWhereNull('kelas');
            })
            ->orderBy('id')
            ->chunk(200, function ($rows) {
                foreach ($rows as $row) {
                    $taskId = $this->taskIdFromSourcePath((string) ($row->source_path ?? ''));
                    if ($taskId === '') {
                        continue;
                    }

                    $taskQuery = DB::table('tugas')->where('id', $taskId);
                    if (Schema::hasColumn('tugas', 'tenant_id')) {
                        $taskQuery->where('tenant_id', $row->tenant_id);
                    }

                    $task = $taskQuery->first(array_values(array_filter(
                        ['tahun_ajaran', 'semester', 'angkatan', 'kelas'],
                        fn ($column) => Schema::hasColumn('tugas', $column)
                    )));
                    if (! $task) {
                        continue;
                    }

                    DB::table('tenant_google_drive_files')
                        ->where('id', $row->id)
                        ->update([
                            'task_id' => $taskId,
                            'tahun_ajaran' => $task->tahun_ajaran ?? null,
                            'semester' => $task->semester ?? null,
                            'angkatan' => $task->angkatan ?? null,
                            'kelas' => $task->kelas ?? null,
                        ]);
                }
            });
    }

    private function taskIdFromSourcePath(string $sourcePath): string
    {
        $parts = array_values(array_filter(explode('/', trim($sourcePath, '/')), static fn ($part) => trim($part) !== ''));
        $first = (string) ($parts[0] ?? '');

        return $first === 'tugas_lampiran' ? '' : $first;
    }
};
