<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class UpsertReportCardItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'kelas_id' => ['required', 'string', 'max:191'],
            'jenis' => ['required', 'string', 'in:uts,uas'],
            'mapel' => ['required', 'string', 'max:191'],
            'kkm' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'nilai' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'predikat' => ['nullable', 'string', 'max:20'],
            'keterangan' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
