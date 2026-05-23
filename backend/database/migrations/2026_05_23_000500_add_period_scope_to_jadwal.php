<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('jadwal')) {
            return;
        }

        Schema::table('jadwal', function (Blueprint $table) {
            if (! Schema::hasColumn('jadwal', 'periode_berlaku')) {
                $table->text('periode_berlaku')->nullable();
            }
        });

        DB::table('jadwal')
            ->where(function ($query) {
                $query->whereNull('periode_berlaku')->orWhere('periode_berlaku', '');
            })
            ->update(['periode_berlaku' => 'tahunan']);

        try {
            Schema::table('jadwal', function (Blueprint $table) {
                $table->index(['tahun_ajaran', 'periode_berlaku'], 'jadwal_period_scope_index');
            });
        } catch (Throwable $e) {
            // Index may already exist in some VPS databases.
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('jadwal') || ! Schema::hasColumn('jadwal', 'periode_berlaku')) {
            return;
        }

        try {
            Schema::table('jadwal', function (Blueprint $table) {
                $table->dropIndex('jadwal_period_scope_index');
            });
        } catch (Throwable $e) {
            // Ignore missing index.
        }

        Schema::table('jadwal', function (Blueprint $table) {
            $table->dropColumn('periode_berlaku');
        });
    }
};
