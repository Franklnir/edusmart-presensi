<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('tugas', function (Blueprint $table) {
            $table->json('attachment_ids')->nullable();
        });

        Schema::table('tugas_jawaban', function (Blueprint $table) {
            $table->json('attachment_ids')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('tugas', function (Blueprint $table) {
            $table->dropColumn('attachment_ids');
        });

        Schema::table('tugas_jawaban', function (Blueprint $table) {
            $table->dropColumn('attachment_ids');
        });
    }
};
