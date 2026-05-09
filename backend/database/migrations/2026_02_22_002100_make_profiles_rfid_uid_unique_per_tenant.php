<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('profiles') || ! Schema::hasColumn('profiles', 'rfid_uid')) {
            return;
        }

        $driver = DB::getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_rfid_uid_unique');
            DB::statement('DROP INDEX IF EXISTS profiles_rfid_uid_unique');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS profiles_tenant_rfid_uid_unique ON profiles (tenant_id, rfid_uid) WHERE rfid_uid IS NOT NULL');

            return;
        }

        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            try {
                DB::statement('ALTER TABLE profiles DROP INDEX profiles_rfid_uid_unique');
            } catch (Throwable $e) {
                // ignore when old index is absent
            }
            DB::statement('CREATE UNIQUE INDEX profiles_tenant_rfid_uid_unique ON profiles (tenant_id, rfid_uid)');
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('profiles') || ! Schema::hasColumn('profiles', 'rfid_uid')) {
            return;
        }

        $driver = DB::getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS profiles_tenant_rfid_uid_unique');
            DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS profiles_rfid_uid_unique ON profiles (rfid_uid) WHERE rfid_uid IS NOT NULL');

            return;
        }

        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            try {
                DB::statement('DROP INDEX profiles_tenant_rfid_uid_unique ON profiles');
            } catch (Throwable $e) {
                // ignore when index is absent
            }
            DB::statement('CREATE UNIQUE INDEX profiles_rfid_uid_unique ON profiles (rfid_uid)');
        }
    }
};
