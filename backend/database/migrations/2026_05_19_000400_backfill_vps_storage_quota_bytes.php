<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (
            ! Schema::hasTable('tenant_storage_quotas')
            || ! Schema::hasColumn('tenant_storage_quotas', 'quota_bytes')
            || ! Schema::hasColumn('tenant_storage_quotas', 'vps_quota_bytes')
        ) {
            return;
        }

        DB::table('tenant_storage_quotas')
            ->whereNull('vps_quota_bytes')
            ->whereNotNull('quota_bytes')
            ->update(['vps_quota_bytes' => DB::raw('quota_bytes')]);
    }

    public function down(): void
    {
        // Backfill is intentionally kept. Removing it could hide old VPS quotas again.
    }
};
