<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('rfid_device_events')) {
            return;
        }

        $driver = DB::getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE rfid_device_events DROP CONSTRAINT IF EXISTS rfid_device_events_device_event_unique');
            DB::statement('DROP INDEX IF EXISTS rfid_device_events_device_event_unique');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS rfid_device_events_tenant_device_event_unique ON rfid_device_events (tenant_id, device_id, event_id)');

            return;
        }

        if ($driver === 'sqlite') {
            DB::statement('DROP INDEX IF EXISTS rfid_device_events_device_event_unique');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS rfid_device_events_tenant_device_event_unique ON rfid_device_events (tenant_id, device_id, event_id)');

            return;
        }

        try {
            DB::statement('ALTER TABLE rfid_device_events DROP INDEX rfid_device_events_device_event_unique');
        } catch (Throwable $e) {
            // Index lama mungkin sudah tidak ada di environment tertentu.
        }

        try {
            DB::statement('CREATE UNIQUE INDEX rfid_device_events_tenant_device_event_unique ON rfid_device_events (tenant_id, device_id, event_id)');
        } catch (Throwable $e) {
            // Biarkan migration idempotent saat index sudah dibuat manual.
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('rfid_device_events')) {
            return;
        }

        $driver = DB::getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS rfid_device_events_tenant_device_event_unique');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS rfid_device_events_device_event_unique ON rfid_device_events (device_id, event_id)');

            return;
        }

        if ($driver === 'sqlite') {
            DB::statement('DROP INDEX IF EXISTS rfid_device_events_tenant_device_event_unique');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS rfid_device_events_device_event_unique ON rfid_device_events (device_id, event_id)');

            return;
        }

        try {
            DB::statement('ALTER TABLE rfid_device_events DROP INDEX rfid_device_events_tenant_device_event_unique');
        } catch (Throwable $e) {
            // Index tenant-scoped mungkin belum dibuat.
        }

        try {
            DB::statement('CREATE UNIQUE INDEX rfid_device_events_device_event_unique ON rfid_device_events (device_id, event_id)');
        } catch (Throwable $e) {
            // Biarkan rollback idempotent saat index lama sudah ada.
        }
    }
};
