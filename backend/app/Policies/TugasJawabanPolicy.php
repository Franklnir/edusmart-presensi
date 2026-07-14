<?php

namespace App\Policies;

use App\Models\TugasJawaban;
use App\Models\User;
use Illuminate\Auth\Access\HandlesAuthorization;

class TugasJawabanPolicy
{
    use HandlesAuthorization;

    public function viewAny(User $user): bool
    {
        return in_array($user->profile->role, ['guru', 'siswa', 'admin']);
    }

    public function view(User $user, TugasJawaban $jawaban): bool
    {
        if (! $user->profile || ! $jawaban->tugas || $user->profile->tenant_id !== $jawaban->tugas->tenant_id) {
            return false;
        }

        if ($user->profile->role === 'admin') {
            return true;
        }

        if ($user->profile->role === 'siswa') {
            return $jawaban->user_id === $user->profile->id;
        }

        if ($user->profile->role === 'guru') {
            return $jawaban->tugas && $jawaban->tugas->created_by === $user->profile->id;
        }

        return false;
    }

    public function create(User $user): bool
    {
        return $user->profile?->role === 'siswa';
    }

    public function update(User $user, TugasJawaban $jawaban): bool
    {
        if (! $user->profile || ! $jawaban->tugas || $user->profile->tenant_id !== $jawaban->tugas->tenant_id) {
            return false;
        }

        if ($user->profile->role === 'siswa') {
            return $jawaban->user_id === $user->profile->id;
        }

        return false;
    }

    public function grade(User $user, TugasJawaban $jawaban): bool
    {
        if (! $user->profile || ! $jawaban->tugas || $user->profile->tenant_id !== $jawaban->tugas->tenant_id) {
            return false;
        }
        if ($user->profile->role === 'admin') {
            return true;
        }

        if ($user->profile->role === 'guru') {
            return $jawaban->tugas && $jawaban->tugas->created_by === $user->profile->id;
        }

        return false;
    }

    public function delete(User $user, TugasJawaban $jawaban): bool
    {
        if (! $user->profile || ! $jawaban->tugas || $user->profile->tenant_id !== $jawaban->tugas->tenant_id) {
            return false;
        }

        if ($user->profile->role === 'admin') {
            return true;
        }

        if ($user->profile->role === 'siswa') {
            return $jawaban->user_id === $user->profile->id;
        }

        return false;
    }
}
