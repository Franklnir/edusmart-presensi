<?php

namespace App\Http\Requests\Api\V2;

use App\Support\AcademicPeriod;
use Illuminate\Foundation\Http\FormRequest;

class ShowAdminDashboardRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    protected function prepareForValidation(): void
    {
        $rawYear = trim((string) $this->query('tahun_ajaran', ''));
        if ($rawYear === '') {
            return;
        }

        $this->merge([
            'tahun_ajaran' => AcademicPeriod::normalizeAcademicYear($rawYear) ?? $rawYear,
        ]);
    }

    public function rules(): array
    {
        return [
            'tahun_ajaran' => ['nullable', 'string', 'regex:/^\d{4}\/\d{4}$/'],
        ];
    }
}
