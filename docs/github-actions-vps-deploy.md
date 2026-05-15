# GitHub Actions VPS Deploy

Workflow `.github/workflows/ci.yml` sekarang menjalankan build/test di GitHub. Jika lolos dan push terjadi ke branch `main` atau `backup/vps-ready-20260430`, GitHub Actions akan build image Docker production, push ke GitHub Container Registry (`ghcr.io`), lalu SSH ke VPS untuk pull image dan restart stack.

Dengan mode ini, VPS tidak compile image saat deploy. VPS hanya download image siap pakai.

## GitHub Secrets

Isi di `Repository > Settings > Secrets and variables > Actions`:

- `VPS_HOST`: IP atau hostname VPS.
- `VPS_PORT`: port SSH, opsional. Jika kosong, default `22`.
- `VPS_USER`: user SSH di VPS.
- `VPS_SSH_PRIVATE_KEY`: private key SSH yang boleh login ke VPS.
- `VPS_APP_DIR`: path project di VPS, contoh `/opt/edusmart-presensi`.

Workflow login ke GHCR memakai `GITHUB_TOKEN` job yang sedang berjalan, lalu mengirim login sementara ke VPS saat deploy. Jika package GHCR dibuat private lintas repo/org, pastikan permission package mengizinkan repo ini menarik image.

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

## Alur Setelah Aktif

```bash
git add .
git commit -m "Update aplikasi"
git push origin backup/vps-ready-20260430
```

Setelah push, buka tab `Actions` di GitHub. Urutannya:

1. `Frontend Build`
2. `Backend Test And Pint`
3. `Build Production Images`
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

Jika deploy gagal sebelum update service, cek log job `Deploy To VPS` dan jalankan di VPS:

```bash
cd /opt/edusmart-presensi
git status --short
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```
