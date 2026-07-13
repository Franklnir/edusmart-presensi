<?php

namespace App\Services\Academic;

use App\Support\AcademicPeriod;
use App\Support\AcademicScopeRegistry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class AcademicPeriodLifecycleService
{
    public function ready(): bool
    {
        return Schema::hasTable('academic_years') && Schema::hasTable('academic_terms');
    }

    public function synchronizeTenant(string $tenantId): array
    {
        if ($tenantId === '' || ! $this->ready()) {
            return [];
        }

        $settings = Schema::hasTable('settings')
            ? DB::table('settings')->where('tenant_id', $tenantId)->orderBy('id')->first()
            : null;
        $current = $this->currentFromSettingsReferences($tenantId, $settings);
        $legacyYear = AcademicPeriod::normalizeAcademicYear($settings->tahun_ajaran ?? null);
        $legacySemester = AcademicPeriod::normalizeSemester($settings->semester_aktif ?? null);

        if ($current === [] && $legacyYear && $legacySemester) {
            $current = [
                'tahun_ajaran' => $legacyYear,
                'semester' => $legacySemester,
            ];
        }

        $periods = $this->discoverLegacyPeriods($tenantId);
        if ($legacyYear) {
            $periods[$legacyYear][$legacySemester ?: AcademicPeriod::SEMESTER_GANJIL] = true;
        }

        ksort($periods, SORT_NATURAL);
        foreach (array_keys($periods) as $year) {
            $this->ensureYearWithTerms(
                $tenantId,
                $year,
                $current['tahun_ajaran'] ?? $legacyYear,
                $current['semester'] ?? $legacySemester,
                $settings
            );
        }

        if ($current === [] && $legacyYear && $legacySemester) {
            $current = $this->setInitialActiveReferences($tenantId, $settings, $legacyYear, $legacySemester);
        } elseif ($current !== []) {
            $this->ensureSettingsReferences($tenantId, $settings, $current);
        }

        return $current ?: $this->currentContext($tenantId, false);
    }

    public function currentContext(string $tenantId, bool $synchronize = true): array
    {
        if ($synchronize) {
            $synced = $this->synchronizeTenant($tenantId);
            if ($synced !== []) {
                return $this->hydrateContextIds($tenantId, $synced);
            }
        }

        if (! $this->ready()) {
            return $this->legacyCurrentContext($tenantId);
        }

        $year = DB::table('academic_years')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->first();
        $term = DB::table('academic_terms')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->first();

        if (! $year || ! $term || (string) $term->academic_year_id !== (string) $year->id) {
            return $this->legacyCurrentContext($tenantId);
        }

        return $this->contextPayload($year, $term);
    }

    public function listForTenant(string $tenantId): array
    {
        $current = $this->synchronizeTenant($tenantId);
        if (! $this->ready()) {
            return [
                'current' => $current,
                'years' => [],
            ];
        }

        $years = DB::table('academic_years')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('label')
            ->get()
            ->map(function ($year) use ($tenantId) {
                $terms = DB::table('academic_terms')
                    ->where('tenant_id', $tenantId)
                    ->where('academic_year_id', $year->id)
                    ->orderByRaw("CASE WHEN semester = 'Ganjil' THEN 0 ELSE 1 END")
                    ->get()
                    ->map(fn ($term) => $this->termPayload($term))
                    ->values()
                    ->all();

                return [
                    'id' => (string) $year->id,
                    'label' => (string) $year->label,
                    'starts_at' => $year->starts_at,
                    'ends_at' => $year->ends_at,
                    'status' => (string) $year->status,
                    'lock_version' => (int) ($year->lock_version ?? 1),
                    'terms' => $terms,
                ];
            })
            ->values()
            ->all();

        return [
            'current' => $this->hydrateContextIds($tenantId, $current),
            'years' => $years,
        ];
    }

    public function validateActivation(string $tenantId, array $period): ?array
    {
        $year = AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        $semester = AcademicPeriod::normalizeSemester($period['semester'] ?? $period['semester_aktif'] ?? null);
        if (! $year || ! $semester) {
            return $this->error('Tahun ajaran atau semester belum valid.', 'academic_period_invalid', 422);
        }

        $rangeError = $this->validateRanges($year, $period);
        if ($rangeError !== null) {
            return $rangeError;
        }

        $current = $this->currentContext($tenantId);
        $targetYear = $this->yearByLabel($tenantId, $year);
        $targetTerm = $targetYear ? $this->termBySemester($tenantId, (string) $targetYear->id, $semester) : null;
        $isCurrent = ($current['tahun_ajaran'] ?? null) === $year
            && ($current['semester'] ?? null) === $semester;

        if (! $isCurrent && ($targetYear?->status === 'closed' || $targetTerm?->status === 'closed')) {
            return $this->error(
                'Periode yang sudah ditutup hanya dapat dibuka sebagai arsip atau melalui sesi koreksi.',
                'academic_period_closed',
                409
            );
        }

        $currentYear = AcademicPeriod::normalizeAcademicYear($current['tahun_ajaran'] ?? null);
        if (! $isCurrent && $currentYear && strcmp($year, $currentYear) < 0) {
            return $this->error(
                'Periode lampau tidak dapat diaktifkan kembali. Gunakan filter arsip untuk melihat data lama.',
                'academic_period_closed',
                409
            );
        }

        return null;
    }

    public function impactPreview(string $tenantId, array $period): array
    {
        $validation = $this->validateActivation($tenantId, $period);
        if ($validation !== null) {
            return ['valid' => false, 'message' => $validation];
        }

        $year = (string) AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        $semester = (string) AcademicPeriod::normalizeSemester(
            $period['semester'] ?? $period['semester_aktif'] ?? null
        );
        $current = $this->currentContext($tenantId);
        $ranges = $this->normalizedRanges($year, $period);
        $affectedRows = [];

        foreach (array_merge(
            AcademicScopeRegistry::tablesFor(AcademicScopeRegistry::YEAR),
            AcademicScopeRegistry::tablesFor(AcademicScopeRegistry::TERM)
        ) as $tableName) {
            $yearColumn = AcademicScopeRegistry::academicYearColumn($tableName);
            if (
                ! Schema::hasTable($tableName)
                || ! Schema::hasColumn($tableName, 'tenant_id')
                || ! Schema::hasColumn($tableName, $yearColumn)
            ) {
                continue;
            }

            $query = DB::table($tableName)
                ->where('tenant_id', $tenantId)
                ->where($yearColumn, $current['tahun_ajaran'] ?? '');
            if (
                AcademicScopeRegistry::isTermScoped($tableName)
                && Schema::hasColumn($tableName, 'semester')
            ) {
                $query->where('semester', $current['semester'] ?? '');
            }
            $affectedRows[$tableName] = $query->count();
        }

        return [
            'valid' => true,
            'current' => $current,
            'target' => [
                'tahun_ajaran' => $year,
                'semester' => $semester,
                'periode_ganjil_mulai' => $ranges['ganjil_start'],
                'periode_ganjil_selesai' => $ranges['ganjil_end'],
                'periode_genap_mulai' => $ranges['genap_start'],
                'periode_genap_selesai' => $ranges['genap_end'],
            ],
            'changes' => [
                'year' => ($current['tahun_ajaran'] ?? null) !== $year,
                'semester' => ($current['semester'] ?? null) !== $semester,
                'dates' => $this->rangesDifferFromStoredTerm($tenantId, $year, $semester, $ranges),
            ],
            'affected_rows_becoming_archive' => $affectedRows,
            'requires_confirmation' => true,
        ];
    }

    public function activate(
        string $tenantId,
        array $period,
        ?string $actorId = null,
        ?object $settings = null
    ): array {
        if (DB::transactionLevel() === 0) {
            return DB::transaction(fn () => $this->activate($tenantId, $period, $actorId, $settings));
        }

        if (Schema::hasTable('tenants')) {
            DB::table('tenants')->where('id', $tenantId)->lockForUpdate()->first(['id']);
        }
        if (Schema::hasTable('settings')) {
            DB::table('settings')->where('tenant_id', $tenantId)->lockForUpdate()->first(['id']);
        }
        if ($this->ready()) {
            DB::table('academic_years')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->lockForUpdate()
                ->get(['id']);
        }

        $validation = $this->validateActivation($tenantId, $period);
        if ($validation !== null) {
            throw new \DomainException(json_encode($validation, JSON_UNESCAPED_SLASHES));
        }

        $year = (string) AcademicPeriod::normalizeAcademicYear($period['tahun_ajaran'] ?? null);
        $semester = (string) AcademicPeriod::normalizeSemester($period['semester'] ?? $period['semester_aktif'] ?? null);
        $settings ??= DB::table('settings')->where('tenant_id', $tenantId)->orderBy('id')->first();
        $this->ensureYearWithTerms($tenantId, $year, null, null, (object) array_merge((array) $settings, $period));

        $targetYear = $this->yearByLabel($tenantId, $year);
        $targetTerm = $targetYear ? $this->termBySemester($tenantId, (string) $targetYear->id, $semester) : null;
        if (! $targetYear || ! $targetTerm) {
            throw new \RuntimeException('Periode target gagal disiapkan.');
        }

        $now = now();
        DB::table('academic_terms')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('id', '<>', $targetTerm->id)
            ->update([
                'status' => 'closed',
                'closed_at' => $now,
                'closed_by' => $actorId,
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => $now,
            ]);
        DB::table('academic_years')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('id', '<>', $targetYear->id)
            ->update([
                'status' => 'closed',
                'closed_at' => $now,
                'closed_by' => $actorId,
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => $now,
            ]);

        $ranges = $this->normalizedRanges($year, $period);
        DB::table('academic_years')
            ->where('tenant_id', $tenantId)
            ->where('id', $targetYear->id)
            ->update([
                'starts_at' => $ranges['ganjil_start'],
                'ends_at' => $ranges['genap_end'],
                'status' => 'active',
                'activated_at' => $targetYear->status === 'active' ? $targetYear->activated_at : $now,
                'activated_by' => $actorId,
                'closed_at' => null,
                'closed_by' => null,
                'lock_version' => DB::raw('lock_version + 1'),
                'updated_at' => $now,
            ]);
        foreach ([
            AcademicPeriod::SEMESTER_GANJIL => [$ranges['ganjil_start'], $ranges['ganjil_end']],
            AcademicPeriod::SEMESTER_GENAP => [$ranges['genap_start'], $ranges['genap_end']],
        ] as $termName => [$startsAt, $endsAt]) {
            $term = $this->termBySemester($tenantId, (string) $targetYear->id, $termName);
            $nextStatus = $termName === $semester
                ? 'active'
                : ($semester === AcademicPeriod::SEMESTER_GENAP ? 'closed' : 'draft');
            DB::table('academic_terms')
                ->where('tenant_id', $tenantId)
                ->where('id', $term->id)
                ->update([
                    'starts_at' => $startsAt,
                    'ends_at' => $endsAt,
                    'status' => $nextStatus,
                    'activated_at' => $nextStatus === 'active' ? ($term->activated_at ?: $now) : $term->activated_at,
                    'activated_by' => $nextStatus === 'active' ? $actorId : $term->activated_by,
                    'closed_at' => $nextStatus === 'closed' ? ($term->closed_at ?: $now) : null,
                    'closed_by' => $nextStatus === 'closed' ? $actorId : null,
                    'lock_version' => DB::raw('lock_version + 1'),
                    'updated_at' => $now,
                ]);
        }

        if ($settings && Schema::hasColumn('settings', 'current_academic_year_id')) {
            DB::table('settings')->where('id', $settings->id)->where('tenant_id', $tenantId)->update([
                'current_academic_year_id' => $targetYear->id,
                'current_academic_term_id' => $targetTerm->id,
            ]);
        }

        return $this->contextPayload(
            DB::table('academic_years')->where('id', $targetYear->id)->first(),
            DB::table('academic_terms')->where('id', $targetTerm->id)->first()
        );
    }

    public function normalizedIds(string $tenantId, ?string $year, ?string $semester = null): array
    {
        $year = AcademicPeriod::normalizeAcademicYear($year);
        $semester = AcademicPeriod::normalizeSemester($semester);
        if (! $year || ! $this->ready()) {
            return ['academic_year_id' => null, 'academic_term_id' => null];
        }

        $this->synchronizeTenant($tenantId);
        $yearRow = $this->yearByLabel($tenantId, $year);
        $termRow = ($yearRow && $semester)
            ? $this->termBySemester($tenantId, (string) $yearRow->id, $semester)
            : null;

        return [
            'academic_year_id' => $yearRow?->id,
            'academic_term_id' => $termRow?->id,
        ];
    }

    private function discoverLegacyPeriods(string $tenantId): array
    {
        $periods = [];
        foreach (AcademicScopeRegistry::allRegisteredTables() as $tableName) {
            $yearColumn = AcademicScopeRegistry::academicYearColumn($tableName);
            if (
                ! Schema::hasTable($tableName)
                || ! Schema::hasColumn($tableName, 'tenant_id')
                || ! Schema::hasColumn($tableName, $yearColumn)
            ) {
                continue;
            }

            $columns = [$yearColumn];
            if (Schema::hasColumn($tableName, 'semester')) {
                $columns[] = 'semester';
            }
            $rows = DB::table($tableName)
                ->where('tenant_id', $tenantId)
                ->whereNotNull($yearColumn)
                ->select($columns)
                ->distinct()
                ->get();
            foreach ($rows as $row) {
                $year = AcademicPeriod::normalizeAcademicYear($row->{$yearColumn} ?? null);
                $semester = AcademicPeriod::normalizeSemester($row->semester ?? null);
                if ($year) {
                    $periods[$year][$semester ?: AcademicPeriod::SEMESTER_GANJIL] = true;
                }
            }
        }

        return $periods;
    }

    private function ensureYearWithTerms(
        string $tenantId,
        string $year,
        ?string $activeYear,
        ?string $activeSemester,
        ?object $settings
    ): void {
        $year = (string) AcademicPeriod::normalizeAcademicYear($year);
        if ($year === '') {
            return;
        }
        $ranges = $this->normalizedRanges($year, (array) $settings);
        $yearRow = $this->yearByLabel($tenantId, $year);
        $yearStatus = $this->yearStatus($year, $activeYear);
        $now = now();

        if (! $yearRow) {
            $yearId = (string) Str::uuid();
            DB::table('academic_years')->insert([
                'id' => $yearId,
                'tenant_id' => $tenantId,
                'label' => $year,
                'starts_at' => $ranges['ganjil_start'],
                'ends_at' => $ranges['genap_end'],
                'status' => $yearStatus,
                'activated_at' => $yearStatus === 'active' ? $now : null,
                'closed_at' => $yearStatus === 'closed' ? $now : null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $yearRow = $this->yearByLabel($tenantId, $year);
        }

        foreach ([
            AcademicPeriod::SEMESTER_GANJIL => [$ranges['ganjil_start'], $ranges['ganjil_end']],
            AcademicPeriod::SEMESTER_GENAP => [$ranges['genap_start'], $ranges['genap_end']],
        ] as $semester => [$startsAt, $endsAt]) {
            if ($this->termBySemester($tenantId, (string) $yearRow->id, $semester)) {
                continue;
            }
            $status = $this->termStatus($year, $semester, $activeYear, $activeSemester);
            DB::table('academic_terms')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'academic_year_id' => $yearRow->id,
                'semester' => $semester,
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
                'status' => $status,
                'activated_at' => $status === 'active' ? $now : null,
                'closed_at' => $status === 'closed' ? $now : null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    private function currentFromSettingsReferences(string $tenantId, ?object $settings): array
    {
        if (
            ! $settings
            || ! Schema::hasColumn('settings', 'current_academic_year_id')
            || empty($settings->current_academic_year_id)
            || empty($settings->current_academic_term_id)
        ) {
            return [];
        }

        $year = DB::table('academic_years')
            ->where('tenant_id', $tenantId)
            ->where('id', $settings->current_academic_year_id)
            ->first();
        $term = DB::table('academic_terms')
            ->where('tenant_id', $tenantId)
            ->where('id', $settings->current_academic_term_id)
            ->first();

        return ($year && $term && (string) $term->academic_year_id === (string) $year->id)
            ? $this->contextPayload($year, $term)
            : [];
    }

    private function setInitialActiveReferences(
        string $tenantId,
        ?object $settings,
        string $year,
        string $semester
    ): array {
        $yearRow = $this->yearByLabel($tenantId, $year);
        $termRow = $yearRow ? $this->termBySemester($tenantId, (string) $yearRow->id, $semester) : null;
        if (! $yearRow || ! $termRow) {
            return [];
        }

        DB::table('academic_years')->where('tenant_id', $tenantId)->where('id', $yearRow->id)->update([
            'status' => 'active',
            'activated_at' => $yearRow->activated_at ?: now(),
            'closed_at' => null,
            'updated_at' => now(),
        ]);
        DB::table('academic_terms')->where('tenant_id', $tenantId)->where('id', $termRow->id)->update([
            'status' => 'active',
            'activated_at' => $termRow->activated_at ?: now(),
            'closed_at' => null,
            'updated_at' => now(),
        ]);
        $context = $this->contextPayload($yearRow, $termRow);
        $this->ensureSettingsReferences($tenantId, $settings, $context);

        return $context;
    }

    private function ensureSettingsReferences(string $tenantId, ?object $settings, array $context): void
    {
        if (! $settings || ! Schema::hasColumn('settings', 'current_academic_year_id')) {
            return;
        }
        if (
            (string) ($settings->current_academic_year_id ?? '') === (string) ($context['academic_year_id'] ?? '')
            && (string) ($settings->current_academic_term_id ?? '') === (string) ($context['academic_term_id'] ?? '')
        ) {
            return;
        }

        DB::table('settings')->where('tenant_id', $tenantId)->where('id', $settings->id)->update([
            'current_academic_year_id' => $context['academic_year_id'] ?? null,
            'current_academic_term_id' => $context['academic_term_id'] ?? null,
        ]);
    }

    private function hydrateContextIds(string $tenantId, array $context): array
    {
        if (($context['academic_year_id'] ?? null) && ($context['academic_term_id'] ?? null)) {
            return $context;
        }

        $ids = $this->normalizedIdsWithoutSync(
            $tenantId,
            $context['tahun_ajaran'] ?? null,
            $context['semester'] ?? null
        );

        return array_merge($context, $ids);
    }

    private function normalizedIdsWithoutSync(string $tenantId, ?string $year, ?string $semester): array
    {
        $yearRow = $year ? $this->yearByLabel($tenantId, $year) : null;
        $termRow = ($yearRow && $semester)
            ? $this->termBySemester($tenantId, (string) $yearRow->id, $semester)
            : null;

        return [
            'academic_year_id' => $yearRow?->id,
            'academic_term_id' => $termRow?->id,
        ];
    }

    private function legacyCurrentContext(string $tenantId): array
    {
        $settings = Schema::hasTable('settings')
            ? DB::table('settings')->where('tenant_id', $tenantId)->orderBy('id')->first()
            : null;
        $period = AcademicPeriod::fromSettings($settings);

        return [
            'tenant_id' => $tenantId,
            'tahun_ajaran' => $period['tahun_ajaran'] ?? null,
            'semester' => $period['semester'] ?? null,
            'academic_year_id' => null,
            'academic_term_id' => null,
            'mode' => 'active',
        ];
    }

    private function contextPayload(object $year, object $term): array
    {
        return [
            'tenant_id' => (string) $year->tenant_id,
            'tahun_ajaran' => (string) $year->label,
            'semester' => (string) $term->semester,
            'academic_year_id' => (string) $year->id,
            'academic_term_id' => (string) $term->id,
            'year_status' => (string) $year->status,
            'term_status' => (string) $term->status,
            'mode' => 'active',
        ];
    }

    private function termPayload(object $term): array
    {
        return [
            'id' => (string) $term->id,
            'academic_year_id' => (string) $term->academic_year_id,
            'semester' => (string) $term->semester,
            'starts_at' => $term->starts_at,
            'ends_at' => $term->ends_at,
            'status' => (string) $term->status,
            'lock_version' => (int) ($term->lock_version ?? 1),
        ];
    }

    private function yearByLabel(string $tenantId, string $year): ?object
    {
        return DB::table('academic_years')->where('tenant_id', $tenantId)->where('label', $year)->first();
    }

    private function termBySemester(string $tenantId, string $yearId, string $semester): ?object
    {
        return DB::table('academic_terms')
            ->where('tenant_id', $tenantId)
            ->where('academic_year_id', $yearId)
            ->where('semester', $semester)
            ->first();
    }

    private function normalizedRanges(string $year, array $period): array
    {
        $ganjil = AcademicPeriod::make(
            $year,
            AcademicPeriod::SEMESTER_GANJIL,
            $period['periode_ganjil_mulai'] ?? null,
            $period['periode_ganjil_selesai'] ?? null
        );
        $genap = AcademicPeriod::make(
            $year,
            AcademicPeriod::SEMESTER_GENAP,
            $period['periode_genap_mulai'] ?? null,
            $period['periode_genap_selesai'] ?? null
        );

        return [
            'ganjil_start' => $ganjil['starts_at'],
            'ganjil_end' => $ganjil['ends_at'],
            'genap_start' => $genap['starts_at'],
            'genap_end' => $genap['ends_at'],
        ];
    }

    private function validateRanges(string $year, array $period): ?array
    {
        foreach ([
            ['periode_ganjil_mulai', 'periode_ganjil_selesai', 'Ganjil'],
            ['periode_genap_mulai', 'periode_genap_selesai', 'Genap'],
        ] as [$startKey, $endKey, $label]) {
            $rawStart = trim((string) ($period[$startKey] ?? ''));
            $rawEnd = trim((string) ($period[$endKey] ?? ''));
            if (($rawStart === '') xor ($rawEnd === '')) {
                return $this->error(
                    'Tanggal mulai dan selesai semester '.$label.' harus diisi bersama.',
                    'academic_period_range_invalid',
                    422
                );
            }
            if ($rawStart !== '' && $rawEnd !== '') {
                $start = AcademicPeriod::normalizeDate($rawStart);
                $end = AcademicPeriod::normalizeDate($rawEnd);
                if (! $start || ! $end || AcademicPeriod::customMonths($year, $start, $end) === []) {
                    return $this->error(
                        'Rentang semester '.$label.' harus berada di dalam tahun ajaran '.$year.'.',
                        'academic_period_range_invalid',
                        422
                    );
                }
            }
        }

        $ranges = $this->normalizedRanges($year, $period);
        foreach ($ranges as $value) {
            if (! $value) {
                return $this->error('Rentang semester belum lengkap atau tidak valid.', 'academic_period_range_invalid', 422);
            }
        }
        if ($ranges['ganjil_start'] > $ranges['ganjil_end'] || $ranges['genap_start'] > $ranges['genap_end']) {
            return $this->error('Tanggal mulai semester tidak boleh melewati tanggal selesai.', 'academic_period_range_invalid', 422);
        }
        if ($ranges['ganjil_end'] >= $ranges['genap_start']) {
            return $this->error('Rentang semester Ganjil dan Genap tidak boleh tumpang tindih.', 'academic_period_overlap', 422);
        }

        return null;
    }

    private function rangesDifferFromStoredTerm(
        string $tenantId,
        string $year,
        string $semester,
        array $ranges
    ): bool {
        $yearRow = $this->yearByLabel($tenantId, $year);
        if (! $yearRow) {
            return true;
        }
        $term = $this->termBySemester($tenantId, (string) $yearRow->id, $semester);
        if (! $term) {
            return true;
        }

        $expected = $semester === AcademicPeriod::SEMESTER_GENAP
            ? [$ranges['genap_start'], $ranges['genap_end']]
            : [$ranges['ganjil_start'], $ranges['ganjil_end']];

        return (string) $term->starts_at !== (string) $expected[0]
            || (string) $term->ends_at !== (string) $expected[1];
    }

    private function yearStatus(string $year, ?string $activeYear): string
    {
        if (! $activeYear) {
            return 'closed';
        }
        if ($year === $activeYear) {
            return 'active';
        }

        return strcmp($year, $activeYear) < 0 ? 'closed' : 'draft';
    }

    private function termStatus(string $year, string $semester, ?string $activeYear, ?string $activeSemester): string
    {
        $yearStatus = $this->yearStatus($year, $activeYear);
        if ($yearStatus !== 'active') {
            return $yearStatus;
        }
        if ($semester === $activeSemester) {
            return 'active';
        }

        return $activeSemester === AcademicPeriod::SEMESTER_GENAP
            ? 'closed'
            : 'draft';
    }

    private function error(string $message, string $code, int $status): array
    {
        return compact('message', 'code', 'status');
    }
}
