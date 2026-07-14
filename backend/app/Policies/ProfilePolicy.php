<?php

namespace App\Policies;

use App\Models\Profile;
use App\Models\User;
use App\Services\AcademicAccessService;

class ProfilePolicy
{
    public function __construct(private readonly AcademicAccessService $academicAccess) {}

    public function viewAny(User $user): bool
    {
        return in_array($user->profile?->role, ['admin', 'guru'], true);
    }

    public function view(User $user, Profile $profile): bool
    {
        $actor = $user->profile;
        if (! $actor || $actor->tenant_id !== $profile->tenant_id) {
            return false;
        }

        if ($actor->role === 'admin') {
            return true;
        }

        if ($actor->role === 'guru' && $profile->role === 'siswa') {
            return $this->academicAccess->canManageClass($actor, (string) $profile->kelas);
        }

        return $actor->id === $profile->id;
    }

    public function create(User $user): bool
    {
        return $user->profile?->role === 'admin';
    }

    public function update(User $user, Profile $profile): bool
    {
        $actor = $user->profile;

        return $actor?->role === 'admin' && $actor->tenant_id === $profile->tenant_id;
    }

    public function delete(User $user, Profile $profile): bool
    {
        return $this->update($user, $profile) && $profile->role !== 'siswa';
    }

    public function deactivate(User $user, Profile $profile): bool
    {
        return $this->update($user, $profile) && $profile->role === 'siswa';
    }

    public function activate(User $user, Profile $profile): bool
    {
        return $this->update($user, $profile) && $profile->role === 'siswa';
    }
}
