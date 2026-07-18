# Cloudflare Pages Frontend Staging

Dokumen ini dipakai untuk memindahkan frontend SISMU ke Cloudflare Pages secara bertahap tanpa mengganggu VPS produksi.

## Target migrasi bertahap

- Frontend dilayani dari Cloudflare Pages.
- Backend/API/database/MQTT/worker/scheduler tetap berjalan di VPS melalui origin khusus `origin.sismu.biz.id`.
- `sismu.biz.id` apex dipindah paling akhir karena sebelumnya juga menjadi canonical backend/API host.
- Selama transisi, frontend di VPS boleh tetap ada sebagai rollback. Setelah apex stabil di Pages, serving frontend di VPS bisa dimatikan sehingga VPS menjadi backend-only.

## Status 4 Juli 2026

- `sismu.biz.id`, `www.sismu.biz.id`, `frontend.sismu.biz.id`, `demo.sismu.biz.id`, dan `sman3bogor.sismu.biz.id` sudah aktif di Cloudflare Pages.
- `sismu.biz.id` sudah CNAME ke `sismu-frontend-staging.pages.dev` dan proxied.
- `origin.sismu.biz.id` tetap DNS-only ke VPS untuk backend/API.
- Caddy di VPS sudah backend-only: route frontend seperti `/` dan `/assets/...` dibalas `404`, sedangkan `/api/*`, `/sanctum/*`, `/storage/*`, `/broadcasting/auth`, `/horizon/*`, dan `/up` tetap diteruskan ke backend.
- Rollback cepat DNS apex: ubah record `sismu.biz.id` kembali ke `A 103.191.63.170` proxied jika Pages perlu dikembalikan sementara.

## Alur deploy

Workflow: `.github/workflows/cloudflare-pages-staging.yml`

Trigger:

- manual dari GitHub Actions (`workflow_dispatch`)
- otomatis saat push ke branch `staging-cloudflare`

Alur:

1. Install dependency frontend.
2. Jalankan `npm run security:audit`.
3. Build frontend dengan `npm run build`.
4. Tambahkan header keamanan, proxy backend, dan SPA fallback ke output `dist`.
5. Buat project Cloudflare Pages jika belum ada.
6. Deploy `dist` ke Cloudflare Pages.

## Workflow Cloudflare Production

Frontend production dijalankan oleh `.github/workflows/cloudflare-pages-production.yml`.
Workflow ini hanya menerima push atau manual dispatch dari branch
`main` dan `backup/vps-ready-20260430`. Push ke `release/hybrid-rc1` tidak
langsung mengubah Cloudflare production.

Setelah backend VPS lulus workflow `CI`, workflow Cloudflare production:

1. memverifikasi release SHA;
2. menjalankan audit dependency, test frontend, dan legacy consumer gate;
3. membangun frontend dengan seluruh flag V2 production;
4. membuat Worker proxy API dan security headers;
5. mem-publish deployment production ke project Cloudflare Pages.

Konfigurasi wajib pada GitHub Environment `production`:

Secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_PAGES_EDGE_PROXY_SECRET`

Variables:

- `CLOUDFLARE_PAGES_PROJECT_NAME`
- `CLOUDFLARE_PAGES_PRODUCTION_BRANCH` (opsional, default `main`)
- `CLOUDFLARE_PAGES_LEGACY_LIVE_PROJECT` (set `true` hanya selama apex masih terikat ke project legacy)
- `CLOUDFLARE_PAGES_BACKEND_ORIGIN` (contoh `https://origin.sismu.biz.id`)
- `CLOUDFLARE_PAGES_PLATFORM_API_HOST` (contoh `sismu.biz.id`)
- `VITE_API_URL`
- `VITE_ROOT_DOMAIN`
- `VITE_ADMIN_SUBDOMAIN` (opsional, default `admin26`)
- `VITE_TENANT_SLUG` (opsional, default `tenant-a`)

Project production tidak boleh memakai nama project staging, test, atau
preview. Nilai origin production wajib memakai HTTPS. Secret tidak boleh
ditulis ke repository atau dikirim melalui chat.

## GitHub Secrets

Tambahkan di GitHub repository atau environment `cloudflare-pages-staging`:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `VITE_GOOGLE_CLIENT_ID` jika Google login frontend diaktifkan

Token Cloudflare minimal perlu akses Cloudflare Pages untuk account SISMU. Jangan commit token ke repo.

Branch `staging-cloudflare` khusus dipakai untuk deploy frontend ke Cloudflare Pages, sehingga tidak ikut jalur deploy VPS produksi.

## GitHub Variables

Tambahkan di GitHub environment `cloudflare-pages-staging` jika ingin override default:

- `CLOUDFLARE_PAGES_PROJECT_NAME=sismu-frontend-staging`
- `CLOUDFLARE_PAGES_BACKEND_ORIGIN=https://origin.sismu.biz.id`
- `CLOUDFLARE_PAGES_PLATFORM_API_HOST=sismu.biz.id`
- `CLOUDFLARE_PAGES_STAGING_API_URL=https://sismu.biz.id`
- `VITE_ROOT_DOMAIN=sismu.biz.id`
- `VITE_ADMIN_SUBDOMAIN=admin26`
- `VITE_REALTIME_POLL_MS=4000`
- `VITE_REALTIME_POLL_HIDDEN_MS=12000`
- `VITE_GOOGLE_AUTH_ENABLED=false`
- `VITE_GOOGLE_AUTH_LOGIN_URL=https://sismu.biz.id/api/auth/google/redirect`
- `VITE_GOOGLE_AUTH_LINK_URL=https://sismu.biz.id/api/auth/google/link`

Worker Cloudflare Pages mem-proxy path backend (`/api`, `/sanctum`, `/storage`, dan `/broadcasting/auth`) ke `origin.sismu.biz.id`. Host publik tetap diteruskan lewat header bertanda `X-Sismu-Forwarded-Host` dan `X-Sismu-Edge-Secret`, sehingga backend bisa membedakan tenant/admin tanpa perlu menjadikan apex sebagai origin API.

Untuk host utilitas platform seperti `sismu.biz.id`, `www.sismu.biz.id`, `frontend.sismu.biz.id`, dan `*.pages.dev`, Worker memakai `CLOUDFLARE_PAGES_PLATFORM_API_HOST=sismu.biz.id` sebagai konteks backend. Ini mencegah loop saat apex dipindah dari VPS ke Cloudflare Pages.

Catatan: path `/cdn-cgi/*` adalah path reserved Cloudflare dan tidak bisa diandalkan untuk diambil alih oleh Cloudflare Pages Worker. Jika DevTools menampilkan `POST /cdn-cgi/rum` dengan `404`, matikan Browser Insights/RUM di Cloudflare agar console publik tetap bersih. Monitoring performa utama SISMU tetap memakai endpoint internal `/api/observability/web-vitals`.

## Backend VPS

Pastikan env backend mengizinkan subdomain staging:

```env
SESSION_DOMAIN=.sismu.biz.id
SANCTUM_STATEFUL_DOMAINS=sismu.biz.id,*.sismu.biz.id,admin26.sismu.biz.id
CORS_ALLOWED_ORIGIN_PATTERNS=#^https://([a-z0-9-]+\.)?sismu\.biz\.id$#
```

Dengan konfigurasi ini, `frontend.sismu.biz.id` masih satu site dengan API `sismu.biz.id`, sehingga cookie Sanctum/CSRF tetap bisa dipakai.

## Checklist uji

- Login Admin Sekolah.
- Login Guru.
- Login Siswa.
- Buka halaman dashboard masing-masing role.
- Tes upload kecil dan export PDF.
- Tes Web Vitals tetap terkirim ke `/api/observability/web-vitals`.
- Pastikan Console browser tidak ada error CSP/CORS/CSRF.
- Jalankan `npm run smoke:public` untuk cek halaman publik, CSRF, API health, asset utama, CSP, dan endpoint Cloudflare RUM. Jika Browser Insights sengaja tetap aktif, jalankan dengan `SMOKE_REQUIRE_CLOUDFLARE_RUM_CLEAN=false`.

## Cutover produksi bertahap

Setelah staging stabil:

1. Arahkan tenant/subdomain non-apex ke Cloudflare Pages lebih dulu, contoh `frontend`, `www`, `demo`, dan domain sekolah. Selesai 4 Juli 2026.
2. Pastikan login Admin Sekolah/Guru/Siswa, upload kecil, export PDF, Web Vitals, `/api/mobile/schools`, webhook, dan `/sanctum/csrf-cookie` normal dari host Pages.
3. Pindahkan `sismu.biz.id` apex ke Cloudflare Pages setelah Worker API dipastikan memakai `origin.sismu.biz.id`, bukan apex. Selesai 4 Juli 2026.
4. Ubah VPS menjadi backend-only dan hapus/disable serving frontend lama dari konfigurasi web server. Selesai di lapisan Caddy 4 Juli 2026.
5. Pantau error/login/upload selama masa stabilisasi. Frontend static masih ada di image Nginx lama, tetapi tidak lagi reachable karena Caddy memblokir route frontend.
