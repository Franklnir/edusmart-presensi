<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        $this->createTable();
        $this->backfillCurrentClassHistories();
        $this->createPostgresSyncTrigger();
    }

    public function down(): void
    {
        if ($this->isPostgres()) {
            DB::statement('DROP TRIGGER IF EXISTS profiles_student_class_history_sync ON profiles');
            DB::statement('DROP FUNCTION IF EXISTS sync_student_class_history_from_profiles()');
        }

        Schema::dropIfExists('student_class_histories');
    }

    private function createTable(): void
    {
        if (Schema::hasTable('student_class_histories')) {
            return;
        }

        if ($this->isPostgres()) {
            DB::statement('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
        }

        Schema::create('student_class_histories', function (Blueprint $table) {
            $id = $table->uuid('id')->primary();
            if ($this->isPostgres()) {
                $id->default(DB::raw('gen_random_uuid()'));
            }

            $table->uuid('tenant_id')->nullable();
            $table->uuid('student_id');
            $table->text('class_id')->nullable();
            $table->text('class_name')->nullable();
            $table->text('grade')->nullable();
            $table->text('suffix')->nullable();
            $table->text('angkatan')->nullable();
            $table->text('tahun_ajaran')->nullable();
            $table->text('semester')->nullable();
            $table->text('status')->nullable();
            $table->text('source')->default('system');
            $table->text('note')->nullable();
            $table->timestampTz('valid_from')->useCurrent();
            $table->timestampTz('valid_until')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('updated_at')->useCurrent();

            $table->index(['tenant_id', 'student_id', 'valid_until'], 'student_class_histories_student_open_idx');
            $table->index(['tenant_id', 'tahun_ajaran', 'semester', 'class_id'], 'student_class_histories_period_class_idx');
            $table->index(['tenant_id', 'class_id', 'angkatan'], 'student_class_histories_class_cohort_idx');
            $table->foreign('student_id')->references('id')->on('profiles')->cascadeOnDelete();
            if (Schema::hasTable('tenants')) {
                $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            }
        });
    }

    private function backfillCurrentClassHistories(): void
    {
        if (
            ! Schema::hasTable('student_class_histories')
            || ! Schema::hasTable('profiles')
            || ! Schema::hasColumn('profiles', 'kelas')
        ) {
            return;
        }

        $settingsByTenant = $this->settingsByTenant();
        $classMap = $this->classMap();

        DB::table('profiles')
            ->where('role', 'siswa')
            ->whereNotNull('kelas')
            ->where('kelas', '!=', '')
            ->orderBy('id')
            ->select($this->existingColumns('profiles', [
                'id', 'tenant_id', 'kelas', 'angkatan', 'status', 'created_at', 'updated_at',
            ]))
            ->chunk(500, function ($rows) use ($settingsByTenant, $classMap) {
                $studentIds = $rows->pluck('id')->filter()->values()->all();
                $alreadyLogged = DB::table('student_class_histories')
                    ->whereIn('student_id', $studentIds)
                    ->pluck('student_id')
                    ->map(fn ($id) => (string) $id)
                    ->flip();

                $inserts = [];
                foreach ($rows as $row) {
                    $studentId = (string) ($row->id ?? '');
                    if ($studentId === '' || $alreadyLogged->has($studentId)) {
                        continue;
                    }

                    $tenantId = (string) ($row->tenant_id ?? '');
                    $classId = (string) ($row->kelas ?? '');
                    $class = $classMap[$this->classMapKey($tenantId, $classId)] ?? null;
                    $period = $this->periodForTenant($settingsByTenant, $tenantId);

                    $inserts[] = [
                        'id' => (string) Str::uuid(),
                        'tenant_id' => $tenantId ?: null,
                        'student_id' => $studentId,
                        'class_id' => $classId,
                        'class_name' => $class['nama'] ?? $classId,
                        'grade' => $class['grade'] ?? $this->parseClassGrade($classId),
                        'suffix' => $class['suffix'] ?? null,
                        'angkatan' => $row->angkatan ?? ($class['angkatan'] ?? null),
                        'tahun_ajaran' => $period['tahun_ajaran'] ?? null,
                        'semester' => $period['semester'] ?? null,
                        'status' => $row->status ?? 'active',
                        'source' => 'backfill',
                        'note' => 'Snapshot posisi kelas saat riwayat akademik diaktifkan.',
                        'valid_from' => $row->created_at ?? now(),
                        'created_at' => now(),
                        'updated_at' => now(),
                    ];
                }

                foreach (array_chunk($inserts, 500) as $chunk) {
                    DB::table('student_class_histories')->insert($chunk);
                }
            });
    }

    private function createPostgresSyncTrigger(): void
    {
        if (! $this->isPostgres() || ! Schema::hasTable('profiles') || ! Schema::hasTable('student_class_histories')) {
            return;
        }

        DB::statement(<<<'SQL'
CREATE OR REPLACE FUNCTION sync_student_class_history_from_profiles()
RETURNS trigger AS $$
DECLARE
    v_year text;
    v_semester text;
    v_class_name text;
    v_grade text;
    v_suffix text;
    v_class_angkatan text;
BEGIN
    IF lower(coalesce(NEW.role, '')) <> 'siswa' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF coalesce(OLD.kelas, '') = coalesce(NEW.kelas, '')
            AND coalesce(OLD.angkatan, '') = coalesce(NEW.angkatan, '')
            AND coalesce(OLD.status, '') = coalesce(NEW.status, '') THEN
            RETURN NEW;
        END IF;

        UPDATE student_class_histories
        SET valid_until = now(), updated_at = now()
        WHERE student_id = NEW.id
          AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
          AND valid_until IS NULL;
    END IF;

    IF coalesce(NEW.kelas, '') = '' THEN
        RETURN NEW;
    END IF;

    SELECT tahun_ajaran, semester_aktif
    INTO v_year, v_semester
    FROM settings
    WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
    ORDER BY id
    LIMIT 1;

    SELECT nama, grade, suffix, angkatan
    INTO v_class_name, v_grade, v_suffix, v_class_angkatan
    FROM kelas
    WHERE id = NEW.kelas
      AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
    LIMIT 1;

    IF NOT EXISTS (
        SELECT 1
        FROM student_class_histories
        WHERE student_id = NEW.id
          AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
          AND valid_until IS NULL
          AND coalesce(class_id, '') = coalesce(NEW.kelas, '')
          AND coalesce(tahun_ajaran, '') = coalesce(v_year, '')
          AND coalesce(semester, '') = coalesce(v_semester, '')
    ) THEN
        INSERT INTO student_class_histories (
            id, tenant_id, student_id, class_id, class_name, grade, suffix,
            angkatan, tahun_ajaran, semester, status, source, note,
            valid_from, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), NEW.tenant_id, NEW.id, NEW.kelas,
            coalesce(v_class_name, NEW.kelas), v_grade, v_suffix,
            coalesce(NEW.angkatan, v_class_angkatan), v_year, v_semester,
            NEW.status,
            CASE WHEN TG_OP = 'INSERT' THEN 'profile_create' ELSE 'profile_update' END,
            'Dicatat otomatis saat kelas/status siswa berubah.',
            now(), now(), now()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
SQL);

        DB::statement('DROP TRIGGER IF EXISTS profiles_student_class_history_sync ON profiles');
        DB::statement(<<<'SQL'
CREATE TRIGGER profiles_student_class_history_sync
AFTER INSERT OR UPDATE OF kelas, angkatan, status, role ON profiles
FOR EACH ROW
EXECUTE FUNCTION sync_student_class_history_from_profiles()
SQL);
    }

    private function settingsByTenant()
    {
        if (! Schema::hasTable('settings')) {
            return collect();
        }

        $columns = $this->existingColumns('settings', [
            'tenant_id', 'tahun_ajaran', 'semester_aktif', 'periode_mulai', 'periode_selesai',
            'periode_ganjil_mulai', 'periode_ganjil_selesai', 'periode_genap_mulai', 'periode_genap_selesai',
        ]);

        return DB::table('settings')
            ->orderBy('id')
            ->get($columns)
            ->keyBy(fn ($row) => (string) ($row->tenant_id ?? ''));
    }

    private function classMap(): array
    {
        if (! Schema::hasTable('kelas')) {
            return [];
        }

        $rows = DB::table('kelas')
            ->select($this->existingColumns('kelas', ['tenant_id', 'id', 'nama', 'grade', 'suffix', 'angkatan']))
            ->get();

        $map = [];
        foreach ($rows as $row) {
            $tenantId = (string) ($row->tenant_id ?? '');
            $classId = (string) ($row->id ?? '');
            $map[$this->classMapKey($tenantId, $classId)] = [
                'nama' => $row->nama ?? $classId,
                'grade' => $row->grade ?? $this->parseClassGrade($classId),
                'suffix' => $row->suffix ?? null,
                'angkatan' => $row->angkatan ?? null,
            ];
        }

        return $map;
    }

    private function periodForTenant($settingsByTenant, string $tenantId): array
    {
        $settings = $settingsByTenant->get($tenantId) ?: $settingsByTenant->get('');

        return AcademicPeriod::fromSettings($settings);
    }

    private function classMapKey(string $tenantId, string $classId): string
    {
        return $tenantId.'|'.$classId;
    }

    private function existingColumns(string $table, array $columns): array
    {
        return array_values(array_filter(
            $columns,
            fn ($column) => Schema::hasColumn($table, (string) $column)
        ));
    }

    private function parseClassGrade(string $value): string
    {
        $normalized = strtoupper(trim((string) preg_replace('/[\s_-]+/', ' ', $value)));
        if (preg_match('/^(XII|XI|X|IX|VIII|VII)\b/', $normalized, $matches)) {
            return $matches[1];
        }

        return '';
    }

    private function isPostgres(): bool
    {
        return DB::getDriverName() === 'pgsql';
    }
};
