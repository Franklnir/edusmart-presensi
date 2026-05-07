<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('quiz_violation_logs')) {
            return;
        }

        Schema::create('quiz_violation_logs', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->uuid('tenant_id');
            $table->text('quiz_id');
            $table->text('submission_id');
            $table->uuid('siswa_id');
            $table->text('event_type')->default('warning');
            $table->text('event_message')->nullable();
            $table->jsonb('event_meta')->nullable();
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['tenant_id', 'quiz_id']);
            $table->index(['tenant_id', 'siswa_id']);
            $table->index(['tenant_id', 'submission_id']);
            $table->index(['tenant_id', 'created_at']);

            $table->foreign('quiz_id')->references('id')->on('quizzes')->cascadeOnDelete();
            $table->foreign('submission_id')->references('id')->on('quiz_submissions')->cascadeOnDelete();
            $table->foreign('siswa_id')->references('id')->on('profiles')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quiz_violation_logs');
    }
};
