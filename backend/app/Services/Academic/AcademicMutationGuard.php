<?php

namespace App\Services\Academic;

use App\Support\AcademicPeriod;
use App\Support\AcademicScopeRegistry;
use Illuminate\Http\Request;

class AcademicMutationGuard
{
    public function __construct(
        private readonly AcademicContextResolver $contextResolver
    ) {}

    public function authorize(
        Request $request,
        string $table,
        string $action,
        mixed $payload,
        mixed $filters,
        string $tenantId
    ): array {
        if ($action === 'select' || ! AcademicScopeRegistry::isDirectlyMutablePeriodTable($table)) {
            return ['allowed' => true, 'context' => null, 'mode' => 'none'];
        }

        try {
            $context = $this->contextResolver->forMutation($request, $tenantId, $table);
        } catch (\DomainException) {
            return $this->deny(
                'Sesi koreksi tidak valid, sudah berakhir, atau tidak mencakup data ini.',
                'academic_correction_session_invalid',
                409
            );
        }
        $correction = ($context['mode'] ?? 'active') === 'correction' ? $context : null;
        if ($correction !== null && in_array($action, ['insert', 'upsert'], true)) {
            return $this->deny(
                'Sesi koreksi arsip hanya mengizinkan perubahan pada data yang sudah ada.',
                'academic_archive_create_forbidden',
                409
            );
        }

        $mode = $correction ? 'correction' : 'active';
        if (! ($context['tahun_ajaran'] ?? null)) {
            return $this->deny('Periode akademik aktif belum tersedia.', 'academic_period_missing', 409);
        }

        $yearColumn = AcademicScopeRegistry::academicYearColumn($table);
        $explicitYears = $this->valuesForColumn($filters, $payload, $yearColumn);
        if ($explicitYears !== [] && $this->containsDifferentYear($explicitYears, (string) $context['tahun_ajaran'])) {
            return $this->deny(
                $correction
                    ? 'Filter tahun ajaran tidak sesuai dengan sesi koreksi.'
                    : 'Data periode arsip terkunci. Buka sesi koreksi resmi untuk melakukan perubahan.',
                'academic_period_locked',
                409
            );
        }

        if (AcademicScopeRegistry::isTermScoped($table)) {
            $explicitSemesters = $this->valuesForColumn($filters, $payload, 'semester');
            if (
                $explicitSemesters !== []
                && $this->containsDifferentSemester($explicitSemesters, (string) ($context['semester'] ?? ''))
            ) {
                return $this->deny(
                    $correction
                        ? 'Filter semester tidak sesuai dengan sesi koreksi.'
                        : 'Data semester arsip terkunci. Buka sesi koreksi resmi untuk melakukan perubahan.',
                    'academic_period_locked',
                    409
                );
            }
        }

        return [
            'allowed' => true,
            'context' => $context,
            'mode' => $mode,
        ];
    }

    public function applyQueryScope($query, string $table, ?array $context): void
    {
        if (! $context || ! AcademicScopeRegistry::isDirectlyMutablePeriodTable($table)) {
            return;
        }

        $query->where(AcademicScopeRegistry::academicYearColumn($table), $context['tahun_ajaran']);
        if (AcademicScopeRegistry::isTermScoped($table)) {
            $query->where('semester', $context['semester']);
        }
    }

    private function valuesForColumn(mixed $filters, mixed $payload, string $column): array
    {
        $values = [];
        if (is_array($filters)) {
            foreach (['eq', 'in'] as $operator) {
                $raw = $filters[$operator][$column] ?? null;
                foreach (is_array($raw) ? $raw : [$raw] as $value) {
                    if ($value !== null && $value !== '') {
                        $values[] = $value;
                    }
                }
            }
        }

        $rows = is_array($payload) && array_is_list($payload) ? $payload : [$payload];
        foreach ($rows as $row) {
            if (is_array($row) && array_key_exists($column, $row) && $row[$column] !== null && $row[$column] !== '') {
                $values[] = $row[$column];
            }
        }

        return array_values(array_unique($values, SORT_REGULAR));
    }

    private function containsDifferentYear(array $values, string $expected): bool
    {
        foreach ($values as $value) {
            if (AcademicPeriod::normalizeAcademicYear($value) !== $expected) {
                return true;
            }
        }

        return false;
    }

    private function containsDifferentSemester(array $values, string $expected): bool
    {
        foreach ($values as $value) {
            if (AcademicPeriod::normalizeSemester($value) !== $expected) {
                return true;
            }
        }

        return false;
    }

    private function deny(string $message, string $code, int $status): array
    {
        return [
            'allowed' => false,
            'message' => $message,
            'code' => $code,
            'status' => $status,
        ];
    }
}
