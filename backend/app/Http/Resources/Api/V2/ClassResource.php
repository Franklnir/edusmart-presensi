<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ClassResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'nama' => (string) $this->nama,
            'grade' => $this->grade ? (string) $this->grade : null,
            'suffix' => $this->suffix ? (string) $this->suffix : null,
            'angkatan' => $this->angkatan ? (string) $this->angkatan : null,
            'tahun_ajaran' => $this->tahun_ajaran ? (string) $this->tahun_ajaran : null,
            'semester' => $this->semester ? (string) $this->semester : null,
            'is_active' => (bool) $this->is_active,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
