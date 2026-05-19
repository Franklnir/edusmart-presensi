<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private string $tableName = 'ekskul';

    public function up(): void
    {
        if (! Schema::hasTable($this->tableName)) {
            return;
        }

        $this->ensureColumns();
        $this->backfillCurrentPeriod();
        $this->addIndex();
    }

    public function down(): void
    {
        if (! Schema::hasTable($this->tableName)) {
            return;
        }

        Schema::table($this->tableName, function (Blueprint $table) {
            try {
                $table->dropIndex($this->indexName());
            } catch (Throwable $e) {
                // Older installs may not have the index yet.
            }

            foreach (['semester', 'tahun_ajaran'] as $column) {
                if (Schema::hasColumn($this->tableName, $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    private function ensureColumns(): void
    {
        Schema::table($this->tableName, function (Blueprint $table) {
            if (! Schema::hasColumn($this->tableName, 'tahun_ajaran')) {
                $table->text('tahun_ajaran')->nullable();
            }
            if (! Schema::hasColumn($this->tableName, 'semester')) {
                $table->text('semester')->nullable();
            }
        });
    }

    private function backfillCurrentPeriod(): void
    {
        $current = AcademicPeriod::current();
        $settingsRows = $this->settingsRows($current);

        foreach ($settingsRows as $settings) {
            $period = AcademicPeriod::fromSettings($settings);
            $tenantId = $settings->tenant_id ?? null;

            $query = DB::table($this->tableName)
                ->where(function ($inner) {
                    $inner->whereNull('tahun_ajaran')
                        ->orWhere('tahun_ajaran', '')
                        ->orWhereNull('semester')
                        ->orWhere('semester', '');
                });

            if ($tenantId && Schema::hasColumn($this->tableName, 'tenant_id')) {
                $query->where('tenant_id', $tenantId);
            }

            $query->update([
                'tahun_ajaran' => $period['tahun_ajaran'],
                'semester' => $period['semester'],
            ]);
        }
    }

    private function settingsRows(array $current)
    {
        if (! Schema::hasTable('settings')) {
            return collect([(object) [
                'tenant_id' => null,
                'tahun_ajaran' => $current['tahun_ajaran'],
                'semester_aktif' => $current['semester'],
            ]]);
        }

        $columns = array_values(array_filter([
            Schema::hasColumn('settings', 'tenant_id') ? 'tenant_id' : null,
            Schema::hasColumn('settings', 'tahun_ajaran') ? 'tahun_ajaran' : null,
            Schema::hasColumn('settings', 'semester_aktif') ? 'semester_aktif' : null,
            Schema::hasColumn('settings', 'periode_mulai') ? 'periode_mulai' : null,
            Schema::hasColumn('settings', 'periode_selesai') ? 'periode_selesai' : null,
            Schema::hasColumn('settings', 'periode_ganjil_mulai') ? 'periode_ganjil_mulai' : null,
            Schema::hasColumn('settings', 'periode_ganjil_selesai') ? 'periode_ganjil_selesai' : null,
            Schema::hasColumn('settings', 'periode_genap_mulai') ? 'periode_genap_mulai' : null,
            Schema::hasColumn('settings', 'periode_genap_selesai') ? 'periode_genap_selesai' : null,
        ]));

        if (empty($columns)) {
            return collect([(object) [
                'tenant_id' => null,
                'tahun_ajaran' => $current['tahun_ajaran'],
                'semester_aktif' => $current['semester'],
            ]]);
        }

        $rows = DB::table('settings')->get($columns);

        return $rows->isEmpty()
            ? collect([(object) [
                'tenant_id' => null,
                'tahun_ajaran' => $current['tahun_ajaran'],
                'semester_aktif' => $current['semester'],
            ]])
            : $rows;
    }

    private function addIndex(): void
    {
        $columns = array_values(array_filter([
            Schema::hasColumn($this->tableName, 'tenant_id') ? 'tenant_id' : null,
            Schema::hasColumn($this->tableName, 'tahun_ajaran') ? 'tahun_ajaran' : null,
            Schema::hasColumn($this->tableName, 'semester') ? 'semester' : null,
            Schema::hasColumn($this->tableName, 'nama') ? 'nama' : null,
        ]));

        if (! in_array('tahun_ajaran', $columns, true) || ! in_array('semester', $columns, true)) {
            return;
        }

        Schema::table($this->tableName, function (Blueprint $table) use ($columns) {
            $table->index($columns, $this->indexName());
        });
    }

    private function indexName(): string
    {
        return 'ekskul_academic_period_idx';
    }
};
