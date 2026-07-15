<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['upload_sessions', 'attachments'] as $tableName) {
            if (! Schema::hasTable($tableName) || Schema::hasColumn($tableName, 'quiz_id')) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) {
                $table->text('quiz_id')->nullable()->index();
            });
        }
    }

    public function down(): void
    {
        foreach (['attachments', 'upload_sessions'] as $tableName) {
            if (Schema::hasTable($tableName) && Schema::hasColumn($tableName, 'quiz_id')) {
                Schema::table($tableName, function (Blueprint $table) {
                    $table->dropColumn('quiz_id');
                });
            }
        }
    }
};
