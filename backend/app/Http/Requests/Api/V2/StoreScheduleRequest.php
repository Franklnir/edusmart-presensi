<?php

namespace App\Http\Requests\Api\V2;

use App\Http\Requests\Api\V2\Concerns\ValidatesSchedulePayload;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreScheduleRequest extends FormRequest
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
        $this->validateScheduleTimes($validator);
    }

    public function rules(): array
    {
        return [
            'kelas_id' => ['required', 'string', 'max:255'],
            'hari' => ['required', 'string', 'in:'.implode(',', self::DAYS)],
            'mapel' => ['required', 'string', 'max:255'],
            'guru_id' => ['nullable', 'uuid'],
            'jam_mulai' => ['required', 'date_format:H:i,H:i:s'],
            'jam_selesai' => ['required', 'date_format:H:i,H:i:s', 'after:jam_mulai'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
