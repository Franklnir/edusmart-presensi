<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('whatsapp_integrations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->unique();
            $table->string('provider', 32)->default('evolution');
            $table->string('instance_name', 120)->unique();
            $table->string('status', 40)->default('disconnected');
            $table->string('connection_state', 40)->nullable();
            $table->text('qr_code')->nullable();
            $table->string('pairing_code', 191)->nullable();
            $table->string('connected_phone', 32)->nullable();
            $table->string('connected_name', 191)->nullable();
            $table->timestampTz('last_connected_at')->nullable();
            $table->timestampTz('last_disconnected_at')->nullable();
            $table->timestampTz('qr_updated_at')->nullable();
            $table->timestampTz('last_synced_at')->nullable();
            $table->timestampTz('last_webhook_at')->nullable();
            $table->string('last_webhook_event', 80)->nullable();
            $table->text('last_error')->nullable();
            $table->string('webhook_secret', 64)->unique();
            $table->boolean('is_enabled')->default(true);
            $table->timestampsTz();

            $table->index(['tenant_id', 'status'], 'wa_integrations_tenant_status_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });

        Schema::create('whatsapp_notification_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->unique();
            $table->uuid('integration_id')->nullable();
            $table->boolean('is_enabled')->default(true);
            $table->boolean('send_attendance')->default(true);
            $table->boolean('send_profile_updates')->default(true);
            $table->boolean('send_assignment_updates')->default(false);
            $table->boolean('send_extracurricular_updates')->default(false);
            $table->boolean('send_grade_updates')->default(false);
            $table->string('recipient_mode', 32)->default('wali');
            $table->timestampsTz();

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('integration_id')->references('id')->on('whatsapp_integrations')->nullOnDelete();
        });

        Schema::create('whatsapp_message_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('integration_id')->nullable();
            $table->string('category', 40);
            $table->string('event_key', 191);
            $table->string('source_table', 80)->nullable();
            $table->string('source_record_id', 191)->nullable();
            $table->uuid('target_profile_id')->nullable();
            $table->string('target_name', 191)->nullable();
            $table->string('target_phone', 32)->nullable();
            $table->string('normalized_phone', 32)->nullable();
            $table->text('message_text')->nullable();
            $table->string('status', 32)->default('queued');
            $table->unsignedInteger('attempt_count')->default(0);
            $table->string('provider_message_id', 191)->nullable();
            $table->string('provider_status', 80)->nullable();
            $table->text('provider_response')->nullable();
            $table->text('last_error')->nullable();
            $table->timestampTz('queued_at')->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampTz('failed_at')->nullable();
            $table->timestampsTz();

            $table->unique(
                ['tenant_id', 'event_key', 'normalized_phone'],
                'wa_message_logs_tenant_event_phone_unique'
            );
            $table->index(['tenant_id', 'status', 'created_at'], 'wa_message_logs_tenant_status_created_idx');
            $table->index(['tenant_id', 'category', 'created_at'], 'wa_message_logs_tenant_category_created_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('integration_id')->references('id')->on('whatsapp_integrations')->nullOnDelete();
            $table->foreign('target_profile_id')->references('id')->on('profiles')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('whatsapp_message_logs');
        Schema::dropIfExists('whatsapp_notification_settings');
        Schema::dropIfExists('whatsapp_integrations');
    }
};
