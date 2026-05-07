<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('ekskul') || Schema::hasColumn('ekskul', 'registration_deadline_at')) {
            return;
        }

        Schema::table('ekskul', function (Blueprint $table) {
            $table->timestampTz('registration_deadline_at')->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('ekskul') || ! Schema::hasColumn('ekskul', 'registration_deadline_at')) {
            return;
        }

        Schema::table('ekskul', function (Blueprint $table) {
            $table->dropColumn('registration_deadline_at');
        });
    }
};
