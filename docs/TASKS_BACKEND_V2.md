# Task List: Backend V2 untuk Full Non-Supabase

Tanggal: 2026-07-17
Dibuat oleh: Frontend migrasi v2

---

## Konteks

Frontend sudah 100% data v2. Tersisa 3 komponen yang masih bergantung ke Supabase SDK:
1. Storage (signed URL, upload foto profil)
2. Auth (login, register, logout, Google OAuth)
3. Realtime (polling absensi, quiz, RFID)

---

## Task 1: Storage Signed URL Endpoint

**Backend:** Tambah endpoint `POST /api/v2/storage/signed-url`

**File:**
- `backend/routes/api_v2.php` — tambah route
- `backend/app/Http/Controllers/Api/V2/AttachmentController.php` — method `signedUrl()`
- Interface: metode `signedUrl(bucket, path, expiresIn)` harus ada di `UploadStorageProvider`

**Payload:**
```json
{
  "bucket": "profile-photos",
  "object_path": "avatars/abc123.jpg",
  "expires_in": 900
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "signed_url": "https://...",
    "expires_in": 900
  },
  "request_id": "uuid"
}
```

**Frontend siap:** `storageService.js` sudah di-refactor untuk consume endpoint ini. Setelah backend selesai, uncomment `getSignedUrlForValue` → REST.

---

## Task 2: Auth Endpoint v2

**Backend:** Tambah endpoint autentikasi via REST (ganti Supabase Auth SDK)

**Endpoint yang dibutuhkan:**

| Method | Path | Fungsi |
|---|---|---|
| POST | `/api/v2/auth/login` | Login email/password |
| POST | `/api/v2/auth/register` | Register akun |
| POST | `/api/v2/auth/logout` | Logout |
| GET | `/api/v2/auth/me` | Get current user |
| POST | `/api/v2/auth/google/redirect` | Google OAuth redirect |
| POST | `/api/v2/auth/google/callback` | Google OAuth callback |
| POST | `/api/v2/auth/google/link` | Link Google account |
| POST | `/api/v2/auth/google/unlink` | Unlink Google account |
| POST | `/api/v2/auth/forgot-password` | Request reset password |
| POST | `/api/v2/auth/reset-password` | Reset password |
| POST | `/api/v2/auth/change-password` | Change password |
| POST | `/api/v2/auth/change-email` | Change email |
| GET | `/api/v2/auth/security` | Security overview |

**Auth token:** Laravel Sanctum (Satu token sudah diinject via cookie oleh `apiClient` — tidak perlu ubah frontend untuk auth flow cookie/Sanctum)

**Frontend siap:** `authService.js` sudah di-wrap dengan `logFrontendError` + Request ID. Setelah backend selesai, ganti import dari `supabase.auth` ke `apiClient`.

---

## Task 3: Realtime Polling Endpoint

**Backend:** Pastikan semua endpoint v2 support polling dengan `since` parameter

**Endpoint yang perlu diverifikasi:**

| Endpoint | Tabel | Keterangan |
|---|---|---|
| `GET /api/v2/attendance?since={timestamp}` | absensi | Sudah ada, support `kelas`, `tanggal`, `mapel` filter |
| `GET /api/v2/attendance-requests?since={timestamp}` | absensi_ajuan | Sudah ada |
| `GET /api/v2/schedules?since={timestamp}` | jadwal | Sudah ada |
| `GET /api/v2/jam-kosong?since={timestamp}` | jam_kosong | Sudah ada |
| `GET /api/v2/assignments?since={timestamp}` | tugas | Sudah ada |
| `GET /api/v2/submissions?since={timestamp}` | tugas_jawaban | Sudah ada |

**Frontend siap:** `realtimeService.js` sudah dibuat. Menggantikan `supabase.channel()` dengan polling `apiClient` setiap 15 detik. Setelah endpoint diverifikasi, ganti import di consumer.

---

## Prioritas

1. **Task 1 (Storage)** — 1 endpoint, dampak langsung ke 23 consumer signed URL
2. **Task 2 (Auth)** — paling kompleks, peer review dulu
3. **Task 3 (Realtime)** — verifikasi existing endpoint, bukan buat baru

---

## Checklist

- [ ] `POST /api/v2/storage/signed-url` — implement `UploadStorageProvider::signedUrl()`
- [ ] `POST /api/v2/auth/login` — Sanctum token issue
- [ ] `POST /api/v2/auth/register` — Sanctum token issue
- [ ] `POST /api/v2/auth/logout` — Sanctum token revoke
- [ ] `GET /api/v2/auth/me` — current user + profile
- [ ] `POST /api/v2/auth/google/*` — 4 endpoint
- [ ] `POST /api/v2/auth/forgot-password`
- [ ] `POST /api/v2/auth/reset-password`
- [ ] `POST /api/v2/auth/change-password`
- [ ] `POST /api/v2/auth/change-email`
- [ ] `GET /api/v2/auth/security`
- [ ] Verifikasi `since` parameter di semua endpoint polling
- [ ] Update `docs/api-endpoints.md`
- [ ] `php artisan test --no-ansi` — semua harus lolos
