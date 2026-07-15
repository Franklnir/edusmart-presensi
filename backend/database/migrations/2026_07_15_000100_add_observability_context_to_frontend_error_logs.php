<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('frontend_error_logs')) {
            return;
        }

        Schema::table('frontend_error_logs', function (Blueprint $table): void {
            $table->uuid('request_id')->nullable()->index();
            $table->uuid('correlation_id')->nullable()->index();
            $table->string('error_code', 120)->nullable()->index();
            $table->string('domain', 120)->nullable()->index();
            $table->string('route_name', 180)->nullable()->index();
            $table->unsignedSmallInteger('response_status')->nullable()->index();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->string('release_sha', 120)->nullable()->index();
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('frontend_error_logs')) {
            return;
        }

        Schema::table('frontend_error_logs', function (Blueprint $table): void {
            $table->dropColumn([
                'request_id', 'correlation_id', 'error_code', 'domain',
                'route_name', 'response_status', 'duration_ms', 'release_sha',
            ]);
        });
    }
};
