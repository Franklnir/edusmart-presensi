<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AttendanceRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'uid' => $this->uid,
            'nama' => $this->nama,
            'kelas' => $this->kelas,
            'tanggal' => $this->tanggal ? $this->tanggal->format('Y-m-d') : null,
            'mapel' => $this->mapel,
            'alasan' => $this->alasan,
            'status_guru' => $this->status_guru,
            'kategori_final' => $this->kategori_final,
            'guru_id' => $this->guru_id,
            'guru_nama' => $this->guru_nama,
            'waktu_respon' => $this->waktu_respon ? $this->waktu_respon->toIso8601String() : null,
            'tahun_ajaran' => $this->tahun_ajaran,
            'semester' => $this->semester,
            'created_at' => $this->created_at ? $this->created_at->toIso8601String() : null,
            'updated_at' => $this->updated_at ? $this->updated_at->toIso8601String() : null,
            'profile' => new StudentResource($this->whenLoaded('profile')),
        ];
    }
}
