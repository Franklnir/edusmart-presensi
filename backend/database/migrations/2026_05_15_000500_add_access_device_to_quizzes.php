<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('quizzes')) {
            Schema::table('quizzes', function (Blueprint $table) {
                if (! Schema::hasColumn('quizzes', 'access_device')) {
                    $table->text('access_device')->default('both');
                }
            });

            if (Schema::hasColumn('quizzes', 'access_device')) {
                DB::table('quizzes')
                    ->where(function ($query) {
                        $query->whereNull('access_device')
                            ->orWhere('access_device', '');
                    })
                    ->update(['access_device' => 'both']);
            }

            Schema::table('quizzes', function (Blueprint $table) {
                if (Schema::hasColumn('quizzes', 'access_device')) {
                    try {
                        $table->index('access_device', 'quizzes_access_device_idx');
                    } catch (Throwable $e) {
                        // Older installs may already have the index after a partial migration.
                    }
                }
            });
        }

        if (Schema::hasTable('quiz_submissions')) {
            Schema::table('quiz_submissions', function (Blueprint $table) {
                if (! Schema::hasColumn('quiz_submissions', 'client_device')) {
                    $table->text('client_device')->nullable();
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('quiz_submissions') && Schema::hasColumn('quiz_submissions', 'client_device')) {
            Schema::table('quiz_submissions', function (Blueprint $table) {
                $table->dropColumn('client_device');
            });
        }

        if (Schema::hasTable('quizzes') && Schema::hasColumn('quizzes', 'access_device')) {
            Schema::table('quizzes', function (Blueprint $table) {
                try {
                    $table->dropIndex('quizzes_access_device_idx');
                } catch (Throwable $e) {
                    // Ignore when the index is absent.
                }
                $table->dropColumn('access_device');
            });
        }
    }
};
