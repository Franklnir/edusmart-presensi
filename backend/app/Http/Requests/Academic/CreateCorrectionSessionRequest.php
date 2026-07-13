<?php

namespace App\Http\Requests\Academic;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class CreateCorrectionSessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        $tenantId = (string) ($this->attributes->get('tenant_id') ?? '');

        return $tenantId !== ''
            && $this->user() !== null
            && Gate::forUser($this->user())->allows('manage-academic-period', $tenantId);
    }

    public function rules(): array
    {
        return [
            'academic_term_id' => ['required', 'uuid'],
            'reason' => ['required', 'string', 'min:10', 'max:500'],
            'allowed_scopes' => ['required', 'array', 'min:1', 'max:20'],
            'allowed_scopes.*' => ['required', 'string', 'max:80'],
            'duration_minutes' => ['nullable', 'integer', 'min:5', 'max:60'],
        ];
    }
}
