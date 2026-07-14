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
        Schema::table('rapot_siswa', function (Blueprint $table) {
            $table->integer('sakit')->default(0)->nullable();
            $table->integer('izin')->default(0)->nullable();
            $table->integer('alpa')->default(0)->nullable();
            $table->text('catatan_wali_kelas')->nullable();
            $table->string('status', 20)->default('draft')->nullable();
            $table->string('keputusan', 20)->nullable();
            $table->json('snapshot_data')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('rapot_siswa', function (Blueprint $table) {
            $table->dropColumn(['sakit', 'izin', 'alpa', 'catatan_wali_kelas', 'status', 'keputusan', 'snapshot_data']);
        });
    }
};
