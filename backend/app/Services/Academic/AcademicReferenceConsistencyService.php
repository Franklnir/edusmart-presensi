<?php

namespace App\Services\Academic;

use App\Support\AcademicScopeRegistry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AcademicReferenceConsistencyService
{
    public function inspect(?string $tenantId = null): array
    {
        $tables = array_values(array_unique(array_merge(
            AcademicScopeRegistry::tablesFor(AcademicScopeRegistry::YEAR),
            AcademicScopeRegistry::tablesFor(AcademicScopeRegistry::TERM),
            AcademicScopeRegistry::tablesFor(AcademicScopeRegistry::PARENT_SNAPSHOT)
        )));
        $results = [];

        foreach ($tables as $table) {
            if (! $this->isInspectable($table)) {
                continue;
            }

            $termScoped = Schema::hasColumn($table, 'semester')
                && Schema::hasColumn($table, 'academic_term_id');
            $metrics = [
                'rows_with_legacy_period' => $this->legacyRows($table, $tenantId)->count(),
                'missing_academic_year_id' => $this->legacyRows($table, $tenantId)
                    ->whereNull('academic_year_id')
                    ->count(),
                'invalid_or_mismatched_year' => $this->yearMismatchCount($table, $tenantId),
                'missing_academic_term_id' => $termScoped
                    ? $this->legacyTermRows($table, $tenantId)->whereNull('academic_term_id')->count()
                    : 0,
                'invalid_or_mismatched_term' => $termScoped
                    ? $this->termMismatchCount($table, $tenantId)
                    : 0,
            ];
            $metrics['issues'] = $metrics['missing_academic_year_id']
                + $metrics['invalid_or_mismatched_year']
                + $metrics['missing_academic_term_id']
                + $metrics['invalid_or_mismatched_term'];
            $results[$table] = $metrics;
        }

        $issueCount = array_sum(array_column(array_values($results), 'issues'));

        return [
            'tenant_id' => $tenantId,
            'checked_at' => now()->toISOString(),
            'tables_checked' => count($results),
            'issue_count' => $issueCount,
            'ready_for_id_reads' => $issueCount === 0,
            'tables' => $results,
        ];
    }

    private function isInspectable(string $table): bool
    {
        $yearColumn = AcademicScopeRegistry::academicYearColumn($table);

        return Schema::hasTable($table)
            && Schema::hasColumn($table, 'tenant_id')
            && Schema::hasColumn($table, $yearColumn)
            && Schema::hasColumn($table, 'academic_year_id');
    }

    private function legacyRows(string $table, ?string $tenantId)
    {
        $yearColumn = AcademicScopeRegistry::academicYearColumn($table);
        $query = DB::table($table)
            ->whereNotNull($yearColumn)
            ->where($yearColumn, '<>', '');

        return $this->forTenant($query, $tenantId);
    }

    private function legacyTermRows(string $table, ?string $tenantId)
    {
        return $this->legacyRows($table, $tenantId)
            ->whereNotNull('semester')
            ->where('semester', '<>', '');
    }

    private function yearMismatchCount(string $table, ?string $tenantId): int
    {
        $yearColumn = AcademicScopeRegistry::academicYearColumn($table);
        $query = DB::table($table.' as source')
            ->leftJoin('academic_years as year_ref', function ($join) {
                $join->on('year_ref.id', '=', 'source.academic_year_id')
                    ->on('year_ref.tenant_id', '=', 'source.tenant_id');
            })
            ->whereNotNull('source.'.$yearColumn)
            ->where('source.'.$yearColumn, '<>', '')
            ->whereNotNull('source.academic_year_id')
            ->where(function ($where) use ($yearColumn) {
                $where->whereNull('year_ref.id')
                    ->orWhereRaw('LOWER(TRIM(year_ref.label)) <> LOWER(TRIM(source.'.$yearColumn.'))');
            });

        return $this->forTenant($query, $tenantId, 'source.tenant_id')->count();
    }

    private function termMismatchCount(string $table, ?string $tenantId): int
    {
        $yearColumn = AcademicScopeRegistry::academicYearColumn($table);
        $query = DB::table($table.' as source')
            ->leftJoin('academic_terms as term_ref', function ($join) {
                $join->on('term_ref.id', '=', 'source.academic_term_id')
                    ->on('term_ref.tenant_id', '=', 'source.tenant_id');
            })
            ->whereNotNull('source.'.$yearColumn)
            ->where('source.'.$yearColumn, '<>', '')
            ->whereNotNull('source.semester')
            ->where('source.semester', '<>', '')
            ->whereNotNull('source.academic_term_id')
            ->where(function ($where) {
                $where->whereNull('term_ref.id')
                    ->orWhereRaw('LOWER(TRIM(term_ref.semester)) <> LOWER(TRIM(source.semester))')
                    ->orWhereColumn('term_ref.academic_year_id', '<>', 'source.academic_year_id');
            });

        return $this->forTenant($query, $tenantId, 'source.tenant_id')->count();
    }

    private function forTenant($query, ?string $tenantId, string $column = 'tenant_id')
    {
        $tenantId = trim((string) $tenantId);
        if ($tenantId !== '') {
            $query->where($column, $tenantId);
        }

        return $query;
    }
}
