<?php

namespace Database\Seeders;

use App\Models\User;
use App\Models\Profile;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $roles = ['admin', 'guru', 'siswa'];

        foreach ($roles as $role) {
            $id = Str::uuid()->toString();
            $email = "{$role}@test.com";

            User::create([
                'id' => $id,
                'name' => ucfirst($role) . ' Test',
                'email' => $email,
                'password' => Hash::make('password'),
            ]);

            Profile::create([
                'id' => $id,
                'email' => $email,
                'nama' => ucfirst($role) . ' Test',
                'role' => $role,
            ]);
        }
    }
}
