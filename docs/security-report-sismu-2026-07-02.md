# Laporan Audit Keamanan SISMU

Tanggal audit: 2026-07-02, Asia/Jakarta
Target live: `https://sismu.biz.id`
Source code: `/home/irsyad/Unduhan/edusmart-presensi-backup-vps-ready-20260430`

## Batasan

Audit live dilakukan secara pasif/low-impact: HTTP/TLS/header/CORS/endpoint health dan request validasi minimal. Tidak dilakukan brute force, exploit aktif destruktif, fuzzing besar, login paksa, atau payload yang mencoba mengambil alih sistem live.

Environment lokal tidak memiliki `npm`, `node`, `composer` global, atau `rg`. Composer dijalankan via `composer.phar`; dependency npm dicek via OSV API dari lockfile.

## Ringkasan Eksekutif

Permukaan live cukup rapi: HTTP redirect ke HTTPS aktif, HSTS aktif, security headers ada, CORS tidak menerima origin acak, `.env`/log umum diblokir, `/api/db` menyamarkan diri untuk guest, dan endpoint RFID menolak request tanpa key.

Temuan paling penting ada di source code dan secret hygiene:

1. **CRITICAL - potensi privilege escalation delegated admin**: `isAdmin()` menjadikan guru dengan permission fitur sebagai admin umum berdasarkan header `X-Admin-Feature`. Karena header client bisa dipalsukan, guru yang punya satu delegated feature berpotensi melewati banyak check admin generik.
2. **CRITICAL - kredensial SSH hard-coded tracked**: `scratch_ssh.exp` berisi host root dan password hard-coded. Nilai password tidak ditulis di laporan ini.
3. **HIGH - secret nyata ada di file env lokal**: `backend/.env` berisi secret operasional. File ini tidak tracked, tetapi repo ini adalah backup siap VPS, jadi perlakukan sebagai data sensitif.
4. **MEDIUM/HIGH - advisory dependency npm**: OSV menandai beberapa package JS di root/backend/mobile lockfile. Banyak berada di dev/build toolchain, tetapi tetap perlu di-upgrade karena CI/build pipeline ikut terdampak.

## Status Perbaikan 2026-07-02

Sudah dikerjakan di source code:

- `isAdmin()` sudah dikunci hanya untuk super admin identity atau profile role `admin`.
- Delegated feature tidak lagi membaca fallback dari header `X-Admin-Feature`; feature harus diberikan eksplisit oleh controller.
- Endpoint scan settings tetap mendukung delegasi resmi `scan-kehadiran` lewat guard eksplisit, bukan admin generik.
- Ditambahkan regression test untuk memastikan guru delegated tidak bisa memakai header fitur sebagai admin umum, tetapi delegasi scan yang sah tetap berjalan.
- `scratch_ssh.exp` sudah dihapus dari working tree dan ditambahkan ke `.gitignore`.
- `scratch_ssh.exp` ditandai binary di `.gitattributes` agar commit penghapusan tidak menampilkan isi file sensitif di diff GitHub.
- README sudah dibersihkan dari contoh blok private key.

Verifikasi:

- `php -l` untuk controller dan test baru: lulus.
- `php artisan test --filter=DelegatedAdminAuthorizationTest`: 2 test lulus.
- `php artisan test`: 199 test lulus, 1179 assertion.

Masih wajib dilakukan di luar source code:

- Rotasi password/root credential VPS yang pernah ada di file tracked.
- Jika repo pernah dipush/dibagikan, purge history file sensitif lalu tetap anggap kredensial lama bocor.
- Audit login SSH VPS dan disable root password login bila memungkinkan.
- Rotasi secret `.env` yang pernah keluar dari mesin dipercaya.
- Jalankan audit npm resmi setelah Node/npm tersedia dan upgrade lockfile yang terdampak.

## Temuan Detail

### 1. CRITICAL - Delegated feature bisa menjadi admin umum

Status: **diperbaiki di working tree pada 2026-07-02**.

Bukti saat audit awal sebelum patch:

- `backend/app/Http/Controllers/Api/ApiController.php:48`: `isAdmin()` mengembalikan true untuk role `guru`/`teacher` jika `hasDelegatedAdminFeatureAccess()` true.
- `backend/app/Http/Controllers/Api/ApiController.php:103`: `hasDelegatedAdminFeatureAccess()` membaca feature dari header `X-Admin-Feature` jika feature eksplisit tidak diberikan.
- `src/lib/supabase.js:942`: frontend mengirim `X-Admin-Feature` otomatis berdasarkan path halaman.
- Banyak endpoint sensitif memakai check generik `isAdmin()`, misalnya `SettingsController::backup()` di `backend/app/Http/Controllers/Api/SettingsController.php:15`, `SettingsController::update()` di `backend/app/Http/Controllers/Api/SettingsController.php:190`, dan manajemen delegated permission di `backend/app/Http/Controllers/Api/AdminFeaturePermissionController.php:28`.

Dampak:

Guru yang memiliki salah satu delegated feature dapat mencoba mengirim header feature yang valid untuk akunnya ke endpoint admin lain yang hanya memakai `isAdmin()`. Ini berpotensi membuka backup tenant, perubahan setting sekolah, permission admin, Google Drive/admin tools, storage management, dan jalur mutasi lain dalam tenant.

Rekomendasi:

- Jadikan `isAdmin()` hanya true untuk super admin atau profile role `admin`.
- Buat method terpisah untuk delegated access, misalnya `hasDelegatedAdminFeatureAccess($request, 'scan-kehadiran')`, dan gunakan hanya di endpoint yang memang boleh diakses delegated role.
- Jangan pernah menjadikan header client sebagai bukti admin umum.
- Tambah test: guru dengan delegated `scan-kehadiran` harus ditolak dari endpoint `settings.update`, `admin.feature-permissions.store`, backup, Google Drive admin, dan DB mutation admin-only.

### 2. CRITICAL - SSH root password hard-coded di file tracked

Status: **file sudah dihapus dari working tree dan ditambahkan ke `.gitignore` pada 2026-07-02**. Rotasi credential tetap wajib karena penghapusan file tidak membatalkan kebocoran password lama.

Bukti saat audit awal sebelum patch:

- `scratch_ssh.exp:4` memuat target `root@103.191.63.170`.
- `scratch_ssh.exp:7` mengirim password hard-coded.
- `git ls-files` menunjukkan `scratch_ssh.exp` tracked.

Dampak:

Jika repo/backup ini pernah dikirim ke GitHub, VPS, CI artifact, chat, atau orang lain, kredensial root harus dianggap bocor.

Rekomendasi segera:

- Rotasi password root/VPS sekarang.
- Hapus `scratch_ssh.exp` dari repo.
- Disable password login SSH untuk root; gunakan SSH key dan `PermitRootLogin prohibit-password` atau user non-root + sudo.
- Audit `/var/log/auth.log` atau journal SSH untuk login mencurigakan.
- Jika file pernah masuk remote Git, purge history dengan tool seperti `git filter-repo`, lalu rotate credential tetap wajib.

### 3. HIGH - Secret nyata ada di env lokal/backup

Bukti:

- `backend/.env` berisi `APP_KEY`, mail secret, RFID shared key lokal, dan variable integrasi lain.
- `.gitignore` sudah mengabaikan `.env`, jadi risiko utama bukan tracked git, melainkan backup/source bundle yang berisi file env.

Dampak:

Jika folder backup ini dibagikan, dikompresi, atau di-upload, secret ikut terbawa.

Rekomendasi:

- Simpan env produksi di secret manager atau file terpisah dengan permission ketat.
- Jangan masukkan `.env` nyata ke backup source yang dibagikan.
- Rotasi secret yang pernah keluar dari mesin dipercaya.

### 4. HIGH/MEDIUM - Advisory dependency npm

Composer:

- `php composer.phar audit --format=json --working-dir=backend`: tidak ada advisory.
- `php composer.phar validate --strict --working-dir=backend`: valid.

NPM:

- `npm audit` tidak bisa dijalankan karena `npm/node` tidak tersedia.
- OSV API menemukan advisory dari lockfile.

Paket yang perlu ditinjau:

- Root frontend: `@babel/core@7.28.5`, `vite@6.4.2`.
- Backend JS tooling: `axios@1.13.4`, `follow-redirects@1.15.11`, `form-data@4.0.5`, `picomatch@2.3.1/4.0.3`, `postcss@8.5.6`, `rollup@4.57.1`, `shell-quote@1.8.3`, `vite@7.3.1`.
- Mobile: `@xmldom/xmldom@0.7.13`, `js-yaml@3.14.2`, `form-data@3.0.4/4.0.5`, `postcss@8.4.49`, `tar@6.2.1`, `undici@6.26.0`, `uuid@7.0.3/8.3.2`.

Rekomendasi:

- Install Node sesuai `.nvmrc`/engine, lalu jalankan `npm audit` di root, `backend`, dan `mobile-app`.
- Upgrade lockfile dengan `npm update` atau versi patch/minor aman.
- Pastikan Vite dev server tidak pernah diekspos ke internet.
- Tambahkan OSV/npm audit ke CI.

### 5. MEDIUM - RFID HTTP fallback harus tetap strict di production

Bukti:

- `backend/config/rfid.php:4` memakai `RFID_SCAN_SHARED_KEY`.
- `backend/config/rfid.php:5` hanya open HTTP bila env mengizinkan.
- Live check `/api/rfid/mode` tanpa key mengembalikan `401 unauthorized_device`, ini baik.

Risiko:

Jika production env salah set `RFID_ALLOW_OPEN_HTTP=true` atau shared key kosong, endpoint scan dapat terbuka.

Rekomendasi:

- Pastikan `RFID_SCAN_SHARED_KEY` kuat dan berbeda dari contoh.
- Pastikan `RFID_ALLOW_OPEN_HTTP=false` di production.
- Prioritaskan secret per device (`X-RFID-Secret`) dan rotasi berkala.

### 6. MEDIUM - Admin lock adalah gate client-side, bukan boundary server-side

Bukti:

- `src/components/AdminLockGate.jsx` menyimpan status unlock di `sessionStorage`.
- Backend tetap mengandalkan role/admin check biasa.

Dampak:

Ini oke sebagai UX re-auth ringan, tetapi bukan pengaman server-side untuk aksi berisiko.

Rekomendasi:

- Untuk backup, reset password, permission admin, storage cleanup, dan setting kritis, tambahkan server-side recent password verification atau step-up auth.

### 7. LOW/MEDIUM - CSP masih longgar untuk koneksi dan inline style

Bukti live:

- Header CSP aktif.
- `style-src 'self' 'unsafe-inline'`.
- `connect-src 'self' https: wss:`.

Dampak:

Lebih baik daripada tanpa CSP, tetapi jika terjadi XSS, `connect-src https: wss:` memberi ruang exfiltration lebih luas.

Rekomendasi:

- Persempit `connect-src` ke domain API/object storage/Google yang benar-benar dipakai.
- Kurangi inline style secara bertahap bila memungkinkan.

### 8. LOW - README berisi blok private key placeholder

Bukti:

- `README.md:211` sampai `README.md:213` memuat contoh blok private key dengan isi placeholder.

Dampak:

Kemungkinan hanya contoh, tetapi memicu secret scanner dan mengajarkan pola copy private key ke dokumen.

Rekomendasi:

- Ganti dengan placeholder satu baris seperti `[paste private key into GitHub secret, never commit it]`.

## Hasil Cek Live Low-impact

DNS:

- `sismu.biz.id` -> `103.191.63.170`.
- `admin26.sismu.biz.id` dan `sman3bogor.sismu.biz.id` juga resolve ke IP yang sama.

TLS:

- `sismu.biz.id` cert Let's Encrypt, CN/SAN `sismu.biz.id`, valid sampai 2026-08-13.
- `admin26.sismu.biz.id` dan `sman3bogor.sismu.biz.id` punya cert masing-masing, valid sampai 2026-08-13.

HTTP/security headers:

- `http://sismu.biz.id/` -> `308` ke HTTPS.
- `https://sismu.biz.id/` -> `200`.
- Header yang terdeteksi: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`.

CORS:

- Preflight dari `https://evil.example` ke `/api/health` tidak mengembalikan `Access-Control-Allow-Origin` untuk origin itu.

Endpoint:

- `/api/health` -> `200 {"status":"ok"}`.
- `POST /api/db` tanpa auth -> `404`, concealment bekerja.
- `/api/rfid/mode` tanpa key -> `401`, key required bekerja.
- `/.env`, `/backend/.env`, `/storage/logs/laravel.log`, `/server-status` -> blocked/403.
- `/composer.json` dan `/package.json` mengembalikan SPA index, bukan file raw.

## Prioritas Perbaikan

1. Patch `isAdmin()` agar delegated teacher tidak menjadi admin umum.
2. Hapus `scratch_ssh.exp`, rotate password/root credential, dan audit akses SSH.
3. Rotasi secret yang pernah dibagikan keluar dari mesin dipercaya.
4. Jalankan audit npm resmi setelah Node/npm tersedia; upgrade lockfile.
5. Tambah test authorization untuk role guru delegated vs admin asli.
6. Perketat CSP dan step-up auth untuk aksi admin sensitif.
