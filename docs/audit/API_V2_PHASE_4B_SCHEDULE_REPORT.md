# API V2 Phase 4B Report - Schedules

- Date: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Decision: `READY_FOR_GRADES_IMPLEMENTATION`
- Production rollout: blocked until the staging acceptance checks below pass

## Scope and Invariant

Jadwal is an annual resource. Its authoritative scope is
`tenant_id + tahun_ajaran`; it is deliberately not duplicated for Ganjil and
Genap. A semester query selects academic context and archive/correction rules,
but it never filters an annual schedule row.

The API returns `periode_berlaku: tahunan` and `semester: null` for every
schedule. Student reads use current enrollment or historical enrollment for the
requested academic year. A teacher normally sees only their own schedule; a
homeroom teacher can read the full class schedule only for their assigned class
and year.

## Delivered Contract

| Method | Endpoint | Role | Notes |
|---|---|---|---|
| `GET` | `/api/v2/schedules` | Admin, Guru, Siswa | Server scopes tenant, year, role, class, and historical enrollment. Pagination is capped at 500 rows. |
| `GET` | `/api/v2/schedules/{id}` | Admin, Guru, Siswa | Legacy duplicate IDs require immutable `kelas_id` as a locator. |
| `POST` | `/api/v2/schedules` | Admin | Tenant, active year, teacher display name, UUID, and audit data are server-owned. |
| `PATCH` | `/api/v2/schedules/{id}` | Admin | Requires `kelas_id`; partial edits are validated on the resolved final record. |
| `DELETE` | `/api/v2/schedules/{id}` | Admin | Requires `kelas_id` and an `Idempotency-Key`. |

`src/services/scheduleService.js` is the only browser client for this contract.
It fetches every API page for exports, therefore an export does not silently
stop at one API page.

## Consumer Coverage When the Flag Is On

`VITE_USE_SCHEDULES_API_V2=true` uses V2 with no V2-to-legacy fallback for the
following schedule workflows:

| Role | Consumer | V2 behaviour |
|---|---|---|
| Admin | `Kelas` | List, create, edit, delete, class preview, Excel/PDF export, subject-in-use check. |
| Admin | `Guru`, `Scan` | Removes unused direct schedule preload; attendance/RFID schedule lookup is V2 scoped. |
| Guru | `JadwalGuru`, `AbsensiGuru` | Teaching schedule and attendance schedule options are V2 scoped. The legacy table realtime channel is disabled under the flag. |
| Guru | `TugasGuru`, `Quiz` | Class/subject schedule options are V2 scoped. |
| Guru | `Laporan`, `RapotSiswa` | Own-subject schedules and homeroom class schedule scope are V2 scoped. Reports and grades themselves remain separate legacy domains. |
| Siswa | `Tugas`, `Quiz` | Subject/class schedule options use the student’s server-resolved current or historical enrollment. |
| Siswa | Attendance hooks, `MapelOptions` | Daily, weekly, and subject options use V2 scoped by class, day, and academic year. |

The compatibility branch remains only when the flag is explicitly `false`.
There is no catch-and-fallback from `/api/v2/schedules` to `/api/db`: an API
failure surfaces an actionable error with request ID instead of risking mixed
or cross-period data.

## Security and Correctness Controls

- Tenant identity comes solely from tenancy middleware, never the browser.
- Active mutations obtain the year from `AcademicMutationGuard`. Archived data
  is read-only unless a valid, tenant-scoped correction session is active.
- Teacher identity is verified in the tenant and `guru_nama` is derived on the
  server.
- Class and teacher time conflicts are checked in a database transaction while
  the affected class and teacher records are locked.
- Start time must precede finish time and a lesson is at least 30 minutes.
  Adjacent ranges are valid; overlapping ranges return `409`.
- Every mutation is idempotent and produces an audit entry with actor, tenant,
  academic context, before/after state, and request ID.
- Server pagination is bounded. `listAllSchedules()` deliberately paginates
  rather than asking the server for an unlimited result.

## Performance and Cache Safety

The V2 read paths are supported by these additive indexes:

- `jadwal_v2_tenant_year_class_day_time_idx`
- `jadwal_v2_tenant_year_teacher_day_time_idx`

They match the two dominant access patterns: class/day reads for admins and
students, and teacher/day reads for teachers. Existing period indexes remain
in place for legacy rollback.

V2 requests go through the authenticated `apiClient`; they do not use the
legacy `/api/db` response cache. The service worker caches application assets,
not a shared schedule response, so switching the feature flag cannot mix
legacy and V2 schedule rows. Before production enablement, capture
`EXPLAIN (ANALYZE, BUFFERS)` on representative tenant/year/class and
tenant/year/teacher queries in staging with production-like data.

## Error Monitoring

Browser `error` and `unhandledrejection` events are rate-limited, deduplicated,
redacted, and sent to `/api/v2/frontend-logs`. Tenant admins can inspect their
own entries in Monitor Log; Super Admin sees the aggregate in Super Monitor.
This replaces normal manual DevTools checking for application errors, while
DevTools remains useful for one-off diagnosis and browser-extension errors are
intentionally ignored.

## Quality Gates

Run from the repository root:

```bash
cd backend && php artisan test tests/Feature/Api/V2/ScheduleControllerTest.php
cd .. && npm run test -- --run src/services/__tests__/phaseThreeServices.test.js
npm run audit:schedules-v2
npm run check
VITE_USE_SCHEDULES_API_V2=true npm run check
```

`npm run audit:schedules-v2` fails CI when a new direct `jadwal` access is
introduced outside the reviewed rollback sources or without a V2 guard.

## Staging Rollout

The default remains off in production builds:

```text
VITE_USE_SCHEDULES_API_V2=false
```

Set only the isolated Cloudflare Pages/staging environment variable below to
`true`, deploy a fresh bundle, and use staging tenants first:

```text
STAGING_USE_SCHEDULES_API_V2=true
```

Required acceptance checks:

1. Admin completes list, create, edit, delete, preview, and Excel/PDF export.
2. Teacher sees own schedule; homeroom teacher sees the assigned class schedule;
   another teacher cannot read that class schedule.
3. Student sees the correct current class and historical class schedule in an
   archive year.
4. Ganjil and Genap show the same annual schedule for one year.
5. Class and teacher conflicts return `409`; an adjacent lesson succeeds.
6. Repeating one mutation with its idempotency key produces one change.
7. Archive reads work and archive mutations return `409 Period Locked` unless a
   valid correction session exists.
8. Network shows `/api/v2/schedules` for every workflow listed above and no
   schedule-related `/api/db` request while the flag is on.
9. Monitor Log and Super Monitor receive a deliberately generated browser error
   without storing token, query-secret, or user input.

Do not enable the flag in production until this checklist and the staging query
plan check pass. The broader `/api/db` gateway remains enabled because grades,
reports, quiz, RFID, and other domains still have active legacy consumers.
