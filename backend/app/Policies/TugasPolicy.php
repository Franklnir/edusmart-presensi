<?php

namespace App\Policies;

use App\Models\Tugas;
use App\Models\User;

class TugasPolicy
{
    public function viewAny(User $user): bool
    {
        return in_array($user->profile?->role, ['guru', 'siswa', 'admin'], true);
    }

    public function view(User $user, Tugas $tugas): bool
    {
        $actor = $user->profile;
        if (! $actor || $actor->tenant_id !== $tugas->tenant_id) {
            return false;
        }

        if ($actor->role === 'admin') {
            return true;
        }

        if ($actor->role === 'guru') {
            return $tugas->created_by === $actor->id;
        }

        return $actor->role === 'siswa'
            && $tugas->kelas === $actor->kelas
            && in_array($tugas->status, ['published', 'closed'], true);
    }

    public function create(User $user): bool
    {
        return in_array($user->profile?->role, ['guru', 'admin'], true);
    }

    public function update(User $user, Tugas $tugas): bool
    {
        $actor = $user->profile;
        if (! $actor || $actor->tenant_id !== $tugas->tenant_id) {
            return false;
        }

        return $actor->role === 'admin' || ($actor->role === 'guru' && $tugas->created_by === $actor->id);
    }

    public function delete(User $user, Tugas $tugas): bool
    {
        return $this->update($user, $tugas);
    }
}
