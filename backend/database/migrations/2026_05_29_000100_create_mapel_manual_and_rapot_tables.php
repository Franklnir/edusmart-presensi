<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('guru_mapel_manual_nilai')) {
            Schema::create('guru_mapel_manual_nilai', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('tenant_id')->nullable()->index();
                $table->uuid('guru_id')->index();
                $table->uuid('siswa_id')->index();
                $table->text('kelas_id');
                $table->string('mapel', 191);
                $table->string('tahun_ajaran', 20);
                $table->decimal('nilai_manual', 5, 2)->nullable();
                $table->text('catatan')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();

                $table->unique(
                    ['tenant_id', 'guru_id', 'siswa_id', 'kelas_id', 'mapel', 'tahun_ajaran'],
                    'guru_mapel_manual_nilai_unique'
                );
                $table->index(['tenant_id', 'kelas_id', 'mapel', 'tahun_ajaran'], 'guru_mapel_manual_lookup_idx');
                $table->foreign('guru_id')->references('id')->on('profiles')->cascadeOnDelete();
                $table->foreign('siswa_id')->references('id')->on('profiles')->cascadeOnDelete();
            });
        }

        if (! Schema::hasTable('rapot_siswa')) {
            Schema::create('rapot_siswa', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('tenant_id')->nullable()->index();
                $table->uuid('siswa_id')->index();
                $table->text('kelas_id');
                $table->string('jenis', 10);
                $table->string('semester', 40)->nullable();
                $table->string('tahun_pelajaran', 20);
                $table->decimal('jumlah', 8, 2)->nullable();
                $table->decimal('rata_rata', 5, 2)->nullable();
                $table->boolean('rata_rata_manual')->default(false);
                $table->uuid('created_by')->nullable();
                $table->uuid('updated_by')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();

                $table->unique(
                    ['tenant_id', 'siswa_id', 'kelas_id', 'jenis', 'tahun_pelajaran'],
                    'rapot_siswa_unique'
                );
                $table->index(['tenant_id', 'kelas_id', 'jenis', 'tahun_pelajaran'], 'rapot_siswa_lookup_idx');
                $table->foreign('siswa_id')->references('id')->on('profiles')->cascadeOnDelete();
                $table->foreign('created_by')->references('id')->on('profiles')->nullOnDelete();
                $table->foreign('updated_by')->references('id')->on('profiles')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('rapot_siswa_items')) {
            Schema::create('rapot_siswa_items', function (Blueprint $table) {
                $table->uuid('id')->primary();
                $table->uuid('tenant_id')->nullable()->index();
                $table->uuid('rapot_id')->index();
                $table->integer('nomor')->default(1);
                $table->string('mapel', 191);
                $table->decimal('kkm', 5, 2)->nullable();
                $table->decimal('nilai', 5, 2)->nullable();
                $table->string('predikat', 20)->nullable();
                $table->text('keterangan')->nullable();
                $table->timestampTz('created_at')->useCurrent();
                $table->timestampTz('updated_at')->useCurrent();

                $table->unique(['tenant_id', 'rapot_id', 'nomor'], 'rapot_siswa_items_unique_nomor');
                $table->foreign('rapot_id')->references('id')->on('rapot_siswa')->cascadeOnDelete();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('rapot_siswa_items');
        Schema::dropIfExists('rapot_siswa');
        Schema::dropIfExists('guru_mapel_manual_nilai');
    }
};
