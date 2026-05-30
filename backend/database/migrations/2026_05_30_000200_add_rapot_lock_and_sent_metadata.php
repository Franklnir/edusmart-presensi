<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('rapot_siswa')) {
            Schema::table('rapot_siswa', function (Blueprint $table) {
                if (! Schema::hasColumn('rapot_siswa', 'locked_at')) {
                    $table->timestampTz('locked_at')->nullable()->after('rata_rata_manual');
                }
                if (! Schema::hasColumn('rapot_siswa', 'locked_by')) {
                    $table->uuid('locked_by')->nullable()->after('locked_at');
                }
            });
        }

        if (Schema::hasTable('rapot_siswa_items')) {
            Schema::table('rapot_siswa_items', function (Blueprint $table) {
                if (! Schema::hasColumn('rapot_siswa_items', 'source')) {
                    $table->string('source', 40)->nullable()->after('keterangan');
                }
                if (! Schema::hasColumn('rapot_siswa_items', 'sent_by')) {
                    $table->uuid('sent_by')->nullable()->after('source');
                }
                if (! Schema::hasColumn('rapot_siswa_items', 'sent_at')) {
                    $table->timestampTz('sent_at')->nullable()->after('sent_by');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('rapot_siswa_items')) {
            Schema::table('rapot_siswa_items', function (Blueprint $table) {
                foreach (['sent_at', 'sent_by', 'source'] as $column) {
                    if (Schema::hasColumn('rapot_siswa_items', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        if (Schema::hasTable('rapot_siswa')) {
            Schema::table('rapot_siswa', function (Blueprint $table) {
                foreach (['locked_by', 'locked_at'] as $column) {
                    if (Schema::hasColumn('rapot_siswa', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }
    }
};
