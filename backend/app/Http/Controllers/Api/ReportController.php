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

    private function absensiSummary(string $tenantId, Request $request, string $kelas, string $mapel, array $period): array
    {
        $rows = $this->tenantQuery('absensi', $tenantId)
            ->select($this->existingColumns('absensi', ['id', 'kelas', 'tanggal', 'uid', 'mapel', 'status', 'nama', 'waktu']))
            ->where('kelas', $kelas)
            ->where('mapel', $mapel)
            ->whereBetween('tanggal', [$period['start_date'], $period['end_date']]);
        $this->applyAcademicFilters($rows, 'absensi', $request);
        $absensi = $rows->get();

        $students = $this->studentsForReport($tenantId, $kelas, $absensi->pluck('uid')->all());
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

        $students = $this->studentsForReport($tenantId, $kelas, $jawaban->pluck('user_id')->all());
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

        $students = $this->studentsForReport($tenantId, $kelas, $submissions->pluck('siswa_id')->all());
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

    private function canAccessClassSubject(Request $request, string $tenantId, string $kelas, string $mapel): bool
    {
        if ($this->isAdmin($request)) {
            return true;
        }

        $guruId = (string) ($request->user()?->id ?? '');
        if ($guruId === '') {
            return false;
        }

        $teachesSubject = $this->tenantQuery('jadwal', $tenantId)
            ->where('guru_id', $guruId)
            ->where('kelas_id', $kelas)
            ->where('mapel', $mapel)
            ->exists();
        if ($teachesSubject) {
            return true;
        }

        return Schema::hasTable('kelas_struktur')
            && $this->tenantQuery('kelas_struktur', $tenantId)
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

    private function studentsForReport(string $tenantId, string $kelas, array $extraIds = [])
    {
        $ids = array_values(array_unique(array_filter(array_map('strval', $extraIds))));

        return DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->where(function ($query) use ($kelas, $ids) {
                $query->where('kelas', $kelas);
                if (! empty($ids)) {
                    $query->orWhereIn('id', $ids);
                }
            })
            ->select($this->existingColumns('profiles', ['id', 'nama', 'nis', 'kelas', 'status']))
            ->orderBy('nama')
            ->get();
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
        $semester = trim((string) $request->query('semester', ''));

        if ($tahunAjaran !== '' && Schema::hasColumn($table, 'tahun_ajaran')) {
            $query->where('tahun_ajaran', $tahunAjaran);
        }
        if ($semester !== '' && Schema::hasColumn($table, 'semester')) {
            $query->where('semester', $semester);
        }
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
