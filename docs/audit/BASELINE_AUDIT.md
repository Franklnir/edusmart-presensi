# Baseline Audit Report

## Lingkungan Pengembangan
- **PHP Version**: 8.4 (Verified)
- **Composer**: Terinstall dan berfungsi (dengan `--ignore-platform-req=ext-zip`)
- **Node.js**: >= 20.19.0 (Verified via package.json)
- **NPM**: Build frontend berhasil dengan Vite. Terdapat peringatan chunk > 500kB. Terdapat 2 vulnerabilities (1 high di `vite`, 1 low di `@babel/core`).
- **Docker**: Tidak tersedia di local (VPS ready tapi tools local dev butuh konfigurasi).

## Status Aplikasi
### Frontend
- Build berjalan sukses (`npm run build`). PWA mode `generateSW` dengan 121 entries precached.
- **Masalah Diketahui:** `npm run lint` dan `npm run test` absen dari `package.json`.

### Backend
- Dependencies composer berhasil terinstall.
- `php artisan test` dengan `vendor/bin/phpunit` lulus (267 Tests, 1520 Assertions, 10 Skipped).
- Code style dengan `./vendor/bin/pint --test` menunjukkan beberapa file (e.g. `composer-setup.php`) butuh dirapikan, namun code core relatif bersih.

## Kesimpulan Baseline
Aplikasi dapat dibuild secara aman di sisi frontend, dan tes backend lulus. Masalah production seperti error `/api/db` dan request berulang belum dicover penuh oleh unit test yang ada.
