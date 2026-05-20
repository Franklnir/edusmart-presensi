# GitHub Actions VPS Deploy

Workflow `.github/workflows/ci.yml` sekarang menjalankan build/test di GitHub. Jika lolos dan push terjadi ke branch `staging`, `main`, atau `backup/vps-ready-20260430`, GitHub Actions akan build image Docker release, push ke GitHub Container Registry (`ghcr.io`), lalu SSH ke VPS sesuai environment untuk pull image dan restart stack.

Dengan mode ini, VPS tidak compile image saat deploy. VPS hanya download image siap pakai.

## Branch dan Environment

Flow yang direkomendasikan:

1. Kerjakan fitur di branch `feature/...`.
2. Buka pull request ke `staging` untuk uji di server staging.
3. Setelah staging hijau, buka pull request dari `staging` ke `backup/vps-ready-20260430`.
4. Merge ke `backup/vps-ready-20260430` hanya setelah review dan check hijau.

Mapping environment:

- `feature/...`: hanya CI frontend/backend, tidak build Docker release dan tidak deploy.
- `staging`: build image, push GHCR, deploy ke environment GitHub `staging`.
- `backup/vps-ready-20260430` dan `main`: build image, push GHCR, deploy ke environment GitHub `production`.

## GitHub Secrets

Isi di `Repository > Settings > Secrets and variables > Actions`:

- `VPS_HOST`: IP atau hostname VPS.
- `VPS_PORT`: port SSH, opsional. Jika kosong, default `22`.
- `VPS_USER`: user SSH di VPS.
- `VPS_SSH_PRIVATE_KEY`: private key SSH yang boleh login ke VPS.
- `VPS_APP_DIR`: path project di VPS, contoh `/opt/edusmart-presensi`.

Workflow login ke GHCR memakai `GITHUB_TOKEN` job yang sedang berjalan, lalu mengirim login sementara ke VPS saat deploy. Jika package GHCR dibuat private lintas repo/org, pastikan permission package mengizinkan repo ini menarik image.

Untuk staging, buat GitHub Environment bernama `staging`, lalu isi secrets dengan nama yang sama tetapi mengarah ke VPS/folder staging:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_USER`
- `VPS_SSH_PRIVATE_KEY`
- `VPS_APP_DIR`

Untuk production, gunakan GitHub Environment bernama `production` atau repository secrets yang sudah ada. Nama secret tetap sama.

## Proteksi Branch Production

Aktifkan di GitHub:

```text
Repository > Settings > Branches > Add branch protection rule
```

Pattern:

```text
backup/vps-ready-20260430
```

Rekomendasi rule:

- Require a pull request before merging.
- Require approvals: minimal 1.
- Require review from Code Owners.
- Require status checks to pass before merging.
- Pilih check: `Frontend Build` dan `Backend Test And Pint`.
- Require branches to be up to date before merging.
- Do not allow bypassing the above settings.

File `.github/CODEOWNERS` sudah mengarahkan semua perubahan ke owner repo. Rule `Require review from Code Owners` baru efektif setelah branch protection diaktifkan.

## GitHub Variables Opsional

Isi di `Repository > Settings > Secrets and variables > Actions > Variables` jika frontend production perlu nilai build-time khusus:

- `VITE_API_URL`
- `VITE_TENANT_SLUG`
- `VITE_ROOT_DOMAIN`
- `VITE_ADMIN_SUBDOMAIN`
- `VITE_REALTIME_POLL_MS`
- `VITE_REALTIME_POLL_HIDDEN_MS`
- `VITE_GOOGLE_AUTH_ENABLED`
- `VITE_GOOGLE_AUTH_LOGIN_URL`
- `VITE_GOOGLE_AUTH_LINK_URL`

Jika Google Client ID perlu masuk ke frontend, simpan sebagai secret:

- `VITE_GOOGLE_CLIENT_ID`

## Syarat di VPS

- Project sudah ada di `VPS_APP_DIR`.
- `.env.production` sudah dibuat dan diisi di VPS.
- Untuk database fresh, isi `SUPER_ADMIN_EMAILS` dan `SUPER_ADMIN_BOOTSTRAP_PASSWORD` agar akun super admin pertama dibuat otomatis.
- Docker dan Docker Compose plugin sudah terpasang.
- User `VPS_USER` bisa menjalankan `docker compose` tanpa password sudo.
- Working tree bersih saat deploy: `git status --porcelain` tidak mengeluarkan apa pun.
- Repo di VPS bisa `git fetch` dari GitHub.
- VPS bisa `docker pull` dari `ghcr.io`.

Untuk VPS 4 core / 4 GB, isi tambahan ini di `.env.production` VPS agar GitHub Actions tetap deploy lewat flow yang sama, memakai override resource kecil, dan tetap menyalakan RFID/MQTT serta WhatsApp/Evolution:

```dotenv
EDUSMART_COMPOSE_FILES=docker-compose.prod.yml:docker-compose.prod.4gb.yml
COMPOSE_PROFILES=rfid,whatsapp
EDUSMART_APP_SERVICES="backend worker scheduler mosquitto mosquitto_reloader rfid_bridge nginx caddy"
EDUSMART_CORE_HEALTH_SERVICES="postgres redis backend worker scheduler mosquitto rfid_bridge nginx caddy"
REDIS_MAXMEMORY=384mb
PHP_FPM_PM_MAX_CHILDREN=12
AUTH_IP_RATE_LIMIT_PER_MINUTE=180
```

Script deploy membaca nilai itu dari `.env.production`, jadi tidak perlu menambahkan argumen khusus di workflow GitHub. Service Evolution (`evolution_postgres`, `evolution_redis`, `evolution_api`) otomatis dicoba start bila env Evolution lengkap, tetapi tidak masuk jalur deploy inti karena gateway WhatsApp bisa lebih lama booting; deploy tetap menampilkan log diagnostik bila belum sehat.

## Alur Setelah Aktif

```bash
git add .
git commit -m "Update aplikasi"
git push origin backup/vps-ready-20260430
```

Setelah push ke branch deploy, buka tab `Actions` di GitHub. Urutannya:

1. `Frontend Build`
2. `Backend Test And Pint`
3. `Build Release Images`
4. `Deploy To VPS`

Image production akan dibuat dengan tag commit, misalnya:

```text
ghcr.io/franklnir/edusmart-presensi/backend:<commit-sha>
ghcr.io/franklnir/edusmart-presensi/nginx:<commit-sha>
```

Saat deploy, workflow mengirim tag image itu ke VPS lewat environment:

```text
EDUSMART_BACKEND_IMAGE
EDUSMART_NGINX_IMAGE
```

Lalu VPS menjalankan:

```bash
deploy/release-prod.sh --ref <commit-sha> --pull-images
```

Script deploy melakukan health check internal setelah service naik:

- status container inti: `postgres`, `redis`, `backend`, `worker`, `scheduler`, `nginx`, `caddy`
- endpoint lokal `http://127.0.0.1:<NGINX_HTTP_PORT>/api/health`
- koneksi Laravel ke database via `php artisan migrate:status`

Jika deploy gagal setelah service mulai diganti, script otomatis rollback aplikasi ke ref dan image sebelumnya. Database tidak otomatis direstore karena restore data otomatis bisa lebih berbahaya daripada rollback aplikasi. Backup pre-release tetap dibuat dan bisa dipakai manual jika benar-benar perlu restore DB.

Jika deploy gagal sebelum update service, cek log job `Deploy To VPS` dan jalankan di VPS:

```bash
cd /opt/edusmart-presensi
git status --short
docker compose --env-file .env.production -f docker-compose.prod.yml -f docker-compose.prod.4gb.yml ps
```
