<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tugas') && ! Schema::hasColumn('tugas', 'status')) {
            Schema::table('tugas', function (Blueprint $table) {
                $table->string('status', 20)->default('published')->index();
            });
        }

        if (Schema::hasTable('attachments')) {
            Schema::table('attachments', function (Blueprint $table) {
                $table->uuid('actor_id')->nullable()->index();
                $table->string('purpose', 50)->nullable()->index();
                $table->unsignedBigInteger('assignment_id')->nullable()->index();
                $table->string('claimed_by_type', 50)->nullable();
                $table->string('claimed_by_id', 100)->nullable();
                $table->timestamp('claimed_at')->nullable();
                $table->unique('upload_session_id', 'attachments_upload_session_unique');
            });

            DB::table('attachments')->orderBy('id')->each(function ($attachment) {
                $session = DB::table('upload_sessions')->where('id', $attachment->upload_session_id)->first();
                if ($session) {
                    DB::table('attachments')->where('id', $attachment->id)->update([
                        'actor_id' => $session->actor_id,
                        'purpose' => $session->purpose,
                        'assignment_id' => $session->assignment_id,
                    ]);
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('attachments')) {
            Schema::table('attachments', function (Blueprint $table) {
                $table->dropUnique('attachments_upload_session_unique');
                $table->dropColumn([
                    'actor_id',
                    'purpose',
                    'assignment_id',
                    'claimed_by_type',
                    'claimed_by_id',
                    'claimed_at',
                ]);
            });
        }

        if (Schema::hasTable('tugas') && Schema::hasColumn('tugas', 'status')) {
            Schema::table('tugas', function (Blueprint $table) {
                $table->dropColumn('status');
            });
        }
    }
};
