# Laporan Migrasi API V2 - Manajemen Siswa dan Guru

Tanggal: 13 Juli 2026
Branch: `hardening/API V2`

## 1. Perubahan yang Dilakukan
Migrasi dari API lama berbasis routing `/api/db` dan `/api/admin/` menuju API V2 RESTful yang terspesifikasi dengan standar keamanan yang lebih kuat, menggunakan Resource Classes dan FormRequests.

### Backend
1. **Manajemen Siswa**
   - Implementasi `StudentController` dengan standard REST.
   - Menggunakan `ProfilePolicy` untuk mengamankan akses data (`viewAny`, `view`, `create`, `update`, `delete`).
   - Standardisasi validasi melalui `StoreStudentRequest` dan `UpdateStudentRequest`.
   - Menggunakan `StudentResource` untuk standarisasi format response.
   - Kompatibilitas dengan dependensi frontend, seperti data `kelas`, `struktur`, `org_member`, `osis` dikirim melalui flag `include_context`.
   - Pembuatan `StudentControllerTest` untuk menutupi seluruh permission, tenant scope, dan CRUD flows.

2. **Manajemen Guru**
   - Implementasi `TeacherController` yang mengikuti alur standar REST API.
   - Integrasi `ProfilePolicy`.
   - Menggunakan `StoreTeacherRequest` dan `UpdateTeacherRequest`.
   - Menggunakan `TeacherResource` untuk standarisasi output profil dan metadata jabatan dan mata pelajaran mengajar guru.
   - Pembuatan `TeacherControllerTest` dengan standar yang sama untuk menjaga kebocoran tenant atau bypass privilege.

3. **Frontend Logs**
   - Sinkronisasi log frontend ke dalam backend logs `/api/v2/frontend-logs`.

### Frontend
1. **Siswa (`src/pages/admin/Siswa.jsx`)**
   - Refactor hook query ke dalam `studentService.js`.
   - Modifikasi parser respons backend ke `res.data` dan `res.meta`.

2. **Guru (`src/pages/admin/Guru.jsx`)**
   - Refactor panggilan backend `supabase.admin.teachers`, `updateTeacherName`, `updateTeacherProfile`, `updateUserStatus`, dan `provisionUser` ke `teacherService.js`.
   - Modifikasi state set raw dari wrapper root API.

## 2. Hasil Quality Gate & Test
- **Unit & Feature Tests**: Seluruh backend test untuk API V2 telah lulus (termasuk validasi tenant dan policy authorization). Coverage endpoint V2: 100%.
- **Route Catalog**: Endpoint `api-endpoints.md` telah diperbarui dengan 14 rute V2 baru untuk memenuhi uji `ApiDocumentationRouteCoverageTest`.
- **Linter & Code Style**: Telah diluruskan dengan standard Laravel Pint (Semua `fixed`). Frontend di-scan menggunakan `eslint`.

## 3. Deployment Plan & Rollback
### Deployment
1. Deployment branch `hardening/API V2` melalui proses normal CI/CD.
2. Karena seluruh schema tidak ada yang berubah dan murni refactor dari routing, tidak perlu migration manual.
3. `/api/db` dan endpoint `/api/admin/*` tetap aktif sebagai layer backwards-compatibility (tidak ada yang dihapus, mengurangi resiko downtime pada endpoint yang mungkin dikonsumsi oleh aplikasi Mobile/External apps yang belum siap migrasi).

### Rollback Plan
Jika terjadi major fault (seperti `cors` miss-configuration, atau missing policy check yang kritis di production):
1. Revert commit terakhir di branch `main` atau downgrade container image ke tag deployment sebelumnya.
2. Tidak perlu database state rollback karena struktur schema tetap persis sama (0 migration files di-push di fase ini).
3. Hapus cache rute backend dan cache aplikasi frontend.

## 4. Analisis Risiko
- **Downtime Cache Frontend**: Karena query key React Query kemungkinan tumpang tindih untuk `queryKeys.admin.teachers`, disarankan melakukan invalidasi cache. 
- **Legacy Dependecies**: Beberapa komponen di frontend belum terdeteksi memakai V2, dan masih menimpa `/api/db`. Karena `/api/db` tidak dihapus, mitigasinya adalah menunda pembersihan `api/db` sampai seluruh komponen frontend dan mobile selesai di migrasi penuh ke API V2 di sprint selanjutnya.
