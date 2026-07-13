<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class StoreClassRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'nama' => 'required|string|max:255',
            'grade' => 'nullable|string|max:50',
            'suffix' => 'nullable|string|max:50',
            'angkatan' => 'nullable|string|max:10',
            'tahun_ajaran' => 'nullable|string|max:20',
            'semester' => 'nullable|string|max:10',
            'is_active' => 'nullable|boolean',
        ];
    }
}
