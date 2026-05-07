<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('quiz_retake_logs')) {
            return;
        }

        Schema::create('quiz_retake_logs', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->uuid('tenant_id');
            $table->text('quiz_id');
            $table->uuid('siswa_id');
            $table->uuid('guru_id')->nullable();
            $table->text('submission_id')->nullable();
            $table->integer('previous_score')->nullable();
            $table->integer('previous_total_points')->nullable();
            $table->text('previous_status')->nullable();
            $table->timestampTz('previous_started_at')->nullable();
            $table->timestampTz('previous_finished_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['tenant_id', 'quiz_id']);
            $table->index(['tenant_id', 'siswa_id']);
            $table->index(['tenant_id', 'created_at']);
            $table->foreign('quiz_id')->references('id')->on('quizzes')->cascadeOnDelete();
            $table->foreign('siswa_id')->references('id')->on('profiles')->cascadeOnDelete();
            $table->foreign('guru_id')->references('id')->on('profiles')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quiz_retake_logs');
    }
};
