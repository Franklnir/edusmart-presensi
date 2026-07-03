# Cloudflare Pages Frontend Staging

Dokumen ini dipakai untuk memindahkan frontend SISMU ke Cloudflare Pages secara bertahap tanpa mengganggu VPS produksi.

## Target tahap awal

- Frontend staging dilayani dari Cloudflare Pages.
- Backend/API/database/MQTT/worker/scheduler tetap berjalan di VPS.
- Domain produksi `sismu.biz.id` tetap ke VPS sampai hasil staging sudah lolos uji login dan alur utama.
- Domain staging yang disarankan: `frontend.sismu.biz.id` atau `app-staging.sismu.biz.id`.

## Alur deploy

Workflow: `.github/workflows/cloudflare-pages-staging.yml`

Trigger:

- manual dari GitHub Actions (`workflow_dispatch`)
- otomatis saat push ke branch `staging-cloudflare`

Alur:

1. Install dependency frontend.
2. Jalankan `npm run security:audit`.
3. Build frontend dengan `npm run build`.
4. Tambahkan header keamanan dan SPA fallback ke output `dist`.
5. Buat project Cloudflare Pages jika belum ada.
6. Deploy `dist` ke Cloudflare Pages.

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
- `CLOUDFLARE_PAGES_STAGING_API_URL=https://sismu.biz.id`
- `VITE_ROOT_DOMAIN=sismu.biz.id`
- `VITE_ADMIN_SUBDOMAIN=admin26`
- `VITE_REALTIME_POLL_MS=4000`
- `VITE_REALTIME_POLL_HIDDEN_MS=12000`
- `VITE_GOOGLE_AUTH_ENABLED=false`
- `VITE_GOOGLE_AUTH_LOGIN_URL=https://sismu.biz.id/api/auth/google/redirect`
- `VITE_GOOGLE_AUTH_LINK_URL=https://sismu.biz.id/api/auth/google/link`

Untuk staging Cloudflare Pages, API URL sengaja diarahkan absolut ke VPS. Jangan gunakan path relatif untuk Google redirect/link karena frontend berada di host yang berbeda.

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

## Cutover produksi

Setelah staging stabil:

1. Buat workflow production atau ubah project Pages staging menjadi production.
2. Pindahkan `sismu.biz.id`/`www.sismu.biz.id` ke Cloudflare Pages.
3. Pertahankan frontend VPS sebagai fallback selama beberapa hari.
4. Backend tetap di VPS dan tetap dilindungi Cloudflare/WAF.
