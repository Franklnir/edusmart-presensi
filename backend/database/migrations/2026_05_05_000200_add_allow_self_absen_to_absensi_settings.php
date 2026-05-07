<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('absensi_settings')) {
            return;
        }

        Schema::table('absensi_settings', function (Blueprint $table) {
            if (! Schema::hasColumn('absensi_settings', 'allow_self_absen')) {
                $table->boolean('allow_self_absen')->default(false);
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('absensi_settings')) {
            return;
        }

        Schema::table('absensi_settings', function (Blueprint $table) {
            if (Schema::hasColumn('absensi_settings', 'allow_self_absen')) {
                $table->dropColumn('allow_self_absen');
            }
        });
    }
};
