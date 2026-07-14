<?php

namespace App\Http\Resources\Api\V2;

use DateTimeInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AnnouncementResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'judul' => (string) ($this->judul ?? ''),
            'keterangan' => $this->keterangan !== null ? (string) $this->keterangan : null,
            'target' => (string) ($this->target ?? 'semua'),
            'created_at' => $this->dateValue($this->created_at ?? null),
            'updated_at' => $this->dateValue($this->updated_at ?? null),
        ];
    }

    private function dateValue(mixed $value): ?string
    {
        if ($value instanceof DateTimeInterface) {
            return $value->format(DateTimeInterface::ATOM);
        }

        return $value !== null && trim((string) $value) !== '' ? (string) $value : null;
    }
}
