<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
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
    }

    public function down(): void
    {
        if (! Schema::hasTable('settings')) {
            return;
        }

        $columnsToDrop = [
            'ranking_weight_tugas',
            'ranking_weight_quiz',
            'ranking_weight_absensi',
            'ranking_tiebreak_order',
            'ranking_core_mapel',
            'ranking_policy_updated_at',
            'nilai_freeze_enabled',
            'nilai_freeze_start',
            'nilai_freeze_end',
            'nilai_freeze_reason',
            'nilai_freeze_updated_by',
            'nilai_freeze_updated_at',
        ];

        $existingColumns = array_values(array_filter($columnsToDrop, fn (string $column) => Schema::hasColumn('settings', $column)));

        if (empty($existingColumns)) {
            return;
        }

        Schema::table('settings', function (Blueprint $table) use ($existingColumns) {
            $table->dropColumn($existingColumns);
        });
    }
};
