<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class UpdateTeacherRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        $id = $this->route('teacher');

        return [
            'email' => ['sometimes', 'email', 'max:255', 'unique:profiles,email,'.$id],
            'nama' => ['sometimes', 'string', 'max:255'],
            'jk' => ['nullable', 'string', 'in:L,P'],
            'agama' => ['nullable', 'string', 'max:50'],
            'jabatan' => ['nullable', 'string', 'max:100'],
            'alamat' => ['nullable', 'string'],
            'telp' => ['nullable', 'string', 'max:20'],
            'tanggal_lahir' => ['nullable', 'date'],
            'password' => ['nullable', 'string', 'min:6'],
            'status' => ['nullable', 'string', 'in:active,nonaktif,mutasi'],
            'alasan_nonaktif' => ['nullable', 'string'],
        ];
    }
}
