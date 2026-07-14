<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('frontend_error_logs', function (Blueprint $table) {
            $table->id();
            $table->string('level', 50)->default('error')->index();
            $table->text('message');
            $table->jsonb('context')->nullable();
            $table->text('url')->nullable();
            $table->text('user_agent')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->uuid('user_id')->nullable()->index();
            $table->string('tenant_id')->nullable()->index();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('frontend_error_logs');
    }
};
