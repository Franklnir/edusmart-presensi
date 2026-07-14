<?php

namespace App\Http\Requests\Api\V2;

use Illuminate\Foundation\Http\FormRequest;

class UpsertGradeWeightRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            // The period is accepted only to verify the requested context. The
            // controller always writes the server-resolved context instead.
            'tahun_ajaran' => ['required', 'string', 'max:20', 'regex:/^\d{4}\/\d{4}$/'],
            'semester' => ['required', 'string', 'in:Ganjil,Genap'],
            'guru_id' => ['sometimes', 'nullable', 'uuid'],
            'mapel' => ['required', 'string', 'max:191'],
            'bobot_tugas_pr' => ['required', 'numeric', 'min:0', 'max:100'],
            'bobot_quiz_reguler' => ['required', 'numeric', 'min:0', 'max:100'],
            'bobot_quiz_uts' => ['required', 'numeric', 'min:0', 'max:100'],
            'bobot_quiz_uas' => ['required', 'numeric', 'min:0', 'max:100'],
            'sumber_uts' => ['required', 'string', 'in:digital,manual'],
            'sumber_uas' => ['required', 'string', 'in:digital,manual'],
            'jenis_manual' => ['required', 'string', 'in:absensi,nilai_tambah,lainnya'],
            'label_manual' => ['nullable', 'string', 'max:120'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $total = collect([
                $this->input('bobot_tugas_pr'),
                $this->input('bobot_quiz_reguler'),
                $this->input('bobot_quiz_uts'),
                $this->input('bobot_quiz_uas'),
            ])->sum(static fn ($value): float => (float) $value);

            if ($total > 100.01) {
                $validator->errors()->add(
                    'bobot_tugas_pr',
                    'Total bobot komponen mapel tidak boleh lebih dari 100%.',
                );
            }
        });
    }
}
