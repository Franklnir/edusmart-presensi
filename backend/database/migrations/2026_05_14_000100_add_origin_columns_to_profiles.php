<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('profiles')) {
            return;
        }

        Schema::table('profiles', function (Blueprint $table) {
            if (! Schema::hasColumn('profiles', 'created_via')) {
                $table->string('created_via', 40)->nullable()->index();
            }
            if (! Schema::hasColumn('profiles', 'created_by')) {
                $table->uuid('created_by')->nullable()->index();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('profiles')) {
            return;
        }

        Schema::table('profiles', function (Blueprint $table) {
            if (Schema::hasColumn('profiles', 'created_by')) {
                $table->dropColumn('created_by');
            }
            if (Schema::hasColumn('profiles', 'created_via')) {
                $table->dropColumn('created_via');
            }
        });
    }
};
