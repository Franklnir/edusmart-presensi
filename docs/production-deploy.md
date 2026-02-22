# Production Deploy Guide (VPS)

Dokumen ini untuk menyiapkan EduSmart ke mode produksi nyata di VPS (`DigitalOcean`, `IDCloudHost`, dll).

## 1. Prasyarat

- Domain aktif (contoh: `edusmart.example.com`)
- VPS Ubuntu 22.04+
- Docker + Docker Compose plugin terpasang
- Port `80` dan `443` dibuka
- Untuk deploy native (tanpa Docker), gunakan PHP `8.4+` + ekstensi `pdo_pgsql`

## 2. Siapkan Environment

1. Copy template:

```bash
cp .env.production.example .env.production
```

2. Isi nilai sensitif minimal:

- `APP_KEY`
- `DB_PASSWORD`
- `REDIS_PASSWORD`
- `APP_URL`
- `FRONTEND_URL`
- `NGINX_HTTP_PORT` (default `80`, ganti jika port host sudah dipakai)
- `VITE_API_URL`
- `VITE_ADMIN_SUBDOMAIN`
- `SANCTUM_STATEFUL_DOMAINS`
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOWED_ORIGIN_PATTERNS` (jika pakai subdomain tenant)
- `TENANT_ROOT_DOMAIN`
- `TENANT_ADMIN_SUBDOMAIN` (contoh: `admin`)
- `SUPER_ADMIN_EMAILS`
- `TENANT_RESERVED` (pastikan mengandung `admin`)
- `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`
- `RFID_SCAN_SHARED_KEY` (opsional tapi direkomendasikan)
- `RFID_MQTT_BRIDGE_ENABLED`
- `RFID_MQTT_HOST`, `RFID_MQTT_PORT`, `RFID_MQTT_USERNAME`, `RFID_MQTT_PASSWORD`

3. Generate `APP_KEY`:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend php artisan key:generate --show
```

## 3. Jalankan Stack Production

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Catatan: service `backend_nginx` membaca `./backend/public` dari repo, jadi project harus dideploy dari folder source yang sama di VPS (bukan hanya copy `docker-compose` saja).

Cek status service:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Cek health API:

```bash
curl -i http://127.0.0.1:${NGINX_HTTP_PORT:-80}/api/health
```

Cek ekstensi PostgreSQL di runtime backend container:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php -m | grep -i pdo_pgsql
```

Jika output kosong, rebuild image tanpa cache:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build --no-cache backend worker scheduler rfid_bridge
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

## 3.1 Konfigurasi Email (Brevo)

Gunakan SMTP Brevo agar fitur `Lupa Password` dan `Verifikasi Email` benar-benar mengirim email:

- `MAIL_MAILER=smtp`
- `MAIL_SCHEME=smtp`
- `MAIL_HOST=smtp-relay.brevo.com`
- `MAIL_PORT=587`
- `MAIL_USERNAME=<login SMTP Brevo>`
- `MAIL_PASSWORD=<SMTP key Brevo>`
- `MAIL_FROM_ADDRESS=no-reply@domain-kamu`

Setelah ubah env:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan config:clear
docker compose --env-file .env.production -f docker-compose.prod.yml restart backend worker scheduler
```

## 3.2 Konfigurasi Google Login (OAuth)

Agar tombol Google di halaman login bisa dipakai langsung:

1. Buat OAuth Client di Google Cloud Console (type: `Web application`).
2. Isi **Authorized JavaScript origins** minimal:
   - `https://edusmart.example.com`
   - `https://admin.edusmart.example.com`
   - jika multi-tenant, tambahkan domain host yang dipakai user untuk membuka frontend.
3. Isi **Authorized redirect URIs**:
   - `https://edusmart.example.com/api/auth/google/callback`
   - jika pakai host callback lain, samakan dengan `GOOGLE_REDIRECT_URI`.
4. Set env di `.env.production`:
   - `VITE_GOOGLE_AUTH_ENABLED=true`
   - `VITE_GOOGLE_AUTH_LOGIN_URL=/api/auth/google/redirect`
   - `VITE_GOOGLE_AUTH_LINK_URL=/api/auth/google/link`
   - `GOOGLE_AUTH_ENABLED=true`
   - `GOOGLE_CLIENT_ID=<client-id-google>`
   - `GOOGLE_CLIENT_SECRET=<client-secret-google>`
   - `GOOGLE_REDIRECT_URI=https://edusmart.example.com/api/auth/google/callback`
5. Reload config + restart service:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan config:clear
docker compose --env-file .env.production -f docker-compose.prod.yml restart backend frontend
```

Catatan multi-tenant:
- `SESSION_DOMAIN` sebaiknya `.edusmart.example.com` agar state OAuth tetap valid lintas subdomain.
- Gunakan URL Google frontend yang relatif (`/api/auth/google/...`) agar otomatis mengikuti host tenant aktif.

## 3.3 Konfigurasi RFID MQTT Bridge

Service bridge di `docker-compose.prod.yml` bernama `rfid_bridge` dan akan auto-restart.

Pastikan env ini terisi:

- `RFID_MQTT_BRIDGE_ENABLED=true`
- `RFID_MQTT_HOST=<host-hivemq>`
- `RFID_MQTT_PORT=8883`
- `RFID_MQTT_USERNAME=<username>`
- `RFID_MQTT_PASSWORD=<password>`
- `RFID_MQTT_SCAN_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/scan`
- `RFID_MQTT_RESPONSE_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/response`
- `RFID_MQTT_MODE_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/mode`

Jalankan/refresh service bridge:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build rfid_bridge
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f rfid_bridge
```

## 4. TLS/HTTPS

File `docker-compose.prod.yml` default expose HTTP (`:80`).
Untuk HTTPS produksi:

- Opsi A: pakai reverse proxy host (Nginx/Caddy/Traefik) di depan container
- Opsi B: ubah Nginx container untuk terminasi TLS + mount sertifikat

Contoh konfigurasi host-level tersedia di:

- `deploy/nginx/vps.prod.conf.example`

## 4.1 Domain Policy (Rekomendasi Profesional)

- Root domain tenant: `edusmart.myid`
- Tenant sekolah: `bali.edusmart.myid`, `jakarta.edusmart.myid`, dst
- Panel super admin: `admin.edusmart.myid`

Set env:

- `TENANT_ROOT_DOMAIN=edusmart.myid`
- `TENANT_ADMIN_SUBDOMAIN=admin`
- `TENANT_RESERVED=www,app,api,admin`
- `TENANT_ALLOW_ROOT_FOR_SUPER_ADMIN=false`

Catatan:

- Endpoint `api/super/*` hanya bisa diakses dari domain admin.
- Login akun super admin hanya di domain admin.
- Login user sekolah (admin/guru/siswa tenant) ditolak jika mencoba login dari domain admin.
- Wajib pasang wildcard DNS `*.edusmart.myid` + wildcard SSL `*.edusmart.myid`.

## 5. Operasional Harian

Logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend_nginx
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f worker
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f rfid_bridge
```

Restart service tertentu:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart backend backend_nginx worker scheduler rfid_bridge
```

## 6. Hardening Minimum

- `APP_ENV=production`
- `APP_DEBUG=false`
- `TRUSTED_PROXIES` diisi network proxy/reverse-proxy yang valid (jangan biarkan wildcard di internet publik)
- `SESSION_SECURE_COOKIE=true`
- `SESSION_ENCRYPT=true`
- `AUTH_RATE_LIMIT_PER_MINUTE=12`
- `AUTH_IP_RATE_LIMIT_PER_MINUTE=90`
- `AUTH_LOGIN_MAX_ATTEMPTS=5`
- `STORAGE_WRITE_RATE_LIMIT_PER_MINUTE=90`
- `STORAGE_READ_RATE_LIMIT_PER_MINUTE=180`
- `STORAGE_GUEST_RATE_LIMIT_PER_MINUTE=60`
- `TENANT_ALLOW_HEADER_OVERRIDE=false`
- validasi `CORS_ALLOWED_ORIGINS` hanya domain produksi kamu (jangan localhost di production)
- password DB/Redis kuat dan unik
- hanya expose port yang perlu (`80/443`)
- backup DB terjadwal

Catatan:

- `deploy/nginx/gateway.prod.conf` sudah diberi rate-limit tambahan untuk `/api/auth/*` dan `/api/*` sebagai lapisan proteksi brute-force di edge.
- Endpoint file sekarang pakai signed URL dengan masa berlaku + validasi signature untuk akses guest.

## 7. Deploy Native (Tanpa Docker)

Jika kamu deploy native service di VPS:

- Install ekstensi PostgreSQL:

```bash
sudo apt update
sudo apt install -y php-pgsql
php -m | grep -Ei "pdo_pgsql|pgsql"
```

Jika server kamu pakai PHP-FPM:

```bash
sudo systemctl restart php8.3-fpm
```

Jika server kamu pakai Apache `mod_php`:

```bash
sudo systemctl restart apache2
```

- Nginx config: `deploy/nginx/vps.prod.conf.example`
- Supervisor config:
  - `deploy/supervisor/laravel-app.conf`
  - `deploy/supervisor/laravel-worker.conf`
  - `deploy/supervisor/laravel-scheduler.conf`
  - `deploy/supervisor/laravel-rfid-bridge.conf`
- Opsi systemd (tanpa supervisor):
  - `deploy/systemd/edusmart-rfid-bridge.service`

Contoh aktivasi via Supervisor:

```bash
sudo cp deploy/supervisor/*.conf /etc/supervisor/conf.d/
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status edusmart-rfid-bridge
```

Contoh aktivasi via systemd:

```bash
sudo cp deploy/systemd/edusmart-rfid-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edusmart-rfid-bridge
sudo systemctl status edusmart-rfid-bridge --no-pager
```

## 8. Release & Rollback

- Checklist release produksi:
  - `docs/release-checklist.md`
- Rencana hardening dependency frontend:
  - `docs/dependency-security-plan.md`
- Script release otomatis:
  - `deploy/release-prod.sh`
- Script rollback cepat:
  - `deploy/rollback-prod.sh`
