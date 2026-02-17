<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('profiles', 'nik') && !Schema::hasColumn('profiles', 'nis')) {
            DB::statement('ALTER TABLE profiles RENAME COLUMN nik TO nis');
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('profiles', 'nis') && !Schema::hasColumn('profiles', 'nik')) {
            DB::statement('ALTER TABLE profiles RENAME COLUMN nis TO nik');
        }
    }
};
