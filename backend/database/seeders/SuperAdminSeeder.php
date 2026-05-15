<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Artisan;

class SuperAdminSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $exitCode = Artisan::call('super-admin:bootstrap');
        $output = trim(Artisan::output());

        if ($output !== '') {
            $this->command?->line($output);
        }

        if ($exitCode !== 0) {
            $this->command?->error('Super admin seeder gagal menjalankan bootstrap command.');
        }
    }
}
