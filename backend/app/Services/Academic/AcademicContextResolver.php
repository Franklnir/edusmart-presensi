<?php

namespace App\Services\Academic;

use App\Support\AcademicPeriod;
use Illuminate\Http\Request;

class AcademicContextResolver
{
    public function __construct(
        private readonly AcademicPeriodLifecycleService $lifecycle,
        private readonly AcademicCorrectionService $corrections
    ) {}

    public function forRead(Request $request, string $tenantId): array
    {
        $active = $this->lifecycle->currentContext($tenantId);
        $year = AcademicPeriod::normalizeAcademicYear(
            $request->query('tahun_ajaran', $request->input('tahun_ajaran'))
        ) ?: ($active['tahun_ajaran'] ?? null);
        $semester = AcademicPeriod::normalizeSemester(
            $request->query('semester', $request->input('semester'))
        ) ?: ($active['semester'] ?? null);
        $mode = $year === ($active['tahun_ajaran'] ?? null)
            && $semester === ($active['semester'] ?? null)
                ? 'active'
                : 'archive';

        return array_merge([
            'tenant_id' => $tenantId,
            'tahun_ajaran' => $year,
            'semester' => $semester,
            'mode' => $mode,
        ], $this->lifecycle->normalizedIds($tenantId, $year, $semester));
    }

    public function forMutation(Request $request, string $tenantId, string $table): array
    {
        $sessionId = trim((string) $request->header('X-Academic-Correction-Session'));
        if ($sessionId !== '') {
            $context = $this->corrections->validateForMutation(
                $sessionId,
                $tenantId,
                (string) ($request->user()?->id ?? ''),
                $table
            );
            if ($context === null) {
                throw new \DomainException('Sesi koreksi tidak valid, kedaluwarsa, atau tidak mencakup data ini.');
            }

            return $context;
        }

        return $this->lifecycle->currentContext($tenantId);
    }
}
