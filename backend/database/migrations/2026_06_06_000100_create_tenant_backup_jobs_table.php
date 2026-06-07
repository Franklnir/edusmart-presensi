<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tenant_backup_jobs')) {
            return;
        }

        Schema::create('tenant_backup_jobs', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->nullable()->index();
            $table->string('job_id', 80)->unique();
            $table->string('type', 40)->default('monthly')->index();
            $table->string('month_key', 7)->nullable()->index();
            $table->string('status', 40)->default('queued')->index();
            $table->unsignedSmallInteger('progress')->default(0);
            $table->text('message')->nullable();
            $table->text('last_error')->nullable();
            $table->json('result')->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('queued_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamp('failed_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'type', 'month_key', 'status'], 'tenant_backup_jobs_lookup_idx');
            $table->index(['tenant_id', 'updated_at'], 'tenant_backup_jobs_tenant_updated_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_backup_jobs');
    }
};
