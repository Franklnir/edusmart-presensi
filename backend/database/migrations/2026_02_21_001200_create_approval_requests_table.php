<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('approval_requests')) {
            return;
        }

        Schema::create('approval_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->text('status')->default('pending'); // pending|approved|rejected|cancelled
            $table->text('target_table');
            $table->text('target_action');
            $table->text('target_record_id')->nullable();
            $table->jsonb('change_payload');
            $table->text('change_summary')->nullable();
            $table->unsignedInteger('affected_rows_estimate')->default(1);
            $table->text('risk_level')->default('medium');
            $table->uuid('requested_by')->nullable();
            $table->text('requested_by_role')->nullable();
            $table->timestampTz('requested_at')->useCurrent();
            $table->text('request_note')->nullable();

            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->uuid('rejected_by')->nullable();
            $table->timestampTz('rejected_at')->nullable();
            $table->text('review_note')->nullable();

            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['tenant_id', 'status', 'requested_at'], 'approval_requests_tenant_status_req_at_idx');
            $table->index(['tenant_id', 'target_table', 'target_action'], 'approval_requests_tenant_table_action_idx');

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('requested_by')->references('id')->on('profiles')->nullOnDelete();
            $table->foreign('approved_by')->references('id')->on('profiles')->nullOnDelete();
            $table->foreign('rejected_by')->references('id')->on('profiles')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_requests');
    }
};
