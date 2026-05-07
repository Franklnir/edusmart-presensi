<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_plugins', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('slug', 80)->unique();
            $table->string('name', 120);
            $table->string('version', 40);
            $table->text('description')->nullable();
            $table->text('details')->nullable();
            $table->text('github_url')->nullable();
            $table->text('homepage_url')->nullable();
            $table->string('author_name', 120)->nullable();
            $table->string('author_email', 255)->nullable();
            $table->string('package_filename', 255);
            $table->text('package_path');
            $table->text('extract_path')->nullable();
            $table->string('checksum_sha256', 64);
            $table->unsignedBigInteger('archive_size_bytes')->default(0);
            $table->unsignedBigInteger('extracted_size_bytes')->default(0);
            $table->unsignedInteger('file_count')->default(0);
            $table->boolean('is_active')->default(false);
            $table->json('manifest_json')->nullable();
            $table->json('metadata_json')->nullable();
            $table->uuid('uploaded_by_user_id')->nullable();
            $table->string('uploaded_by_name', 120)->nullable();
            $table->string('uploaded_by_email', 255)->nullable();
            $table->timestampTz('uploaded_at')->nullable();
            $table->timestampTz('verified_at')->nullable();
            $table->timestampsTz();

            $table->index(['is_active', 'uploaded_at'], 'system_plugins_active_uploaded_idx');
        });

        Schema::create('plugin_upload_drafts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('slug', 80);
            $table->string('name', 120);
            $table->string('version', 40);
            $table->string('original_filename', 255);
            $table->text('temp_path');
            $table->string('checksum_sha256', 64);
            $table->unsignedBigInteger('archive_size_bytes')->default(0);
            $table->unsignedBigInteger('extracted_size_bytes')->default(0);
            $table->unsignedInteger('file_count')->default(0);
            $table->json('manifest_json')->nullable();
            $table->json('inspection_json')->nullable();
            $table->uuid('inspected_by_user_id')->nullable();
            $table->string('inspected_by_name', 120)->nullable();
            $table->string('inspected_by_email', 255)->nullable();
            $table->timestampTz('inspected_at')->nullable();
            $table->timestampTz('expires_at')->nullable();
            $table->timestampsTz();

            $table->index(['slug', 'expires_at'], 'plugin_upload_drafts_slug_exp_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plugin_upload_drafts');
        Schema::dropIfExists('system_plugins');
    }
};
