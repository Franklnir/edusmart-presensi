<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class StoreAssignmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'kelas' => ['required', 'string', 'max:255'],
            'judul' => ['required', 'string', 'max:255'],
            'mapel' => ['required', 'string', 'max:255'],
            'mulai' => ['nullable', 'date'],
            'deadline' => ['required', 'date'],
            'keterangan' => ['nullable', 'string'],
            'attachment_ids' => ['nullable', 'array'],
            'attachment_ids.*' => ['string', 'uuid'],
            'link' => ['nullable', 'string', 'url'],
            'tahun_ajaran' => ['nullable', 'string', 'max:50'],
            'semester' => ['nullable', 'string', 'max:50'],
            'angkatan' => ['nullable', 'string', 'max:50'],
            'idempotency_key' => ['nullable', 'string', 'max:64'],
        ];
    }
}
