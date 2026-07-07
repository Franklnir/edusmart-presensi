<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('quizzes')) {
            return;
        }

        Schema::table('quizzes', function (Blueprint $table) {
            if (! Schema::hasColumn('quizzes', 'copied_from_quiz_id')) {
                $table->string('copied_from_quiz_id', 64)->nullable();
                $table->index('copied_from_quiz_id', 'quizzes_copied_from_quiz_id_idx');
            }

            if (! Schema::hasColumn('quizzes', 'clone_code')) {
                $table->string('clone_code', 32)->nullable();
                $table->unique('clone_code', 'quizzes_clone_code_unique');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('quizzes')) {
            return;
        }

        Schema::table('quizzes', function (Blueprint $table) {
            if (Schema::hasColumn('quizzes', 'clone_code')) {
                try {
                    $table->dropUnique('quizzes_clone_code_unique');
                } catch (Throwable) {
                    // Ignore partial or legacy installs without the index.
                }
                $table->dropColumn('clone_code');
            }

            if (Schema::hasColumn('quizzes', 'copied_from_quiz_id')) {
                try {
                    $table->dropIndex('quizzes_copied_from_quiz_id_idx');
                } catch (Throwable) {
                    // Ignore partial or legacy installs without the index.
                }
                $table->dropColumn('copied_from_quiz_id');
            }
        });
    }
};
