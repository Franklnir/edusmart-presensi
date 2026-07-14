<?php

namespace Tests\Feature\Api\V2;

use App\Models\Attachment;
use App\Models\Profile;
use App\Models\Tugas;
use App\Models\TugasJawaban;
use App\Models\UploadSession;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AttachmentControllerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config([
            'api_v2.uploads_enabled' => true,
            'api_v2.uploads.provider' => 'local-fake',
            'tenancy.allow_header_override' => true,
        ]);
        DB::table('tenants')->insertOrIgnore([
            ['id' => 'tenant-a', 'slug' => 'tenant-a', 'name' => 'Tenant A'],
            ['id' => 'tenant-b', 'slug' => 'tenant-b', 'name' => 'Tenant B'],
        ]);
    }

    public function test_unclaimed_attachment_is_private_to_owner_and_tenant(): void
    {
        $owner = $this->user('tenant-a', 'guru');
        $other = $this->user('tenant-a', 'guru');
        $outsider = $this->user('tenant-b', 'guru');
        $attachment = $this->attachment($owner);

        Sanctum::actingAs($owner);
        $this->getJson("/api/v2/attachments/{$attachment->id}", $this->headers('tenant-a'))
            ->assertOk()
            ->assertJsonPath('data.id', $attachment->id)
            ->assertJsonMissingPath('data.object_key')
            ->assertJsonMissingPath('data.bucket');
        $this->getJson("/api/v2/attachments/{$attachment->id}/download", $this->headers('tenant-a'))
            ->assertOk()
            ->assertJsonPath('data.instruction.method', 'GET')
            ->assertJsonPath('data.instruction.fields', []);

        Sanctum::actingAs($other);
        $this->getJson("/api/v2/attachments/{$attachment->id}/download", $this->headers('tenant-a'))
            ->assertForbidden();

        Sanctum::actingAs($outsider);
        $this->getJson("/api/v2/attachments/{$attachment->id}", $this->headers('tenant-b'))
            ->assertNotFound();
    }

    public function test_claimed_assignment_download_uses_parent_policy(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $otherStudent = $this->user('tenant-a', 'siswa', ['kelas' => '10B']);
        $assignment = $this->assignment($teacher);
        $attachment = $this->attachment($teacher, [
            'assignment_id' => $assignment->id,
            'claimed_by_type' => 'assignment',
            'claimed_by_id' => (string) $assignment->id,
            'claimed_at' => now(),
        ]);

        Sanctum::actingAs($student);
        $this->getJson("/api/v2/attachments/{$attachment->id}/download", $this->headers('tenant-a'))->assertOk();

        Sanctum::actingAs($otherStudent);
        $this->getJson("/api/v2/attachments/{$attachment->id}/download", $this->headers('tenant-a'))->assertForbidden();
    }

    public function test_claimed_submission_is_visible_to_owner_and_assignment_teacher_only(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $student = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $otherStudent = $this->user('tenant-a', 'siswa', ['kelas' => '10A']);
        $assignment = $this->assignment($teacher);
        $submission = TugasJawaban::forceCreate([
            'tenant_id' => 'tenant-a',
            'tugas_id' => $assignment->id,
            'user_id' => $student->id,
            'status' => 'menunggu',
            'waktu_submit' => now(),
        ]);
        $attachment = $this->attachment($student, [
            'purpose' => 'submission_attachment',
            'assignment_id' => $assignment->id,
            'claimed_by_type' => 'submission',
            'claimed_by_id' => (string) $submission->id,
            'claimed_at' => now(),
        ]);

        foreach ([$student, $teacher] as $viewer) {
            Sanctum::actingAs($viewer);
            $this->getJson("/api/v2/attachments/{$attachment->id}/download", $this->headers('tenant-a'))->assertOk();
        }

        Sanctum::actingAs($otherStudent);
        $this->getJson("/api/v2/attachments/{$attachment->id}/download", $this->headers('tenant-a'))->assertForbidden();
    }

    public function test_authorized_delete_detaches_parent_soft_deletes_metadata_and_object(): void
    {
        $teacher = $this->user('tenant-a', 'guru');
        $assignment = $this->assignment($teacher);
        $attachment = $this->attachment($teacher, [
            'assignment_id' => $assignment->id,
            'claimed_by_type' => 'assignment',
            'claimed_by_id' => (string) $assignment->id,
            'claimed_at' => now(),
        ]);
        $assignment->update(['attachment_ids' => [$attachment->id]]);
        Storage::disk('local')->put($attachment->object_key, 'attachment');

        Sanctum::actingAs($teacher);
        $this->deleteJson(
            "/api/v2/attachments/{$attachment->id}",
            [],
            $this->headers('tenant-a', true)
        )->assertOk()->assertJsonPath('data.cleanup_pending', false);

        $this->assertSame([], $assignment->fresh()->attachment_ids);
        $this->assertSoftDeleted('attachments', ['id' => $attachment->id, 'status' => 'deleted']);
        Storage::disk('local')->assertMissing($attachment->object_key);
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

    private function assignment(User $teacher): Tugas
    {
        return Tugas::forceCreate([
            'tenant_id' => $teacher->profile->tenant_id,
            'kelas' => '10A',
            'judul' => 'Tugas',
            'mapel' => 'Matematika',
            'mulai' => now()->subMinute(),
            'deadline' => now()->addDay(),
            'status' => 'published',
            'created_by' => $teacher->id,
        ]);
    }

    private function attachment(User $actor, array $values = []): Attachment
    {
        $session = UploadSession::create([
            'id' => (string) Str::uuid(),
            'tenant_id' => $actor->profile->tenant_id,
            'actor_id' => $actor->id,
            'purpose' => $values['purpose'] ?? 'assignment_attachment',
            'provider' => 'local-fake',
            'bucket' => 'test-uploads',
            'filename' => 'test.pdf',
            'content_type' => 'application/pdf',
            'size' => 10,
            'actual_size' => 10,
            'object_key' => 'tenants/'.$actor->profile->tenant_id.'/'.Str::uuid().'/test.pdf',
            'status' => 'completed',
            'expires_at' => now()->addMinutes(10),
            'completed_at' => now(),
        ]);

        return Attachment::create(array_merge([
            'id' => (string) Str::uuid(),
            'tenant_id' => $actor->profile->tenant_id,
            'actor_id' => $actor->id,
            'upload_session_id' => $session->id,
            'purpose' => $session->purpose,
            'provider' => 'local-fake',
            'bucket' => 'test-uploads',
            'object_key' => $session->object_key,
            'filename' => 'test.pdf',
            'content_type' => 'application/pdf',
            'size' => 10,
            'actual_size' => 10,
            'status' => 'active',
        ], $values));
    }

    private function headers(string $tenant, bool $idempotent = false): array
    {
        return array_filter([
            'X-Tenant' => $tenant,
            'Idempotency-Key' => $idempotent ? (string) Str::uuid() : null,
        ]);
    }
}
