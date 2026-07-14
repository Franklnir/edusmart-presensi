<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('frontend_error_logs')) {
            return;
        }

        Schema::table('frontend_error_logs', function (Blueprint $table): void {
            $table->index(['tenant_id', 'created_at'], 'frontend_error_logs_tenant_created_idx');
            $table->index(['level', 'created_at'], 'frontend_error_logs_level_created_idx');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('frontend_error_logs')) {
            return;
        }

        Schema::table('frontend_error_logs', function (Blueprint $table): void {
            $table->dropIndex('frontend_error_logs_tenant_created_idx');
            $table->dropIndex('frontend_error_logs_level_created_idx');
        });
    }
};
