<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('tugas') || Schema::hasColumn('tugas', 'mulai')) {
            return;
        }

        Schema::table('tugas', function (Blueprint $table) {
            $table->timestampTz('mulai')->nullable()->after('mapel');
            $table->index('mulai');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('tugas') || ! Schema::hasColumn('tugas', 'mulai')) {
            return;
        }

        Schema::table('tugas', function (Blueprint $table) {
            $table->dropIndex(['mulai']);
            $table->dropColumn('mulai');
        });
    }
};
