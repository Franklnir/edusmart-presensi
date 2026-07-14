<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class ListManualScoresRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'tahun_ajaran' => ['sometimes', 'nullable', 'string', 'max:20', 'regex:/^\d{4}\/\d{4}$/'],
            'semester' => ['sometimes', 'nullable', 'string', 'in:Ganjil,Genap'],
            'guru_id' => ['sometimes', 'nullable', 'uuid'],
            'siswa_id' => ['sometimes', 'nullable', 'uuid'],
            'kelas_id' => ['sometimes', 'nullable', 'string', 'max:191'],
            'mapel' => ['sometimes', 'nullable', 'string', 'max:191'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:500'],
        ];
    }
}
