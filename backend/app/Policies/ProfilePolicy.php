<?php

namespace App\Policies;

use App\Models\Profile;
use App\Models\User;

class ProfilePolicy
{
    /**
     * Determine whether the user can view any models.
     */
    public function viewAny(User $user): bool
    {
        return in_array($user->profile->role, ['admin', 'guru']);
    }

    /**
     * Determine whether the user can view the model.
     */
    public function view(User $user, Profile $profile): bool
    {
        if ($user->profile->role === 'admin') {
            return true;
        }

        if ($user->profile->role === 'guru') {
            return true;
        }

        return $user->id === $profile->id;
    }

    /**
     * Determine whether the user can create models.
     */
    public function create(User $user): bool
    {
        return $user->profile->role === 'admin';
    }

    /**
     * Determine whether the user can update the model.
     */
    public function update(User $user, Profile $profile): bool
    {
        if ($user->profile->role === 'admin') {
            return true;
        }

        return $user->id === $profile->id;
    }

    /**
     * Determine whether the user can delete the model.
     */
    public function delete(User $user, Profile $profile): bool
    {
        return $user->profile->role === 'admin';
    }
}
