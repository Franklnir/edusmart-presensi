<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

class ApprovalControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_super_admin_without_profile_can_approve_without_foreign_key_error(): void
    {
        $tenantId = (string) DB::table('tenants')->where('slug', 'default')->value('id');
        $superAdmin = $this->createSuperAdmin();
        $approvalId = (string) Str::uuid();

        DB::table('approval_requests')->insert([
            'id' => $approvalId,
            'tenant_id' => $tenantId,
            'status' => 'pending',
            'target_table' => 'mata_pelajaran',
            'target_action' => 'INSERT',
            'target_record_id' => 'approval-mapel',
            'change_payload' => json_encode([
                'table' => 'mata_pelajaran',
                'action' => 'insert',
                'payload' => [
                    'id' => 'approval-mapel',
                    'nama' => 'APPROVAL MAPEL',
                ],
            ]),
            'change_summary' => 'Tambah mapel dari approval',
            'risk_level' => 'low',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this
            ->actingAs($superAdmin)
            ->postJson("/api/admin/approvals/{$approvalId}/approve");

        $response->assertOk()
            ->assertJsonPath('data.status', 'approved');

        $this->assertDatabaseHas('approval_requests', [
            'id' => $approvalId,
            'status' => 'approved',
            'approved_by' => null,
        ]);
        $this->assertDatabaseHas('mata_pelajaran', [
            'id' => 'approval-mapel',
            'tenant_id' => $tenantId,
            'nama' => 'APPROVAL MAPEL',
        ]);
    }

    private function createSuperAdmin(): User
    {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => 'Super Admin',
            'email' => 'approval-super-admin@example.com',
            'password' => Hash::make('password123'),
        ]);

        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'created_at' => now(),
        ]);

        return $user;
    }
}
