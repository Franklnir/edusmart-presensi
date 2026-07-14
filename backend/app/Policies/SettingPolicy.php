<?php

namespace App\Policies;

use App\Models\User;

class SettingPolicy
{
    /**
     * Every authenticated tenant member may read the small academic context.
     * Tenant ownership itself is enforced before this policy by middleware.
     */
    public function viewAny(User $user): bool
    {
        return $user->profile !== null;
    }
}
