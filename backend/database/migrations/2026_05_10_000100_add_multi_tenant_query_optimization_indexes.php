<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $indexes = [
        'profiles_tenant_role_kelas_status_idx' => [
            'table' => 'profiles',
            'columns' => ['tenant_id', 'role', 'kelas', 'status'],
        ],
        'profiles_tenant_role_status_nama_idx' => [
            'table' => 'profiles',
            'columns' => ['tenant_id', 'role', 'status', 'nama'],
        ],
        'absensi_tenant_kelas_mapel_tanggal_idx' => [
            'table' => 'absensi',
            'columns' => ['tenant_id', 'kelas', 'mapel', 'tanggal'],
        ],
        'absensi_tenant_uid_tanggal_idx' => [
            'table' => 'absensi',
            'columns' => ['tenant_id', 'uid', 'tanggal'],
        ],
        'absensi_ajuan_tenant_guru_status_tanggal_idx' => [
            'table' => 'absensi_ajuan',
            'columns' => ['tenant_id', 'guru_id', 'status_guru', 'tanggal'],
        ],
        'tugas_tenant_kelas_mapel_created_idx' => [
            'table' => 'tugas',
            'columns' => ['tenant_id', 'kelas', 'mapel', 'created_at'],
        ],
        'tugas_tenant_created_by_created_idx' => [
            'table' => 'tugas',
            'columns' => ['tenant_id', 'created_by', 'created_at'],
        ],
        'tugas_jawaban_tenant_tugas_user_idx' => [
            'table' => 'tugas_jawaban',
            'columns' => ['tenant_id', 'tugas_id', 'user_id'],
        ],
        'tugas_jawaban_tenant_user_tugas_idx' => [
            'table' => 'tugas_jawaban',
            'columns' => ['tenant_id', 'user_id', 'tugas_id'],
        ],
        'tugas_jawaban_tenant_period_user_idx' => [
            'table' => 'tugas_jawaban',
            'columns' => ['tenant_id', 'tahun_ajaran', 'semester', 'angkatan', 'user_id'],
        ],
        'quizzes_tenant_kelas_mapel_created_idx' => [
            'table' => 'quizzes',
            'columns' => ['tenant_id', 'kelas_id', 'mapel', 'created_at'],
        ],
        'quizzes_tenant_guru_kelas_idx' => [
            'table' => 'quizzes',
            'columns' => ['tenant_id', 'guru_id', 'kelas_id'],
        ],
        'quiz_questions_quiz_nomor_idx' => [
            'table' => 'quiz_questions',
            'columns' => ['quiz_id', 'nomor'],
        ],
        'quiz_options_question_label_idx' => [
            'table' => 'quiz_options',
            'columns' => ['question_id', 'label'],
        ],
        'quiz_submissions_tenant_quiz_siswa_idx' => [
            'table' => 'quiz_submissions',
            'columns' => ['tenant_id', 'quiz_id', 'siswa_id'],
        ],
        'quiz_submissions_tenant_siswa_quiz_idx' => [
            'table' => 'quiz_submissions',
            'columns' => ['tenant_id', 'siswa_id', 'quiz_id'],
        ],
        'quiz_submissions_tenant_period_siswa_idx' => [
            'table' => 'quiz_submissions',
            'columns' => ['tenant_id', 'tahun_ajaran', 'semester', 'angkatan', 'siswa_id'],
        ],
        'quiz_answers_tenant_submission_question_idx' => [
            'table' => 'quiz_answers',
            'columns' => ['tenant_id', 'submission_id', 'question_id'],
        ],
        'user_presence_tenant_role_last_seen_idx' => [
            'table' => 'user_presence',
            'columns' => ['tenant_id', 'role', 'last_seen_at'],
        ],
        'audit_log_tenant_timestamp_idx' => [
            'table' => 'audit_log',
            'columns' => ['tenant_id', 'timestamp'],
        ],
    ];

    public function up(): void
    {
        foreach ($this->indexes as $indexName => $definition) {
            $this->createIndexIfColumnsExist(
                $definition['table'],
                $indexName,
                $definition['columns']
            );
        }
    }

    public function down(): void
    {
        foreach (array_keys($this->indexes) as $indexName) {
            DB::statement(sprintf('DROP INDEX IF EXISTS %s', $indexName));
        }
    }

    private function createIndexIfColumnsExist(string $tableName, string $indexName, array $columns): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        foreach ($columns as $column) {
            if (! Schema::hasColumn($tableName, $column)) {
                return;
            }
        }

        $columnList = implode(', ', $columns);
        DB::statement(sprintf(
            'CREATE INDEX IF NOT EXISTS %s ON %s (%s)',
            $indexName,
            $tableName,
            $columnList
        ));
    }
};
