<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kelas_deleted_histories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->text('class_id');
            $table->text('class_name');
            $table->text('grade')->nullable();
            $table->text('suffix')->nullable();
            $table->text('angkatan')->nullable();
            $table->text('tahun_ajaran')->nullable();
            $table->text('semester')->nullable();
            $table->json('snapshot');
            $table->json('summary')->nullable();
            $table->uuid('deleted_by')->nullable();
            $table->text('deleted_by_name')->nullable();
            $table->timestampTz('deleted_at')->useCurrent();
            $table->uuid('restored_by')->nullable();
            $table->timestampTz('restored_at')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['tenant_id', 'deleted_at'], 'kelas_deleted_histories_tenant_deleted_idx');
            $table->index(['tenant_id', 'class_id'], 'kelas_deleted_histories_tenant_class_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('deleted_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('restored_by')->references('id')->on('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kelas_deleted_histories');
    }
};
