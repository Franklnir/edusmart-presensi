<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profiles', function (Blueprint $table) {
            $table->index('email', 'profiles_email_index');
            $table->index('role', 'profiles_role_index');
            $table->index('kelas', 'profiles_kelas_index');
            $table->index('nis', 'profiles_nis_index');
            $table->index('status', 'profiles_status_index');
            $table->index('nama', 'profiles_nama_index');
        });

        Schema::table('kelas_struktur', function (Blueprint $table) {
            $table->index('wali_guru_id', 'kelas_struktur_wali_guru_index');
        });

        Schema::table('jadwal', function (Blueprint $table) {
            $table->index('guru_id', 'jadwal_guru_index');
            $table->index('kelas_id', 'jadwal_kelas_index');
            $table->index('mapel', 'jadwal_mapel_index');
            $table->index('hari', 'jadwal_hari_index');
        });

        Schema::table('pengumuman', function (Blueprint $table) {
            $table->index('target', 'pengumuman_target_index');
        });

        Schema::table('organisasi_anggota', function (Blueprint $table) {
            $table->index('organisasi_id', 'organisasi_anggota_org_index');
            $table->index('siswa_id', 'organisasi_anggota_siswa_index');
            $table->index('kelas', 'organisasi_anggota_kelas_index');
        });

        Schema::table('ekskul_anggota', function (Blueprint $table) {
            $table->index('ekskul_id', 'ekskul_anggota_ekskul_index');
            $table->index('user_id', 'ekskul_anggota_user_index');
        });

        Schema::table('absensi', function (Blueprint $table) {
            $table->index(['kelas', 'mapel', 'tanggal'], 'absensi_kelas_mapel_tanggal_index');
            $table->index('uid', 'absensi_uid_index');
        });

        Schema::table('absensi_ajuan', function (Blueprint $table) {
            $table->index(['kelas', 'tanggal'], 'absensi_ajuan_kelas_tanggal_index');
            $table->index('uid', 'absensi_ajuan_uid_index');
            $table->index('guru_id', 'absensi_ajuan_guru_index');
            $table->index('status_guru', 'absensi_ajuan_status_index');
        });

        Schema::table('absensi_settings', function (Blueprint $table) {
            $table->index(['kelas', 'mapel', 'tanggal'], 'absensi_settings_kelas_mapel_tanggal_index');
        });

        Schema::table('absensi_eskul', function (Blueprint $table) {
            $table->index(['ekskul_id', 'tanggal'], 'absensi_eskul_ekskul_tanggal_index');
            $table->index(['user_id', 'tanggal'], 'absensi_eskul_user_tanggal_index');
        });

        Schema::table('absensi_scan_temp', function (Blueprint $table) {
            $table->index(['tanggal', 'kelas'], 'absensi_scan_temp_tanggal_kelas_index');
            $table->index('siswa_id', 'absensi_scan_temp_siswa_index');
        });

        Schema::table('rfid_scans', function (Blueprint $table) {
            $table->index('card_uid', 'rfid_scans_card_uid_index');
            $table->index('created_at', 'rfid_scans_created_at_index');
        });

        Schema::table('tugas', function (Blueprint $table) {
            $table->index(['kelas', 'mapel', 'created_at'], 'tugas_kelas_mapel_created_index');
            $table->index('created_by', 'tugas_created_by_index');
        });

        Schema::table('tugas_jawaban', function (Blueprint $table) {
            $table->index('tugas_id', 'tugas_jawaban_tugas_index');
            $table->index('user_id', 'tugas_jawaban_user_index');
            $table->index('status', 'tugas_jawaban_status_index');
        });

        Schema::table('certificates', function (Blueprint $table) {
            $table->index('user_id', 'certificates_user_index');
        });

        Schema::table('registration_otps', function (Blueprint $table) {
            $table->index('email', 'registration_otps_email_index');
            $table->index('role', 'registration_otps_role_index');
            $table->index('expires_at', 'registration_otps_expires_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('profiles', function (Blueprint $table) {
            $table->dropIndex('profiles_email_index');
            $table->dropIndex('profiles_role_index');
            $table->dropIndex('profiles_kelas_index');
            $table->dropIndex('profiles_nis_index');
            $table->dropIndex('profiles_status_index');
            $table->dropIndex('profiles_nama_index');
        });

        Schema::table('kelas_struktur', function (Blueprint $table) {
            $table->dropIndex('kelas_struktur_wali_guru_index');
        });

        Schema::table('jadwal', function (Blueprint $table) {
            $table->dropIndex('jadwal_guru_index');
            $table->dropIndex('jadwal_kelas_index');
            $table->dropIndex('jadwal_mapel_index');
            $table->dropIndex('jadwal_hari_index');
        });

        Schema::table('pengumuman', function (Blueprint $table) {
            $table->dropIndex('pengumuman_target_index');
        });

        Schema::table('organisasi_anggota', function (Blueprint $table) {
            $table->dropIndex('organisasi_anggota_org_index');
            $table->dropIndex('organisasi_anggota_siswa_index');
            $table->dropIndex('organisasi_anggota_kelas_index');
        });

        Schema::table('ekskul_anggota', function (Blueprint $table) {
            $table->dropIndex('ekskul_anggota_ekskul_index');
            $table->dropIndex('ekskul_anggota_user_index');
        });

        Schema::table('absensi', function (Blueprint $table) {
            $table->dropIndex('absensi_kelas_mapel_tanggal_index');
            $table->dropIndex('absensi_uid_index');
        });

        Schema::table('absensi_ajuan', function (Blueprint $table) {
            $table->dropIndex('absensi_ajuan_kelas_tanggal_index');
            $table->dropIndex('absensi_ajuan_uid_index');
            $table->dropIndex('absensi_ajuan_guru_index');
            $table->dropIndex('absensi_ajuan_status_index');
        });

        Schema::table('absensi_settings', function (Blueprint $table) {
            $table->dropIndex('absensi_settings_kelas_mapel_tanggal_index');
        });

        Schema::table('absensi_eskul', function (Blueprint $table) {
            $table->dropIndex('absensi_eskul_ekskul_tanggal_index');
            $table->dropIndex('absensi_eskul_user_tanggal_index');
        });

        Schema::table('absensi_scan_temp', function (Blueprint $table) {
            $table->dropIndex('absensi_scan_temp_tanggal_kelas_index');
            $table->dropIndex('absensi_scan_temp_siswa_index');
        });

        Schema::table('rfid_scans', function (Blueprint $table) {
            $table->dropIndex('rfid_scans_card_uid_index');
            $table->dropIndex('rfid_scans_created_at_index');
        });

        Schema::table('tugas', function (Blueprint $table) {
            $table->dropIndex('tugas_kelas_mapel_created_index');
            $table->dropIndex('tugas_created_by_index');
        });

        Schema::table('tugas_jawaban', function (Blueprint $table) {
            $table->dropIndex('tugas_jawaban_tugas_index');
            $table->dropIndex('tugas_jawaban_user_index');
            $table->dropIndex('tugas_jawaban_status_index');
        });

        Schema::table('certificates', function (Blueprint $table) {
            $table->dropIndex('certificates_user_index');
        });

        Schema::table('registration_otps', function (Blueprint $table) {
            $table->dropIndex('registration_otps_email_index');
            $table->dropIndex('registration_otps_role_index');
            $table->dropIndex('registration_otps_expires_at_index');
        });
    }
};
