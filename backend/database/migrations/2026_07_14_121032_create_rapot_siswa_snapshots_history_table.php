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
        Schema::create('rapot_siswa_snapshots_history', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('rapot_siswa_id');
            $table->uuid('tenant_id');
            $table->jsonb('snapshot_data');
            $table->string('reason')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestamps();

            $table->foreign('rapot_siswa_id')->references('id')->on('rapot_siswa')->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('rapot_siswa_snapshots_history');
    }
};
