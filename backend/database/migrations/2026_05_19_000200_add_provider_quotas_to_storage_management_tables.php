<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('tenant_storage_quotas')) {
            return;
        }

        Schema::table('tenant_storage_quotas', function (Blueprint $table) {
            if (! Schema::hasColumn('tenant_storage_quotas', 'vps_quota_bytes')) {
                $table->unsignedBigInteger('vps_quota_bytes')->nullable()->after('max_upload_bytes');
            }
            if (! Schema::hasColumn('tenant_storage_quotas', 'vps_max_upload_bytes')) {
                $table->unsignedBigInteger('vps_max_upload_bytes')->nullable()->after('vps_quota_bytes');
            }
            if (! Schema::hasColumn('tenant_storage_quotas', 'neva_s3_quota_bytes')) {
                $table->unsignedBigInteger('neva_s3_quota_bytes')->nullable()->after('vps_max_upload_bytes');
            }
            if (! Schema::hasColumn('tenant_storage_quotas', 'neva_s3_max_upload_bytes')) {
                $table->unsignedBigInteger('neva_s3_max_upload_bytes')->nullable()->after('neva_s3_quota_bytes');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('tenant_storage_quotas')) {
            return;
        }

        Schema::table('tenant_storage_quotas', function (Blueprint $table) {
            foreach ([
                'neva_s3_max_upload_bytes',
                'neva_s3_quota_bytes',
                'vps_max_upload_bytes',
                'vps_quota_bytes',
            ] as $column) {
                if (Schema::hasColumn('tenant_storage_quotas', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
