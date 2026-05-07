<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rfid_devices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->nullable();
            $table->string('device_id', 191)->unique();
            $table->string('name', 191)->nullable();
            $table->string('secret_hash')->nullable();
            $table->string('status', 32)->default('active');
            $table->string('transport', 32)->default('hybrid');
            $table->boolean('fallback_http_enabled')->default(true);
            $table->json('metadata')->nullable();
            $table->timestampTz('last_seen_at')->nullable();
            $table->string('last_transport', 32)->nullable();
            $table->ipAddress('last_ip')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('tenant_id')
                ->references('id')
                ->on('tenants')
                ->nullOnDelete();

            $table->index(['tenant_id', 'status'], 'rfid_devices_tenant_status_idx');
        });

        Schema::create('rfid_device_events', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('tenant_id')->nullable();
            $table->string('device_id', 191);
            $table->string('event_id', 191)->nullable();
            $table->string('card_uid', 64)->nullable();
            $table->string('mode', 32)->nullable();
            $table->string('source', 32)->default('http');
            $table->string('status', 32)->default('received');
            $table->timestampTz('scanned_at')->nullable();
            $table->timestampTz('processed_at')->nullable();
            $table->unsignedSmallInteger('response_code')->nullable();
            $table->json('payload')->nullable();
            $table->json('response_payload')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('tenant_id')
                ->references('id')
                ->on('tenants')
                ->nullOnDelete();

            $table->unique(['device_id', 'event_id'], 'rfid_device_events_device_event_unique');
            $table->index(['tenant_id', 'device_id', 'created_at'], 'rfid_device_events_scope_idx');
            $table->index(['card_uid', 'created_at'], 'rfid_device_events_card_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rfid_device_events');
        Schema::dropIfExists('rfid_devices');
    }
};
