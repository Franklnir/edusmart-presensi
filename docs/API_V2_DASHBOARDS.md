# API V2 Dashboards

Status kontrak: **admin dashboard implemented**. Dashboard guru dan siswa
masih berada pada backlog domain mereka; endpoint ini tidak menggantikan CRUD
pengumuman, ekstrakurikuler, atau katalog guru.

| Method | Endpoint | Akses |
|---|---|---|
| GET | `/api/v2/dashboard/admin` | Admin sekolah pada tenant aktif |

## `GET /api/v2/dashboard/admin`

Parameter query yang didukung:

| Parameter | Aturan | Makna |
|---|---|---|
| `tahun_ajaran` | opsional, `YYYY/YYYY` atau `YYYY-YYYY` | Memilih ringkasan tahun ajaran; bentuk tanda hubung dinormalisasi ke garis miring. |

Tenant selalu ditentukan oleh middleware host/domain. `tenant_id`, actor, role,
dan batas daftar tidak diterima dari browser.

Response hanya berisi:

- `settings`: konteks akademik minimum untuk halaman admin;
- `academic_period`: tahun dan semester yang dipakai ringkasan;
- `summary`: angka siswa, guru, admin, kelas, absensi, pengumuman, dan ekskul;
- `announcements`: maksimal 20 pengumuman terbaru;
- `generated_at`, `cache_status`, dan `request_id`.

Daftar guru tidak dikirim melalui endpoint dashboard. Halaman admin membaca
resource `/api/v2/teachers` secara paginasi untuk pilihan pembina, sehingga
payload dashboard tidak tumbuh bersama jumlah guru.

Status utama: `401` belum login, `403` bukan admin tenant, `422` format tahun
ajaran tidak valid, dan `200` berhasil. Tidak ada fallback ke `/api/db` pada
consumer dashboard V2 ini.

## OpenAPI Fragment

Kontrak machine-readable berada di
[`openapi/api-v2-dashboard-admin.yaml`](openapi/api-v2-dashboard-admin.yaml).
