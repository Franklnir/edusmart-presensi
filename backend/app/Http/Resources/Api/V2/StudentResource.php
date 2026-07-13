<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StudentResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'nama' => $this->nama,
            'email' => $this->email,
            'role' => $this->role,
            'kelas' => $this->kelas,
            'angkatan' => $this->angkatan,
            'jk' => $this->jk,
            'usia' => $this->usia,
            'telp' => $this->telp,
            'nis' => $this->nis,
            'agama' => $this->agama,
            'alamat' => $this->alamat,
            'status' => $this->status,
            'alasan_nonaktif' => $this->alasan_nonaktif,
            'tanggal_lahir' => $this->tanggal_lahir?->format('Y-m-d'),
            'rfid_uid' => $this->rfid_uid,
            'no_hp_siswa' => $this->no_hp_siswa,
            'no_hp_wali' => $this->no_hp_wali,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'created_via' => $this->created_via,
        ];
    }
}
