<?php

namespace App\Providers;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Schema;
use Laravel\Horizon\Horizon;
use Laravel\Horizon\HorizonApplicationServiceProvider;

class HorizonServiceProvider extends HorizonApplicationServiceProvider
{
    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        parent::boot();

        // Horizon::routeSmsNotificationsTo('15556667777');
        // Horizon::routeMailNotificationsTo('example@example.com');
        // Horizon::routeSlackNotificationsTo('slack-webhook-url', '#channel');
    }

    /**
     * Register the Horizon gate.
     *
     * This gate determines who can access Horizon in non-local environments.
     */
    protected function gate(): void
    {
        Gate::define('viewHorizon', function ($user = null): bool {
            if (! $user) {
                return false;
            }

            $userId = (string) ($user->id ?? '');
            $email = strtolower(trim((string) ($user->email ?? '')));

            if ($userId !== '' && in_array($userId, (array) config('superadmin.ids', []), true)) {
                return true;
            }

            if ($email !== '' && in_array($email, array_map('strtolower', (array) config('superadmin.emails', [])), true)) {
                return true;
            }

            try {
                if ($userId !== '' && Schema::hasTable('super_admins')) {
                    return DB::table('super_admins')
                        ->where('user_id', $userId)
                        ->exists();
                }
            } catch (\Throwable) {
                return false;
            }

            return false;
        });
    }
}
