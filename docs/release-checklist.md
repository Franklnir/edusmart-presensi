# Release Checklist (Production)

Checklist ini dibuat untuk release yang aman, repeatable, dan mudah rollback.

## 1) Pre-Release Gate (Wajib Lolos)

Pastikan Node.js sesuai versi minimum:

```bash
node -v
```

Target: `>= 20.19.0` (lihat `.nvmrc`).

Jalankan dari root project:

```bash
npm ci
npm run security:audit
npm run check
```

Jalankan backend gate:

```bash
cd backend
composer install --no-interaction --prefer-dist --no-progress
php artisan test
./vendor/bin/pint --test
cd ..
```

Kriteria lolos:

- `npm run security:audit` lolos (tidak ada vulnerability high/critical production dependency).
- Frontend build lolos.
- Test backend lolos.
- Pint backend lolos.

## 2) Persiapan Release di Server

1. Pastikan branch/tag release sudah benar.
2. Pastikan file env produksi ada:
   - `.env.production`
3. Pastikan disk untuk backup cukup.
4. Pastikan working tree server bersih:

```bash
git status --porcelain
```

## 3) Snapshot Sebelum Deploy (Sangat Disarankan)

Backup database:

```bash
mkdir -p backups
source .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump --clean --if-exists --no-owner --no-privileges -U "$DB_USERNAME" "$DB_DATABASE" \
  | gzip > "backups/pre-release-$(date +%Y%m%d-%H%M%S).sql.gz"
```

Catat:

- commit sebelum release
- lokasi file backup DB

## 4) Deploy Release

```bash
deploy/release-prod.sh --ref <release_ref>
```

## 5) Smoke Test Setelah Deploy

```bash
curl -i http://127.0.0.1:${NGINX_HTTP_PORT:-80}/api/health
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --since=5m backend
```

Cek manual minimum:

- Login admin/guru/siswa.
- Halaman nilai, absensi, laporan, backup.
- Export Excel/PDF contoh file.
- Save pengaturan admin.
- Cek header keamanan API:
  - `curl -I http://127.0.0.1:${NGINX_HTTP_PORT:-80}/api/health`
  - pastikan ada `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- Cek rate-limit auth aktif:
  - kirim burst request login salah ke `/api/auth/login` lalu pastikan server memberi `429`.
- Cek akses file guest wajib signed URL:
  - akses langsung `/api/storage/object?bucket=profile-photos&path=logo_sekolah.png` harus `403`.
  - minta signed URL via `/api/storage/signed` lalu cek URL hasilnya berhasil diakses.

## 6) Rollback Cepat (Jika Release Bermasalah)

Gunakan script:

```bash
deploy/rollback-prod.sh --ref <previous_ref>
```

Jika perlu restore database dari backup sebelum release:

```bash
deploy/rollback-prod.sh --ref <previous_ref> --restore-db backups/pre-release-YYYYMMDD-HHMMSS.sql.gz
```

Catatan penting:

- Rollback kode tanpa restore DB bisa gagal jika release sempat menjalankan migrasi yang mengubah schema/data secara tidak backward compatible.
- Untuk incident besar, lakukan rollback kode + restore DB dari snapshot yang sama.

## 7) Post-Release Monitoring (30-60 Menit)

- Pantau error log:
  - `backend`
  - `worker`
  - `scheduler`
- Pantau latensi endpoint penting:
  - `POST /api/db`
  - `GET /api/auth/me`
  - `GET /api/storage/object`
- Pantau anomali:
  - lonjakan 4xx/5xx
  - timeout export
  - query error / undefined column

Jika anomali kritis muncul, rollback segera.
