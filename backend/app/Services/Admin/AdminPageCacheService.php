<?php

namespace App\Services\Admin;

use App\Support\AcademicPeriod;
use Closure;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class AdminPageCacheService
{
    public const SCOPE_HOME = 'home';

    public const SCOPE_STRUCTURE = 'structure';

    public const SCOPE_ORGANIZATIONS = 'organizations';

    public const SCOPE_TEACHER_OPTIONS = 'teacher-options';

    private const VERSION_PREFIX = 'admin-page-cache:v1:version';

    private const DATA_PREFIX = 'admin-page-cache:v1:data';

    public static function scopesForTable(string $table): array
    {
        return match ($table) {
            'settings' => [self::SCOPE_HOME, self::SCOPE_STRUCTURE, self::SCOPE_ORGANIZATIONS, self::SCOPE_TEACHER_OPTIONS],
            'profiles' => [self::SCOPE_HOME, self::SCOPE_STRUCTURE, self::SCOPE_ORGANIZATIONS, self::SCOPE_TEACHER_OPTIONS],
            'kelas', 'student_class_histories' => [self::SCOPE_HOME, self::SCOPE_STRUCTURE, self::SCOPE_ORGANIZATIONS],
            'kelas_struktur', 'struktur_sekolah' => [self::SCOPE_HOME, self::SCOPE_STRUCTURE],
            'organisasi', 'organisasi_anggota' => [self::SCOPE_HOME, self::SCOPE_ORGANIZATIONS],
            'pengumuman', 'absensi', 'ekskul', 'ekskul_anggota', 'absensi_eskul' => [self::SCOPE_HOME],
            'jadwal', 'mata_pelajaran' => [self::SCOPE_STRUCTURE],
            default => [],
        };
    }

    public static function yearsFromRows(array $rows): array
    {
        $years = [];
        foreach ($rows as $row) {
            $item = (array) $row;
            $year = AcademicPeriod::normalizeAcademicYear($item['tahun_ajaran'] ?? null);
            if ($year) {
                $years[$year] = true;
            }
        }

        return array_keys($years);
    }

    public function bumpTenantVersions(string $tenantId, array $scopes): void
    {
        foreach (array_values(array_unique(array_filter($scopes))) as $scope) {
            $key = $this->versionKey($tenantId, $scope);

            try {
                if (! Cache::has($key)) {
                    Cache::put($key, 1, now()->addDays(30));
                }
                Cache::increment($key);
            } catch (\Throwable $e) {
                Cache::put($key, now()->timestamp, now()->addDays(30));
            }
        }
    }

    public function warmTenant(string $tenantId, array $scopes = [], array $years = []): void
    {
        $scopes = array_values(array_unique(array_filter($scopes))) ?: [
            self::SCOPE_HOME,
            self::SCOPE_STRUCTURE,
            self::SCOPE_ORGANIZATIONS,
            self::SCOPE_TEACHER_OPTIONS,
        ];

        $settings = $this->settings($tenantId);
        $activeYear = AcademicPeriod::normalizeAcademicYear($settings['tahun_ajaran'] ?? null) ?: '';
        $years = array_values(array_unique(array_filter(array_merge($years, [$activeYear]))));

        foreach ($years ?: [''] as $year) {
            if (in_array(self::SCOPE_HOME, $scopes, true)) {
                $this->homeBootstrap($tenantId, ['tahun_ajaran' => $year], true);
            }
            if (in_array(self::SCOPE_STRUCTURE, $scopes, true)) {
                $this->structureBootstrap($tenantId, ['tahun_ajaran' => $year], true);
            }
            if (in_array(self::SCOPE_ORGANIZATIONS, $scopes, true)) {
                $this->organizationBootstrap($tenantId, ['tahun_ajaran' => $year], true);
            }
        }

        if (in_array(self::SCOPE_TEACHER_OPTIONS, $scopes, true)) {
            $this->teacherOptions($tenantId, [], true);
        }
    }

    public function dashboardSummary(string $tenantId, array $params = [], bool $force = false): array
    {
        $settings = $this->settings($tenantId);
        $year = $this->requestedYear($params, $settings);

        return $this->remember(
            self::SCOPE_HOME,
            $tenantId,
            ['summary', 'tahun_ajaran' => $year],
            300,
            fn () => $this->buildDashboardSummary($tenantId, $settings, $year),
            $force
        );
    }

    public function homeBootstrap(string $tenantId, array $params = [], bool $force = false): array
    {
        $settings = $this->settings($tenantId);
        $year = $this->requestedYear($params, $settings);

        return $this->remember(
            self::SCOPE_HOME,
            $tenantId,
            ['bootstrap', 'tahun_ajaran' => $year],
            300,
            function () use ($tenantId, $settings, $year) {
                $people = $this->peopleRows($tenantId);

                return [
                    'settings' => $settings,
                    'academic_period' => $this->academicPeriodPayload($settings, $year),
                    'summary' => $this->buildDashboardSummary($tenantId, $settings, $year),
                    'people' => $people,
                    'guru' => array_values(array_filter(
                        $people,
                        fn (array $row) => in_array((string) ($row['role'] ?? ''), ['guru', 'teacher'], true)
                    )),
                    'pengumuman' => $this->announcementRows($tenantId),
                    'generated_at' => now()->toISOString(),
                ];
            },
            $force
        );
    }

    public function teacherOptions(string $tenantId, array $params = [], bool $force = false): array
    {
        return $this->remember(
            self::SCOPE_TEACHER_OPTIONS,
            $tenantId,
            ['list', 'scope' => (string) ($params['scope'] ?? '')],
            1800,
            fn () => [
                'rows' => $this->teacherRows($tenantId),
                'generated_at' => now()->toISOString(),
            ],
            $force
        );
    }

    public function organizationBootstrap(string $tenantId, array $params = [], bool $force = false): array
    {
        $settings = $this->settings($tenantId);
        $year = $this->requestedYear($params, $settings);

        return $this->remember(
            self::SCOPE_ORGANIZATIONS,
            $tenantId,
            ['list', 'tahun_ajaran' => $year],
            900,
            fn () => [
                'settings' => $settings,
                'academic_period' => $this->academicPeriodPayload($settings, $year),
                'organisasi' => $this->organizationRows($tenantId, $year),
                'generated_at' => now()->toISOString(),
            ],
            $force
        );
    }

    public function structureBootstrap(string $tenantId, array $params = [], bool $force = false): array
    {
        $settings = $this->settings($tenantId);
        $year = $this->requestedYear($params, $settings);

        return $this->remember(
            self::SCOPE_STRUCTURE,
            $tenantId,
            ['summary', 'tahun_ajaran' => $year],
            900,
            function () use ($tenantId, $settings, $year) {
                $classes = $this->classesForAcademicYear($tenantId, $year);
                $classIds = $classes
                    ->pluck('id')
                    ->filter(fn ($id) => trim((string) $id) !== '')
                    ->map(fn ($id) => (string) $id)
                    ->values()
                    ->all();

                $classStructure = $this->classStructureRows($tenantId, $year, $classIds);
                $schoolStructure = $this->schoolStructureRows($tenantId, $year);
                $teachers = $this->teacherRows($tenantId);
                $selectedClassId = (string) ($classes->first()['id'] ?? '');
                $selectedStructure = $selectedClassId !== ''
                    ? $classStructure->first(fn ($row) => (string) ($row['kelas_id'] ?? '') === $selectedClassId)
                    : null;

                return [
                    'settings' => $settings,
                    'academic_period' => $this->academicPeriodPayload($settings, $year),
                    'guru' => $teachers,
                    'kelas' => $classes->values()->all(),
                    'struktur' => $classStructure->values()->all(),
                    'kelas_struktur' => $classStructure->values()->all(),
                    'struktur_sekolah' => $schoolStructure->values()->all(),
                    'selected_class_id' => $selectedClassId,
                    'selected_structure' => $selectedStructure ? (array) $selectedStructure : null,
                    'selected_students' => [],
                    'schedule' => [],
                    'mapel' => [],
                    'statistics' => [
                        'teachers' => count($teachers),
                        'classes' => $classes->count(),
                        'selected_students' => 0,
                        'schedule_rows' => 0,
                        'mapel' => 0,
                    ],
                    'generated_at' => now()->toISOString(),
                ];
            },
            $force
        );
    }

    private function remember(string $scope, string $tenantId, array $params, int $ttlSeconds, Closure $builder, bool $force = false): array
    {
        $key = $this->dataKey($tenantId, $scope, $params);
        if (! $force) {
            $cached = Cache::get($key);
            if (is_array($cached)) {
                return $this->withCacheStatus($cached, 'hit');
            }
        }

        $payload = $builder();
        $payload['_cache'] = [
            'scope' => $scope,
            'status' => $force ? 'refresh' : 'miss',
            'generated_at' => now()->toISOString(),
            'ttl_seconds' => $ttlSeconds,
        ];

        Cache::put($key, $payload, now()->addSeconds($ttlSeconds));

        return $payload;
    }

    private function withCacheStatus(array $payload, string $status): array
    {
        $meta = is_array($payload['_cache'] ?? null) ? $payload['_cache'] : [];
        $payload['_cache'] = [
            ...$meta,
            'status' => $status,
        ];

        return $payload;
    }

    private function versionKey(string $tenantId, string $scope): string
    {
        return self::VERSION_PREFIX.':'.$this->safeKey($tenantId).':'.$this->safeKey($scope);
    }

    private function dataKey(string $tenantId, string $scope, array $params): string
    {
        $version = (string) (Cache::get($this->versionKey($tenantId, $scope), 1) ?: 1);
        ksort($params);

        return self::DATA_PREFIX.':'.$this->safeKey($tenantId).':'.$this->safeKey($scope).':v'.$this->safeKey($version).':'.sha1(json_encode($params));
    }

    private function safeKey(string $value): string
    {
        return preg_replace('/[^A-Za-z0-9_.-]+/', '_', $value) ?: 'none';
    }

    private function requestedYear(array $params, array $settings): string
    {
        $requested = AcademicPeriod::normalizeAcademicYear($params['tahun_ajaran'] ?? null);
        if ($requested) {
            return $requested;
        }

        return AcademicPeriod::normalizeAcademicYear($settings['tahun_ajaran'] ?? null) ?: '';
    }

    private function settings(string $tenantId): array
    {
        $row = $this->firstTenantRow('settings', $tenantId);

        return $row ? (array) $row : [];
    }

    private function academicPeriodPayload(array $settings, string $year): array
    {
        $resolved = AcademicPeriod::fromSettings((object) $settings);

        return [
            'tahun_ajaran' => $year ?: ($resolved['tahun_ajaran'] ?? null),
            'semester' => $resolved['semester'] ?? ($settings['semester_aktif'] ?? null),
            'periode_mulai' => $settings['periode_mulai'] ?? null,
            'periode_selesai' => $settings['periode_selesai'] ?? null,
        ];
    }

    private function buildDashboardSummary(string $tenantId, array $settings, string $year): array
    {
        $profileCounts = Schema::hasTable('profiles')
            ? DB::table('profiles')
                ->select('role', DB::raw('count(*) as aggregate'))
                ->where('tenant_id', $tenantId)
                ->whereIn('role', ['guru', 'admin'])
                ->groupBy('role')
                ->pluck('aggregate', 'role')
            : collect();

        $attendanceQuery = $this->tenantQuery('absensi', $tenantId);
        if (
            Schema::hasTable('absensi')
            && Schema::hasColumn('absensi', 'tanggal')
            && ! empty($settings['periode_mulai'])
            && ! empty($settings['periode_selesai'])
        ) {
            $attendanceQuery->whereBetween('tanggal', [$settings['periode_mulai'], $settings['periode_selesai']]);
        }

        return [
            'siswa' => $this->studentCountForAcademicYear($tenantId, $year),
            'guru' => (int) ($profileCounts['guru'] ?? 0),
            'admin' => (int) ($profileCounts['admin'] ?? 0),
            'kelas' => $this->classesForAcademicYear($tenantId, $year)->count(),
            'absensi' => Schema::hasTable('absensi') ? (int) $attendanceQuery->count() : 0,
            'pengumuman' => $this->tenantTableCount('pengumuman', $tenantId),
            'eskul' => $this->tenantTableCount('ekskul', $tenantId),
            'tahun_ajaran' => $year,
            'generated_at' => now()->toISOString(),
        ];
    }

    private function peopleRows(string $tenantId): array
    {
        if (! Schema::hasTable('profiles')) {
            return [];
        }

        return DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['admin', 'guru', 'teacher'])
            ->select($this->existingColumns('profiles', ['id', 'nama', 'email', 'kelas', 'role', 'status', 'angkatan']))
            ->orderBy('role')
            ->orderBy('nama')
            ->limit(1500)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values()
            ->all();
    }

    private function teacherRows(string $tenantId): array
    {
        if (! Schema::hasTable('profiles')) {
            return [];
        }

        return DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->whereIn('role', ['guru', 'teacher'])
            ->select($this->existingColumns('profiles', ['id', 'nama', 'email', 'role', 'jabatan', 'status', 'updated_at', 'created_via', 'created_by']))
            ->orderBy('nama')
            ->limit(1500)
            ->get()
            ->map(function ($row) {
                $item = (array) $row;
                $name = $item['nama'] ?? $item['email'] ?? $item['id'] ?? '';
                $item['name'] = $name;
                $item['label'] = $name.(! empty($item['email']) ? ' ('.$item['email'].')' : '');

                return $item;
            })
            ->values()
            ->all();
    }

    private function announcementRows(string $tenantId): array
    {
        if (! Schema::hasTable('pengumuman')) {
            return [];
        }

        return $this->tenantQuery('pengumuman', $tenantId)
            ->select($this->existingColumns('pengumuman', ['id', 'judul', 'keterangan', 'target', 'created_at', 'updated_at']))
            ->orderByDesc(Schema::hasColumn('pengumuman', 'created_at') ? 'created_at' : 'id')
            ->limit(100)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values()
            ->all();
    }

    private function organizationRows(string $tenantId, string $year): array
    {
        if (! Schema::hasTable('organisasi')) {
            return [];
        }

        return $this->tenantQuery('organisasi', $tenantId)
            ->select($this->existingColumns('organisasi', [
                'id', 'nama', 'visi', 'misi', 'pembina_guru_id', 'pembina_guru_nama',
                'tahun_ajaran', 'semester', 'created_at', 'updated_at',
            ]))
            ->when($year !== '' && Schema::hasColumn('organisasi', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $year))
            ->orderBy('nama')
            ->limit(1000)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values()
            ->all();
    }

    private function classStructureRows(string $tenantId, string $year, array $classIds)
    {
        if (! Schema::hasTable('kelas_struktur')) {
            return collect();
        }

        return $this->tenantQuery('kelas_struktur', $tenantId)
            ->select($this->existingColumns('kelas_struktur', [
                'id', 'kelas_id', 'wali_guru_id', 'wali_guru_nama',
                'ketua_siswa_id', 'ketua_siswa_nama', 'created_at', 'updated_at',
                'tahun_ajaran', 'semester',
            ]))
            ->when($year !== '' && Schema::hasColumn('kelas_struktur', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $year))
            ->when(! empty($classIds), fn ($builder) => $builder->whereIn('kelas_id', $classIds))
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();
    }

    private function schoolStructureRows(string $tenantId, string $year)
    {
        if (! Schema::hasTable('struktur_sekolah')) {
            return collect();
        }

        return $this->tenantQuery('struktur_sekolah', $tenantId)
            ->select($this->existingColumns('struktur_sekolah', [
                'id', 'jabatan', 'guru_id', 'guru_nama', 'created_at', 'updated_at',
                'tahun_ajaran', 'semester',
            ]))
            ->when($year !== '' && Schema::hasColumn('struktur_sekolah', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $year))
            ->orderBy('jabatan')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();
    }

    private function studentCountForAcademicYear(string $tenantId, string $year): int
    {
        if ($year !== '' && $this->hasStudentClassHistoryForYear($tenantId, $year)) {
            return (int) $this->tenantQuery('student_class_histories', $tenantId)
                ->where('tahun_ajaran', $year)
                ->whereNotNull('student_id')
                ->whereNotNull('class_id')
                ->where('class_id', '!=', '')
                ->whereRaw('lower(coalesce(status, \'active\')) <> ?', ['alumni'])
                ->distinct()
                ->count('student_id');
        }

        if (! Schema::hasTable('profiles')) {
            return 0;
        }

        return (int) DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->whereRaw('lower(coalesce(status, \'active\')) <> ?', ['alumni'])
            ->count();
    }

    private function classesForAcademicYear(string $tenantId, string $year)
    {
        $baseRows = $this->classRowsFromTable($tenantId);
        $periodRows = $this->classRowsFromTable($tenantId, $year);
        $historyRows = $this->classRowsFromStudentHistory($tenantId, $year);

        if ($historyRows->isNotEmpty()) {
            $baseById = $baseRows->keyBy(fn ($row) => (string) ($row['id'] ?? ''));
            $merged = [];

            foreach ($historyRows as $row) {
                $id = (string) ($row['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $merged[$id] = $this->mergeClassRowPreferNonEmpty((array) ($baseById->get($id) ?? []), $row);
            }

            foreach ($periodRows as $row) {
                $id = (string) ($row['id'] ?? '');
                if ($id === '') {
                    continue;
                }
                $merged[$id] = isset($merged[$id])
                    ? $this->mergeClassRowPreferNonEmpty($row, $merged[$id])
                    : $row;
            }

            return $this->sortClassRows(collect(array_values($merged)));
        }

        if ($periodRows->isNotEmpty()) {
            return $this->sortClassRows($periodRows);
        }

        return $this->sortClassRows($baseRows);
    }

    private function classRowsFromTable(string $tenantId, string $year = '')
    {
        if (! Schema::hasTable('kelas')) {
            return collect();
        }

        if ($year !== '' && ! Schema::hasColumn('kelas', 'tahun_ajaran')) {
            return collect();
        }

        return $this->tenantQuery('kelas', $tenantId)
            ->select($this->existingColumns('kelas', [
                'id', 'nama', 'grade', 'suffix', 'tingkat', 'jurusan',
                'angkatan', 'tahun_ajaran', 'semester', 'is_active',
                'created_at', 'updated_at',
            ]))
            ->when($year !== '' && Schema::hasColumn('kelas', 'tahun_ajaran'), fn ($builder) => $builder->where('tahun_ajaran', $year))
            ->get()
            ->map(fn ($row) => (array) $row)
            ->values();
    }

    private function classRowsFromStudentHistory(string $tenantId, string $year)
    {
        if ($year === '' || ! $this->hasStudentClassHistoryForYear($tenantId, $year)) {
            return collect();
        }

        $rows = $this->tenantQuery('student_class_histories', $tenantId)
            ->where('tahun_ajaran', $year)
            ->whereNotNull('class_id')
            ->where('class_id', '!=', '')
            ->whereRaw('lower(coalesce(status, \'active\')) <> ?', ['alumni'])
            ->select($this->existingColumns('student_class_histories', [
                'class_id', 'class_name', 'grade', 'suffix', 'angkatan',
                'tahun_ajaran', 'semester',
            ]))
            ->orderBy('class_id')
            ->limit(10000)
            ->get();

        $classes = [];
        foreach ($rows as $row) {
            $id = trim((string) ($row->class_id ?? ''));
            if ($id === '') {
                continue;
            }

            $name = trim((string) ($row->class_name ?? '')) ?: $id;
            $grade = $this->normalizeClassGrade((string) ($row->grade ?? '')) ?: $this->parseClassGrade($name);
            $suffix = trim((string) ($row->suffix ?? '')) ?: $this->stripClassGradePrefix($name, $grade);
            $classes[$id] = $this->mergeClassRowPreferNonEmpty($classes[$id] ?? [], [
                'id' => $id,
                'nama' => $name,
                'grade' => $grade,
                'suffix' => $suffix,
                'tingkat' => $grade,
                'jurusan' => '',
                'angkatan' => trim((string) ($row->angkatan ?? '')),
                'tahun_ajaran' => $year,
                'semester' => trim((string) ($row->semester ?? '')),
                'is_active' => true,
            ]);
        }

        return collect(array_values($classes))->values();
    }

    private function hasStudentClassHistoryForYear(string $tenantId, string $year): bool
    {
        return $year !== ''
            && Schema::hasTable('student_class_histories')
            && Schema::hasColumn('student_class_histories', 'student_id')
            && Schema::hasColumn('student_class_histories', 'tahun_ajaran')
            && (bool) $this->tenantQuery('student_class_histories', $tenantId)
                ->where('tahun_ajaran', $year)
                ->whereNotNull('student_id')
                ->exists();
    }

    private function mergeClassRowPreferNonEmpty(array $base, array $override): array
    {
        $row = $base;
        foreach ($override as $key => $value) {
            if ($value === null || (is_string($value) && trim($value) === '')) {
                continue;
            }
            $row[$key] = $value;
        }

        return $row;
    }

    private function sortClassRows($rows)
    {
        $gradeOrder = [
            'VII' => 0,
            'VIII' => 1,
            'IX' => 2,
            'X' => 3,
            'XI' => 4,
            'XII' => 5,
        ];

        return $rows
            ->sort(function (array $a, array $b) use ($gradeOrder) {
                $gradeA = $this->normalizeClassGrade((string) ($a['grade'] ?? '')) ?: $this->parseClassGrade((string) ($a['nama'] ?? $a['id'] ?? ''));
                $gradeB = $this->normalizeClassGrade((string) ($b['grade'] ?? '')) ?: $this->parseClassGrade((string) ($b['nama'] ?? $b['id'] ?? ''));
                $orderA = $gradeOrder[$gradeA] ?? 999;
                $orderB = $gradeOrder[$gradeB] ?? 999;
                if ($orderA !== $orderB) {
                    return $orderA <=> $orderB;
                }

                $suffixCompare = strcasecmp((string) ($a['suffix'] ?? ''), (string) ($b['suffix'] ?? ''));
                if ($suffixCompare !== 0) {
                    return $suffixCompare;
                }

                return strcasecmp((string) ($a['nama'] ?? $a['id'] ?? ''), (string) ($b['nama'] ?? $b['id'] ?? ''));
            })
            ->values();
    }

    private function normalizeClassGrade(string $value): string
    {
        $value = strtoupper(trim($value));

        return in_array($value, ['VII', 'VIII', 'IX', 'X', 'XI', 'XII'], true) ? $value : '';
    }

    private function parseClassGrade(string $value): string
    {
        $upper = strtoupper(trim($value));
        foreach (['VIII', 'VII', 'XII', 'XI', 'IX', 'X'] as $grade) {
            if (preg_match('/(^|[\s_-])'.preg_quote($grade, '/').'($|[\s_-])/', $upper)) {
                return $grade;
            }
        }

        return '';
    }

    private function stripClassGradePrefix(string $value, string $grade): string
    {
        $value = trim($value);
        if ($grade === '') {
            return $value;
        }

        return trim(preg_replace('/^'.preg_quote($grade, '/').'[\s_-]*/i', '', $value) ?: $value);
    }

    private function firstTenantRow(string $table, string $tenantId): ?object
    {
        if (! Schema::hasTable($table)) {
            return null;
        }

        $query = DB::table($table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->orderBy(Schema::hasColumn($table, 'id') ? 'id' : 'created_at')->first();
    }

    private function tenantQuery(string $table, string $tenantId)
    {
        $query = DB::table($table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query;
    }

    private function tenantTableCount(string $table, string $tenantId): int
    {
        if (! Schema::hasTable($table)) {
            return 0;
        }

        return (int) $this->tenantQuery($table, $tenantId)->count();
    }

    private function existingColumns(string $table, array $columns): array
    {
        if (! Schema::hasTable($table)) {
            return $columns;
        }

        $available = array_values(array_filter($columns, fn ($column) => Schema::hasColumn($table, $column)));

        return ! empty($available) ? $available : ['*'];
    }
}
