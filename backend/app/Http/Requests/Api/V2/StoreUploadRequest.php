<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

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
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                ]),
            ],
            'size' => ['required', 'integer', 'min:1', 'max:10485760'],
            'checksum_sha256' => ['nullable', 'string', 'regex:/^[A-Za-z0-9+\/]{43}=$/'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $extension = strtolower(pathinfo((string) $this->input('filename'), PATHINFO_EXTENSION));
            $allowed = [
                'pdf' => ['application/pdf'],
                'jpg' => ['image/jpeg'],
                'jpeg' => ['image/jpeg'],
                'png' => ['image/png'],
                'webp' => ['image/webp'],
                'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
                'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
                'pptx' => ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
            ];
            if (! isset($allowed[$extension]) || ! in_array($this->input('content_type'), $allowed[$extension], true)) {
                $validator->errors()->add('filename', 'Ekstensi file tidak sesuai dengan MIME yang dinyatakan.');
            }
        });
    }
}
