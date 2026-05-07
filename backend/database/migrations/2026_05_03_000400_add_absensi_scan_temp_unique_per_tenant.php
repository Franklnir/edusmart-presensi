<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private string $tableName = 'absensi_scan_temp';

    private string $indexName = 'absensi_scan_temp_unique_tenant_session';

    public function up(): void
    {
        if (! Schema::hasTable($this->tableName)) {
            return;
        }

        $columns = $this->uniqueColumns();
        if (count($columns) < 3) {
            return;
        }

        $this->removeDuplicateRows($columns);

        Schema::table($this->tableName, function (Blueprint $table) use ($columns) {
            $table->unique($columns, $this->indexName);
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable($this->tableName)) {
            return;
        }

        try {
            Schema::table($this->tableName, function (Blueprint $table) {
                $table->dropUnique($this->indexName);
            });
        } catch (\Throwable $e) {
            // Index mungkin tidak pernah dibuat di database lama.
        }
    }

    private function uniqueColumns(): array
    {
        $columns = ['tanggal', 'siswa_id', 'sesi'];
        if (Schema::hasColumn($this->tableName, 'tenant_id')) {
            array_unshift($columns, 'tenant_id');
        }

        return array_values(array_filter(
            $columns,
            fn (string $column) => Schema::hasColumn($this->tableName, $column)
        ));
    }

    private function removeDuplicateRows(array $columns): void
    {
        $groups = DB::table($this->tableName)
            ->select($columns)
            ->selectRaw('COUNT(*) as duplicate_count')
            ->groupBy($columns)
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($groups as $group) {
            $query = DB::table($this->tableName);

            foreach ($columns as $column) {
                $value = $group->{$column} ?? null;
                if ($value === null) {
                    $query->whereNull($column);
                } else {
                    $query->where($column, $value);
                }
            }

            $ids = $query
                ->orderByDesc('scan_at')
                ->orderByDesc('id')
                ->pluck('id')
                ->all();

            $deleteIds = array_slice($ids, 1);
            if (! empty($deleteIds)) {
                DB::table($this->tableName)->whereIn('id', $deleteIds)->delete();
            }
        }
    }
};
