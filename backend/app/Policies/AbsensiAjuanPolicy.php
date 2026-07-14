<?php

namespace App\Policies;

use App\Models\AbsensiAjuan;
use App\Models\User;
use App\Services\AcademicAccessService;

class AbsensiAjuanPolicy
{
    public function __construct(private readonly AcademicAccessService $academicAccess) {}

    public function viewAny(User $user): bool
    {
        return in_array($user->profile?->role, ['admin', 'guru', 'siswa'], true);
    }

    public function view(User $user, AbsensiAjuan $ajuan): bool
    {
        $actor = $user->profile;
        $student = $ajuan->profile;
        if (! $actor || ! $student || $actor->tenant_id !== $student->tenant_id) {
            return false;
        }

        if ($actor->role === 'admin') {
            return true;
        }

        if ($actor->role === 'guru') {
            return $this->academicAccess->canManageClass($actor, (string) $ajuan->kelas, (string) $ajuan->mapel);
        }

        return $actor->role === 'siswa' && $ajuan->uid === $actor->id;
    }

    public function create(User $user): bool
    {
        return $user->profile?->role === 'siswa';
    }

    public function update(User $user, AbsensiAjuan $ajuan): bool
    {
        return $this->view($user, $ajuan) && in_array($user->profile?->role, ['admin', 'guru'], true);
    }

    public function delete(User $user, AbsensiAjuan $ajuan): bool
    {
        return $ajuan->status_guru === 'pending' && $this->view($user, $ajuan);
    }
}
