<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tugas')) {
            DB::statement('CREATE INDEX IF NOT EXISTS tugas_kelas_created_at_index ON tugas (kelas, created_at DESC)');
            DB::statement('CREATE INDEX IF NOT EXISTS tugas_kelas_deadline_index ON tugas (kelas, deadline)');
        }

        if (Schema::hasTable('tugas_jawaban')) {
            DB::statement('CREATE INDEX IF NOT EXISTS tugas_jawaban_user_tugas_index ON tugas_jawaban (user_id, tugas_id)');
        }
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS tugas_jawaban_user_tugas_index');
        DB::statement('DROP INDEX IF EXISTS tugas_kelas_deadline_index');
        DB::statement('DROP INDEX IF EXISTS tugas_kelas_created_at_index');
    }
};
