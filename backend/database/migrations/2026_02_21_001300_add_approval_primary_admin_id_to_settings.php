<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('settings')) {
            return;
        }

        if (Schema::hasColumn('settings', 'approval_primary_admin_id')) {
            return;
        }

        Schema::table('settings', function (Blueprint $table) {
            $table->uuid('approval_primary_admin_id')->nullable();
            $table->foreign('approval_primary_admin_id')
                ->references('id')
                ->on('profiles')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('settings') || ! Schema::hasColumn('settings', 'approval_primary_admin_id')) {
            return;
        }

        try {
            Schema::table('settings', function (Blueprint $table) {
                $table->dropForeign(['approval_primary_admin_id']);
            });
        } catch (\Throwable $e) {
            // Ignore when foreign key does not exist.
        }

        Schema::table('settings', function (Blueprint $table) {
            $table->dropColumn('approval_primary_admin_id');
        });
    }
};
