<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CurrentProfileResource extends JsonResource
{
    /**
     * A self-only profile payload. Asset object paths are deliberately omitted
     * until profile avatars use the authorized Attachment resource.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'nama' => $this->nama,
            'role' => $this->role,
            'kelas' => $this->kelas,
            'angkatan' => $this->angkatan,
            'status' => $this->status,
            'nis' => $this->nis,
            'jk' => $this->jk,
            'agama' => $this->agama,
            'telp' => $this->telp,
            'alamat' => $this->alamat,
            'tanggal_lahir' => $this->tanggal_lahir?->format('Y-m-d'),
            'no_hp_siswa' => $this->no_hp_siswa,
            'no_hp_wali' => $this->no_hp_wali,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
