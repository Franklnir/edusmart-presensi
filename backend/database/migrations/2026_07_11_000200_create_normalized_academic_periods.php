<?php

use App\Support\AcademicPeriod;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    private array $yearTables = [
        'jadwal',
        'kelas_struktur',
        'struktur_sekolah',
        'organisasi',
        'organisasi_anggota',
    ];

    private array $termTables = [
        'tugas',
        'quizzes',
        'absensi',
        'absensi_ajuan',
        'absensi_settings',
        'absensi_eskul',
        'jam_kosong',
        'ekskul',
        'ekskul_anggota',
        'anggota_ekskul',
        'student_class_histories',
        'tugas_jawaban',
        'quiz_submissions',
        'guru_mapel_bobot',
        'guru_mapel_manual_nilai',
    ];

    public function up(): void
    {
        $this->createAcademicYears();
        $this->createAcademicTerms();
        $this->createCorrectionSessions();
        $this->createRolloverRuns();
        $this->addReferenceColumns();
        $this->backfillNormalizedPeriods();
        $this->addTenantSafeForeignKeys();
        $this->addPostgresGuards();
    }

    public function down(): void
    {
        $this->dropPostgresGuards();

        foreach (array_unique(array_merge($this->yearTables, $this->termTables, ['rapot_siswa'])) as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }

            Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                foreach (['academic_term_id', 'academic_year_id'] as $column) {
                    if (Schema::hasColumn($tableName, $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        if (Schema::hasTable('settings')) {
            Schema::table('settings', function (Blueprint $table) {
                foreach (['current_academic_term_id', 'current_academic_year_id'] as $column) {
                    if (Schema::hasColumn('settings', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        Schema::dropIfExists('academic_rollover_runs');
        Schema::dropIfExists('academic_correction_sessions');
        Schema::dropIfExists('academic_terms');
        Schema::dropIfExists('academic_years');
    }

    private function createAcademicYears(): void
    {
        if (Schema::hasTable('academic_years')) {
            return;
        }

        Schema::create('academic_years', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->string('label', 20);
            $table->date('starts_at');
            $table->date('ends_at');
            $table->string('status', 16)->default('draft');
            $table->unsignedInteger('lock_version')->default(1);
            $table->timestampTz('activated_at')->nullable();
            $table->uuid('activated_by')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->timestampsTz();

            $table->unique(['tenant_id', 'label'], 'academic_years_tenant_label_unique');
            $table->unique(['tenant_id', 'id'], 'academic_years_tenant_id_unique');
            $table->index(['tenant_id', 'status'], 'academic_years_tenant_status_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('activated_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('closed_by')->references('id')->on('users')->nullOnDelete();
        });
    }

    private function createAcademicTerms(): void
    {
        if (Schema::hasTable('academic_terms')) {
            return;
        }

        Schema::create('academic_terms', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('academic_year_id');
            $table->string('semester', 16);
            $table->date('starts_at');
            $table->date('ends_at');
            $table->string('status', 16)->default('draft');
            $table->unsignedInteger('lock_version')->default(1);
            $table->timestampTz('activated_at')->nullable();
            $table->uuid('activated_by')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->timestampsTz();

            $table->unique(['tenant_id', 'academic_year_id', 'semester'], 'academic_terms_tenant_year_sem_unique');
            $table->unique(['tenant_id', 'id'], 'academic_terms_tenant_id_unique');
            $table->index(['tenant_id', 'status'], 'academic_terms_tenant_status_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'academic_year_id'])
                ->references(['tenant_id', 'id'])
                ->on('academic_years')
                ->cascadeOnDelete();
            $table->foreign('activated_by')->references('id')->on('users')->nullOnDelete();
            $table->foreign('closed_by')->references('id')->on('users')->nullOnDelete();
        });
    }

    private function createCorrectionSessions(): void
    {
        if (Schema::hasTable('academic_correction_sessions')) {
            return;
        }

        Schema::create('academic_correction_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('academic_year_id');
            $table->uuid('academic_term_id')->nullable();
            $table->uuid('requested_by');
            $table->text('reason');
            $table->json('allowed_scopes');
            $table->string('status', 16)->default('active');
            $table->timestampTz('expires_at');
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'requested_by', 'status'], 'academic_corrections_actor_status_idx');
            $table->index(['tenant_id', 'expires_at'], 'academic_corrections_expiry_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'academic_year_id'])
                ->references(['tenant_id', 'id'])
                ->on('academic_years')
                ->cascadeOnDelete();
            $table->foreign(['tenant_id', 'academic_term_id'])
                ->references(['tenant_id', 'id'])
                ->on('academic_terms')
                ->restrictOnDelete();
            $table->foreign('requested_by')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('closed_by')->references('id')->on('users')->nullOnDelete();
        });
    }

    private function createRolloverRuns(): void
    {
        if (Schema::hasTable('academic_rollover_runs')) {
            return;
        }

        Schema::create('academic_rollover_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('source_academic_year_id')->nullable();
            $table->uuid('target_academic_year_id');
            $table->string('operation', 40)->default('annual_rollover');
            $table->string('idempotency_key', 160);
            $table->string('status', 20)->default('running');
            $table->json('result')->nullable();
            $table->text('error_message')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampTz('started_at')->useCurrent();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampsTz();

            $table->unique(['tenant_id', 'idempotency_key'], 'academic_rollover_runs_idempotency_unique');
            $table->index(['tenant_id', 'target_academic_year_id', 'status'], 'academic_rollover_target_status_idx');
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'source_academic_year_id'])
                ->references(['tenant_id', 'id'])
                ->on('academic_years')
                ->restrictOnDelete();
            $table->foreign(['tenant_id', 'target_academic_year_id'])
                ->references(['tenant_id', 'id'])
                ->on('academic_years')
                ->cascadeOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
        });
    }

    private function addReferenceColumns(): void
    {
        if (Schema::hasTable('settings')) {
            Schema::table('settings', function (Blueprint $table) {
                if (! Schema::hasColumn('settings', 'current_academic_year_id')) {
                    $table->uuid('current_academic_year_id')->nullable();
                }
                if (! Schema::hasColumn('settings', 'current_academic_term_id')) {
                    $table->uuid('current_academic_term_id')->nullable();
                }
            });
        }

        foreach ($this->yearTables as $tableName) {
            $this->addPeriodReferenceColumns($tableName, false);
        }
        foreach ($this->termTables as $tableName) {
            $this->addPeriodReferenceColumns($tableName, true);
        }
        $this->addPeriodReferenceColumns('rapot_siswa', true);
    }

    private function addPeriodReferenceColumns(string $tableName, bool $withTerm): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($tableName, $withTerm) {
            if (! Schema::hasColumn($tableName, 'academic_year_id')) {
                $table->uuid('academic_year_id')->nullable();
            }
            if ($withTerm && ! Schema::hasColumn($tableName, 'academic_term_id')) {
                $table->uuid('academic_term_id')->nullable();
            }
        });

        $this->createIndexIfPossible(
            $tableName,
            $withTerm
                ? ['tenant_id', 'academic_term_id']
                : ['tenant_id', 'academic_year_id'],
            substr($tableName.'_tenant_academic_ref_idx', 0, 60)
        );
    }

    private function backfillNormalizedPeriods(): void
    {
        if (! Schema::hasTable('tenants')) {
            return;
        }

        $tenantIds = DB::table('tenants')->pluck('id')->map(fn ($id) => (string) $id)->all();
        foreach ($tenantIds as $tenantId) {
            $settings = Schema::hasTable('settings')
                ? DB::table('settings')->where('tenant_id', $tenantId)->orderBy('id')->first()
                : null;
            $activeYear = AcademicPeriod::normalizeAcademicYear($settings->tahun_ajaran ?? null);
            $activeSemester = AcademicPeriod::normalizeSemester($settings->semester_aktif ?? null);
            $periods = [];

            if ($activeYear) {
                $periods[$activeYear][$activeSemester ?: AcademicPeriod::SEMESTER_GANJIL] = true;
            }

            foreach (array_unique(array_merge($this->yearTables, $this->termTables)) as $tableName) {
                if (
                    ! Schema::hasTable($tableName)
                    || ! Schema::hasColumn($tableName, 'tenant_id')
                    || ! Schema::hasColumn($tableName, 'tahun_ajaran')
                ) {
                    continue;
                }

                $columns = ['tahun_ajaran'];
                if (Schema::hasColumn($tableName, 'semester')) {
                    $columns[] = 'semester';
                }
                $rows = DB::table($tableName)
                    ->where('tenant_id', $tenantId)
                    ->whereNotNull('tahun_ajaran')
                    ->select($columns)
                    ->distinct()
                    ->get();

                foreach ($rows as $row) {
                    $year = AcademicPeriod::normalizeAcademicYear($row->tahun_ajaran ?? null);
                    $semester = AcademicPeriod::normalizeSemester($row->semester ?? null);
                    if (! $year) {
                        continue;
                    }
                    $periods[$year][$semester ?: AcademicPeriod::SEMESTER_GANJIL] = true;
                }
            }

            if (Schema::hasTable('rapot_siswa') && Schema::hasColumn('rapot_siswa', 'tahun_pelajaran')) {
                $rapotRows = DB::table('rapot_siswa')
                    ->where('tenant_id', $tenantId)
                    ->select(['tahun_pelajaran', 'semester'])
                    ->distinct()
                    ->get();
                foreach ($rapotRows as $rapotRow) {
                    $year = AcademicPeriod::normalizeAcademicYear($rapotRow->tahun_pelajaran ?? null);
                    $semester = AcademicPeriod::normalizeSemester($rapotRow->semester ?? null);
                    if ($year) {
                        $periods[$year][$semester ?: AcademicPeriod::SEMESTER_GANJIL] = true;
                    }
                }
            }

            ksort($periods, SORT_NATURAL);
            foreach (array_keys($periods) as $year) {
                $this->ensureNormalizedYearAndTerms($tenantId, $year, $activeYear, $activeSemester, $settings);
            }

            $this->backfillTenantReferences($tenantId, $settings);
        }
    }

    private function ensureNormalizedYearAndTerms(
        string $tenantId,
        string $year,
        ?string $activeYear,
        ?string $activeSemester,
        ?object $settings
    ): void {
        $ganjil = AcademicPeriod::make(
            $year,
            AcademicPeriod::SEMESTER_GANJIL,
            $year === $activeYear ? ($settings->periode_ganjil_mulai ?? null) : null,
            $year === $activeYear ? ($settings->periode_ganjil_selesai ?? null) : null
        );
        $genap = AcademicPeriod::make(
            $year,
            AcademicPeriod::SEMESTER_GENAP,
            $year === $activeYear ? ($settings->periode_genap_mulai ?? null) : null,
            $year === $activeYear ? ($settings->periode_genap_selesai ?? null) : null
        );
        $yearStatus = $this->yearStatus($year, $activeYear);
        $now = now();
        $yearId = (string) DB::table('academic_years')
            ->where('tenant_id', $tenantId)
            ->where('label', $year)
            ->value('id');

        if ($yearId === '') {
            $yearId = (string) Str::uuid();
            DB::table('academic_years')->insert([
                'id' => $yearId,
                'tenant_id' => $tenantId,
                'label' => $year,
                'starts_at' => $ganjil['starts_at'],
                'ends_at' => $genap['ends_at'],
                'status' => $yearStatus,
                'activated_at' => $yearStatus === 'active' ? $now : null,
                'closed_at' => $yearStatus === 'closed' ? $now : null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        foreach ([AcademicPeriod::SEMESTER_GANJIL => $ganjil, AcademicPeriod::SEMESTER_GENAP => $genap] as $semester => $period) {
            $exists = DB::table('academic_terms')
                ->where('tenant_id', $tenantId)
                ->where('academic_year_id', $yearId)
                ->where('semester', $semester)
                ->exists();
            if ($exists) {
                continue;
            }

            $termStatus = $this->termStatus($year, $semester, $activeYear, $activeSemester);
            DB::table('academic_terms')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'academic_year_id' => $yearId,
                'semester' => $semester,
                'starts_at' => $period['starts_at'],
                'ends_at' => $period['ends_at'],
                'status' => $termStatus,
                'activated_at' => $termStatus === 'active' ? $now : null,
                'closed_at' => $termStatus === 'closed' ? $now : null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    private function backfillTenantReferences(string $tenantId, ?object $settings): void
    {
        foreach ($this->yearTables as $tableName) {
            $this->backfillTableReferences($tableName, $tenantId, 'tahun_ajaran', false);
        }
        foreach ($this->termTables as $tableName) {
            $this->backfillTableReferences($tableName, $tenantId, 'tahun_ajaran', true);
        }
        $this->backfillTableReferences('rapot_siswa', $tenantId, 'tahun_pelajaran', true);

        if (! $settings || ! Schema::hasTable('settings')) {
            return;
        }

        $year = AcademicPeriod::normalizeAcademicYear($settings->tahun_ajaran ?? null);
        $semester = AcademicPeriod::normalizeSemester($settings->semester_aktif ?? null);
        if (! $year || ! $semester) {
            return;
        }

        $yearRow = DB::table('academic_years')->where('tenant_id', $tenantId)->where('label', $year)->first();
        $termRow = $yearRow
            ? DB::table('academic_terms')
                ->where('tenant_id', $tenantId)
                ->where('academic_year_id', $yearRow->id)
                ->where('semester', $semester)
                ->first()
            : null;
        if ($yearRow && $termRow) {
            DB::table('settings')->where('id', $settings->id)->update([
                'current_academic_year_id' => $yearRow->id,
                'current_academic_term_id' => $termRow->id,
            ]);
        }
    }

    private function backfillTableReferences(
        string $tableName,
        string $tenantId,
        string $yearColumn,
        bool $withTerm
    ): void {
        if (
            ! Schema::hasTable($tableName)
            || ! Schema::hasColumn($tableName, 'tenant_id')
            || ! Schema::hasColumn($tableName, $yearColumn)
            || ! Schema::hasColumn($tableName, 'academic_year_id')
        ) {
            return;
        }

        $years = DB::table($tableName)
            ->where('tenant_id', $tenantId)
            ->whereNotNull($yearColumn)
            ->distinct()
            ->pluck($yearColumn);
        foreach ($years as $rawYear) {
            $year = AcademicPeriod::normalizeAcademicYear($rawYear);
            if (! $year) {
                continue;
            }
            $yearId = (string) DB::table('academic_years')
                ->where('tenant_id', $tenantId)
                ->where('label', $year)
                ->value('id');
            if ($yearId === '') {
                continue;
            }

            DB::table($tableName)
                ->where('tenant_id', $tenantId)
                ->where($yearColumn, $rawYear)
                ->update(['academic_year_id' => $yearId]);

            if (
                ! $withTerm
                || ! Schema::hasColumn($tableName, 'semester')
                || ! Schema::hasColumn($tableName, 'academic_term_id')
            ) {
                continue;
            }

            foreach ([AcademicPeriod::SEMESTER_GANJIL, AcademicPeriod::SEMESTER_GENAP] as $semester) {
                $termId = (string) DB::table('academic_terms')
                    ->where('tenant_id', $tenantId)
                    ->where('academic_year_id', $yearId)
                    ->where('semester', $semester)
                    ->value('id');
                if ($termId !== '') {
                    DB::table($tableName)
                        ->where('tenant_id', $tenantId)
                        ->where($yearColumn, $rawYear)
                        ->where('semester', $semester)
                        ->update(['academic_term_id' => $termId]);
                }
            }
        }
    }

    private function yearStatus(string $year, ?string $activeYear): string
    {
        if (! $activeYear) {
            return 'closed';
        }
        if ($year === $activeYear) {
            return 'active';
        }

        return strcmp($year, $activeYear) < 0 ? 'closed' : 'draft';
    }

    private function termStatus(
        string $year,
        string $semester,
        ?string $activeYear,
        ?string $activeSemester
    ): string {
        $yearStatus = $this->yearStatus($year, $activeYear);
        if ($yearStatus !== 'active') {
            return $yearStatus;
        }
        if ($semester === $activeSemester) {
            return 'active';
        }
        if ($activeSemester === AcademicPeriod::SEMESTER_GENAP && $semester === AcademicPeriod::SEMESTER_GANJIL) {
            return 'closed';
        }

        return 'draft';
    }

    private function addTenantSafeForeignKeys(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        $yearReferenceTables = array_unique(array_merge($this->yearTables, $this->termTables, ['rapot_siswa']));
        foreach ($yearReferenceTables as $tableName) {
            if (! $this->hasReferenceColumns($tableName, 'academic_year_id')) {
                continue;
            }
            $constraint = substr($tableName.'_tenant_academic_year_fk', 0, 60);
            DB::statement(sprintf(
                'ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (tenant_id, academic_year_id) REFERENCES academic_years (tenant_id, id) ON DELETE RESTRICT',
                $this->quoteIdentifier($tableName),
                $this->quoteIdentifier($constraint)
            ));
        }

        foreach (array_unique(array_merge($this->termTables, ['rapot_siswa'])) as $tableName) {
            if (! $this->hasReferenceColumns($tableName, 'academic_term_id')) {
                continue;
            }
            $constraint = substr($tableName.'_tenant_academic_term_fk', 0, 60);
            DB::statement(sprintf(
                'ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (tenant_id, academic_term_id) REFERENCES academic_terms (tenant_id, id) ON DELETE RESTRICT',
                $this->quoteIdentifier($tableName),
                $this->quoteIdentifier($constraint)
            ));
        }

        if (
            Schema::hasTable('settings')
            && Schema::hasColumn('settings', 'tenant_id')
            && Schema::hasColumn('settings', 'current_academic_year_id')
        ) {
            DB::statement(
                'ALTER TABLE settings ADD CONSTRAINT settings_tenant_academic_year_fk '.
                'FOREIGN KEY (tenant_id, current_academic_year_id) '.
                'REFERENCES academic_years (tenant_id, id) ON DELETE RESTRICT'
            );
        }
        if (
            Schema::hasTable('settings')
            && Schema::hasColumn('settings', 'tenant_id')
            && Schema::hasColumn('settings', 'current_academic_term_id')
        ) {
            DB::statement(
                'ALTER TABLE settings ADD CONSTRAINT settings_tenant_academic_term_fk '.
                'FOREIGN KEY (tenant_id, current_academic_term_id) '.
                'REFERENCES academic_terms (tenant_id, id) ON DELETE RESTRICT'
            );
        }
    }

    private function addPostgresGuards(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE academic_years ADD CONSTRAINT academic_years_status_check CHECK (status IN ('draft', 'active', 'closed'))");
        DB::statement('ALTER TABLE academic_years ADD CONSTRAINT academic_years_date_check CHECK (starts_at <= ends_at)');
        DB::statement("ALTER TABLE academic_terms ADD CONSTRAINT academic_terms_status_check CHECK (status IN ('draft', 'active', 'closed'))");
        DB::statement("ALTER TABLE academic_terms ADD CONSTRAINT academic_terms_semester_check CHECK (semester IN ('Ganjil', 'Genap'))");
        DB::statement('ALTER TABLE academic_terms ADD CONSTRAINT academic_terms_date_check CHECK (starts_at <= ends_at)');
        DB::statement("ALTER TABLE academic_correction_sessions ADD CONSTRAINT academic_corrections_status_check CHECK (status IN ('active', 'closed', 'expired'))");
        DB::statement("ALTER TABLE academic_rollover_runs ADD CONSTRAINT academic_rollover_status_check CHECK (status IN ('running', 'completed', 'failed'))");
        DB::statement("CREATE UNIQUE INDEX academic_years_one_active_per_tenant ON academic_years (tenant_id) WHERE status = 'active'");
        DB::statement("CREATE UNIQUE INDEX academic_terms_one_active_per_tenant ON academic_terms (tenant_id) WHERE status = 'active'");

        foreach (['academic_years', 'academic_terms', 'academic_correction_sessions', 'academic_rollover_runs'] as $tableName) {
            $policyName = $tableName.'_tenant_isolation';
            DB::statement('ALTER TABLE '.$this->quoteIdentifier($tableName).' ENABLE ROW LEVEL SECURITY');
            DB::statement(sprintf(
                "CREATE POLICY %s ON %s USING (tenant_id::text = NULLIF(current_setting('app.current_tenant_id', true), '')) WITH CHECK (tenant_id::text = NULLIF(current_setting('app.current_tenant_id', true), ''))",
                $this->quoteIdentifier($policyName),
                $this->quoteIdentifier($tableName)
            ));
        }

        DB::unprepared(<<<'SQL'
CREATE OR REPLACE FUNCTION sismu_assign_academic_year_ref()
RETURNS trigger AS $$
BEGIN
    IF NEW.tenant_id IS NOT NULL AND NULLIF(NEW.tahun_ajaran, '') IS NOT NULL THEN
        SELECT id INTO NEW.academic_year_id
        FROM academic_years
        WHERE tenant_id = NEW.tenant_id AND label = NEW.tahun_ajaran
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sismu_assign_academic_term_ref()
RETURNS trigger AS $$
BEGIN
    IF NEW.tenant_id IS NOT NULL AND NULLIF(NEW.tahun_ajaran, '') IS NOT NULL THEN
        SELECT id INTO NEW.academic_year_id
        FROM academic_years
        WHERE tenant_id = NEW.tenant_id AND label = NEW.tahun_ajaran
        LIMIT 1;

        IF NEW.academic_year_id IS NOT NULL AND NULLIF(NEW.semester, '') IS NOT NULL THEN
            SELECT id INTO NEW.academic_term_id
            FROM academic_terms
            WHERE tenant_id = NEW.tenant_id
              AND academic_year_id = NEW.academic_year_id
              AND semester = NEW.semester
            LIMIT 1;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sismu_validate_academic_term_range()
RETURNS trigger AS $$
DECLARE
    parent_start date;
    parent_end date;
BEGIN
    SELECT starts_at, ends_at
      INTO parent_start, parent_end
      FROM academic_years
     WHERE tenant_id = NEW.tenant_id
       AND id = NEW.academic_year_id;

    IF parent_start IS NULL OR NEW.starts_at < parent_start OR NEW.ends_at > parent_end THEN
        RAISE EXCEPTION 'Academic term range must stay inside its academic year';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM academic_terms other
         WHERE other.tenant_id = NEW.tenant_id
           AND other.academic_year_id = NEW.academic_year_id
           AND other.id <> NEW.id
           AND daterange(other.starts_at, other.ends_at, '[]') && daterange(NEW.starts_at, NEW.ends_at, '[]')
    ) THEN
        RAISE EXCEPTION 'Academic term ranges cannot overlap';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
SQL);

        DB::statement(
            'CREATE CONSTRAINT TRIGGER academic_terms_validate_range '.
            'AFTER INSERT OR UPDATE ON academic_terms DEFERRABLE INITIALLY DEFERRED '.
            'FOR EACH ROW EXECUTE FUNCTION sismu_validate_academic_term_range()'
        );

        foreach ($this->yearTables as $tableName) {
            $this->createAcademicReferenceTrigger($tableName, false);
        }
        foreach ($this->termTables as $tableName) {
            $this->createAcademicReferenceTrigger($tableName, true);
        }
        $this->createRapotAcademicReferenceTrigger();
    }

    private function createRapotAcademicReferenceTrigger(): void
    {
        if (
            ! $this->hasReferenceColumns('rapot_siswa', 'academic_term_id')
            || ! Schema::hasColumn('rapot_siswa', 'tahun_pelajaran')
            || ! Schema::hasColumn('rapot_siswa', 'semester')
        ) {
            return;
        }

        DB::unprepared(<<<'SQL'
CREATE OR REPLACE FUNCTION sismu_assign_rapot_academic_term_ref()
RETURNS trigger AS $$
BEGIN
    IF NEW.tenant_id IS NOT NULL AND NULLIF(NEW.tahun_pelajaran, '') IS NOT NULL THEN
        SELECT id INTO NEW.academic_year_id
        FROM academic_years
        WHERE tenant_id = NEW.tenant_id AND label = NEW.tahun_pelajaran
        LIMIT 1;

        IF NEW.academic_year_id IS NOT NULL AND NULLIF(NEW.semester, '') IS NOT NULL THEN
            SELECT id INTO NEW.academic_term_id
            FROM academic_terms
            WHERE tenant_id = NEW.tenant_id
              AND academic_year_id = NEW.academic_year_id
              AND semester = NEW.semester
            LIMIT 1;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
SQL);

        DB::statement(
            'CREATE TRIGGER rapot_siswa_assign_academic_ref '.
            'BEFORE INSERT OR UPDATE OF tenant_id, tahun_pelajaran, semester ON rapot_siswa '.
            'FOR EACH ROW EXECUTE FUNCTION sismu_assign_rapot_academic_term_ref()'
        );
    }

    private function createAcademicReferenceTrigger(string $tableName, bool $withTerm): void
    {
        if (
            ! $this->hasReferenceColumns($tableName, $withTerm ? 'academic_term_id' : 'academic_year_id')
            || ! Schema::hasColumn($tableName, 'tahun_ajaran')
            || ($withTerm && ! Schema::hasColumn($tableName, 'semester'))
        ) {
            return;
        }

        $triggerName = substr($tableName.'_assign_academic_ref', 0, 60);
        $functionName = $withTerm ? 'sismu_assign_academic_term_ref' : 'sismu_assign_academic_year_ref';
        DB::statement(sprintf(
            'CREATE TRIGGER %s BEFORE INSERT OR UPDATE OF tenant_id, tahun_ajaran%s ON %s FOR EACH ROW EXECUTE FUNCTION %s()',
            $this->quoteIdentifier($triggerName),
            $withTerm ? ', semester' : '',
            $this->quoteIdentifier($tableName),
            $functionName
        ));
    }

    private function dropPostgresGuards(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        foreach (array_unique(array_merge($this->yearTables, $this->termTables, ['rapot_siswa'])) as $tableName) {
            if (! Schema::hasTable($tableName)) {
                continue;
            }
            $triggerName = substr($tableName.'_assign_academic_ref', 0, 60);
            DB::statement('DROP TRIGGER IF EXISTS '.$this->quoteIdentifier($triggerName).' ON '.$this->quoteIdentifier($tableName));

            $yearConstraint = substr($tableName.'_tenant_academic_year_fk', 0, 60);
            $termConstraint = substr($tableName.'_tenant_academic_term_fk', 0, 60);
            DB::statement(
                'ALTER TABLE '.$this->quoteIdentifier($tableName).
                ' DROP CONSTRAINT IF EXISTS '.$this->quoteIdentifier($yearConstraint)
            );
            DB::statement(
                'ALTER TABLE '.$this->quoteIdentifier($tableName).
                ' DROP CONSTRAINT IF EXISTS '.$this->quoteIdentifier($termConstraint)
            );
        }
        if (Schema::hasTable('settings')) {
            DB::statement('ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_tenant_academic_year_fk');
            DB::statement('ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_tenant_academic_term_fk');
        }
        DB::statement('DROP TRIGGER IF EXISTS academic_terms_validate_range ON academic_terms');
        DB::statement('DROP FUNCTION IF EXISTS sismu_assign_academic_year_ref()');
        DB::statement('DROP FUNCTION IF EXISTS sismu_assign_academic_term_ref()');
        DB::statement('DROP FUNCTION IF EXISTS sismu_assign_rapot_academic_term_ref()');
        DB::statement('DROP FUNCTION IF EXISTS sismu_validate_academic_term_range()');
    }

    private function createIndexIfPossible(string $tableName, array $columns, string $indexName): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }
        foreach ($columns as $column) {
            if (! Schema::hasColumn($tableName, $column)) {
                return;
            }
        }

        try {
            Schema::table($tableName, fn (Blueprint $table) => $table->index($columns, $indexName));
        } catch (Throwable $e) {
            // Fresh and upgraded databases may already contain the index.
        }
    }

    private function hasReferenceColumns(string $tableName, string $reference): bool
    {
        return Schema::hasTable($tableName)
            && Schema::hasColumn($tableName, 'tenant_id')
            && Schema::hasColumn($tableName, $reference);
    }

    private function quoteIdentifier(string $value): string
    {
        return '"'.str_replace('"', '""', $value).'"';
    }
};
