<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('academic_rollover_exceptions')) {
            return;
        }

        Schema::create('academic_rollover_exceptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('student_id');
            $table->text('source_tahun_ajaran');
            $table->text('target_tahun_ajaran');
            $table->text('reason')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(
                ['tenant_id', 'student_id', 'source_tahun_ajaran', 'target_tahun_ajaran'],
                'academic_rollover_exceptions_unique'
            );
            $table->index(['tenant_id', 'source_tahun_ajaran', 'target_tahun_ajaran'], 'academic_rollover_exceptions_period_idx');
            $table->index(['tenant_id', 'resolved_at'], 'academic_rollover_exceptions_resolved_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('student_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('academic_rollover_exceptions');
    }
};
