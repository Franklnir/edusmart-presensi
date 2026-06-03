<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $indexes = [
        'quiz_submissions_tenant_status_idx' => [
            'table' => 'quiz_submissions',
            'columns' => ['tenant_id', 'status'],
        ],
        'quiz_submissions_tenant_status_updated_idx' => [
            'table' => 'quiz_submissions',
            'columns' => ['tenant_id', 'status', 'updated_at'],
        ],
        'quiz_violation_submission_type_created_idx' => [
            'table' => 'quiz_violation_logs',
            'columns' => ['submission_id', 'event_type', 'created_at'],
        ],
        'quiz_questions_tenant_quiz_idx' => [
            'table' => 'quiz_questions',
            'columns' => ['tenant_id', 'quiz_id'],
        ],
        'quiz_options_tenant_question_idx' => [
            'table' => 'quiz_options',
            'columns' => ['tenant_id', 'question_id'],
        ],
        'quizzes_is_active_is_live_idx' => [
            'table' => 'quizzes',
            'columns' => ['is_active', 'is_live'],
        ],
    ];

    public function up(): void
    {
        foreach ($this->indexes as $indexName => $definition) {
            if (! $this->allColumnsExist($definition['table'], $definition['columns'])) {
                continue;
            }

            DB::statement(sprintf(
                'CREATE INDEX IF NOT EXISTS %s ON %s (%s)',
                $indexName,
                $definition['table'],
                implode(', ', $definition['columns'])
            ));
        }
    }

    public function down(): void
    {
        foreach (array_keys($this->indexes) as $indexName) {
            DB::statement(sprintf('DROP INDEX IF EXISTS %s', $indexName));
        }
    }

    private function allColumnsExist(string $table, array $columns): bool
    {
        if (! Schema::hasTable($table)) {
            return false;
        }

        foreach ($columns as $column) {
            if (! Schema::hasColumn($table, $column)) {
                return false;
            }
        }

        return true;
    }
};
