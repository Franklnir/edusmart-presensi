<?php

namespace App\Http\Requests\Academic;

use Illuminate\Foundation\Http\FormRequest;

class StoreTaskRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null && $this->attributes->get('tenant_id') !== null;
    }

    public function rules(): array
    {
        return [
            'kelas' => ['required', 'string', 'max:120'],
            'mapel' => ['required', 'string', 'max:160'],
            'judul' => ['required', 'string', 'max:255'],
            'mulai' => ['required', 'date'],
            'deadline' => ['required', 'date', 'after:mulai'],
            'keterangan' => ['nullable', 'string', 'max:20000'],
            'file_url' => ['nullable', 'string', 'max:2048'],
            'link' => ['nullable', 'url:http,https', 'max:2048'],
        ];
    }
}
