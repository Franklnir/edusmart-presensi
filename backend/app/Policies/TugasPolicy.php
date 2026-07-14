<?php

namespace App\Policies;

use App\Models\Tugas;
use App\Models\User;
use Illuminate\Auth\Access\HandlesAuthorization;

class TugasPolicy
{
    use HandlesAuthorization;

    public function viewAny(User $user): bool
    {
        return in_array($user->profile->role, ['guru', 'siswa', 'admin']);
    }

    public function view(User $user, Tugas $tugas): bool
    {
        if ($user->profile->role === 'admin') {
            return true;
        }

        if ($user->profile->role === 'guru') {
            return $tugas->created_by === $user->profile->id;
        }

        if ($user->profile->role === 'siswa') {
            return $tugas->kelas === $user->profile->kelas;
        }

        return false;
    }

    public function create(User $user): bool
    {
        return $user->profile->role === 'guru' || $user->profile->role === 'admin';
    }

    public function update(User $user, Tugas $tugas): bool
    {
        if ($user->profile->role === 'admin') {
            return true;
        }

        return $user->profile->role === 'guru' && $tugas->created_by === $user->profile->id;
    }

    public function delete(User $user, Tugas $tugas): bool
    {
        return $this->update($user, $tugas);
    }
}
