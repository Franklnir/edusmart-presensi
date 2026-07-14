<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrganizationContextResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'organization' => [
                'name' => $this->resource['organization']['name'] ?? null,
                'logo_path' => $this->resource['organization']['logo_path'] ?? null,
                'updated_at' => $this->resource['organization']['updated_at'] ?? null,
            ],
            'membership' => [
                'is_wali_kelas' => (bool) ($this->resource['membership']['is_wali_kelas'] ?? false),
                'class_ids' => array_values($this->resource['membership']['class_ids'] ?? []),
            ],
            'delegated_features' => array_values($this->resource['delegated_features'] ?? []),
            'academic_context' => $this->resource['academic_context'] ?? null,
        ];
    }
}
