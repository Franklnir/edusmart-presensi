<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('quiz_questions')) {
            Schema::table('quiz_questions', function (Blueprint $table) {
                if (! Schema::hasColumn('quiz_questions', 'image_path')) {
                    $table->text('image_path')->nullable();
                }
            });
        }

        if (Schema::hasTable('quiz_options')) {
            Schema::table('quiz_options', function (Blueprint $table) {
                if (! Schema::hasColumn('quiz_options', 'image_path')) {
                    $table->text('image_path')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('quiz_options')) {
            Schema::table('quiz_options', function (Blueprint $table) {
                if (Schema::hasColumn('quiz_options', 'image_path')) {
                    $table->dropColumn('image_path');
                }
            });
        }

        if (Schema::hasTable('quiz_questions')) {
            Schema::table('quiz_questions', function (Blueprint $table) {
                if (Schema::hasColumn('quiz_questions', 'image_path')) {
                    $table->dropColumn('image_path');
                }
            });
        }
    }
};
