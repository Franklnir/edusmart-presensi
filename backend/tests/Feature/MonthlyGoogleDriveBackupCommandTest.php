<?php

namespace Tests\Feature;

use App\Services\Backup\TenantBackupService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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
}
