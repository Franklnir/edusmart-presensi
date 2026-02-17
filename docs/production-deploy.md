# Production Deploy Guide (VPS)

Dokumen ini untuk menyiapkan EduSmart ke mode produksi nyata di VPS (`DigitalOcean`, `IDCloudHost`, dll).

## 1. Prasyarat

- Domain aktif (contoh: `edusmart.example.com`)
- VPS Ubuntu 22.04+
- Docker + Docker Compose plugin terpasang
- Port `80` dan `443` dibuka
- Untuk deploy native (tanpa Docker), gunakan PHP `8.4+`

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
```

Restart service tertentu:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart backend backend_nginx worker scheduler
```

## 6. Hardening Minimum

- `APP_ENV=production`
- `APP_DEBUG=false`
- `SESSION_SECURE_COOKIE=true`
- `AUTH_RATE_LIMIT_PER_MINUTE=12`
- `AUTH_IP_RATE_LIMIT_PER_MINUTE=90`
- `AUTH_LOGIN_MAX_ATTEMPTS=5`
- password DB/Redis kuat dan unik
- hanya expose port yang perlu (`80/443`)
- backup DB terjadwal

## 7. Deploy Native (Tanpa Docker)

Jika kamu deploy native service di VPS:

- Nginx config: `deploy/nginx/vps.prod.conf.example`
- Supervisor config:
  - `deploy/supervisor/laravel-app.conf`
  - `deploy/supervisor/laravel-worker.conf`
  - `deploy/supervisor/laravel-scheduler.conf`
