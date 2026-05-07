# Security Deploy Checklist (Production)

Gunakan checklist ini sebelum dan sesudah deploy supaya hardening IDOR/BOLA dan auth tidak regress.

## 1. Environment Variables (Wajib)

- `APP_ENV=production`
- `APP_DEBUG=false`
- `SESSION_SECURE_COOKIE=true`
- `SESSION_SAME_SITE=lax` (atau `none` jika benar-benar perlu cross-site + HTTPS)
- `TENANT_ALLOW_HEADER_OVERRIDE=false`
- `TRUSTED_PROXIES` hanya network proxy private yang valid, jangan wildcard `*`
- `SUPER_ADMIN_ALLOW_EMAIL_FALLBACK=false`
- `SUPER_ADMIN_IDS` diisi `user_id` super admin yang valid
- `SUPER_ADMIN_EMAILS` hanya untuk cadangan bootstrap, jangan jadi sumber utama otorisasi
- `CORS_ALLOWED_ORIGINS` hanya domain frontend resmi
- `CORS_ALLOWED_ORIGIN_PATTERNS` jangan terlalu longgar di production

## 2. Database & Migrasi

- Jalankan:
  - `php artisan migrate --force`
- Verifikasi tabel penting ada dan konsisten:
  - `tenants`, `profiles`, `super_admins`, `settings`
- Pastikan setiap user aktif punya `profiles.tenant_id` valid
- Pastikan `super_admins.user_id` mengarah ke user yang benar

## 3. Verifikasi Hardening Baru

- Public `settings` tidak mengembalikan field sensitif (jam internal/lock internal).
- Siswa tidak bisa insert `tugas_jawaban` untuk `tugas_id` kelas lain.
- User non-admin tidak melihat field sensitif profile user lain.
- Akses file assignment/profile tidak bisa lintas role/tenant lewat manipulasi path.
- File berisiko tidak di-render inline (`Content-Disposition` jadi `attachment`).
- Akun biasa tidak bisa daftar / ganti email ke email super admin.
- Mismatch tenant tidak bisa bypass walau pakai email yang ada di daftar super admin.

## 4. Test Suite Minimal Sebelum Release

Jalankan dari folder `backend/`:

```bash
php artisan test --filter='DbSecurityTest|AuthSuperAdminHardeningTest'
```

Jika salah satu gagal, jangan deploy.

Jika image production tidak memuat dependency test, jalankan smoke check host langsung:

```bash
chmod +x deploy/scripts/prod_smoke_check.sh
SMOKE_SUPER_ADMIN_EMAIL=admin@example.com \
SMOKE_SUPER_ADMIN_PASSWORD='ganti-dengan-password-asli' \
./deploy/scripts/prod_smoke_check.sh
```

Jika host `admin` atau `wa` masih `NXDOMAIN`, jangan go-live dulu sebelum DNS publik selesai.

## 5. Infrastruktur & Transport Security

- Pastikan HTTPS aktif end-to-end (reverse proxy + app).
- Pastikan header keamanan tidak di-strip oleh proxy:
  - `X-Frame-Options`
  - `X-Content-Type-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - `Strict-Transport-Security` (untuk HTTPS)
- Pastikan host super admin hanya di domain admin yang diizinkan.

## 6. Post-Deploy Smoke Test

- Login siswa/guru/admin normal tetap berjalan.
- Endpoint berikut return sesuai role:
  - `POST /api/db`
  - `GET /api/auth/me`
  - `POST /api/auth/update-account`
  - `GET /api/storage/object`
  - `POST /api/super/*` (khusus super admin)
- Cek log aplikasi untuk 4xx/5xx spike setelah deploy.

## 7. Operasional (Disarankan)

- Simpan audit trail perubahan akun admin/super admin.
- Rotasi password admin tenant secara berkala.
- Review akun `super_admins` per bulan (hapus yang tidak dipakai).
- Jalankan regression test keamanan ini di CI sebelum merge ke branch production.
