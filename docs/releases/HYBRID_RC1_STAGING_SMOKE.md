# Hybrid RC1 Staging Smoke Checklist

Use this checklist only against an isolated staging tenant and staging API.
Do not use production credentials, production tenant data, or the production
API URL. Record the exact release SHA, browser, viewport, role, endpoint,
HTTP status, and `X-Request-ID` for every failure.

## Preconditions

- [ ] Staging frontend URL is distinct from production.
- [ ] Staging API URL is distinct from production.
- [ ] Backend `/api/health` returns the safe health response.
- [ ] Backend `/api/ready` reports database, Redis, queue, and storage ready.
- [ ] Login fixtures exist for Super Admin, Admin Sekolah, Guru, Wali Kelas,
      and Siswa in the staging tenant.
- [ ] A second staging tenant exists for cross-tenant denial tests.
- [ ] Release SHA is visible in deployment metadata and logs.
- [ ] Browser Network and console are recorded for each role.

## Common Acceptance Rules

For every flow:

- [ ] no unexpected 404, 500, or 502 response;
- [ ] no repeated 401 request loop;
- [ ] every API error exposes a safe `request_id` and no secret/SQL/token;
- [ ] no blank page or uncaught React error;
- [ ] no V2-to-legacy fallback for a migrated domain;
- [ ] tenant and academic-year data remain isolated.

## Super Admin

- [ ] Login and logout once; confirm one `/api/auth/*` flow and no 401 loop.
- [ ] Dashboard and monitor load; inspect frontend error logs and request IDs.
- [ ] Tenant list/detail shows only authorized tenants.
- [ ] Readiness/health and release metadata are visible to the authorized role.
- [ ] Attempt a tenant-scoped resource from another tenant and confirm 403/404,
      never data disclosure.

## Admin Sekolah

- [ ] Login/logout.
- [ ] Dashboard, classes, teachers, students, schedules, attendance, settings,
      backup, and reports load.
- [ ] Create/update/delete one staging-only schedule with an idempotency key;
      repeat the same request and confirm one mutation.
- [ ] Select an archived academic year for read-only viewing; mutation is
      rejected with the period-locked contract unless correction is approved.
- [ ] Export a report and confirm the download is tenant-scoped.
- [ ] Confirm compatibility requests match only registered legacy consumers.

## Guru

- [ ] Login/logout.
- [ ] Dashboard, schedule, assignments, quiz, attendance, reports, and report
      cards load.
- [ ] In `Laporan`, load weights, manual scores, attendance/task/quiz summaries,
      and report-card data.
- [ ] Save one weight and one manual score; verify the response has a request
      ID and server-owned tenant/actor fields are not browser-controlled.
- [ ] Read/write only an assigned subject and assigned class.
- [ ] Attempt another teacher's subject/class and confirm denial.
- [ ] Export the report and verify no `/api/db` or `/api/db/batch` request.

## Wali Kelas

- [ ] Login/logout.
- [ ] Open homeroom dashboard, roster, attendance, reports, and report cards.
- [ ] Verify the homeroom options and summary use the selected academic year
      and semester.
- [ ] Attempt another class and another tenant; confirm denial.
- [ ] Verify archived report-card reads use the historical roster and do not
      use the student's current profile class.

## Siswa

- [ ] Login/logout.
- [ ] Dashboard, schedule, attendance, assignments, quiz, extracurricular,
      grades, report cards, and profile load.
- [ ] Submit only an allowed assignment/quiz for the active period.
- [ ] Verify archived periods are readable where intended and mutation is
      rejected.
- [ ] Attempt another student's report/attendance resource and confirm 403/404.

## Network Evidence Targets

| Flow | Expected target | Required evidence |
|---|---|---|
| `Laporan` weights/manual scores/report cards | `/api/v2/grades/*`, `/api/v2/reports/*`, `/api/v2/report-cards/*` | `/api/db` = 0; `/api/db/batch` = 0 |
| Schedule V2-enabled flow | `/api/v2/schedules*` | no hidden legacy fallback |
| Remaining hybrid domain | registered legacy route or its V2 route | match `config/api-legacy-consumers.json` |
| Health | `/api/health`, `/api/ready` | safe response and request ID |
| Any error | API error envelope | `request_id` present; no sensitive details |

## Result

Status values are `PASS`, `FAIL`, or `BLOCKED`. A missing runtime or missing
role fixture is `BLOCKED`, never `PASS`. Browser smoke was not run for RC1 at
the time this checklist was created.

## Current RC1 Result

- Release SHA: verify with `git rev-parse release/hybrid-rc1` before smoke.
- Smoke status: **BLOCKED**.
- Reason: isolated staging URLs, dependency services, browser runtime, and
  role/second-tenant fixtures were not available in this environment.
- Production smoke: **NOT PERFORMED**.
