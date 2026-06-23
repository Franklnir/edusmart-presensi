<?php

namespace Tests\Feature;

use App\Services\Backup\TenantBackupService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Mockery;
use Tests\TestCase;

class MonthlyGoogleDriveBackupCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_monthly_backup_command_queues_catch_up_months_with_spacing(): void
    {
        $tenantId = $this->createTenant('sma-bali');

        $service = Mockery::mock(TenantBackupService::class);
        $service->shouldReceive('monthlyCatchUpKeysForTenant')
            ->once()
            ->with($tenantId)
            ->andReturn(['2026-05']);
        $service->shouldReceive('queueMonthlyBackupToGoogleDrive')
            ->once()
            ->with($tenantId, '2026-05', 'system', false, false, 0)
            ->andReturn([
                'job_id' => 'job-2026-05',
                'queued' => true,
            ]);

        $this->app->instance(TenantBackupService::class, $service);

        $this->artisan('backup:monthly-google-drive', [
            '--tenant' => 'sma-bali',
            '--spacing-minutes' => 3,
        ])->assertExitCode(0);
    }

    public function test_monthly_backup_command_skips_tenant_without_due_catch_up_months(): void
    {
        $tenantId = $this->createTenant('sma-bali');

        $service = Mockery::mock(TenantBackupService::class);
        $service->shouldReceive('monthlyCatchUpKeysForTenant')
            ->once()
            ->with($tenantId)
            ->andReturn([]);
        $service->shouldNotReceive('queueMonthlyBackupToGoogleDrive');

        $this->app->instance(TenantBackupService::class, $service);

        $this->artisan('backup:monthly-google-drive', [
            '--tenant' => 'sma-bali',
        ])->assertExitCode(0);
    }

    public function test_monthly_status_marks_daily_dates_from_backup_coverage_and_new_data(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-23 10:00:00', 'Asia/Jakarta'));

        try {
            $tenantId = $this->createTenant('sma-bogor');
            $this->createAcademicSettings($tenantId);

            DB::table('tenant_google_drive_files')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'bucket' => 'backups',
                'source_path' => 'backup/backup-sma-bogor-full-monthly-2026-06.json',
                'storage_value' => 'https://drive.google.com/file/d/monthly-june/view',
                'drive_file_id' => 'monthly-june-json',
                'drive_file_name' => 'backup-sma-bogor-full-monthly-2026-06.json',
                'drive_web_view_link' => 'https://drive.google.com/file/d/monthly-june/view',
                'mime_type' => 'application/json',
                'extension' => 'json',
                'size_bytes' => 2048,
                'uploaded_at' => Carbon::parse('2026-06-05 14:55:00', 'Asia/Jakarta'),
                'created_at' => Carbon::parse('2026-06-05 14:55:00', 'Asia/Jakarta'),
                'updated_at' => Carbon::parse('2026-06-05 14:55:00', 'Asia/Jakarta'),
            ]);

            DB::table('pengumuman')->insert([
                'id' => 'pengumuman-juni-baru',
                'tenant_id' => $tenantId,
                'judul' => 'Agenda Juni',
                'keterangan' => 'Data baru setelah backup parsial bulan Juni.',
                'target' => 'semua',
                'created_at' => Carbon::parse('2026-06-19 08:00:00', 'Asia/Jakarta'),
                'updated_at' => Carbon::parse('2026-06-19 09:30:00', 'Asia/Jakarta'),
            ]);

            $status = app(TenantBackupService::class)->monthlyStatus($tenantId, true);
            $june = collect($status['months'])->firstWhere('key', '2026-06');

            $this->assertSame('needs_update', $june['status']);
            $this->assertTrue($june['can_backup']);
            $this->assertSame('05', $june['days'][4]['day_label']);
            $this->assertSame('backed_up', $june['days'][4]['status']);
            $this->assertSame('empty', $june['days'][9]['status']);
            $this->assertSame('new_data', $june['days'][18]['status']);
            $this->assertSame('future', $june['days'][23]['status']);
            $this->assertSame('Ada data baru', $june['days'][18]['status_label']);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_monthly_backup_delta_includes_records_created_before_month_but_updated_after_backup(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-23 10:00:00', 'Asia/Jakarta'));

        try {
            $tenantId = $this->createTenant('sma-bogor');
            $this->createAcademicSettings($tenantId);

            DB::table('tenant_google_drive_files')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'bucket' => 'backups',
                'source_path' => 'backup/backup-sma-bogor-full-monthly-2026-06.json',
                'storage_value' => 'https://drive.google.com/file/d/monthly-june/view',
                'drive_file_id' => 'monthly-june-json',
                'drive_file_name' => 'backup-sma-bogor-full-monthly-2026-06.json',
                'drive_web_view_link' => 'https://drive.google.com/file/d/monthly-june/view',
                'mime_type' => 'application/json',
                'extension' => 'json',
                'size_bytes' => 2048,
                'uploaded_at' => Carbon::parse('2026-06-05 14:55:00', 'Asia/Jakarta'),
                'created_at' => Carbon::parse('2026-06-05 14:55:00', 'Asia/Jakarta'),
                'updated_at' => Carbon::parse('2026-06-05 14:55:00', 'Asia/Jakarta'),
            ]);

            $taskPayload = [
                'tenant_id' => $tenantId,
                'kelas' => 'XI B MIPA',
                'judul' => 'Tugas Mei yang direvisi',
                'mapel' => 'Matematika',
                'created_at' => Carbon::parse('2026-05-20 08:00:00', 'Asia/Jakarta'),
                'updated_at' => Carbon::parse('2026-06-19 09:30:00', 'Asia/Jakarta'),
            ];
            if (Schema::hasColumn('tugas', 'tahun_ajaran')) {
                $taskPayload['tahun_ajaran'] = '2025/2026';
            }
            if (Schema::hasColumn('tugas', 'semester')) {
                $taskPayload['semester'] = 'Genap';
            }
            DB::table('tugas')->insert($taskPayload);

            $service = app(TenantBackupService::class);
            $status = $service->monthlyStatus($tenantId, true);
            $june = collect($status['months'])->firstWhere('key', '2026-06');

            $this->assertSame('needs_update', $june['status']);
            $this->assertSame('new_data', $june['days'][18]['status']);

            $payload = $service->buildMonthlyPayload(
                $tenantId,
                '2026-06',
                'system',
                'system',
                Carbon::parse('2026-06-23 10:00:00', 'Asia/Jakarta'),
                Carbon::parse('2026-06-05 14:54:59', 'Asia/Jakarta'),
                'monthly_delta_update',
                Carbon::parse('2026-06-23 10:00:00', 'Asia/Jakarta')
            );
            $taskTable = collect($payload['tables'])->firstWhere('name', 'tugas');

            $this->assertNotNull($taskTable);
            $this->assertSame(1, (int) ($taskTable['row_count'] ?? 0));
            $this->assertSame('Tugas Mei yang direvisi', $taskTable['rows'][0]['judul'] ?? null);
        } finally {
            Carbon::setTestNow();
        }
    }

    private function createTenant(string $slug): string
    {
        $tenantId = (string) Str::uuid();

        DB::table('tenants')->insert([
            'id' => $tenantId,
            'name' => strtoupper(str_replace('-', ' ', $slug)),
            'slug' => $slug,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $tenantId;
    }

    private function createAcademicSettings(string $tenantId): void
    {
        DB::table('settings')->insert([
            'tenant_id' => $tenantId,
            'nama_sekolah' => 'SMA Bogor',
            'tahun_ajaran' => '2025/2026',
            'semester_aktif' => 'Genap',
            'created_at' => Carbon::parse('2025-07-01 07:00:00', 'Asia/Jakarta'),
            'updated_at' => Carbon::parse('2025-07-01 07:00:00', 'Asia/Jakarta'),
        ]);
    }
}
