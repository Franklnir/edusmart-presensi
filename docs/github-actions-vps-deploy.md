# GitHub Actions VPS Deploy

Workflow `.github/workflows/ci.yml` sekarang akan menjalankan build/test di GitHub. Jika lolos dan push terjadi ke branch `main` atau `backup/vps-ready-20260430`, job `Deploy To VPS` akan SSH ke VPS dan menjalankan `deploy/release-prod.sh` untuk update stack production.

## GitHub Secrets

Isi di `Repository > Settings > Secrets and variables > Actions`:

- `VPS_HOST`: IP atau hostname VPS.
- `VPS_PORT`: port SSH, opsional. Jika kosong, default `22`.
- `VPS_USER`: user SSH di VPS.
- `VPS_SSH_PRIVATE_KEY`: private key SSH yang boleh login ke VPS.
- `VPS_APP_DIR`: path project di VPS, contoh `/opt/edusmart-presensi`.

## Syarat di VPS

- Project sudah ada di `VPS_APP_DIR`.
- `.env.production` sudah dibuat dan diisi di VPS.
- Docker dan Docker Compose plugin sudah terpasang.
- User `VPS_USER` bisa menjalankan `docker compose` tanpa password sudo.
- Working tree bersih saat deploy: `git status --porcelain` tidak mengeluarkan apa pun.
- Repo di VPS bisa `git fetch` dari GitHub.

## Alur Setelah Aktif

```bash
git add .
git commit -m "Update aplikasi"
git push origin backup/vps-ready-20260430
```

Setelah push, buka tab `Actions` di GitHub. Urutannya:

1. `Frontend Build`
2. `Backend Test And Pint`
3. `Deploy To VPS`

Jika deploy gagal sebelum update service, cek log job `Deploy To VPS` dan jalankan di VPS:

```bash
cd /opt/edusmart-presensi
git status --short
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```
