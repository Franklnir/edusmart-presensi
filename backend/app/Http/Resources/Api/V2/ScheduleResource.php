<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ScheduleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'kelas_id' => (string) $this->kelas_id,
            'hari' => $this->hari,
            'mapel' => $this->mapel,
            'guru_id' => $this->guru_id,
            'guru_nama' => $this->guru_nama,
            'jam_mulai' => $this->formatTime($this->jam_mulai),
            'jam_selesai' => $this->formatTime($this->jam_selesai),
            'tahun_ajaran' => $this->tahun_ajaran,
            // Schedules are intentionally annual. Semester remains null so
            // clients cannot accidentally treat an annual schedule as a term row.
            'semester' => null,
            'periode_berlaku' => 'tahunan',
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }

    private function formatTime(mixed $value): ?string
    {
        $time = trim((string) ($value ?? ''));
        if ($time === '') {
            return null;
        }

        return substr($time, 0, 5);
    }
}
