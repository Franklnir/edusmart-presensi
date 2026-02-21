<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('quizzes') || Schema::hasColumn('quizzes', 'starts_at')) {
            return;
        }

        Schema::table('quizzes', function (Blueprint $table) {
            $table->timestampTz('starts_at')->nullable()->after('nama');
            $table->index('starts_at');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('quizzes') || ! Schema::hasColumn('quizzes', 'starts_at')) {
            return;
        }

        Schema::table('quizzes', function (Blueprint $table) {
            $table->dropIndex(['starts_at']);
            $table->dropColumn('starts_at');
        });
    }
};
