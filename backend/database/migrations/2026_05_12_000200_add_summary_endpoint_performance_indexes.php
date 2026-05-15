<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->index('profiles', ['tenant_id', 'role', 'kelas', 'nama'], 'prof_tenant_role_kelas_nama_idx');
        $this->index('profiles', ['tenant_id', 'role', 'status'], 'prof_tenant_role_status_idx');
        $this->index('kelas_struktur', ['tenant_id', 'wali_guru_id', 'kelas_id'], 'kstr_tenant_wali_kelas_idx');
        $this->index('jadwal', ['tenant_id', 'guru_id', 'kelas_id', 'mapel'], 'jad_tenant_guru_kelas_mapel_idx');
        $this->index('jadwal', ['tenant_id', 'hari', 'kelas_id'], 'jad_tenant_hari_kelas_idx');
        $this->index('absensi', ['tenant_id', 'kelas', 'mapel', 'tanggal'], 'abs_tenant_kelas_mapel_tgl_idx');
        $this->index('absensi_scan_temp', ['tenant_id', 'tanggal', 'scan_at'], 'scan_tenant_tgl_at_idx');
        $this->index('tugas', ['tenant_id', 'kelas', 'mapel', 'created_at'], 'tgs_tenant_kelas_mapel_at_idx');
        $this->index('tugas_jawaban', ['tenant_id', 'tugas_id', 'user_id'], 'tj_tenant_tugas_user_idx');
        $this->index('quizzes', ['tenant_id', 'guru_id', 'kelas_id', 'mapel', 'created_at'], 'quiz_tenant_guru_kelas_at_idx');
        $this->index('quiz_submissions', ['tenant_id', 'quiz_id', 'siswa_id', 'status'], 'qsub_tenant_quiz_siswa_idx');
        $this->index('quiz_answers', ['tenant_id', 'submission_id', 'question_id'], 'qans_tenant_sub_q_idx');
        $this->index('certificates', ['tenant_id', 'issued_at'], 'cert_tenant_issued_idx');
        $this->index('certificates', ['tenant_id', 'user_id'], 'cert_tenant_user_idx');
    }

    public function down(): void
    {
        $this->drop('profiles', 'prof_tenant_role_kelas_nama_idx');
        $this->drop('profiles', 'prof_tenant_role_status_idx');
        $this->drop('kelas_struktur', 'kstr_tenant_wali_kelas_idx');
        $this->drop('jadwal', 'jad_tenant_guru_kelas_mapel_idx');
        $this->drop('jadwal', 'jad_tenant_hari_kelas_idx');
        $this->drop('absensi', 'abs_tenant_kelas_mapel_tgl_idx');
        $this->drop('absensi_scan_temp', 'scan_tenant_tgl_at_idx');
        $this->drop('tugas', 'tgs_tenant_kelas_mapel_at_idx');
        $this->drop('tugas_jawaban', 'tj_tenant_tugas_user_idx');
        $this->drop('quizzes', 'quiz_tenant_guru_kelas_at_idx');
        $this->drop('quiz_submissions', 'qsub_tenant_quiz_siswa_idx');
        $this->drop('quiz_answers', 'qans_tenant_sub_q_idx');
        $this->drop('certificates', 'cert_tenant_issued_idx');
        $this->drop('certificates', 'cert_tenant_user_idx');
    }

    private function index(string $tableName, array $columns, string $indexName): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        foreach ($columns as $column) {
            if (! Schema::hasColumn($tableName, $column)) {
                return;
            }
        }

        Schema::table($tableName, function (Blueprint $table) use ($columns, $indexName) {
            $table->index($columns, $indexName);
        });
    }

    private function drop(string $tableName, string $indexName): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($indexName) {
            $table->dropIndex($indexName);
        });
    }
};
