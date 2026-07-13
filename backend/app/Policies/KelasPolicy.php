<?php

namespace App\Policies;

use App\Models\Kelas;
use App\Models\User;

class KelasPolicy
{
    /**
     * Determine whether the user can view any models.
     */
    public function viewAny(User $user): bool
    {
        if (! $user->profile) {
            Illuminate\Support\Facades\Log::info('No profile for user '.$user->id);

            return false;
        }

return in_array($user->profile->role, ['admin', 'guru', 'siswa']);
    }

    /**
     * Determine whether the user can view the model.
     */
    public function view(User $user, Kelas $kelas): bool
    {
        if (! $user->profile) {
            Illuminate\Support\Facades\Log::info('No profile for user '.$user->id);

            return false;
        }

return
               in_array($user->profile->role, ['admin', 'guru', 'siswa']) &&
               $user->profile->tenant_id === $kelas->tenant_id;
    }

    /**
     * Determine whether the user can create models.
     */
    public function create(User $user): bool
    {
        if (! $user->profile) {
            Illuminate\Support\Facades\Log::info('No profile for user '.$user->id);

            return false;
        }

return $user->profile->role === 'admin';
    }

    /**
     * Determine whether the user can update the model.
     */
    public function update(User $user, Kelas $kelas): bool
    {
        if (! $user->profile) {
            Illuminate\Support\Facades\Log::info('No profile for user '.$user->id);

            return false;
        }

return
               $user->profile->role === 'admin' &&
               $user->profile->tenant_id === $kelas->tenant_id;
    }

    /**
     * Determine whether the user can delete the model.
     */
    public function delete(User $user, Kelas $kelas): bool
    {
        if (! $user->profile) {
            Illuminate\Support\Facades\Log::info('No profile for user '.$user->id);

            return false;
        }

return
               $user->profile->role === 'admin' &&
               $user->profile->tenant_id === $kelas->tenant_id;
    }
}
