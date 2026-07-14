<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class StoreAnnouncementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'judul' => ['required', 'string', 'max:255'],
            'keterangan' => ['required', 'string', 'max:10000'],
            'target' => ['nullable', 'string', 'in:semua,all,guru,teacher,siswa,student'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
