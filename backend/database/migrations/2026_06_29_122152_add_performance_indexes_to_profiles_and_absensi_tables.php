<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $driver = DB::getDriverName();

        if (Schema::hasTable('profiles') && Schema::hasColumn('profiles', 'tenant_id') && Schema::hasColumn('profiles', 'role')) {
            if ($driver === 'pgsql') {
                DB::statement('CREATE INDEX IF NOT EXISTS profiles_tenant_role_idx ON profiles (tenant_id, role)');
            } else {
                Schema::table('profiles', function (Blueprint $table) {
                    $table->index(['tenant_id', 'role'], 'profiles_tenant_role_idx');
                });
            }
        }

        if (
            Schema::hasTable('absensi')
            && Schema::hasColumn('absensi', 'tenant_id')
            && Schema::hasColumn('absensi', 'tanggal')
        ) {
            if ($driver === 'pgsql') {
                DB::statement('CREATE INDEX IF NOT EXISTS absensi_tenant_tanggal_idx ON absensi (tenant_id, tanggal)');
            } else {
                Schema::table('absensi', function (Blueprint $table) {
                    $table->index(['tenant_id', 'tanggal'], 'absensi_tenant_tanggal_idx');
                });
            }
        }
    }

    public function down(): void
    {
        $driver = DB::getDriverName();

        if (Schema::hasTable('profiles')) {
            if ($driver === 'pgsql') {
                DB::statement('DROP INDEX IF EXISTS profiles_tenant_role_idx');
            } else {
                Schema::table('profiles', function (Blueprint $table) {
                    $table->dropIndex('profiles_tenant_role_idx');
                });
            }
        }

        if (Schema::hasTable('absensi')) {
            if ($driver === 'pgsql') {
                DB::statement('DROP INDEX IF EXISTS absensi_tenant_tanggal_idx');
            } else {
                Schema::table('absensi', function (Blueprint $table) {
                    $table->dropIndex('absensi_tenant_tanggal_idx');
                });
            }
        }
    }
};
