<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('admin_feature_permissions')) {
            return;
        }

        Schema::create('admin_feature_permissions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->nullable()->index();
            $table->string('target_type', 24)->index();
            $table->uuid('target_teacher_id')->index();
            $table->string('target_label', 191);
            $table->text('target_class_id')->default('');
            $table->string('feature_key', 64)->index();
            $table->boolean('is_active')->default(true)->index();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(
                ['tenant_id', 'target_type', 'target_teacher_id', 'target_class_id', 'feature_key'],
                'admin_feature_permissions_unique'
            );
            $table->index(
                ['tenant_id', 'target_teacher_id', 'feature_key', 'is_active'],
                'admin_feature_permissions_access_idx'
            );
            $table->foreign('target_teacher_id')->references('id')->on('profiles')->cascadeOnDelete();
            $table->foreign('created_by')->references('id')->on('profiles')->nullOnDelete();
            $table->foreign('updated_by')->references('id')->on('profiles')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_feature_permissions');
    }
};
