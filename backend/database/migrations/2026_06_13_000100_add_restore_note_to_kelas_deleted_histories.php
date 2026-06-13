<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('kelas_deleted_histories')) {
            return;
        }

        if (Schema::hasColumn('kelas_deleted_histories', 'restore_note')) {
            return;
        }

        Schema::table('kelas_deleted_histories', function (Blueprint $table) {
            $table->text('restore_note')->nullable()->after('restored_at');
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('kelas_deleted_histories') && Schema::hasColumn('kelas_deleted_histories', 'restore_note')) {
            Schema::table('kelas_deleted_histories', function (Blueprint $table) {
                $table->dropColumn('restore_note');
            });
        }
    }
};
