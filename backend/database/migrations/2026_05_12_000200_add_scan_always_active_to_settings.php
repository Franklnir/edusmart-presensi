<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('settings')) {
            return;
        }

        Schema::table('settings', function (Blueprint $table) {
            if (! Schema::hasColumn('settings', 'scan_always_active')) {
                $table->boolean('scan_always_active')->default(true)->after('scan_manual_enabled');
            }
        });

        DB::table('settings')
            ->whereNull('scan_always_active')
            ->update(['scan_always_active' => true]);
    }

    public function down(): void
    {
        if (! Schema::hasTable('settings') || ! Schema::hasColumn('settings', 'scan_always_active')) {
            return;
        }

        Schema::table('settings', function (Blueprint $table) {
            $table->dropColumn('scan_always_active');
        });
    }
};
