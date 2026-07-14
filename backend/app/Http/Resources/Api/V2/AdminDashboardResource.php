<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AdminDashboardResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'settings' => $this->resource['settings'] ?? [],
            'academic_period' => $this->resource['academic_period'] ?? [],
            'summary' => $this->resource['summary'] ?? [],
            'announcements' => $this->resource['announcements'] ?? [],
            'generated_at' => $this->resource['generated_at'] ?? null,
            'cache_status' => $this->resource['cache_status'] ?? null,
        ];
    }
}
