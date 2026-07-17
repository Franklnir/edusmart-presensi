<?php

use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('absensi.{kelas}.{tanggal}.{mapel}', function ($user, $kelas, $tanggal, $mapel) {
    return $user !== null;
});

Broadcast::channel('absensi-ajuan.{kelas}.{tanggal}.{mapel}', function ($user, $kelas, $tanggal, $mapel) {
    return $user !== null;
});

Broadcast::channel('jadwal.{guruId}', function ($user, $guruId) {
    return $user !== null;
});

Broadcast::channel('jam-kosong.{teacherId}', function ($user, $teacherId) {
    return $user !== null;
});

Broadcast::channel('tugas.{userId}', function ($user, $userId) {
    return $user !== null;
});

Broadcast::channel('tugas-guru.{userId}', function ($user, $userId) {
    return $user !== null;
});

Broadcast::channel('rfid.{kelas}', function ($user, $kelas) {
    return $user !== null;
});

Broadcast::channel('settings.{tenantId}', function ($user, $tenantId) {
    return $user !== null;
});

Broadcast::channel('profile.{userId}', function ($user, $userId) {
    return $user !== null;
});
