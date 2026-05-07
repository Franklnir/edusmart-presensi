# GitHub, GHCR, dan Deploy VPS Ringan

Dokumen ini adalah alur yang direkomendasikan untuk push aman ke GitHub dan update VPS kecil tanpa build berat di server.

Prinsipnya:

- GitHub menyimpan source code.
- GitHub Actions membuild image production.
- GHCR (`ghcr.io`) menyimpan image siap jalan.
- VPS hanya `docker pull` lalu restart container dengan `--no-build`.

Ini lebih profesional daripada commit folder `dist/` ke Git karena artifact production punya versi, bisa diulang, dan bisa di-rollback lewat tag image.

## 1. Yang Tidak Boleh Dipush

Jangan commit file ini:

- `.env`
- `.env.production`
- `.env.production.local`
- `backend/.env`
- `env_vps.txt`
- `composer.phar`
- `composer-setup.php`
- `node_modules/`
- `vendor/`
- `dist/`
- `backups/`
- file backup `.tar.gz` / `.tgz`
- database lokal `.sqlite`

Repo sudah menambah ignore untuk file sensitif dan artifact umum. Tetap cek sebelum push:

```powershell
.\deploy\scripts\pre-push-check.ps1
```

Kalau ingin cek cepat tanpa build/test ulang:

```powershell
.\deploy\scripts\pre-push-check.ps1 -SkipBuild -SkipTests -SkipAudit
```

## 2. Push Aman ke GitHub

Dari root project lokal:

```powershell
git status --short
.\deploy\scripts\pre-push-check.ps1
git add .
git status --short
git commit -m "Prepare production image deploy"
git branch -M main
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Jika remote sudah ada, pakai:

```powershell
git remote -v
git remote set-url origin https://github.com/<owner>/<repo>.git
git push -u origin main
```

Jangan paste token GitHub ke chat. Jika GitHub meminta password saat push HTTPS, gunakan Personal Access Token di terminal sendiri.

## 3. Build Image Otomatis di GitHub

Workflow `.github/workflows/docker-release.yml` akan build dan push dua image:

- `ghcr.io/<owner>/<repo>/backend:<tag>`
- `ghcr.io/<owner>/<repo>/nginx:<tag>`

Gunakan `<owner>/<repo>` lowercase saat menulis image di VPS. Workflow sudah otomatis mengubah `GITHUB_REPOSITORY` menjadi lowercase karena GHCR memakai format image lowercase.

Workflow jalan otomatis saat:

- push ke branch `main`
- push tag `v*`
- dijalankan manual dari tab `Actions`

Untuk release stabil, pakai tag:

```powershell
git tag v2026.05.07-1
git push origin v2026.05.07-1
```

Image yang dibuat:

- `ghcr.io/<owner>/<repo>/backend:v2026.05.07-1`
- `ghcr.io/<owner>/<repo>/nginx:v2026.05.07-1`
- plus tag SHA untuk audit teknis

## 4. Repo Variables untuk Build Frontend

Frontend Vite memakai env saat build. Karena itu nilai public perlu diisi di GitHub:

`Repository > Settings > Secrets and variables > Actions > Variables`

Isi minimal:

- `VITE_ROOT_DOMAIN`
- `VITE_ADMIN_SUBDOMAIN`
- `VITE_API_URL` jika frontend dan API beda host; kosongkan untuk same-origin
- `VITE_GOOGLE_AUTH_ENABLED`
- `VITE_GOOGLE_CLIENT_ID` jika Google Login aktif
- `VITE_GOOGLE_AUTH_LOGIN_URL`
- `VITE_GOOGLE_AUTH_LINK_URL`

Jangan taruh secret backend di Variables frontend. Nilai seperti `APP_KEY`, `DB_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `EVOLUTION_API_KEY`, dan `RFID_*_PASSWORD` tetap hanya di `.env.production` VPS.

## 5. Konfigurasi VPS agar Tidak Build

Di VPS, isi `.env.production`:

```bash
EDUSMART_BACKEND_IMAGE=ghcr.io/<owner>/<repo>/backend:v2026.05.07-1
EDUSMART_NGINX_IMAGE=ghcr.io/<owner>/<repo>/nginx:v2026.05.07-1
```

Jika repo atau package GHCR private, login dulu di VPS:

```bash
echo "<GITHUB_PAT_READ_PACKAGES>" | docker login ghcr.io -u <github_username> --password-stdin
```

Token cukup punya permission `read:packages`. Jangan simpan token di repo.

## 6. Deploy Release di VPS Tanpa Build

Setelah tag sudah selesai build di GitHub Actions:

```bash
cd /opt/edusmart-presensi
git fetch --all --tags --prune
deploy/release-prod.sh --ref v2026.05.07-1 --pull-images
```

Atau tanpa edit `.env.production`, override image saat deploy:

```bash
deploy/release-prod.sh --ref v2026.05.07-1 --pull-images \
  --backend-image ghcr.io/<owner>/<repo>/backend:v2026.05.07-1 \
  --nginx-image ghcr.io/<owner>/<repo>/nginx:v2026.05.07-1
```

Script akan:

- memastikan working tree VPS bersih
- checkout ref release
- backup database sebelum release
- pull image backend dan nginx/frontend
- restart service dengan `--no-build`
- menjalankan migrasi
- clear cache Laravel
- smoke test `/api/health`

## 7. Rollback Cepat

Rollback ke tag atau commit sebelumnya:

```bash
deploy/rollback-prod.sh --ref v2026.05.06-1 --pull-images \
  --backend-image ghcr.io/<owner>/<repo>/backend:v2026.05.06-1 \
  --nginx-image ghcr.io/<owner>/<repo>/nginx:v2026.05.06-1
```

Jika perlu restore database dari backup:

```bash
deploy/rollback-prod.sh --ref v2026.05.06-1 --pull-images \
  --backend-image ghcr.io/<owner>/<repo>/backend:v2026.05.06-1 \
  --nginx-image ghcr.io/<owner>/<repo>/nginx:v2026.05.06-1 \
  --restore-db backups/pre-release-YYYYMMDD-HHMMSS.sql.gz
```

## 8. Apakah Build Local Perlu?

Build lokal tetap perlu sebagai gate sebelum push:

```powershell
npm run build
```

Tetapi hasil `dist/` tidak perlu dipush. Untuk VPS kecil, solusi yang lebih rapi adalah:

- local build untuk validasi cepat
- GitHub Actions build image production
- VPS pull image prebuilt

Commit `dist/` bisa dipakai untuk hosting static sederhana, tetapi kurang cocok untuk stack Docker Laravel + React ini karena artifact frontend dan backend sebaiknya dibungkus dalam image release yang sama-sama punya tag.

## 9. Fallback Kalau GHCR Belum Siap

Jika belum sempat setup GHCR, VPS masih bisa build langsung:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Namun untuk VPS RAM kecil, gunakan swap sementara atau jalankan saat trafik rendah. Setelah GHCR aktif, kembali ke `--pull-images`.
