<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class TeacherResource extends JsonResource
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
            'email' => $this->email,
            'nama' => $this->nama,
            'role' => $this->role,
            'status' => $this->status,
            'jk' => $this->jk,
            'telp' => $this->telp,
            'agama' => $this->agama,
            'alamat' => $this->alamat,
            'jabatan' => $this->jabatan,
            'jabatanList' => $this->jabatanList ?? [],
            'jabatanUtama' => $this->jabatanUtama ?? null,
            'mapelList' => $this->mapelList ?? [],
            'kelasList' => $this->kelasList ?? [],
            'tanggal_lahir' => $this->tanggal_lahir,
            'alasan_nonaktif' => $this->alasan_nonaktif,
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
            'photo_url' => $this->photo_url,
            'photo_path' => $this->photo_path,
        ];
    }
}
