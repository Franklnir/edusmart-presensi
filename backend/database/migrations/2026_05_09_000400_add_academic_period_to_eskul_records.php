<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $periodTables = [
        'ekskul_anggota',
        'absensi_eskul',
        'anggota_ekskul',
    ];

    private array $indexDefinitions = [
        'ekskul_anggota' => ['tenant_id', 'tahun_ajaran', 'semester', 'angkatan', 'ekskul_id', 'user_id'],
        'absensi_eskul' => ['tenant_id', 'tahun_ajaran', 'semester', 'angkatan', 'ekskul_id', 'tanggal'],
        'anggota_ekskul' => ['tenant_id', 'tahun_ajaran', 'semester', 'angkatan', 'user_id'],
    ];

    public function up(): void
    {
        $this->ensureAcademicColumns();
        $this->backfillPeriods();
        $this->backfillCohorts();
        $this->addIndexes();
    }

    public function down(): void
    {
        foreach (array_reverse($this->periodTables) as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                try {
                    $table->dropIndex($this->indexName($tableName));
                } catch (Throwable $e) {
                    // Ignore when the index is absent on older installs.
                }

                foreach (['angkatan', 'semester', 'tahun_ajaran'] as $column) {
                    if (Schema::hasColumn($tableName, $column)) {
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
                if (! Schema::hasColumn($tableName, 'tahun_ajaran')) {
                    $table->text('tahun_ajaran')->nullable();
                }
                if (! Schema::hasColumn($tableName, 'semester')) {
                    $table->text('semester')->nullable();
                }
                if (! Schema::hasColumn($tableName, 'angkatan')) {
                    $table->text('angkatan')->nullable();
                }
            });
        }
    }

    private function backfillPeriods(): void
    {
        $current = AcademicPeriod::current();
        $settingsColumns = ['tahun_ajaran', 'semester_aktif'];
        if (Schema::hasTable('settings') && Schema::hasColumn('settings', 'tenant_id')) {
            array_unshift($settingsColumns, 'tenant_id');
        }

        $settingsRows = Schema::hasTable('settings')
            ? DB::table('settings')->get($settingsColumns)
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
                if (
                    ! Schema::hasTable($tableName)
                    || ! Schema::hasColumn($tableName, 'tahun_ajaran')
                    || ! Schema::hasColumn($tableName, 'semester')
                ) {
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
        if (! Schema::hasTable('profiles') || ! Schema::hasColumn('profiles', 'angkatan')) {
            return;
        }

        foreach ($this->periodTables as $tableName) {
            if (
                ! Schema::hasTable($tableName)
                || ! Schema::hasColumn($tableName, 'user_id')
                || ! Schema::hasColumn($tableName, 'angkatan')
            ) {
                continue;
            }

            $tableTenantColumn = Schema::hasColumn($tableName, 'tenant_id');
            $profileTenantColumn = Schema::hasColumn('profiles', 'tenant_id');

            $query = DB::table($tableName.' as target')
                ->join('profiles as p', function ($join) use ($tableTenantColumn, $profileTenantColumn) {
                    $join->on('p.id', '=', 'target.user_id');
                    if ($tableTenantColumn && $profileTenantColumn) {
                        $join->on('p.tenant_id', '=', 'target.tenant_id');
                    }
                })
                ->whereNotNull('p.angkatan')
                ->where('p.angkatan', '!=', '')
                ->where(function ($inner) {
                    $inner->whereNull('target.angkatan')->orWhere('target.angkatan', '');
                });

            $selectColumns = ['target.id as id', 'p.angkatan as angkatan'];
            if ($tableTenantColumn) {
                $selectColumns[] = 'target.tenant_id as tenant_id';
            }

            do {
                $rows = (clone $query)
                    ->select($selectColumns)
                    ->orderBy('target.id')
                    ->limit(500)
                    ->get();

                $updatedAny = false;
                foreach ($rows as $row) {
                    $update = DB::table($tableName)->where('id', $row->id);
                    if ($tableTenantColumn && isset($row->tenant_id)) {
                        $update->where('tenant_id', $row->tenant_id);
                    }
                    $update->update(['angkatan' => $row->angkatan]);
                    $updatedAny = true;
                }
            } while ($updatedAny && $rows->count() === 500);
        }
    }

    private function addIndexes(): void
    {
        foreach ($this->indexDefinitions as $tableName => $columns) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            $availableColumns = array_values(array_filter(
                $columns,
                fn ($column) => Schema::hasColumn($tableName, $column)
            ));

            if (! in_array('tahun_ajaran', $availableColumns, true) || ! in_array('semester', $availableColumns, true)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($availableColumns, $tableName) {
                $table->index($availableColumns, $this->indexName($tableName));
            });
        }
    }

    private function indexName(string $tableName): string
    {
        return $tableName.'_academic_period_idx';
    }
};
