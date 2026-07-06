# AI Deployment Handoff SISMU

Dokumen ini adalah peta cepat untuk AI/agent lain yang masuk ke repo SISMU. Tujuannya agar agent paham bahwa repo ini satu monorepo, tetapi alur deploy backend dan frontend sudah dipisah:

- Backend/API tetap auto deploy ke VPS lewat GitHub Actions.
- Frontend SISMU dilayani dari Cloudflare Pages.
- VPS dipertahankan sebagai backend/API, worker, scheduler, database, Redis, MQTT/RFID, dan service pendukung.

Jangan simpan token, private key, atau secret Cloudflare/GitHub/VPS ke file repo.

## Repo Dan Branch

Branch production VPS yang dipakai:

```text
backup/vps-ready-20260430
```

Branch khusus frontend Cloudflare Pages:

```text
staging-cloudflare
```

Branch `staging-cloudflare` dipakai untuk deploy frontend ke Cloudflare Pages dan tidak menjalankan deploy VPS. Branch `backup/vps-ready-20260430`, `main`, dan `staging` menjalankan pipeline VPS bila push berhasil dan semua quality gate hijau.

Repo tetap satu monorepo. Jangan pecah frontend/backend ke repo lain tanpa keputusan eksplisit.

## Arsitektur Produksi

Komponen utama:

- React/Vite frontend berada di `src/`, `public/`, `index.html`, dan dibuild dengan `npm run build`.
- Laravel backend berada di `backend/`.
- Docker production memakai `docker-compose.prod.yml`.
- Reverse proxy/WAF VPS memakai Caddy di `deploy/caddy/Caddyfile`.
- Deploy VPS memakai script `deploy/release-prod.sh`.
- Frontend Cloudflare Pages memakai workflow `.github/workflows/cloudflare-pages-staging.yml`.
- Backend/VPS CI/CD memakai workflow `.github/workflows/ci.yml`.

Status arsitektur berdasarkan dokumen repo:

- `sismu.biz.id`, `www.sismu.biz.id`, `frontend.sismu.biz.id`, `demo.sismu.biz.id`, dan tenant seperti `sman3bogor.sismu.biz.id` diarahkan ke Cloudflare Pages.
- `origin.sismu.biz.id` tetap menjadi origin DNS-only ke VPS untuk backend/API.
- Caddy di VPS dibuat backend-only: route frontend seperti `/` dan `/assets/...` dibalas `404`, sedangkan route backend tetap diteruskan.
- Cloudflare Pages Worker mem-proxy route backend seperti `/api`, `/sanctum`, `/storage`, dan `/broadcasting/auth` ke `origin.sismu.biz.id`.

Sebelum mengubah DNS/Cloudflare, cek kondisi live lagi karena DNS dan Cloudflare bisa berubah di panel.

## Backend Auto Deploy Ke VPS

Workflow:

```text
.github/workflows/ci.yml
```

Trigger:

- Semua push dan pull request menjalankan quality gate.
- Push atau manual `workflow_dispatch` ke `main`, `backup/vps-ready-20260430`, atau `staging` akan build image release dan deploy VPS.

Urutan job utama:

1. `Secret Preflight`: cek file env/docs agar tidak ada secret email bocor.
2. `Frontend Build`: `npm ci`, `npm run security:audit`, `npm run check`.
3. `Backend Test And Pint`: composer install, `php artisan test`, `./vendor/bin/pint --test`.
4. `Build Release Images`: build dan push image `backend`, `nginx`, dan `caddy` ke GHCR.
5. `Deploy To VPS`: SSH ke VPS, transfer image release, lalu jalankan `deploy/release-prod.sh`.

Mapping environment:

- `staging` -> GitHub environment `staging`.
- `main` dan `backup/vps-ready-20260430` -> GitHub environment `production`.

Secrets VPS yang dibutuhkan di GitHub Actions:

```text
VPS_HOST
VPS_PORT
VPS_USER
VPS_SSH_PRIVATE_KEY
VPS_APP_DIR
```

Catatan penting:

- VPS tidak membuild image production. Image dibuat di GitHub Actions.
- Workflow mengirim image release ke VPS dengan `docker save | ssh | docker load`.
- Script deploy menjalankan migration, cache clear, health check, dan rollback otomatis jika deploy gagal setelah service diganti.
- `.env.production` tinggal di VPS, bukan di repo.

Perintah pantau deploy:

```bash
gh run list --branch backup/vps-ready-20260430 --limit 5
gh run watch <run-id> --exit-status
```

## Frontend Deploy Ke Cloudflare Pages

Workflow:

```text
.github/workflows/cloudflare-pages-staging.yml
```

Trigger:

- Push ke branch `staging-cloudflare`.
- Manual `workflow_dispatch`.
- Path frontend/workflow saja yang memicu deploy otomatis.

Urutan job:

1. `npm ci`.
2. `npm run security:audit`.
3. `npm run build`.
4. Generate `dist/_headers`, `dist/_redirects`, dan `dist/_worker.js`.
5. Pastikan project Cloudflare Pages ada.
6. Deploy `dist` dengan Wrangler.

Secrets Cloudflare yang dibutuhkan:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
CLOUDFLARE_PAGES_EDGE_PROXY_SECRET
VITE_GOOGLE_CLIENT_ID        # hanya jika Google login frontend aktif
```

Variables Cloudflare Pages/GitHub environment yang umum:

```text
CLOUDFLARE_PAGES_PROJECT_NAME=sismu-frontend-staging
CLOUDFLARE_PAGES_BACKEND_ORIGIN=https://origin.sismu.biz.id
CLOUDFLARE_PAGES_PLATFORM_API_HOST=sismu.biz.id
CLOUDFLARE_PAGES_STAGING_API_URL=https://sismu.biz.id
VITE_ROOT_DOMAIN=sismu.biz.id
VITE_ADMIN_SUBDOMAIN=admin26
VITE_REALTIME_POLL_MS=4000
VITE_REALTIME_POLL_HIDDEN_MS=12000
VITE_GOOGLE_AUTH_ENABLED=false
VITE_GOOGLE_AUTH_LOGIN_URL=https://sismu.biz.id/api/auth/google/redirect
VITE_GOOGLE_AUTH_LINK_URL=https://sismu.biz.id/api/auth/google/link
```

Jangan hardcode token Cloudflare di repo. Simpan hanya di GitHub Secrets atau Cloudflare dashboard.

Perintah pantau deploy Cloudflare Pages:

```bash
gh run list --workflow "Staging Cloudflare" --branch staging-cloudflare --limit 5
gh run watch <run-id> --exit-status
```

## Cara Kerja Saat Ada Perubahan

Jika perubahan hanya backend/API:

1. Edit kode backend.
2. Jalankan test backend.
3. Push ke branch production/staging VPS sesuai target.
4. Pantau workflow `CI`.

Jika perubahan hanya frontend:

1. Edit `src/`, `public/`, `vite.config.js`, atau file frontend terkait.
2. Jalankan build frontend.
3. Push perubahan ke `staging-cloudflare`.
4. Pantau workflow `Staging Cloudflare`.

Jika perubahan menyentuh backend dan frontend:

1. Pastikan kedua sisi kompatibel.
2. Deploy backend/VPS dulu jika frontend butuh endpoint/API baru.
3. Deploy frontend Cloudflare setelah backend sehat.
4. Jika memakai branch terpisah, cherry-pick atau merge commit yang relevan ke branch target masing-masing.

Jangan menganggap push ke `backup/vps-ready-20260430` otomatis memperbarui Cloudflare Pages. Frontend Cloudflare Pages mengikuti branch/workflow `staging-cloudflare`.

## Validasi Lokal Sebelum Push

Frontend:

```bash
npm run build
npm run check
```

Backend:

```bash
cd backend
php artisan test
./vendor/bin/pint --test
```

Untuk perubahan kecil, boleh jalankan test terfokus dulu, tetapi sebelum deploy besar sebaiknya full test hijau.

## Smoke Check Setelah Deploy

Cek endpoint API:

```bash
curl -I https://sismu.biz.id/api/health
curl -I https://sman3bogor.sismu.biz.id/api/health
```

Cek halaman frontend dari Cloudflare:

```bash
curl -I https://sismu.biz.id/
curl -I https://frontend.sismu.biz.id/
curl -I https://sman3bogor.sismu.biz.id/login
```

Cek pola penting di browser:

- Login Admin Sekolah.
- Login Guru.
- Login Siswa.
- `/sanctum/csrf-cookie` berhasil.
- Upload kecil berhasil.
- Export PDF berhasil.
- Web Vitals masuk ke `/api/observability/web-vitals`.
- Console tidak ada error CSP, CORS, CSRF, atau missing asset.

## Rollback

Backend/VPS:

- `deploy/release-prod.sh` punya rollback otomatis jika deploy gagal setelah service diganti.
- Untuk rollback manual, pakai `deploy/rollback-prod.sh` dengan image/ref sebelumnya.
- Jangan restore database otomatis kecuali benar-benar perlu dan sudah ada backup yang dipilih.

Frontend/Cloudflare:

- Rollback paling aman lewat Cloudflare Pages deployment rollback di dashboard.
- Rollback DNS apex darurat: arahkan kembali ke VPS hanya jika pola API/frontend sudah dipastikan tidak loop.
- Jangan mengubah `origin.sismu.biz.id` menjadi proxied Pages; host itu harus tetap origin backend ke VPS.

## File Rujukan Penting

- `docs/github-actions-vps-deploy.md`: detail CI/CD VPS.
- `docs/cloudflare-pages-frontend.md`: detail Cloudflare Pages frontend.
- `docs/production-deploy.md`: detail stack production dan operasi VPS.
- `docs/security-hardening-sismu.md`: catatan hardening.
- `docs/LAPORAN_AUDIT_KEAMANAN.md`: status audit keamanan terakhir.
- `.github/workflows/ci.yml`: sumber kebenaran workflow VPS.
- `.github/workflows/cloudflare-pages-staging.yml`: sumber kebenaran workflow Cloudflare Pages.
- `deploy/caddy/Caddyfile`: routing backend-only dan WAF Caddy.
- `deploy/release-prod.sh`: script release VPS.

## Aturan Aman Untuk AI/Agent

- Mulai selalu dengan `git status --short --branch`.
- Jangan revert perubahan user yang tidak terkait.
- Jangan commit file `.env`, token Cloudflare, token GitHub, private key SSH, credential R2, atau dump database.
- Jangan memasukkan secret ke dokumentasi.
- Jangan menghapus branch production atau mengubah DNS tanpa instruksi eksplisit.
- Jangan mengubah workflow deploy tanpa menjalankan minimal build/test terkait.
- Jika ada folder scan/audit untracked seperti `docs/security-scans/`, jangan ikut commit kecuali user meminta.
- Jika deploy gagal, baca log GitHub Actions dan log VPS sebelum membuat perubahan baru.
