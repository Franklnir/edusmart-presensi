# API V2 Attendance

Status kontrak: **Phase 3 ready untuk pencatatan guru/admin dan koreksi**, bukan
untuk hard-delete atau absen mandiri siswa.

| Method | Endpoint | Aturan |
|---|---|---|
| GET | `/api/v2/attendance` | Tenant scoped; siswa miliknya, guru kelas/mapel yang diampu |
| POST | `/api/v2/attendance` | Guru berwenang atau admin |
| GET | `/api/v2/attendance/{attendance}` | Policy tenant/ownership |
| PUT/PATCH | `/api/v2/attendance/{attendance}` | Guru berwenang atau admin |

Request create memuat `uid`, `kelas`, `mapel`, `tanggal`, dan status
`Hadir|Izin|Sakit|Alpha`. Server memverifikasi bahwa `uid` adalah siswa tenant
aktif dan bahwa kelas profil cocok. Tenant dan actor selalu berasal dari auth.
Guru wajib mengampu kombinasi kelas/mapel. Mutasi memakai transaksi, row lock,
audit log, dan `Idempotency-Key`; pengecekan duplikat record bukan hanya cache.

Tidak ada route `DELETE /api/v2/attendance/{id}`. Koreksi dilakukan dengan
PATCH agar histori akademik tidak hilang. Frontend guru menolak hard-delete saat
flag V2 aktif. Absen QR tetap memakai endpoint khusus legacy yang sudah ada;
absen mandiri siswa belum dipindahkan ke resource ini.

Error utama: `ATTENDANCE_ALREADY_EXISTS` (409), scope/policy (403), tenant lain
(404), idempotency (409/422), dan validasi (422). Legacy attendance masih aktif
sebagai fallback sampai semua consumer diverifikasi.
