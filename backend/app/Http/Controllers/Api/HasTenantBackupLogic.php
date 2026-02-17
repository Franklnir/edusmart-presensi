<?php

namespace App\Traits;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

trait HasTenantBackupLogic
{
    private array $tableExistenceCache = [];
    private array $tableColumnExistenceCache = [];

    private function getBackupTableOrder(): array
    {
        return [
            'settings', 'profiles', 'admin_users', 'kelas', 'mata_pelajaran',
            'struktur_sekolah', 'kelas_struktur', 'jadwal', 'pengumuman',
            'ekskul', 'ekskul_anggota', 'organisasi', 'organisasi_anggota', 'osis_anggota',
            'absensi_settings', 'absensi_rfid_settings', 'absensi', 'absensi_ajuan',
            'absensi_eskul', 'absensi_scan_temp', 'rfid_scans', 'jam_kosong',
            'tugas', 'tugas_jawaban', 'quizzes', 'quiz_questions', 'quiz_options',
            'quiz_submissions', 'quiz_answers', 'quiz_retake_logs',
            'certificates', 'templat_sertifikat_publik', 'printed_cards',
            'allowed_registrations', 'registration_otps', 'audit_log',
            'anggota_eksku1', 'anggota_ekskul', 'import_siswa_histories', 'import_siswa_history_items',
        ];
    }

    private function normalizeBackupMode(?string $value): string
    {
        $mode = strtolower(trim((string) $value));
        return match ($mode) {
            'students' => 'students',
            'teachers' => 'teachers',
            default => 'full',
        };
    }

    private function normalizeBackupMonths($value): ?int
    {
        $raw = strtolower(trim((string) ($value ?? '')));
        if ($raw === '' || $raw === 'all' || $raw === '0') {
            return null;
        }
        if (!is_numeric($raw)) {
            return null;
        }
        $months = (int) $raw;
        return $months > 0 ? min(36, $months) : null;
    }

    private function hasTable(string $table): bool
    {
        if (!isset($this->tableExistenceCache[$table])) {
            $this->tableExistenceCache[$table] = Schema::hasTable($table);
        }
        return $this->tableExistenceCache[$table];
    }

    private function tableHasColumn(string $table, string $column): bool
    {
        $key = "$table.$column";
        if (!isset($this->tableColumnExistenceCache[$key])) {
            $this->tableColumnExistenceCache[$key] = Schema::hasColumn($table, $column);
        }
        return $this->tableColumnExistenceCache[$key];
    }

    private function allTableColumnsExist(string $table, array $columns): bool
    {
        foreach ($columns as $col) {
            if (!$this->tableHasColumn($table, $col)) return false;
        }
        return true;
    }

    private function makeBackupTable(string $name, array $rows): array
    {
        $normalizedRows = [];
        foreach ($rows as $row) {
            $normalizedRows[] = $this->normalizeBackupRow(is_array($row) ? $row : (array) $row);
        }
        return ['name' => $name, 'rows' => $normalizedRows];
    }

    private function buildFullBackupTables(string $tenantId, ?int $months = null): array
    {
        $tables = [];
        $dateLimit = $months ? now()->subMonths($months) : null;

        foreach ($this->getBackupTableOrder() as $tableName) {
            if (!$this->hasTable($tableName) || !$this->tableHasColumn($tableName, 'tenant_id')) {
                continue;
            }

            try {
                $query = DB::table($tableName)->where('tenant_id', $tenantId);
                
                // Filter by date if applicable and table has created_at
                if ($dateLimit && $this->tableHasColumn($tableName, 'created_at')) {
                    // Skip filtering for master data tables
                    $masterTables = ['settings', 'profiles', 'kelas', 'mata_pelajaran', 'ekskul', 'organisasi'];
                    if (!in_array($tableName, $masterTables)) {
                        $query->where('created_at', '>=', $dateLimit);
                    }
                }

                if ($this->tableHasColumn($tableName, 'id')) {
                    $query->orderBy('id');
                } elseif ($this->tableHasColumn($tableName, 'created_at')) {
                    $query->orderBy('created_at');
                }

                $tables[] = $this->makeBackupTable($tableName, $query->get()->all());
            } catch (\Throwable $e) {
                // ignore error
            }
        }
        return $tables;
    }

    private function buildStudentBackupTables(string $tenantId, ?int $months = null): array
    {
        $dateLimit = $months ? now()->subMonths($months) : null;

        // 1. Data Siswa (Master)
        $students = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'siswa')
            ->orderBy('kelas')
            ->orderBy('nama')
            ->get(['id', 'nama', 'nis', 'kelas', 'jk', 'status', 'no_hp_siswa', 'no_hp_wali', 'email'])
            ->map(function ($s) {
                $s->id = (string) $s->id;
                return $s;
            });

        $studentIds = $students->pluck('id')->toArray();

        // 2. Absensi
        $absensiQuery = DB::table('absensi')
            ->where('tenant_id', $tenantId)
            ->whereIn('siswa_id', $studentIds);
        if ($dateLimit) $absensiQuery->where('created_at', '>=', $dateLimit);
        
        $absensi = $absensiQuery->select('siswa_id', 'status', DB::raw('count(*) as total'))
            ->groupBy('siswa_id', 'status')
            ->get();

        // 3. Nilai Tugas
        $tugasQuery = DB::table('tugas_jawaban as tj')
            ->join('tugas as t', 't.id', '=', 'tj.tugas_id')
            ->where('t.tenant_id', $tenantId)
            ->whereIn('tj.siswa_id', $studentIds);
        if ($dateLimit) $tugasQuery->where('tj.created_at', '>=', $dateLimit);

        $nilaiTugas = $tugasQuery->select(
                'tj.siswa_id', 
                't.mapel', 
                DB::raw('AVG(tj.nilai) as rata_rata'),
                DB::raw('COUNT(tj.id) as jumlah_tugas')
            )
            ->groupBy('tj.siswa_id', 't.mapel')
            ->get();

        // 4. Nilai Quiz
        $quizQuery = DB::table('quiz_submissions as qs')
            ->join('quizzes as q', 'q.id', '=', 'qs.quiz_id')
            ->where('q.tenant_id', $tenantId)
            ->whereIn('qs.siswa_id', $studentIds)
            ->where('qs.status', 'graded');
        if ($dateLimit) $quizQuery->where('qs.created_at', '>=', $dateLimit);

        $nilaiQuiz = $quizQuery->select(
                'qs.siswa_id',
                'q.mapel',
                DB::raw('AVG(qs.score) as rata_rata'),
                DB::raw('COUNT(qs.id) as jumlah_quiz')
            )
            ->groupBy('qs.siswa_id', 'q.mapel')
            ->get();

        // Format Data untuk Excel (Flatten)
        $rekapSiswa = [];
        foreach ($students as $s) {
            $absenSiswa = $absensi->where('siswa_id', $s->id);
            $hadir = $absenSiswa->where('status', 'Hadir')->first()->total ?? 0;
            $izin = $absenSiswa->where('status', 'Izin')->first()->total ?? 0;
            $sakit = $absenSiswa->where('status', 'Sakit')->first()->total ?? 0;
            $alpha = $absenSiswa->where('status', 'Alpha')->first()->total ?? 0;

            $rekapSiswa[] = [
                'Nama' => $s->nama,
                'NIS' => $s->nis,
                'Kelas' => $s->kelas,
                'L/P' => $s->jk,
                'Status' => $s->status,
                'Hadir' => $hadir,
                'Izin' => $izin,
                'Sakit' => $sakit,
                'Alpha' => $alpha,
                'HP Siswa' => $s->no_hp_siswa,
                'HP Wali' => $s->no_hp_wali,
            ];
        }

        return [
            $this->makeBackupTable('Rekap Siswa', $rekapSiswa),
            $this->makeBackupTable('Detail Nilai Tugas', $nilaiTugas->toArray()),
            $this->makeBackupTable('Detail Nilai Quiz', $nilaiQuiz->toArray()),
            $this->makeBackupTable('Raw Absensi', $absensiQuery->get()->toArray()), // Raw data jika butuh detail tanggal
        ];
    }

    private function buildTeacherBackupTables(string $tenantId, ?int $months = null): array
    {
        $dateLimit = $months ? now()->subMonths($months) : null;

        // 1. Data Guru
        $teachers = DB::table('profiles')
            ->where('tenant_id', $tenantId)
            ->where('role', 'guru')
            ->orderBy('nama')
            ->get(['id', 'nama', 'email', 'no_hp_siswa as no_hp', 'status']);

        $teacherIds = $teachers->pluck('id')->toArray();

        // 2. Jadwal Mengajar
        $jadwal = DB::table('jadwal')
            ->where('tenant_id', $tenantId)
            ->whereIn('guru_id', $teacherIds)
            ->get(['guru_id', 'hari', 'jam_ke', 'kelas_id', 'mapel']);

        // 3. Absensi Guru (Log Login/Scan)
        // Asumsi guru absen masuk ke tabel absensi atau rfid_scans, kita ambil rfid_scans sebagai contoh log kehadiran
        $scansQuery = DB::table('rfid_scans')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $teacherIds);
        if ($dateLimit) $scansQuery->where('created_at', '>=', $dateLimit);
        
        $scans = $scansQuery->orderBy('created_at', 'desc')->get();

        $rekapGuru = [];
        foreach ($teachers as $t) {
            $jadwalGuru = $jadwal->where('guru_id', $t->id);
            $mapelAjar = $jadwalGuru->pluck('mapel')->unique()->implode(', ');
            $kelasAjar = $jadwalGuru->pluck('kelas_id')->unique()->implode(', ');

            $rekapGuru[] = [
                'Nama' => $t->nama,
                'Email' => $t->email,
                'HP' => $t->no_hp,
                'Status' => $t->status,
                'Mapel' => $mapelAjar,
                'Kelas' => $kelasAjar,
                'Total Jam Ajar' => $jadwalGuru->count(),
            ];
        }

        return [
            $this->makeBackupTable('Rekap Guru', $rekapGuru),
            $this->makeBackupTable('Jadwal Mengajar', $jadwal->toArray()),
            $this->makeBackupTable('Log Kehadiran (Scan)', $scans->toArray()),
        ];
    }

    private function normalizeBackupRow(array $row): array
    {
        $normalized = [];
        foreach ($row as $key => $value) {
            if (is_array($value) || is_object($value)) {
                $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
                $normalized[$key] = $encoded === false ? '' : $encoded;
                continue;
            }

            if (is_bool($value)) {
                $normalized[$key] = $value ? 1 : 0;
                continue;
            }

            $normalized[$key] = $value;
        }

        return $normalized;
    }

    private function normalizeBackupMapel($value): string
    {
        $mapel = trim((string) ($value ?? ''));
        return $mapel !== '' ? $mapel : 'Tanpa Mapel';
    }

    private function toFloatOrNull($value): ?float
    {
        if ($value === null || $value === '') return null;
        if (!is_numeric($value)) return null;
        return round((float) $value, 2);
    }

    private function combineAcademicScore(?float $taskScore, ?float $quizScore): ?float
    {
        if ($taskScore !== null && $quizScore !== null) {
            return round(($taskScore + $quizScore) / 2, 2);
        }
        return $taskScore !== null ? round($taskScore, 2) : ($quizScore !== null ? round($quizScore, 2) : null);
    }
}