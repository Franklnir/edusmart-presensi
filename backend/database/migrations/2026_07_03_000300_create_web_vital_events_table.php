<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('web_vital_events', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('tenant_id')->nullable();
            $table->uuid('profile_id')->nullable();
            $table->string('role', 32)->nullable();
            $table->string('route_path', 191);
            $table->string('url_host', 191)->nullable();
            $table->string('navigation_type', 32)->nullable();
            $table->string('device_type', 24)->nullable();
            $table->string('effective_connection_type', 24)->nullable();
            $table->unsignedSmallInteger('viewport_width')->nullable();
            $table->unsignedSmallInteger('viewport_height')->nullable();
            $table->decimal('lcp_ms', 10, 2)->nullable();
            $table->decimal('ttfb_ms', 10, 2)->nullable();
            $table->decimal('inp_ms', 10, 2)->nullable();
            $table->decimal('cls', 8, 4)->nullable();
            $table->decimal('fcp_ms', 10, 2)->nullable();
            $table->decimal('route_ready_ms', 10, 2)->nullable();
            $table->json('metadata')->nullable();
            $table->timestampTz('measured_at')->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'created_at'], 'web_vitals_tenant_created_idx');
            $table->index(['route_path', 'created_at'], 'web_vitals_route_created_idx');
            $table->index(['role', 'created_at'], 'web_vitals_role_created_idx');
            $table->index(['device_type', 'created_at'], 'web_vitals_device_created_idx');
            $table->index('created_at', 'web_vitals_created_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->nullOnDelete();
            $table->foreign('profile_id')->references('id')->on('profiles')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('web_vital_events');
    }
};
