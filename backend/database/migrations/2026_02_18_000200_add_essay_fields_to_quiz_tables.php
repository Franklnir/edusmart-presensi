<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private const QUIZ_QUESTION_TYPE_INDEX = 'quiz_questions_quiz_id_question_type_idx';

    public function up(): void
    {
        if (Schema::hasTable('quiz_questions')) {
            Schema::table('quiz_questions', function (Blueprint $table) {
                if (! Schema::hasColumn('quiz_questions', 'question_type')) {
                    $table->text('question_type')->default('mcq');
                    $table->index(['quiz_id', 'question_type'], self::QUIZ_QUESTION_TYPE_INDEX);
                }
            });
        }

        if (Schema::hasTable('quiz_answers')) {
            Schema::table('quiz_answers', function (Blueprint $table) {
                if (! Schema::hasColumn('quiz_answers', 'essay_answer')) {
                    $table->text('essay_answer')->nullable();
                }
                if (! Schema::hasColumn('quiz_answers', 'essay_score')) {
                    $table->integer('essay_score')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('quiz_answers')) {
            Schema::table('quiz_answers', function (Blueprint $table) {
                if (Schema::hasColumn('quiz_answers', 'essay_score')) {
                    $table->dropColumn('essay_score');
                }
                if (Schema::hasColumn('quiz_answers', 'essay_answer')) {
                    $table->dropColumn('essay_answer');
                }
            });
        }

        if (Schema::hasTable('quiz_questions')) {
            Schema::table('quiz_questions', function (Blueprint $table) {
                if (Schema::hasColumn('quiz_questions', 'question_type')) {
                    $table->dropIndex(self::QUIZ_QUESTION_TYPE_INDEX);
                    $table->dropColumn('question_type');
                }
            });
        }
    }
};
