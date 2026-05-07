<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_domains', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->nullable();
            $table->string('host')->unique();
            $table->string('domain_type', 20);
            $table->string('status', 20)->default('pending');
            $table->boolean('is_primary')->default(false);
            $table->string('dns_record_type', 10)->nullable();
            $table->text('dns_record_value')->nullable();
            $table->timestampTz('verified_at')->nullable();
            $table->timestampTz('last_checked_at')->nullable();
            $table->string('last_dns_status', 20)->nullable();
            $table->text('last_dns_error')->nullable();
            $table->json('last_dns_records')->nullable();
            $table->text('notes')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('tenant_id')
                ->references('id')
                ->on('tenants')
                ->cascadeOnDelete();

            $table->index(['tenant_id', 'domain_type', 'status'], 'tenant_domains_scope_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_domains');
    }
};
