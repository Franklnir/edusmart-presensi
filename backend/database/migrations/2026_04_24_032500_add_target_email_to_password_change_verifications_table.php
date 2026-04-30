<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('password_change_verifications')) {
            return;
        }

        if (Schema::hasColumn('password_change_verifications', 'target_email')) {
            return;
        }

        Schema::table('password_change_verifications', function (Blueprint $table) {
            $table->string('target_email')->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('password_change_verifications')) {
            return;
        }

        if (! Schema::hasColumn('password_change_verifications', 'target_email')) {
            return;
        }

        Schema::table('password_change_verifications', function (Blueprint $table) {
            $table->dropColumn('target_email');
        });
    }
};
