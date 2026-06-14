<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Adds a functional index on (tenant_id, lower(email)) so that the
     * case-insensitive email lookup used during authentication can use
     * an index scan instead of a sequential scan. This is critical for
     * handling 1000+ concurrent student logins efficiently.
     */
    public function up(): void
    {
        if (! Schema::hasTable('profiles')) {
            return;
        }

        // Functional index for case-insensitive email lookup per tenant.
        // Matches queries like: WHERE tenant_id = ? AND lower(email) = ?
        DB::statement(
            'CREATE INDEX IF NOT EXISTS profiles_tenant_lower_email_idx '
            .'ON profiles (tenant_id, lower(email))'
        );

        // Composite index for NIS-based login lookup per tenant.
        DB::statement(
            'CREATE INDEX IF NOT EXISTS profiles_tenant_nis_idx '
            .'ON profiles (tenant_id, nis) WHERE nis IS NOT NULL'
        );
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS profiles_tenant_lower_email_idx');
        DB::statement('DROP INDEX IF EXISTS profiles_tenant_nis_idx');
    }
};
