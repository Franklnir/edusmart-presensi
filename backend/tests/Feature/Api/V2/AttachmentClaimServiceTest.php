<?php

namespace Tests\Feature\Api\V2;

use App\Models\Attachment;
use App\Models\UploadSession;
use App\Services\AttachmentClaimService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class AttachmentClaimServiceTest extends TestCase
{
    use RefreshDatabase;

    private function attachment(array $values = []): Attachment
    {
        $sessionId = (string) Str::uuid();
        $defaults = [
            'tenant_id' => 'tenant-a',
            'actor_id' => (string) Str::uuid(),
            'purpose' => 'submission_attachment',
            'assignment_id' => 10,
        ];
        $values = array_merge($defaults, $values);
        UploadSession::create([
            'id' => $sessionId,
            'tenant_id' => $values['tenant_id'],
            'actor_id' => $values['actor_id'],
            'purpose' => $values['purpose'],
            'assignment_id' => $values['assignment_id'],
            'filename' => 'answer.pdf',
            'content_type' => 'application/pdf',
            'size' => 100,
            'object_key' => "objects/{$sessionId}.pdf",
            'status' => $values['session_status'] ?? 'completed',
            'expires_at' => now()->addMinutes(10),
        ]);

        return Attachment::create([
            'id' => (string) Str::uuid(),
            'tenant_id' => $values['attachment_tenant_id'] ?? $values['tenant_id'],
            'actor_id' => $values['attachment_actor_id'] ?? $values['actor_id'],
            'upload_session_id' => $sessionId,
            'purpose' => $values['attachment_purpose'] ?? $values['purpose'],
            'assignment_id' => $values['assignment_id'],
            'object_key' => "objects/{$sessionId}.pdf",
            'filename' => 'answer.pdf',
            'content_type' => 'application/pdf',
            'size' => 100,
        ]);
    }

    public function test_completed_owned_attachment_is_claimed_once_and_same_claim_is_idempotent(): void
    {
        $attachment = $this->attachment();
        $service = app(AttachmentClaimService::class);

        $ids = DB::transaction(fn () => $service->claim(
            [$attachment->id],
            'tenant-a',
            $attachment->actor_id,
            'submission_attachment',
            10,
            'submission',
            99
        ));
        $this->assertSame([$attachment->id], $ids);
        $this->assertDatabaseHas('attachments', [
            'id' => $attachment->id,
            'claimed_by_type' => 'submission',
            'claimed_by_id' => '99',
        ]);

        DB::transaction(fn () => $service->claim(
            [$attachment->id],
            'tenant-a',
            $attachment->actor_id,
            'submission_attachment',
            10,
            'submission',
            99
        ));
        $this->addToAssertionCount(1);
    }

    public function test_tenant_actor_purpose_and_completion_are_enforced(): void
    {
        $service = app(AttachmentClaimService::class);
        $cases = [
            [$this->attachment(), 'tenant-b', null, 'submission_attachment', 'ATTACHMENT_TENANT_MISMATCH'],
            [$this->attachment(), 'tenant-a', (string) Str::uuid(), 'submission_attachment', 'ATTACHMENT_OWNER_MISMATCH'],
            [$this->attachment(), 'tenant-a', null, 'assignment_attachment', 'ATTACHMENT_PURPOSE_MISMATCH'],
            [$this->attachment(['session_status' => 'pending']), 'tenant-a', null, 'submission_attachment', 'ATTACHMENT_NOT_COMPLETED'],
        ];

        foreach ($cases as [$attachment, $tenant, $actor, $purpose, $expected]) {
            try {
                DB::transaction(fn () => $service->claim(
                    [$attachment->id],
                    $tenant,
                    $actor ?? $attachment->actor_id,
                    $purpose,
                    10,
                    'submission',
                    1
                ));
                $this->fail("Expected {$expected}");
            } catch (\LogicException $exception) {
                $this->assertSame($expected, $exception->getMessage());
            }
        }
    }

    public function test_claimed_attachment_cannot_be_reused_by_another_record(): void
    {
        $attachment = $this->attachment();
        $attachment->update([
            'claimed_by_type' => 'submission',
            'claimed_by_id' => '1',
            'claimed_at' => now(),
        ]);

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('ATTACHMENT_ALREADY_CLAIMED');
        DB::transaction(fn () => app(AttachmentClaimService::class)->claim(
            [$attachment->id],
            'tenant-a',
            $attachment->actor_id,
            'submission_attachment',
            10,
            'submission',
            2
        ));
    }
}
