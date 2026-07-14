<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UploadSessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'purpose' => $this->purpose,
            'assignment_id' => $this->assignment_id,
            'filename' => $this->filename,
            'content_type' => $this->content_type,
            'declared_size' => $this->size,
            'actual_size' => $this->actual_size,
            'status' => $this->status,
            'failure_code' => $this->failure_code,
            'expires_at' => $this->expires_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
        ];
    }
}
