<?php

namespace App\Services\Actions\Upload;

use App\Contracts\UploadStorageProvider;
use App\Exceptions\UploadException;
use App\Models\Attachment;
use App\Models\Tugas;
use App\Models\TugasJawaban;
use Illuminate\Support\Facades\DB;
use Throwable;

class DeleteAttachment
{
    public function __construct(private readonly UploadStorageProvider $provider) {}

    /** @return array{attachment: Attachment, deleted: bool} */
    public function execute(Attachment $attachment): array
    {
        $attachment = DB::transaction(function () use ($attachment) {
            $attachment = Attachment::whereKey($attachment->id)->lockForUpdate()->firstOrFail();
            if ($attachment->provider !== $this->provider->name() || $attachment->bucket !== $this->provider->bucket()) {
                throw new UploadException('ATTACHMENT_PROVIDER_MISMATCH', 'Provider attachment tidak sesuai konfigurasi aktif.', 409);
            }

            if ($attachment->claimed_by_type === 'assignment') {
                $parent = Tugas::where('tenant_id', $attachment->tenant_id)
                    ->whereKey($attachment->claimed_by_id)
                    ->lockForUpdate()
                    ->firstOrFail();
                $parent->attachment_ids = collect($parent->attachment_ids ?? [])
                    ->reject(fn ($id) => (string) $id === (string) $attachment->id)
                    ->values()
                    ->all();
                $parent->save();
            } elseif ($attachment->claimed_by_type === 'submission') {
                $parent = TugasJawaban::where('tenant_id', $attachment->tenant_id)
                    ->whereKey($attachment->claimed_by_id)
                    ->lockForUpdate()
                    ->firstOrFail();
                $parent->attachment_ids = collect($parent->attachment_ids ?? [])
                    ->reject(fn ($id) => (string) $id === (string) $attachment->id)
                    ->values()
                    ->all();
                $parent->save();
            }

            $attachment->update(['status' => 'delete_pending']);

            return $attachment;
        });

        try {
            $deleted = $this->provider->delete($attachment->object_key);
        } catch (Throwable) {
            $deleted = false;
        }

        if ($deleted) {
            $attachment->update(['status' => 'deleted']);
            $attachment->delete();
        }

        return ['attachment' => $attachment, 'deleted' => $deleted];
    }
}
