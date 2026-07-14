<?php

namespace App\Services;

use App\Models\Attachment;

class AttachmentClaimService
{
    /** @return array<int, string> */
    public function claim(
        array $attachmentIds,
        string $tenantId,
        string $actorId,
        string $purpose,
        int $assignmentId,
        string $claimType,
        string|int $claimId
    ): array {
        $ids = collect($attachmentIds)->map(fn ($id) => (string) $id)->unique()->values();
        if ($ids->isEmpty()) {
            return [];
        }

        $attachments = Attachment::with('uploadSession')
            ->whereIn('id', $ids)
            ->lockForUpdate()
            ->get();
        if ($attachments->count() !== $ids->count()) {
            throw new \LogicException('ATTACHMENT_NOT_FOUND');
        }

        foreach ($attachments as $attachment) {
            $session = $attachment->uploadSession;
            if (! $session || $attachment->tenant_id !== $tenantId || $session->tenant_id !== $tenantId) {
                throw new \LogicException('ATTACHMENT_TENANT_MISMATCH');
            }
            if ($attachment->actor_id !== $actorId || $session->actor_id !== $actorId) {
                throw new \LogicException('ATTACHMENT_OWNER_MISMATCH');
            }
            if ($attachment->purpose !== $purpose || $session->purpose !== $purpose) {
                throw new \LogicException('ATTACHMENT_PURPOSE_MISMATCH');
            }
            if ($session->status !== 'completed') {
                throw new \LogicException('ATTACHMENT_NOT_COMPLETED');
            }
            if ($attachment->status !== 'active') {
                throw new \LogicException('ATTACHMENT_NOT_ACTIVE');
            }
            if ($attachment->assignment_id !== null && (int) $attachment->assignment_id !== $assignmentId) {
                throw new \LogicException('ATTACHMENT_ASSIGNMENT_MISMATCH');
            }
            $sameClaim = $attachment->claimed_by_type === $claimType
                && (string) $attachment->claimed_by_id === (string) $claimId;
            if ($attachment->claimed_at !== null && ! $sameClaim) {
                throw new \LogicException('ATTACHMENT_ALREADY_CLAIMED');
            }
        }

        foreach ($attachments->whereNull('claimed_at') as $attachment) {
            $attachment->update([
                'assignment_id' => $assignmentId,
                'claimed_by_type' => $claimType,
                'claimed_by_id' => (string) $claimId,
                'claimed_at' => now(),
            ]);
        }

        return $ids->all();
    }
}
