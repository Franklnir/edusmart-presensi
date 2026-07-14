<?php

namespace App\Services\Actions\Student;

use App\Models\Profile;
use Illuminate\Support\Facades\DB;

class ActivateStudent
{
    public function execute(Profile $profile): Profile
    {
        return DB::transaction(function () use ($profile) {
            $profile = Profile::whereKey($profile->id)->lockForUpdate()->firstOrFail();
            $profile->update([
                'status' => 'active',
                'alasan_nonaktif' => null,
                'disabled_at' => null,
            ]);

            return $profile;
        });
    }
}
