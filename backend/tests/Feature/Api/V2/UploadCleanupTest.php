<?php

namespace Tests\Feature\Api\V2;

use App\Models\Attachment;
use App\Models\UploadSession;
use App\Services\Actions\Upload\CleanupUploadArtifacts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class UploadCleanupTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config([
            'api_v2.uploads.provider' => 'local-fake',
            'api_v2.uploads.detached_cleanup_hours' => 24,
        ]);
        DB::table('tenants')->insert(['id' => 'tenant-a', 'slug' => 'tenant-a', 'name' => 'Tenant A']);
    }

    public function test_cleanup_expires_sessions_and_removes_failed_and_detached_objects(): void
    {
        $expired = $this->uploadSession(['status' => 'uploading', 'expires_at' => now()->subMinute()]);
        $cancelled = $this->uploadSession(['status' => 'cancelled']);
        $oldDetached = $this->attachment($this->uploadSession(['status' => 'completed']), now()->subHours(25));
        $recentDetached = $this->attachment($this->uploadSession(['status' => 'completed']), now());

        foreach ([$expired->object_key, $cancelled->object_key, $oldDetached->object_key, $recentDetached->object_key] as $key) {
            Storage::disk('local')->put($key, 'data');
        }

        $result = app(CleanupUploadArtifacts::class)->execute();

        $this->assertSame('expired', $expired->fresh()->status);
        Storage::disk('local')->assertMissing($expired->object_key);
        Storage::disk('local')->assertMissing($cancelled->object_key);
        $this->assertSoftDeleted('attachments', ['id' => $oldDetached->id]);
        $this->assertDatabaseHas('attachments', ['id' => $recentDetached->id, 'deleted_at' => null, 'status' => 'active']);
        Storage::disk('local')->assertExists($recentDetached->object_key);
        $this->assertSame(1, $result['expired']);
        $this->assertSame(1, $result['attachments_cleaned']);
        $this->assertSame(0, $result['failed']);
    }

    private function uploadSession(array $values): UploadSession
    {
        return UploadSession::create(array_merge([
            'id' => (string) Str::uuid(),
            'tenant_id' => 'tenant-a',
            'actor_id' => (string) Str::uuid(),
            'purpose' => 'assignment_attachment',
            'provider' => 'local-fake',
            'bucket' => 'test-uploads',
            'filename' => 'test.pdf',
            'content_type' => 'application/pdf',
            'size' => 4,
            'actual_size' => 4,
            'object_key' => 'tenants/tenant-a/'.Str::uuid().'/test.pdf',
            'status' => 'uploading',
            'expires_at' => now()->addMinutes(10),
        ], $values));
    }

    private function attachment(UploadSession $session, $createdAt): Attachment
    {
        return Attachment::forceCreate([
            'id' => (string) Str::uuid(),
            'tenant_id' => $session->tenant_id,
            'actor_id' => $session->actor_id,
            'upload_session_id' => $session->id,
            'purpose' => $session->purpose,
            'provider' => $session->provider,
            'bucket' => $session->bucket,
            'object_key' => $session->object_key,
            'filename' => $session->filename,
            'content_type' => $session->content_type,
            'size' => $session->size,
            'actual_size' => $session->actual_size,
            'status' => 'active',
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ]);
    }
}
