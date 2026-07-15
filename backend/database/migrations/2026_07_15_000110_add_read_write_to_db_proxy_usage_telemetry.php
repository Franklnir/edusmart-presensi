<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('db_proxy_usage_telemetry') || Schema::hasColumn('db_proxy_usage_telemetry', 'read_write')) {
            return;
        }

        Schema::table('db_proxy_usage_telemetry', function (Blueprint $table): void {
            $table->string('read_write', 16)->default('read')->index();
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('db_proxy_usage_telemetry') && Schema::hasColumn('db_proxy_usage_telemetry', 'read_write')) {
            Schema::table('db_proxy_usage_telemetry', fn (Blueprint $table) => $table->dropColumn('read_write'));
        }
    }
};
