<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class UpdateAttendanceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // Authorize in controller
    }

    public function rules(): array
    {
        return [
            'status' => ['sometimes', 'string', 'in:Hadir,Izin,Sakit,Alpha'],
            'komentar' => ['nullable', 'string'],
        ];
    }
}
