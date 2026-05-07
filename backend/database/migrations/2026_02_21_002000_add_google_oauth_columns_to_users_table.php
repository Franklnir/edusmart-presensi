<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'google_id')) {
                $table->string('google_id')->nullable()->unique();
            }
            if (! Schema::hasColumn('users', 'google_email')) {
                $table->string('google_email')->nullable();
            }
            if (! Schema::hasColumn('users', 'google_avatar_url')) {
                $table->text('google_avatar_url')->nullable();
            }
            if (! Schema::hasColumn('users', 'google_linked_at')) {
                $table->timestampTz('google_linked_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'google_linked_at')) {
                $table->dropColumn('google_linked_at');
            }
            if (Schema::hasColumn('users', 'google_avatar_url')) {
                $table->dropColumn('google_avatar_url');
            }
            if (Schema::hasColumn('users', 'google_email')) {
                $table->dropColumn('google_email');
            }
            if (Schema::hasColumn('users', 'google_id')) {
                $table->dropUnique('users_google_id_unique');
                $table->dropColumn('google_id');
            }
        });
    }
};
