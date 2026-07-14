<?php

namespace App\Http\Resources\Api\V2;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AttendanceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'kelas' => $this->kelas,
            'tanggal' => $this->tanggal ? $this->tanggal->format('Y-m-d') : null,
            'waktu' => $this->waktu ? $this->waktu->format('H:i:s') : null,
            'uid' => $this->uid,
            'mapel' => $this->mapel,
            'status' => $this->status,
            'nama' => $this->nama,
            'komentar' => $this->komentar,
            'oleh' => $this->oleh,
            'dikonfirmasi' => $this->dikonfirmasi,
            'profile' => new StudentResource($this->whenLoaded('profile')),
        ];
    }
}
