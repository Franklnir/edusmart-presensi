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
        Schema::create('tenant_google_drive_configs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->unique();
            $table->uuid('connected_by_user_id')->nullable();
            $table->string('status', 40)->default('disconnected');
            $table->boolean('is_enabled')->default(true);
            $table->string('google_account_email', 255)->nullable();
            $table->string('google_account_name', 191)->nullable();
            $table->text('google_account_picture')->nullable();
            $table->string('drive_folder_id', 191)->nullable();
            $table->string('drive_folder_name', 191)->default('EduSmart Presensi');
            $table->text('drive_folder_web_url')->nullable();
            $table->text('access_token')->nullable();
            $table->text('refresh_token')->nullable();
            $table->timestampTz('token_expires_at')->nullable();
            $table->text('scope')->nullable();
            $table->unsignedBigInteger('quota_used_bytes')->nullable();
            $table->unsignedBigInteger('quota_limit_bytes')->nullable();
            $table->unsignedBigInteger('quota_used_in_drive_bytes')->nullable();
            $table->timestampTz('last_checked_at')->nullable();
            $table->text('last_error')->nullable();
            $table->jsonb('metadata')->default($this->jsonDefault());
            $table->timestampsTz();

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('connected_by_user_id')->references('id')->on('users')->nullOnDelete();
            $table->index(['tenant_id', 'status'], 'tenant_drive_configs_tenant_status_idx');
        });

        Schema::create('tenant_google_drive_files', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('config_id')->nullable();
            $table->uuid('uploaded_by_user_id')->nullable();
            $table->string('bucket', 80)->default('assignments');
            $table->text('source_path')->nullable();
            $table->text('storage_value');
            $table->string('drive_file_id', 191);
            $table->string('drive_file_name', 191);
            $table->text('drive_web_view_link')->nullable();
            $table->text('drive_web_content_link')->nullable();
            $table->string('mime_type', 191)->nullable();
            $table->string('extension', 24)->nullable();
            $table->unsignedBigInteger('size_bytes')->default(0);
            $table->timestampTz('uploaded_at')->useCurrent();
            $table->timestampsTz();

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('config_id')->references('id')->on('tenant_google_drive_configs')->nullOnDelete();
            $table->foreign('uploaded_by_user_id')->references('id')->on('users')->nullOnDelete();
            $table->unique(['tenant_id', 'drive_file_id'], 'tenant_drive_files_tenant_file_unique');
            $table->index(['tenant_id', 'uploaded_at'], 'tenant_drive_files_tenant_uploaded_idx');
            $table->index(['tenant_id', 'bucket'], 'tenant_drive_files_tenant_bucket_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_google_drive_files');
        Schema::dropIfExists('tenant_google_drive_configs');
    }
};
