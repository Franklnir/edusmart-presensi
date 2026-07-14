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
        Schema::create('attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('tenant_id', 50)->index();
            $table->uuid('upload_session_id')->index();
            $table->string('object_key', 1024);
            $table->string('filename');
            $table->string('content_type');
            $table->unsignedBigInteger('size');
            $table->timestamps();

            $table->foreign('upload_session_id')->references('id')->on('upload_sessions')->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('attachments');
    }
};
