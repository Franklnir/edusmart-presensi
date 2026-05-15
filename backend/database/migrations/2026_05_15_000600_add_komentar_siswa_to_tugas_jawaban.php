<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('tugas_jawaban') || Schema::hasColumn('tugas_jawaban', 'komentar_siswa')) {
            return;
        }

        Schema::table('tugas_jawaban', function (Blueprint $table) {
            $table->text('komentar_siswa')->nullable()->after('link_url');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('tugas_jawaban') || ! Schema::hasColumn('tugas_jawaban', 'komentar_siswa')) {
            return;
        }

        Schema::table('tugas_jawaban', function (Blueprint $table) {
            $table->dropColumn('komentar_siswa');
        });
    }
};
