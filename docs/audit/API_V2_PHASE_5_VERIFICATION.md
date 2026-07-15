# API V2 Phase 5 Deployment Verification

- Date: 2026-07-15 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- HEAD: `fc0156b421203cc5dacdbe6f8940edf7da63b539`
- Scope: verification and deployment-blocker fixes only
- Deployment/VPS action: **none**
- Decision: **NOT_READY**

## Executive Decision

Phase 5 is **NOT_READY** for deployment. The repository still has an active
legacy database compatibility path and active frontend business consumers that
reach it through `src/lib/supabase.js`. The DB proxy routes were intentionally
restored during this audit so the existing frontend does not silently break.

The following conditions required by the deployment gate are not met:

- active `/api/db` consumer count is greater than zero;
- `/api/db` and `/api/db/batch` are still registered;
- `Laporan.jsx` still reads and writes weights, manual scores, and report-card
  data through the compatibility adapter;
- backend suite has 29 failing tests and 10 skipped tests;
- browser smoke testing is blocked because no local/staging runtime and role
  fixtures were available;
- the working tree is not clean;
- deployment backup and rollback were not verified in this task.

No push, merge, deployment, or VPS change was performed.

## Fixes Applied During Verification

The following blocker was fixed without changing deployment infrastructure:

- The V2 organization context endpoint conflicted with the V2 organization
  CRUD index at `/api/v2/organizations`. The context endpoint now uses
  `/api/v2/organization-context`.
- Frontend organization context calls, route documentation, and focused tests
  were updated to the new endpoint.
- The organization context tests now pass: 2 tests, 13 assertions.
- API route documentation coverage passes for the current catalog.
- The deleted security and consistency tests found in the working tree were
  restored. They were not treated as obsolete merely because legacy writes now
  return `410`.
- Focused teacher dashboard authorization tests were added and pass: 4 tests,
  16 assertions.
- The frontend focus lint run has 0 errors. Remaining output is warnings only.

These fixes do not make Phase 5 deployable because the consumer migration is
not complete.

## 1. Static Zero-Consumer Audit

The requested search was run from the repository root. The exact expression
does not catch every multiline chained call, so the result was supplemented
with a broader source review of `supabase` consumers.

| Classification | Findings |
|---|---|
| `ACTIVE_BUSINESS_CONSUMER` | `src/lib/supabase.js` still implements the compatibility query builder, `/api/db` request paths, `/api/db/batch`, cache keys, PWA cache handling, and polling/realtime compatibility. `src/pages/guru/Laporan.jsx` still uses this adapter for `guru_mapel_bobot`, `guru_mapel_manual_nilai`, `rapot_siswa`, and `rapot_siswa_items`. Attendance hooks, student/admin dashboards, teacher schedule/report consumers, auth/profile flows, and other lazy-loaded paths also retain adapter-backed reads or writes. |
| `UNUSED_CODE` | `/api/db` in the endpoint filter placeholders of `src/pages/admin/MonitorLog.jsx` and `src/pages/admin/SuperMonitorLog.jsx`. These are UI filter defaults, not HTTP calls. |
| `TEST_ONLY` | `/api/db` references in `src/lib/api/__tests__/client.test.js` and `src/lib/api/__tests__/db.test.js`. They verify compatibility-client behavior and do not prove zero production consumption. |
| `DOCUMENTATION_ONLY` | The `supabase.from(...)` example in `src/docs/SWR_CACHING_GUIDE.md`. |

Important active findings:

- `src/lib/supabase.js` exports `supabase.from(...)` and `supabase.batch(...)`
  and still builds requests to `/api/db` and `/api/db/batch`.
- `src/pages/guru/Laporan.jsx` is only partially migrated. V2 is used for
  some class, aggregate, submission, and quiz reads, but weights, manual
  scores, and report-card operations still use the adapter.
- Broad source review also found adapter-backed consumers in attendance
  realtime/polling hooks, student/admin dashboards, teacher schedule flows,
  student flows, and auth/profile provisioning.
- Therefore a simple `supabase\.from` search is insufficient: chained calls
  may be split across lines and the compatibility request is hidden inside
  the adapter.

**Static gate result: FAIL. Active consumer count is not zero.**

## 2. Route Legacy Audit

`cd backend && php artisan route:list` was run after the compatibility rollback.
The current inventory contains 368 routes.

| Endpoint Group | Route Count | Active Frontend Consumers | Replacement | Status |
|---|---:|---|---|---|
| `/api/db` | 1 | Yes, through `src/lib/supabase.js` and remaining legacy consumers | Per-domain V2 APIs | **BLOCKER: active** |
| `/api/db/batch` | 1 | Yes, through compatibility batch adapter | Per-domain V2 APIs | **BLOCKER: active** |
| `/api/admin/*` | 69 | Yes, partial and legacy admin flows | Per-domain V2 APIs | Legacy active |
| `/api/quiz/*` | 16 | Yes, quiz authoring/attempt/report flows | Quiz/question/attempt V2 | Legacy active |
| `/api/reports/*` | 6 | Yes, report consumers | Report/grade V2 | Legacy active |
| `/api/storage/*` | 7 | Yes, profile/certificate/upload flows | Upload/attachment V2 | Legacy active |
| `/api/rfid/*` | 5 | Yes, RFID enrollment/device flows | Device/event V2 | Legacy active |
| `/api/v2/*` | 141 | Yes, migrated and partial domains | V2 contracts | Partial rollout |

The DB routes are explicitly present:

```text
POST api/db       Api\\DbController@handle
POST api/db/batch Api\\DbController@batch
```

The route inventory must not be described as “all legacy APIs removed” while
the non-DB legacy groups remain active.

## 3. Test Deletion Audit

The requested commit-range command was run:

```text
git diff --name-status 2467e6ef...HEAD -- backend/tests
```

It produced no output. Therefore Phase 5, as represented by that commit range,
did not delete backend tests.

The working tree initially contained deletions, so they were restored during
this audit:

- `AcademicPeriodConsistencyTest.php`
- `AcademicRolloverExceptionPolicyTest.php`
- `ApiDocumentationRouteCoverageTest.php`
- `DelegatedAdminAuthorizationTest.php`
- `ProfileIdentitySyncTest.php`
- `QuizAutomationTest.php`
- `ScanTempPersistenceTest.php`
- the full `DbSecurityTest.php` rather than its reduced working-tree version

The current working-tree backend test diff contains modifications to existing
organization, subject, and super-admin tests, plus two new focused test files.
No deleted test remains in the current test tree.

### Replacement coverage

| Original coverage | Current result | Replacement/assessment |
|---|---|---|
| `DbSecurityTest` | Restored; 15 tests still fail because the legacy gateway returns 410 before the old domain assertion | No complete replacement for all legacy write behaviors. Keep or rewrite each behavior against its V2 endpoint before removing the test. |
| `AcademicPeriodConsistencyTest` | Restored; 5 tests still fail because the old write path returns 410 | `TeacherDashboardControllerTest` and V2 academic tests add partial coverage, but the report-card, weight, manual-score, and tenant-period assertions still need V2 API tests. |
| `ProfileIdentitySyncTest` | Restored; 2 tests fail on legacy profile writes | Profile V2 replacement coverage is incomplete. |
| `QuizAutomationTest` | Restored; 5 tests fail on legacy quiz writes | Quiz authoring/question V2 replacement coverage is incomplete. |
| `ScanTempPersistenceTest` | Restored; 1 test fails on legacy scan-temp write | RFID/device-event V2 replacement coverage is incomplete. |
| `ApiDocumentationRouteCoverageTest` | Passes after route catalog and organization-context documentation update | Replacement is present for the documentation invariant. |

`DbSecurityTest` cannot be considered obsolete solely because a middleware
returns 410. It protected tenant, role, academic-period, and server-owned-field
behavior. Those assertions must be moved to domain V2 tests before the legacy
test is removed.

The new `LegacyDbRouteRemovalTest` deliberately fails while the compatibility
routes remain. It is evidence for the final gate, not a false green test.

## 4. Test Count Comparison

Counts below distinguish the committed baseline from the current working tree
and the actual test run:

| Metric | Before Phase 5 baseline | Current working tree |
|---|---:|---:|
| Test files | 71 | 73 |
| Test methods discovered | 419 | 424 |
| Executed tests | 419 | 424 |
| Assertions from test run | 2033 | 2054 |
| Deleted test files | 0 in `2467e6ef...HEAD`; 0 after restoration | 0 |
| New focused test methods | 0 | 5 |

The current backend run is:

```text
385 passed, 29 failed, 10 skipped (2054 assertions)
```

The 29 failures are primarily old tests attempting operations that now stop at
`410 DB_LEGACY_WRITE_BLOCKED`, plus the intentionally failing route-removal
test. This cannot be reported as zero regression or as a successful migration.

## 5. Focused Functional Tests

Added and executed:

- report/teacher dashboard tenant and academic-year scope;
- teacher authorization;
- class/homeroom authorization;
- cross-tenant denial;
- V2 organization context route separation;
- API documentation route coverage;
- DB route absence assertion.

Results:

- Teacher dashboard focused suite: **4 passed, 16 assertions**.
- Organization context and route documentation focused suite: **3 passed, 13
  assertions**.
- DB route absence test: **failed**, because `/api/db` and `/api/db/batch` are
  still registered by the compatibility rollback.

The report-specific V2 replacement coverage is still incomplete for weights,
manual scores, report cards, and all report exports.

## 6. Frontend Validation

| Command | Result |
|---|---|
| `npm run test` | Pass: 5 files, 26 tests |
| `npm run build` | Pass; build completed with large PDF/PWA chunk warnings |
| `npm run check` | Pass; same bundle-size warnings |
| Focused `npx eslint ...` | 0 errors, 30 warnings |

The frontend build passing does not prove runtime safety. It cannot detect the
remaining adapter calls when the backend route is removed, and the browser
smoke gate below was not available.

No new 404 retry loop was demonstrated in a browser. This remains unverified,
not proven clean.

## 7. Browser Smoke Checklist

Status: **BLOCKED**.

No local/staging runtime with usable Admin, Guru, Wali Kelas, and Siswa
fixtures was available in this task. Consequently the following could not be
verified through browser Network:

- dashboard, jadwal, tugas, quiz, laporan, rapor, and presensi for all roles;
- `/api/db` request count = 0;
- `/api/db/batch` request count = 0;
- API 404 count = 0;
- 401 retry loop count = 0;
- hidden V2-to-legacy fallback count = 0.

This prevents a `READY_FOR_DEPLOYMENT` decision.

## 8. Final Command Gate

| Command | Result |
|---|---|
| `php artisan optimize:clear` | Blocked: local PHP lacks the PostgreSQL PDO driver; cache clear reaches a PostgreSQL connection and fails with `could not find driver` |
| `php artisan test` | Failed: 385 passed, 29 failed, 10 skipped |
| `./vendor/bin/pint --test` | Failed on the current dirty tree, including unrelated/pre-existing style debt; no broad formatter run was performed |
| `composer validate` | Blocked: `composer` is not installed in this environment |
| `composer audit` | Blocked: `composer` is not installed in this environment |
| `npm run test` | Passed |
| `npm run build` | Passed with bundle-size warnings |
| `npm run check` | Passed with bundle-size warnings |
| `git diff --check` | Failed: trailing whitespace exists in multiple modified files |
| `git status --short` | Failed clean-tree requirement: many tracked and untracked changes are present |

## Final Gate

```text
NOT_READY
```

The application must not be deployed from this state. The next required work
is to migrate the remaining active consumers, especially the report/grade
contract used by `Laporan.jsx`, add replacement security and academic-period
tests for each removed legacy behavior, run browser smoke against an isolated
staging environment, then repeat the gate in a clean CI environment with
PostgreSQL PDO and Composer available.
