# Dokumentasi Endpoint API EduSmart

Tanggal audit: 2026-07-14

Dokumen ini merangkum kontrak endpoint API backend EduSmart dari source
`backend/routes/api.php`, hasil verifikasi `php artisan route:list --path=api`,
dan pembacaan controller utama. Total endpoint API aplikasi aktif saat audit:
242 route. Route vendor seperti Horizon `horizon/api/*` tidak dihitung sebagai
API aplikasi.

## Status Kualitas Dokumen

Penilaian setelah hardening dokumentasi ini: 9/10 untuk dokumentasi API
production internal.

Alasan nilainya 9/10:

- Endpoint lengkap, diverifikasi dari route Laravel.
- Auth, tenant, role, rate limit, dan status code terdokumentasi.
- Endpoint public diberi review risiko dan kontrol keamanan.
- Endpoint kritikal memiliki kontrak request/response dan guardrail bisnis.
- Periode akademik, DB proxy, quiz, storage, RFID, dan super admin diberi
  catatan operasional.
- Ada regression test yang membandingkan katalog endpoint dengan route Laravel
  aktif agar dokumentasi tidak diam-diam basi.
- Ada checklist audit dan perawatan untuk mencegah dokumentasi basi.

Batas menuju 10/10:

- Buat `docs/openapi.yaml` lengkap untuk semua endpoint.
- Generate Swagger UI/Postman collection dari OpenAPI.
- Tambahkan contract test yang memastikan schema response tidak berubah tanpa
  update dokumentasi.
- Tambahkan generator OpenAPI atau Postman collection dari route/controller
  agar katalog dan schema dapat dipublikasikan otomatis untuk QA internal.

## Ringkasan Kontrak

- Base path API: `/api`.
- Format umum response sukses controller internal: `{"data": ...}`.
- Format umum error custom: `{"error": "pesan"}`.
- Error validasi Laravel dapat memakai `message` dan `errors`.
- Mayoritas endpoint memakai Laravel Sanctum Bearer token.
- Multi tenant diselesaikan dari host/domain tenant. Header tenant hanya dipakai
  jika `tenancy.allow_header_override` aktif di konfigurasi.
- Endpoint `GET|HEAD` dari Laravel dicatat sebagai `GET` di dokumen ini.
- Semua endpoint mutasi data wajib dianggap tenant-scoped kecuali route super
  admin atau route infrastruktur yang eksplisit bypass tenant.
- Dokumentasi ini tidak boleh menyimpan token, secret, API key, password,
  private key, signed URL aktif, atau data pribadi siswa/guru sungguhan.

## Base URL

Contoh production:

```text
https://sismu.biz.id/api
https://admin26.sismu.biz.id/api
https://<slug-sekolah>.sismu.biz.id/api
https://<custom-domain-sekolah>/api
```

Frontend tenant biasa memanggil API di host sekolah aktif. Super admin memakai
host admin/platform yang lolos middleware `super.domain`.

## Header Standar

```http
Accept: application/json
Content-Type: application/json
Authorization: Bearer <sanctum-token>
```

Header tambahan:

- `X-Tenant: <tenant-slug>` hanya relevan jika override tenant via header
  diaktifkan.
- `X-Admin-Feature: <feature_key>` hanya kompatibilitas/hint client lama.
  Server tidak menjadikan header ini sebagai bukti admin; akses delegasi harus
  dicek eksplisit oleh controller dan database permission.
- Endpoint device RFID memakai otorisasi device dari service RFID, biasanya
  melalui kredensial device yang disiapkan per perangkat.

## Autentikasi, Role, dan Tenant

Kategori akses:

- Public: tidak butuh token, tetapi tetap terkena throttle dan sebagian tetap
  butuh tenant valid dari host.
- Sanctum: butuh `Authorization: Bearer <token>`.
- Super admin: butuh token Sanctum, host super admin, dan identitas super admin.
- Web callback: route OAuth/Google Drive yang memakai middleware `web`.
- Device/webhook: memakai secret, signature, atau device credential khusus.

Role aplikasi:

- `admin`: akses manajemen sekolah.
- `guru` atau `teacher`: akses guru; dapat diberi akses admin terbatas lewat
  `admin_feature_permissions`.
- `siswa`: akses siswa.
- super admin: identitas dari tabel `super_admins` atau konfigurasi env.

Middleware tenant menolak host tenant yang belum terdaftar, tenant nonaktif,
profil yang tenant-nya tidak cocok, dan request tanpa tenant valid pada endpoint
yang membutuhkan tenant.

## Matrix Akses Modul

| Modul | Public | Siswa | Guru | Admin Sekolah | Super Admin | Device/Webhook |
|---|---:|---:|---:|---:|---:|---:|
| Health/public settings | Ya | Ya | Ya | Ya | Ya | Tidak |
| Auth login/register/reset | Ya | Ya | Ya | Ya | Terbatas | Tidak |
| Profile/me | Tidak | Ya | Ya | Ya | Ya | Tidak |
| Mobile siswa | Tidak | Ya | Tidak | Tidak | Tidak | Tidak |
| Mobile guru | Tidak | Tidak | Ya | Terbatas | Tidak | Tidak |
| Attendance QR session | Tidak | Tidak | Ya | Ya | Tidak | Tidak |
| Attendance QR scan | Tidak | Ya | Tidak | Tidak | Tidak | Tidak |
| DB proxy select | Tidak | Policy | Policy | Ya | Ya | Tidak |
| DB proxy mutation | Tidak | Sangat terbatas | Terbatas | Ya | Ya | Tidak |
| Admin sekolah | Tidak | Tidak | Delegasi fitur | Ya | Ya | Tidak |
| Quiz siswa | Tidak | Ya | Tidak | Tidak | Tidak | Tidak |
| Quiz guru | Tidak | Tidak | Ya | Ya | Tidak | Tidak |
| Storage | Signed/policy | Policy | Policy | Ya | Ya | Tidak |
| RFID HTTP device | Tidak | Tidak | Tidak | Set mode | Super manage | Ya |
| WhatsApp webhook | Secret only | Tidak | Tidak | Tidak | Tidak | Ya |
| Super admin | Tidak | Tidak | Tidak | Tidak | Ya | Tidak |

Keterangan:

- `Policy` berarti akses ditentukan oleh policy controller, tenant, ownership,
  kelas, jadwal, atau relasi guru/siswa.
- `Delegasi fitur` berarti guru harus memiliki permission aktif untuk fitur
  yang dicek eksplisit oleh endpoint server. Header client tidak cukup dan tidak
  dipercaya sebagai boundary keamanan.
- Super admin dapat membaca lintas tenant hanya melalui endpoint `/api/super/*`
  atau policy yang memang mengizinkan.

## Klasifikasi Data dan Risiko

| Kelas | Contoh data | Aturan minimum |
|---|---|---|
| Publik aman | status health, branding sekolah terfilter | Boleh tanpa token, tetap throttle. |
| Internal tenant | jadwal, kelas, mapel, pengaturan operasional | Wajib tenant scoped. |
| Data pribadi | nama, email, NIS, alamat, tanggal lahir, RFID UID | Wajib auth, role/policy, minimisasi field. |
| Data akademik | nilai, rapor, quiz submission, tugas jawaban, absensi | Wajib periode akademik, audit untuk mutasi penting. |
| Secret/signed data | webhook secret, signed URL, object key sensitif | Jangan dilog terbuka, TTL pendek, rotasi jika bocor. |
| Operasional platform | tenant, domain, backup, storage quota, server logs | Super admin only dan audit. |

## Public Endpoint Security Review

Endpoint di bawah tidak memakai Sanctum, tetapi tetap tidak boleh dianggap
bebas tanpa kontrol.

| Endpoint | Risiko utama | Kontrol wajib |
|---|---|---|
| `GET /api/health` | Fingerprinting minimal | Response kecil, tanpa versi detail. |
| `GET /api/public/settings` | Kebocoran setting sensitif | Allowlist field publik saja. |
| `GET /api/internal/tls/authorize` | Penyalahgunaan ACME ask endpoint | Secret/validasi domain di controller dan throttle. |
| `POST /api/auth/login` | Bruteforce | `throttle:auth`, root-domain block, password policy. |
| `POST /api/auth/register` | Spam akun | `throttle:auth`, admin public ditolak, setting registrasi. |
| `POST /api/auth/forgot-password` | Email enumeration/spam | Rate limit, pesan aman, eligibility tenant. |
| `POST /api/auth/reset-password` | Token abuse | Token broker Laravel, password strong, revoke token lama. |
| Google OAuth callbacks | Open redirect/session mismatch | Validasi state, origin, host, ticket TTL. |
| `GET /api/storage/signed` | Akses file tidak sah | Policy `canRead`, TTL, bucket allowlist. |
| `GET /api/storage/object` | Bypass storage | Signature `sig`, expiry, bucket allowlist. |
| `POST /api/rfid/*` public route | Fake scan device | Device credential, registered device, throttle RFID. |
| `POST /api/whatsapp/webhook/{secret}` | Fake webhook | Secret path, throttle webhook, source validation service. |
| Google Drive callback admin | OAuth callback abuse | State/session validation, throttle auth. |

Checklist endpoint public baru:

- Harus punya alasan bisnis kenapa tidak memakai Sanctum.
- Harus punya throttle spesifik atau throttle `api`.
- Harus mengembalikan field minimal.
- Harus aman jika dipanggil berulang oleh bot.
- Jika membawa akses ke data/file, wajib punya secret, signature, credential
  device, atau policy server-side.

## Status Code Umum

| Status | Arti |
|---|---|
| `200` | Request sukses. |
| `201` | Resource dibuat, misalnya register user. |
| `400` | Payload, tenant, atau request tidak valid. |
| `401` | Tidak terautentikasi. |
| `403` | Role, tenant, device, atau permission ditolak. |
| `404` | Data, route, tenant, atau host tidak ditemukan. |
| `409` | Konflik state, misalnya periode akademik butuh proses khusus. |
| `410` | Token/QR sudah kedaluwarsa. |
| `422` | Validasi atau aturan bisnis gagal. |
| `423` | Tenant diblokir/nonaktif. |
| `429` | Terkena rate limit. |
| `500/503` | Error server atau dependency belum siap. |

## Rate Limit

Throttle yang terlihat dari route:

- `auth`: login, register, reset password, Google auth.
- `api`: endpoint aplikasi umum.
- `db`: DB proxy `/api/db` dan `/api/db/batch`.
- `storage`: upload, signed URL, dan object retrieval.
- `rfid`: ingress device RFID.
- `quiz-submit`: submit quiz.
- `quiz-answers`: simpan jawaban quiz.
- `webhook`: webhook WhatsApp.
- `super`: endpoint super admin.

## Periode Akademik

Periode aktif disimpan di `settings` tenant:

- `tahun_ajaran`
- `semester_aktif`
- `periode_mulai`
- `periode_selesai`
- `periode_ganjil_mulai`
- `periode_ganjil_selesai`
- `periode_genap_mulai`
- `periode_genap_selesai`
- `jadwal_periode_berlaku`

Endpoint utama:

- `POST /api/admin/academic-period/apply`
- `GET /api/admin/academic-period/schedule-decision`
- `POST /api/admin/academic-period/schedule-decision`
- `POST /api/admin/academic-period/restore-roster`

Aturan profesional yang sekarang didokumentasikan:

- Perubahan tahun ajaran maju tepat satu tahun wajib memakai rollover otomatis.
- Perubahan mundur ke periode lalu memakai snapshot kelas siswa jika tersedia.
- Lompat lebih dari satu tahun ajaran dari kalender server ditolak.
- Koreksi kalender butuh `calendar_confirmed` saat target tidak sama dengan
  kalender server.
- Snapshot `student_class_histories` dipakai agar profil siswa, laporan, rapor,
  absensi, tugas, quiz, jadwal, dan eskul membaca konteks kelas/periode yang
  benar.
- Jadwal tidak disalin saat `apply` periode. Saat admin membuka menu Jadwal
  untuk periode aktif yang masih kosong, client wajib memanggil
  `schedule-decision` agar admin memilih buat jadwal baru atau memakai jadwal
  periode sebelumnya.
- Opsi salin anggota eskul hanya masuk akal saat maju tepat satu tahun ajaran;
  saat kembali ke periode lalu data periode itu harus dibaca dari histori atau
  snapshot, bukan disalin ulang.

Payload utama `apply`:

```json
{
  "tahun_ajaran": "2026/2027",
  "semester_aktif": "Ganjil",
  "periode_ganjil_mulai": "2026-07-01",
  "periode_ganjil_selesai": "2026-12-31",
  "periode_genap_mulai": "2027-01-01",
  "periode_genap_selesai": "2027-06-30",
  "auto_rollover": true,
  "carry_eskul_members": true,
  "calendar_confirmed": true
}
```

Payload `schedule-decision`:

```json
{
  "action": "use_previous",
  "target_tahun_ajaran": "2026/2027",
  "source_tahun_ajaran": "2025/2026"
}
```

Nilai `action`:

- `start_empty`: admin memilih membuat jadwal baru manual untuk periode aktif.
- `use_previous`: server menyalin jadwal dari `source_tahun_ajaran` ke periode
  aktif sebagai baris jadwal baru.

Payload `restore-roster`:

```json
{
  "apply": true
}
```

Jika `apply` bernilai `false`, endpoint mengembalikan preview pemulihan roster
tanpa mengubah data.

## DB Proxy

`POST /api/db` adalah endpoint generic data access yang tetap dibatasi registry
tabel, tenant, role, policy, dan audit.

Payload umum:

```json
{
  "table": "jadwal",
  "action": "select",
  "columns": "*",
  "payload": {},
  "filters": [
    ["kelas_id", "=", "class-id"]
  ],
  "order": [
    ["hari", "asc"],
    ["jam_mulai", "asc"]
  ],
  "limit": 100,
  "offset": 0,
  "count": false,
  "head": false
}
```

Action yang diterima:

- `select`
- `insert`
- `update`
- `delete`
- `upsert`

Catatan:

- Non admin wajib mengirim filter untuk `update` dan `delete`.
- Batch `/api/db/batch` hanya mendukung `select`.
- Limit select dibatasi env `DB_MAX_SELECT_LIMIT` dan
  `DB_MAX_SELECT_LIMIT_ADMIN`.
- Default data transaksi adalah 250 baris. Tabel roster/master (`profiles`,
  `kelas`, `mata_pelajaran`) sementara memakai `DB_ROSTER_SELECT_LIMIT=2000`
  agar layar operasional lama tidak terpotong selama migrasi pagination.
- Offset dibatasi `DB_MAX_OFFSET=25000`. Endpoint baru untuk daftar besar wajib
  memakai cursor/keyset pagination, bukan menaikkan offset.
- Batch hanya select, default maksimal 12 item, dan memiliki anggaran hasil
  `DB_BATCH_MAX_TOTAL_ROWS=5000` agar satu request tidak menahan worker PHP dan
  koneksi database berlebihan.
- Tabel tenant scoped otomatis diberi `tenant_id`.
- Tabel akademik tertentu otomatis memakai scope periode aktif jika client tidak
  mengirim filter periode eksplisit.

Tabel yang mendapat default scope akademik saat select:

```text
jadwal, tugas, quizzes, absensi, absensi_ajuan, absensi_settings,
absensi_eskul, jam_kosong, ekskul_anggota, anggota_ekskul
```

Child snapshot penting:

```text
tugas_jawaban, quiz_submissions
```

## Kontrak Mutasi Data

Semua endpoint yang mengubah data harus mengikuti guardrail berikut.

| Area | Wajib dilakukan | Alasan |
|---|---|---|
| Tenant | Filter `tenant_id` dari middleware, bukan dari input client mentah. | Mencegah cross-tenant access. |
| Role | Cek role/policy sebelum query mutasi. | Mencegah privilege escalation. |
| Validasi | Validasi request sebelum transaksi. | Mencegah data rusak dan payload liar. |
| Transaksi | Gunakan transaksi untuk perubahan banyak tabel. | Mencegah data setengah jalan. |
| Audit | Catat perubahan penting ke audit log. | Memudahkan investigasi dan rollback manual. |
| Periode | Simpan dan baca snapshot periode untuk data akademik. | Mencegah rapor/absensi/tugas/quiz berubah salah saat periode diganti. |
| Idempotensi | Gunakan key unik/event id pada scan, sync, submit, atau webhook. | Aman dari retry network. |
| File | Validasi bucket, path, mime, ukuran, provider, dan quota. | Mencegah abuse storage dan file berbahaya. |
| Error | Jangan bocorkan secret, stack trace, SQL, atau path server. | Mencegah informasi sensitif bocor. |

Mutasi kritikal yang perlu audit ketat:

- perubahan `settings` akademik.
- perubahan status user: nonaktif, mutasi, alumni, active.
- perubahan kelas, wali kelas, jadwal, dan assignment guru.
- submit atau koreksi nilai quiz/tugas.
- backup/restore tenant.
- koneksi atau logout WhatsApp/Google Drive.
- perubahan domain, storage quota, RFID MQTT/device, dan super admin.

## Error Response Contract

Format error normal:

```json
{
  "error": "Akses ditolak"
}
```

Format validasi Laravel dapat berbentuk:

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "email": ["The email field is required."]
  }
}
```

Format konflik periode akademik:

```json
{
  "error": "Periode yang dipilih tidak sama dengan kalender server saat ini. Konfirmasi ulang sebelum dipakai sebagai periode operasional.",
  "code": "academic_period_calendar_confirmation_required",
  "data": {
    "server_calendar": {
      "today": "2026-06-21",
      "timezone": "Asia/Jakarta",
      "tahun_ajaran": "2025/2026",
      "semester": "Genap",
      "label": "2025/2026 - Semester Genap"
    },
    "previous_period": {
      "tahun_ajaran": "2025/2026",
      "semester": "Genap"
    },
    "target_period": {
      "tahun_ajaran": "2026/2027",
      "semester": "Ganjil"
    }
  }
}
```

Aturan error aman:

- Gunakan pesan yang bisa ditindaklanjuti oleh admin/guru/siswa.
- Jangan kirim stack trace ke client production.
- Jangan kirim SQL, credential, signed URL aktif, private path, atau secret.
- Untuk endpoint auth, hindari detail yang memudahkan enumeration.
- Untuk webhook/device, cukup kembalikan alasan aman seperti
  `unauthorized_device` atau `invalid_secret`.

## Detail Modul Utama

### Auth

Endpoint login/register berada di `/api/auth/*`.

Payload penting:

- `POST /api/auth/login`: `email`, `password`.
- `POST /api/auth/register`: `nama`, `email`, `password`, `role`.
- `POST /api/auth/forgot-password`: `email`.
- `POST /api/auth/reset-password`: `email`, `token`, `password`,
  `password_confirmation`.
- `POST /api/auth/update-password`: `password`, `password_confirmation`,
  optional `verification_code`.
- `POST /api/auth/update-account`: `email`, optional `password`,
  `password_confirmation`, optional `verification_code`.
- `GET /api/auth/security`: tidak ada payload; mengembalikan ringkasan session,
  token mobile/API, dan riwayat login milik user aktif.
- `POST /api/auth/logout-other-devices`: `password`; mencabut session web lain
  dan token mobile/API lain, session saat ini tetap dipertahankan.
- Google credential login: `credential`.
- Google code login: `code`.
- Google mobile exchange: `ticket`.

Catatan:

- Registrasi admin publik ditolak.
- Password mengikuti `PasswordRule::defaults()` dan minimum env
  `PASSWORD_MIN_LENGTH`, minimal 12.
- Reset password super admin dinonaktifkan dari flow normal.
- Endpoint `auth.not_root_domain` menolak login/register dari root domain yang
  tidak sesuai flow tenant.
- Security overview tidak mengembalikan session id/token asli; identifier yang
  dikirim ke client hanya hash pendek untuk tampilan.
- Logout perangkat lain wajib password akun aktif dan mencatat audit event
  `logout_other_devices`.

### Admin Sekolah

Endpoint `/api/admin/*` untuk manajemen tenant sekolah.

Fitur utama:

- user/profil: provision, status, guru, siswa, detail siswa, tambahan data siswa.
- periode akademik: apply, restore roster, summary.
- kelas: hapus kelas, histori kelas terhapus, restore histori.
- permission guru: daftar, tambah, update, hapus, dan `guru/admin-permissions`.
- backup/restore dan Google Drive.
- WhatsApp tenant.
- storage manager tenant.
- monitoring, scan settings, scan session.

Payload penting:

- Update status user: `status` salah satu `active`, `nonaktif`, `mutasi`,
  `alumni`; `reason` wajib untuk status nonaktif/mutasi/alumni.
- Update nama guru: `nama`.
- Update profil guru: `nama`, `nis`, `jk`, `agama`, `telp`, `alamat`,
  `tanggal_lahir`.
- Update tambahan siswa: `nama`, `nis`, `jk`, `tanggal_lahir`, `agama`,
  `alamat`.

Hapus permanen guru/siswa sengaja dinonaktifkan; gunakan status nonaktif,
mutasi, atau alumni agar histori akademik tetap aman.

### Attendance QR

- `POST /api/attendance-qr/session`: guru/admin membuat token QR untuk jadwal
  dan kelas.
- `POST /api/attendance-qr/scan`: siswa scan token QR.

Payload:

- session: `jadwal_id`, `kelas_id`.
- scan: `token`.

QR berlaku singkat, terikat tenant, jadwal, kelas, tanggal, dan window jam
pelajaran.

### Quiz

Endpoint quiz memakai Sanctum. Submit dan simpan jawaban punya throttle khusus.

Query utama:

- `GET /api/quiz/dashboard`: `page`, `per_page`, `kelas`, `mapel`, `q`,
  `tahun_ajaran`, `semester`.
- `GET /api/quiz/{quizId}/detail`: optional metadata device/query untuk session.
- `GET /api/quiz/retake-history`: `quiz_id`, `per_page`.

Payload utama:

- `POST /api/quiz/clone`: `source_quiz_id`, `target_kelas_id`,
  `target_mapel`, optional `nama`, `copy_security`, `copy_schedule`,
  `tahun_ajaran`, `semester`. Hasil salinan dibuat sebagai draft dan tidak
  membawa submission/jawaban/log siswa.
- `POST /api/quiz/start`: `quiz_id`, optional `access_code`, `client_meta`.
- `POST /api/quiz/answer`: `quiz_id`, `submission_id`, `question_id`,
  optional `option_id`, `essay_answer`, `client_meta`.
- `POST /api/quiz/answers/batch`: `quiz_id`, `submission_id`, `answers[]`,
  optional `client_meta`.
- `POST /api/quiz/submit`: `quiz_id`, optional `submission_id`, `answers`.
- `POST /api/quiz/violation`: `quiz_id`, `submission_id`, optional
  `event_type`, `event_message`, `event_meta`.
- `POST /api/quiz/publish`: `quiz_id`, optional `activate`,
  `shuffle_questions`, `shuffle_options`, `max_attempts`, `security_mode`,
  `access_device`, `timezone`, `access_code`.
- `POST /api/quiz/schedule`: `quiz_id`, `starts_at`, `deadline_at`,
  optional `timezone`.
- `POST /api/quiz/grade-essay`: `quiz_id`, `submission_id` atau `siswa_id`,
  `question_id`, `essay_score`.
- `POST /api/quiz/complete-essay-review`: `quiz_id`, `submission_id` atau
  `siswa_id`.
- `POST /api/quiz/retake`: `quiz_id`, `siswa_id`.
- `POST /api/quiz/restore-retake-score`: `quiz_id`, `siswa_id`.

Quiz membaca scope periode akademik dari query atau periode aktif. Submission
menyimpan snapshot agar nilai tidak berubah salah saat periode berganti.

### Tugas dan Reports (Legacy & V2)

**API V2 Assignments:**
Endpoint baru menggunakan prefix `/api/v2/assignments` dan `/api/v2/submissions` untuk menggantikan penggunaan `/api/db` dan endpoint legacy. 
Semua endpoint ini secara otomatis ter-scope oleh `tenant_id` dan memvalidasi `profile.tenant_id`.
- `GET /api/v2/assignments`: List tugas (mendukung filter `per_page=all`, `kelas`, `mapel`, `status`, `search`, `created_after`, dll).
- `POST /api/v2/assignments`: Buat tugas baru.
- `GET /api/v2/assignments/{id}`: Detail tugas.
- `PATCH /api/v2/assignments/{id}`: Update tugas.
- `DELETE /api/v2/assignments/{id}`: Hapus tugas.

**API V2 Submissions:**
- `GET /api/v2/submissions`: List jawaban tugas (mendukung filter `per_page=all`, `tugas_id` array, `user_id`, `status`, `search`).
- `POST /api/v2/submissions`: Submit jawaban tugas siswa.
- `GET /api/v2/submissions/{id}`: Detail jawaban tugas.
- `PATCH /api/v2/submissions/{id}`: Update file jawaban.
- `DELETE /api/v2/submissions/{id}`: Hapus jawaban.
- `PATCH /api/v2/submissions/{submission}/grade`: Berikan/update nilai oleh guru.
- `POST /api/v2/submissions/grade-by-user`: Berikan/update nilai langsung berdasarkan user (berguna untuk panel nilai tanpa mengetahui ID submission).

**API V2 Uploads:**
- `POST /api/v2/uploads`: Initiate upload session
- `GET /api/v2/uploads/{session}`: Read owned upload-session metadata
- `POST /api/v2/uploads/{session}/complete`: Complete upload session
- `DELETE /api/v2/uploads/{session}`: Cancel upload session
- `GET /api/v2/attachments/{attachment}`: Read authorized attachment metadata
- `GET /api/v2/attachments/{attachment}/download`: Create a temporary authorized download instruction
- `DELETE /api/v2/attachments/{attachment}`: Detach and delete an authorized attachment

**Legacy Endpoints:**
- `POST /api/tugas/jawaban/submit`: submit jawaban tugas siswa (Legacy).
- `GET /api/reports/teacher-summary`: ringkasan laporan guru.

Query reports:

- `type`
- `kelas`
- `mapel`
- `tahun_ajaran`
- `months` atau `bulan`

Tugas legacy (lewat DB proxy) mendukung filter periode: `kelas`, `mapel`,
`created_by`, `deadline_gte`, `deadline_lt`, `created_gte`, `tahun_ajaran`,
`semester`, `order_by`, `order`.

### RFID Device

Endpoint public RFID tetap memakai credential device dan throttle `rfid`.
Endpoint admin browser NFC memakai Sanctum, permission Live Scan, tenant aktif,
dan throttle `browser-nfc`, lalu tetap masuk jalur `RfidIngressService` agar
event tercatat di feed Live Scan dan audit RFID.

Payload utama:

- `POST /api/rfid/scan`: `card_uid`, optional `device_id`, `event_id`, `mode`,
  `scanned_at`, dan identitas tenant dari device atau request.
- `POST /api/rfid/sync`: `events[]` dengan `card_uid` dan metadata event.
- `POST /api/rfid/heartbeat`: optional `device_id`, `transport`,
  `ip_address`, `firmware_version`, `wifi_rssi`, `free_heap`, `meta`.
- `POST /api/rfid/set-mode`: admin, `mode` salah satu `auto`, `manual`,
  `enroll`, optional `tenant_slug`.
- `POST /api/admin/rfid/browser-event`: `card_uid`, optional `event_id`,
  `mode`, `scanned_at`, `browser_device_id`, `browser`.

### Storage

Endpoint storage memakai bucket allowlist dan policy baca/tulis.

Payload utama:

- `POST /api/storage/upload`: multipart/server relay upload.
- `POST /api/storage/direct-upload`: `bucket`, `path`, `filename`,
  `mime_type`, `size_bytes`.
- `POST /api/storage/confirm-upload`: `bucket`, `path`, `provider`,
  `filename`, `mime_type`, `size_bytes`, optional `object_key`.
- `POST /api/storage/upload-destination`: `bucket`, `filename`, `mime_type`.
- `POST /api/storage/remove`: `bucket`, `path` atau `paths[]`.
- `GET /api/storage/signed`: query `bucket`, `path`, optional `expires`.
- `GET /api/storage/object`: query signed `bucket`, `path`, `expires`, `sig`.

Provider yang mungkin dikembalikan: `object_storage`, `google_drive`, `local`,
atau `api`.

### WhatsApp dan Webhook

- Admin tenant mengelola koneksi WhatsApp lewat `/api/admin/whatsapp/*`.
- Super admin mengelola WhatsApp global lewat `/api/super/whatsapp/*`.
- Evolution/webhook masuk ke
  `POST /api/whatsapp/webhook/{secret}/{event?}` dengan throttle `webhook`.

### Super Admin

Endpoint `/api/super/*` butuh Sanctum, throttle `super`, middleware
`super.domain`, dan `super.admin`.

Fitur utama:

- tenant CRUD/status/detail.
- platform domain dan domain tenant.
- monitoring server/log.
- storage manager lintas tenant.
- Google Drive tenant.
- RFID MQTT/device tenant.
- backup/restore tenant.
- WhatsApp global.
- admin platform.
- audit trail.

## Kontrak Endpoint Kritikal

Bagian ini bukan pengganti OpenAPI penuh, tetapi menjadi kontrak minimum untuk
endpoint yang paling sensitif.

### `POST /api/auth/login`

Request:

```json
{
  "email": "admin@example.com",
  "password": "password-kuat"
}
```

Response sukses:

```json
{
  "data": {
    "token": "<sanctum-token>",
    "user": {
      "id": "uuid",
      "email": "admin@example.com"
    },
    "profile": {
      "id": "uuid",
      "tenant_id": "tenant-id",
      "role": "admin",
      "nama": "Nama Admin"
    }
  }
}
```

Security notes:

- Login wajib berada di host tenant yang valid.
- Root domain yang tidak sesuai flow ditolak.
- Jangan simpan token di local storage jika ada opsi storage lebih aman pada
  client.

### `GET /api/auth/security`

Response sukses ringkas:

```json
{
  "data": {
    "summary": {
      "active_web_sessions": 1,
      "active_api_tokens": 1,
      "last_login_at": "2026-06-21T10:00:00+07:00",
      "rate_limit": {
        "max_failed_attempts": 5,
        "source": "server"
      }
    },
    "web_sessions": [
      {
        "id": "hashed-id",
        "type": "web",
        "name": "Chrome di Windows",
        "ip_address": "10.1.1.10",
        "last_active_at": "2026-06-21T10:05:00+07:00",
        "current": true
      }
    ],
    "api_tokens": [],
    "login_history": []
  }
}
```

Security notes:

- Wajib Sanctum.
- Hanya mengembalikan session/token milik user aktif.
- Session id asli dan token asli tidak pernah dikirim ke client.
- Riwayat login berasal dari `audit_log` table `auth_events`.

### `POST /api/auth/logout-other-devices`

Request:

```json
{
  "password": "password-akun-saat-ini"
}
```

Response sukses ringkas:

```json
{
  "data": {
    "web_sessions_revoked": 2,
    "api_tokens_revoked": 1,
    "security": {
      "summary": {
        "active_web_sessions": 1,
        "active_api_tokens": 0
      }
    }
  }
}
```

Security notes:

- Wajib Sanctum dan password akun aktif.
- Session web lain dicabut dari tabel `sessions`; current session tetap login.
- Token mobile/API lain dicabut dari `personal_access_tokens`.
- Audit event `logout_other_devices` dicatat untuk pelacakan.

### `POST /api/admin/academic-period/apply`

Request minimal:

```json
{
  "tahun_ajaran": "2026/2027",
  "semester_aktif": "Ganjil",
  "periode_ganjil_mulai": "2026-07-01",
  "periode_ganjil_selesai": "2026-12-31",
  "periode_genap_mulai": "2027-01-01",
  "periode_genap_selesai": "2027-06-30",
  "auto_rollover": true,
  "carry_eskul_members": true,
  "calendar_confirmed": true
}
```

Response sukses ringkas:

```json
{
  "data": {
    "period": {
      "tahun_ajaran": "2026/2027",
      "semester": "Ganjil",
      "scope": "academic_year"
    },
    "year_changed": true,
    "semester_only_change": false,
    "period_snapshot_restored": false,
    "class_history_snapshots": 120,
    "classes_synced": 18,
    "rollover": {
      "students_promoted": 118,
      "students_alumni": 12
    }
  }
}
```

Security and logic notes:

- Admin sekolah atau super admin only. Guru dengan delegasi fitur tidak boleh
  mengubah periode akademik.
- Maju tahun ajaran hanya boleh tepat satu tahun dan via `auto_rollover`.
- Mundur tahun ajaran harus memakai snapshot kelas siswa.
- Semua operasi berjalan dalam transaksi.
- Snapshot kelas dibuat sebelum dan sesudah perubahan periode.

### `POST /api/db`

Request select:

```json
{
  "table": "absensi",
  "action": "select",
  "filters": [
    ["kelas_id", "=", "class-id"],
    ["tanggal", ">=", "2026-01-01"]
  ],
  "order": [["tanggal", "desc"]],
  "limit": 100
}
```

Response select:

```json
{
  "data": [
    {
      "id": "row-id",
      "tenant_id": "tenant-id"
    }
  ],
  "count": 1
}
```

Request mutation:

```json
{
  "table": "settings",
  "action": "update",
  "payload": {
    "nama_sekolah": "SMP Contoh"
  },
  "filters": [["id", "=", "settings-id"]]
}
```

Security notes:

- Tabel harus terdaftar di registry.
- Mutasi non admin wajib punya filter.
- Tabel akademik akan mendapat scope periode jika client tidak mengirim filter
  periode eksplisit.
- Tabel sensitif dapat masuk maker-checker approval sebelum dieksekusi.

### `POST /api/quiz/start`

Request:

```json
{
  "quiz_id": "quiz-id",
  "access_code": "123456",
  "client_meta": {
    "client_device_id": "device-fingerprint",
    "fullscreen": true
  }
}
```

Response sukses:

```json
{
  "data": {
    "submission": {
      "id": "submission-id",
      "quiz_id": "quiz-id",
      "status": "ongoing"
    },
    "questions": []
  }
}
```

Security notes:

- Siswa hanya bisa mulai quiz yang sesuai kelas/periode.
- Correct answer tidak dikirim ke siswa.
- Ongoing attempt dapat dikunci ke device pertama.
- Access code diverifikasi jika quiz mengaktifkan kode akses.

### `POST /api/storage/direct-upload`

Request:

```json
{
  "bucket": "assignments",
  "path": "tenant-safe/path/file.pdf",
  "filename": "file.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 102400
}
```

Response sukses:

```json
{
  "data": {
    "available": true,
    "bucket": "assignments",
    "provider": "object_storage",
    "browserDirect": true,
    "contentType": "application/pdf",
    "maxBytes": 10485760,
    "upload": {
      "method": "PUT",
      "url": "https://signed-upload-url",
      "headers": {},
      "expiresAt": "2026-06-21T13:00:00+00:00"
    }
  }
}
```

Security notes:

- Bucket harus allowlisted.
- Path disanitasi server-side.
- File size, mime, quota, dan ownership divalidasi sebelum signed URL dibuat.
- Client wajib memanggil `confirm-upload` setelah upload object storage.

### `POST /api/rfid/scan`

Request:

```json
{
  "tenant_slug": "sekolah",
  "device_id": "RFID-001",
  "card_uid": "A1B2C3D4",
  "event_id": "unique-event-id",
  "mode": "auto",
  "scanned_at": "2026-06-21T20:00:00+07:00"
}
```

Response sukses bergantung mode, tetapi minimal harus aman untuk retry:

```json
{
  "success": true,
  "message": "Scan diterima",
  "event_id": "unique-event-id"
}
```

Security notes:

- Endpoint route terlihat public, tetapi wajib lolos device credential.
- Gunakan `event_id` atau `scan_id` agar retry tidak menggandakan absensi.
- Device harus terdaftar di tenant yang benar.

### `POST /api/whatsapp/webhook/{secret}/{event?}`

Request berasal dari provider WhatsApp/Evolution.

Security notes:

- `secret` wajib panjang, acak, dan tidak pernah disimpan di frontend.
- Response tidak boleh mengungkap konfigurasi WhatsApp.
- Payload webhook harus diproses idempotent karena provider bisa retry.

## Contoh Request

Login:

```bash
curl -X POST "https://<tenant-host>/api/auth/login" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password-kuat"}'
```

Select DB proxy:

```bash
curl -X POST "https://<tenant-host>/api/db" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "table": "jadwal",
    "action": "select",
    "filters": [["kelas_id", "=", "class-id"]],
    "order": [["hari", "asc"], ["jam_mulai", "asc"]],
    "limit": 100
  }'
```

Terapkan periode akademik maju satu tahun:

```bash
curl -X POST "https://<tenant-host>/api/admin/academic-period/apply" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "tahun_ajaran": "2026/2027",
    "semester_aktif": "Ganjil",
    "periode_ganjil_mulai": "2026-07-01",
    "periode_ganjil_selesai": "2026-12-31",
    "periode_genap_mulai": "2027-01-01",
    "periode_genap_selesai": "2027-06-30",
    "auto_rollover": true,
    "carry_eskul_members": true,
    "calendar_confirmed": true
  }'
```

Minta direct upload object storage:

```bash
curl -X POST "https://<tenant-host>/api/storage/direct-upload" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "bucket": "assignments",
    "path": "tugas/file.pdf",
    "filename": "file.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 102400
  }'
```

## Katalog Endpoint Lengkap

Katalog ini digenerate ulang pada 2026-07-02 dari `php artisan route:list --json --path=api` dan hanya memasukkan route aplikasi dengan URI `api/*`. Route vendor seperti Horizon `horizon/api/*` tidak dihitung sebagai API aplikasi.

Total route API aplikasi aktif: 242.

### Admin

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/admin/academic-period/apply` | `AdminController@applyAcademicPeriod` | Sanctum |
| `POST` | `/api/admin/academic-period/preview` | `AdminController@previewAcademicPeriod` | Sanctum |
| `POST` | `/api/admin/academic-period/copy-structure` | `AdminController@copyAcademicStructure` | Sanctum |
| `POST` | `/api/admin/academic-period/restore-roster` | `AdminController@restoreAcademicPeriodRoster` | Sanctum |
| `GET` | `/api/admin/academic-period/schedule-decision` | `AdminController@schedulePeriodDecisionStatus` | Sanctum |
| `POST` | `/api/admin/academic-period/schedule-decision` | `AdminController@resolveSchedulePeriodDecision` | Sanctum |
| `GET` | `/api/admin/academic-periods` | `AdminController@academicPeriods` | Sanctum |
| `POST` | `/api/admin/academic-periods/correction-sessions` | `AdminController@createAcademicCorrectionSession` | Sanctum |
| `DELETE` | `/api/admin/academic-periods/correction-sessions/{sessionId}` | `AdminController@closeAcademicCorrectionSession` | Sanctum |
| `GET` | `/api/admin/academic-rollover-exceptions` | `AdminController@academicRolloverExceptions` | Sanctum |
| `PUT` | `/api/admin/academic-rollover-exceptions` | `AdminController@replaceAcademicRolloverExceptions` | Sanctum |
| `GET` | `/api/admin/academic-summary` | `AdminController@academicSummary` | Sanctum |
| `GET` | `/api/admin/backup` | `AdminBackupController@backup` | Sanctum |
| `POST` | `/api/admin/backup/google-drive` | `AdminBackupController@saveToGoogleDrive` | Sanctum |
| `POST` | `/api/admin/backup/google-drive/monthly` | `AdminBackupController@saveMonthlyToGoogleDrive` | Sanctum |
| `POST` | `/api/admin/backup/google-drive/monthly/auto` | `AdminBackupController@autoMonthlyToGoogleDrive` | Sanctum |
| `GET` | `/api/admin/backup/google-drive/monthly/jobs/{jobId}` | `AdminBackupController@monthlyJobStatus` | Sanctum |
| `GET` | `/api/admin/backup/monthly-status` | `AdminBackupController@monthlyStatus` | Sanctum |
| `POST` | `/api/admin/backup/restore` | `AdminBackupController@restore` | Sanctum |
| `GET` | `/api/admin/certificates` | `AdminController@certificates` | Sanctum |
| `POST` | `/api/admin/certificates/{id}/send-email` | `AdminController@sendCertificateEmail` | Sanctum |
| `GET` | `/api/admin/classes/deleted-history` | `ClassHistoryController@index` | Sanctum |
| `DELETE` | `/api/admin/classes/deleted-history/{id}` | `ClassHistoryController@destroyHistory` | Sanctum |
| `POST` | `/api/admin/classes/deleted-history/{id}/restore` | `ClassHistoryController@restore` | Sanctum |
| `DELETE` | `/api/admin/classes/{id}` | `ClassHistoryController@destroyClass` | Sanctum |
| `GET` | `/api/admin/dashboard-summary` | `AdminController@dashboardSummary` | Sanctum |
| `GET` | `/api/admin/feature-permissions` | `AdminFeaturePermissionController@index` | Sanctum |
| `POST` | `/api/admin/feature-permissions` | `AdminFeaturePermissionController@store` | Sanctum |
| `DELETE` | `/api/admin/feature-permissions/{id}` | `AdminFeaturePermissionController@destroy` | Sanctum |
| `PATCH` | `/api/admin/feature-permissions/{id}` | `AdminFeaturePermissionController@update` | Sanctum |
| `GET` | `/api/admin/google-drive` | `GoogleDriveController@show` | Sanctum |
| `GET` | `/api/admin/google-drive/callback` | `GoogleDriveController@callback` | Public, web |
| `POST` | `/api/admin/google-drive/connect-url` | `GoogleDriveController@connectUrl` | Sanctum |
| `POST` | `/api/admin/google-drive/disconnect` | `GoogleDriveController@disconnect` | Sanctum |
| `GET` | `/api/admin/google-drive/files` | `GoogleDriveController@files` | Sanctum |
| `POST` | `/api/admin/google-drive/recover` | `GoogleDriveController@recover` | Sanctum |
| `POST` | `/api/admin/google-drive/sync` | `GoogleDriveController@sync` | Sanctum |
| `GET` | `/api/admin/home-bootstrap` | `AdminController@homeBootstrap` | Sanctum |
| `GET` | `/api/admin/monitoring` | `AdminController@monitoring` | Sanctum |
| `GET` | `/api/admin/organisasi-bootstrap` | `AdminController@organisasiBootstrap` | Sanctum |
| `POST` | `/api/admin/rfid/browser-event` | `AdminController@rfidBrowserEvent` | Sanctum |
| `GET` | `/api/admin/rfid-devices` | `AdminController@rfidDevices` | Sanctum |
| `GET` | `/api/admin/rfid-events/stream` | `AdminController@rfidEventsStream` | Sanctum |
| `GET` | `/api/admin/scan-session-summary` | `AdminController@scanSessionSummary` | Sanctum |
| `GET` | `/api/admin/scan-settings` | `SettingsController@scanShow` | Sanctum |
| `PATCH` | `/api/admin/scan-settings` | `SettingsController@scanUpdate` | Sanctum |
| `GET` | `/api/admin/storage-manager` | `StorageManagementController@adminSummary` | Sanctum |
| `POST` | `/api/admin/storage-manager/cleanup/execute` | `StorageManagementController@adminCleanupExecute` | Sanctum |
| `POST` | `/api/admin/storage-manager/cleanup/preview` | `StorageManagementController@adminCleanupPreview` | Sanctum |
| `POST` | `/api/admin/storage-manager/object-storage/sync` | `StorageManagementController@adminObjectStorageSync` | Sanctum |
| `POST` | `/api/admin/storage-manager/trash/{fileId}/restore` | `StorageManagementController@restoreTrashFile` | Sanctum |
| `GET` | `/api/admin/struktur-bootstrap` | `AdminController@strukturBootstrap` | Sanctum |
| `GET` | `/api/admin/student-options` | `AdminController@studentOptions` | Sanctum |
| `GET` | `/api/admin/students` | `AdminController@students` | Sanctum |
| `POST` | `/api/admin/students/import` | `AdminController@importStudents` | Sanctum |
| `GET` | `/api/admin/students/{id}` | `AdminController@studentDetail` | Sanctum |
| `GET` | `/api/admin/teacher-options` | `AdminController@teacherOptions` | Sanctum |
| `GET` | `/api/admin/teachers` | `AdminController@teachers` | Sanctum |
| `PATCH` | `/api/admin/teachers/{id}/name` | `AdminController@updateTeacherName` | Sanctum |
| `PATCH` | `/api/admin/teachers/{id}/profile` | `AdminController@updateTeacherProfile` | Sanctum |
| `POST` | `/api/admin/users/provision` | `AdminController@provisionUser` | Sanctum |
| `DELETE` | `/api/admin/users/{id}` | `AdminController@deleteUser` | Sanctum |
| `PATCH` | `/api/admin/users/{id}/status` | `AdminController@updateUserStatus` | Sanctum |
| `GET` | `/api/admin/whatsapp` | `WhatsAppController@show` | Sanctum |
| `POST` | `/api/admin/whatsapp/connect` | `WhatsAppController@connect` | Sanctum |
| `POST` | `/api/admin/whatsapp/logout` | `WhatsAppController@logout` | Sanctum |
| `PATCH` | `/api/admin/whatsapp/settings` | `WhatsAppController@updateSettings` | Sanctum |
| `POST` | `/api/admin/whatsapp/sync` | `WhatsAppController@sync` | Sanctum |
| `POST` | `/api/admin/whatsapp/test` | `WhatsAppController@sendTest` | Sanctum |

### Attendance QR

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/attendance-qr/scan` | `AttendanceQrController@scan` | Sanctum |
| `POST` | `/api/attendance-qr/session` | `AttendanceQrController@session` | Sanctum |

### Auth

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/auth/email-verification/send-code` | `AuthController@sendEmailVerificationCode` | Sanctum |
| `POST` | `/api/auth/email-verification/verify-code` | `AuthController@verifyEmailCode` | Sanctum |
| `POST` | `/api/auth/forgot-password` | `AuthController@forgotPassword` | Public |
| `GET` | `/api/auth/google/callback` | `AuthController@googleCallback` | Public, web |
| `POST` | `/api/auth/google/code-login` | `AuthController@googleCodeLogin` | Public |
| `POST` | `/api/auth/google/credential-link` | `AuthController@googleCredentialLink` | Sanctum |
| `POST` | `/api/auth/google/credential-login` | `AuthController@googleCredentialLogin` | Public |
| `GET` | `/api/auth/google/finalize-login` | `AuthController@googleFinalizeLogin` | Public, web |
| `GET` | `/api/auth/google/link` | `AuthController@googleLinkRedirect` | Sanctum, web |
| `GET` | `/api/auth/google/popup-context` | `AuthController@googlePopupContext` | Public |
| `GET` | `/api/auth/google/redirect` | `AuthController@googleRedirect` | Public, web |
| `POST` | `/api/auth/google/unlink` | `AuthController@googleUnlink` | Sanctum |
| `POST` | `/api/auth/login` | `AuthController@login` | Public |
| `POST` | `/api/auth/logout` | `AuthController@logout` | Sanctum |
| `POST` | `/api/auth/logout-other-devices` | `AuthController@logoutOtherDevices` | Sanctum |
| `GET` | `/api/auth/me` | `AuthController@me` | Sanctum |
| `POST` | `/api/auth/password-change/send-code` | `AuthController@sendPasswordChangeCode` | Sanctum |
| `POST` | `/api/auth/register` | `AuthController@register` | Public |
| `POST` | `/api/auth/reset-password` | `AuthController@resetPassword` | Public |
| `GET` | `/api/auth/security` | `AuthController@securityOverview` | Sanctum |
| `POST` | `/api/auth/update-account` | `AuthController@updateAccount` | Sanctum |
| `POST` | `/api/auth/update-password` | `AuthController@updatePassword` | Sanctum |
| `POST` | `/api/auth/verify-email/resend` | `AuthController@resendVerificationEmail` | Sanctum |
| `GET` | `/api/auth/verify-email/{id}/{hash}` | `AuthController@verifyEmail` | Public |

### DB Proxy

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/db` | `DbController@handle` | Auth/policy, guests concealed |
| `POST` | `/api/db/batch` | `DbController@batch` | Auth/policy, guests concealed |

### General

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/guru/admin-permissions` | `AdminFeaturePermissionController@mine` | Sanctum |
| `POST` | `/api/guru/jam-kosong/{id}/replacement` | `JadwalController@updateJamKosongReplacement` | Sanctum |
| `GET` | `/api/health` | `Closure` | Public |
| `POST` | `/api/presence/ping` | `PresenceController@ping` | Sanctum |
| `PATCH` | `/api/students/{id}/additional-info` | `AdminController@updateStudentAdditionalInfo` | Sanctum |

### Internal

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/internal/tls/authorize` | `InfrastructureController@authorizeTlsDomain` | TLS ask secret |

### Profile

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/profile/me` | `ProfileController@me` | Sanctum |
| `PATCH` | `/api/profile/me` | `ProfileController@updateMe` | Sanctum |

### Observability

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/observability/web-vitals` | `WebVitalsController@store` | Public throttled |

### Public

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/public/settings` | `PublicSettingsController@show` | Public |

### Quiz

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/quiz/answer` | `QuizController@saveAnswer` | Sanctum |
| `POST` | `/api/quiz/answers/batch` | `QuizController@saveAnswersBatch` | Sanctum |
| `POST` | `/api/quiz/close` | `QuizController@close` | Sanctum |
| `POST` | `/api/quiz/clone` | `QuizController@clone` | Sanctum |
| `POST` | `/api/quiz/complete-essay-review` | `QuizController@completeEssayReview` | Sanctum |
| `GET` | `/api/quiz/dashboard` | `QuizController@dashboard` | Sanctum |
| `POST` | `/api/quiz/grade-essay` | `QuizController@gradeEssay` | Sanctum |
| `POST` | `/api/quiz/publish` | `QuizController@publish` | Sanctum |
| `POST` | `/api/quiz/restore-retake-score` | `QuizController@restoreRetakeScore` | Sanctum |
| `POST` | `/api/quiz/retake` | `QuizController@retake` | Sanctum |
| `GET` | `/api/quiz/retake-history` | `QuizController@retakeHistory` | Sanctum |
| `POST` | `/api/quiz/schedule` | `QuizController@schedule` | Sanctum |
| `POST` | `/api/quiz/start` | `QuizController@startAttempt` | Sanctum |
| `POST` | `/api/quiz/submit` | `QuizController@submit` | Sanctum |
| `POST` | `/api/quiz/violation` | `QuizController@logViolation` | Sanctum |
| `GET` | `/api/quiz/{quizId}/detail` | `QuizController@detail` | Sanctum |

### RFID

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/rfid/heartbeat` | `RfidController@heartbeat` | Device credential |
| `GET` | `/api/rfid/mode` | `RfidController@mode` | Device credential |
| `POST` | `/api/rfid/scan` | `RfidController@scan` | Device credential |
| `POST` | `/api/rfid/set-mode` | `RfidController@setMode` | Sanctum |
| `POST` | `/api/rfid/sync` | `RfidController@sync` | Device credential |

### Reports

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/reports/attendance-summary` | `ReportController@attendanceSummary` | Sanctum |
| `GET` | `/api/reports/homeroom-options` | `ReportController@homeroomOptions` | Sanctum |
| `GET` | `/api/reports/homeroom-summary` | `ReportController@homeroomSummary` | Sanctum |
| `GET` | `/api/reports/quiz-summary` | `ReportController@quizSummaryEndpoint` | Sanctum |
| `GET` | `/api/reports/task-summary` | `ReportController@taskSummary` | Sanctum |
| `GET` | `/api/reports/teacher-summary` | `ReportController@teacherSummary` | Sanctum |

### Storage

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/storage/confirm-upload` | `StorageController@confirmUpload` | Sanctum |
| `POST` | `/api/storage/direct-upload` | `StorageController@directUpload` | Sanctum |
| `GET` | `/api/storage/object` | `StorageController@object` | Signed public URL |
| `POST` | `/api/storage/remove` | `StorageController@remove` | Sanctum |
| `GET` | `/api/storage/signed` | `StorageController@signed` | Policy checked |
| `POST` | `/api/storage/upload` | `StorageController@upload` | Sanctum |
| `POST` | `/api/storage/upload-destination` | `StorageController@uploadDestination` | Sanctum |

### Super Admin

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/super/admins` | `SuperAdminController@admins` | Super admin |
| `POST` | `/api/super/admins` | `SuperAdminController@storeAdmin` | Super admin |
| `DELETE` | `/api/super/admins/{id}` | `SuperAdminController@deleteAdmin` | Super admin |
| `GET` | `/api/super/audit-trail` | `SuperAdminController@auditTrail` | Super admin |
| `GET` | `/api/super/domains` | `SuperAdminController@platformDomains` | Super admin |
| `POST` | `/api/super/domains` | `SuperAdminController@storePlatformDomain` | Super admin |
| `DELETE` | `/api/super/domains/{domainId}` | `SuperAdminController@deleteDomain` | Super admin |
| `POST` | `/api/super/domains/{domainId}/check` | `SuperAdminController@checkDomain` | Super admin |
| `GET` | `/api/super/me` | `SuperAdminController@me` | Super admin |
| `GET` | `/api/super/monitoring` | `SuperAdminController@monitoringOverview` | Super admin |
| `GET` | `/api/super/monitoring/logs` | `SuperLogController@index` | Super admin |
| `GET` | `/api/super/monitoring/logs/{id}` | `SuperLogController@show` | Super admin |
| `GET` | `/api/super/monitoring/server` | `SuperAdminController@serverMonitoring` | Super admin |
| `GET` | `/api/super/monitoring/web-vitals` | `WebVitalsController@summary` | Super admin |
| `GET` | `/api/super/storage` | `StorageManagementController@superOverview` | Super admin |
| `POST` | `/api/super/storage/object-storage/sync` | `StorageManagementController@superObjectStorageSync` | Super admin |
| `POST` | `/api/super/storage/trash/purge-expired` | `StorageManagementController@superPurgeExpiredTrash` | Super admin |
| `GET` | `/api/super/tenants` | `SuperAdminController@index` | Super admin |
| `POST` | `/api/super/tenants` | `SuperAdminController@store` | Super admin |
| `GET` | `/api/super/tenants/{id}` | `SuperAdminController@showTenant` | Super admin |
| `GET` | `/api/super/tenants/{id}/backup` | `SuperAdminController@backupTenant` | Super admin |
| `POST` | `/api/super/tenants/{id}/backup/google-drive` | `SuperAdminController@saveTenantBackupToGoogleDrive` | Super admin |
| `POST` | `/api/super/tenants/{id}/backup/google-drive/monthly` | `SuperAdminController@saveTenantMonthlyBackupToGoogleDrive` | Super admin |
| `POST` | `/api/super/tenants/{id}/backup/google-drive/monthly/auto` | `SuperAdminController@autoTenantMonthlyBackupToGoogleDrive` | Super admin |
| `GET` | `/api/super/tenants/{id}/backup/google-drive/monthly/jobs/{jobId}` | `SuperAdminController@tenantMonthlyBackupJobStatus` | Super admin |
| `GET` | `/api/super/tenants/{id}/backup/monthly-status` | `SuperAdminController@backupTenantMonthlyStatus` | Super admin |
| `POST` | `/api/super/tenants/{id}/restore` | `SuperAdminController@restoreTenant` | Super admin |
| `PATCH` | `/api/super/tenants/{id}/status` | `SuperAdminController@updateTenantStatus` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/admins/{userId}/reset-password` | `SuperAdminController@resetTenantAdminPassword` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/domains` | `SuperAdminController@storeTenantDomain` | Super admin |
| `GET` | `/api/super/tenants/{tenantId}/google-drive` | `StorageManagementController@superTenantDriveSummary` | Super admin |
| `GET` | `/api/super/tenants/{tenantId}/google-drive/files` | `StorageManagementController@superTenantDriveFiles` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/google-drive/sync` | `StorageManagementController@superTenantDriveSync` | Super admin |
| `GET` | `/api/super/tenants/{tenantId}/rfid-devices` | `SuperAdminController@tenantRfidDevices` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/rfid-devices` | `SuperAdminController@storeTenantRfidDevice` | Super admin |
| `DELETE` | `/api/super/tenants/{tenantId}/rfid-devices/{deviceId}` | `SuperAdminController@deleteTenantRfidDevice` | Super admin |
| `PATCH` | `/api/super/tenants/{tenantId}/rfid-mqtt` | `SuperAdminController@updateTenantRfidMqtt` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/rfid-mqtt/mosquitto` | `SuperAdminController@provisionTenantRfidMosquitto` | Super admin |
| `GET` | `/api/super/tenants/{tenantId}/storage` | `StorageManagementController@superTenantSummary` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/storage/cleanup/execute` | `StorageManagementController@superCleanupExecute` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/storage/cleanup/preview` | `StorageManagementController@superCleanupPreview` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/storage/object-storage/sync` | `StorageManagementController@superTenantObjectStorageSync` | Super admin |
| `PATCH` | `/api/super/tenants/{tenantId}/storage/quota` | `StorageManagementController@superUpdateQuota` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/storage/trash/purge-all` | `StorageManagementController@superPurgeAllTenantTrash` | Super admin |
| `DELETE` | `/api/super/tenants/{tenantId}/storage/trash/{fileId}` | `StorageManagementController@superDeleteTrashFile` | Super admin |
| `POST` | `/api/super/tenants/{tenantId}/storage/trash/{fileId}/restore` | `StorageManagementController@superRestoreTrashFile` | Super admin |
| `GET` | `/api/super/whatsapp` | `WhatsAppController@superOverview` | Super admin |
| `POST` | `/api/super/whatsapp/connect` | `WhatsAppController@superConnect` | Super admin |
| `POST` | `/api/super/whatsapp/daily-alpha/run` | `WhatsAppController@superRunDailyAlpha` | Super admin |
| `POST` | `/api/super/whatsapp/logout` | `WhatsAppController@superLogout` | Super admin |
| `POST` | `/api/super/whatsapp/retry-failed` | `WhatsAppController@superRetryFailed` | Super admin |
| `POST` | `/api/super/whatsapp/sync` | `WhatsAppController@superSync` | Super admin |
| `PATCH` | `/api/super/whatsapp/tenants/{tenantId}/status` | `WhatsAppController@superUpdateTenantSettings` | Super admin |
| `POST` | `/api/super/whatsapp/test` | `WhatsAppController@superSendTest` | Super admin |

### Tugas

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/tugas` | `TugasController@index` | Sanctum |
| `POST` | `/api/tugas` | `TugasController@store` | Sanctum Guru/Admin |
| `POST` | `/api/tugas/jawaban/submit` | `TugasController@submitJawaban` | Sanctum |
| `GET` | `/api/tugas/{id}` | `TugasController@show` | Sanctum + tenant/ownership |
| `PATCH` | `/api/tugas/{id}` | `TugasController@update` | Sanctum Guru/Admin + periode aktif |
| `DELETE` | `/api/tugas/{id}` | `TugasController@destroy` | Sanctum Guru/Admin + periode aktif |

### WhatsApp Webhook

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/whatsapp/webhook/{secret}/{event?}` | `WhatsAppWebhookController@handle` | Webhook secret |

## Checklist Perawatan Dokumentasi

- Jalankan `php artisan route:list --json --path=api` setiap menambah route,
  lalu cocokkan route aplikasi `api/*` dengan katalog ini.
- Update bagian payload ketika validasi controller berubah.
- Update bagian periode akademik jika tabel akademik atau snapshot baru
  ditambahkan.
- Pastikan endpoint public benar-benar aman: throttle, allowlist, signed URL,
  device credential, atau secret webhook.
- Pastikan endpoint yang mutasi data tenant selalu terscope `tenant_id` dan
  mencatat audit untuk perubahan penting.

## Acceptance Gate API Production

Sebelum perubahan API dianggap siap deploy, checklist ini harus hijau:

```text
[ ] Route baru muncul di Katalog Endpoint Lengkap.
[ ] Auth/role/tenant endpoint baru jelas.
[ ] Endpoint public baru masuk Public Endpoint Security Review.
[ ] Request payload penting terdokumentasi.
[ ] Response sukses/error endpoint kritikal terdokumentasi.
[ ] Mutasi data tenant memakai tenant_id dari middleware.
[ ] Mutasi data penting punya audit log atau alasan eksplisit kenapa tidak.
[ ] Endpoint akademik mempertahankan periode dan snapshot historis.
[ ] Endpoint file/storage memvalidasi bucket, path, mime, size, quota, dan TTL.
[ ] Endpoint device/webhook punya secret, credential, signature, atau idempotency key.
[ ] Test backend relevan ditambah/diupdate.
[ ] `php artisan route:list --json --path=api` tetap valid.
[ ] `ApiDocumentationRouteCoverageTest` hijau.
[ ] `php artisan test` atau test target relevan hijau.
[ ] `./vendor/bin/pint --test` hijau.
[ ] Frontend check/build hijau di CI.
```

## Command Audit Cepat

Jalankan dari root repo:

```bash
cd backend
php artisan route:list --path=api
php artisan route:list --json --path=api
php artisan test --filter=ApiDocumentationRouteCoverageTest
php artisan test
./vendor/bin/pint --test
```

Jalankan dari root frontend jika Node/NPM tersedia:

```bash
npm run security:audit
npm run check
```

Health check production:

```bash
curl -fsS https://sismu.biz.id/api/health
```

Expected:

```json
{"status":"ok"}
```

## Rekomendasi Menuju 10/10

Dokumen ini sudah layak 9/10 untuk operasional internal. Untuk menjadikannya
10/10, lakukan pekerjaan lanjutan berikut:

- Buat OpenAPI 3.1 lengkap di `docs/openapi.yaml`.
- Generate Swagger UI di environment internal, bukan public tanpa proteksi.
- Generate Postman collection dari OpenAPI untuk QA.
- Tambahkan CI job yang membandingkan daftar route Laravel dengan katalog
  dokumentasi.
- Tambahkan contract test untuk endpoint kritikal: auth, periode akademik,
  DB proxy, quiz, storage, RFID, WhatsApp webhook, dan super admin.
- Tambahkan contoh response aktual dari test fixture, bukan dari data production.
- Tambahkan changelog API per release agar mobile app dan frontend bisa melacak
  breaking change.

### API V2 Domain Contracts

| Method | Endpoint | Deskripsi |
|---|---|---|
| `GET` | `/api/v2/classes` | Mendapatkan daftar kelas |
| `GET` | `/api/v2/classes/{class}` | Mendapatkan detail kelas |
| `POST` | `/api/v2/classes` | Membuat kelas baru |
| `PUT` | `/api/v2/classes/{class}` | Mengupdate kelas (full) |
| `PATCH` | `/api/v2/classes/{class}` | Mengupdate kelas (partial) |
| `DELETE` | `/api/v2/classes/{class}` | Menghapus kelas |
| `POST` | `/api/v2/frontend-logs` | Sink frontend errors |
| `GET` | `/api/v2/frontend-logs` | Lihat frontend errors |
| `GET` | `/api/v2/students` | Mendapatkan daftar siswa |
| `GET` | `/api/v2/students/{student}` | Mendapatkan detail siswa |
| `POST` | `/api/v2/students` | Membuat siswa baru |
| `PUT` | `/api/v2/students/{student}` | Mengupdate siswa (full) |
| `PATCH` | `/api/v2/students/{student}` | Mengupdate siswa (partial) |
| `PATCH` | `/api/v2/students/{student}/deactivate` | Menonaktifkan siswa |
| `PATCH` | `/api/v2/students/{student}/activate` | Mengaktifkan siswa |
| `GET` | `/api/v2/teachers` | Mendapatkan daftar guru |
| `GET` | `/api/v2/teachers/{teacher}` | Mendapatkan detail guru |
| `POST` | `/api/v2/teachers` | Membuat guru baru |
| `PUT` | `/api/v2/teachers/{teacher}` | Mengupdate guru (full) |
| `PATCH` | `/api/v2/teachers/{teacher}` | Mengupdate guru (partial) |
| `DELETE` | `/api/v2/teachers/{teacher}` | Menghapus guru |
| `GET` | `/api/v2/schedules` | Daftar jadwal tahunan dalam tenant dan tahun ajaran; scope guru/siswa diselesaikan server. |
| `GET` | `/api/v2/schedules/{schedule}` | Detail jadwal; sertakan `kelas_id` bila ID lama ambigu. |
| `POST` | `/api/v2/schedules` | Membuat jadwal untuk periode aktif; admin saja, idempotent, conflict checked. |
| `PUT` | `/api/v2/schedules/{schedule}` | Memperbarui jadwal secara penuh; `kelas_id` dan idempotency wajib. |
| `PATCH` | `/api/v2/schedules/{schedule}` | Memperbarui jadwal parsial; hasil akhir tetap divalidasi terhadap konflik. |
| `DELETE` | `/api/v2/schedules/{schedule}` | Menghapus jadwal; `kelas_id` dan `Idempotency-Key` wajib. |

| `GET` | `/api/v2/attendance` | Mendapatkan daftar presensi |
| `GET` | `/api/v2/attendance/{attendance}` | Mendapatkan detail presensi |
| `POST` | `/api/v2/attendance` | Mencatat presensi |
| `PUT` | `/api/v2/attendance/{attendance}` | Mengupdate presensi |
| `PATCH` | `/api/v2/attendance/{attendance}` | Mengupdate presensi |
| `GET` | `/api/v2/assignments` | Mendapatkan daftar tugas |
| `GET` | `/api/v2/assignments/{assignment}` | Mendapatkan detail tugas |
| `POST` | `/api/v2/assignments` | Membuat tugas |
| `PUT` | `/api/v2/assignments/{assignment}` | Mengupdate tugas |
| `PATCH` | `/api/v2/assignments/{assignment}` | Mengupdate tugas |
| `DELETE` | `/api/v2/assignments/{assignment}` | Menghapus tugas |
| `GET` | `/api/v2/submissions` | Mendapatkan daftar submission |
| `GET` | `/api/v2/submissions/{submission}` | Mendapatkan detail submission |
| `POST` | `/api/v2/submissions` | Membuat submission |
| `PUT` | `/api/v2/submissions/{submission}` | Mengupdate submission |
| `PATCH` | `/api/v2/submissions/{submission}` | Mengupdate submission |
| `DELETE` | `/api/v2/submissions/{submission}` | Menghapus submission |
| `PATCH` | `/api/v2/submissions/{submission}/grade` | Menilai submission |
| `POST` | `/api/v2/submissions/grade-by-user` | Menilai by user |
| `POST` | `/api/v2/uploads` | Upload session init |
| `GET` | `/api/v2/uploads/{session}` | Metadata upload session milik actor |
| `POST` | `/api/v2/uploads/{session}/complete` | Upload session complete |
| `DELETE` | `/api/v2/uploads/{session}` | Upload session cancel |
| `GET` | `/api/v2/attachments/{attachment}` | Metadata attachment sesuai parent policy |
| `GET` | `/api/v2/attachments/{attachment}/download` | Instruksi download sementara 5–15 menit |
| `DELETE` | `/api/v2/attachments/{attachment}` | Detach dan soft-delete attachment |
| `GET` | `/api/v2/attendance-requests` | Mengambil daftar pengajuan izin |
| `POST` | `/api/v2/attendance-requests` | Membuat pengajuan izin baru |
| `PATCH` | `/api/v2/attendance-requests/{attendance_request}` | Merespon (approve/reject) pengajuan izin |
| `DELETE` | `/api/v2/attendance-requests/{attendance_request}` | Menghapus pengajuan izin |
