<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $this->replaceManualModeExpression(
            'v_manual_enabled := coalesce(v_settings.scan_manual_enabled, false);',
            "v_manual_enabled := coalesce(v_settings.scan_always_active, false)\n    OR coalesce(v_settings.scan_manual_enabled, false);"
        );
    }

    public function down(): void
    {
        $this->replaceManualModeExpression(
            "v_manual_enabled := coalesce(v_settings.scan_always_active, false)\n    OR coalesce(v_settings.scan_manual_enabled, false);",
            'v_manual_enabled := coalesce(v_settings.scan_manual_enabled, false);'
        );
    }

    private function replaceManualModeExpression(string $from, string $to): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        try {
            $row = DB::selectOne(
                "select pg_get_functiondef('public.absensi_rfid_auto(text,text,uuid)'::regprocedure) as definition"
            );
        } catch (Throwable $e) {
            return;
        }

        $definition = (string) ($row->definition ?? '');
        if ($definition === '' || ! str_contains($definition, $from)) {
            return;
        }

        DB::unprepared(str_replace($from, $to, $definition));
    }
};
