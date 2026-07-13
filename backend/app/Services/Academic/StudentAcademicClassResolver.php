<?php

namespace App\Services\Academic;

use App\Support\AcademicPeriod;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class StudentAcademicClassResolver
{
    public function resolve(
        string $tenantId,
        string $studentId,
        ?string $requestedYear,
        ?string $requestedSemester,
        ?string $currentClass,
        ?string $activeYear
    ): ?string {
        $requestedYear = AcademicPeriod::normalizeAcademicYear($requestedYear);
        $activeYear = AcademicPeriod::normalizeAcademicYear($activeYear);
        $currentClass = trim((string) $currentClass);

        if (! $requestedYear || $requestedYear === $activeYear) {
            return $currentClass !== '' ? $currentClass : null;
        }
        if (! Schema::hasTable('student_class_histories')) {
            return null;
        }

        $query = DB::table('student_class_histories')
            ->where('tenant_id', $tenantId)
            ->where('student_id', $studentId)
            ->where('tahun_ajaran', $requestedYear)
            ->whereIn('status', ['active', 'nonaktif', 'mutasi'])
            ->whereNotNull('class_id')
            ->where('class_id', '<>', '');

        $requestedSemester = AcademicPeriod::normalizeSemester($requestedSemester);
        if ($requestedSemester && Schema::hasColumn('student_class_histories', 'semester')) {
            $query->where('semester', $requestedSemester);
        }
        if (Schema::hasColumn('student_class_histories', 'valid_from')) {
            $query->orderByDesc('valid_from');
        }
        $query->orderByDesc('created_at');

        $classId = trim((string) $query->value('class_id'));

        return $classId !== '' ? $classId : null;
    }
}
