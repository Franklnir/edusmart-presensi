<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_mqtt_configs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->unique();
            $table->string('provider', 32)->default('custom');
            $table->boolean('managed_by_platform')->default(false);
            $table->boolean('enabled')->default(true);
            $table->string('host', 191);
            $table->unsignedInteger('port')->default(8883);
            $table->string('runtime_host', 191)->nullable();
            $table->unsignedInteger('runtime_port')->nullable();
            $table->boolean('runtime_use_tls')->nullable();
            $table->string('username', 191)->nullable();
            $table->text('password_ciphertext')->nullable();
            $table->boolean('use_tls')->default(true);
            $table->boolean('tls_verify_peer')->default(true);
            $table->boolean('tls_verify_peer_name')->default(true);
            $table->boolean('tls_allow_self_signed')->default(false);
            $table->unsignedTinyInteger('qos')->default(1);
            $table->string('client_id_prefix', 120)->default('edusmart-rfid-bridge');
            $table->string('scan_topic_template', 191)->default('edusmart/{tenant}/rfid/scan');
            $table->string('response_topic_template', 191)->default('edusmart/{tenant}/rfid/response');
            $table->string('mode_topic_template', 191)->default('edusmart/{tenant}/rfid/mode');
            $table->unsignedInteger('connect_timeout')->default(20);
            $table->unsignedInteger('socket_timeout')->default(5);
            $table->unsignedInteger('keep_alive')->default(20);
            $table->uuid('updated_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->foreign('tenant_id')
                ->references('id')
                ->on('tenants')
                ->cascadeOnDelete();

            $table->foreign('updated_by')
                ->references('id')
                ->on('users')
                ->nullOnDelete();

            $table->index(['enabled', 'tenant_id'], 'tenant_mqtt_configs_enabled_tenant_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_mqtt_configs');
    }
};
