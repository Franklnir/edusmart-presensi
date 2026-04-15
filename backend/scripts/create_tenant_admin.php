<?php

declare(strict_types=1);

use App\Models\Profile;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

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

$tenantSlug = strtolower(trim((string) ($argv[1] ?? '')));
$email = strtolower(trim((string) ($argv[2] ?? '')));
$password = (string) ($argv[3] ?? '');
$name = trim((string) ($argv[4] ?? 'Admin Sekolah'));
$tenantName = trim((string) ($argv[5] ?? 'Sekolah Demo'));

if ($tenantSlug === '' || $email === '') {
    fail('Usage: php scripts/create_tenant_admin.php <tenant_slug> <email> <password> [name] [tenant_name]');
}

if ($password === '') {
    $password = 'Admin@12345';
}

$reserved = array_map('strtolower', config('tenancy.reserved_subdomains', []));
if (in_array($tenantSlug, $reserved, true)) {
    fail("Slug tenant '{$tenantSlug}' termasuk reserved.");
}

$now = now();

DB::transaction(function () use ($tenantSlug, $tenantName, $email, $password, $name, $now): void {
    $tenant = DB::table('tenants')
        ->where('slug', $tenantSlug)
        ->first(['id', 'name', 'slug']);

    if (! $tenant) {
        $tenantId = (string) Str::uuid();
        DB::table('tenants')->insert([
            'id' => $tenantId,
            'name' => $tenantName,
            'slug' => $tenantSlug,
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $tenant = (object) [
            'id' => $tenantId,
            'name' => $tenantName,
            'slug' => $tenantSlug,
        ];
    }

    $settings = DB::table('settings')
        ->where('tenant_id', $tenant->id)
        ->orderBy('id')
        ->first(['id']);

    if (! $settings) {
        DB::table('settings')->insert([
            'tenant_id' => (string) $tenant->id,
            'nama_sekolah' => $tenant->name,
            'email' => $email,
            'registrasi_siswa_aktif' => true,
            'registrasi_guru_aktif' => true,
            'registrasi_admin_aktif' => false,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $settings = DB::table('settings')
            ->where('tenant_id', $tenant->id)
            ->orderBy('id')
            ->first(['id']);
    }

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
        if (DB::table('super_admins')->where('user_id', $user->id)->exists()) {
            throw new RuntimeException('Email ini sudah dipakai super admin. Gunakan email lain untuk admin sekolah.');
        }

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

    if ($settings && Schema::hasColumn('settings', 'approval_primary_admin_id')) {
        DB::table('settings')
            ->where('id', $settings->id)
            ->update([
                'approval_primary_admin_id' => (string) $user->id,
                'updated_at' => $now,
            ]);
    }
});

out('Admin tenant berhasil dibuat.');
out("Tenant: {$tenantSlug}");
out("Email: {$email}");
out("Password: {$password}");
