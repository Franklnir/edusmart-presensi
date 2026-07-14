<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class StudentIndexRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'per_page' => ['nullable', 'integer', 'min:1', 'max:500'],
            'sort' => ['nullable', 'string', 'in:nama,nis,kelas,created_at'],
            'order' => ['nullable', 'string', 'in:asc,desc,ASC,DESC'],
            'q' => ['nullable', 'string', 'max:255'],
            'search' => ['nullable', 'string', 'max:255'],
            'nis' => ['nullable', 'string', 'max:255'],
            'kelas' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'string', 'in:active,nonaktif,mutasi,alumni'],
            'has_rfid' => ['nullable', 'boolean'],
            'include_stats' => ['nullable', 'boolean'],
            'include_context' => ['nullable', 'boolean'],
            'tahun_ajaran' => ['nullable', 'string', 'max:50'],
        ];
    }
}
