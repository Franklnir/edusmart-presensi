# Alur Push GitHub dan Migrasi VPS

Dokumen ini melanjutkan kondisi saat ini: repo sudah punya commit lokal di branch `backup/vps-ready-20260430`, tetapi push ke GitHub masih tertahan karena VPS belum punya autentikasi GitHub.

Tujuan alur ini:

- Push project ke GitHub tanpa mengirim `.env` atau secret produksi.
- Clone project di VPS baru.
- Menjalankan stack production Docker.
- Opsional: memindahkan database dan file upload dari VPS lama.

## 1. Cek Kondisi Repo Saat Ini

Di VPS lama:

```bash
cd /opt/edusmart-presensi
git status --short --branch
git log --oneline --decorate -5
```

Pastikan output status bersih atau hanya berisi perubahan yang memang akan dipush.

File rahasia production seperti `.env`, `.env.production`, file generated Mosquitto, `node_modules`, `vendor`, dan output build sudah masuk ignore. Jangan pernah commit file tersebut.

## 2. Pilih Cara Login GitHub

### Opsi A: SSH Key (Direkomendasikan)

Di VPS lama:

```bash
ssh-keygen -t ed25519 -C "edusmart-vps-github" -f ~/.ssh/id_ed25519_edusmart
cat ~/.ssh/id_ed25519_edusmart.pub
```

Tambahkan isi public key ke GitHub:

- Untuk akses khusus repo: `Repository > Settings > Deploy keys > Add deploy key`
- Centang `Allow write access` jika key ini dipakai untuk push.
- Untuk akses akun: `GitHub > Settings > SSH and GPG keys > New SSH key`

Tambahkan config SSH:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com-edusmart
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_edusmart
  IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config ~/.ssh/id_ed25519_edusmart
ssh -T git@github.com-edusmart
```

Ubah remote Git ke SSH:

```bash
cd /opt/edusmart-presensi
git remote set-url origin git@github.com-edusmart:Franklnir/edusmart-presensi.git
git remote -v
```

### Opsi B: Personal Access Token

Gunakan PAT hanya di terminal VPS, jangan paste token ke chat.

GitHub membutuhkan token dengan permission repo write. Setelah itu jalankan:

```bash
cd /opt/edusmart-presensi
git push -u origin backup/vps-ready-20260430
```

Saat diminta:

- Username: username GitHub
- Password: paste PAT, bukan password akun

## 3. Push Branch ke GitHub

Setelah SSH/PAT siap:

```bash
cd /opt/edusmart-presensi
git push -u origin backup/vps-ready-20260430
```

Cek di GitHub bahwa branch `backup/vps-ready-20260430` sudah muncul.

Untuk deploy VPS baru, branch ini bisa langsung dipakai. Merge ke `main` boleh dilakukan belakangan setelah kamu yakin snapshot ini benar.

## 4. Siapkan VPS Baru

Di VPS baru:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

Install Docker resmi:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Logout/login lagi agar group `docker` aktif, lalu cek:

```bash
docker --version
docker compose version
```

Buka firewall minimal:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8883/tcp
sudo ufw enable
sudo ufw status
```

Port `8883` hanya perlu jika RFID MQTT public dipakai.

## 5. Clone Project di VPS Baru

Jika memakai HTTPS:

```bash
sudo mkdir -p /opt
sudo chown "$USER":"$USER" /opt
cd /opt
git clone -b backup/vps-ready-20260430 https://github.com/Franklnir/edusmart-presensi.git
cd edusmart-presensi
```

Jika memakai SSH:

```bash
sudo mkdir -p /opt
sudo chown "$USER":"$USER" /opt
cd /opt
git clone -b backup/vps-ready-20260430 git@github.com:Franklnir/edusmart-presensi.git
cd edusmart-presensi
```

## 6. Siapkan Environment Production

Gunakan template:

```bash
cp .env.production.example .env.production
nano .env.production
```

Isi minimal:

- `APP_KEY`
- `APP_URL`
- `FRONTEND_URL`
- `DB_PASSWORD`
- `REDIS_PASSWORD`
- `CADDY_ACME_EMAIL`
- `CADDY_ASK_SECRET`
- `SESSION_DOMAIN`
- `SANCTUM_STATEFUL_DOMAINS`
- `CORS_ALLOWED_ORIGINS`
- `TENANT_ROOT_DOMAIN`
- `TENANT_ADMIN_SUBDOMAIN`
- `SUPER_ADMIN_EMAILS`
- `MAIL_*`
- `EVOLUTION_*` jika WhatsApp dipakai
- `RFID_*` dan `RFID_MOSQUITTO_*` jika RFID/MQTT dipakai
- `GOOGLE_*` dan `GOOGLE_DRIVE_*` jika Google Login/Drive dipakai

Generate `APP_KEY` baru jika ini instalasi fresh:

```bash
printf 'APP_KEY=base64:%s\n' "$(openssl rand -base64 32)"
```

Salin hasilnya ke `APP_KEY=` di `.env.production`.

Jika ini migrasi data dari VPS lama dan kamu ingin session/encrypted data tetap kompatibel, pakai `APP_KEY` lama. Karena secret lama pernah tampil di chat, rotasi secret tetap direkomendasikan setelah migrasi stabil.

## 7. Arahkan DNS

Di panel DNS domain:

- Root/app: `A xiaozhiscig.biz.id -> IP_VPS_BARU`
- Admin: `A admin26.xiaozhiscig.biz.id -> IP_VPS_BARU`
- WhatsApp: `A wa.xiaozhiscig.biz.id -> IP_VPS_BARU`
- MQTT: `A mqtt.xiaozhiscig.biz.id -> IP_VPS_BARU`
- Tenant wildcard jika dipakai: `A *.xiaozhiscig.biz.id -> IP_VPS_BARU`

Sesuaikan nama host dengan domain production yang dipakai di `.env.production`.

## 8. Deploy Stack Production

Di VPS baru:

```bash
cd /opt/edusmart-presensi
deploy/release-prod.sh --ref <release_ref> --pull-images \
  --backend-image ghcr.io/<owner>/<repo>/backend:<release_ref> \
  --nginx-image ghcr.io/<owner>/<repo>/nginx:<release_ref>
```

Ini adalah alur yang paling ringan untuk VPS kecil karena image backend dan frontend sudah dibuild oleh GitHub Actions. Jika GHCR belum disiapkan, fallback sementara:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Cek status:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 caddy
```

Cek health API:

```bash
curl -i http://127.0.0.1/api/health
```

Jika memakai port HTTP custom, sesuaikan dengan `NGINX_HTTP_PORT`.

## 9. Opsional: Backup Data dari VPS Lama

Jalankan di VPS lama:

```bash
cd /opt/edusmart-presensi
mkdir -p backups

docker compose --env-file .env -f docker-compose.prod.yml exec -T postgres \
  sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > backups/edusmart-postgres.sql

docker compose --env-file .env -f docker-compose.prod.yml exec -T evolution_postgres \
  sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  > backups/evolution-postgres.sql

docker run --rm \
  -v edusmart-prod_backend_storage:/data \
  -v "$PWD/backups":/backup \
  alpine tar czf /backup/backend-storage.tgz -C /data .

docker run --rm \
  -v edusmart-prod_evolution_instances:/data \
  -v "$PWD/backups":/backup \
  alpine tar czf /backup/evolution-instances.tgz -C /data .

tar czf backups/mosquitto-generated.tgz deploy/mosquitto/generated
```

Buat folder backup di VPS baru:

```bash
ssh USER@IP_VPS_BARU 'mkdir -p /opt/edusmart-presensi/backups'
```

Kirim backup dari VPS lama ke VPS baru:

```bash
scp backups/edusmart-postgres.sql backups/evolution-postgres.sql backups/*.tgz USER@IP_VPS_BARU:/opt/edusmart-presensi/backups/
```

## 10. Opsional: Restore Data di VPS Baru

Jalankan stack database lebih dulu:

```bash
cd /opt/edusmart-presensi
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis evolution_postgres evolution_redis
```

Restore database:

```bash
cat backups/edusmart-postgres.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  sh -lc 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'

cat backups/evolution-postgres.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T evolution_postgres \
  sh -lc 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

Restore volume file:

```bash
docker run --rm \
  -v edusmart-prod_backend_storage:/data \
  -v "$PWD/backups":/backup \
  alpine sh -lc 'cd /data && tar xzf /backup/backend-storage.tgz'

docker run --rm \
  -v edusmart-prod_evolution_instances:/data \
  -v "$PWD/backups":/backup \
  alpine sh -lc 'cd /data && tar xzf /backup/evolution-instances.tgz'

tar xzf backups/mosquitto-generated.tgz
```

Setelah restore:

```bash
deploy/release-prod.sh --ref <release_ref> --pull-images
```

## 11. Checklist Setelah Online

- `https://domain-utama` terbuka.
- `https://admin-subdomain.domain` terbuka.
- Login super admin berhasil.
- Tenant sekolah bisa dibuka via subdomain.
- Upload tugas/file berjalan.
- Google Login callback sesuai domain baru.
- Google Drive callback sesuai domain baru.
- WhatsApp QR dan webhook berjalan jika dipakai.
- RFID MQTT menerima scan jika dipakai.
- Caddy logs tidak menunjukkan error sertifikat.

## 12. Update Berikutnya

Untuk update dari GitHub di VPS baru:

```bash
cd /opt/edusmart-presensi
git fetch --all --tags --prune
deploy/release-prod.sh --ref <release_ref> --pull-images
```

Jika belum memakai GHCR, update lama tetap bisa dilakukan dengan build di VPS:

```bash
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```
