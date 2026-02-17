<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('quizzes', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->uuid('guru_id');
            $table->text('kelas_id');
            $table->text('mapel');
            $table->text('nama');
            $table->timestampTz('deadline_at')->nullable();
            $table->text('penilaian')->nullable();
            $table->boolean('is_live')->default(false);
            $table->boolean('is_active')->default(false);
            $table->timestampTz('live_started_at')->nullable();
            $table->integer('duration_minutes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['kelas_id']);
            $table->index(['guru_id']);
            $table->foreign('guru_id')->references('id')->on('profiles');
        });

        Schema::create('quiz_questions', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('quiz_id');
            $table->integer('nomor')->default(1);
            $table->text('soal');
            $table->integer('poin')->default(1);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['quiz_id']);
            $table->foreign('quiz_id')->references('id')->on('quizzes')->cascadeOnDelete();
        });

        Schema::create('quiz_options', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('question_id');
            $table->text('label');
            $table->text('text');
            $table->boolean('is_correct')->default(false);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['question_id']);
            $table->foreign('question_id')->references('id')->on('quiz_questions')->cascadeOnDelete();
        });

        Schema::create('quiz_submissions', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('quiz_id');
            $table->uuid('siswa_id');
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->integer('score')->nullable();
            $table->integer('total_points')->nullable();
            $table->text('status')->default('ongoing');
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(['quiz_id', 'siswa_id']);
            $table->index(['quiz_id']);
            $table->index(['siswa_id']);
            $table->foreign('quiz_id')->references('id')->on('quizzes')->cascadeOnDelete();
            $table->foreign('siswa_id')->references('id')->on('profiles')->cascadeOnDelete();
        });

        Schema::create('quiz_answers', function (Blueprint $table) {
            $table->text('id')->primary();
            $table->text('submission_id');
            $table->text('question_id');
            $table->text('option_id')->nullable();
            $table->boolean('is_correct')->default(false);
            $table->integer('poin')->default(0);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(['submission_id', 'question_id']);
            $table->index(['submission_id']);
            $table->foreign('submission_id')->references('id')->on('quiz_submissions')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quiz_answers');
        Schema::dropIfExists('quiz_submissions');
        Schema::dropIfExists('quiz_options');
        Schema::dropIfExists('quiz_questions');
        Schema::dropIfExists('quizzes');
    }
};
