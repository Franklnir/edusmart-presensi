<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private function jsonDefault()
    {
        return DB::getDriverName() === 'pgsql' ? DB::raw("'{}'::jsonb") : DB::raw("'{}'");
    }

    public function up(): void
    {
        if (! Schema::hasTable('tenant_storage_quotas')) {
            Schema::create('tenant_storage_quotas', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('tenant_id')->unique();
                $table->unsignedBigInteger('quota_bytes')->nullable();
                $table->unsignedBigInteger('max_upload_bytes')->nullable();
                $table->text('notes')->nullable();
                $table->uuid('updated_by_user_id')->nullable();
                $table->timestampsTz();

                $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
                $table->foreign('updated_by_user_id')->references('id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('storage_files')) {
            Schema::create('storage_files', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('tenant_id');
                $table->string('bucket', 80);
                $table->text('path');
                $table->string('path_hash', 64);
                $table->string('provider', 40)->default('local');
                $table->string('category', 60)->default('dokumen');
                $table->string('file_name', 191)->nullable();
                $table->string('mime_type', 191)->nullable();
                $table->string('extension', 24)->nullable();
                $table->unsignedBigInteger('size_bytes')->default(0);
                $table->uuid('uploaded_by_user_id')->nullable();
                $table->string('uploaded_by_role', 40)->nullable();
                $table->string('source_table', 80)->nullable();
                $table->text('source_id')->nullable();
                $table->text('tahun_ajaran')->nullable();
                $table->text('semester')->nullable();
                $table->text('periode_key')->nullable();
                $table->text('kelas')->nullable();
                $table->string('status', 30)->default('active');
                $table->timestampTz('uploaded_at')->useCurrent();
                $table->timestampTz('trashed_at')->nullable();
                $table->timestampTz('trash_expires_at')->nullable();
                $table->timestampTz('deleted_at')->nullable();
                $table->text('trash_path')->nullable();
                $table->string('duplicate_key', 64)->nullable();
                $table->jsonb('metadata')->default($this->jsonDefault());
                $table->timestampsTz();

                $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
                $table->foreign('uploaded_by_user_id')->references('id')->on('users')->nullOnDelete();
                $table->unique(['tenant_id', 'bucket', 'path_hash'], 'storage_files_tenant_bucket_path_unique');
                $table->index(['tenant_id', 'status', 'category'], 'storage_files_tenant_status_category_idx');
                $table->index(['tenant_id', 'tahun_ajaran', 'semester', 'status'], 'storage_files_tenant_period_status_idx');
                $table->index(['tenant_id', 'uploaded_by_user_id', 'status'], 'storage_files_tenant_user_status_idx');
                $table->index(['tenant_id', 'size_bytes'], 'storage_files_tenant_size_idx');
                $table->index(['tenant_id', 'duplicate_key'], 'storage_files_tenant_duplicate_idx');
                $table->index(['trash_expires_at', 'status'], 'storage_files_trash_expiry_idx');
            });
        }

        if (! Schema::hasTable('storage_cleanup_jobs')) {
            Schema::create('storage_cleanup_jobs', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('tenant_id')->nullable();
                $table->uuid('requested_by_user_id')->nullable();
                $table->string('requested_by_role', 40)->nullable();
                $table->string('mode', 60)->default('preview');
                $table->string('status', 40)->default('previewed');
                $table->jsonb('filters')->default($this->jsonDefault());
                $table->jsonb('preview')->default($this->jsonDefault());
                $table->unsignedInteger('affected_files')->default(0);
                $table->unsignedBigInteger('affected_bytes')->default(0);
                $table->text('backup_path')->nullable();
                $table->text('error')->nullable();
                $table->timestampTz('executed_at')->nullable();
                $table->timestampsTz();

                $table->foreign('tenant_id')->references('id')->on('tenants')->nullOnDelete();
                $table->foreign('requested_by_user_id')->references('id')->on('users')->nullOnDelete();
                $table->index(['tenant_id', 'status', 'created_at'], 'storage_cleanup_tenant_status_idx');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('storage_cleanup_jobs');
        Schema::dropIfExists('storage_files');
        Schema::dropIfExists('tenant_storage_quotas');
    }
};
