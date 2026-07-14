<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('db_proxy_usage_telemetry')) {
            return;
        }

        Schema::create('db_proxy_usage_telemetry', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('scope_key', 64)->unique();
            $table->string('request_id', 128)->nullable();
            $table->uuid('tenant_id')->nullable();
            $table->uuid('actor_id')->nullable();
            $table->string('frontend_route', 512)->nullable();
            $table->string('consumer_id', 128)->nullable();
            $table->string('domain', 128)->nullable();
            $table->string('operation', 32)->nullable();
            $table->unsignedSmallInteger('response_status')->default(0);
            $table->unsignedInteger('duration_ms')->default(0);
            $table->string('release_sha', 128)->nullable();
            $table->timestampTz('first_seen')->useCurrent();
            $table->timestampTz('last_seen')->useCurrent();
            $table->unsignedBigInteger('count')->default(0);

            $table->index(['tenant_id', 'last_seen'], 'db_proxy_usage_tenant_last_seen_idx');
            $table->index(['response_status', 'last_seen'], 'db_proxy_usage_status_last_seen_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('db_proxy_usage_telemetry');
    }
};
