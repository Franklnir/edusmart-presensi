<?php

namespace App\Policies;

use App\Models\Jadwal;
use App\Models\User;

class JadwalPolicy
{
    public function viewAny(User $user): bool
    {
        return in_array($user->profile?->role, ['admin', 'guru', 'siswa'], true);
    }

    public function view(User $user, Jadwal $jadwal): bool
    {
        return $this->viewAny($user)
            && (string) $user->profile?->tenant_id === (string) $jadwal->tenant_id;
    }

    public function create(User $user): bool
    {
        return $user->profile?->role === 'admin';
    }

    public function update(User $user, Jadwal $jadwal): bool
    {
        return $this->create($user)
            && (string) $user->profile?->tenant_id === (string) $jadwal->tenant_id;
    }

    public function delete(User $user, Jadwal $jadwal): bool
    {
        return $this->update($user, $jadwal);
    }
}
