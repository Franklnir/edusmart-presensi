<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('settings')) {
            Schema::table('settings', function (Blueprint $table) {
                if (! Schema::hasColumn('settings', 'periode_mulai')) {
                    $table->date('periode_mulai')->nullable()->after('semester_aktif');
                }
                if (! Schema::hasColumn('settings', 'periode_selesai')) {
                    $table->date('periode_selesai')->nullable()->after('periode_mulai');
                }
            });

            DB::table('settings')
                ->orderBy('id')
                ->chunkById(200, function ($rows) {
                    foreach ($rows as $row) {
                        $period = AcademicPeriod::make($row->tahun_ajaran ?? null, $row->semester_aktif ?? null);
                        DB::table('settings')
                            ->where('id', $row->id)
                            ->where(function ($query) {
                                $query->whereNull('periode_mulai')
                                    ->orWhereNull('periode_selesai');
                            })
                            ->update([
                                'periode_mulai' => $period['starts_at'],
                                'periode_selesai' => $period['ends_at'],
                            ]);
                    }
                });
        }

        $this->relaxGlobalUserEmailUniqueness();
        $this->relaxGlobalGoogleIdUniqueness();
        $this->addLookupIndexes();
    }

    public function down(): void
    {
        if (Schema::hasTable('settings')) {
            Schema::table('settings', function (Blueprint $table) {
                if (Schema::hasColumn('settings', 'periode_selesai')) {
                    $table->dropColumn('periode_selesai');
                }
                if (Schema::hasColumn('settings', 'periode_mulai')) {
                    $table->dropColumn('periode_mulai');
                }
            });
        }

        $this->dropLookupIndexes();

        try {
            if (Schema::hasTable('users') && Schema::hasColumn('users', 'email')) {
                Schema::table('users', function (Blueprint $table) {
                    $table->unique('email', 'users_email_unique');
                });
            }
        } catch (Throwable $e) {
            // A rollback cannot restore global uniqueness when duplicate tenant users already exist.
        }
    }

    private function relaxGlobalUserEmailUniqueness(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'email')) {
            return;
        }

        $driver = DB::getDriverName();

        try {
            if ($driver === 'pgsql') {
                DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_unique');
                DB::statement('DROP INDEX IF EXISTS users_email_unique');
            } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
                DB::statement('ALTER TABLE users DROP INDEX users_email_unique');
            } else {
                Schema::table('users', function (Blueprint $table) {
                    $table->dropUnique('users_email_unique');
                });
            }
        } catch (Throwable $e) {
            // Older/local databases may already have a relaxed email index.
        }
    }

    private function relaxGlobalGoogleIdUniqueness(): void
    {
        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'google_id')) {
            return;
        }

        $driver = DB::getDriverName();

        try {
            if ($driver === 'pgsql') {
                DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_google_id_unique');
                DB::statement('DROP INDEX IF EXISTS users_google_id_unique');
            } elseif (in_array($driver, ['mysql', 'mariadb'], true)) {
                DB::statement('ALTER TABLE users DROP INDEX users_google_id_unique');
            } else {
                Schema::table('users', function (Blueprint $table) {
                    $table->dropUnique('users_google_id_unique');
                });
            }
        } catch (Throwable $e) {
            // Same as email: keep migration idempotent across restored backups.
        }
    }

    private function addLookupIndexes(): void
    {
        if (Schema::hasTable('users') && Schema::hasColumn('users', 'email')) {
            try {
                Schema::table('users', function (Blueprint $table) {
                    $table->index('email', 'users_email_lookup_idx');
                });
            } catch (Throwable $e) {
                // index already exists
            }
        }

        if (Schema::hasTable('users') && Schema::hasColumn('users', 'google_id')) {
            try {
                Schema::table('users', function (Blueprint $table) {
                    $table->index('google_id', 'users_google_id_lookup_idx');
                });
            } catch (Throwable $e) {
                // index already exists
            }
        }

        if (
            Schema::hasTable('profiles')
            && Schema::hasColumn('profiles', 'tenant_id')
            && Schema::hasColumn('profiles', 'email')
        ) {
            try {
                Schema::table('profiles', function (Blueprint $table) {
                    $table->index(['tenant_id', 'email'], 'profiles_tenant_email_lookup_idx');
                });
            } catch (Throwable $e) {
                // index already exists
            }
        }
    }

    private function dropLookupIndexes(): void
    {
        foreach ([
            ['users', 'users_email_lookup_idx'],
            ['users', 'users_google_id_lookup_idx'],
            ['profiles', 'profiles_tenant_email_lookup_idx'],
        ] as [$tableName, $indexName]) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            try {
                Schema::table($tableName, function (Blueprint $table) use ($indexName) {
                    $table->dropIndex($indexName);
                });
            } catch (Throwable $e) {
                // ignore missing indexes
            }
        }
    }
};
