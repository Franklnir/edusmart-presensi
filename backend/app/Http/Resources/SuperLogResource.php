<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SuperLogResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource['id'] ?? null,
            'timestamp' => $this->resource['timestamp'] ?? null,
            'level' => $this->resource['level'] ?? null,
            'endpoint' => $this->resource['endpoint'] ?? '-',
            'message' => $this->resource['message'] ?? '-',
            'user' => $this->resource['user'] ?? '-',
            'method' => $this->resource['method'] ?? '-',
            'ip_address' => $this->resource['ip_address'] ?? '-',
            'file' => $this->resource['file'] ?? '-',
            'line' => $this->resource['line'] ?? null,
            'stack_trace' => $this->resource['stack_trace'] ?? '',
            'context' => $this->resource['context'] ?? [],
        ];
    }
}
