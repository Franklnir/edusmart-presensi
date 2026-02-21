<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('settings')) {
            return;
        }

        Schema::table('settings', function (Blueprint $table) {
            if (! Schema::hasColumn('settings', 'ranking_weight_tugas')) {
                $table->decimal('ranking_weight_tugas', 5, 2)->default(40);
            }
            if (! Schema::hasColumn('settings', 'ranking_weight_quiz')) {
                $table->decimal('ranking_weight_quiz', 5, 2)->default(40);
            }
            if (! Schema::hasColumn('settings', 'ranking_weight_absensi')) {
                $table->decimal('ranking_weight_absensi', 5, 2)->default(20);
            }
            if (! Schema::hasColumn('settings', 'ranking_tiebreak_order')) {
                $table->text('ranking_tiebreak_order')->nullable();
            }
            if (! Schema::hasColumn('settings', 'ranking_core_mapel')) {
                $table->text('ranking_core_mapel')->nullable();
            }
            if (! Schema::hasColumn('settings', 'ranking_policy_updated_at')) {
                $table->timestampTz('ranking_policy_updated_at')->nullable();
            }

            if (! Schema::hasColumn('settings', 'nilai_freeze_enabled')) {
                $table->boolean('nilai_freeze_enabled')->default(false);
            }
            if (! Schema::hasColumn('settings', 'nilai_freeze_start')) {
                $table->timestampTz('nilai_freeze_start')->nullable();
            }
            if (! Schema::hasColumn('settings', 'nilai_freeze_end')) {
                $table->timestampTz('nilai_freeze_end')->nullable();
            }
            if (! Schema::hasColumn('settings', 'nilai_freeze_reason')) {
                $table->text('nilai_freeze_reason')->nullable();
            }
            if (! Schema::hasColumn('settings', 'nilai_freeze_updated_by')) {
                $table->uuid('nilai_freeze_updated_by')->nullable();
            }
            if (! Schema::hasColumn('settings', 'nilai_freeze_updated_at')) {
                $table->timestampTz('nilai_freeze_updated_at')->nullable();
            }
        });

        $now = now();

        DB::table('settings')
            ->whereNull('ranking_weight_tugas')
            ->update(['ranking_weight_tugas' => 40, 'updated_at' => $now]);

        DB::table('settings')
            ->whereNull('ranking_weight_quiz')
            ->update(['ranking_weight_quiz' => 40, 'updated_at' => $now]);

        DB::table('settings')
            ->whereNull('ranking_weight_absensi')
            ->update(['ranking_weight_absensi' => 20, 'updated_at' => $now]);

        DB::table('settings')
            ->whereNull('nilai_freeze_enabled')
            ->update(['nilai_freeze_enabled' => false, 'updated_at' => $now]);
    }

    public function down(): void
    {
        // Repair migration, intentionally no rollback drop.
    }
};
