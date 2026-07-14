<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('upload_sessions', function (Blueprint $table) {
            $table->string('provider', 50)->default('legacy')->after('purpose');
            $table->string('bucket', 255)->default('assignments')->after('provider');
            $table->string('checksum_sha256', 128)->nullable()->after('size');
            $table->unsignedBigInteger('actual_size')->nullable()->after('checksum_sha256');
            $table->string('failure_code', 80)->nullable()->after('status');
            $table->timestamp('uploaded_at')->nullable()->after('expires_at');
            $table->timestamp('verifying_at')->nullable()->after('uploaded_at');
            $table->timestamp('completed_at')->nullable()->after('verifying_at');
            $table->timestamp('cancelled_at')->nullable()->after('completed_at');
            $table->timestamp('object_deleted_at')->nullable()->after('cancelled_at');
            $table->index(['status', 'expires_at'], 'upload_sessions_cleanup_idx');
        });

        Schema::table('attachments', function (Blueprint $table) {
            $table->string('provider', 50)->default('legacy')->after('purpose');
            $table->string('bucket', 255)->default('assignments')->after('provider');
            $table->unsignedBigInteger('actual_size')->nullable()->after('size');
            $table->string('checksum_sha256', 128)->nullable()->after('actual_size');
            $table->string('status', 20)->default('active')->after('checksum_sha256');
            $table->softDeletes();
            $table->index(['status', 'claimed_at', 'created_at'], 'attachments_cleanup_idx');
        });

        DB::table('upload_sessions')->update(['actual_size' => DB::raw('size')]);
        DB::table('attachments')->update(['actual_size' => DB::raw('size')]);
    }

    public function down(): void
    {
        Schema::table('attachments', function (Blueprint $table) {
            $table->dropIndex('attachments_cleanup_idx');
            $table->dropSoftDeletes();
            $table->dropColumn(['provider', 'bucket', 'actual_size', 'checksum_sha256', 'status']);
        });

        Schema::table('upload_sessions', function (Blueprint $table) {
            $table->dropIndex('upload_sessions_cleanup_idx');
            $table->dropColumn([
                'provider',
                'bucket',
                'checksum_sha256',
                'actual_size',
                'failure_code',
                'uploaded_at',
                'verifying_at',
                'completed_at',
                'cancelled_at',
                'object_deleted_at',
            ]);
        });
    }
};
