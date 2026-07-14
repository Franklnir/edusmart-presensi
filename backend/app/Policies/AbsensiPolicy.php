<?php

namespace App\Policies;

use App\Models\Absensi;
use App\Models\User;

class AbsensiPolicy
{
    /**
     * Determine whether the user can view any models.
     */
    public function viewAny(User $user): bool
    {
        return in_array($user->profile->role, ['admin', 'guru', 'siswa']);
    }

    /**
     * Determine whether the user can view the model.
     */
    public function view(User $user, Absensi $absensi): bool
    {
        if (in_array($user->profile->role, ['admin', 'guru'])) {
            return true;
        }

        return $user->id === $absensi->uid;
    }

    /**
     * Determine whether the user can create models.
     */
    public function create(User $user): bool
    {
        return in_array($user->profile->role, ['admin', 'guru']);
    }

    /**
     * Determine whether the user can update the model.
     */
    public function update(User $user, Absensi $absensi): bool
    {
        return in_array($user->profile->role, ['admin', 'guru']);
    }

    /**
     * Determine whether the user can delete the model.
     */
    public function delete(User $user, Absensi $absensi): bool
    {
        return in_array($user->profile->role, ['admin', 'guru']);
    }
}
