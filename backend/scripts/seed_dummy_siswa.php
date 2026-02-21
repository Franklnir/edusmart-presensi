<?php

$pdo = new PDO('sqlite:'.__DIR__.'/../database/database.sqlite');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('PRAGMA foreign_keys = ON');

$kelasRows = $pdo->query('select id from kelas')->fetchAll(PDO::FETCH_COLUMN);
$kelasList = $kelasRows ?: [];

$existingNisRows = $pdo->query("select nis from profiles where role='siswa' and nis is not null")->fetchAll(PDO::FETCH_COLUMN);
$existingNis = array_flip(array_filter($existingNisRows, function ($v) {
    return $v !== null && $v !== '';
}));
$maxNis = 0;
foreach (array_keys($existingNis) as $nis) {
    if (ctype_digit((string) $nis)) {
        $maxNis = max($maxNis, (int) $nis);
    }
}
$base = max(2600001, $maxNis + 1);

$currentDummy = (int) $pdo->query("select count(*) from profiles where role='siswa' and email like '%@dummy.local'")->fetchColumn();
$targetDummy = 150;
$toCreate = max(0, $targetDummy - $currentDummy);

if ($toCreate === 0) {
    echo "Dummy siswa sudah ada $currentDummy. Tidak menambah data.\n";
    exit;
}

$firstNames = ['Alya', 'Bima', 'Citra', 'Dika', 'Eka', 'Fajar', 'Gita', 'Hana', 'Intan', 'Joko', 'Kiki', 'Laras', 'Miko', 'Nadia', 'Oki', 'Putri', 'Raka', 'Salsa', 'Tia', 'Umar', 'Vina', 'Wawan', 'Yani', 'Zaki'];
$lastNames = ['Pratama', 'Saputra', 'Sari', 'Wijaya', 'Utami', 'Putra', 'Wibowo', 'Permata', 'Nugroho', 'Santoso', 'Lestari', 'Rahman', 'Hidayat', 'Ananda', 'Kurnia', 'Maulana'];
$agamaList = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu'];
$street = ['Mawar', 'Melati', 'Kenanga', 'Anggrek', 'Cempaka', 'Flamboyan', 'Dahlia', 'Teratai', 'Kamboja', 'Cendana'];
$district = ['Sukamaju', 'Sukasari', 'Mekarjaya', 'Ciputat', 'Ciledug', 'Cimahi', 'Cikarang', 'Cibinong', 'Cibiru', 'Cibitung'];

function uuidv4()
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0F) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3F) | 0x80);

    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function randomDate($startYear, $endYear)
{
    $year = rand($startYear, $endYear);
    $month = rand(1, 12);
    $day = rand(1, 28);

    return sprintf('%04d-%02d-%02d', $year, $month, $day);
}

$insertUser = $pdo->prepare('insert into users (id, name, email, password, created_at, updated_at) values (?,?,?,?,?,?)');
$insertProfile = $pdo->prepare('insert into profiles (id, email, nama, role, kelas, jk, usia, telp, created_at, nis, agama, jabatan, alamat, status, alasan_nonaktif, disabled_at, tanggal_lahir, updated_at, rfid_uid, kelas_change_used, no_hp_siswa, no_hp_wali, deleted_at, photo_path, photo_updated_at, must_change_password) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');

$now = (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d H:i:s');
$created = 0;
$nis = $base;
$passwordHash = password_hash('123456', PASSWORD_BCRYPT);

while ($created < $toCreate) {
    $nisStr = (string) $nis;
    if (isset($existingNis[$nisStr])) {
        $nis++;

        continue;
    }

    $first = $firstNames[array_rand($firstNames)];
    $last = $lastNames[array_rand($lastNames)];
    $nama = $first.' '.$last;
    $jk = rand(0, 1) ? 'L' : 'P';
    $tanggal = randomDate(2008, 2012);
    $usia = (int) date('Y') - (int) substr($tanggal, 0, 4);
    $agama = $agamaList[array_rand($agamaList)];
    $alamat = 'Jl. '.$street[array_rand($street)].' No. '.rand(1, 200).', '.$district[array_rand($district)];
    $kelas = $kelasList ? $kelasList[array_rand($kelasList)] : '';
    $telp = '08'.rand(1000000000, 9999999999);
    $noHpSiswa = '08'.rand(1000000000, 9999999999);
    $noHpWali = '08'.rand(1000000000, 9999999999);
    $email = 'siswa'.$nisStr.'@dummy.local';

    $id = uuidv4();

    $pdo->beginTransaction();
    try {
        $insertUser->execute([$id, $nama, $email, $passwordHash, $now, $now]);
        $insertProfile->execute([
            $id,
            $email,
            $nama,
            'siswa',
            $kelas,
            $jk,
            $usia,
            $telp,
            $now,
            $nisStr,
            $agama,
            null,
            $alamat,
            'active',
            null,
            null,
            $tanggal,
            $now,
            null,
            0,
            $noHpSiswa,
            $noHpWali,
            null,
            null,
            null,
            0,
        ]);
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }

    $existingNis[$nisStr] = true;
    $created++;
    $nis++;
}

echo "Inserted $created dummy siswa. Total dummy sekarang: ".($currentDummy + $created).PHP_EOL;
