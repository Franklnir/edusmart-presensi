<?php

namespace App\Console\Commands;

use App\Services\Academic\AcademicReferenceConsistencyService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class VerifyAcademicReferencesCommand extends Command
{
    protected $signature = 'academic:verify-period-refs
        {--tenant= : UUID atau slug tenant yang akan diperiksa}
        {--json : Tampilkan hasil sebagai JSON}
        {--strict : Kembalikan exit code gagal jika ditemukan inkonsistensi}';

    protected $description = 'Membandingkan periode legacy dengan referensi academic year/term hasil normalisasi.';

    public function handle(AcademicReferenceConsistencyService $service): int
    {
        $tenant = trim((string) $this->option('tenant'));
        $tenantId = $this->resolveTenantId($tenant);
        if ($tenant !== '' && $tenantId === null) {
            $this->error('Tenant tidak ditemukan.');

            return self::INVALID;
        }

        $report = $service->inspect($tenantId);
        if ($this->option('json')) {
            $this->line((string) json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        } else {
            $rows = collect($report['tables'])
                ->map(fn (array $metrics, string $table) => [
                    $table,
                    $metrics['rows_with_legacy_period'],
                    $metrics['missing_academic_year_id'],
                    $metrics['invalid_or_mismatched_year'],
                    $metrics['missing_academic_term_id'],
                    $metrics['invalid_or_mismatched_term'],
                    $metrics['issues'],
                ])
                ->values()
                ->all();
            $this->table([
                'Table', 'Rows', 'Year null', 'Year mismatch', 'Term null', 'Term mismatch', 'Issues',
            ], $rows);
            $this->line('Tenant: '.($tenantId ?? 'semua tenant'));
            $this->line('Total issue: '.$report['issue_count']);
        }

        if ($report['ready_for_id_reads']) {
            $this->info('Referensi periode konsisten dan siap untuk tahap read-by-ID.');

            return self::SUCCESS;
        }

        $this->warn('Belum siap cutover read-by-ID. Jalankan backfill/perbaikan sebelum melanjutkan.');

        return $this->option('strict') ? self::FAILURE : self::SUCCESS;
    }

    private function resolveTenantId(string $tenant): ?string
    {
        if ($tenant === '') {
            return null;
        }

        return DB::table('tenants')
            ->where('id', $tenant)
            ->orWhere('slug', $tenant)
            ->value('id');
    }
}
