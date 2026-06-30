<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    private array $periodTables = [
        'struktur_sekolah',
        'kelas_struktur',
        'organisasi',
        'organisasi_anggota',
    ];

    public function up(): void
    {
        foreach ($this->periodTables as $tableName) {
            $this->addPeriodColumns($tableName);
        }

        $this->ensureKelasStrukturSurrogateKey();
        $this->backfillPeriodColumns();
        $this->addIndexes();
    }

    public function down(): void
    {
        $this->dropIndexes();

        foreach ($this->periodTables as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                if (Schema::hasColumn($tableName, 'tahun_ajaran')) {
                    $table->dropColumn('tahun_ajaran');
                }
                if (Schema::hasColumn($tableName, 'semester')) {
                    $table->dropColumn('semester');
                }
            });
        }
    }

    private function addPeriodColumns(string $tableName): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($tableName) {
            if (! Schema::hasColumn($tableName, 'tahun_ajaran')) {
                $table->text('tahun_ajaran')->nullable();
            }
            if (! Schema::hasColumn($tableName, 'semester')) {
                $table->text('semester')->nullable();
            }
        });
    }

    private function ensureKelasStrukturSurrogateKey(): void
    {
        if (! Schema::hasTable('kelas_struktur')) {
            return;
        }

        if (! Schema::hasColumn('kelas_struktur', 'id')) {
            Schema::table('kelas_struktur', function (Blueprint $table) {
                $table->uuid('id')->nullable();
            });
        }

        DB::table('kelas_struktur')
            ->whereNull('id')
            ->orderBy('kelas_id')
            ->get(['kelas_id'])
            ->each(function ($row) {
                DB::table('kelas_struktur')
                    ->where('kelas_id', $row->kelas_id)
                    ->whereNull('id')
                    ->update(['id' => (string) Str::uuid()]);
            });

        if (DB::getDriverName() === 'pgsql') {
            try {
                DB::statement('ALTER TABLE kelas_struktur DROP CONSTRAINT IF EXISTS kelas_struktur_pkey');
            } catch (Throwable $e) {
                //
            }

            try {
                DB::statement('ALTER TABLE kelas_struktur ALTER COLUMN id SET NOT NULL');
            } catch (Throwable $e) {
                //
            }

            try {
                DB::statement('ALTER TABLE kelas_struktur ADD CONSTRAINT kelas_struktur_pkey PRIMARY KEY (id)');
            } catch (Throwable $e) {
                //
            }
        }
    }

    private function backfillPeriodColumns(): void
    {
        if (! Schema::hasTable('settings')) {
            $fallback = AcademicPeriod::current();
            foreach ($this->periodTables as $tableName) {
                $this->backfillTableWithPeriod($tableName, $fallback['tahun_ajaran'], $fallback['semester']);
            }

            return;
        }

        $settingsByTenant = DB::table('settings')
            ->select(['tenant_id', 'tahun_ajaran', 'semester_aktif'])
            ->whereNotNull('tenant_id')
            ->get()
            ->keyBy(fn ($row) => (string) ($row->tenant_id ?? ''));

        $fallback = AcademicPeriod::current();
        foreach ($this->periodTables as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            if (! Schema::hasColumn($tableName, 'tenant_id')) {
                $this->backfillTableWithPeriod($tableName, $fallback['tahun_ajaran'], $fallback['semester']);
                continue;
            }

            DB::table($tableName)
                ->select(['tenant_id'])
                ->where(function ($query) {
                    $query->whereNull('tahun_ajaran')
                        ->orWhere('tahun_ajaran', '');
                })
                ->groupBy('tenant_id')
                ->orderBy('tenant_id')
                ->chunk(100, function ($rows) use ($tableName, $settingsByTenant, $fallback) {
                    foreach ($rows as $row) {
                        $tenantId = (string) ($row->tenant_id ?? '');
                        $settings = $settingsByTenant->get($tenantId);
                        $period = $settings
                            ? AcademicPeriod::fromSettings($settings)
                            : $fallback;

                        DB::table($tableName)
                            ->where('tenant_id', $tenantId)
                            ->where(function ($query) {
                                $query->whereNull('tahun_ajaran')
                                    ->orWhere('tahun_ajaran', '');
                            })
                            ->update([
                                'tahun_ajaran' => $period['tahun_ajaran'],
                                'semester' => $period['semester'],
                            ]);
                    }
                });
        }
    }

    private function backfillTableWithPeriod(string $tableName, string $tahunAjaran, string $semester): void
    {
        if (! Schema::hasTable($tableName) || ! Schema::hasColumn($tableName, 'tahun_ajaran')) {
            return;
        }

        DB::table($tableName)
            ->where(function ($query) {
                $query->whereNull('tahun_ajaran')
                    ->orWhere('tahun_ajaran', '');
            })
            ->update([
                'tahun_ajaran' => $tahunAjaran,
                'semester' => $semester,
            ]);
    }

    private function addIndexes(): void
    {
        $this->index('struktur_sekolah', ['tenant_id', 'tahun_ajaran', 'jabatan'], 'struktur_tenant_period_jabatan_idx');
        $this->index('organisasi', ['tenant_id', 'tahun_ajaran', 'nama'], 'org_tenant_period_nama_idx');
        $this->index('organisasi_anggota', ['tenant_id', 'organisasi_id', 'tahun_ajaran', 'siswa_id'], 'organgg_tenant_org_period_siswa_idx');

        if ($this->canCreateIndex('kelas_struktur', ['tenant_id', 'kelas_id', 'tahun_ajaran'])) {
            try {
                Schema::table('kelas_struktur', function (Blueprint $table) {
                    $table->unique(['tenant_id', 'kelas_id', 'tahun_ajaran'], 'kstr_tenant_kelas_period_unique');
                });
            } catch (Throwable $e) {
                //
            }
        }
    }

    private function dropIndexes(): void
    {
        $this->drop('struktur_sekolah', 'struktur_tenant_period_jabatan_idx');
        $this->drop('organisasi', 'org_tenant_period_nama_idx');
        $this->drop('organisasi_anggota', 'organgg_tenant_org_period_siswa_idx');
        $this->drop('kelas_struktur', 'kstr_tenant_kelas_period_unique');
    }

    private function index(string $tableName, array $columns, string $indexName): void
    {
        if (! $this->canCreateIndex($tableName, $columns)) {
            return;
        }

        try {
            Schema::table($tableName, function (Blueprint $table) use ($columns, $indexName) {
                $table->index($columns, $indexName);
            });
        } catch (Throwable $e) {
            //
        }
    }

    private function drop(string $tableName, string $indexName): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        try {
            Schema::table($tableName, function (Blueprint $table) use ($indexName) {
                $table->dropIndex($indexName);
            });
        } catch (Throwable $e) {
            //
        }
    }

    private function canCreateIndex(string $tableName, array $columns): bool
    {
        if (! Schema::hasTable($tableName)) {
            return false;
        }

        foreach ($columns as $column) {
            if (! Schema::hasColumn($tableName, $column)) {
                return false;
            }
        }

        return true;
    }
};
