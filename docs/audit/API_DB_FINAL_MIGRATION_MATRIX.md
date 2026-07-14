# API DB Final Migration Matrix

- Snapshot: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Purpose: execution register for replacing the legacy `/api/db` gateway. This
  document is intentionally retained until the zero-consumer observation gate
  is complete.

`MIGRATED` means the active production path has no legacy database-proxy
fallback. `IMPLEMENTING` means a V2 contract exists but is still gated or has
active legacy consumers. `LEGACY` means the gateway remains on an active path.

| Domain | Consumer | Operasi | Endpoint Lama | Endpoint V2 | Status |
|---|---|---|---|---|---|
| Shared academic context | `AcademicContext.jsx` | active year and term bootstrap | none | `/api/v2/academic-context` | MIGRATED |
| Current profile | auth bootstrap, EditProfile | current profile read and self update | `/api/db`, `/api/profile/me`, legacy storage avatar path | `/api/v2/profile`; profile Attachment V2 pending | IMPLEMENTING |
| Navbar | navbar hooks | profile, presence, notifications | `/api/db` | profile and notification resources | LEGACY |
| Dashboard | admin, teacher, student pages | role summaries and cards | `/api/db` | role dashboard resources | LEGACY |
| Classes | admin class page | class CRUD | `/api/db` | `/api/v2/classes` | IMPLEMENTING |
| Students | admin and student feature hooks | roster, state, RFID enrollment | `/api/db`, RFID legacy | `/api/v2/students` | IMPLEMENTING |
| Teachers | admin teacher page | roster and teacher CRUD | `/api/db` | `/api/v2/teachers` | IMPLEMENTING |
| Schedules | admin, teacher, attendance subject options | annual schedule CRUD and export | `/api/db` | `/api/v2/schedules` | IMPLEMENTING |
| Attendance | admin, teacher, student | read, record, requests | `/api/db` | `/api/v2/attendance`, `/api/v2/attendance-requests` | IMPLEMENTING |
| Assignments | teacher and student pages | assignment and submission workflows | `/api/db`, `/api/tugas` | `/api/v2/assignments`, `/api/v2/submissions` | IMPLEMENTING |
| Attachments | assignment and submission flows | upload and authorized download | `/api/storage/*` | `/api/v2/uploads`, `/api/v2/attachments` | IMPLEMENTING |
| Grades | teacher report and grade widgets | weights, manual scores, recap | `/api/db`, reports legacy | `/api/v2/grades` | LEGACY |
| Report cards | teacher report-card page | report-card CRUD and items | `/api/db` | `/api/v2/report-cards` | LEGACY |
| Quizzes | teacher and student quiz pages | authoring, attempts, grading, retake | `/api/quiz/*`, `/api/db` | quiz and attempt resources | LEGACY |
| Reports | teacher reports and dashboard widgets | aggregates and exports | `/api/reports/*`, `/api/db` | `/api/v2/reports` | LEGACY |
| Announcements | admin and dashboards | create, publish, read | `/api/db` | `/api/v2/announcements` | LEGACY |
| School structure | class and settings tabs | structure and organization membership | `/api/db` | structure and organization resources | LEGACY |
| Extracurriculars | admin, teacher, student | catalogue, registration, reporting | `/api/db` | extracurricular resources | LEGACY |
| Certificates | admin certificate page | template, recipient, attachment flow | `/api/db`, `/api/storage/*` | certificate and attachment resources | LEGACY |
| RFID cards | student management | enroll, unlink, mode | `/api/rfid/*`, `/api/db` | RFID card resources | LEGACY |
| Devices and live scans | scan pages and admin API | devices, SSE, scan events | legacy device/RFID routes | device and event resources | LEGACY |
| Settings | school settings, public bootstrap | tenant settings and assets | `/api/db`, legacy settings | settings resources | LEGACY |
| Library | no confirmed active consumer | none found in frontend source | none observed | define only after runtime evidence | UNUSED |

## Enforcement State

The CI task `npm run audit:api-db-legacy` rejects new generic query consumers.
Its explicit allowlist is temporary and must shrink in the same commit as each
consumer migration. Runtime use is aggregated in `db_proxy_usage_telemetry`;
it stores request metadata only and never request payloads, cookies, tokens,
or academic values.

The gateway remains enabled while any row in this matrix is `LEGACY` or
`IMPLEMENTING`. It must first reach zero active consumers, then pass staging
observation with `API_DB_ENABLED=false` before physical removal is considered.
