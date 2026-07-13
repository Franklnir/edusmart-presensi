<?php

namespace App\Http\Requests\Academic;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;

class ApplyAcademicPeriodRequest extends FormRequest
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
            'tahun_ajaran' => ['required', 'string', 'regex:/^\d{4}\/\d{4}$/'],
            'semester_aktif' => ['required', 'string', 'in:Ganjil,Genap'],
            'periode_mulai' => ['nullable', 'date_format:Y-m-d'],
            'periode_selesai' => ['nullable', 'date_format:Y-m-d'],
            'periode_ganjil_mulai' => ['nullable', 'date_format:Y-m-d'],
            'periode_ganjil_selesai' => ['nullable', 'date_format:Y-m-d'],
            'periode_genap_mulai' => ['nullable', 'date_format:Y-m-d'],
            'periode_genap_selesai' => ['nullable', 'date_format:Y-m-d'],
            'auto_rollover' => ['sometimes', 'boolean'],
            'carry_eskul_members' => ['sometimes', 'boolean'],
            'calendar_confirmed' => ['sometimes', 'boolean'],
            'impact_confirmed' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'tahun_ajaran.regex' => 'Tahun ajaran harus berformat 2026/2027.',
            'semester_aktif.in' => 'Semester aktif harus Ganjil atau Genap.',
        ];
    }
}
