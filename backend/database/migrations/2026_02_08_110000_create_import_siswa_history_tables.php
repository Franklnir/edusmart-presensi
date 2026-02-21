<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_siswa_histories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('admin_id')->nullable();
            $table->string('source', 20)->default('file');
            $table->text('file_name')->nullable();
            $table->text('sheet_url')->nullable();
            $table->string('status', 20)->default('pending');
            $table->unsignedInteger('total_rows')->default(0);
            $table->unsignedInteger('success_rows')->default(0);
            $table->unsignedInteger('created_rows')->default(0);
            $table->unsignedInteger('updated_rows')->default(0);
            $table->unsignedInteger('skipped_rows')->default(0);
            $table->unsignedInteger('failed_rows')->default(0);
            $table->timestampTz('saved_at')->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'created_at']);
            $table->index(['tenant_id', 'status']);
            $table->foreign('admin_id')->references('id')->on('profiles')->nullOnDelete();
        });

        Schema::create('import_siswa_history_items', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('history_id');
            $table->uuid('tenant_id');
            $table->uuid('profile_id')->nullable();
            $table->string('status', 20);
            $table->boolean('created_user')->default(false);
            $table->text('nis')->nullable();
            $table->text('nama')->nullable();
            $table->text('kelas')->nullable();
            $table->text('error_message')->nullable();
            $table->timestampTz('imported_at')->nullable();
            $table->timestampsTz();

            $table->index(['history_id', 'status']);
            $table->index(['tenant_id', 'created_user']);
            $table->foreign('history_id')
                ->references('id')
                ->on('import_siswa_histories')
                ->cascadeOnDelete();
            $table->foreign('profile_id')->references('id')->on('profiles')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('import_siswa_history_items');
        Schema::dropIfExists('import_siswa_histories');
    }
};
