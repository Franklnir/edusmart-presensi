<?php

namespace App\Http\Requests\Api\V2;

use App\Models\Profile;
use Illuminate\Foundation\Http\FormRequest;

class StoreAttendanceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // Authorize in controller
    }

    public function rules(): array
    {
        return [
            'uid' => ['required', 'uuid', function ($attribute, $value, $fail) {
                $tenantId = $this->attributes->get('tenant_id');
                $exists = Profile::where('id', $value)
                    ->where('tenant_id', $tenantId)
                    ->where('role', 'siswa')
                    ->exists();
                if (! $exists) {
                    $fail('Siswa tidak ditemukan atau tidak berada di tenant ini.');
                }
            }],
            'kelas' => ['required', 'string', 'max:255'],
            'tanggal' => ['required', 'date', 'before_or_equal:today'],
            'status' => ['required', 'string', 'in:Hadir,Izin,Sakit,Alpha'],
            'mapel' => ['nullable', 'string', 'max:255'],
            'komentar' => ['nullable', 'string'],
            'tahun_ajaran' => ['nullable', 'string', 'max:50'],
            'semester' => ['nullable', 'string', 'max:50'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }
}
