<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class GradeSubmissionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'nilai' => ['required', 'integer', 'min:0', 'max:100'],
            'status' => ['nullable', 'string', 'in:dinilai,revisi'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
