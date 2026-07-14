<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class StoreTempScanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'tanggal' => ['required', 'date', 'before_or_equal:today'],
            'siswa_id' => ['required', 'uuid'],
            'kelas' => ['required', 'string', 'max:255'],
            'sesi' => ['required', 'string', 'in:masuk,pulang'],
            'scan_at' => ['required', 'date'],
            'source' => ['nullable', 'string', 'max:255'],
            'card_uid' => ['nullable', 'string', 'max:255'],
            'mapel_count' => ['nullable', 'integer', 'min:0'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
