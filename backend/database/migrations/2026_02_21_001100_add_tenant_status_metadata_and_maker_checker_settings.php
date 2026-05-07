<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tenants')) {
            Schema::table('tenants', function (Blueprint $table) {
                if (! Schema::hasColumn('tenants', 'status_reason')) {
                    $table->text('status_reason')->nullable()->after('status');
                }
                if (! Schema::hasColumn('tenants', 'status_changed_at')) {
                    $table->timestampTz('status_changed_at')->nullable()->after('status_reason');
                }
                if (! Schema::hasColumn('tenants', 'status_changed_by')) {
                    $table->uuid('status_changed_by')->nullable()->after('status_changed_at');
                }
                if (! Schema::hasColumn('tenants', 'archived_at')) {
                    $table->timestampTz('archived_at')->nullable()->after('status_changed_by');
                }
            });
        }

        if (Schema::hasTable('settings')) {
            Schema::table('settings', function (Blueprint $table) {
                if (! Schema::hasColumn('settings', 'approval_maker_checker_enabled')) {
                    $table->boolean('approval_maker_checker_enabled')->default(true);
                }
                if (! Schema::hasColumn('settings', 'approval_require_second_approver')) {
                    $table->boolean('approval_require_second_approver')->default(true);
                }
                if (! Schema::hasColumn('settings', 'anomaly_alert_enabled')) {
                    $table->boolean('anomaly_alert_enabled')->default(true);
                }
                if (! Schema::hasColumn('settings', 'anomaly_bulk_threshold')) {
                    $table->unsignedInteger('anomaly_bulk_threshold')->default(30);
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('settings')) {
            $columns = [];
            foreach ([
                'approval_maker_checker_enabled',
                'approval_require_second_approver',
                'anomaly_alert_enabled',
                'anomaly_bulk_threshold',
            ] as $column) {
                if (Schema::hasColumn('settings', $column)) {
                    $columns[] = $column;
                }
            }

            if (! empty($columns)) {
                Schema::table('settings', function (Blueprint $table) use ($columns) {
                    $table->dropColumn($columns);
                });
            }
        }

        if (Schema::hasTable('tenants')) {
            $columns = [];
            foreach (['status_reason', 'status_changed_at', 'status_changed_by', 'archived_at'] as $column) {
                if (Schema::hasColumn('tenants', $column)) {
                    $columns[] = $column;
                }
            }

            if (! empty($columns)) {
                Schema::table('tenants', function (Blueprint $table) use ($columns) {
                    $table->dropColumn($columns);
                });
            }
        }
    }
};
