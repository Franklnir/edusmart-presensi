<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('guru_mapel_bobot')) {
            return;
        }

        Schema::create('guru_mapel_bobot', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->nullable()->index();
            $table->uuid('guru_id');
            $table->string('mapel', 191);
            $table->decimal('bobot_tugas_pr', 5, 2)->default(30);
            $table->decimal('bobot_quiz_reguler', 5, 2)->default(20);
            $table->decimal('bobot_quiz_uts', 5, 2)->default(20);
            $table->decimal('bobot_quiz_uas', 5, 2)->default(30);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['guru_id', 'mapel'], 'guru_mapel_bobot_guru_mapel_index');
            $table->unique(['tenant_id', 'guru_id', 'mapel'], 'guru_mapel_bobot_unique_tenant_guru_mapel');
            $table->foreign('guru_id')->references('id')->on('profiles')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('guru_mapel_bobot')) {
            return;
        }

        Schema::table('guru_mapel_bobot', function (Blueprint $table) {
            $table->dropForeign(['guru_id']);
        });

        Schema::dropIfExists('guru_mapel_bobot');
    }
};
