<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\User;
use App\Models\UploadSession;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use Illuminate\Support\Str;

class UploadControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('s3');
        Storage::fake('local');
        
        config(['tenancy.allow_header_override' => true]);
        config(['tenancy.header' => 'X-Tenant-ID']);
        
        \Illuminate\Support\Facades\DB::table('tenants')->insert([
            'id' => 'tenant1',
            'name' => 'Tenant 1',
            'slug' => 'tenant1',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createUserWithRole($role, $tenantId = 'tenant1')
    {
        $userId = (string) Str::uuid();
        $user = User::factory()->create(['id' => $userId]);
        Profile::insert([
            'id' => $user->id,
            'role' => $role,
            'tenant_id' => $tenantId,
            'email' => $user->email,
            'nama' => $user->name,
        ]);
        return $user;
    }

    public function test_guru_can_initiate_assignment_upload()
    {
        $user = $this->createUserWithRole('guru');

        $response = $this->actingAs($user)->postJson('/api/v2/uploads', [
            'purpose' => 'assignment_attachment',
            'filename' => 'tugas-matematika.pdf',
            'content_type' => 'application/pdf',
            'size' => 1024 * 1024,
        ], [
            'X-Tenant-ID' => 'tenant1'
        ]);

        $response->assertStatus(201)
                 ->assertJsonStructure(['success', 'data' => ['session_id', 'upload_url', 'object_key', 'expires_at'], 'request_id']);
                 
        $sessionId = $response->json('data.session_id');
        $this->assertDatabaseHas('upload_sessions', [
            'id' => $sessionId,
            'tenant_id' => 'tenant1',
            'actor_id' => $user->id,
            'purpose' => 'assignment_attachment',
            'status' => 'pending',
        ]);
    }

    public function test_siswa_can_initiate_submission_upload()
    {
        $user = $this->createUserWithRole('siswa');

        $response = $this->actingAs($user)->postJson('/api/v2/uploads', [
            'purpose' => 'submission_attachment',
            'filename' => 'jawaban-saya.pdf',
            'content_type' => 'application/pdf',
            'size' => 500000,
        ], [
            'X-Tenant-ID' => 'tenant1'
        ]);

        $response->assertStatus(201);
    }

    public function test_siswa_cannot_initiate_assignment_upload()
    {
        $user = $this->createUserWithRole('siswa');

        $response = $this->actingAs($user)->postJson('/api/v2/uploads', [
            'purpose' => 'assignment_attachment',
            'filename' => 'test.pdf',
            'content_type' => 'application/pdf',
            'size' => 500000,
        ], [
            'X-Tenant-ID' => 'tenant1'
        ]);

        $response->assertStatus(403);
    }

    public function test_complete_upload_success()
    {
        $user = $this->createUserWithRole('guru');
        $sessionId = (string) Str::uuid();

        UploadSession::create([
            'id' => $sessionId,
            'tenant_id' => 'tenant1',
            'actor_id' => $user->id,
            'purpose' => 'assignment_attachment',
            'filename' => 'test.pdf',
            'content_type' => 'application/pdf',
            'size' => 100,
            'object_key' => 'test/test.pdf',
            'status' => 'pending',
            'expires_at' => now()->addMinutes(10),
        ]);

        // Mock filesystems logic for 'local' will just accept it
        config(['filesystems.default' => 'local']);

        $response = $this->actingAs($user)->postJson("/api/v2/uploads/{$sessionId}/complete", [], [
            'X-Tenant-ID' => 'tenant1'
        ]);

        $response->assertStatus(200)
                 ->assertJsonStructure(['success', 'message', 'data' => ['attachment_id']]);

        $this->assertDatabaseHas('upload_sessions', [
            'id' => $sessionId,
            'status' => 'completed'
        ]);
        
        $this->assertDatabaseHas('attachments', [
            'id' => $response->json('data.attachment_id'),
            'upload_session_id' => $sessionId,
        ]);
    }

    public function test_cancel_upload()
    {
        $user = $this->createUserWithRole('guru');
        $sessionId = (string) Str::uuid();

        UploadSession::create([
            'id' => $sessionId,
            'tenant_id' => 'tenant1',
            'actor_id' => $user->id,
            'purpose' => 'assignment_attachment',
            'filename' => 'test.pdf',
            'content_type' => 'application/pdf',
            'size' => 100,
            'object_key' => 'test/test.pdf',
            'status' => 'pending',
            'expires_at' => now()->addMinutes(10),
        ]);

        $response = $this->actingAs($user)->deleteJson("/api/v2/uploads/{$sessionId}", [], [
            'X-Tenant-ID' => 'tenant1'
        ]);

        $response->assertStatus(200);

        $this->assertDatabaseHas('upload_sessions', [
            'id' => $sessionId,
            'status' => 'failed'
        ]);
    }
}
