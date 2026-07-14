<?php

namespace App\Http\Resources\Api\V2;

use DateTimeInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ManualScoreResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'guru_id' => (string) $this->guru_id,
            'siswa_id' => (string) $this->siswa_id,
            'kelas_id' => (string) $this->kelas_id,
            'mapel' => (string) $this->mapel,
            'tahun_ajaran' => $this->tahun_ajaran,
            'semester' => $this->semester,
            'academic_year_id' => $this->academic_year_id ?? null,
            'academic_term_id' => $this->academic_term_id ?? null,
            'nilai_manual' => $this->number($this->nilai_manual),
            'nilai_uts_manual' => $this->number($this->nilai_uts_manual),
            'nilai_uas_manual' => $this->number($this->nilai_uas_manual),
            'catatan' => $this->catatan !== null ? (string) $this->catatan : null,
            'created_at' => $this->dateValue($this->created_at ?? null),
            'updated_at' => $this->dateValue($this->updated_at ?? null),
        ];
    }

    private function number(mixed $value): ?float
    {
        return $value === null || $value === '' ? null : (float) $value;
    }

    private function dateValue(mixed $value): ?string
    {
        if ($value instanceof DateTimeInterface) {
            return $value->format(DateTimeInterface::ATOM);
        }

        return $value !== null && trim((string) $value) !== '' ? (string) $value : null;
    }
}
