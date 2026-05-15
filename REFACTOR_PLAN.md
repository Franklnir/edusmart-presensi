# Refactor Plan

## Scan Summary

Frontend files paling besar saat ini:

| File | Lines | Catatan |
| --- | ---: | --- |
| `src/pages/guru/Laporan.jsx` | 4356 | Page laporan masih memegang fetch, export, kalkulasi, filter, tabel, dan UI besar. Helper murni sudah dipindah ke `src/pages/guru/laporan/laporanUtils.js`. |
| `src/pages/admin/Siswa.jsx` | 3753 | Masih monolithic, tetapi filter siswa sudah dipindah ke util, pencarian memakai debounce, tabel memakai pagination client-side, dan row/pagination sudah dipisah ke `src/features/students/components/`. |
| `src/pages/guru/Quiz.jsx` | 3477 | Masih memegang state quiz, realtime, upload media, timer, form, tabel peserta, dan review esai. Helper murni sudah dipindah ke `src/pages/guru/quiz/quizUtils.js`. |
| `src/pages/admin/Kelas.jsx` | 2822 | Helper kelas/jadwal/export sudah dipindah ke `src/features/classes/utils/classUtils.js`; preview jadwal cetak/export sudah dipisah ke `SchedulePreviewTable`; masih kandidat untuk table/modal/service/hook. |
| `src/pages/guru/AbsensiGuru.jsx` | 2949 | Masih memegang QR, realtime, auto alpha, RFID, jam kosong, state tabel, dan picker. Helper murni sudah dipindah ke `src/pages/guru/absensi/absensiGuruUtils.js`. |
| `src/pages/admin/Tenants.jsx` | 2793 | Super admin page besar, banyak form/domain/backup/restore logic. |
| `src/pages/siswa/Absensi.jsx` | 2738 | Perlu pemisahan geolocation, camera, realtime/history. |
| `src/pages/guru/TugasGuru.jsx` | 2460 | Perlu service assignment, modal, table, upload handling. |
| `src/pages/siswa/Quiz.jsx` | 2423 | Perlu pemisahan session/timer/answer state. |
| `src/lib/supabase.js` | 2073 | API client terlalu besar, banyak domain service bercampur. |

Backend files paling besar:

| File | Lines | Risiko |
| --- | ---: | --- |
| `backend/app/Http/Controllers/Api/DbController.php` | 4928 | Endpoint generik besar, raw table handling luas, risiko query berat dan branch permission sulit dirawat. |
| `backend/app/Http/Controllers/Api/SuperAdminController.php` | 3625 | Terlalu banyak responsibility: tenants, domains, backup, restore, admins, audit. |
| `backend/app/Http/Controllers/Api/AuthController.php` | 2461 | Auth email/password, Google, reset password, verification, audit bercampur. |
| `backend/app/Http/Controllers/Api/QuizController.php` | 1757 | Quiz lifecycle, scoring, retake, essay, publish dalam satu controller. |

## Kemungkinan Penyebab Lambat

- Refresh page melakukan banyak fetch besar dari page component, bukan service/hook terpusat.
- Beberapa page menyimpan state besar dan derived state bersamaan.
- Realtime subscription pada quiz/absensi bisa memicu reload atau update list besar terlalu sering.
- Timer per detik di quiz/absensi masih berada di page besar, sehingga berpotensi merender area yang tidak perlu.
- `src/lib/supabase.js` menjadi API layer tunggal yang terlalu besar, sulit di-cache dan sulit diuji.
- Export/report masih banyak logika di page, walaupun ExcelJS sudah lazy loaded di beberapa tempat.
- Backend controller besar membuat pagination/cache/eager loading sulit diterapkan konsisten.

## Struktur Folder Target Bertahap

Buat hanya folder yang dipakai:

```text
src/
  navigation/
    menu.config.js
    menu.utils.js
  components/
    layout/
    ui/
  features/
    reports/
      pages/
      components/
      hooks/
      services/
      utils/
    quizzes/
      pages/
      components/
      hooks/
      services/
      utils/
    attendance/
      pages/
      components/
      hooks/
      services/
      utils/
    students/
    classes/
  hooks/
    useDebounce.js
    usePagination.js
    useDisclosure.js
    useIsMounted.js
  services/
    apiClient.js
    authService.js
    studentService.js
    classService.js
    attendanceService.js
    quizService.js
    reportService.js
```

## Tahapan Refactor

1. Sidebar/navigation config driven.
   - Status: sebagian besar sudah berjalan lewat `src/config/menuConfig.js` dan komponen `src/components/Navbar/*`.
   - Next: pindah bertahap ke `src/navigation/` dan `src/components/layout/` tanpa memutus import lama.

2. Local runtime dan super admin.
   - Status: PostgreSQL portable, migration, akun admin, akun super admin, dan `npm run local:start` sudah dibuat.
   - Next: pastikan dokumentasi local ada di summary.

3. API connection local.
   - Status: `/api/health`, login admin, login super admin, dan `/api/super/me` sudah tervalidasi dari `127.0.0.1`.
   - Next: jaga compatibility host production, local-only bypass tidak boleh aktif di non-local.

4. Pecah helper murni page besar.
   - Status:
     - `Laporan.jsx` -> `src/pages/guru/laporan/laporanUtils.js`
     - `Quiz.jsx` -> `src/pages/guru/quiz/quizUtils.js`
     - `AbsensiGuru.jsx` -> `src/pages/guru/absensi/absensiGuruUtils.js`
     - `Kelas.jsx` -> `src/features/classes/utils/classUtils.js`
     - `Siswa.jsx` -> `src/features/students/utils/studentFilters.js`, `StudentTableRow.jsx`, `StudentPagination.jsx`
   - Next:
     - `Kelas.jsx` table/modal/service/hook.
     - `Siswa.jsx` modal/import/password/service.
     - `TugasGuru.jsx` upload/service.
     - `siswa/Quiz.jsx` timer/session.

5. Extract services dari API layer.
   - Mulai dari students/classes/attendance/quiz/report.
   - Hindari `select('*')`.
   - Tambahkan pagination parameter untuk list besar.

6. Optimasi render.
   - Table row pakai `React.memo` pada file yang sudah dipisah.
   - Search pakai `useDebounce`.
   - List siswa memakai `usePagination` agar tidak render seluruh hasil filter.
   - Derived data pakai `useMemo`.
   - Timer dipindah ke komponen kecil agar page tidak render per detik.

7. Backend optimization.
   - Audit `Model::all()`, query list tanpa pagination, dan count dashboard.
   - Tambahkan eager loading, `select()`, pagination, dan cache hanya di endpoint yang sudah jelas.
   - Migration index sudah ada untuk beberapa query multi-tenant; lanjutkan hanya jika query nyata membutuhkannya.

## Risiko Perubahan

- Auth dan super admin domain sensitif: local-only bypass harus tetap memakai `APP_ENV=local`.
- Realtime subscription absensi/quiz sensitif: harus cleanup channel dan tidak reload seluruh list.
- Laporan/export sensitif: pemecahan helper tidak boleh mengubah hasil nilai/ranking.
- Router lama harus tetap mempertahankan path admin/guru/siswa.

## Testing Setelah Tiap Tahap

```powershell
npm run build
php artisan test --no-ansi
```

Untuk runtime local:

```powershell
npm run local:start
```

Verifikasi manual:

- Frontend: `http://127.0.0.1:5173/`
- Backend: `http://127.0.0.1:8000/api/health`
- Admin local: `admin@local.test` / `Admin123!Local`
- Super admin local: `superadmin@local.test` / `SuperAdmin123!Local`

## Checklist Progress

- [x] Scan file besar frontend/backend.
- [x] PostgreSQL local portable aktif.
- [x] Database `edusmart` dan migration local siap.
- [x] Admin local dibuat.
- [x] Super admin local dibuat.
- [x] API connection local diverifikasi.
- [x] Build frontend lolos setelah refactor helper awal.
- [x] Backend tests lolos sebelum penambahan super admin local.
- [x] `Laporan.jsx` helper extraction.
- [x] `Quiz.jsx` helper extraction.
- [x] `AbsensiGuru.jsx` helper extraction.
- [x] Shared auth password verification service.
- [x] `REFACTOR_SUMMARY.md` dibuat.
- [x] Pindahkan navigation entrypoint ke `src/navigation/`.
- [x] Pecah helper awal `Kelas.jsx`.
- [x] Optimasi filter/table awal `Siswa.jsx`.
- [x] Tambahkan `useDebounce` dan `usePagination`.
- [ ] Pecah service dari `src/lib/supabase.js`.
- [ ] Pecah timer/realtime quiz dan absensi.
- [x] Update `REFACTOR_SUMMARY.md`.
