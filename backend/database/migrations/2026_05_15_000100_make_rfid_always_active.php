<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->normalizeLegacyRfidSettings();

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $this->removeLegacyRfidGateFromFunction();
    }

    public function down(): void
    {
        // RFID sengaja dibiarkan selalu aktif. Pengaturan lama tidak direstorasi.
    }

    private function normalizeLegacyRfidSettings(): void
    {
        if (
            ! Schema::hasTable('absensi_rfid_settings') ||
            ! Schema::hasColumn('absensi_rfid_settings', 'rfid_aktif')
        ) {
            return;
        }

        $payload = ['rfid_aktif' => true];
        if (Schema::hasColumn('absensi_rfid_settings', 'rfid_mulai')) {
            $payload['rfid_mulai'] = null;
        }
        if (Schema::hasColumn('absensi_rfid_settings', 'rfid_selesai')) {
            $payload['rfid_selesai'] = null;
        }
        if (Schema::hasColumn('absensi_rfid_settings', 'updated_at')) {
            $payload['updated_at'] = now();
        }

        DB::table('absensi_rfid_settings')->update($payload);
    }

    private function removeLegacyRfidGateFromFunction(): void
    {
        try {
            $row = DB::selectOne(
                "select pg_get_functiondef('public.absensi_rfid_auto(text,text,uuid)'::regprocedure) as definition"
            );
        } catch (\Throwable $e) {
            return;
        }

        $definition = (string) ($row->definition ?? '');
        if ($definition === '') {
            return;
        }

        $disabledBlock = <<<'SQL'
  IF FOUND AND NOT coalesce(v_rfid_settings.rfid_aktif, false) THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'rfid_disabled',
      'message', 'Fitur RFID sedang non-aktif',
      'card_uid', v_card_uid,
      'device_id', p_device_id,
      'waktu', v_now
    );
  END IF;
SQL;

        $windowBlock = <<<'SQL'
  IF FOUND
     AND coalesce(v_rfid_settings.rfid_aktif, false)
     AND v_rfid_settings.rfid_mulai IS NOT NULL
     AND v_rfid_settings.rfid_selesai IS NOT NULL
     AND NOT (v_time BETWEEN v_rfid_settings.rfid_mulai AND v_rfid_settings.rfid_selesai)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'outside_rfid_window',
      'message', 'Di luar rentang jam RFID',
      'card_uid', v_card_uid,
      'device_id', p_device_id,
      'waktu', v_now
    );
  END IF;
SQL;

        $nextDefinition = str_replace(
            [$disabledBlock, $windowBlock],
            [
                '  -- RFID selalu aktif; switch aktif/nonaktif lama tidak lagi digunakan.',
                '  -- Rentang jam RFID lama diabaikan. Pembatasan waktu mengikuti sesi scan/jadwal.',
            ],
            $definition
        );

        if ($nextDefinition !== $definition) {
            DB::unprepared($nextDefinition);
        }
    }
};
