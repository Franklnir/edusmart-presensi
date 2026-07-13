<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class StoreStudentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // Dikelola oleh controller/policy
    }

    public function rules(): array
    {
        return [
            'nama' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255'],
            'kelas' => ['nullable', 'string', 'max:255'],
            'angkatan' => ['nullable', 'string', 'max:4'],
            'jk' => ['nullable', 'string', 'in:L,P'],
            'usia' => ['nullable', 'integer', 'min:5', 'max:30'],
            'telp' => ['nullable', 'string', 'max:20'],
            'nis' => ['nullable', 'string', 'max:50'],
            'agama' => ['nullable', 'string', 'max:50'],
            'alamat' => ['nullable', 'string'],
            'status' => ['nullable', 'string', 'in:active,inactive,nonaktif,mutasi,alumni'],
            'alasan_nonaktif' => ['nullable', 'string'],
            'tanggal_lahir' => ['nullable', 'date'],
            'no_hp_siswa' => ['nullable', 'string', 'max:20'],
            'no_hp_wali' => ['nullable', 'string', 'max:20'],
        ];
    }
}
