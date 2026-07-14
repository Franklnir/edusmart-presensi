<?php

namespace App\Services\Profile;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class UpdateCurrentProfile
{
    /**
     * @param  array<string, mixed>  $validated
     */
    public function handle(Profile $profile, User $user, array $validated): Profile
    {
        $allowed = $this->allowedFields((string) $profile->role);
        $payload = array_intersect_key($validated, array_flip($allowed));
        unset($payload['idempotency_key']);

        $forbidden = array_diff(array_keys($validated), array_merge($allowed, ['idempotency_key']));
        if ($forbidden !== []) {
            throw ValidationException::withMessages([
                'profile' => ['Field profil ini tidak dapat diubah dari akun Anda.'],
            ]);
        }

        if ($payload === []) {
            throw ValidationException::withMessages([
                'profile' => ['Tidak ada perubahan profil yang dapat disimpan.'],
            ]);
        }

        return DB::transaction(function () use ($profile, $user, $payload): Profile {
            $locked = Profile::query()
                ->where('id', $profile->id)
                ->where('tenant_id', $profile->tenant_id)
                ->lockForUpdate()
                ->firstOrFail();

            if (($payload['nis'] ?? null) !== null && in_array($locked->role, ['guru', 'teacher'], true)) {
                $duplicate = Profile::query()
                    ->where('tenant_id', $locked->tenant_id)
                    ->where('id', '!=', $locked->id)
                    ->whereRaw('LOWER(nis) = ?', [strtolower((string) $payload['nis'])])
                    ->exists();
                if ($duplicate) {
                    throw ValidationException::withMessages([
                        'nis' => ['NIP/NUPTK sudah dipakai oleh pengguna lain.'],
                    ]);
                }
            }

            $before = $locked->only(array_keys($payload));
            $locked->fill($payload);
            $locked->updated_at = now();
            $locked->save();

            if (array_key_exists('nama', $payload) && in_array($locked->role, ['guru', 'teacher'], true)) {
                $user->forceFill(['name' => $locked->nama])->save();
            }

            $changed = array_keys(array_filter(
                $payload,
                static fn (mixed $value, string $field): bool => $before[$field] !== $value,
                ARRAY_FILTER_USE_BOTH
            ));
            if ($changed !== []) {
                DB::table('audit_log')->insert([
                    'tenant_id' => $locked->tenant_id,
                    'table_name' => 'profiles',
                    'record_id' => (string) $locked->id,
                    'action' => 'UPDATE',
                    'old_data' => json_encode(['changed_fields' => $changed]),
                    'new_data' => json_encode(['changed_fields' => $changed]),
                    'user_id' => $locked->id,
                    'user_role' => $locked->role,
                    'timestamp' => now(),
                ]);
            }

            return $locked->fresh();
        });
    }

    /** @return list<string> */
    private function allowedFields(string $role): array
    {
        return match (strtolower($role)) {
            'guru', 'teacher' => ['nama', 'nis', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir'],
            'admin' => ['nama', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir'],
            'siswa' => ['jk', 'agama', 'telp', 'alamat', 'tanggal_lahir', 'no_hp_siswa', 'no_hp_wali'],
            default => ['nama', 'jk', 'agama', 'telp', 'alamat', 'tanggal_lahir'],
        };
    }
}
