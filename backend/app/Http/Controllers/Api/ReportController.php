<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class ReportController extends ApiController
{
    public function teacherSummary(Request $request)
    {
        set_time_limit(120);
        if (! $this->isAdmin($request) && ! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $type = strtolower(trim((string) $request->query('type', '')));
        if (! in_array($type, ['absensi', 'tugas', 'quiz'], true)) {
            return response()->json(['error' => 'type harus absensi, tugas, atau quiz'], 422);
        }

        $kelas = trim((string) $request->query('kelas', ''));
        $mapel = trim((string) $request->query('mapel', ''));
        if ($kelas === '' || $mapel === '') {
            return response()->json(['error' => 'kelas dan mapel wajib diisi'], 422);
        }

        if (! $this->canAccessClassSubject($request, $tenantId, $kelas, $mapel)) {
            return $this->deny('Anda tidak memiliki akses laporan kelas/mapel ini.', 403);
        }

        $period = $this->resolveReportPeriod($request);
        if (empty($period['date_strings'])) {
            return response()->json(['data' => null]);
        }

        $cacheKey = 'report:teacher-summary:'.$tenantId.':'.($request->user()?->id ?? 'guest').':'.md5(json_encode($request->query()));
        $data = Cache::remember($cacheKey, now()->addSeconds(20), fn () => match ($type) {
            'absensi' => $this->absensiSummary($tenantId, $request, $kelas, $mapel, $period),
            'tugas' => $this->tugasSummary($tenantId, $request, $kelas, $mapel, $period),
            default => $this->quizSummary($tenantId, $request, $kelas, $mapel, $period),
        });

        return response()->json(['data' => $data]);
    }

    public function attendanceSummary(Request $request)
    {
        return $this->teacherSummaryForType($request, 'absensi');
    }

    public function taskSummary(Request $request)
    {
        return $this->teacherSummaryForType($request, 'tugas');
    }

    public function quizSummaryEndpoint(Request $request)
    {
        return $this->teacherSummaryForType($request, 'quiz');
    }

    public function homeroomSummary(Request $request)
    {
        set_time_limit(120);
        if (! $this->isAdmin($request) && ! $this->isGuru($request)) {
            return $this->deny();
        }

        $tenantId = $this->tenantId($request);
        if (! $tenantId) {
            return $this->deny('Tenant tidak valid', 400);
        }

        $kelas = trim((string) ($request->query('kelas') ?: $request->query('kelas_id', '')));
        if ($kelas === '') {
            return response()->json(['error' => 'kelas wajib diisi'], 422);
        }

        if (! $this->canAccessHomeroom($request, $tenantId, $kelas)) {
            return $this->deny('Anda tidak memiliki akses laporan wali kelas ini.', 403);
        }

        $period = $this->resolveReportPeriod($request);
        if (empty($period['date_strings'])) {
            return response()->json(['data' => null]);
        }

        $cacheKey = 'report:homeroom-summary:'.$tenantId.':'.($request->user()?->id ?? 'guest').':'.md5(json_encode($request->query()));
        $data = Cache::remember($cacheKey, now()->addSeconds(20), fn () => $this->homeroomSummaryData($tenantId, $request, $kelas, $period));

        return response()->json(['data' => $data]);
    }

    private function teacherSummaryForType(Request $request, string $type)
    {
        $request->query->set('type', $type);

        return $this->teacherSummary($request);
    }

    private function absensiSummary(string $tenantId, Request $request, string $kelas, string $mapel, array $period): array
    {
        $rows = $this->tenantQuery('absensi', $tenantId)
            ->select($this->existingColumns('absensi', ['id', 'kelas', 'tanggal', 'uid', 'mapel', 'status', 'nama', 'waktu']))
            ->where('kelas', $kelas)
            ->where('mapel', $mapel)
            ->whereBetween('tanggal', [$period['start_date'], $period['end_date']]);
        $this->applyAcademicFilters($rows, 'absensi', $request);
        $absensi = $rows->get();

        $tahunAjaran = trim((string) $request->query('tahun_ajaran', '')) ?: null;
        $students = $this->studentsForReport($tenantId, $kelas, $absensi->pluck('uid')->all(), $tahunAjaran);
        $byStudent = $absensi->groupBy('uid');

        $formatted = $students->map(function ($student) use ($byStudent, $period) {
            $studentRows = $byStudent->get($student->id, collect())->keyBy('tanggal');
            $total = ['Hadir' => 0, 'Izin' => 0, 'Sakit' => 0, 'Alpha' => 0];
            $perTanggal = [];

            foreach ($period['date_strings'] as $date) {
                $status = $studentRows->get($date)?->status;
                $perTanggal[$date] = $status ?: null;
                if (isset($total[$status])) {
                    $total[$status]++;
                }
            }

            return [
                'id' => $student->id,
                'nama' => $student->nama,
                'nis' => $student->nis,
                'total' => $total,
                'absensiPerTanggal' => $perTanggal,
            ];
        })->values();

        return [
            'siswa' => $formatted,
            'dateStrings' => $period['date_strings'],
            'periode' => $period['label'],
        ];
    }

    private function tugasSummary(string $tenantId, Request $request, string $kelas, string $mapel, array $period): array
    {
        $query = $this->tenantQuery('tugas', $tenantId)
            ->select($this->existingColumns('tugas', ['id', 'kelas', 'judul', 'mapel', 'deadline', 'keterangan', 'created_by', 'created_at', 'updated_at']))
            ->where('kelas', $kelas)
            ->where('mapel', $mapel)
            ->whereBetween('created_at', [$period['start_at'], $period['end_at']])
            ->orderBy('created_at');
        $this->applyAcademicFilters($query, 'tugas', $request);
        $tugas = $query->get();

        $tugasIds = $tugas->pluck('id')->filter()->values()->all();
        $jawaban = empty($tugasIds)
            ? collect()
            : $this->tenantQuery('tugas_jawaban', $tenantId)
                ->select($this->existingColumns('tugas_jawaban', ['id', 'tugas_id', 'user_id', 'nilai', 'status', 'waktu_submit', 'dinilai_at', 'dinilai_oleh']))
                ->whereIn('tugas_id', $tugasIds)
                ->get();

        $tahunAjaran = trim((string) $request->query('tahun_ajaran', '')) ?: null;
        $students = $this->studentsForReport($tenantId, $kelas, $jawaban->pluck('user_id')->all(), $tahunAjaran);
        $jawabanByStudentTask = $jawaban->keyBy(fn ($row) => $row->user_id.'|'.$row->tugas_id);

        $formatted = $students->map(function ($student) use ($tugas, $jawabanByStudentTask) {
            $nilaiTugas = [];
            foreach ($tugas as $item) {
                $jawaban = $jawabanByStudentTask->get($student->id.'|'.$item->id);
                $nilaiTugas[$item->id] = [
                    'nilai' => $jawaban?->nilai ?? '-',
                    'judul' => $item->judul,
                    'tugas_id' => $item->id,
                ];
            }
            $grade = $this->averageAndGrade($nilaiTugas);

            return [
                'id' => $student->id,
                'nama' => $student->nama,
                'nis' => $student->nis,
                'nilaiTugas' => $nilaiTugas,
                'rataRata' => $grade['rataRata'],
                'grade' => $grade['grade'],
            ];
        })->values();

        return [
            'siswa' => $formatted,
            'tugas' => $tugas,
            'periode' => $period['label'],
        ];
    }

    private function quizSummary(string $tenantId, Request $request, string $kelas, string $mapel, array $period): array
    {
        $query = $this->tenantQuery('quizzes', $tenantId)
            ->select($this->existingColumns('quizzes', ['id', 'guru_id', 'kelas_id', 'mapel', 'nama', 'starts_at', 'deadline_at', 'penilaian', 'mode', 'is_live', 'is_active', 'created_at', 'updated_at']))
            ->where('kelas_id', $kelas)
            ->where('mapel', $mapel)
            ->whereBetween('created_at', [$period['start_at'], $period['end_at']])
            ->orderBy('created_at');
        $this->applyAcademicFilters($query, 'quizzes', $request);
        $quizzes = $query->get();

        $quizIds = $quizzes->pluck('id')->filter()->values()->all();
        $submissions = empty($quizIds)
            ? collect()
            : $this->tenantQuery('quiz_submissions', $tenantId)
                ->select($this->existingColumns('quiz_submissions', ['id', 'quiz_id', 'siswa_id', 'started_at', 'finished_at', 'score', 'total_points', 'status', 'created_at', 'updated_at']))
                ->whereIn('quiz_id', $quizIds)
                ->get();

        $tahunAjaran = trim((string) $request->query('tahun_ajaran', '')) ?: null;
        $students = $this->studentsForReport($tenantId, $kelas, $submissions->pluck('siswa_id')->all(), $tahunAjaran);
        $submissionByStudentQuiz = $submissions->keyBy(fn ($row) => $row->siswa_id.'|'.$row->quiz_id);

        $formatted = $students->map(function ($student) use ($quizzes, $submissionByStudentQuiz) {
            $nilaiQuiz = [];
            foreach ($quizzes as $quiz) {
                $submission = $submissionByStudentQuiz->get($student->id.'|'.$quiz->id);
                $nilaiQuiz[$quiz->id] = [
                    'nilai' => $submission?->score ?? '-',
                    'quiz_id' => $quiz->id,
                    'nama' => $quiz->nama,
                ];
            }
            $grade = $this->averageAndGrade($nilaiQuiz);

            return [
                'id' => $student->id,
                'nama' => $student->nama,
                'nis' => $student->nis,
                'nilaiQuiz' => $nilaiQuiz,
                'rataRata' => $grade['rataRata'],
                'grade' => $grade['grade'],
            ];
        })->values();

        return [
            'siswa' => $formatted,
            'quizzes' => $quizzes,
            'periode' => $period['label'],
        ];
    }

    private function homeroomSummaryData(string $tenantId, Request $request, string $kelas, array $period): array
    {
        $tahunAjaran = trim((string) $request->query('tahun_ajaran', '')) ?: null;
        $students = $this->studentsForReport($tenantId, $kelas, [], $tahunAjaran);
        $studentIds = $students
            ->pluck('id')
            ->map(fn ($id) => (string) $id)
            ->filter()
            ->values()
            ->all();

        if (empty($studentIds)) {
            return [
                'siswa' => [],
                'totals' => [
                    'siswa' => 0,
                    'absensi' => 0,
                    'tugas' => 0,
                    'quiz' => 0,
                ],
                'periode' => $period['label'],
            ];
        }

        $absensiQuery = $this->tenantQuery('absensi', $tenantId)
            ->select($this->existingColumns('absensi', ['uid', 'status', 'tanggal']))
            ->where('kelas', $kelas)
            ->whereBetween('tanggal', [$period['start_date'], $period['end_date']]);
        $this->applyAcademicFilters($absensiQuery, 'absensi', $request);
        $absensiRows = $absensiQuery->get();

        $tugasQuery = $this->tenantQuery('tugas', $tenantId)
            ->select($this->existingColumns('tugas', ['id', 'kelas', 'created_at']))
            ->where('kelas', $kelas)
            ->whereBetween('created_at', [$period['start_at'], $period['end_at']]);
        $this->applyAcademicFilters($tugasQuery, 'tugas', $request);
        $tugasIds = $tugasQuery->pluck('id')->filter()->values()->all();

        $jawabanRows = empty($tugasIds)
            ? collect()
            : $this->tenantQuery('tugas_jawaban', $tenantId)
                ->select($this->existingColumns('tugas_jawaban', ['tugas_id', 'user_id', 'nilai']))
                ->whereIn('tugas_id', $tugasIds)
                ->whereIn('user_id', $studentIds)
                ->get();

        $quizQuery = $this->tenantQuery('quizzes', $tenantId)
            ->select($this->existingColumns('quizzes', ['id', 'kelas_id', 'created_at']))
            ->where('kelas_id', $kelas)
            ->whereBetween('created_at', [$period['start_at'], $period['end_at']]);
        $this->applyAcademicFilters($quizQuery, 'quizzes', $request);
        $quizIds = $quizQuery->pluck('id')->filter()->values()->all();

        $submissionRows = empty($quizIds)
            ? collect()
            : $this->tenantQuery('quiz_submissions', $tenantId)
                ->select($this->existingColumns('quiz_submissions', ['quiz_id', 'siswa_id', 'score']))
                ->whereIn('quiz_id', $quizIds)
                ->whereIn('siswa_id', $studentIds)
                ->get();

        $absensiByStudent = [];
        foreach ($absensiRows as $row) {
            $studentId = (string) ($row->uid ?? '');
            if ($studentId === '') {
                continue;
            }
            $status = $this->normalizeAttendanceStatus($row->status ?? null);
            $absensiByStudent[$studentId] ??= ['Hadir' => 0, 'Izin' => 0, 'Sakit' => 0, 'Alpha' => 0];
            if (array_key_exists($status, $absensiByStudent[$studentId])) {
                $absensiByStudent[$studentId][$status] += 1;
            }
        }

        $taskScoresByStudent = [];
        foreach ($jawabanRows as $row) {
            $studentId = (string) ($row->user_id ?? '');
            $score = $this->numericScore($row->nilai ?? null);
            if ($studentId !== '' && $score !== null) {
                $taskScoresByStudent[$studentId][] = $score;
            }
        }

        $quizScoresByStudent = [];
        foreach ($submissionRows as $row) {
            $studentId = (string) ($row->siswa_id ?? '');
            $score = $this->numericScore($row->score ?? null);
            if ($studentId !== '' && $score !== null) {
                $quizScoresByStudent[$studentId][] = $score;
            }
        }

        $formatted = $students->map(function ($student) use ($absensiByStudent, $taskScoresByStudent, $quizScoresByStudent) {
            $studentId = (string) $student->id;
            $taskAverage = $this->averageScores($taskScoresByStudent[$studentId] ?? []);
            $quizAverage = $this->averageScores($quizScoresByStudent[$studentId] ?? []);
            $academicAverage = $this->averageScores(array_values(array_filter([$taskAverage, $quizAverage], fn ($value) => $value !== null)));

            return [
                'id' => $student->id,
                'nama' => $student->nama,
                'nis' => $student->nis,
                'kelas' => $student->kelas,
                'absensi' => $absensiByStudent[$studentId] ?? ['Hadir' => 0, 'Izin' => 0, 'Sakit' => 0, 'Alpha' => 0],
                'rataTugas' => $taskAverage ?? '-',
                'rataQuiz' => $quizAverage ?? '-',
                'rataAkademik' => $academicAverage ?? '-',
                'grade' => $academicAverage === null ? '-' : $this->grade($academicAverage),
            ];
        })->values();

        return [
            'siswa' => $formatted,
            'totals' => [
                'siswa' => count($studentIds),
                'absensi' => $absensiRows->count(),
                'tugas' => count($tugasIds),
                'quiz' => count($quizIds),
            ],
            'periode' => $period['label'],
        ];
    }

    private function canAccessClassSubject(Request $request, string $tenantId, string $kelas, string $mapel): bool
    {
        if ($this->isAdmin($request)) {
            return true;
        }

        $guruId = (string) ($request->user()?->id ?? '');
        if ($guruId === '') {
            return false;
        }

        // Check jadwal for any academic year — this allows teachers to access
        // reports for past periods (archives) where they taught the same
        // class/subject combination.
        $teachesSubject = $this->tenantQuery('jadwal', $tenantId)
            ->where('guru_id', $guruId)
            ->where('kelas_id', $kelas)
            ->where('mapel', $mapel)
            ->exists();
        if ($teachesSubject) {
            return true;
        }

        // Also allow wali kelas access — again across any period.
        return Schema::hasTable('kelas_struktur')
            && $this->tenantQuery('kelas_struktur', $tenantId)
                ->where('kelas_id', $kelas)
                ->where('wali_guru_id', $guruId)
                ->exists();
    }

    private function canAccessHomeroom(Request $request, string $tenantId, string $kelas): bool
    {
        if ($this->isAdmin($request)) {
            return true;
        }

        $guruId = (string) ($request->user()?->id ?? '');
        if ($guruId === '' || ! Schema::hasTable('kelas_struktur')) {
            return false;
        }

        return $this->tenantQuery('kelas_struktur', $tenantId)
            ->where('kelas_id', $kelas)
            ->where('wali_guru_id', $guruId)
            ->exists();
    }

    private function resolveReportPeriod(Request $request): array
    {
        $monthsRaw = $request->query('months', $request->query('bulan', ''));
        $months = is_array($monthsRaw) ? $monthsRaw : explode(',', (string) $monthsRaw);
        $months = collect($months)
            ->map(fn ($month) => trim((string) $month))
            ->filter(fn ($month) => preg_match('/^\d{4}-\d{2}$/', $month))
            ->unique()
            ->sort()
            ->values();

        $dateStrings = [];
        $labels = [];
        foreach ($months as $month) {
            $start = Carbon::createFromFormat('Y-m-d', "{$month}-01", 'Asia/Jakarta')->startOfMonth();
            $end = $start->copy()->endOfMonth();
            $labels[] = $this->monthLabel($start);
            $cursor = $start->copy();
            while ($cursor->lessThanOrEqualTo($end)) {
                $dateStrings[] = $cursor->toDateString();
                $cursor->addDay();
            }
        }

        $dateStrings = array_values(array_unique($dateStrings));
        sort($dateStrings);

        return [
            'date_strings' => $dateStrings,
            'start_date' => $dateStrings[0] ?? null,
            'end_date' => $dateStrings[count($dateStrings) - 1] ?? null,
            'start_at' => ($dateStrings[0] ?? now('Asia/Jakarta')->toDateString()).' 00:00:00',
            'end_at' => ($dateStrings[count($dateStrings) - 1] ?? now('Asia/Jakarta')->toDateString()).' 23:59:59',
            'label' => implode(', ', $labels).' - '.trim((string) $request->query('tahun_ajaran', '')).' - Tahun Ajaran',
        ];
    }

    /**
     * Resolve the list of students for a report.
     *
     * When a specific tahun_ajaran is provided (including past periods treated
     * as archives), we look up who was actually enrolled in that class for
     * that academic year from student_class_histories. This prevents students
     * who have since been promoted to a higher grade from bleeding into the
     * current-period report, and also correctly restores the archived roster
     * when a teacher browses a past period.
     *
     * For the current active period (or when student_class_histories is not
     * available), we fall back to querying profiles.kelas directly and only
     * include active students.
     */
    private function studentsForReport(string $tenantId, string $kelas, array $extraIds = [], ?string $tahunAjaran = null)
    {
        // Prefer history-based lookup when tahun_ajaran is supplied and the
        // history table exists — this is the period-aware (archive-safe) path.
        if (
            $tahunAjaran !== null
            && $tahunAjaran !== ''
            && Schema::hasTable('student_class_histories')
            && Schema::hasColumn('student_class_histories', 'tahun_ajaran')
            && Schema::hasColumn('student_class_histories', 'student_id')
            && Schema::hasColumn('student_class_histories', 'class_id')
        ) {
            // Pick the most-recent open (valid_until IS NULL) history row per
            // student for this class + year.  If there are no open rows (e.g.
            // the period has ended) we also accept closed rows so that archived
            // periods still show their full roster.
            $historyStudentIds = DB::table('student_class_histories')
                ->where('tenant_id', $tenantId)
                ->where('class_id', $kelas)
                ->where('tahun_ajaran', $tahunAjaran)
                ->whereIn('status', ['active', 'nonaktif', 'mutasi'])  // exclude alumni
                ->distinct()
                ->pluck('student_id')
                ->map('strval')
                ->filter()
                ->unique()
                ->values()
                ->all();

            if (! empty($historyStudentIds)) {
                return DB::table('profiles')
                    ->where('tenant_id', $tenantId)
                    ->where('role', 'siswa')
                    ->whereIn('id', $historyStudentIds)
                    ->select($this->existingColumns('profiles', ['id', 'nama', 'nis', 'kelas', 'status']))
                    ->orderBy('nama')
                    ->orderBy('nis')
                    ->orderBy('id')
                    ->get();
            }

            // History table exists but no rows for this class+year — the
            // period pre-dates the history feature.  Fall through to the
            // legacy path below, but restrict to extraIds that still belong
            // to this class so we do not pull in unrelated students.
        }

        // Legacy / current-period path: query profiles.kelas directly.
        // We intentionally do NOT use orWhereIn($extraIds) here because that
        // is what caused students from previous periods to "stick" — any
        // student who had a submission in the class would always be included
        // regardless of their current class or status.
        $query = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->where('kelas', $kelas)
            ->select($this->existingColumns('profiles', ['id', 'nama', 'nis', 'kelas', 'status']))
            ->orderBy('nama')
            ->orderBy('nis')
            ->orderBy('id');

        if (Schema::hasColumn('profiles', 'status')) {
            $query->where('status', 'active');
        }

        return $query->get();
    }

    private function averageAndGrade(array $nilaiRows): array
    {
        $values = [];
        foreach ($nilaiRows as $row) {
            $value = $row['nilai'] ?? null;
            if ($value === '-' || $value === null || $value === '') {
                continue;
            }
            if (is_numeric($value)) {
                $values[] = (float) $value;
            }
        }

        if (empty($values)) {
            return ['rataRata' => '-', 'grade' => '-'];
        }

        $average = round(array_sum($values) / count($values), 2);

        return ['rataRata' => $average, 'grade' => $this->grade($average)];
    }

    private function numericScore(mixed $value): ?float
    {
        if ($value === null || $value === '' || $value === '-') {
            return null;
        }

        return is_numeric($value) ? (float) $value : null;
    }

    private function averageScores(array $values): ?float
    {
        $scores = array_values(array_filter($values, fn ($value) => is_numeric($value)));
        if (empty($scores)) {
            return null;
        }

        return round(array_sum($scores) / count($scores), 2);
    }

    private function normalizeAttendanceStatus(mixed $status): string
    {
        $normalized = strtolower(trim((string) ($status ?? '')));

        return match ($normalized) {
            'izin' => 'Izin',
            'sakit' => 'Sakit',
            'alpha', 'alpa', 'absen' => 'Alpha',
            default => 'Hadir',
        };
    }

    private function grade(float $score): string
    {
        if ($score >= 90) {
            return 'A';
        }
        if ($score >= 80) {
            return 'B';
        }
        if ($score >= 70) {
            return 'C';
        }
        if ($score >= 60) {
            return 'D';
        }

        return 'E';
    }

    private function applyAcademicFilters($query, string $table, Request $request): void
    {
        $tahunAjaran = trim((string) $request->query('tahun_ajaran', ''));

        if ($tahunAjaran !== '' && Schema::hasColumn($table, 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $tahunAjaran);
        }

        // Semester filter intentionally omitted for report queries.
        // Tugas and quizzes are scoped by tahun_ajaran + date range already;
        // adding semester makes values disappear when records were created
        // before semester was consistently populated.
    }

    private function tenantQuery(string $table, string $tenantId)
    {
        $query = DB::table($table);
        if (Schema::hasColumn($table, 'tenant_id')) {
            $query->where('tenant_id', $tenantId);
        }

        return $query;
    }

    private function existingColumns(string $table, array $columns): array
    {
        if (! Schema::hasTable($table)) {
            return $columns;
        }

        $available = array_values(array_filter($columns, fn ($column) => Schema::hasColumn($table, $column)));

        return ! empty($available) ? $available : ['*'];
    }

    private function monthLabel(Carbon $date): string
    {
        $months = [
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

        return ($months[(int) $date->month] ?? $date->format('F')).' '.$date->year;
    }
}
