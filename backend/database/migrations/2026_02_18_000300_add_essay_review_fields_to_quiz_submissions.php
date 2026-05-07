<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('quiz_submissions')) {
            return;
        }

        Schema::table('quiz_submissions', function (Blueprint $table) {
            if (! Schema::hasColumn('quiz_submissions', 'essay_review_completed_at')) {
                $table->timestampTz('essay_review_completed_at')->nullable();
                $table->index('essay_review_completed_at', 'quiz_submissions_essay_review_completed_at_idx');
            }
            if (! Schema::hasColumn('quiz_submissions', 'essay_review_completed_by')) {
                $table->uuid('essay_review_completed_by')->nullable();
                $table->index('essay_review_completed_by', 'quiz_submissions_essay_review_completed_by_idx');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('quiz_submissions')) {
            return;
        }

        Schema::table('quiz_submissions', function (Blueprint $table) {
            if (Schema::hasColumn('quiz_submissions', 'essay_review_completed_by')) {
                $table->dropIndex('quiz_submissions_essay_review_completed_by_idx');
                $table->dropColumn('essay_review_completed_by');
            }
            if (Schema::hasColumn('quiz_submissions', 'essay_review_completed_at')) {
                $table->dropIndex('quiz_submissions_essay_review_completed_at_idx');
                $table->dropColumn('essay_review_completed_at');
            }
        });
    }
};
