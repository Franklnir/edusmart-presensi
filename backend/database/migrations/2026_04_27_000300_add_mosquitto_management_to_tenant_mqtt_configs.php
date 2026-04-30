<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('tenant_mqtt_configs')) {
            return;
        }

        Schema::table('tenant_mqtt_configs', function (Blueprint $table) {
            if (! Schema::hasColumn('tenant_mqtt_configs', 'provider')) {
                $table->string('provider', 32)->default('custom')->after('tenant_id');
            }
            if (! Schema::hasColumn('tenant_mqtt_configs', 'managed_by_platform')) {
                $table->boolean('managed_by_platform')->default(false)->after('provider');
            }
            if (! Schema::hasColumn('tenant_mqtt_configs', 'runtime_host')) {
                $table->string('runtime_host', 191)->nullable()->after('port');
            }
            if (! Schema::hasColumn('tenant_mqtt_configs', 'runtime_port')) {
                $table->unsignedInteger('runtime_port')->nullable()->after('runtime_host');
            }
            if (! Schema::hasColumn('tenant_mqtt_configs', 'runtime_use_tls')) {
                $table->boolean('runtime_use_tls')->nullable()->after('runtime_port');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('tenant_mqtt_configs')) {
            return;
        }

        Schema::table('tenant_mqtt_configs', function (Blueprint $table) {
            foreach (['runtime_use_tls', 'runtime_port', 'runtime_host', 'managed_by_platform', 'provider'] as $column) {
                if (Schema::hasColumn('tenant_mqtt_configs', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
