<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class UpdateSubmissionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'attachment_ids' => ['nullable', 'array'],
            'attachment_ids.*' => ['string', 'uuid'],
            'link_url' => ['nullable', 'url', 'max:2048'],
            'file_name' => ['nullable', 'string'],
            'komentar_siswa' => ['nullable', 'string'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
