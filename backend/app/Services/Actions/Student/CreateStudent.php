<?php

namespace App\Services\Actions\Student;

use App\Models\Profile;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class CreateStudent
{
    public function execute(array $data, string $tenantId): Profile
    {
        $id = (string) Str::uuid();
        $data['tenant_id'] = $tenantId;
        $data['id'] = $id;
        $data['role'] = 'siswa';
        $data['status'] = $data['status'] ?? 'active';
        $data['created_via'] = 'api_v2';

        return DB::transaction(function () use ($data, $id) {
            $password = $data['password'] ?? Str::password(24);
            unset($data['password'], $data['idempotency_key']);

            User::create([
                'id' => $id,
                'email' => $data['email'],
                'password' => Hash::make($password),
                'name' => $data['nama'],
            ]);

            return Profile::create($data);
        });
    }
}
