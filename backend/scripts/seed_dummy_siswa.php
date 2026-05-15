<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

require __DIR__.'/../vendor/autoload.php';

$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

function fail(string $message, int $code = 1): never
{
    fwrite(STDERR, $message.PHP_EOL);
    exit($code);
}

function randomDate(int $startYear, int $endYear): string
{
    $year = random_int($startYear, $endYear);
    $month = random_int(1, 12);
    $day = random_int(1, 28);

    return sprintf('%04d-%02d-%02d', $year, $month, $day);
}

function profilePayload(array $data): array
{
    return array_filter(
        $data,
        static fn (string $column): bool => Schema::hasColumn('profiles', $column),
        ARRAY_FILTER_USE_KEY
    );
}

$tenantSlug = strtolower(trim((string) ($argv[1] ?? config('tenancy.default_slug', 'default'))));
$tenant = DB::table('tenants')->where('slug', $tenantSlug)->first(['id', 'slug']);
if (! $tenant) {
    fail("Tenant '{$tenantSlug}' tidak ditemukan. Jalankan migrasi dan bootstrap tenant terlebih dahulu.");
}

$classQuery = DB::table('kelas')->select('id');
if (Schema::hasColumn('kelas', 'tenant_id')) {
    $classQuery->where('tenant_id', $tenant->id);
}
$kelasList = $classQuery->pluck('id')->filter()->values()->all();

$profileQuery = DB::table('profiles')
    ->where('role', 'siswa')
    ->whereNotNull('nis');
if (Schema::hasColumn('profiles', 'tenant_id')) {
    $profileQuery->where('tenant_id', $tenant->id);
}
$existingNis = array_flip($profileQuery->pluck('nis')->filter()->map(fn ($value) => (string) $value)->all());

$maxNis = 0;
foreach (array_keys($existingNis) as $nis) {
    if (ctype_digit((string) $nis)) {
        $maxNis = max($maxNis, (int) $nis);
    }
}
$base = max(2600001, $maxNis + 1);

$dummyQuery = DB::table('profiles')
    ->where('role', 'siswa')
    ->where('email', 'like', '%@dummy.local');
if (Schema::hasColumn('profiles', 'tenant_id')) {
    $dummyQuery->where('tenant_id', $tenant->id);
}
$currentDummy = (int) $dummyQuery->count();
$targetDummy = 150;
$toCreate = max(0, $targetDummy - $currentDummy);

if ($toCreate === 0) {
    echo "Dummy siswa sudah ada {$currentDummy}. Tidak menambah data.".PHP_EOL;
    exit;
}

$firstNames = ['Alya', 'Bima', 'Citra', 'Dika', 'Eka', 'Fajar', 'Gita', 'Hana', 'Intan', 'Joko', 'Kiki', 'Laras', 'Miko', 'Nadia', 'Oki', 'Putri', 'Raka', 'Salsa', 'Tia', 'Umar', 'Vina', 'Wawan', 'Yani', 'Zaki'];
$lastNames = ['Pratama', 'Saputra', 'Sari', 'Wijaya', 'Utami', 'Putra', 'Wibowo', 'Permata', 'Nugroho', 'Santoso', 'Lestari', 'Rahman', 'Hidayat', 'Ananda', 'Kurnia', 'Maulana'];
$agamaList = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];
$street = ['Mawar', 'Melati', 'Kenanga', 'Anggrek', 'Cempaka', 'Flamboyan', 'Dahlia', 'Teratai', 'Kamboja', 'Cendana'];
$district = ['Sukamaju', 'Sukasari', 'Mekarjaya', 'Ciputat', 'Ciledug', 'Cimahi', 'Cikarang', 'Cibinong', 'Cibiru', 'Cibitung'];

$now = now();
$created = 0;
$nis = $base;
$passwordHash = Hash::make('123456');

while ($created < $toCreate) {
    $nisStr = (string) $nis;
    if (isset($existingNis[$nisStr])) {
        $nis++;

        continue;
    }

    $first = $firstNames[array_rand($firstNames)];
    $last = $lastNames[array_rand($lastNames)];
    $name = $first.' '.$last;
    $birthDate = randomDate(2008, 2012);
    $email = 'siswa'.$nisStr.'@dummy.local';
    $userId = (string) Str::uuid();

    DB::transaction(function () use ($userId, $name, $email, $passwordHash, $now, $tenant, $kelasList, $nisStr, $agamaList, $street, $district, $birthDate): void {
        DB::table('users')->insert([
            'id' => $userId,
            'name' => $name,
            'email' => $email,
            'email_verified_at' => $now,
            'password' => $passwordHash,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('profiles')->insert(profilePayload([
            'id' => $userId,
            'tenant_id' => (string) $tenant->id,
            'email' => $email,
            'nama' => $name,
            'role' => 'siswa',
            'kelas' => $kelasList ? $kelasList[array_rand($kelasList)] : null,
            'jk' => random_int(0, 1) ? 'L' : 'P',
            'usia' => (int) date('Y') - (int) substr($birthDate, 0, 4),
            'telp' => '08'.random_int(1000000000, 9999999999),
            'created_at' => $now,
            'nis' => $nisStr,
            'agama' => $agamaList[array_rand($agamaList)],
            'jabatan' => null,
            'alamat' => 'Jl. '.$street[array_rand($street)].' No. '.random_int(1, 200).', '.$district[array_rand($district)],
            'status' => 'active',
            'alasan_nonaktif' => null,
            'disabled_at' => null,
            'tanggal_lahir' => $birthDate,
            'updated_at' => $now,
            'rfid_uid' => null,
            'kelas_change_used' => false,
            'no_hp_siswa' => '08'.random_int(1000000000, 9999999999),
            'no_hp_wali' => '08'.random_int(1000000000, 9999999999),
            'deleted_at' => null,
            'photo_path' => null,
            'photo_updated_at' => null,
            'must_change_password' => false,
        ]));
    });

    $existingNis[$nisStr] = true;
    $created++;
    $nis++;
}

echo "Inserted {$created} dummy siswa untuk tenant {$tenantSlug}. Total dummy sekarang: ".($currentDummy + $created).PHP_EOL;
