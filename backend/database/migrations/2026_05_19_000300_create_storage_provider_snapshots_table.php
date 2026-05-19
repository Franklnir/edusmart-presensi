<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private function jsonDefault()
    {
        return DB::getDriverName() === 'pgsql' ? DB::raw("'{}'::jsonb") : DB::raw("'{}'");
    }

    public function up(): void
    {
        if (Schema::hasTable('storage_provider_snapshots')) {
            return;
        }

        Schema::create('storage_provider_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('provider', 40);
            $table->string('logical_bucket', 80);
            $table->string('physical_bucket', 191)->nullable();
            $table->unsignedBigInteger('total_bytes')->default(0);
            $table->unsignedBigInteger('total_files')->default(0);
            $table->unsignedBigInteger('tracked_bytes')->default(0);
            $table->unsignedBigInteger('tracked_files')->default(0);
            $table->unsignedBigInteger('untracked_bytes')->default(0);
            $table->unsignedBigInteger('untracked_files')->default(0);
            $table->timestampTz('scanned_at')->nullable();
            $table->jsonb('metadata')->default($this->jsonDefault());
            $table->timestampsTz();

            $table->unique(['provider', 'logical_bucket'], 'storage_provider_snapshots_provider_bucket_unique');
            $table->index(['provider', 'scanned_at'], 'storage_provider_snapshots_provider_scanned_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storage_provider_snapshots');
    }
};
