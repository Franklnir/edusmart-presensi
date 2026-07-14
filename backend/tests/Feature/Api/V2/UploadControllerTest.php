<?php

namespace Tests\Feature\Api\V2;

use App\Models\Profile;
use App\Models\Tugas;
use App\Models\UploadSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UploadControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config([
            'api_v2.uploads_enabled' => true,
            'filesystems.default' => 'local',
            'tenancy.allow_header_override' => true,
        ]);
        DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-a', 'slug' => 'tenant-a', 'name' => 'Tenant A'],
            ['id' => 'tenant-b', 'slug' => 'tenant-b', 'name' => 'Tenant B'],
        ]);
    }

    private function user(string $tenant, string $role, array $profile = []): User
    {
        $user = User::factory()->create(['id' => Str::uuid()->toString()]);
        Profile::forceCreate(array_merge([
            'id' => $user->id,
            'tenant_id' => $tenant,
            'role' => $role,
            'email' => $user->email,
            'nama' => "Test {$role}",
            'status' => 'active',
        ], $profile));

        return $user;
    }

    private function assignment(User $teacher, array $values = []): Tugas
    {
        return Tugas::forceCreate(array_merge([
            'tenant_id' => $teacher->profile->tenant_id,
            'kelas' => '10A',
            'judul' => 'Tugas',
            'mapel' => 'Matematika',
            'mulai' => now()->subMinute(),
            'deadline' => now()->addDay(),
            'status' => 'published',
            'created_by' => $teacher->id,
        ], $values));
    }

    private function uploadSession(User $actor, array $values = []): UploadSession
    {
        return UploadSession::create(array_merge([
            'id' => (string) Str::uuid(),
            'tenant_id' => $actor->profile->tenant_id,
            'actor_id' => $actor->id,
            'purpose' => 'assignment_attachment',
            'filename' => 'test.pdf',
            'content_type' => 'application/pdf',
            'size' => 100,
            'object_key' => 'tenant/test.pdf',
            'status' => 'pending',
            'expires_at' => now()->addMinutes(10),
        ], $values));
    }

    public function test_upload_api_is_disabled_by_default_configuration(): void
    {
        config(['api_v2.uploads_enabled' => false]);
        $teacher = $this->user('tenant-a', 'guru');
        Sanctum::actingAs($teacher);

        $this->postJson('/api/v2/uploads', [
            'purpose' => 'assignment_attachment',
            'filename' => 'test.pdf',
            'content_type' => 'application/pdf',
            'size' => 100,
        ], ['X-Tenant' => 'tenant-a'])
            ->assertStatus(503)->assertJsonPath('code', 'UPLOAD_V2_DISABLED');
    }

    public function test_backend_generates_object_key_and_does_not_expose_it(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        Sanctum::actingAs($teacher);
        $response = $this->postJson('/api/v2/uploads', [
            'purpose' => 'assignment_attachment',
            'filename' => 'Tugas Akhir.pdf',
            'content_type' => 'application/pdf',
            'size' => 100,
            'object_key' => '../../client-controlled',
            'bucket' => 'public',
            'file_url' => 'https://example.test/permanent',
        ], ['X-Tenant' => 'tenant-a'])->assertCreated();

        $response->assertJsonMissingPath('data.object_key');
        $session = UploadSession::findOrFail($response->json('data.session_id'));
        $this->assertStringStartsWith('tenants/tenant-a/assignments/pending/', $session->object_key);
        $this->assertStringNotContainsString('client-controlled', $session->object_key);
        $this->assertSame($teacher->id, $session->actor_id);
    }

    public function test_submission_upload_requires_student_and_accessible_assignment(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $otherClass = $this->user('tenant-a', 'siswa', ['kelas' => '10B']);
        $assignment = $this->assignment($teacher);
        $payload = [
            'purpose' => 'submission_attachment',
            'assignment_id' => $assignment->id,
            'filename' => 'jawaban.pdf',
            'content_type' => 'application/pdf',
            'size' => 100,
        ];

        Sanctum::actingAs($student);
        $this->postJson('/api/v2/uploads', $payload, ['X-Tenant' => 'tenant-a'])->assertCreated();
        Sanctum::actingAs($otherClass);
        $this->postJson('/api/v2/uploads', $payload, ['X-Tenant' => 'tenant-a'])->assertForbidden();
        Sanctum::actingAs($teacher);
        $this->postJson('/api/v2/uploads', $payload, ['X-Tenant' => 'tenant-a'])
            ->assertForbidden()->assertJsonPath('code', 'UPLOAD_SCOPE_FORBIDDEN');
    }

    public function test_only_owner_in_tenant_can_read_or_cancel_session(): void
    {
        $owner = $this->user('tenant-a', 'guru');
        $other = $this->user('tenant-a', 'guru');
        $session = $this->uploadSession($owner);
        Sanctum::actingAs($other);

        $this->getJson("/api/v2/uploads/{$session->id}", ['X-Tenant' => 'tenant-a'])->assertNotFound();
        $this->deleteJson("/api/v2/uploads/{$session->id}", [], ['X-Tenant' => 'tenant-a'])->assertNotFound();

        Sanctum::actingAs($owner);
        $this->getJson("/api/v2/uploads/{$session->id}", ['X-Tenant' => 'tenant-a'])
            ->assertOk()->assertJsonMissingPath('data.object_key');
        $this->deleteJson("/api/v2/uploads/{$session->id}", [], ['X-Tenant' => 'tenant-a'])->assertOk();
        $this->assertDatabaseHas('upload_sessions', ['id' => $session->id, 'status' => 'failed']);
    }

    public function test_complete_verifies_object_before_creating_attachment(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $session = $this->uploadSession($teacher);
        Sanctum::actingAs($teacher);

        $this->postJson("/api/v2/uploads/{$session->id}/complete", [], ['X-Tenant' => 'tenant-a'])
            ->assertStatus(422)->assertJsonPath('code', 'UPLOAD_OBJECT_NOT_FOUND');
        $this->assertDatabaseCount('attachments', 0);

        Storage::disk('local')->put($session->object_key, str_repeat('x', 99));
        $this->postJson("/api/v2/uploads/{$session->id}/complete", [], ['X-Tenant' => 'tenant-a'])
            ->assertStatus(422)->assertJsonPath('code', 'UPLOAD_SIZE_MISMATCH');
        $this->assertDatabaseCount('attachments', 0);
    }

    public function test_complete_creates_one_attachment_after_verification(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $session = $this->uploadSession($teacher);
        Storage::disk('local')->put($session->object_key, str_repeat('x', 100));
        Sanctum::actingAs($teacher);

        $response = $this->postJson("/api/v2/uploads/{$session->id}/complete", [], ['X-Tenant' => 'tenant-a'])
            ->assertOk();
        $this->assertDatabaseHas('attachments', [
            'id' => $response->json('data.attachment_id'),
            'tenant_id' => 'tenant-a',
            'actor_id' => $teacher->id,
            'upload_session_id' => $session->id,
            'purpose' => 'assignment_attachment',
        ]);
        $this->assertDatabaseHas('upload_sessions', ['id' => $session->id, 'status' => 'completed']);
        $this->postJson("/api/v2/uploads/{$session->id}/complete", [], ['X-Tenant' => 'tenant-a'])
            ->assertStatus(409)->assertJsonPath('code', 'UPLOAD_SESSION_NOT_PENDING');
    }

    public function test_expired_or_cancelled_session_cannot_be_completed(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $expired = $this->uploadSession($teacher, ['id' => (string) Str::uuid(), 'expires_at' => now()->subMinute()]);
        $cancelled = $this->uploadSession($teacher, ['id' => (string) Str::uuid(), 'status' => 'failed']);
        Sanctum::actingAs($teacher);

        $this->postJson("/api/v2/uploads/{$expired->id}/complete", [], ['X-Tenant' => 'tenant-a'])
            ->assertStatus(409)->assertJsonPath('code', 'UPLOAD_SESSION_EXPIRED');
        $this->postJson("/api/v2/uploads/{$cancelled->id}/complete", [], ['X-Tenant' => 'tenant-a'])
            ->assertStatus(409)->assertJsonPath('code', 'UPLOAD_SESSION_NOT_PENDING');
    }

    public function test_filename_mime_and_size_are_restricted(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        Sanctum::actingAs($teacher);
        $base = ['purpose' => 'assignment_attachment', 'filename' => '../evil.php', 'content_type' => 'text/php', 'size' => 0];

        $this->postJson('/api/v2/uploads', $base, ['X-Tenant' => 'tenant-a'])
            ->assertUnprocessable()->assertJsonValidationErrors(['filename', 'content_type', 'size']);
    }
}
