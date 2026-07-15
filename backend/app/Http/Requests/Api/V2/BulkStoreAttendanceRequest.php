<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class BulkStoreAttendanceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'records' => ['required', 'array', 'min:1', 'max:500'],
            'records.*.uid' => ['required', 'uuid'],
            'records.*.kelas' => ['required', 'string', 'max:255'],
            'records.*.tanggal' => ['required', 'date', 'before_or_equal:today'],
            'records.*.status' => ['required', 'string', 'in:Hadir,Izin,Sakit,Alpha'],
            'records.*.mapel' => ['nullable', 'string', 'max:255'],
            'records.*.nama' => ['nullable', 'string', 'max:255'],
            'records.*.oleh' => ['nullable', 'string', 'max:255'],
            'records.*.tahun_ajaran' => ['nullable', 'string', 'max:50'],
            'records.*.semester' => ['nullable', 'string', 'max:50'],
            'idempotency_key' => ['required', 'string', 'max:255'],
        ];
    }
}
