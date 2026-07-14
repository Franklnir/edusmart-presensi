# API V2 Students

Status kontrak: **Phase 3 ready**, terbatas pada resource siswa. Semua endpoint
memakai Sanctum, tenant resolver, pemeriksaan tenant profil, dan throttle `api`.

| Method | Endpoint | Akses |
|---|---|---|
| GET | `/api/v2/students` | Admin tenant; guru hanya kelas yang diampu |
| POST | `/api/v2/students` | Admin tenant |
| GET | `/api/v2/students/{student}` | Admin; guru kelas yang diampu |
| PUT/PATCH | `/api/v2/students/{student}` | Admin tenant |
| PATCH | `/api/v2/students/{student}/deactivate` | Admin tenant |
| PATCH | `/api/v2/students/{student}/activate` | Admin tenant |

List menerima `page`, `per_page` (maksimum 100), `search`, `kelas`, `status`,
dan filter periode yang didukung request. Response list meminimalkan field;
email, NIS, gender, usia, dan alasan nonaktif hanya tersedia pada detail yang
terotorisasi.

Create menerima identitas siswa, kelas, dan password opsional yang kuat.
`tenant_id`, `role`, status lifecycle, dan identitas actor dari payload tidak
dipercaya. Email unik global dan NIS unik per tenant. Update generik tidak boleh
mengubah tenant, role, atau lifecycle; gunakan endpoint activate/deactivate.

Semua mutasi wajib mengirim `Idempotency-Key`. Header adalah sumber utama;
`idempotency_key` pada body hanya kompatibilitas sementara. Error domain utama:
`IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_CONFLICT`, validasi `422`, policy
`403`, dan resource tenant lain `404`.

Frontend dapat diaktifkan melalui flag Student API V2 yang ada. Consumer legacy
`/api/db` belum dihapus pada fase ini dan tetap menjadi fallback selama cutover.
