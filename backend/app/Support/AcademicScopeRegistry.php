<?php

namespace App\Support;

final class AcademicScopeRegistry
{
    public const GLOBAL = 'global';

    public const CURRENT = 'current';

    public const YEAR = 'academic_year';

    public const TERM = 'academic_term';

    public const PARENT_SNAPSHOT = 'parent_snapshot';

    private const TABLES = [
        self::CURRENT => [
            'kelas',
        ],
        self::YEAR => [
            'jadwal',
            'kelas_struktur',
            'struktur_sekolah',
            'organisasi',
            'organisasi_anggota',
        ],
        self::TERM => [
            'tugas',
            'quizzes',
            'absensi',
            'absensi_ajuan',
            'absensi_settings',
            'absensi_eskul',
            'jam_kosong',
            'ekskul',
            'ekskul_anggota',
            'anggota_ekskul',
            'rapot_siswa',
            'guru_mapel_bobot',
            'guru_mapel_manual_nilai',
        ],
        self::PARENT_SNAPSHOT => [
            'tugas_jawaban',
            'quiz_submissions',
            'student_class_histories',
        ],
    ];

    public static function scopeFor(string $table): string
    {
        $table = strtolower(trim($table));
        foreach (self::TABLES as $scope => $tables) {
            if (in_array($table, $tables, true)) {
                return $scope;
            }
        }

        return self::GLOBAL;
    }

    public static function tablesFor(string $scope): array
    {
        return self::TABLES[$scope] ?? [];
    }

    public static function allRegisteredTables(): array
    {
        return array_values(array_merge(...array_values(self::TABLES)));
    }

    public static function isYearScoped(string $table): bool
    {
        return self::scopeFor($table) === self::YEAR;
    }

    public static function isTermScoped(string $table): bool
    {
        return self::scopeFor($table) === self::TERM;
    }

    public static function isParentSnapshot(string $table): bool
    {
        return self::scopeFor($table) === self::PARENT_SNAPSHOT;
    }

    public static function academicYearColumn(string $table): string
    {
        return strtolower(trim($table)) === 'rapot_siswa'
            ? 'tahun_pelajaran'
            : 'tahun_ajaran';
    }

    public static function shouldStampLegacyPeriod(string $table): bool
    {
        return in_array(self::scopeFor($table), [self::CURRENT, self::YEAR, self::TERM], true);
    }

    public static function shouldApplyDefaultReadScope(string $table): bool
    {
        return in_array(self::scopeFor($table), [self::YEAR, self::TERM], true);
    }

    public static function isDirectlyMutablePeriodTable(string $table): bool
    {
        return in_array(self::scopeFor($table), [self::YEAR, self::TERM], true);
    }
}
