<?php

namespace App\Services\Actions\Student;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class UpdateStudent
{
    public function execute(Profile $profile, array $data): Profile
    {
        return DB::transaction(function () use ($profile, $data) {
            unset($data['idempotency_key'], $data['tenant_id'], $data['role'], $data['status']);
            $profile->update($data);

            if (isset($data['email']) || isset($data['nama'])) {
                $user = User::find($profile->id);
                if ($user) {
                    if (isset($data['email'])) {
                        $user->email = $data['email'];
                    }
                    if (isset($data['nama'])) {
                        $user->name = $data['nama'];
                    }
                    $user->save();
                }
            }

            return $profile->fresh();
        });
    }
}
