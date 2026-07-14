<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class UpsertManualScoreRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'tahun_ajaran' => ['required', 'string', 'max:20', 'regex:/^\d{4}\/\d{4}$/'],
            'semester' => ['required', 'string', 'in:Ganjil,Genap'],
            'guru_id' => ['sometimes', 'nullable', 'uuid'],
            'siswa_id' => ['required', 'uuid'],
            'kelas_id' => ['required', 'string', 'max:191'],
            'mapel' => ['required', 'string', 'max:191'],
            'nilai_manual' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'nilai_uts_manual' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'nilai_uas_manual' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'catatan' => ['nullable', 'string', 'max:2000'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
