# Dokumentasi Endpoint API EduSmart

Tanggal audit: 21 Juni 2026

Dokumen ini merangkum kontrak endpoint API backend EduSmart dari source
`backend/routes/api.php`, hasil verifikasi `php artisan route:list --path=api`,
dan pembacaan controller utama. Total endpoint API aktif saat audit: 198 route.

## Ringkasan Kontrak

- Base path API: `/api`.
- Format umum response sukses controller internal: `{"data": ...}`.
- Format umum error custom: `{"error": "pesan"}`.
- Error validasi Laravel dapat memakai `message` dan `errors`.
- Mayoritas endpoint memakai Laravel Sanctum Bearer token.
- Multi tenant diselesaikan dari host/domain tenant. Header tenant hanya dipakai
  jika `tenancy.allow_header_override` aktif di konfigurasi.
- Endpoint `GET|HEAD` dari Laravel dicatat sebagai `GET` di dokumen ini.

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
- `X-Admin-Feature: <feature_key>` dipakai guru yang diberi akses fitur admin
  terdelegasi.
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
- Opsi salin jadwal dan salin anggota eskul hanya masuk akal saat maju tepat
  satu tahun ajaran; saat kembali ke periode lalu data periode itu harus dibaca
  dari histori/snapshot, bukan disalin ulang.

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
  "carry_jadwal": true,
  "carry_eskul_members": true,
  "calendar_confirmed": true
}
```

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

### Mobile

Endpoint `/api/mobile/*` memakai Sanctum kecuali `/api/mobile/schools`.

Fitur guru:

- dashboard guru.
- jadwal hari ini.
- daftar kelas yang diajar.
- detail kelas.
- ringkasan absensi.
- scan RFID/NFC mobile.
- sync batch RFID/NFC mobile.
- input absensi manual.

Payload penting:

- `guru/rfid/scan`: `card_uid`, optional `device_id`, `event_id`, `mode`,
  `scanned_at`.
- `guru/rfid/sync`: `events[]` dengan `card_uid`, optional `event_id`,
  `scan_id`, `device_id`, `mode`, `scanned_at`, `timestamp`.
- `guru/attendance/manual`: `jadwal_id`, `kelas_id`, `siswa_id`, `status`
  salah satu `Hadir`, `Izin`, `Sakit`, `Alpha`.
- `siswa/attendance`: query optional `start`, `end`.

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

### Tugas dan Reports

- `POST /api/tugas/jawaban/submit`: submit jawaban tugas siswa.
- `GET /api/reports/teacher-summary`: ringkasan laporan guru.

Query reports:

- `type`
- `kelas`
- `mapel`
- `tahun_ajaran`
- `months` atau `bulan`

Tugas mendukung filter periode via DB proxy dan controller: `kelas`, `mapel`,
`created_by`, `deadline_gte`, `deadline_lt`, `created_gte`, `tahun_ajaran`,
`semester`, `order_by`, `order`.

### RFID Device

Endpoint public RFID tetap memakai credential device dan throttle `rfid`.

Payload utama:

- `POST /api/rfid/scan`: `card_uid`, optional `device_id`, `event_id`, `mode`,
  `scanned_at`, dan identitas tenant dari device atau request.
- `POST /api/rfid/sync`: `events[]` dengan `card_uid` dan metadata event.
- `POST /api/rfid/heartbeat`: optional `device_id`, `transport`,
  `ip_address`, `firmware_version`, `wifi_rssi`, `free_heap`, `meta`.
- `POST /api/rfid/set-mode`: admin, `mode` salah satu `auto`, `manual`,
  `enroll`, optional `tenant_slug`.

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
- plugin inspect/upload/status/download.

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
    "carry_jadwal": true,
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

### Admin

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/admin/academic-period/apply` | `AdminController@applyAcademicPeriod` | Sanctum |
| `POST` | `/api/admin/academic-period/restore-roster` | `AdminController@restoreAcademicPeriodRoster` | Sanctum |
| `GET` | `/api/admin/academic-summary` | `AdminController@academicSummary` | Sanctum |
| `GET` | `/api/admin/approvals` | `ApprovalController@index` | Sanctum |
| `POST` | `/api/admin/approvals/{id}/approve` | `ApprovalController@approve` | Sanctum |
| `POST` | `/api/admin/approvals/{id}/reject` | `ApprovalController@reject` | Sanctum |
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
| `POST` | `/api/admin/google-drive/sync` | `GoogleDriveController@sync` | Sanctum |
| `GET` | `/api/admin/monitoring` | `AdminController@monitoring` | Sanctum |
| `GET` | `/api/admin/scan-session-summary` | `AdminController@scanSessionSummary` | Sanctum |
| `GET` | `/api/admin/scan-settings` | `SettingsController@scanShow` | Sanctum |
| `PATCH` | `/api/admin/scan-settings` | `SettingsController@scanUpdate` | Sanctum |
| `GET` | `/api/admin/storage-manager` | `StorageManagementController@adminSummary` | Sanctum |
| `POST` | `/api/admin/storage-manager/cleanup/execute` | `StorageManagementController@adminCleanupExecute` | Sanctum |
| `POST` | `/api/admin/storage-manager/cleanup/preview` | `StorageManagementController@adminCleanupPreview` | Sanctum |
| `POST` | `/api/admin/storage-manager/object-storage/sync` | `StorageManagementController@adminObjectStorageSync` | Sanctum |
| `POST` | `/api/admin/storage-manager/trash/{fileId}/restore` | `StorageManagementController@restoreTrashFile` | Sanctum |
| `GET` | `/api/admin/student-options` | `AdminController@studentOptions` | Sanctum |
| `GET` | `/api/admin/students` | `AdminController@students` | Sanctum |
| `GET` | `/api/admin/students/{id}` | `AdminController@studentDetail` | Sanctum |
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
| `POST` | `/api/auth/google/mobile/exchange` | `AuthController@googleMobileExchange` | Public |
| `GET` | `/api/auth/google/mobile/redirect` | `AuthController@googleMobileRedirect` | Public, web |
| `GET` | `/api/auth/google/popup-context` | `AuthController@googlePopupContext` | Public |
| `GET` | `/api/auth/google/redirect` | `AuthController@googleRedirect` | Public, web |
| `POST` | `/api/auth/google/unlink` | `AuthController@googleUnlink` | Sanctum |
| `POST` | `/api/auth/login` | `AuthController@login` | Public |
| `POST` | `/api/auth/logout` | `AuthController@logout` | Sanctum |
| `GET` | `/api/auth/me` | `AuthController@me` | Sanctum |
| `POST` | `/api/auth/password-change/send-code` | `AuthController@sendPasswordChangeCode` | Sanctum |
| `POST` | `/api/auth/register` | `AuthController@register` | Public |
| `POST` | `/api/auth/reset-password` | `AuthController@resetPassword` | Public |
| `POST` | `/api/auth/update-account` | `AuthController@updateAccount` | Sanctum |
| `POST` | `/api/auth/update-password` | `AuthController@updatePassword` | Sanctum |
| `POST` | `/api/auth/verify-email/resend` | `AuthController@resendVerificationEmail` | Sanctum |
| `GET` | `/api/auth/verify-email/{id}/{hash}` | `AuthController@verifyEmail` | Public |

### DB Proxy

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/db` | `DbController@handle` | Sanctum |
| `POST` | `/api/db/batch` | `DbController@batch` | Sanctum |

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
| `GET` | `/api/internal/tls/authorize` | `InfrastructureController@authorizeTlsDomain` | Public |

### Mobile

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/mobile/dashboard` | `MobileController@dashboard` | Sanctum |
| `POST` | `/api/mobile/guru/attendance/manual` | `MobileController@guruManualAttendance` | Sanctum |
| `GET` | `/api/mobile/guru/attendance/summary` | `MobileController@guruAttendanceSummary` | Sanctum |
| `GET` | `/api/mobile/guru/classes` | `MobileController@guruClasses` | Sanctum |
| `GET` | `/api/mobile/guru/classes/{id}` | `MobileController@guruClass` | Sanctum |
| `GET` | `/api/mobile/guru/dashboard` | `MobileController@guruDashboard` | Sanctum |
| `POST` | `/api/mobile/guru/rfid/scan` | `MobileController@guruRfidScan` | Sanctum |
| `POST` | `/api/mobile/guru/rfid/sync` | `MobileController@guruRfidSync` | Sanctum |
| `GET` | `/api/mobile/guru/schedules/today` | `MobileController@guruSchedulesToday` | Sanctum |
| `GET` | `/api/mobile/me` | `MobileController@me` | Sanctum |
| `GET` | `/api/mobile/schools` | `MobileDirectoryController@schools` | Public |
| `GET` | `/api/mobile/siswa/attendance` | `MobileController@siswaAttendance` | Sanctum |
| `GET` | `/api/mobile/siswa/dashboard` | `MobileController@siswaDashboard` | Sanctum |
| `GET` | `/api/mobile/siswa/digital-card` | `MobileController@siswaDigitalCard` | Sanctum |
| `GET` | `/api/mobile/siswa/grades` | `MobileController@siswaGrades` | Sanctum |
| `GET` | `/api/mobile/siswa/schedules` | `MobileController@siswaSchedules` | Sanctum |
| `GET` | `/api/mobile/siswa/tasks` | `MobileController@siswaTasks` | Sanctum |

### Profile

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `GET` | `/api/profile/me` | `ProfileController@me` | Sanctum |
| `PATCH` | `/api/profile/me` | `ProfileController@updateMe` | Sanctum |

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
| `POST` | `/api/rfid/heartbeat` | `RfidController@heartbeat` | Device credential, rfid throttle |
| `GET` | `/api/rfid/mode` | `RfidController@mode` | Device credential, rfid throttle |
| `POST` | `/api/rfid/scan` | `RfidController@scan` | Device credential, rfid throttle |
| `POST` | `/api/rfid/set-mode` | `RfidController@setMode` | Sanctum |
| `POST` | `/api/rfid/sync` | `RfidController@sync` | Device credential, rfid throttle |

### Reports

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
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
| `GET` | `/api/super/admins` | `SuperAdminController@admins` | Sanctum, super |
| `POST` | `/api/super/admins` | `SuperAdminController@storeAdmin` | Sanctum, super |
| `DELETE` | `/api/super/admins/{id}` | `SuperAdminController@deleteAdmin` | Sanctum, super |
| `GET` | `/api/super/audit-trail` | `SuperAdminController@auditTrail` | Sanctum, super |
| `GET` | `/api/super/domains` | `SuperAdminController@platformDomains` | Sanctum, super |
| `POST` | `/api/super/domains` | `SuperAdminController@storePlatformDomain` | Sanctum, super |
| `DELETE` | `/api/super/domains/{domainId}` | `SuperAdminController@deleteDomain` | Sanctum, super |
| `POST` | `/api/super/domains/{domainId}/check` | `SuperAdminController@checkDomain` | Sanctum, super |
| `GET` | `/api/super/me` | `SuperAdminController@me` | Sanctum, super |
| `GET` | `/api/super/monitoring` | `SuperAdminController@monitoringOverview` | Sanctum, super |
| `GET` | `/api/super/monitoring/logs` | `SuperLogController@index` | Sanctum, super |
| `GET` | `/api/super/monitoring/logs/{id}` | `SuperLogController@show` | Sanctum, super |
| `GET` | `/api/super/monitoring/server` | `SuperAdminController@serverMonitoring` | Sanctum, super |
| `GET` | `/api/super/plugins` | `SuperPluginController@index` | Sanctum, super |
| `POST` | `/api/super/plugins` | `SuperPluginController@store` | Sanctum, super |
| `POST` | `/api/super/plugins/inspect` | `SuperPluginController@inspect` | Sanctum, super |
| `DELETE` | `/api/super/plugins/{id}` | `SuperPluginController@destroy` | Sanctum, super |
| `GET` | `/api/super/plugins/{id}/download` | `SuperPluginController@download` | Sanctum, super |
| `PATCH` | `/api/super/plugins/{id}/status` | `SuperPluginController@updateStatus` | Sanctum, super |
| `GET` | `/api/super/storage` | `StorageManagementController@superOverview` | Sanctum, super |
| `POST` | `/api/super/storage/object-storage/sync` | `StorageManagementController@superObjectStorageSync` | Sanctum, super |
| `POST` | `/api/super/storage/trash/purge-expired` | `StorageManagementController@superPurgeExpiredTrash` | Sanctum, super |
| `GET` | `/api/super/tenants` | `SuperAdminController@index` | Sanctum, super |
| `POST` | `/api/super/tenants` | `SuperAdminController@store` | Sanctum, super |
| `GET` | `/api/super/tenants/{id}` | `SuperAdminController@showTenant` | Sanctum, super |
| `GET` | `/api/super/tenants/{id}/backup` | `SuperAdminController@backupTenant` | Sanctum, super |
| `POST` | `/api/super/tenants/{id}/backup/google-drive` | `SuperAdminController@saveTenantBackupToGoogleDrive` | Sanctum, super |
| `POST` | `/api/super/tenants/{id}/backup/google-drive/monthly` | `SuperAdminController@saveTenantMonthlyBackupToGoogleDrive` | Sanctum, super |
| `POST` | `/api/super/tenants/{id}/backup/google-drive/monthly/auto` | `SuperAdminController@autoTenantMonthlyBackupToGoogleDrive` | Sanctum, super |
| `GET` | `/api/super/tenants/{id}/backup/google-drive/monthly/jobs/{jobId}` | `SuperAdminController@tenantMonthlyBackupJobStatus` | Sanctum, super |
| `GET` | `/api/super/tenants/{id}/backup/monthly-status` | `SuperAdminController@backupTenantMonthlyStatus` | Sanctum, super |
| `POST` | `/api/super/tenants/{id}/restore` | `SuperAdminController@restoreTenant` | Sanctum, super |
| `PATCH` | `/api/super/tenants/{id}/status` | `SuperAdminController@updateTenantStatus` | Sanctum, super |
| `PATCH` | `/api/super/tenants/{tenantId}/admins/{userId}/primary` | `SuperAdminController@setTenantPrimaryAdmin` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/admins/{userId}/reset-password` | `SuperAdminController@resetTenantAdminPassword` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/domains` | `SuperAdminController@storeTenantDomain` | Sanctum, super |
| `GET` | `/api/super/tenants/{tenantId}/google-drive` | `StorageManagementController@superTenantDriveSummary` | Sanctum, super |
| `GET` | `/api/super/tenants/{tenantId}/google-drive/files` | `StorageManagementController@superTenantDriveFiles` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/google-drive/sync` | `StorageManagementController@superTenantDriveSync` | Sanctum, super |
| `GET` | `/api/super/tenants/{tenantId}/rfid-devices` | `SuperAdminController@tenantRfidDevices` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/rfid-devices` | `SuperAdminController@storeTenantRfidDevice` | Sanctum, super |
| `DELETE` | `/api/super/tenants/{tenantId}/rfid-devices/{deviceId}` | `SuperAdminController@deleteTenantRfidDevice` | Sanctum, super |
| `PATCH` | `/api/super/tenants/{tenantId}/rfid-mqtt` | `SuperAdminController@updateTenantRfidMqtt` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/rfid-mqtt/mosquitto` | `SuperAdminController@provisionTenantRfidMosquitto` | Sanctum, super |
| `GET` | `/api/super/tenants/{tenantId}/storage` | `StorageManagementController@superTenantSummary` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/storage/cleanup/execute` | `StorageManagementController@superCleanupExecute` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/storage/cleanup/preview` | `StorageManagementController@superCleanupPreview` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/storage/object-storage/sync` | `StorageManagementController@superTenantObjectStorageSync` | Sanctum, super |
| `PATCH` | `/api/super/tenants/{tenantId}/storage/quota` | `StorageManagementController@superUpdateQuota` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/storage/trash/purge-all` | `StorageManagementController@superPurgeAllTenantTrash` | Sanctum, super |
| `DELETE` | `/api/super/tenants/{tenantId}/storage/trash/{fileId}` | `StorageManagementController@superDeleteTrashFile` | Sanctum, super |
| `POST` | `/api/super/tenants/{tenantId}/storage/trash/{fileId}/restore` | `StorageManagementController@superRestoreTrashFile` | Sanctum, super |
| `GET` | `/api/super/whatsapp` | `WhatsAppController@superOverview` | Sanctum, super |
| `POST` | `/api/super/whatsapp/connect` | `WhatsAppController@superConnect` | Sanctum, super |
| `POST` | `/api/super/whatsapp/daily-alpha/run` | `WhatsAppController@superRunDailyAlpha` | Sanctum, super |
| `POST` | `/api/super/whatsapp/logout` | `WhatsAppController@superLogout` | Sanctum, super |
| `POST` | `/api/super/whatsapp/retry-failed` | `WhatsAppController@superRetryFailed` | Sanctum, super |
| `POST` | `/api/super/whatsapp/sync` | `WhatsAppController@superSync` | Sanctum, super |
| `PATCH` | `/api/super/whatsapp/tenants/{tenantId}/status` | `WhatsAppController@superUpdateTenantSettings` | Sanctum, super |
| `POST` | `/api/super/whatsapp/test` | `WhatsAppController@superSendTest` | Sanctum, super |

### Tugas

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/tugas/jawaban/submit` | `TugasController@submitJawaban` | Sanctum |

### Webhook

| Method | Endpoint | Handler | Auth |
|---|---|---|---|
| `POST` | `/api/whatsapp/webhook/{secret}/{event?}` | `WhatsAppWebhookController@handle` | Public, webhook throttle |

## Checklist Perawatan Dokumentasi

- Jalankan `php artisan route:list --path=api` setiap menambah route.
- Update bagian payload ketika validasi controller berubah.
- Update bagian periode akademik jika tabel akademik atau snapshot baru
  ditambahkan.
- Pastikan endpoint public benar-benar aman: throttle, allowlist, signed URL,
  device credential, atau secret webhook.
- Pastikan endpoint yang mutasi data tenant selalu terscope `tenant_id` dan
  mencatat audit untuk perubahan penting.
