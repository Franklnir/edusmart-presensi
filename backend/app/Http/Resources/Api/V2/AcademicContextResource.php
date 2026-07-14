<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AcademicContextResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'tahun_ajaran' => $this->tahun_ajaran,
            'semester_aktif' => $this->semester_aktif,
            'periode_mulai' => $this->dateValue('periode_mulai'),
            'periode_selesai' => $this->dateValue('periode_selesai'),
            'periode_ganjil_mulai' => $this->dateValue('periode_ganjil_mulai'),
            'periode_ganjil_selesai' => $this->dateValue('periode_ganjil_selesai'),
            'periode_genap_mulai' => $this->dateValue('periode_genap_mulai'),
            'periode_genap_selesai' => $this->dateValue('periode_genap_selesai'),
            'max_ekskul_per_siswa' => $this->max_ekskul_per_siswa === null
                ? null
                : (int) $this->max_ekskul_per_siswa,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    private function dateValue(string $attribute): ?string
    {
        $value = $this->{$attribute};

        return $value?->format('Y-m-d') ?? ($value ? (string) $value : null);
    }
}
