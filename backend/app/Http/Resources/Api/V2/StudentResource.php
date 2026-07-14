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
        $isDetail = $request->routeIs('*.show') || $request->routeIs('*.store') || $request->routeIs('*.update');

        return [
            'id' => $this->id,
            'nama' => $this->nama,
            'role' => $this->role,
            'kelas' => $this->kelas,
            'angkatan' => $this->angkatan,
            'status' => $this->status,

            // Sensitive / Detailed fields conditionally loaded
            'email' => $this->when($isDetail, $this->email),
            'jk' => $this->when($isDetail, $this->jk),
            'usia' => $this->when($isDetail, $this->usia),
            'nis' => $this->when($isDetail, $this->nis),
            'alasan_nonaktif' => $this->when($isDetail, $this->alasan_nonaktif),
            'telp' => $this->when($isDetail, $this->telp),
            'agama' => $this->when($isDetail, $this->agama),
            'alamat' => $this->when($isDetail, $this->alamat),
            'tanggal_lahir' => $this->when($isDetail, $this->tanggal_lahir?->format('Y-m-d')),
            'rfid_uid' => $this->when($isDetail, $this->rfid_uid),
            'no_hp_siswa' => $this->when($isDetail, $this->no_hp_siswa),
            'no_hp_wali' => $this->when($isDetail, $this->no_hp_wali),
            'created_via' => $this->when($isDetail, $this->created_via),

            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
