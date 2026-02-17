<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_presence', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->uuid('user_id');
            $table->text('device_id');
            $table->text('role')->nullable();
            $table->text('user_agent')->nullable();
            $table->timestampTz('last_seen_at')->nullable();
            $table->timestampTz('last_active_at')->nullable();
            $table->unsignedInteger('activity_count')->default(0);
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->unique(['user_id', 'device_id']);
            $table->index('last_seen_at');
            $table->index('role');

            $table->foreign('user_id')->references('id')->on('profiles')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_presence');
    }
};
