<?php

namespace Tests\Feature\Api\V2;

use App\Models\FrontendErrorLog;
use App\Models\Profile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class FrontendLogControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_can_submit_frontend_log_unauthenticated()
    {
        $response = $this->postJson('/api/v2/frontend-logs', [
            'level' => 'error',
            'message' => 'Test error message',
            'url' => 'http://localhost/test',
            'context' => ['foo' => 'bar'],
        ]);

        $response->assertStatus(201)
            ->assertJson(['success' => true]);

        $this->assertDatabaseHas('frontend_error_logs', [
            'level' => 'error',
            'message' => 'Test error message',
            'url' => 'http://localhost/test',
        ]);
    }

    public function test_can_submit_frontend_log_authenticated_with_tenant()
    {
        config(['tenancy.allow_header_override' => true]);
        DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-test', 'slug' => 'tenant-test', 'name' => 'Test Tenant'],
        ]);

        $user = User::factory()->create(['id' => (string) Str::uuid()]);
        Profile::create([
            'id' => $user->id,
            'tenant_id' => 'tenant-test',
            'role' => 'admin',
            'email' => $user->email,
            'name' => $user->name,
        ]);

        $response = $this->actingAs($user)
            ->withHeaders(['X-Tenant' => 'tenant-test'])
            ->postJson('/api/v2/frontend-logs', [
                'level' => 'warning',
                'message' => 'Warning message',
            ]);

        $response->assertStatus(201);

        $this->assertDatabaseHas('frontend_error_logs', [
            'level' => 'warning',
            'message' => 'Warning message',
            'user_id' => $user->id,
            'tenant_id' => 'tenant-test',
        ]);
    }

    public function test_admin_can_view_frontend_logs()
    {
        config(['tenancy.allow_header_override' => true]);
        DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-test', 'slug' => 'tenant-test', 'name' => 'Test Tenant'],
        ]);

        $user = User::factory()->create(['id' => (string) Str::uuid()]);
        Profile::create([
            'id' => $user->id,
            'tenant_id' => 'tenant-test',
            'role' => 'admin',
            'email' => $user->email,
            'name' => $user->name,
        ]);

        FrontendErrorLog::create([
            'level' => 'error',
            'message' => 'Test admin view',
            'tenant_id' => 'tenant-test',
        ]);

        $response = $this->actingAs($user)
            ->withHeaders(['X-Tenant' => 'tenant-test'])
            ->getJson('/api/v2/frontend-logs');

        $response->assertStatus(200)
            ->assertJsonPath('data.0.message', 'Test admin view');
    }
}
