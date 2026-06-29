<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('profiles', function (Blueprint $table) {
            $sm = Schema::getConnection()->getDoctrineSchemaManager();
            $indexesFound = $sm->listTableIndexes('profiles');

            if (!array_key_exists('profiles_tenant_role_idx', $indexesFound)) {
                $table->index(['tenant_id', 'role'], 'profiles_tenant_role_idx');
            }
        });

        Schema::table('absensi', function (Blueprint $table) {
            $sm = Schema::getConnection()->getDoctrineSchemaManager();
            $indexesFound = $sm->listTableIndexes('absensi');

            if (!array_key_exists('absensi_tenant_tanggal_idx', $indexesFound) && Schema::hasColumn('absensi', 'tanggal')) {
                $table->index(['tenant_id', 'tanggal'], 'absensi_tenant_tanggal_idx');
            }
        });
    }

    public function down(): void
    {
        Schema::table('profiles', function (Blueprint $table) {
            $table->dropIndex('profiles_tenant_role_idx');
        });

        Schema::table('absensi', function (Blueprint $table) {
            $table->dropIndex('absensi_tenant_tanggal_idx');
        });
    }
};
