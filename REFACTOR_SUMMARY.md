# Refactor Summary

## Status Runtime Local

- Frontend: `http://127.0.0.1:5173/`
- Backend health: `http://127.0.0.1:8000/api/health`
- PostgreSQL portable: `127.0.0.1:5432`
- Start ulang local: `npm run local:start`

## Akun Local

- Admin sekolah: `admin@local.test` / `Admin123!Local`
- Super admin: `superadmin@local.test` / `SuperAdmin123!Local`

Super admin local bisa dipakai dari `127.0.0.1` dan `localhost` saat `APP_ENV=local`. Aturan production tetap memakai domain admin yang dikonfigurasi.

## File Yang Diubah

- `backend/app/Http/Controllers/Api/AuthController.php`
  - Menambahkan pengecualian login super admin khusus local host saat `APP_ENV=local`.
- `backend/app/Http/Middleware/EnsureSuperAdminDomain.php`
  - Mengizinkan endpoint `/api/super/*` di local host saat development local.
- `scripts/start-local.ps1`
  - Menjalankan PostgreSQL portable, migrasi Laravel, seed admin, seed super admin, Laravel API, dan Vite.
- `package.json`
  - Menambahkan script `local:start`.
- `REFACTOR_PLAN.md`
  - Roadmap refactor berdasarkan scan file besar.
- `src/services/authService.js`
  - Service shared untuk verifikasi password user aktif.
- `src/pages/admin/Siswa.jsx`
  - Menggunakan shared auth service, debounce filter, pagination client-side, dan komponen table row/pagination.
- `src/pages/admin/Kelas.jsx`
  - Menggunakan shared auth service dan helper kelas/jadwal/export yang dipisah.
- `src/pages/admin/siswa/siswaAuth.js`
  - Dihapus karena sudah digantikan `src/services/authService.js`.
- `src/navigation/menu.config.js`
  - Menu config role-based dipindah ke entrypoint navigation baru.
- `src/navigation/menu.utils.js`
  - Helper menu recursive/nested dipindah ke entrypoint navigation baru.
- `src/config/menuConfig.js`
  - Dijadikan compatibility re-export agar import lama tetap aman.
- `src/components/Navbar/*`
  - Import menu diarahkan ke `src/navigation/menu.utils.js`.
- `src/pages/guru/Laporan.jsx`
  - Helper murni dipisah.
- `src/pages/guru/laporan/laporanUtils.js`
  - Helper kalkulasi, ranking, export worksheet, dan formatter laporan.
- `src/pages/guru/Quiz.jsx`
  - Helper murni dipisah.
- `src/pages/guru/quiz/quizUtils.js`
  - Helper status quiz, timer, image validation, bulan, dan violation label.
- `src/pages/guru/AbsensiGuru.jsx`
  - Helper murni dipisah.
- `src/pages/guru/absensi/absensiGuruUtils.js`
  - Helper tanggal, kelas, QR, academic period, dan query column constants.
- `src/features/classes/utils/classUtils.js`
  - Helper grade, slug, jadwal, overlap waktu, dan export matrix kelas.
- `src/features/classes/components/SchedulePreviewTable.jsx`
  - Preview tabel jadwal cetak/export dengan `React.memo`, dipisah dari page kelas.
- `src/features/students/utils/studentFilters.js`
  - Filter siswa murni agar pencarian tidak dihitung langsung di page.
- `src/features/students/components/StudentTableRow.jsx`
  - Row tabel siswa dengan `React.memo`.
- `src/features/students/components/StudentPagination.jsx`
  - Kontrol pagination daftar siswa.
- `src/hooks/useDebounce.js`
  - Debounce reusable untuk filter/search.
- `src/hooks/usePagination.js`
  - Pagination reusable untuk list/table besar.

## Optimasi Yang Sudah Masuk

- File besar mulai diperkecil tanpa rewrite total.
- Duplicated password verification dipusatkan ke service shared.
- Local PostgreSQL dan Laravel API dibuat reproducible dengan satu command.
- Super admin local dibuat tanpa perlu mengubah hosts file Windows.
- API connection local diverifikasi dengan CSRF/session flow.
- Helper laporan, quiz, dan absensi dipindah ke modul kecil agar page lebih mudah dipecah lanjutan.
- Helper kelas dipindah ke feature classes.
- Preview jadwal kelas dipisah agar page kelas lebih kecil dan render preview lebih terisolasi.
- Filter siswa tidak lagi berjalan setiap keypress langsung; input search memakai debounce.
- Tabel siswa tidak lagi merender semua hasil filter sekaligus; hanya halaman aktif yang dirender.
- Row tabel siswa memakai `React.memo` untuk mengurangi render ulang saat list besar.

## Verifikasi

```powershell
npm run build
npm run check
php artisan test --no-ansi
php artisan route:list --path=super --no-ansi
```

Hasil terakhir:

- `npm run build`: passed.
- `npm run check`: passed.
- `php artisan test --no-ansi`: 103 passed (613 assertions).
- Frontend `http://127.0.0.1:5173/`: HTTP 200.
- `/api/health`: `{"status":"ok"}`.
- Login super admin: OK.
- `/api/super/me`: `{"data":{"is_super_admin":true}}`.

## Risiko Tersisa

- `Laporan.jsx`, `Siswa.jsx`, `Kelas.jsx`, `Quiz.jsx`, dan `AbsensiGuru.jsx` masih besar dan perlu dipisah lanjutan ke components/hooks/services.
- `src/lib/supabase.js` masih menjadi API layer besar.
- Timer quiz dan absensi masih perlu dipindah ke komponen kecil agar page tidak render besar tiap detik.
- Realtime subscription quiz/absensi perlu audit lanjutan untuk memastikan update targeted dan cleanup konsisten.
- Backend controller besar masih perlu dipecah bertahap dan diaudit untuk pagination/cache/query berat.

## Tahap Lanjutan Prioritas

1. Pecah sisa modal/import/password/service di `src/pages/admin/Siswa.jsx`.
2. Pecah `src/pages/admin/Kelas.jsx` ke table/modal/service/hook.
3. Pecah service dari `src/lib/supabase.js` ke domain services yang dipakai langsung.
4. Pecah timer dan realtime logic di `src/pages/guru/Quiz.jsx`.
5. Pecah QR/RFID/auto alpha logic di `src/pages/guru/AbsensiGuru.jsx`.
6. Pecah backend controller besar (`DbController`, `SuperAdminController`) hanya dengan test coverage domain yang cukup.
