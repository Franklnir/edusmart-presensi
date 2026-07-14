<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AttachmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'purpose' => $this->purpose,
            'assignment_id' => $this->assignment_id,
            'filename' => $this->filename,
            'content_type' => $this->content_type,
            'size' => $this->actual_size ?? $this->size,
            'status' => $this->status,
            'claimed' => $this->claimed_at !== null,
            'claimed_at' => $this->claimed_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
