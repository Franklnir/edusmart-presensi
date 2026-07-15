<?php

namespace Tests\Feature;

use App\Models\FrontendErrorLog;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class SuperLogControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_super_admin_can_monitor_redacted_browser_errors(): void
    {
        config([
            'tenancy.root_domain' => 'edusmart.test',
            'tenancy.admin_subdomain' => 'admin',
            'tenancy.admin_hosts' => [],
            'tenancy.allow_root_for_super_admin' => false,
        ]);

        $superAdmin = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Monitor',
            'email' => 'super-monitor@example.com',
            'password' => Hash::make('password123'),
        ]);
        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $superAdmin->id,
            'email' => $superAdmin->email,
            'name' => $superAdmin->name,
            'created_at' => now(),
        ]);

        $log = FrontendErrorLog::create([
            'level' => 'error',
            'message' => 'Browser schedule request failed',
            'url' => 'https://tenant.edusmart.test/guru/jadwal?token=private-token',
            'context' => ['token' => 'private-token', 'request_id' => 'request-123'],
            'tenant_id' => 'tenant-test',
        ]);

        $this->actingAs($superAdmin)
            ->getJson('http://admin.edusmart.test/api/super/monitoring/logs?level=error&q=schedule')
            ->assertOk()
            ->assertJsonPath('data.rows.0.id', 'frontend-'.$log->id)
            ->assertJsonPath('data.rows.0.method', 'BROWSER')
            ->assertJsonPath('data.rows.0.endpoint', '/guru/jadwal?token=%5Bdisembunyikan%5D')
            ->assertJsonPath('data.rows.0.context.token', '[disembunyikan]')
            ->assertJsonPath('data.rows.0.context.request_id', 'request-123');
    }

    public function test_super_admin_can_find_structured_api_log_by_request_id(): void
    {
        config([
            'tenancy.root_domain' => 'edusmart.test',
            'tenancy.admin_subdomain' => 'admin',
            'tenancy.admin_hosts' => [],
            'tenancy.allow_root_for_super_admin' => false,
        ]);

        $superAdmin = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Structured Monitor',
            'email' => 'super-structured@example.com',
            'password' => Hash::make('password123'),
        ]);
        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $superAdmin->id,
            'email' => $superAdmin->email,
            'name' => $superAdmin->name,
            'created_at' => now(),
        ]);

        $requestId = (string) Str::uuid();
        $path = storage_path('logs/structured-test.log');
        File::ensureDirectoryExists(dirname($path));
        File::put($path, json_encode([
            'message' => 'api_request',
            'level_name' => 'INFO',
            'datetime' => now()->toIso8601String(),
            'context' => [
                'request_id' => $requestId,
                'route_name' => 'api.v2.reports.teacher-summary',
                'path_template' => 'api/v2/reports/teacher-summary',
                'response_status' => 200,
                'duration_ms' => 42.5,
                'tenant_id' => 'tenant-test',
                'actor_id' => (string) Str::uuid(),
                'domain' => 'reports',
                'release_sha' => 'test-release',
            ],
        ]).PHP_EOL);

        try {
            $this->actingAs($superAdmin)
                ->getJson('http://admin.edusmart.test/api/super/monitoring/logs?request_id='.$requestId)
                ->assertOk()
                ->assertJsonPath('data.rows.0.request_id', $requestId)
                ->assertJsonPath('data.rows.0.domain', 'reports')
                ->assertJsonPath('data.rows.0.response_status', 200)
                ->assertJsonPath('data.rows.0.duration_ms', 42);
        } finally {
            File::delete($path);
        }
    }
}
