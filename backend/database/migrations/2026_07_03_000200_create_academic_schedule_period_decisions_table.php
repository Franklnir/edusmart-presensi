<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('academic_schedule_period_decisions')) {
            return;
        }

        Schema::create('academic_schedule_period_decisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->text('target_tahun_ajaran');
            $table->text('source_tahun_ajaran')->nullable();
            $table->text('decision');
            $table->integer('copied_count')->default(0);
            $table->uuid('decided_by')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'target_tahun_ajaran'], 'academic_schedule_decisions_target_unique');
            $table->index(['tenant_id', 'source_tahun_ajaran'], 'academic_schedule_decisions_source_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('academic_schedule_period_decisions');
    }
};
