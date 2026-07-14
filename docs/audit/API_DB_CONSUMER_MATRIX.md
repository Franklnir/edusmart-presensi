# `/api/db` Consumer Matrix

- Static snapshot: 2026-07-14 (Asia/Jakarta)
- Runtime first/last seen: unavailable until legacy telemetry is deployed
- Removal rule: static consumers zero **and** staging telemetry zero for the
  agreed observation window

The central query builder in `src/lib/supabase.js` maps every
`supabase.from(...)` operation to `/api/db` (or `/api/db/batch`). Therefore an
indirect table call is an active DB-proxy consumer even when the literal route
does not appear in the page.

| Consumer | Tables/operation family | Replacement | Last Seen | Status |
|---|---|---|---|---|
| `src/lib/supabase.js` | generic select/insert/update/delete/upsert/batch | domain V2 services | Runtime telemetry pending | ACTIVE |
| `src/store/useAuthStore.js`, auth pages | `profiles` provisioning/read | auth/profile server workflow | Runtime telemetry pending | ACTIVE |
| `src/pages/siswa/EditProfile.jsx`, guru profile | `profiles` update | profile V2 | Runtime telemetry pending | ACTIVE |
| `src/pages/admin/Kelas.jsx` | `kelas`, `jadwal`, school structure | classes V2 plus schedules V2 | Runtime telemetry pending | ACTIVE/PARTIAL |
| `src/pages/admin/Guru.jsx` | `profiles`, `jadwal` | teachers V2 plus schedules V2 | Runtime telemetry pending | ACTIVE/PARTIAL |
| student admin/features | student/profile/import tables | students V2 plus import/profile V2 | Runtime telemetry pending | ACTIVE/PARTIAL |
| `src/pages/admin/Scan.jsx` | `jadwal`, `absensi`, `rfid_scans` | attendance, schedule, RFID event V2 | Runtime telemetry pending | ACTIVE/PARTIAL |
| `src/pages/guru/AbsensiGuru.jsx` | schedules, profiles, attendance/requests, RFID scans | attendance/request, schedule, RFID V2 | Runtime telemetry pending | ACTIVE/PARTIAL |
| student attendance hooks/components | schedules, attendance/settings/requests/scans | attendance/request and schedule V2 | Runtime telemetry pending | ACTIVE/PARTIAL |
| `src/pages/guru/TugasGuru.jsx` | `jadwal`, `kelas`, `tugas`, `tugas_jawaban` | assignment/submission and schedule V2 | Runtime telemetry pending | ACTIVE/PARTIAL |
| `src/pages/siswa/Tugas.jsx`, dashboard | `jadwal`, `tugas`, `tugas_jawaban` | assignment/submission and schedule V2 | Runtime telemetry pending | ACTIVE/PARTIAL |
| `src/pages/guru/Quiz.jsx` | schedules/classes/quizzes/questions/options | quiz/question/attempt and schedule V2 | Runtime telemetry pending | ACTIVE |
| `src/pages/siswa/Quiz.jsx` | schedules/quiz attempt support | quiz-attempt and schedule V2 | Runtime telemetry pending | ACTIVE |
| `src/pages/guru/Laporan.jsx`, `RapotSiswa.jsx` | grades/weights/raport, schedules, tasks, quizzes, extracurriculars | grade/raport/report and related V2 | Runtime telemetry pending | ACTIVE |
| admin/student/guru dashboards | `pengumuman`, `ekskul`, `ekskul_anggota` | announcement/extracurricular V2 | Runtime telemetry pending | ACTIVE |
| `src/pages/admin/Sertifikat.jsx` | profiles/classes/extracurriculars/certificates/templates | certificate plus referenced-domain V2 | Runtime telemetry pending | ACTIVE |
| academic context/settings/structure | settings, academic lifecycle and organization tables | settings/academic/organization V2 | Runtime telemetry pending | ACTIVE |
| RFID realtime listener | update `rfid_scans` consumed status | device attendance event V2 | Runtime telemetry pending | ACTIVE |
| monitor log pages | only display `/api/db` as an observed filter value | frontend-log V2 | N/A | NOT_A_CONSUMER |
| source documentation examples | example `supabase.from(...)` | update documentation | N/A | UNUSED |

## Required telemetry fields

Before deprecation, legacy middleware must record a privacy-safe event with:

- request ID, release identifier, route and operation;
- normalized domain/table allowlist value (never raw SQL or body);
- authenticated role and tenant pseudonymous identifier;
- caller/consumer identifier supplied by the frontend build;
- first seen, last seen, count, status class and latency bucket.

Credentials, cookies, authorization headers, arbitrary request bodies and raw
personal identifiers must never be logged.

## Current decision

`/api/db` remains required. Static active consumers are non-zero and there is no
runtime observation window yet.
