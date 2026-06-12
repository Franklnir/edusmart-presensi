# Production Deploy Guide (VPS)

Dokumen ini untuk menyiapkan EduSmart ke mode produksi nyata di VPS (`DigitalOcean`, `IDCloudHost`, dll).

## 0. Local Preview yang Mirip Production

Repo ini juga sudah disiapkan agar local preview memakai stack yang hampir sama dengan production:

- `caddy` di depan untuk HTTP/HTTPS
- `nginx` internal-only
- `backend`, `worker`, `scheduler`, `redis`, `postgres`
- `evolution_api` tetap lewat host terpisah bila dipakai

Default local yang sudah disiapkan di `.env.production`:

- `https://localhost:8443`
- `https://admin26.localhost:8443`
- `https://bali.localhost:8443`
- `https://wa.localhost:8443`

Production compose sekarang memakai image prebuilt dari GitHub Container Registry. Untuk preview lokal production, set dulu image yang mau diuji:

```bash
export EDUSMART_BACKEND_IMAGE=ghcr.io/<org>/<repo>/backend:<tag>
export EDUSMART_NGINX_IMAGE=ghcr.io/<org>/<repo>/nginx:<tag>
docker compose --env-file .env.production -f docker-compose.prod.yml pull backend nginx
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build
```

Catatan local:

- Browser bisa menampilkan warning sertifikat saat pertama kali membuka `https://*.localhost:8443` karena Caddy memakai local CA/internal certificate untuk host lokal.
- Setelah warning diterima di browser, alur cookie, session, dan subdomain akan jauh lebih mirip production dibanding mode HTTP biasa.
- Untuk domain publik asli di VPS, Caddy tetap memakai on-demand TLS, jadi custom domain tenant/admin tetap bisa otomatis mendapatkan sertifikat HTTPS setelah DNS diarahkan dengan benar.
- Host lokal default seperti `localhost`, `admin.localhost`, `admin26.localhost`, `bali.localhost`, `demo.localhost`, dan `wa.localhost` sekarang dibuat eksplisit agar browser dan tool CLI lokal lebih konsisten saat memeriksa nama sertifikat.

## 1. Prasyarat

- Domain aktif (contoh: `sismu.biz.id`)
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
- `NGINX_HTTP_PORT` (port HTTP publik, sekarang diexpose oleh `caddy`)
- `CADDY_HTTPS_PORT` (default `443`)
- `CADDY_HTTPS_PORT_SUFFIX` (kosongkan di production normal; isi misalnya `:8443` jika preview lokal pakai port non-standar)
- `CADDY_ACME_EMAIL`
- `CADDY_ASK_SECRET`
- `CADDY_EVOLUTION_HOST` (opsional, biasanya sama dengan host di `EVOLUTION_PUBLIC_URL`)
- `VITE_API_URL` (boleh dikosongkan untuk mode same-origin / 1 VPS)
- `VITE_ADMIN_SUBDOMAIN`
- `SANCTUM_STATEFUL_DOMAINS`
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOWED_ORIGIN_PATTERNS` (jika pakai subdomain tenant)
- `TENANT_ROOT_DOMAIN`
- `TENANT_ADMIN_SUBDOMAIN` (contoh: `admin26`)
- `TENANT_PUBLIC_SCHEME`
- `TENANT_DNS_A_RECORD` atau `TENANT_DNS_CNAME_TARGET`
- `SUPER_ADMIN_EMAILS`
- `SUPER_ADMIN_BOOTSTRAP_PASSWORD` (opsional untuk fresh install agar akun super admin dibuat otomatis)
- `TENANT_RESERVED` (pastikan mengandung `admin` dan `admin26`)
- `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`
- `EVOLUTION_PUBLIC_URL`, `EVOLUTION_API_KEY`
- `EVOLUTION_DB_PASSWORD`, `EVOLUTION_REDIS_PASSWORD`
- `RFID_SCAN_SHARED_KEY` (opsional tapi direkomendasikan)
- `RFID_MQTT_BRIDGE_ENABLED`
- `RFID_MQTT_HOST`, `RFID_MQTT_PORT`, `RFID_MQTT_USERNAME`, `RFID_MQTT_PASSWORD`

3. Generate `APP_KEY`:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend php artisan key:generate --show
```

## 3. Jalankan Stack Production

Deploy normal production dilakukan oleh GitHub Actions. Workflow membuild image backend dan nginx di GitHub, lalu VPS hanya pull image dan menjalankan container tanpa build lokal.

Untuk menjalankan manual di VPS, pastikan `EDUSMART_BACKEND_IMAGE` dan `EDUSMART_NGINX_IMAGE` mengarah ke image registry yang sudah ada, lalu jalankan:

```bash
deploy/release-prod.sh --ref <commit-or-tag> --pull-images
```

Catatan:

- Stack ini sudah dirapikan untuk VPS kecil: React dibuild di GitHub saat image `nginx` dibuat, lalu hasil static build diserve langsung oleh Nginx yang sama.
- Tidak ada container `frontend` runtime terpisah.
- `caddy` sekarang menjadi edge proxy publik untuk auto HTTPS, sedangkan `nginx` tetap internal-only.
- Untuk update frontend/backend, push ke branch deploy agar GitHub Actions membuild image baru dan deploy script VPS melakukan pull image.

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

Jika output kosong, image backend yang dipakai belum valid. Re-run GitHub Actions build image backend, lalu deploy ulang:

```bash
deploy/release-prod.sh --ref <commit-or-tag> --pull-images
```

### Preset VPS 4 Core / 4 GB

Untuk VPS 4 core / 4 GB RAM, preset ini tetap menyalakan semua fitur: aplikasi utama, database, Redis, Nginx, Caddy, worker, scheduler, RFID/MQTT, dan WhatsApp/Evolution. Override `docker-compose.prod.4gb.yml` tetap memberi batas RAM/CPU agar service tambahan tidak mengambil resource berlebihan dari aplikasi utama.

Isi ini di `.env.production` pada VPS:

```dotenv
EDUSMART_COMPOSE_FILES=docker-compose.prod.yml:docker-compose.prod.4gb.yml
COMPOSE_PROFILES=rfid,whatsapp
EDUSMART_APP_SERVICES="backend worker scheduler mosquitto mosquitto_reloader rfid_bridge evolution_postgres evolution_redis evolution_api nginx caddy"
EDUSMART_CORE_HEALTH_SERVICES="postgres redis backend worker scheduler mosquitto rfid_bridge evolution_postgres evolution_redis evolution_api nginx caddy"
REDIS_MAXMEMORY=384mb
PHP_FPM_PM_MAX_CHILDREN=12
AUTH_IP_RATE_LIMIT_PER_MINUTE=180
```

Lalu deploy seperti biasa:

```bash
deploy/release-prod.sh --ref <commit-or-tag> --pull-images
```

Catatan kapasitas: 4 GB masih bisa dipakai sebagai awal, tetapi saat siswa aktif sudah sering 300+ bersamaan atau WhatsApp/RFID mulai ramai, upgrade ke 8 GB akan jauh lebih lega dan lebih stabil.

## 3.0 Bootstrap Super Admin Fresh Install

Untuk database fresh, isi env ini sebelum first deploy:

- `SUPER_ADMIN_EMAILS=admin26@domain-kamu`
- `SUPER_ADMIN_BOOTSTRAP_PASSWORD=<password-kuat>`
- opsional: `SUPER_ADMIN_BOOTSTRAP_NAME`, `SUPER_ADMIN_BOOTSTRAP_ID`

Saat container `backend` start setelah migrasi, entrypoint menjalankan `php artisan super-admin:bootstrap` otomatis. Password tidak dicetak ke log. Setelah akun ada, `SUPER_ADMIN_BOOTSTRAP_PASSWORD` boleh dikosongkan lagi; deploy berikutnya tidak akan reset password kecuali `SUPER_ADMIN_BOOTSTRAP_FORCE=true`.

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
2. Isi **Authorized redirect URIs**:
   - `https://sismu.biz.id/api/auth/google/callback`
   - jika pakai host callback lain, samakan dengan `GOOGLE_REDIRECT_URI`.
3. Bagian **Authorized JavaScript origins** tidak wajib untuk flow login aktif sekarang, karena popup memakai OAuth redirect backend. Jika masih melihat `Error 400: origin_mismatch`, deploy frontend terbaru dan pastikan tombol Google tidak lagi memuat Google Identity Services.
4. Set env di `.env.production`:
   - `VITE_GOOGLE_AUTH_ENABLED=true`
   - `VITE_GOOGLE_AUTH_LOGIN_URL=/api/auth/google/redirect`
   - `VITE_GOOGLE_AUTH_LINK_URL=/api/auth/google/link`
   - `GOOGLE_AUTH_ENABLED=true`
   - `GOOGLE_CLIENT_ID=<client-id-google>`
   - `GOOGLE_CLIENT_SECRET=<client-secret-google>`
   - `GOOGLE_REDIRECT_URI=https://sismu.biz.id/api/auth/google/callback`
5. Reload config + restart service:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan config:clear
deploy/release-prod.sh --ref <commit-or-tag> --pull-images
```

Catatan multi-tenant:
- Gunakan URL Google frontend yang relatif (`/api/auth/google/...`) agar otomatis mengikuti host tenant aktif.
- Pastikan `GOOGLE_REDIRECT_URI` memakai root domain publik yang sama dengan `VITE_ROOT_DOMAIN`, misalnya `https://sismu.biz.id/api/auth/google/callback`.

## 3.2.1 Object Storage untuk Upload File

Untuk sekolah dengan upload ramai, aktifkan signed direct upload agar file siswa/guru/admin langsung dikirim dari browser ke bucket Nevaobjects S3 atau S3-compatible lain. Backend tetap mengecek role, path, tipe file, ukuran file, dan kuota sekolah sebelum membuat signed URL, lalu hanya menyimpan metadata file.

Bucket direct upload default:

- `assignments` untuk tugas dan lampiran tugas.
- `quiz-media` untuk gambar quiz.
- `certificates`, `sertifikat-files`, `certificate-templates`, `sertifikat-templates` untuk sertifikat dan template.

Google Drive tetap dapat dipakai sebagai integrasi/backup, tetapi jalur upload massal sebaiknya memakai object storage agar bandwidth file tidak melewati PHP app server.

Contoh env Nevaobjects S3:

```dotenv
APP_OBJECT_STORAGE_ENABLED=true
APP_DIRECT_UPLOAD_ENABLED=true
APP_DIRECT_UPLOAD_BROWSER_ENABLED=true
APP_DIRECT_UPLOAD_BUCKETS=assignments,quiz-media,certificates,sertifikat-files,certificate-templates,sertifikat-templates
APP_OBJECT_STORAGE_LABEL="Nevaobjects S3"
APP_OBJECT_STORAGE_ACCESS_KEY_ID=<access-key>
APP_OBJECT_STORAGE_SECRET_ACCESS_KEY=<secret-key>
APP_OBJECT_STORAGE_REGION=us-east-1
APP_OBJECT_STORAGE_ENDPOINT=https://s3.nevaobjects.id
APP_OBJECT_STORAGE_USE_PATH_STYLE_ENDPOINT=true
APP_OBJECT_STORAGE_CAPACITY_GB=100
APP_DIRECT_UPLOAD_EXPIRES_SECONDS=900
APP_DIRECT_UPLOAD_VERIFY_OBJECTS=true

APP_OBJECT_STORAGE_BUCKET_ASSIGNMENTS=assignments
APP_OBJECT_STORAGE_BUCKET_QUIZ_MEDIA=quiz-media
APP_OBJECT_STORAGE_BUCKET_CERTIFICATES=certificates
APP_OBJECT_STORAGE_BUCKET_SERTIFIKAT_FILES=sertifikat-files
APP_OBJECT_STORAGE_BUCKET_CERTIFICATE_TEMPLATES=certificate-templates
APP_OBJECT_STORAGE_BUCKET_SERTIFIKAT_TEMPLATES=sertifikat-templates
```

`APP_OBJECT_STORAGE_CAPACITY_GB` dipakai Storage Manager Super Admin untuk menampilkan total paket Nevaobjects S3, sisa kapasitas setelah kuota dibagikan, dan monitoring penggunaan platform.

Env lama `ASSIGNMENT_DIRECT_UPLOAD_*` masih didukung untuk kompatibilitas, tetapi deploy baru disarankan memakai `APP_DIRECT_UPLOAD_*`.

Jika provider/panel object storage tidak menyediakan CORS bucket, gunakan mode relay backend agar file tetap masuk Nevaobjects tanpa error CORS di browser:

```dotenv
APP_OBJECT_STORAGE_ENABLED=true
APP_DIRECT_UPLOAD_ENABLED=false
APP_DIRECT_UPLOAD_BROWSER_ENABLED=false
```

Mode ini sedikit lebih berat untuk backend dibanding signed direct upload, tetapi lebih rapi daripada membiarkan browser gagal preflight CORS. Setelah CORS bucket tersedia, ubah `APP_DIRECT_UPLOAD_ENABLED=true` dan `APP_DIRECT_UPLOAD_BROWSER_ENABLED=true`.

Bucket harus private dan CORS bucket perlu mengizinkan domain sekolah:

- Method: `PUT`, `GET`, `HEAD`
- Header: `Content-Type` atau `*`
- Origin: root domain dan subdomain tenant yang dipakai, misalnya `https://sismu.biz.id`, `https://admin26.sismu.biz.id`, dan `https://sman3bogor.sismu.biz.id`. Untuk produksi, pakai origin eksplisit dan hindari wildcard.
- Expose header: `ETag`, `Content-Length`

Jika bucket CORS belum siap, browser akan menolak preflight `OPTIONS` ke Nevaobjects. Aplikasi tetap menyediakan fallback aman lewat backend: file dikirim ke API terlebih dahulu, lalu backend meneruskan ke object storage jika konfigurasi S3 aktif. Jalur tercepat tetap signed direct upload, jadi CORS bucket tetap perlu dibereskan untuk performa terbaik saat banyak siswa upload bersamaan.

## 3.3 Konfigurasi RFID MQTT Bridge

Service bridge di `docker-compose.prod.yml` bernama `rfid_bridge` dan akan auto-restart.
Broker default sekarang memakai Mosquitto open source yang dideploy sebagai service `mosquitto`.

Pastikan env ini terisi:

- `RFID_MQTT_BRIDGE_ENABLED=true`
- `RFID_MOSQUITTO_PUBLIC_HOST=mqtt.sismu.biz.id`
- `RFID_MOSQUITTO_BRIDGE_PASSWORD=<password-panjang-random>`
- `RFID_MQTT_HOST=` dikosongkan agar global fallback tidak dipakai lintas sekolah.
- `RFID_MQTT_SCAN_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/scan`
- `RFID_MQTT_RESPONSE_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/response`
- `RFID_MQTT_MODE_TOPIC_TEMPLATE=edusmart/{tenant}/rfid/mode`

Setelah service aktif, buka Super Admin > Detail Sekolah > `Pakai Mosquitto`
untuk membuat username/password dan ACL topic khusus sekolah tersebut.

Jalankan/refresh service bridge:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build mosquitto_init mosquitto mosquitto_reloader backend rfid_bridge
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend php artisan rfid:mosquitto-sync
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f rfid_bridge
```

Detail isolasi topic, ACL, dan provision dari Super Admin ada di `docs/mosquitto-rfid-multi-tenant.md`.

## 3.4 Konfigurasi WhatsApp Multi-Tenant (Evolution API)

Stack production ini mendukung pola `1 VPS, banyak container`, jadi EduSmart tetap terpisah dari service WhatsApp:

- `backend`, `worker`, `scheduler`, `nginx`
- `evolution_api`, `evolution_postgres`, `evolution_redis`

Isi env minimal:

- `EVOLUTION_PUBLIC_URL=https://wa.sismu.biz.id`
- `CADDY_EVOLUTION_HOST=wa.sismu.biz.id`
- `EVOLUTION_API_KEY=<apikey server Evolution>`
- `EVOLUTION_DB_PASSWORD=<password postgres khusus Evolution>`
- `EVOLUTION_REDIS_PASSWORD=<password redis khusus Evolution>`
- `EVOLUTION_API_WEBHOOK_BASE_URL=https://sismu.biz.id`

Catatan operasional:

- QR WhatsApp admin sekolah akan ditampilkan di menu `Admin > WhatsApp` pada EduSmart, bukan di dashboard Evolution terpisah.
- Session WhatsApp disimpan persisten di volume `evolution_instances`.
- Sinkron status koneksi dijalankan oleh webhook dan scheduler Laravel, jadi state `logout` atau `disconnect` tidak mudah nyangkut.
- Jika butuh Manager UI Evolution, jalankan terpisah sebagai service tambahan; untuk alur EduSmart saat ini, API saja sudah cukup.

Jalankan atau refresh service WhatsApp:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d evolution_postgres evolution_redis evolution_api backend worker scheduler
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f evolution_api
```

## 4. TLS/HTTPS

Stack production sekarang memakai `caddy` langsung di dalam `docker-compose.prod.yml`.
Jadi alurnya:

- `caddy` menerima trafik publik di port `80/443`
- `caddy` melakukan redirect HTTP ke HTTPS
- `caddy` menerbitkan sertifikat otomatis untuk host yang disetujui backend
- `nginx` tetap melayani SPA + Laravel API di jaringan internal Docker

Env minimal untuk mode ini:

- `CADDY_ACME_EMAIL=ops@domain-kamu`
- `CADDY_ASK_SECRET=<secret-acak-panjang>`
- `CADDY_EVOLUTION_HOST=wa.domain-kamu`
- `TENANT_PUBLIC_SCHEME=https`

Catatan:

- Endpoint verifikasi TLS internal ada di `api/internal/tls/authorize` dan dilindungi secret.
- Host yang bisa dapat sertifikat otomatis hanyalah host admin, host tenant bawaan yang valid, dan custom domain tenant/admin yang memang terdaftar.
- Jika `CADDY_EVOLUTION_HOST` diisi, host itu juga akan diarahkan ke `evolution_api` lewat edge proxy yang sama.
- Kalau kamu preview lokal dengan port HTTPS non-standar, isi `CADDY_HTTPS_PORT_SUFFIX` agar redirect dari HTTP tidak salah port.

## 4.1 Domain Policy (Rekomendasi Profesional)

- Root domain tenant: `sismu.biz.id`
- Tenant sekolah: `bali.sismu.biz.id`, `jakarta.sismu.biz.id`, dst
- Panel super admin: `admin26.sismu.biz.id`

Set env:

- `TENANT_ROOT_DOMAIN=sismu.biz.id`
- `TENANT_ADMIN_SUBDOMAIN=admin26`
- `TENANT_RESERVED=www,app,api,admin,admin26`
- `TENANT_ALLOW_ROOT_FOR_SUPER_ADMIN=false`

Catatan:

- Endpoint `api/super/*` hanya bisa diakses dari domain admin.
- Login akun super admin hanya di domain admin.
- Login user sekolah (admin/guru/siswa tenant) ditolak jika mencoba login dari domain admin.
- Buat DNS eksplisit per host tenant aktif, misalnya `bali.sismu.biz.id`, dan hindari wildcard DNS production.
- Untuk skala kecil sampai menengah, `caddy` on-demand TLS sudah cukup nyaman.
- Jika nanti tenant bawaan bertambah sangat cepat, gunakan otomasi DNS eksplisit atau custom domain onboarding, bukan membuka wildcard publik tanpa kontrol.

## 4.2 Domain Onboarding dari Super Admin

Setelah server dasar jadi, tenant tidak perlu setup kode lagi untuk domain baru.

Alur yang direkomendasikan:

1. Beli domain di registrar mana saja.
2. Arahkan DNS domain itu ke target yang sama dengan server EduSmart:
   - isi `TENANT_DNS_A_RECORD=<IP-VPS>` jika pakai A record langsung, atau
   - isi `TENANT_DNS_CNAME_TARGET=<host-reverse-proxy-kamu>` jika pakai CNAME.
3. Login ke panel super admin lalu buka `Panel Super Admin > Tenants`.
4. Tambahkan:
   - `Custom Host Super Admin` untuk domain panel seperti `panel.grupkamu.id`
   - `Custom Domain Tenant` untuk sekolah seperti `smabali.sch.id`
5. Klik `Cek DNS` sampai status menjadi `ready`.

Catatan penting:

- Subdomain tenant bawaan seperti `bali.sismu.biz.id` tetap otomatis aktif dari slug tenant setelah DNS host itu diarahkan ke VPS.
- Custom domain di aplikasi ini dibuat provider-agnostic, jadi tetap bisa dipakai walau registrar/domain provider kamu berbeda-beda.
- Setelah DNS diarahkan dan host sudah terdaftar di panel, sertifikat HTTPS akan diterbitkan otomatis oleh `caddy` saat domain pertama kali diakses.
- Jika nanti kamu pindah ke provider DNS yang punya API publik, otomasi create/update DNS bisa ditambahkan tanpa mengubah alur tenant di panel.

### Contoh domain tenant

- Tenant bawaan cepat: `smabali.sismu.biz.id`
- Domain sekolah sendiri: `portal.smabali.sch.id`
- Panel super admin: `admin26.sismu.biz.id`
- Host WhatsApp/Evolution: `wa.sismu.biz.id`

## 4.3 Alur Saat Sekolah Baru Berlangganan

Cara paling aman dan cepat saat ada sekolah baru masuk:

1. Buat tenant baru dari panel super admin dengan `nama sekolah`, `slug`, `admin sekolah`, dan `email admin`.
2. Buat DNS eksplisit untuk subdomain bawaan, misalnya `smabali.sismu.biz.id`, ke IP VPS.
3. Tenant aktif di subdomain bawaan itu setelah DNS mengarah dan sertifikat HTTPS terbit.
4. Kirim URL bawaan itu ke sekolah agar mereka bisa mulai onboarding tanpa menunggu domain mereka sendiri selesai.
5. Jika sekolah ingin domain khusus, tambahkan dari detail tenant di kartu `Domain & DNS Tenant`.
6. Minta pihak sekolah mengarahkan DNS domain mereka ke target yang tampil di kartu `Target DNS Default`.
7. Klik `Cek DNS` sampai status `ready`.

Rekomendasi praktis:

- Pakai subdomain bawaan dulu untuk sekolah baru agar aktivasi cepat.
- Jadikan custom domain sebagai upgrade branding setelah tenant aktif.
- Simpan host admin tetap terpisah agar panel super admin tidak tercampur dengan portal tenant.

## 5. Operasional Harian

Logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f nginx
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f worker
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f rfid_bridge
```

Restart service tertentu:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart caddy backend nginx worker scheduler rfid_bridge
```

## 6. Hardening Minimum

- `APP_ENV=production`
- `APP_DEBUG=false`
- `TRUSTED_PROXIES` diisi network proxy/reverse-proxy yang valid (jangan biarkan wildcard di internet publik)
- password user/admin mengikuti kebijakan kuat minimal 12 karakter dengan huruf besar, huruf kecil, angka, dan simbol
- `SESSION_SECURE_COOKIE=true`
- `SESSION_ENCRYPT=true`
- `AUTH_RATE_LIMIT_PER_MINUTE=12`
- `AUTH_IP_RATE_LIMIT_PER_MINUTE=180`
- `AUTH_LOGIN_MAX_ATTEMPTS=5`
- `PHP_FPM_PM_MAX_CHILDREN=12` untuk VPS 4 GB sebagai titik awal aman
- `STORAGE_WRITE_RATE_LIMIT_PER_MINUTE=90`
- `STORAGE_READ_RATE_LIMIT_PER_MINUTE=180`
- `STORAGE_GUEST_RATE_LIMIT_PER_MINUTE=60`
- `TENANT_ALLOW_HEADER_OVERRIDE=false`
- validasi `CORS_ALLOWED_ORIGINS` hanya domain produksi kamu (jangan localhost di production)
- password DB/Redis kuat dan unik
- hanya expose port yang perlu (`80/443`)
- backup DB terjadwal
- password Evolution DB/Redis berbeda dari DB/Redis utama aplikasi
- `EVOLUTION_API_KEY` hanya disimpan di backend/worker/scheduler, jangan expose ke build frontend

Catatan:

- `deploy/caddy/Caddyfile` sekarang menjadi edge config utama untuk auto HTTPS dan on-demand cert issuance.
- `deploy/nginx/gateway.prod.conf` sudah diberi rate-limit tambahan untuk `/api/auth/*` dan `/api/*` sebagai lapisan proteksi brute-force di edge.
- `nginx` sekarang menjadi internal web layer untuk SPA + Laravel API, sementara `caddy` menangani TLS dan host routing di depan.
- Endpoint file sekarang pakai signed URL dengan masa berlaku + validasi signature untuk akses guest.
- `deploy/release-prod.sh` sekarang menjalankan health check internal setiap deploy: container inti, endpoint `/api/health`, dan koneksi Laravel ke database.
- Jika health check internal gagal setelah service diganti, script release otomatis rollback aplikasi ke ref dan image sebelumnya. Backup database pre-release tetap tersedia untuk restore manual bila benar-benar diperlukan.
- Jalankan `deploy/scripts/prod_smoke_check.sh` setelah deploy untuk cek tambahan dari sisi DNS/HTTPS publik dan status container lengkap.

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
