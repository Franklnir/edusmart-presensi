<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class StoreAttendanceAjuanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // Authorize in controller
    }

    public function rules(): array
    {
        return [
            'kelas' => ['nullable', 'string', 'max:255'],
            'tanggal' => ['required', 'date', 'before_or_equal:today'],
            'mapel' => ['nullable', 'string', 'max:255'],
            'alasan' => ['required', 'string'],
            'tahun_ajaran' => ['nullable', 'string', 'max:50'],
            'semester' => ['nullable', 'string', 'max:50'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
