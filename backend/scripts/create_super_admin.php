<?php

declare(strict_types=1);

use App\Models\Profile;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password as PasswordRule;

require __DIR__.'/../vendor/autoload.php';

$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

function out(string $message): void
{
    fwrite(STDOUT, $message.PHP_EOL);
}

function fail(string $message, int $code = 1): never
{
    fwrite(STDERR, $message.PHP_EOL);
    exit($code);
}

$email = strtolower(trim((string) ($argv[1] ?? '')));
$password = (string) ($argv[2] ?? '');
$name = trim((string) ($argv[3] ?? 'Super Admin'));
$tenantSlug = strtolower(trim((string) ($argv[4] ?? 'default')));

if ($email === '') {
    fail('Usage: php scripts/create_super_admin.php <email> <password> [name] [tenant_slug]');
}

if ($password === '') {
    fail('Password wajib diisi dan harus memenuhi kebijakan password production.');
}

$validator = Validator::make([
    'password' => $password,
], [
    'password' => ['required', 'string', PasswordRule::defaults()],
]);

if ($validator->fails()) {
    fail($validator->errors()->first());
}

$tenant = DB::table('tenants')
    ->where('slug', $tenantSlug)
    ->first(['id', 'name', 'slug']);

if (! $tenant) {
    fail("Tenant dengan slug '{$tenantSlug}' tidak ditemukan.");
}

$now = now();

DB::transaction(function () use ($email, $password, $name, $tenant, $now): void {
    $user = User::query()
        ->whereRaw('lower(email) = ?', [$email])
        ->first();

    if (! $user) {
        $user = User::query()->create([
            'id' => (string) Str::uuid(),
            'name' => $name,
            'email' => $email,
            'password' => $password,
        ]);
        $user->forceFill(['email_verified_at' => $now])->save();
    } else {
        $user->forceFill([
            'name' => $name,
            'email' => $email,
            'password' => $password,
            'email_verified_at' => $user->email_verified_at ?: $now,
        ])->save();
    }

    $profile = Profile::query()->find($user->id);
    if ($profile && strtolower((string) $profile->role) !== 'admin') {
        throw new RuntimeException('User ini sudah terdaftar sebagai non-admin.');
    }

    if ($profile && trim((string) $profile->tenant_id) !== '' && (string) $profile->tenant_id !== (string) $tenant->id) {
        throw new RuntimeException('User ini terdaftar di tenant lain.');
    }

    if (! $profile) {
        Profile::query()->create([
            'id' => (string) $user->id,
            'tenant_id' => (string) $tenant->id,
            'email' => $email,
            'nama' => $name,
            'role' => 'admin',
            'status' => 'active',
            'must_change_password' => false,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    } else {
        $profile->fill([
            'tenant_id' => (string) $tenant->id,
            'email' => $email,
            'nama' => $name,
            'role' => 'admin',
            'status' => 'active',
            'must_change_password' => false,
            'updated_at' => $now,
        ])->save();
    }

    if (! DB::table('admin_users')->where('id', $user->id)->exists()) {
        DB::table('admin_users')->insert([
            'id' => (string) $user->id,
            'tenant_id' => (string) $tenant->id,
            'created_at' => $now,
        ]);
    } else {
        DB::table('admin_users')
            ->where('id', $user->id)
            ->update(['tenant_id' => (string) $tenant->id]);
    }

    if (! DB::table('super_admins')->where('user_id', $user->id)->exists()) {
        DB::table('super_admins')->insert([
            'id' => (string) Str::uuid(),
            'user_id' => (string) $user->id,
            'email' => $email,
            'name' => $name,
            'created_at' => $now,
        ]);
    } else {
        DB::table('super_admins')
            ->where('user_id', $user->id)
            ->update([
                'email' => $email,
                'name' => $name,
            ]);
    }

    if (Schema::hasTable('settings') && Schema::hasColumn('settings', 'approval_primary_admin_id')) {
        $settings = DB::table('settings')->where('tenant_id', $tenant->id)->orderBy('id')->first(['id']);
        if ($settings) {
            DB::table('settings')
                ->where('id', $settings->id)
                ->update([
                    'approval_primary_admin_id' => (string) $user->id,
                    'updated_at' => $now,
                ]);
        }
    }
});

out('Super admin berhasil dibuat.');
out("Tenant: {$tenant->slug}");
out("Email: {$email}");
out("Password: {$password}");
