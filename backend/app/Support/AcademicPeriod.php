<?php

namespace App\Support;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

class AcademicPeriod
{
    public const SEMESTER_GANJIL = 'Ganjil';

    public const SEMESTER_GENAP = 'Genap';

    private const MONTH_NAMES = [
        1 => 'Januari',
        2 => 'Februari',
        3 => 'Maret',
        4 => 'April',
        5 => 'Mei',
        6 => 'Juni',
        7 => 'Juli',
        8 => 'Agustus',
        9 => 'September',
        10 => 'Oktober',
        11 => 'November',
        12 => 'Desember',
    ];

    public static function current(?CarbonInterface $date = null): array
    {
        $now = $date ? Carbon::instance($date) : Carbon::now('Asia/Jakarta');
        $startYear = $now->month >= 7 ? $now->year : $now->year - 1;

        return self::make(
            $startYear.'/'.($startYear + 1),
            $now->month >= 7 ? self::SEMESTER_GANJIL : self::SEMESTER_GENAP
        );
    }

    public static function fromSettings(?object $settings): array
    {
        $current = self::current();
        $year = self::normalizeAcademicYear($settings->tahun_ajaran ?? null);
        $semester = self::normalizeSemester($settings->semester_aktif ?? null);
        [$startsAt, $endsAt] = self::semesterRangeFromSettings($settings, $semester);

        return self::make(
            $year ?: $current['tahun_ajaran'],
            $semester ?: $current['semester'],
            $startsAt,
            $endsAt
        );
    }

    private static function semesterRangeFromSettings(?object $settings, ?string $semester): array
    {
        $normalized = self::normalizeSemester($semester);
        $startColumn = $normalized === self::SEMESTER_GANJIL
            ? 'periode_ganjil_mulai'
            : ($normalized === self::SEMESTER_GENAP ? 'periode_genap_mulai' : null);
        $endColumn = $normalized === self::SEMESTER_GANJIL
            ? 'periode_ganjil_selesai'
            : ($normalized === self::SEMESTER_GENAP ? 'periode_genap_selesai' : null);

        $startsAt = $startColumn ? self::normalizeDate($settings->{$startColumn} ?? null) : null;
        $endsAt = $endColumn ? self::normalizeDate($settings->{$endColumn} ?? null) : null;

        return [
            $startsAt ?: self::normalizeDate($settings->periode_mulai ?? null),
            $endsAt ?: self::normalizeDate($settings->periode_selesai ?? null),
        ];
    }

    public static function make($academicYear, $semester, $startsAt = null, $endsAt = null): array
    {
        $year = self::normalizeAcademicYear($academicYear) ?: self::current()['tahun_ajaran'];
        $normalizedSemester = self::normalizeSemester($semester) ?: self::current()['semester'];
        $startYear = (int) substr($year, 0, 4);
        $endYear = $startYear + 1;
        $customMonths = self::customMonths($year, $startsAt, $endsAt);
        $months = ! empty($customMonths)
            ? $customMonths
            : self::semesterMonths($year, $normalizedSemester);
        $firstMonth = $months[0] ?? null;
        $lastMonth = $months[count($months) - 1] ?? null;

        return [
            'tahun_ajaran' => $year,
            'semester' => $normalizedSemester,
            'start_year' => $startYear,
            'end_year' => $endYear,
            'months' => $months,
            'month_numbers' => array_map(fn ($month) => $month['month'], $months),
            'month_labels' => array_map(fn ($month) => $month['label'], $months),
            'starts_at' => $firstMonth['start_date'] ?? null,
            'ends_at' => $lastMonth['end_date'] ?? null,
            'periode_mulai' => $firstMonth['start_date'] ?? null,
            'periode_selesai' => $lastMonth['end_date'] ?? null,
            'custom_range' => ! empty($customMonths),
            'range_label' => $firstMonth && $lastMonth
                ? $firstMonth['label'].' - '.$lastMonth['label']
                : null,
            'label' => $year.' - Semester '.$normalizedSemester,
        ];
    }

    public static function semesterMonths($academicYear, $semester): array
    {
        $year = self::normalizeAcademicYear($academicYear);
        $normalizedSemester = self::normalizeSemester($semester);
        if (! $year || ! $normalizedSemester) {
            return [];
        }

        $startYear = (int) substr($year, 0, 4);
        $monthNumbers = $normalizedSemester === self::SEMESTER_GANJIL
            ? [7, 8, 9, 10, 11, 12]
            : [1, 2, 3, 4, 5, 6];
        $calendarYear = $normalizedSemester === self::SEMESTER_GANJIL
            ? $startYear
            : $startYear + 1;

        return array_map(function (int $month) use ($calendarYear) {
            $start = Carbon::create($calendarYear, $month, 1, 0, 0, 0, 'Asia/Jakarta')->startOfDay();
            $end = $start->copy()->endOfMonth()->startOfDay();
            $label = self::MONTH_NAMES[$month].' '.$calendarYear;

            return [
                'month' => $month,
                'year' => $calendarYear,
                'value' => sprintf('%04d-%02d', $calendarYear, $month),
                'name' => self::MONTH_NAMES[$month],
                'label' => $label,
                'short_label' => substr(self::MONTH_NAMES[$month], 0, 3).' '.$calendarYear,
                'start_date' => $start->toDateString(),
                'end_date' => $end->toDateString(),
            ];
        }, $monthNumbers);
    }

    public static function customMonths($academicYear, $startsAt, $endsAt): array
    {
        $year = self::normalizeAcademicYear($academicYear);
        $startDate = self::normalizeDate($startsAt);
        $endDate = self::normalizeDate($endsAt);
        if (! $year || ! $startDate || ! $endDate) {
            return [];
        }

        $start = Carbon::parse($startDate, 'Asia/Jakarta')->startOfMonth()->startOfDay();
        $end = Carbon::parse($endDate, 'Asia/Jakarta')->endOfMonth()->startOfDay();
        if ($start->greaterThan($end)) {
            return [];
        }

        $academicStartYear = (int) substr($year, 0, 4);
        $academicStart = Carbon::create($academicStartYear, 7, 1, 0, 0, 0, 'Asia/Jakarta')->startOfDay();
        $academicEnd = Carbon::create($academicStartYear + 1, 6, 30, 0, 0, 0, 'Asia/Jakarta')->startOfDay();
        if ($start->lessThan($academicStart) || $end->greaterThan($academicEnd)) {
            return [];
        }

        if ($start->diffInMonths($end) > 11) {
            return [];
        }

        $months = [];
        $cursor = $start->copy();
        while ($cursor->lessThanOrEqualTo($end)) {
            $month = (int) $cursor->month;
            $calendarYear = (int) $cursor->year;
            $monthStart = $cursor->copy()->startOfMonth()->startOfDay();
            $monthEnd = $cursor->copy()->endOfMonth()->startOfDay();
            $label = self::MONTH_NAMES[$month].' '.$calendarYear;

            $months[] = [
                'month' => $month,
                'year' => $calendarYear,
                'value' => sprintf('%04d-%02d', $calendarYear, $month),
                'name' => self::MONTH_NAMES[$month],
                'label' => $label,
                'short_label' => substr(self::MONTH_NAMES[$month], 0, 3).' '.$calendarYear,
                'start_date' => $monthStart->toDateString(),
                'end_date' => $monthEnd->toDateString(),
            ];

            $cursor->addMonthNoOverflow()->startOfMonth();
        }

        return $months;
    }

    public static function normalizeAcademicYear($value): ?string
    {
        $raw = preg_replace('/\s+/', '', (string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        if (preg_match('/^(\d{4})[\/-](\d{4})$/', $raw, $matches)) {
            $start = (int) $matches[1];
            $end = (int) $matches[2];
            if ($end === $start + 1) {
                return $start.'/'.$end;
            }
        }

        if (preg_match('/^\d{4}$/', $raw)) {
            $start = (int) $raw;

            return $start.'/'.($start + 1);
        }

        return null;
    }

    public static function normalizeSemester($value): ?string
    {
        $raw = strtolower(trim((string) ($value ?? '')));
        if ($raw === '') {
            return null;
        }

        return match ($raw) {
            '1', 'ganjil', 'gasal', 'odd' => self::SEMESTER_GANJIL,
            '2', 'genap', 'even' => self::SEMESTER_GENAP,
            default => null,
        };
    }

    public static function normalizeDate($value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        if (preg_match('/^\d{4}-\d{2}$/', $raw)) {
            $raw .= '-01';
        }

        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw)) {
            return null;
        }

        try {
            return Carbon::parse($raw, 'Asia/Jakarta')->toDateString();
        } catch (\Throwable $e) {
            return null;
        }
    }
}
