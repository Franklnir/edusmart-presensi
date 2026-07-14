<?php

namespace App\Services\Actions\Student;

use App\Models\Profile;
use Illuminate\Support\Facades\DB;

class DeactivateStudent
{
    public function execute(Profile $profile, string $reason = 'nonaktif'): Profile
    {
        return DB::transaction(function () use ($profile, $reason) {
            $profile = Profile::whereKey($profile->id)->lockForUpdate()->firstOrFail();
            $status = in_array($reason, ['nonaktif', 'mutasi', 'alumni']) ? $reason : 'nonaktif';

            $profile->update([
                'status' => $status,
                'alasan_nonaktif' => $reason,
                'disabled_at' => now(),
            ]);

            return $profile;
        });
    }
}
