<?php

namespace App\Http\Requests\Academic;

use Illuminate\Foundation\Http\FormRequest;

class UpdateTaskRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null && $this->attributes->get('tenant_id') !== null;
    }

    public function rules(): array
    {
        return [
            'kelas' => ['sometimes', 'required', 'string', 'max:120'],
            'mapel' => ['sometimes', 'required', 'string', 'max:160'],
            'judul' => ['sometimes', 'required', 'string', 'max:255'],
            'mulai' => ['sometimes', 'required', 'date'],
            'deadline' => ['sometimes', 'required', 'date'],
            'keterangan' => ['nullable', 'string', 'max:20000'],
            'file_url' => ['nullable', 'string', 'max:2048'],
            'link' => ['nullable', 'url:http,https', 'max:2048'],
        ];
    }
}
