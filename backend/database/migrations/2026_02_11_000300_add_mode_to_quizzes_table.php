<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('quizzes') || Schema::hasColumn('quizzes', 'mode')) {
            return;
        }

        Schema::table('quizzes', function (Blueprint $table) {
            $table->text('mode')->default('regular')->after('penilaian');
            $table->index('mode');
        });
    }

    public function down(): void
    {
        if (!Schema::hasTable('quizzes') || !Schema::hasColumn('quizzes', 'mode')) {
            return;
        }

        Schema::table('quizzes', function (Blueprint $table) {
            $table->dropIndex(['mode']);
            $table->dropColumn('mode');
        });
    }
};

