<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCurrentProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    protected function prepareForValidation(): void
    {
        $this->merge(array_filter([
            'nama' => $this->normalizeText($this->input('nama')),
            'nis' => $this->normalizeText($this->input('nis')),
            'jk' => strtoupper($this->normalizeText($this->input('jk')) ?? ''),
            'agama' => $this->normalizeText($this->input('agama')),
            'telp' => $this->normalizeText($this->input('telp')),
            'alamat' => $this->normalizeText($this->input('alamat')),
            'no_hp_siswa' => $this->normalizeText($this->input('no_hp_siswa')),
            'no_hp_wali' => $this->normalizeText($this->input('no_hp_wali')),
        ], static fn (mixed $value): bool => $value !== null));
    }

    public function rules(): array
    {
        return [
            'nama' => ['sometimes', 'required', 'string', 'max:120'],
            'nis' => ['sometimes', 'nullable', 'string', 'max:64'],
            'jk' => ['sometimes', 'nullable', Rule::in(['L', 'P'])],
            'agama' => ['sometimes', 'nullable', 'string', 'max:50'],
            'telp' => ['sometimes', 'nullable', 'string', 'max:32'],
            'alamat' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'tanggal_lahir' => ['sometimes', 'nullable', 'date'],
            'no_hp_siswa' => ['sometimes', 'nullable', 'string', 'max:32'],
            'no_hp_wali' => ['sometimes', 'nullable', 'string', 'max:32'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }

    private function normalizeText(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = preg_replace('/\s+/', ' ', trim((string) $value)) ?? '';

        return $value === '' ? null : $value;
    }
}
