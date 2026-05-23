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
            if (! Schema::hasColumn('settings', 'jadwal_periode_berlaku')) {
                $table->text('jadwal_periode_berlaku')->nullable();
            }
        });

        DB::table('settings')
            ->where(function ($query) {
                $query->whereNull('jadwal_periode_berlaku')
                    ->orWhere('jadwal_periode_berlaku', '');
            })
            ->update(['jadwal_periode_berlaku' => 'tahunan']);
    }

    public function down(): void
    {
        if (! Schema::hasTable('settings') || ! Schema::hasColumn('settings', 'jadwal_periode_berlaku')) {
            return;
        }

        Schema::table('settings', function (Blueprint $table) {
            $table->dropColumn('jadwal_periode_berlaku');
        });
    }
};
