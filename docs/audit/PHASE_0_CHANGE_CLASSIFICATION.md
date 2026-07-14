# Phase 0 Change Classification

Snapshot: `stash@{0}` (`safety: phase0 mobile removal and existing phase3 work`)

The safety stash contains 130 changed paths when untracked files are included.
The table deliberately classifies mixed paths before any selective restore.

| File | Kategori | Fase | Alasan | Dipulihkan Sekarang |
|---|---|---|---|---|
| `mobile-app/**` (63 tracked files) | Native application removal | 0 | Separate React Native/Expo package | Yes, as deletions |
| `.github/workflows/mobile-android.yml`, `.github/workflows/mobile-ios.yml` | Mobile CI | 0 | APK/IPA build workflows | Yes, as deletions |
| `backend/app/Http/Controllers/Api/MobileController.php` | Mobile backend | 0 | Native-only aggregate API | Yes, as deletion |
| `backend/app/Http/Controllers/Api/MobileDirectoryController.php` | Mobile backend | 0 | Native school picker API | Yes, as deletion |
| `backend/tests/Feature/MobileGoogleAuthTest.php` | Mobile test | 0 | Covers removed native OAuth | Yes, as deletion |
| `backend/tests/Feature/MobileRfidApiTest.php` | Mobile test | 0 | Covers removed native RFID facade | Yes, as deletion |
| `backend/tests/Feature/MobileSchoolDirectoryTest.php` | Mobile test | 0 | Covers removed native directory | Yes, as deletion |
| `docs/mobile-app.md`, `docs/mobile-integration.md` | Mobile documentation | 0 | Documents removed native product | Yes, as deletions |
| `backend/app/Http/Controllers/Api/AuthController.php` | Mixed web/native auth | 0 | Stashed hunks only remove native login/token/deep-link behavior | Yes, reviewed diff |
| `backend/routes/api.php` | Mixed route file | 0 | Stashed hunks only remove native routes/imports | Yes, reviewed diff |
| `backend/config/services.php` | Mobile config | 0 | Removes native Google redirect schemes | Yes |
| `backend/app/Http/Controllers/Api/QuizController.php` | Mixed quiz compatibility | 0 | Makes runtime web-only while retaining the historical column | Yes, reviewed diff |
| `src/pages/guru/Quiz.jsx`, `src/pages/siswa/Quiz.jsx` | Web quiz cleanup | 0 | Removes native-only access choices/messages | Yes, reviewed diff |
| `src/components/AccountSecurityPanel.jsx` | Web copy cleanup | 0 | Renames native/API token copy to API token | Yes |
| `backend/tests/Feature/AuthSecurityDeviceTest.php` | Web/API security test | 0 | Renames native token fixtures to generic API fixtures | Yes |
| `scripts/security/check-env-secrets.sh` | Root tooling cleanup | 0 | Removes deleted package exclusions | Yes |
| `docs/api_v2_migration.md`, `docs/security-report-sismu-2026-07-02.md` | Documentation cleanup | 0 | Removes statements/actions that treat native app as active | Yes |
| `docs/adr/0008-remove-native-mobile-application.md` | Architecture decision | 0 | Records web-only decision and breaking change | Yes, from untracked stash parent |
| `docs/audit/API_V2_PHASE_0_INVENTORY.md` | Inventory | 0 | Records baseline and active legacy consumers | Yes, from untracked stash parent |
| `package.json`, `package-lock.json` | Dependency/reproducibility | 0 | Adds explicit test/lint scripts and resolves peer conflicts for clean `npm ci` | Yes, version delta documented |
| `eslint.config.js` | Lint infrastructure | 0 | Corrects source scope and browser/test globals | Yes; does not disable rules |
| `backend/app/Http/Controllers/Api/V2/AttendanceController.php` | Attendance V2 | 3 | Presensi implementation | No |
| `backend/app/Http/Controllers/Api/V2/AttendanceRequestController.php` | Attendance request V2 | 3 | New presensi request controller | No |
| `backend/app/Http/Requests/Api/V2/*Attendance*.php` | Attendance validation | 3 | Presensi request validation | No |
| `backend/app/Models/AbsensiAjuan.php` | Attendance model | 3 | Presensi request model | No |
| `backend/app/Policies/AbsensiAjuanPolicy.php` | Attendance policy | 3 | Presensi authorization | No |
| `backend/app/Services/Actions/Attendance/**` | Attendance actions | 3 | Presensi business logic | No |
| `backend/tests/Feature/Api/V2/Attendance*Test.php` | Attendance tests | 3 | Presensi V2 coverage | No |
| `src/features/attendance/hooks/useStudentAttendanceActions.js` | Attendance frontend | 3 | Presensi V2 consumer | No |
| `src/pages/guru/AbsensiGuru.jsx` | Attendance frontend | 3 | Mixed presensi migration | No |
| `src/services/attendanceService.js` | Attendance frontend | 3 | V2 presensi service | No |
| `backend/app/Http/Controllers/Api/V2/AssignmentController.php` | Assignment V2 | 3 | Assignment migration | No |
| `backend/app/Http/Controllers/Api/V2/SubmissionController.php` | Submission V2 | 3 | Submission migration | No |
| `backend/app/Http/Controllers/Api/V2/UploadController.php` | Upload V2 | 3 | Upload session migration | No |
| `backend/app/Models/Attachment.php`, `backend/app/Models/UploadSession.php` | Upload models | 3 | Attachment/session ownership changes | No |
| `backend/app/Policies/TugasJawabanPolicy.php` | Submission policy | 3 | Submission authorization | No |
| `backend/tests/Feature/Api/V2/{Assignment,Submission,Upload}ControllerTest.php` | Domain tests | 3 | Assignment/submission/upload coverage | No |
| `backend/routes/api_v2.php` | Mixed V2 routes | 3 | Adds attendance-request and upload/domain routes | No |
| `docs/api-endpoints.md` | Mixed API documentation | 0 + 3 | Phase 0 removes the retired mobile catalog; stash also documents provisional Phase 3 routes | Phase 0 hunks only; Phase 3 hunks remain stashed |
| `backend/app/Http/Controllers/Api/V2/StudentController.php` | Student V2 hardening | 2/3 carry-over | Existing non-Phase-0 domain work | No |
| `backend/app/Http/Requests/Api/V2/StudentIndexRequest.php` | Student validation | 2/3 carry-over | Existing non-Phase-0 domain work | No |
| `backend/app/Http/Resources/Api/V2/StudentResource.php` | Student resource | 2/3 carry-over | Existing non-Phase-0 domain work | No |
| `backend/app/Services/Actions/Student/**` | Student actions | 2/3 carry-over | Existing non-Phase-0 domain work | No |
| `backend/app/Policies/{Kelas,Profile}Policy.php` | Domain authorization | 2/3 carry-over | Existing non-Phase-0 policy work | No |
| `src/features/students/**` | Student frontend | 2/3 carry-over | Existing non-Phase-0 consumer work | No |
| `backend/app/Providers/AppServiceProvider.php` | Mixed policy registration | 2/3 carry-over | Registers provisional policies | No |
| `backend/app/Services/IdempotencyService.php` | Shared V2 foundation | 3 carry-over | Changes made with domain work | No |

No unclassified file remains. The safety stash must not be dropped until Phase 0
is committed and every non-Phase-0 path is restored and verified.
