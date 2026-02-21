<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('quizzes') || Schema::hasColumn('quizzes', 'result_visible_to_students')) {
            return;
        }

        Schema::table('quizzes', function (Blueprint $table) {
            $table->boolean('result_visible_to_students')->default(false)->after('penilaian');
            $table->index('result_visible_to_students');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('quizzes') || ! Schema::hasColumn('quizzes', 'result_visible_to_students')) {
            return;
        }

        Schema::table('quizzes', function (Blueprint $table) {
            $table->dropIndex(['result_visible_to_students']);
            $table->dropColumn('result_visible_to_students');
        });
    }
};
