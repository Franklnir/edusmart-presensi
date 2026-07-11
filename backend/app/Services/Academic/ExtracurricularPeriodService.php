<?php

namespace App\Services\Academic;

use App\Support\AcademicPeriod;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class ExtracurricularPeriodService
{
    /**
     * Copy the extracurricular catalog as a new period snapshot.
     * Membership and attendance rows are intentionally not copied here.
     *
     * @return array{copied_count:int,id_map:array<string,string>}
     */
    public function copyCatalog(
        string $tenantId,
        string $sourceYear,
        string $sourceSemester,
        array $targetPeriod
    ): array {
        $empty = ['copied_count' => 0, 'id_map' => []];
        if (
            $tenantId === ''
            || ! Schema::hasTable('ekskul')
            || ! Schema::hasColumn('ekskul', 'id')
            || ! Schema::hasColumn('ekskul', 'nama')
            || ! Schema::hasColumn('ekskul', 'tahun_ajaran')
            || ! Schema::hasColumn('ekskul', 'semester')
        ) {
            return $empty;
        }

        $sourceYear = AcademicPeriod::normalizeAcademicYear($sourceYear);
        $sourceSemester = AcademicPeriod::normalizeSemester($sourceSemester);
        $targetYear = AcademicPeriod::normalizeAcademicYear($targetPeriod['tahun_ajaran'] ?? null);
        $targetSemester = AcademicPeriod::normalizeSemester($targetPeriod['semester'] ?? null);
        if (
            $sourceYear === null
            || $sourceSemester === null
            || $targetYear === null
            || $targetSemester === null
            || ($sourceYear === $targetYear && $sourceSemester === $targetSemester)
        ) {
            return $empty;
        }

        $columns = $this->existingColumns('ekskul', [
            'id', 'nama', 'keterangan', 'hari', 'jam_mulai', 'jam_selesai',
            'pembina_guru_id', 'registration_deadline_at', 'tahun_ajaran', 'semester',
        ]);
        $sourceRows = $this->tenantQuery('ekskul', $tenantId)
            ->where('tahun_ajaran', $sourceYear)
            ->where('semester', $sourceSemester)
            ->orderBy('nama')
            ->get($columns);
        if ($sourceRows->isEmpty()) {
            return $empty;
        }

        $targetRows = $this->tenantQuery('ekskul', $tenantId)
            ->where('tahun_ajaran', $targetYear)
            ->where('semester', $targetSemester)
            ->get($this->existingColumns('ekskul', ['id', 'nama']));
        $targetByName = [];
        foreach ($targetRows as $row) {
            $nameKey = $this->nameKey($row->nama ?? null);
            $id = trim((string) ($row->id ?? ''));
            if ($nameKey !== '' && $id !== '') {
                $targetByName[$nameKey] = $id;
            }
        }

        $now = now();
        $copied = 0;
        $idMap = [];
        foreach ($sourceRows as $source) {
            $sourceId = trim((string) ($source->id ?? ''));
            $name = trim((string) ($source->nama ?? ''));
            $nameKey = $this->nameKey($name);
            if ($sourceId === '' || $nameKey === '') {
                continue;
            }

            if (isset($targetByName[$nameKey])) {
                $idMap[$sourceId] = $targetByName[$nameKey];

                continue;
            }

            $targetId = $this->newCatalogId($name, $targetYear, $targetSemester);
            $payload = [
                'id' => $targetId,
                'tenant_id' => $tenantId,
                'nama' => $name,
                'keterangan' => $source->keterangan ?? null,
                'hari' => $source->hari ?? null,
                'jam_mulai' => $source->jam_mulai ?? null,
                'jam_selesai' => $source->jam_selesai ?? null,
                'pembina_guru_id' => $source->pembina_guru_id ?? null,
                'registration_deadline_at' => $this->shiftRegistrationDeadline(
                    $source->registration_deadline_at ?? null,
                    $sourceYear,
                    $sourceSemester,
                    $targetPeriod
                ),
                'tahun_ajaran' => $targetYear,
                'semester' => $targetSemester,
                'created_at' => $now,
                'updated_at' => $now,
            ];

            DB::table('ekskul')->insert($this->filterExistingPayload('ekskul', $payload));
            $targetByName[$nameKey] = $targetId;
            $idMap[$sourceId] = $targetId;
            $copied += 1;
        }

        return ['copied_count' => $copied, 'id_map' => $idMap];
    }

    /**
     * Repair tenants whose active period has no catalog after an older rollover.
     */
    public function repairEmptyActiveCatalogs(): int
    {
        if (
            ! Schema::hasTable('settings')
            || ! Schema::hasTable('ekskul')
            || ! Schema::hasColumn('settings', 'tenant_id')
            || ! Schema::hasColumn('settings', 'tahun_ajaran')
            || ! Schema::hasColumn('settings', 'semester_aktif')
            || ! Schema::hasColumn('ekskul', 'tahun_ajaran')
            || ! Schema::hasColumn('ekskul', 'semester')
        ) {
            return 0;
        }

        $settingsRows = DB::table('settings')
            ->orderBy('id')
            ->get($this->existingColumns('settings', [
                'tenant_id', 'tahun_ajaran', 'semester_aktif',
                'periode_mulai', 'periode_selesai',
                'periode_ganjil_mulai', 'periode_ganjil_selesai',
                'periode_genap_mulai', 'periode_genap_selesai',
            ]));

        $copied = 0;
        foreach ($settingsRows as $settings) {
            $tenantId = trim((string) ($settings->tenant_id ?? ''));
            $targetPeriod = AcademicPeriod::fromSettings($settings);
            $targetYear = AcademicPeriod::normalizeAcademicYear($targetPeriod['tahun_ajaran'] ?? null);
            $targetSemester = AcademicPeriod::normalizeSemester($targetPeriod['semester'] ?? null);
            if ($tenantId === '' || $targetYear === null || $targetSemester === null) {
                continue;
            }

            $targetExists = $this->tenantQuery('ekskul', $tenantId)
                ->where('tahun_ajaran', $targetYear)
                ->where('semester', $targetSemester)
                ->exists();
            if ($targetExists) {
                continue;
            }

            $source = $this->latestPriorCatalogPeriod($tenantId, $targetYear, $targetSemester);
            if ($source === null) {
                continue;
            }

            $result = $this->copyCatalog(
                $tenantId,
                $source['tahun_ajaran'],
                $source['semester'],
                $targetPeriod
            );
            $copied += (int) ($result['copied_count'] ?? 0);
        }

        return $copied;
    }

    /** @return array{tahun_ajaran:string,semester:string}|null */
    private function latestPriorCatalogPeriod(
        string $tenantId,
        string $targetYear,
        string $targetSemester
    ): ?array {
        $targetOrder = $this->periodOrder($targetYear, $targetSemester);
        $periods = [];
        $rows = $this->tenantQuery('ekskul', $tenantId)
            ->whereNotNull('tahun_ajaran')
            ->whereNotNull('semester')
            ->get(['tahun_ajaran', 'semester']);

        foreach ($rows as $row) {
            $year = AcademicPeriod::normalizeAcademicYear($row->tahun_ajaran ?? null);
            $semester = AcademicPeriod::normalizeSemester($row->semester ?? null);
            if ($year === null || $semester === null) {
                continue;
            }

            $order = $this->periodOrder($year, $semester);
            if ($order >= $targetOrder) {
                continue;
            }

            $periods[$year.'|'.$semester] = [
                'tahun_ajaran' => $year,
                'semester' => $semester,
                'order' => $order,
            ];
        }

        if ($periods === []) {
            return null;
        }

        usort($periods, fn (array $left, array $right) => $right['order'] <=> $left['order']);

        return [
            'tahun_ajaran' => $periods[0]['tahun_ajaran'],
            'semester' => $periods[0]['semester'],
        ];
    }

    private function shiftRegistrationDeadline(
        mixed $value,
        string $sourceYear,
        string $sourceSemester,
        array $targetPeriod
    ): mixed {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        try {
            $deadline = Carbon::parse($raw, 'Asia/Jakarta');
            $sourcePeriod = AcademicPeriod::make($sourceYear, $sourceSemester);
            $sourceStart = Carbon::parse((string) $sourcePeriod['starts_at'], 'Asia/Jakarta')->startOfDay();
            $targetStart = Carbon::parse((string) ($targetPeriod['starts_at'] ?? ''), 'Asia/Jakarta')->startOfDay();
            $shifted = $targetStart->copy()->addSeconds(max(0, $sourceStart->diffInSeconds($deadline, false)));

            $targetEndRaw = $targetPeriod['ends_at'] ?? $targetPeriod['periode_selesai'] ?? null;
            if ($targetEndRaw) {
                $targetEnd = Carbon::parse((string) $targetEndRaw, 'Asia/Jakarta')->endOfDay();
                if ($shifted->gt($targetEnd)) {
                    $shifted = $targetEnd;
                }
            }

            return $shifted;
        } catch (\Throwable) {
            return $value;
        }
    }

    private function periodOrder(string $year, string $semester): int
    {
        $startYear = (int) substr($year, 0, 4);
        $semesterOrder = $semester === AcademicPeriod::SEMESTER_GENAP ? 2 : 1;

        return ($startYear * 2) + $semesterOrder;
    }

    private function newCatalogId(string $name, string $year, string $semester): string
    {
        $prefix = Str::slug($name) ?: 'ekskul';
        $period = Str::slug(str_replace('/', '-', $year).'-'.$semester);

        do {
            $id = $prefix.'-'.$period.'-'.Str::lower(Str::random(8));
        } while (DB::table('ekskul')->where('id', $id)->exists());

        return $id;
    }

    private function nameKey(mixed $value): string
    {
        return Str::lower(trim((string) $value));
    }

    private function tenantQuery(string $table, string $tenantId)
    {
        $query = DB::table($table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query;
    }

    /** @return array<int,string> */
    private function existingColumns(string $table, array $columns): array
    {
        return array_values(array_filter(
            $columns,
            fn (string $column): bool => Schema::hasColumn($table, $column)
        ));
    }

    private function filterExistingPayload(string $table, array $payload): array
    {
        return array_filter(
            $payload,
            fn (mixed $value, string $column): bool => Schema::hasColumn($table, $column),
            ARRAY_FILTER_USE_BOTH
        );
    }
}
