<?php

namespace App\Http\Resources\Api\V2;

use DateTimeInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class GradeWeightResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'guru_id' => (string) $this->guru_id,
            'mapel' => (string) $this->mapel,
            'tahun_ajaran' => $this->tahun_ajaran,
            'semester' => $this->semester,
            'academic_year_id' => $this->academic_year_id ?? null,
            'academic_term_id' => $this->academic_term_id ?? null,
            'bobot_tugas_pr' => $this->number($this->bobot_tugas_pr),
            'bobot_quiz_reguler' => $this->number($this->bobot_quiz_reguler),
            'bobot_quiz_uts' => $this->number($this->bobot_quiz_uts),
            'bobot_quiz_uas' => $this->number($this->bobot_quiz_uas),
            'sumber_uts' => (string) ($this->sumber_uts ?? 'digital'),
            'sumber_uas' => (string) ($this->sumber_uas ?? 'digital'),
            'jenis_manual' => (string) ($this->jenis_manual ?? 'absensi'),
            'label_manual' => $this->label_manual !== null ? (string) $this->label_manual : null,
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
