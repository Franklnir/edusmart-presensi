<?php

namespace App\Http\Requests\Api\V2;

use App\Http\Requests\Api\V2\Concerns\ValidatesSchedulePayload;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UpdateScheduleRequest extends FormRequest
{
    use ValidatesSchedulePayload;

    private const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->prepareSchedulePayload();
    }

    public function withValidator(Validator $validator): void
    {
        $this->validateScheduleUpdatePayload($validator);
        $this->validateScheduleTimes($validator);
    }

    public function rules(): array
    {
        return [
            // The class is an immutable locator. It prevents legacy composite
            // schedule IDs from resolving a row from a different class.
            'kelas_id' => ['required', 'string', 'max:255'],
            'hari' => ['sometimes', 'required', 'string', 'in:'.implode(',', self::DAYS)],
            'mapel' => ['sometimes', 'required', 'string', 'max:255'],
            'guru_id' => ['sometimes', 'nullable', 'uuid'],
            'jam_mulai' => ['sometimes', 'required', 'date_format:H:i,H:i:s'],
            'jam_selesai' => ['sometimes', 'required', 'date_format:H:i,H:i:s'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
