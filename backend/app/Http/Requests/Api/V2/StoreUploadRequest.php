<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreUploadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'purpose' => ['required', Rule::in(['assignment_attachment', 'submission_attachment'])],
            'assignment_id' => ['nullable', 'required_if:purpose,submission_attachment', 'integer', 'min:1'],
            'filename' => ['required', 'string', 'max:255', function ($attribute, $value, $fail) {
                if (str_contains($value, '/') || str_contains($value, '\\') || pathinfo($value, PATHINFO_EXTENSION) === '') {
                    $fail('Nama file harus berupa nama dasar dengan ekstensi.');
                }
            }],
            'content_type' => [
                'required',
                Rule::in([
                    'application/pdf',
                    'image/jpeg',
                    'image/png',
                    'image/webp',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                ]),
            ],
            'size' => ['required', 'integer', 'min:1', 'max:10485760'],
        ];
    }
}
