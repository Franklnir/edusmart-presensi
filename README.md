# EduSmart Presensi

EduSmart Presensi adalah aplikasi presensi dan manajemen sekolah berbasis React, Laravel, PostgreSQL, Redis, Caddy, Nginx, Mosquitto, dan Docker Compose.

Branch production yang saat ini dipakai:

```bash
backup/vps-ready-20260430
```

## Alur Deploy Production

Alur CI/CD production saat ini:

```text
Local/VPS developer
  git push
      |
      v
GitHub Actions
  - test/build frontend
  - test backend
  - pint check
  - build Docker image backend
  - build Docker image nginx/frontend
  - push image ke ghcr.io
      |
      v
VPS production
  - docker pull image
  - docker compose up -d --no-build
  - php artisan migrate --force
  - health check
```

Jadi VPS tidak compile image production saat deploy. VPS hanya download image siap pakai dari GitHub Container Registry.

## GitHub Secrets

Buka repo GitHub:

```text
Settings > Secrets and variables > Actions
```

Buat repository secrets berikut:

```text
VPS_HOST              = IP atau hostname VPS
VPS_PORT              = port SSH, biasanya 22
VPS_USER              = user SSH, contoh root
VPS_APP_DIR           = /opt/edusmart-presensi
VPS_SSH_PRIVATE_KEY   = private key SSH untuk login ke VPS
```

Workflow login ke GHCR memakai `GITHUB_TOKEN` bawaan GitHub Actions, lalu mengirim login sementara ke VPS saat deploy. `GHCR_USERNAME` dan `GHCR_TOKEN` personal tidak perlu dibuat sebagai repository secret untuk flow deploy otomatis ini.

## Setup VPS Baru

Login ke VPS baru:

```bash
ssh root@IP_VPS_BARU
```

Install kebutuhan dasar:

```bash
apt update
apt install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

Buka firewall:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8883/tcp
ufw --force enable
ufw status
```

Port `8883` hanya diperlukan jika RFID MQTT public dipakai.

## Clone Project Di VPS Baru

```bash
mkdir -p /opt
cd /opt
git clone -b backup/vps-ready-20260430 https://github.com/Franklnir/edusmart-presensi.git
cd /opt/edusmart-presensi
```

## Siapkan Environment Production

Jika pindah dari VPS lama, copy env production dari VPS lama:

```bash
scp root@IP_VPS_LAMA:/opt/edusmart-presensi/.env.production /opt/edusmart-presensi/.env.production
```

Jika fresh install:

```bash
cp .env.production.example .env.production
nano .env.production
```

Pastikan minimal nilai ini sudah benar:

```text
APP_KEY
APP_URL
FRONTEND_URL
DB_DATABASE
DB_USERNAME
DB_PASSWORD
REDIS_PASSWORD
SESSION_DOMAIN
SANCTUM_STATEFUL_DOMAINS
CORS_ALLOWED_ORIGINS
TENANT_ROOT_DOMAIN
TENANT_ADMIN_SUBDOMAIN
TENANT_RESERVED
SUPER_ADMIN_EMAILS
SUPER_ADMIN_BOOTSTRAP_PASSWORD
CADDY_ACME_EMAIL
CADDY_ASK_SECRET
RFID_SCAN_SHARED_KEY
```

Jika perlu membuat `APP_KEY` baru:

```bash
printf 'APP_KEY=base64:%s\n' "$(openssl rand -base64 32)"
```

Untuk migrasi dari VPS lama, gunakan `APP_KEY` lama agar data terenkripsi/session lama tetap kompatibel.

Untuk fresh install tanpa restore database, isi `SUPER_ADMIN_BOOTSTRAP_PASSWORD` sementara agar akun super admin pertama dibuat otomatis setelah migrasi. Setelah berhasil login, variabel ini boleh dikosongkan lagi.

## Login GHCR Di VPS Baru

Deploy otomatis dari GitHub Actions akan login GHCR di VPS memakai token sementara dari job. Langkah login manual ini hanya diperlukan kalau kamu melakukan pull image langsung dari terminal VPS di luar workflow Actions, atau jika package GHCR private dan akses manual ditolak:

```bash
echo "GHCR_TOKEN_KAMU" | docker login ghcr.io -u Franklnir --password-stdin
```

Jangan simpan token di file repo. Jalankan langsung di terminal VPS.

## First Deploy Di VPS Baru

Pastikan image branch sudah pernah dibuat oleh GitHub Actions. Jika belum, push branch dulu dari repo lokal/VPS lama.

Jalankan deploy pertama:

```bash
cd /opt/edusmart-presensi

EDUSMART_BACKEND_IMAGE=ghcr.io/franklnir/edusmart-presensi/backend:backup-vps-ready-20260430 \
EDUSMART_NGINX_IMAGE=ghcr.io/franklnir/edusmart-presensi/nginx:backup-vps-ready-20260430 \
deploy/release-prod.sh --ref backup/vps-ready-20260430 --pull-images --skip-backup
```

Gunakan `--skip-backup` saat first deploy di VPS baru karena database container lama belum ada di server baru.

Cek status:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -i http://127.0.0.1/api/health
```

Jika `NGINX_HTTP_PORT` bukan `80`, pakai:

```bash
source .env.production
curl -i "http://127.0.0.1:${NGINX_HTTP_PORT:-80}/api/health"
```

## Pasang SSH Key Untuk GitHub Actions

Di VPS baru:

```bash
ssh-keygen -t ed25519 -C "github-actions-edusmart" -f ~/.ssh/github_actions_edusmart -N ""
cat ~/.ssh/github_actions_edusmart.pub >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/github_actions_edusmart
```

Copy output private key yang tampil:

```text
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
```

Masukkan ke GitHub secret:

```text
VPS_SSH_PRIVATE_KEY
```

Lalu update secret lain agar mengarah ke VPS baru:

```text
VPS_HOST    = IP_VPS_BARU
VPS_PORT    = 22
VPS_USER    = root
VPS_APP_DIR = /opt/edusmart-presensi
```

## Migrasi Data Dari VPS Lama

Jika ingin memindahkan data dari VPS lama, buat backup di VPS lama:

```bash
cd /opt/edusmart-presensi
mkdir -p backups

source .env.production
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump --clean --if-exists --no-owner --no-privileges -U "$DB_USERNAME" "$DB_DATABASE" \
  | gzip > "backups/edusmart-postgres-$(date +%Y%m%d-%H%M%S).sql.gz"

docker run --rm \
  -v edusmart-prod_backend_storage:/data \
  -v "$PWD/backups":/backup \
  alpine tar czf /backup/backend-storage.tgz -C /data .

tar czf backups/mosquitto-generated.tgz deploy/mosquitto/generated
```

Copy backup ke VPS baru:

```bash
scp root@IP_VPS_LAMA:/opt/edusmart-presensi/backups/edusmart-postgres-*.sql.gz /opt/edusmart-presensi/backups/
scp root@IP_VPS_LAMA:/opt/edusmart-presensi/backups/backend-storage.tgz /opt/edusmart-presensi/backups/
scp root@IP_VPS_LAMA:/opt/edusmart-presensi/backups/mosquitto-generated.tgz /opt/edusmart-presensi/backups/
```

Restore database di VPS baru:

```bash
cd /opt/edusmart-presensi
source .env.production

gunzip -c backups/edusmart-postgres-YYYYMMDD-HHMMSS.sql.gz | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$DB_USERNAME" "$DB_DATABASE"
```

Restore storage:

```bash
docker run --rm \
  -v edusmart-prod_backend_storage:/data \
  -v "$PWD/backups":/backup \
  alpine sh -lc 'cd /data && tar xzf /backup/backend-storage.tgz'
```

Restore Mosquitto generated files jika RFID MQTT dipakai:

```bash
tar xzf backups/mosquitto-generated.tgz
docker compose --env-file .env.production -f docker-compose.prod.yml restart mosquitto mosquitto_reloader rfid_bridge
```

## Update DNS

Arahkan domain ke IP VPS baru:

```text
domain utama            -> IP_VPS_BARU
admin subdomain         -> IP_VPS_BARU
wa subdomain            -> IP_VPS_BARU
mqtt subdomain          -> IP_VPS_BARU
wildcard tenant jika ada -> IP_VPS_BARU
```

Contoh:

```text
xiaozhiscig.biz.id        A IP_VPS_BARU
admin26.xiaozhiscig.biz.id A IP_VPS_BARU
wa.xiaozhiscig.biz.id     A IP_VPS_BARU
mqtt.xiaozhiscig.biz.id   A IP_VPS_BARU
*.xiaozhiscig.biz.id      A IP_VPS_BARU
```

Sesuaikan dengan domain production di `.env.production`.

## Alur Update Harian

Setelah semua siap, alur update normal:

```bash
git add .
git commit -m "Update aplikasi"
git push origin backup/vps-ready-20260430
```

GitHub Actions akan menjalankan:

```text
Frontend Build
Backend Test And Pint
Build Production Images
Deploy To VPS
```

Jika semua job hijau, VPS otomatis memakai image terbaru.

## Cek Dan Troubleshooting

Cek container:

```bash
cd /opt/edusmart-presensi
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Cek log:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 nginx
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 caddy
```

Cek image yang dipakai:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml images
```

Jika pull GHCR gagal:

```bash
docker logout ghcr.io
echo "GHCR_TOKEN_KAMU" | docker login ghcr.io -u Franklnir --password-stdin
```

Troubleshooting ini untuk pull manual dari VPS. Jika Actions gagal saat deploy, cek job `Deploy To VPS` di tab GitHub Actions karena workflow normal tidak membutuhkan `GHCR_TOKEN` personal sebagai secret repo.
