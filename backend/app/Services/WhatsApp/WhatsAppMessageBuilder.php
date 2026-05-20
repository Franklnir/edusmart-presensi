<?php

namespace App\Services\WhatsApp;

use Illuminate\Support\Carbon;

class WhatsAppMessageBuilder
{
    private const SCHOOL_TIMEZONE = 'Asia/Jakarta';

    public function buildAttendanceMessage(array $school, array $student, array $attendance): string
    {
        $schoolName = $this->schoolName($school);
        $mapel = $this->value($attendance, 'mapel', '-');
        $time = $this->formatDateTime($attendance['waktu'] ?? null, 'd-m-Y H:i');

        return trim(implode("\n", [
            "Halo orang tua/wali dari {$this->value($student, 'nama', 'siswa')},",
            '',
            "Notifikasi kehadiran dari {$schoolName}:",
            "Nama: {$this->value($student, 'nama', '-')}",
            "Kelas: {$this->value($student, 'kelas', '-')}",
            "Status: {$this->value($attendance, 'status', '-')}",
            "Pelajaran/Sesi: {$mapel}",
            "Jam: {$time}",
            '',
            'Pesan ini dikirim otomatis oleh sistem sekolah.',
        ]));
    }

    public function buildAttendanceProblemMessage(array $school, array $student, array $problem): string
    {
        $schoolName = $this->schoolName($school);
        $title = $this->value($problem, 'title', 'Masalah presensi');
        $date = $this->formatDate($problem['tanggal'] ?? null);
        $detectedAt = $this->formatDateTime($problem['detected_at'] ?? null, 'd-m-Y H:i');
        $scanMasuk = $this->formatDateTime($problem['scan_masuk_at'] ?? null, 'H:i');
        $scanPulang = $this->formatDateTime($problem['scan_pulang_at'] ?? null, 'H:i');

        return trim(implode("\n", [
            "Halo orang tua/wali dari {$this->value($student, 'nama', 'siswa')},",
            '',
            "Notifikasi presensi dari {$schoolName}:",
            "Kejadian: {$title}",
            "Nama: {$this->value($student, 'nama', '-')}",
            "Kelas: {$this->value($student, 'kelas', '-')}",
            "Tanggal: {$date}",
            "Mapel/Sesi terkait: {$this->value($problem, 'mapel', '-')}",
            "Scan masuk: {$scanMasuk}",
            "Scan pulang: {$scanPulang}",
            "Waktu tercatat: {$detectedAt}",
            '',
            'Silakan hubungi pihak sekolah bila data presensi perlu dikonfirmasi.',
        ]));
    }

    public function buildProfileUpdateMessage(array $school, array $student, array $changes): string
    {
        $schoolName = $this->schoolName($school);
        $changeLines = array_map(fn ($line) => '- '.$line, array_values($changes));

        return trim(implode("\n", array_merge([
            "Halo orang tua/wali dari {$this->value($student, 'nama', 'siswa')},",
            '',
            "Ada pembaruan data siswa di {$schoolName}:",
            "Nama: {$this->value($student, 'nama', '-')}",
            "Kelas: {$this->value($student, 'kelas', '-')}",
            '',
        ], $changeLines, [
            '',
            'Silakan cek dashboard sekolah bila perlu verifikasi lebih lanjut.',
        ])));
    }

    public function buildAssignmentSubmissionMessage(array $school, array $student, array $task, array $submission): string
    {
        $schoolName = $this->schoolName($school);

        return trim(implode("\n", [
            "Halo orang tua/wali dari {$this->value($student, 'nama', 'siswa')},",
            '',
            "{$this->value($student, 'nama', 'Siswa')} baru mengumpulkan tugas di {$schoolName}.",
            "Judul tugas: {$this->value($task, 'judul', '-')}",
            "Mapel: {$this->value($task, 'mapel', '-')}",
            "Status submit: {$this->value($submission, 'status', 'terkirim')}",
            "Waktu submit: {$this->formatDateTime($submission['waktu_submit'] ?? null, 'd-m-Y H:i')}",
        ]));
    }

    public function buildExtracurricularMessage(array $school, array $student, array $activity): string
    {
        $schoolName = $this->schoolName($school);
        $title = $this->value($activity, 'title', 'kegiatan ekstrakurikuler');

        return trim(implode("\n", [
            "Halo orang tua/wali dari {$this->value($student, 'nama', 'siswa')},",
            '',
            "Update ekstrakurikuler dari {$schoolName}:",
            "Nama: {$this->value($student, 'nama', '-')}",
            "Kegiatan: {$title}",
            "Status: {$this->value($activity, 'status', '-')}",
            "Tanggal: {$this->formatDate($activity['tanggal'] ?? null)}",
        ]));
    }

    public function buildGradeMessage(array $school, array $student, array $grade): string
    {
        $schoolName = $this->schoolName($school);

        return trim(implode("\n", [
            "Halo orang tua/wali dari {$this->value($student, 'nama', 'siswa')},",
            '',
            "Ada pembaruan nilai di {$schoolName}:",
            "Sumber: {$this->value($grade, 'source', '-')}",
            "Judul: {$this->value($grade, 'title', '-')}",
            "Mapel: {$this->value($grade, 'mapel', '-')}",
            "Nilai: {$this->value($grade, 'score', '-')}",
            "Waktu: {$this->formatDateTime($grade['updated_at'] ?? null, 'd-m-Y H:i')}",
        ]));
    }

    public function buildTestMessage(array $school): string
    {
        return 'Tes koneksi WhatsApp berhasil. Sistem notifikasi '.($this->schoolName($school)).' siap digunakan.';
    }

    private function schoolName(array $school): string
    {
        return $this->value($school, 'nama_sekolah', $this->value($school, 'name', 'sekolah'));
    }

    private function value(array $payload, string $key, string $fallback = ''): string
    {
        $value = $payload[$key] ?? null;
        if ($value === null || $value === '') {
            return $fallback;
        }

        return trim((string) $value);
    }

    private function formatDate($value): string
    {
        if (! $value) {
            return '-';
        }

        try {
            return Carbon::parse($value, self::SCHOOL_TIMEZONE)
                ->setTimezone(self::SCHOOL_TIMEZONE)
                ->format('d-m-Y');
        } catch (\Throwable $e) {
            return (string) $value;
        }
    }

    private function formatDateTime($value, string $format): string
    {
        if (! $value) {
            return '-';
        }

        try {
            return Carbon::parse($value, self::SCHOOL_TIMEZONE)
                ->setTimezone(self::SCHOOL_TIMEZONE)
                ->format($format);
        } catch (\Throwable $e) {
            return (string) $value;
        }
    }
}
