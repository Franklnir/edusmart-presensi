# API V2 Remaining Consumer Inventory

- Snapshot: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Base commit: `53dffaea`
- Method: static source inventory with `rg`; runtime last-seen data is not yet
  available

This is the migration backlog after Phase 3. `MIGRATED` means the active path
uses V2. `PARTIAL` means a feature-flagged V2 path exists but an active legacy
branch remains. `LEGACY` means there is no complete V2 replacement. `BLOCKED`
means the source can be migrated only after its parent domain or external
runtime prerequisite is ready. A route existing by itself is not considered a
migration.

## Business consumers

| Domain | Consumer | Operasi | Endpoint Lama | Endpoint V2 | Status |
|---|---|---|---|---|---|
| Classes | `src/pages/admin/Kelas.jsx` | CRUD kelas plus schedule preview/options | `/api/db` (`kelas`, rollback-only `jadwal`) | `/api/v2/classes`; schedule V2 for preview/CRUD/export under flag | PARTIAL |
| Teachers | `src/pages/admin/Guru.jsx` | list/update teacher | `/api/db` (`profiles`) | `/api/v2/teachers` pending; unused direct schedule preload removed | PARTIAL |
| Students | `src/pages/admin/Siswa.jsx`, student feature hooks | list, CRUD, activate/deactivate, RFID enrollment | `/api/db`, `/api/rfid/set-mode` | `/api/v2/students`; RFID V2 pending | PARTIAL |
| Student profile | `src/pages/siswa/EditProfile.jsx` | update profile/avatar | `/api/db`, `/api/storage/*` | profile and Upload/Attachment V2 pending | LEGACY |
| Auth profile provisioning | `src/store/useAuthStore.js`, `src/pages/auth/Register.jsx` | create/read profile after auth | `/api/db`; `/api/auth/*` | version-neutral auth may remain; profile provisioning contract pending | LEGACY |
| Attendance | `src/pages/admin/Scan.jsx` | schedule lookup, attendance upsert, scan status | `/api/db` (`absensi`, `rfid_scans`; schedule rollback only) | `/api/v2/attendance`; schedule lookup V2 under flag; RFID pending | PARTIAL |
| Attendance | `src/pages/guru/AbsensiGuru.jsx` | schedule/student/attendance/request reads and mutations | `/api/db` (schedule rollback only; attendance legacy) | `/api/v2/attendance`, `/api/v2/attendance-requests`; schedule read V2 under flag | PARTIAL |
| Attendance | `src/features/attendance/hooks/useStudentAttendanceData.js` | today/week schedule and attendance status | `/api/db` (schedule rollback only; attendance legacy) | attendance V2; schedule read V2 under flag | PARTIAL |
| Attendance | `src/features/attendance/hooks/useStudentAttendanceActions.js` | self attendance and attendance request | `/api/db` (`absensi`, `absensi_ajuan`) | `/api/v2/attendance`, `/api/v2/attendance-requests` | PARTIAL |
| Attendance | `src/features/attendance/components/RingkasanKelasTable.jsx`, `useStudentAttendanceRealtime.js` | summary and realtime refresh | `/api/db`/legacy realtime | attendance V2 read contract; event transport pending | PARTIAL |
| Assignments | `src/pages/guru/TugasGuru.jsx` | list/detail/CRUD, publish-like state, submission list/grade, schedule/class options, file upload/delete | `/api/tugas*`, `/api/db`, `/api/storage/*` | `/api/v2/assignments`, `/api/v2/submissions`; schedule options V2 under flag | PARTIAL |
| Assignments | `src/pages/siswa/Tugas.jsx` | list/detail/submit/revise, schedule read, file upload/delete | `/api/tugas*`, `/api/db`, `/api/storage/*` | assignments/submissions V2; schedule options V2 under flag | PARTIAL |
| Assignment dashboard | `src/pages/siswa/Home.jsx` | assignment cards/detail | `/api/db` (`tugas`, `tugas_jawaban`) | assignments/submissions V2 | PARTIAL |
| Upload/Attachment | `src/lib/supabase.js` storage compatibility adapter | initiate, relay upload, complete, signed/public URL, download, delete | `/api/storage/*` | `/api/v2/uploads`, `/api/v2/attachments/*` implemented for assignment/submission | PARTIAL |
| Upload/Attachment | `src/pages/guru/TugasGuru.jsx`, `src/pages/siswa/Tugas.jsx` | assignment/submission upload progress, cancel, authorized download/removal | `/api/storage/*` when V2 flag is false | strict `uploadService` V2 path; no error fallback | PARTIAL (STAGING FLAG OFF) |
| Upload/Attachment | `src/pages/admin/pengaturan.jsx`, `src/pages/guru/profile.jsx`, `src/utils/certificateFiles.js` | settings/profile/certificate assets | `/api/storage/*` | generic parent-aware Attachment V2 integration pending | LEGACY |
| Grades | `src/pages/guru/Laporan.jsx` | weights, manual grades, task/quiz recap, export inputs | `/api/db`, `/api/reports/*` | `/api/v2/grades*` pending; schedule dependencies V2 under flag | LEGACY |
| Grades/Raport | `src/pages/guru/RapotSiswa.jsx` | raport CRUD, items, schedule-derived subjects | `/api/db` (`rapot_siswa*`; schedule rollback only) | grade/raport V2 pending schema mapping; schedule dependency V2 under flag | LEGACY |
| Grades | assignment/quiz grade widgets and student dashboards | view/edit task and quiz scores | `/api/db`, `/api/quiz/*` | grade V2 plus submission/attempt resources pending | LEGACY |
| Quiz authoring | `src/pages/guru/Quiz.jsx` | dashboard/detail, CRUD quiz/questions/options, schedule, publish/close/clone, essay grade/retake | `/api/quiz/*`, `/api/db`, `/api/storage/*` | `/api/v2/quizzes*`, question/attempt V2 pending; schedule options V2 under flag | LEGACY |
| Quiz attempts | `src/pages/siswa/Quiz.jsx` | dashboard/detail/start/autosave/submit/violation/retake/media | `/api/quiz/*`, `/api/storage/object` | `/api/v2/quiz-attempts*` and Attachment download pending; schedule options V2 under flag | LEGACY |
| Quiz reports | `src/pages/guru/Laporan.jsx` | quiz summary and score inputs | `/api/reports/quiz-summary`, `/api/db` | report and quiz-attempt V2 pending | LEGACY |
| Schedules | `src/pages/admin/Kelas.jsx` | schedule list/create/update/delete/preview/export | `/api/db` only when the flag is false | `/api/v2/schedules*`; complete under `VITE_USE_SCHEDULES_API_V2` | PARTIAL (STAGING FLAG OFF) |
| Schedules | `src/pages/admin/Scan.jsx`, `src/pages/guru/AbsensiGuru.jsx` | attendance schedule lookup and options | `/api/db` only when the flag is false | `/api/v2/schedules*`; complete under flag, with no V2 fallback | PARTIAL (STAGING FLAG OFF) |
| Schedules | `src/pages/guru/JadwalGuru.jsx`, `TugasGuru.jsx`, `Quiz.jsx` | teacher schedule and class/subject options | `/api/db` only when the flag is false | `/api/v2/schedules*`; complete under flag, with no V2 fallback | PARTIAL (STAGING FLAG OFF) |
| Schedules | `src/pages/guru/Laporan.jsx`, `RapotSiswa.jsx` | own-subject and homeroom class schedule scope | `/api/db` only when the flag is false | `/api/v2/schedules*`; complete under flag; report/grade domain remains legacy | PARTIAL (STAGING FLAG OFF) |
| Schedules | `src/features/attendance/components/MapelOptions.jsx`, `useStudentAttendanceData.js` | student daily/weekly and subject schedule options | `/api/db` only when the flag is false | `/api/v2/schedules*`; complete under flag, historical enrollment enforced server-side | PARTIAL (STAGING FLAG OFF) |
| Schedules | `src/pages/siswa/Tugas.jsx`, `Quiz.jsx` | student class and subject schedule options | `/api/db` only when the flag is false | `/api/v2/schedules*`; complete under flag, with no V2 fallback | PARTIAL (STAGING FLAG OFF) |
| Announcements | `src/pages/admin/Home.jsx` | list/create/update/delete | `/api/db` (`pengumuman`) | `/api/v2/announcements*` pending | LEGACY |
| Announcements | `src/pages/guru/JadwalGuru.jsx`, `src/pages/siswa/Home.jsx` | role-scoped dashboard list | `/api/db` (`pengumuman`) | `/api/v2/announcements*` pending | LEGACY |
| Extracurriculars | `src/pages/admin/Home.jsx` | catalogue/member list, create/join/remove | `/api/db` (`ekskul`, `ekskul_anggota`) | `/api/v2/extracurriculars*` pending | LEGACY |
| Extracurriculars | `src/pages/siswa/Home.jsx` | list/membership/join | `/api/db` (`ekskul`, `ekskul_anggota`) | extracurricular/member V2 pending | LEGACY |
| Extracurriculars | `src/pages/guru/JadwalGuru.jsx`, `src/pages/guru/Laporan.jsx`, `src/pages/admin/Sertifikat.jsx` | membership/options/report/certificate recipients | `/api/db` | extracurricular/member V2 pending | LEGACY |
| Reports | `src/pages/guru/Laporan.jsx` | homeroom options, teacher/attendance/task/quiz/homeroom summaries and export | `/api/reports/*`, `/api/db` | `/api/v2/reports*` pending | LEGACY |
| Reports | dashboard cards and widgets in admin/guru/student pages | summary counts and recent data | `/api/db` and domain legacy routes | per-domain V2 summary endpoints pending | LEGACY |
| Certificates | `src/pages/admin/Sertifikat.jsx` | recipient lookup, certificate/template CRUD, upload/download/delete | `/api/db`, `/api/storage/*` | certificate and Attachment V2 pending | LEGACY |
| Library | no active library page or direct library table consumer found in `src` | none observed | none observed | define only if runtime/business source proves active | UNUSED |
| RFID cards | `src/features/students/hooks/useStudentRfidActions.js` | enroll/set mode/unlink card | `/api/rfid/set-mode`, student mutation | `/api/v2/rfid-cards*` pending | LEGACY |
| RFID scan | `src/pages/admin/Scan.jsx`, `src/pages/guru/AbsensiGuru.jsx` | poll/read/update scan events | `/api/db` (`rfid_scans`) | device attendance event V2 pending | LEGACY |
| RFID realtime | `src/features/attendance/hooks/useStudentRfidAttendanceListener.js` | subscribe scan and mark consumed | legacy realtime plus `/api/db` update | authenticated device-event V2 transport pending | LEGACY |
| Devices | RFID admin service/pages and `src/lib/adminApi.js` | provision/list/delete, live event stream | version-neutral RFID/device routes and SSE | `/api/v2/devices*`, `/api/v2/device-attendance-events*` pending | LEGACY |

## Shared and indirect consumers

| Domain | Consumer | Operasi | Endpoint Lama | Endpoint V2 | Status |
|---|---|---|---|---|---|
| Academic context | `src/context/AcademicContext.jsx` | settings/period bootstrap used by all domains | `/api/db` | scoped settings/academic-period V2 pending | LEGACY |
| Navbar/dashboard | `src/components/Navbar/hooks.js` | profile/presence/notification refresh | `/api/db` | profile/notification contract pending | LEGACY |
| Organization/school structure | admin class/settings views | structure, organizations, membership, import histories | `/api/db` | out-of-phase V2 domain contract pending | LEGACY |
| PWA cache | `src/lib/supabase.js` cache policy and generated service worker | caches selected GET/DB-proxy/report/quiz reads | `/api/db`, `/api/reports/*`, `/api/quiz/*` | invalidate/re-key when each V2 service cuts over | PARTIAL |
| Monitor UI | `src/pages/admin/MonitorLog.jsx`, `SuperMonitorLog.jsx`, global browser reporter | tenant and aggregate browser errors, including global errors and rejected promises | does not call `/api/db` for business data | `/api/v2/frontend-logs*` and Super Monitor aggregate | MIGRATED |
| Generic compatibility | `src/lib/supabase.js` query builder and batch adapter | arbitrary table select/insert/update/delete/upsert | `/api/db`, `/api/db/batch` | replace per domain; no generic V2 equivalent | LEGACY |
| Internal documentation | `src/docs/SWR_CACHING_GUIDE.md` | example only | example `supabase.from(...)` | update after final cutover | UNUSED |

## Direct HTTP and background integration review

- Direct storage/blob fetches remain in assignment, certificate, profile, and
  quiz-media paths. They must use an authorized Attachment download rather than
  accepting a permanent URL.
- RFID event streaming in `src/lib/adminApi.js` is active and must be included
  in the device cutover even though it does not use `/api/db`.
- Browser NFC and RFID realtime are active integration paths, not native-mobile
  remnants.
- The generated PWA service worker contains built assets only. The application
  cache rules in `src/lib/supabase.js` are the relevant runtime consumer and
  must be retested per cutover.
- No active frontend library/perpustakaan consumer was found. Backend routes and
  runtime telemetry must confirm whether the domain is unused before it is
  omitted.

## Gate

The repository has active legacy business consumers, so the current decision is
`READY_FOR_NEXT_PHASE`, not API V2 complete. `/api/db` must remain enabled until
this inventory reaches zero active consumers and runtime telemetry independently
confirms zero use.
