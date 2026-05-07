<?php

namespace App\Support;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

class AcademicPeriod
{
    public const SEMESTER_GANJIL = 'Ganjil';

    public const SEMESTER_GENAP = 'Genap';

    public static function current(?CarbonInterface $date = null): array
    {
        $now = $date ? Carbon::instance($date) : Carbon::now('Asia/Jakarta');
        $startYear = $now->month >= 7 ? $now->year : $now->year - 1;

        return [
            'tahun_ajaran' => $startYear.'/'.($startYear + 1),
            'semester' => $now->month >= 7 ? self::SEMESTER_GANJIL : self::SEMESTER_GENAP,
        ];
    }

    public static function fromSettings(?object $settings): array
    {
        $current = self::current();
        $year = self::normalizeAcademicYear($settings->tahun_ajaran ?? null);
        $semester = self::normalizeSemester($settings->semester_aktif ?? null);

        return [
            'tahun_ajaran' => $year ?: $current['tahun_ajaran'],
            'semester' => $semester ?: $current['semester'],
        ];
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
}
