# API V2 Phase 3 Change Classification

- Date: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Phase 3 base: `a704d6c0`
- Safety snapshot: `stash@{0}` (retained)

This inventory classifies all 42 paths restored from the Phase 0 safety stash
and all 30 paths added or brought into scope while closing verified Phase 3
gaps (72 paths total). Native mobile source, packages, routes, and workflows are
not part of the worktree.

| File | Domain | Jenis Perubahan | Risiko | Commit Tujuan |
|---|---|---|---|---|
| `backend/app/Http/Controllers/Api/V2/StudentController.php` | Siswa | Controller/list and lifecycle hardening | Tenant leakage, IDOR, destructive lifecycle | `feat(api-v2): finalize student resource endpoints` |
| `backend/app/Http/Requests/Api/V2/StudentIndexRequest.php` | Siswa | Filter/sort validation | Unbounded query or unsafe sorting | Student API commit |
| `backend/app/Http/Resources/Api/V2/StudentResource.php` | Siswa | Response field projection | Sensitive data disclosure | Student API commit |
| `backend/app/Services/Actions/Student/ActivateStudent.php` | Siswa | Account activation action | Invalid lifecycle transition | Student API commit |
| `backend/app/Services/Actions/Student/CreateStudent.php` | Siswa | Transactional creation action | Duplicate identity, partial writes | Student API commit |
| `backend/app/Services/Actions/Student/DeactivateStudent.php` | Siswa | Account deactivation action | History loss or unauthorized mutation | Student API commit |
| `backend/app/Services/Actions/Student/UpdateStudent.php` | Siswa | Transactional update action | Mass assignment, tenant override | Student API commit |
| `backend/app/Policies/ProfilePolicy.php` | Shared authorization / siswa | Profile ownership and management rules | Same-tenant IDOR | Student API commit |
| `backend/app/Policies/KelasPolicy.php` | Shared authorization / siswa | Class membership/teacher scope rules | Same-tenant class IDOR | Student API commit |
| `backend/tests/Feature/Api/V2/StudentControllerTest.php` | Siswa / automated test | Security and lifecycle coverage | Missing cross-tenant/ownership regression | Student API commit |
| `backend/app/Http/Controllers/Api/V2/AttendanceController.php` | Presensi | Controller delegates mutations to actions | Unauthorized correction, duplicate attendance | `feat(api-v2): finalize attendance request workflows` |
| `backend/app/Http/Requests/Api/V2/StoreAttendanceRequest.php` | Presensi | Attendance validation | Trusting tenant/student identifiers | Attendance commit |
| `backend/app/Services/Actions/Attendance/CreateAttendance.php` | Presensi | Transactional/idempotent create | Duplicate academic attendance | Attendance commit |
| `backend/app/Services/Actions/Attendance/UpdateAttendance.php` | Presensi | Transactional correction | Lost update, missing audit | Attendance commit |
| `backend/app/Http/Controllers/Api/V2/AttendanceRequestController.php` | Pengajuan presensi | Request workflow endpoints | Unauthorized state transition | Attendance commit |
| `backend/app/Http/Requests/Api/V2/StoreAttendanceAjuanRequest.php` | Pengajuan presensi | Create validation | Forged student identity | Attendance commit |
| `backend/app/Http/Requests/Api/V2/UpdateAttendanceAjuanRequest.php` | Pengajuan presensi | Decision validation | Invalid final-state transition | Attendance commit |
| `backend/app/Http/Resources/Api/V2/AttendanceRequestResource.php` | Pengajuan presensi | API representation | Private request data disclosure | Attendance commit |
| `backend/app/Models/AbsensiAjuan.php` | Pengajuan presensi | Model relationships/casts | Unsafe mass assignment or tenant scope | Attendance commit |
| `backend/app/Policies/AbsensiAjuanPolicy.php` | Pengajuan presensi | Ownership/teacher authorization | Same-tenant IDOR | Attendance commit |
| `backend/app/Services/Actions/Attendance/CreateAttendanceRequest.php` | Pengajuan presensi | Transactional request creation | Duplicate pending requests | Attendance commit |
| `backend/app/Services/Actions/Attendance/RespondAttendanceRequest.php` | Pengajuan presensi | Locked state transition | Race condition, duplicate attendance | Attendance commit |
| `backend/tests/Feature/Api/V2/AttendanceControllerTest.php` | Presensi / automated test | Tenant and mutation coverage | Missing authorization regression | Attendance commit |
| `backend/tests/Feature/Api/V2/AttendanceRequestControllerTest.php` | Pengajuan presensi / automated test | Workflow and ownership coverage | Missing concurrency/final-state regression | Attendance commit |
| `backend/app/Http/Controllers/Api/V2/AssignmentController.php` | Tugas | Assignment CRUD/security hardening | Teacher scope, draft leakage | `feat(api-v2): finalize assignment and submission security` |
| `backend/tests/Feature/Api/V2/AssignmentControllerTest.php` | Tugas / automated test | Assignment policy coverage | Same-tenant teacher IDOR | Assignment/submission commit |
| `backend/app/Http/Controllers/Api/V2/SubmissionController.php` | Submission | Submission/grade hardening | Owner spoofing, unauthorized grading | Assignment/submission commit |
| `backend/app/Policies/TugasJawabanPolicy.php` | Submission authorization | Submission ownership rules | Same-tenant IDOR | Assignment/submission commit |
| `backend/tests/Feature/Api/V2/SubmissionControllerTest.php` | Submission / automated test | Submit/grade security coverage | Missing closed/cross-tenant regression | Assignment/submission commit |
| `backend/app/Http/Controllers/Api/V2/UploadController.php` | Upload Session | Session lifecycle endpoints | Arbitrary object key/URL, replay | `feat(storage): harden upload sessions and idempotency` |
| `backend/app/Models/UploadSession.php` | Upload Session | Session state/expiry model | Completing expired or foreign session | Storage/idempotency commit |
| `backend/app/Models/Attachment.php` | Attachment | Attachment ownership/claim model | Cross-tenant claim or reuse | Storage/idempotency commit |
| `backend/tests/Feature/Api/V2/UploadControllerTest.php` | Upload / automated test | Session validation/authorization coverage | Missing provider verification regression | Storage/idempotency commit |
| `backend/app/Services/IdempotencyService.php` | Idempotency | Replay identity and response cache | Cross-actor replay, collision, cached failure | Storage/idempotency commit |
| `backend/app/Providers/AppServiceProvider.php` | Shared authorization | Policy registration | Missing policy enforcement | Domain commit owning registered policy |
| `backend/routes/api_v2.php` | Route | Phase 3 endpoint registration | Missing middleware/name/throttle or duplicate route | Split by domain with `git add -p` |
| `src/features/students/hooks/useStudentAccountActions.js` | Frontend siswa | V2 lifecycle mutations | Incorrect fallback/cutover behavior | `refactor(frontend): migrate phase three modules to api v2` |
| `src/features/students/services/studentService.js` | Frontend siswa | Student V2 client contract | Contract drift, legacy fallback | Frontend integration commit |
| `src/features/attendance/hooks/useStudentAttendanceActions.js` | Frontend presensi | Attendance request mutations | Identity spoofing, stale fallback | Frontend integration commit |
| `src/services/attendanceService.js` | Frontend presensi | Attendance V2 client contract | Contract/error drift | Frontend integration commit |
| `src/pages/guru/AbsensiGuru.jsx` | Frontend presensi | V2 feature-flag integration | Mixed legacy/V2 behavior | Frontend integration commit |
| `docs/api-endpoints.md` | Documentation | Route catalog update | Documentation/runtime drift | `docs(api): document phase three api contracts` |
| `docs/audit/API_V2_PHASE_3_CHANGE_CLASSIFICATION.md` | Documentation / audit | Complete Phase 3 path inventory | Missing or misclassified change | Documentation commit |
| `backend/.env.example` | Configuration | Safe upload/idempotency defaults | Unsafe production default | Storage/idempotency commit |
| `backend/app/Http/Requests/Api/V2/GradeSubmissionRequest.php` | Submission | Grade bounds/idempotency validation | Invalid academic score | Assignment/submission commit |
| `backend/app/Http/Requests/Api/V2/StoreAssignmentRequest.php` | Tugas | Create/status/attachment validation | Unsafe assignment input | Assignment/submission commit |
| `backend/app/Http/Requests/Api/V2/UpdateAssignmentRequest.php` | Tugas | Update/state validation | Invalid assignment transition | Assignment/submission commit |
| `backend/app/Http/Requests/Api/V2/StoreStudentRequest.php` | Siswa | Identifier/password validation | Duplicate or weak identity | Student API commit |
| `backend/app/Http/Requests/Api/V2/UpdateStudentRequest.php` | Siswa | Update field validation | Identity/lifecycle override | Student API commit |
| `backend/app/Http/Requests/Api/V2/StoreSubmissionRequest.php` | Submission | Create/attachment validation | Forged owner or arbitrary URL | Assignment/submission commit |
| `backend/app/Http/Requests/Api/V2/UpdateSubmissionRequest.php` | Submission | Update/attachment validation | Unsafe submission mutation | Assignment/submission commit |
| `backend/app/Http/Requests/Api/V2/StoreUploadRequest.php` | Upload | Purpose/MIME/size/basename validation | Malicious object metadata | Storage/idempotency commit |
| `backend/app/Http/Requests/Api/V2/UpdateAttendanceRequest.php` | Presensi | Correction/idempotency validation | Invalid attendance correction | Attendance commit |
| `backend/app/Policies/AbsensiPolicy.php` | Presensi authorization | Tenant/teacher/student scope | Same-tenant IDOR | Attendance commit |
| `backend/app/Policies/TugasPolicy.php` | Tugas authorization | Tenant/creator/class/draft rules | Draft leak or teacher IDOR | Assignment/submission commit |
| `backend/app/Services/AcademicAccessService.php` | Shared academic authorization | Schedule/homeroom class scope | Teacher overreach | Shared by domain commits |
| `backend/app/Services/AttachmentClaimService.php` | Attachment | Locked tenant/actor/purpose claim | Attachment theft/reuse | Storage/idempotency commit |
| `backend/config/api_v2.php` | Configuration | Feature flag and idempotency TTL/lock | Unsafe defaults or cache drift | Storage/idempotency commit |
| `backend/database/migrations/2026_07_14_020000_harden_api_v2_phase_three_records.php` | Schema | Additive assignment/attachment claim fields | Untracked ownership/state | Storage/idempotency commit |
| `backend/tests/Feature/Api/V2/AttachmentClaimServiceTest.php` | Attachment test | Claim authorization/reuse coverage | Missing claim regression | Storage/idempotency commit |
| `backend/tests/Unit/Services/IdempotencyServiceTest.php` | Idempotency test | Replay/isolation/lock/header coverage | Cross-actor replay regression | Storage/idempotency commit |
| `src/lib/api/client.js` | Frontend infrastructure | Preserve envelope/response metadata | V2 consumer contract loss | Frontend integration commit |
| `src/services/assignmentService.js` | Frontend tugas | Callable V2 service/idempotent mutations | Runtime method mismatch | Frontend integration commit |
| `src/services/__tests__/phaseThreeServices.test.js` | Frontend test | Service contract and payload minimization | Silent V2 integration regression | Frontend integration commit |
| `docs/API_V2_STUDENTS.md` | Documentation | Student contract | Consumer/policy drift | Documentation commit |
| `docs/API_V2_ATTENDANCE.md` | Documentation | Attendance contract | Unsafe hard-delete expectations | Documentation commit |
| `docs/API_V2_ATTENDANCE_REQUESTS.md` | Documentation | Request state machine | Invalid transition expectations | Documentation commit |
| `docs/API_V2_ASSIGNMENTS.md` | Documentation | Assignment contract | Draft/scope drift | Documentation commit |
| `docs/API_V2_SUBMISSIONS.md` | Documentation | Submission/grade contract | Ownership drift | Documentation commit |
| `docs/API_V2_UPLOADS.md` | Documentation | Upload PARTIAL status/blockers | False security claim | Documentation commit |
| `docs/IDEMPOTENCY.md` | Documentation | Identity, TTL, lock, replay contract | Incorrect client retry behavior | Documentation commit |
| `docs/audit/API_V2_PHASE_3_STASH_CHECKLIST.md` | Documentation / audit | Safety stash reconciliation | Lost or accidentally restored Phase 3 path | Documentation commit |

All 72 Phase 3 paths are classified. No native mobile path is included.
