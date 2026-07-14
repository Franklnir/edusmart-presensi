<?php

namespace App\Http\Requests\Api\V2\Concerns;

use Illuminate\Validation\Validator;

trait ValidatesSchedulePayload
{
    protected function prepareSchedulePayload(): void
    {
        $normalized = [];
        if ($this->exists('kelas_id')) {
            $normalized['kelas_id'] = trim((string) $this->input('kelas_id'));
        }
        if ($this->exists('hari')) {
            $normalized['hari'] = trim((string) $this->input('hari'));
        }
        if ($this->exists('mapel')) {
            $normalized['mapel'] = preg_replace('/\s+/', ' ', trim((string) $this->input('mapel')));
        }
        if ($this->exists('guru_id')) {
            $teacherId = trim((string) $this->input('guru_id'));
            $normalized['guru_id'] = $teacherId !== '' ? $teacherId : null;
        }
        if ($this->exists('jam_mulai')) {
            $normalized['jam_mulai'] = trim((string) $this->input('jam_mulai'));
        }
        if ($this->exists('jam_selesai')) {
            $normalized['jam_selesai'] = trim((string) $this->input('jam_selesai'));
        }

        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    protected function validateScheduleUpdatePayload(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $editableFields = ['hari', 'mapel', 'guru_id', 'jam_mulai', 'jam_selesai'];
            foreach ($editableFields as $field) {
                if ($this->exists($field)) {
                    return;
                }
            }

            $validator->errors()->add('payload', 'Minimal satu perubahan jadwal harus dikirim.');
        });
    }

    protected function validateScheduleTimes(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($validator->errors()->has('jam_mulai') || $validator->errors()->has('jam_selesai')) {
                return;
            }

            $start = $this->input('jam_mulai');
            $end = $this->input('jam_selesai');
            if (! is_string($start) || ! is_string($end) || $start === '' || $end === '') {
                return;
            }

            if ($this->timeToSeconds($end) - $this->timeToSeconds($start) < 30 * 60) {
                $validator->errors()->add('jam_selesai', 'Durasi pelajaran minimal 30 menit.');
            }
        });
    }

    private function timeToSeconds(string $value): int
    {
        $parts = array_map('intval', explode(':', $value));
        $parts = array_pad($parts, 3, 0);

        return ($parts[0] * 3600) + ($parts[1] * 60) + $parts[2];
    }
}
