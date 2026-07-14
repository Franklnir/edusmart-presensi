<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class UpdateAssignmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'kelas' => ['sometimes', 'string', 'max:255'],
            'judul' => ['sometimes', 'string', 'max:255'],
            'mapel' => ['sometimes', 'string', 'max:255'],
            'mulai' => ['nullable', 'date'],
            'deadline' => ['sometimes', 'date'],
            'keterangan' => ['nullable', 'string'],
            'attachment_ids' => ['nullable', 'array'],
            'attachment_ids.*' => ['string', 'uuid'],
            'link' => ['nullable', 'string'],
            'tahun_ajaran' => ['nullable', 'string', 'max:50'],
            'semester' => ['nullable', 'string', 'max:50'],
            'angkatan' => ['nullable', 'string', 'max:50'],
        ];
    }
}
