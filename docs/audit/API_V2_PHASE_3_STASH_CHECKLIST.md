# Phase 3 Safety Stash Reconciliation

Audit date: 2026-07-14. Source snapshot: `stash@{0}`. The stash is retained and
was not popped or dropped.

Reconciliation result for all 112 stash paths:

- 84 paths are byte-equivalent between `HEAD` and the stash, including the
  committed Phase 0 native-mobile removals and security changes.
- 26 Phase 3 paths are present in the Phase 3 result and listed below.
- 2 quiz paths intentionally remain outside Phase 3 because Quiz is a later
  audit/migration domain.
- 0 Phase 3 stash paths are missing.

| File pada Stash | Sudah di Commit | Sengaja Tidak Dipakai | Alasan |
|---|---|---|---|
| `.github/workflows/mobile-*.yml`, `mobile-app/**`, mobile controllers/tests/docs, dan 84 path yang byte-equivalent | Ya, sebelum Phase 3 | Tidak | Sudah tercakup oleh commit Phase 0 atau perubahan security yang identik di `HEAD` |
| `backend/app/Http/Controllers/Api/V2/AssignmentController.php` | Ya, commit Phase 3 | Tidak | Assignment hardening dilanjutkan dan diuji |
| `backend/app/Http/Controllers/Api/V2/AttendanceController.php` | Ya, commit Phase 3 | Tidak | Attendance hardening dilanjutkan dan diuji |
| `backend/app/Http/Controllers/Api/V2/StudentController.php` | Ya, commit Phase 3 | Tidak | Student hardening dilanjutkan dan diuji |
| `backend/app/Http/Controllers/Api/V2/SubmissionController.php` | Ya, commit Phase 3 | Tidak | Submission hardening dilanjutkan dan diuji |
| `backend/app/Http/Controllers/Api/V2/UploadController.php` | Ya, commit Phase 3 | Tidak | Upload session diperketat; status tetap PARTIAL |
| `backend/app/Http/Requests/Api/V2/StoreAttendanceRequest.php` | Ya, commit Phase 3 | Tidak | Validasi presensi server-side |
| `backend/app/Http/Resources/Api/V2/StudentResource.php` | Ya, commit Phase 3 | Tidak | Minimisasi field list |
| `backend/app/Models/Attachment.php` | Ya, commit Phase 3 | Tidak | Metadata ownership/claim |
| `backend/app/Models/UploadSession.php` | Ya, commit Phase 3 | Tidak | Relasi dan state upload |
| `backend/app/Policies/KelasPolicy.php` | Ya, commit Phase 3 | Tidak | Scope kelas |
| `backend/app/Policies/ProfilePolicy.php` | Ya, commit Phase 3 | Tidak | Tenant dan student IDOR |
| `backend/app/Policies/TugasJawabanPolicy.php` | Ya, commit Phase 3 | Tidak | Submission ownership/grading |
| `backend/app/Providers/AppServiceProvider.php` | Ya, commit Phase 3 | Tidak | Policy registration eksplisit |
| `backend/app/Services/IdempotencyService.php` | Ya, commit Phase 3 | Tidak | Atomic replay service |
| `backend/routes/api_v2.php` | Ya, commit Phase 3 | Tidak | Route Phase 3 bernama dan throttled |
| `backend/tests/Feature/Api/V2/AssignmentControllerTest.php` | Ya, commit Phase 3 | Tidak | Security regression coverage |
| `backend/tests/Feature/Api/V2/AttendanceControllerTest.php` | Ya, commit Phase 3 | Tidak | Tenant/role regression coverage |
| `backend/tests/Feature/Api/V2/StudentControllerTest.php` | Ya, commit Phase 3 | Tidak | Lifecycle/IDOR regression coverage |
| `backend/tests/Feature/Api/V2/SubmissionControllerTest.php` | Ya, commit Phase 3 | Tidak | Ownership/grade regression coverage |
| `backend/tests/Feature/Api/V2/UploadControllerTest.php` | Ya, commit Phase 3 | Tidak | Upload lifecycle regression coverage |
| `docs/api-endpoints.md` | Ya, commit Phase 3 | Tidak | Runtime route catalog diselaraskan |
| `src/features/attendance/hooks/useStudentAttendanceActions.js` | Ya, commit Phase 3 | Tidak | V2 request integration |
| `src/features/students/hooks/useStudentAccountActions.js` | Ya, commit Phase 3 | Tidak | Student lifecycle integration |
| `src/features/students/services/studentService.js` | Ya, commit Phase 3 | Tidak | Student service contract |
| `src/pages/guru/AbsensiGuru.jsx` | Ya, commit Phase 3 | Tidak | Attendance V2 feature flag |
| `src/services/attendanceService.js` | Ya, commit Phase 3 | Tidak | Callable API client contract |
| `src/pages/guru/Quiz.jsx` | Tidak | Ya | Quiz berada di fase audit/migrasi berikutnya |
| `src/pages/siswa/Quiz.jsx` | Tidak | Ya | Quiz berada di fase audit/migrasi berikutnya |

Verifikasi dapat diulang dengan `git stash show --name-status stash@{0}` dan
perbandingan `git diff HEAD stash@{0} -- <path>`. Label “Ya, commit Phase 3”
menunjukkan tujuan hasil akhir; hash aktual dicatat pada laporan setelah commit.
