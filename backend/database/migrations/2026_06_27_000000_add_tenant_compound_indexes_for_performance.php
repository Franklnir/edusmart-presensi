<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profiles', function (Blueprint $table) {
            $table->index(['tenant_id', 'role'], 'profiles_tenant_role_index');
        });

        Schema::table('absensi', function (Blueprint $table) {
            $table->index(['tenant_id', 'tanggal'], 'absensi_tenant_tanggal_index');
            $table->index(['tenant_id', 'uid', 'tanggal'], 'absensi_tenant_uid_tanggal_index');
        });

        Schema::table('tugas', function (Blueprint $table) {
            $table->index(['tenant_id', 'kelas'], 'tugas_tenant_kelas_index');
        });

        Schema::table('quizzes', function (Blueprint $table) {
            $table->index(['tenant_id', 'kelas_id'], 'quizzes_tenant_kelas_index');
        });

        Schema::table('tugas_jawaban', function (Blueprint $table) {
            $table->index(['tenant_id', 'user_id'], 'tugas_jawaban_tenant_user_index');
        });

        Schema::table('quiz_submissions', function (Blueprint $table) {
            $table->index(['tenant_id', 'siswa_id'], 'quiz_submissions_tenant_siswa_index');
        });
    }

    public function down(): void
    {
        Schema::table('profiles', function (Blueprint $table) {
            $table->dropIndex('profiles_tenant_role_index');
        });

        Schema::table('absensi', function (Blueprint $table) {
            $table->dropIndex('absensi_tenant_tanggal_index');
            $table->dropIndex('absensi_tenant_uid_tanggal_index');
        });

        Schema::table('tugas', function (Blueprint $table) {
            $table->dropIndex('tugas_tenant_kelas_index');
        });

        Schema::table('quizzes', function (Blueprint $table) {
            $table->dropIndex('quizzes_tenant_kelas_index');
        });

        Schema::table('tugas_jawaban', function (Blueprint $table) {
            $table->dropIndex('tugas_jawaban_tenant_user_index');
        });

        Schema::table('quiz_submissions', function (Blueprint $table) {
            $table->dropIndex('quiz_submissions_tenant_siswa_index');
        });
    }
};
