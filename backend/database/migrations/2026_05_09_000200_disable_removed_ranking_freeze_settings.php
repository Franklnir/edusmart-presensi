<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('settings')) {
            return;
        }

        $updates = [];
        $now = now();

        $defaults = [
            'ranking_weight_tugas' => 40,
            'ranking_weight_quiz' => 40,
            'ranking_weight_absensi' => 20,
            'ranking_tiebreak_order' => json_encode(['nilai_akhir', 'mapel_inti', 'absensi', 'nama']),
            'ranking_core_mapel' => json_encode([]),
            'ranking_policy_updated_at' => null,
            'nilai_freeze_enabled' => false,
            'nilai_freeze_start' => null,
            'nilai_freeze_end' => null,
            'nilai_freeze_reason' => null,
            'nilai_freeze_updated_by' => null,
            'nilai_freeze_updated_at' => null,
        ];

        foreach ($defaults as $column => $value) {
            if (Schema::hasColumn('settings', $column)) {
                $updates[$column] = $value;
            }
        }

        if (Schema::hasColumn('settings', 'updated_at')) {
            $updates['updated_at'] = $now;
        }

        if ($updates !== []) {
            DB::table('settings')->update($updates);
        }
    }

    public function down(): void
    {
        // Data-only migration: intentionally not restored.
    }
};
