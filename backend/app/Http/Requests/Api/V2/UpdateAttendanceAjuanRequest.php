<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class UpdateAttendanceAjuanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // Authorize in controller
    }

    public function rules(): array
    {
        return [
            'action' => ['required', 'string', 'in:izin,sakit,reject'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
