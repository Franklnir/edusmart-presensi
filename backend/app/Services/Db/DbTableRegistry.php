<?php

namespace App\Services\Db;

class DbTableRegistry
{
    private const ALLOWED_TABLES = [
        'settings',
        'profiles',
        'kelas',
        'mata_pelajaran',
        'guru_mapel_bobot',
        'struktur_sekolah',
        'kelas_struktur',
        'jadwal',
        'pengumuman',
        'ekskul',
        'ekskul_anggota',
        'organisasi',
        'organisasi_anggota',
        'osis_anggota',
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'absensi_rfid_settings',
        'absensi_eskul',
        'absensi_scan_temp',
        'rfid_scans',
        'jam_kosong',
        'tugas',
        'tugas_jawaban',
        'certificates',
        'templat_sertifikat_publik',
        'printed_cards',
        'allowed_registrations',
        'registration_otps',
        'admin_users',
        'audit_log',
        'anggota_eksku1',
        'anggota_ekskul',
        'quizzes',
        'quiz_questions',
        'quiz_options',
        'quiz_submissions',
        'quiz_answers',
        'quiz_violation_logs',
        'user_presence',
        'import_siswa_histories',
        'import_siswa_history_items',
        'import_guru_histories',
        'import_guru_history_items',
    ];

    private const TENANT_SCOPED_TABLES = [
        'settings',
        'profiles',
        'kelas',
        'mata_pelajaran',
        'guru_mapel_bobot',
        'struktur_sekolah',
        'kelas_struktur',
        'jadwal',
        'pengumuman',
        'ekskul',
        'ekskul_anggota',
        'organisasi',
        'organisasi_anggota',
        'osis_anggota',
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'absensi_rfid_settings',
        'absensi_eskul',
        'absensi_scan_temp',
        'rfid_scans',
        'jam_kosong',
        'tugas',
        'tugas_jawaban',
        'certificates',
        'templat_sertifikat_publik',
        'printed_cards',
        'allowed_registrations',
        'registration_otps',
        'admin_users',
        'audit_log',
        'anggota_eksku1',
        'anggota_ekskul',
        'quizzes',
        'quiz_questions',
        'quiz_options',
        'quiz_submissions',
        'quiz_answers',
        'quiz_violation_logs',
        'user_presence',
        'import_siswa_histories',
        'import_siswa_history_items',
        'import_guru_histories',
        'import_guru_history_items',
    ];

    public function isAllowed(string $table): bool
    {
        return in_array($table, self::ALLOWED_TABLES, true);
    }

    public function isTenantScoped(string $table): bool
    {
        return in_array($table, self::TENANT_SCOPED_TABLES, true);
    }
}
