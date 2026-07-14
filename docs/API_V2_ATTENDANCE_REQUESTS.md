# API V2 Attendance Requests

Endpoint pengajuan izin memakai Sanctum, tenant middleware, dan throttle `api`.

| Method | Endpoint | Akses |
|---|---|---|
| GET | `/api/v2/attendance-requests` | Siswa miliknya; guru scope kelas/mapel; admin tenant |
| POST | `/api/v2/attendance-requests` | Siswa |
| PATCH | `/api/v2/attendance-requests/{id}` | Guru berwenang atau admin |
| DELETE | `/api/v2/attendance-requests/{id}` | Siswa pemilik, hanya saat pending |

Create menerima tanggal, mapel, alasan, dan metadata periode. `uid`, nama,
kelas, tenant, dan actor diturunkan dari profil terautentikasi. Server menolak
pending request duplikat. Keputusan memakai `action=izin|sakit|tolak` dengan
transisi final berikut:

```text
pending -> terima
pending -> sakit
pending -> tolak
```

Decision berjalan dalam satu transaksi dan row lock: status request, satu record
presensi, serta audit log berubah atomik. Status final tidak dapat diproses
ulang atau kembali ke pending. Semua mutasi memerlukan `Idempotency-Key`.

Error utama: `ATTENDANCE_REQUEST_NOT_PENDING`, duplicate pending request,
`IDEMPOTENCY_CONFLICT`, policy 403, tenant lain 404, dan validasi 422. Consumer
legacy tetap tersedia selama feature flag frontend belum dinyalakan penuh.
