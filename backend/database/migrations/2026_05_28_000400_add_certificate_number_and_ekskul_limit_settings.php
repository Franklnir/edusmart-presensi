<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('certificates')) {
            Schema::table('certificates', function (Blueprint $table) {
                if (! Schema::hasColumn('certificates', 'certificate_number')) {
                    $table->text('certificate_number')->nullable()->after('event_date');
                }
            });
        }

        if (Schema::hasTable('settings')) {
            Schema::table('settings', function (Blueprint $table) {
                if (! Schema::hasColumn('settings', 'max_ekskul_per_siswa')) {
                    $table->unsignedSmallInteger('max_ekskul_per_siswa')->default(3)->after('registrasi_admin_aktif');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('settings') && Schema::hasColumn('settings', 'max_ekskul_per_siswa')) {
            Schema::table('settings', function (Blueprint $table) {
                $table->dropColumn('max_ekskul_per_siswa');
            });
        }

        if (Schema::hasTable('certificates') && Schema::hasColumn('certificates', 'certificate_number')) {
            Schema::table('certificates', function (Blueprint $table) {
                $table->dropColumn('certificate_number');
            });
        }
    }
};
