<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('quizzes')) {
            Schema::table('quizzes', function (Blueprint $table) {
                if (! Schema::hasColumn('quizzes', 'shuffle_questions')) {
                    $table->boolean('shuffle_questions')->default(false);
                }
                if (! Schema::hasColumn('quizzes', 'shuffle_options')) {
                    $table->boolean('shuffle_options')->default(false);
                }
                if (! Schema::hasColumn('quizzes', 'access_code_hash')) {
                    $table->text('access_code_hash')->nullable();
                }
                if (! Schema::hasColumn('quizzes', 'max_attempts')) {
                    $table->integer('max_attempts')->nullable();
                }
                if (! Schema::hasColumn('quizzes', 'security_mode')) {
                    $table->text('security_mode')->default('standard');
                }
                if (! Schema::hasColumn('quizzes', 'timezone')) {
                    $table->text('timezone')->nullable();
                }
                if (! Schema::hasColumn('quizzes', 'published_at')) {
                    $table->timestampTz('published_at')->nullable();
                    $table->index('published_at', 'quizzes_published_at_idx');
                }
                if (! Schema::hasColumn('quizzes', 'closed_at')) {
                    $table->timestampTz('closed_at')->nullable();
                    $table->index('closed_at', 'quizzes_closed_at_idx');
                }
            });
        }

        if (Schema::hasTable('quiz_submissions')) {
            Schema::table('quiz_submissions', function (Blueprint $table) {
                if (! Schema::hasColumn('quiz_submissions', 'attempt_no')) {
                    $table->integer('attempt_no')->default(1);
                }
                if (! Schema::hasColumn('quiz_submissions', 'answer_order')) {
                    $table->jsonb('answer_order')->nullable();
                }
                if (! Schema::hasColumn('quiz_submissions', 'last_saved_at')) {
                    $table->timestampTz('last_saved_at')->nullable();
                    $table->index('last_saved_at', 'quiz_submissions_last_saved_at_idx');
                }
                if (! Schema::hasColumn('quiz_submissions', 'client_meta')) {
                    $table->jsonb('client_meta')->nullable();
                }
                if (! Schema::hasColumn('quiz_submissions', 'access_granted_at')) {
                    $table->timestampTz('access_granted_at')->nullable();
                }
            });
        }

        if (Schema::hasTable('quiz_answers')) {
            Schema::table('quiz_answers', function (Blueprint $table) {
                if (! Schema::hasColumn('quiz_answers', 'saved_at')) {
                    $table->timestampTz('saved_at')->nullable();
                    $table->index('saved_at', 'quiz_answers_saved_at_idx');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('quiz_answers')) {
            Schema::table('quiz_answers', function (Blueprint $table) {
                if (Schema::hasColumn('quiz_answers', 'saved_at')) {
                    $table->dropIndex('quiz_answers_saved_at_idx');
                    $table->dropColumn('saved_at');
                }
            });
        }

        if (Schema::hasTable('quiz_submissions')) {
            Schema::table('quiz_submissions', function (Blueprint $table) {
                if (Schema::hasColumn('quiz_submissions', 'access_granted_at')) {
                    $table->dropColumn('access_granted_at');
                }
                if (Schema::hasColumn('quiz_submissions', 'client_meta')) {
                    $table->dropColumn('client_meta');
                }
                if (Schema::hasColumn('quiz_submissions', 'last_saved_at')) {
                    $table->dropIndex('quiz_submissions_last_saved_at_idx');
                    $table->dropColumn('last_saved_at');
                }
                if (Schema::hasColumn('quiz_submissions', 'answer_order')) {
                    $table->dropColumn('answer_order');
                }
                if (Schema::hasColumn('quiz_submissions', 'attempt_no')) {
                    $table->dropColumn('attempt_no');
                }
            });
        }

        if (Schema::hasTable('quizzes')) {
            Schema::table('quizzes', function (Blueprint $table) {
                if (Schema::hasColumn('quizzes', 'closed_at')) {
                    $table->dropIndex('quizzes_closed_at_idx');
                    $table->dropColumn('closed_at');
                }
                if (Schema::hasColumn('quizzes', 'published_at')) {
                    $table->dropIndex('quizzes_published_at_idx');
                    $table->dropColumn('published_at');
                }
                foreach ([
                    'timezone',
                    'security_mode',
                    'max_attempts',
                    'access_code_hash',
                    'shuffle_options',
                    'shuffle_questions',
                ] as $column) {
                    if (Schema::hasColumn('quizzes', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }
};
