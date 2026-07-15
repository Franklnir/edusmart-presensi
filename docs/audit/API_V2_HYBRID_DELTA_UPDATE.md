# API V2 Hybrid Delta Audit

- Date: 2026-07-15 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Baseline: `fc0156b421203cc5dacdbe6f8940edf7da63b539`
- Current HEAD: `668e7fe923d607b36522ff0828b7a9b6f0fa7310`
- Scope: delta audit only for Grades, Reports, and Report Cards
- Source changes, deploy, push, merge, and VPS actions: **none**
- Decision: **READY_FOR_HYBRID_STAGING**

## Decision Boundary

The teacher report consumer is ready to be exercised in an isolated hybrid
staging environment using V2 contracts. This is not a production or full-V2
deployment approval. `/api/db` and `/api/db/batch` remain registered for other
business domains, and browser smoke testing remains required before enabling
the changed path for real staging tenants.

## 1. Snapshot Delta

| Item | Previous | Current | Delta / Result |
|---|---|---|---|
| Branch | `hardening/api-v2` | `hardening/api-v2` | unchanged |
| HEAD | `fc0156e` | `668e7fe` | six local commits ahead |
| V2 route count | approximately 141 | 165 | +24 routes |
| `/api/db` route | registered | registered | still required by other consumers |
| `/api/db/batch` route | registered | registered | still required by other consumers |
| Working tree | baseline dirty state | 29 tracked/staged changes and 31 untracked paths | not clean |
| Deployment | not performed | not performed | unchanged |

The three requested teacher-report commits are available in the current
history:

| Commit | Subject | Available |
|---|---|---|
| `dc60c09e` | `feat(api-v2): complete teacher grade and report contracts` | yes |
| `52bf62f5` | `refactor(frontend): migrate teacher reports to api v2` | yes |
| `cfe69ce9` | `test(api-v2): cover grade and report authorization` | yes |

The subsequent commits contain the Quiz migration and authorization tests and
are outside this focused delta.

## 2. Focused Consumer Verification

The exact focused search was run against the page and its three services:

```text
rg -n "supabase|/api/db|api/db|/api/reports|/api/quiz" \
  src/pages/guru/Laporan.jsx \
  src/services/gradeService* \
  src/services/reportCardService* \
  src/services/reportService*
```

Result: **no matches**. The page uses service modules and does not use direct
`fetch`, a legacy fallback, or the compatibility adapter for these operations.

| Changed Consumer | Old Path | New Path | Verified |
|---|---|---|---|
| Teacher report page | `supabase.from(...)` / `/api/db` | `gradeService`, `reportService`, `reportCardService` | static source: pass |
| Subject weights | `guru_mapel_bobot` through adapter | `GET/PUT /api/v2/grades/weights` | service and V2 tests: pass |
| Manual scores | `guru_mapel_manual_nilai` through adapter | `GET/PUT /api/v2/grades/manual-scores` | service and V2 tests: pass |
| Report-card list/read | `rapot_siswa` through adapter | `GET /api/v2/report-cards`, `GET /api/v2/report-cards/{student}` | service and tests: pass |
| Report-card item mutation | `rapot_siswa_items` through adapter | `PUT /api/v2/report-cards/{student}/items` | service and tests: pass |
| Report-card metadata/finalize | adapter-backed mutation | `/metadata`, `/finalize`, `/publish`, `/reopen` V2 routes | focused tests: pass |
| Attendance/task/quiz recap | legacy report reads | `/api/v2/reports/attendance-summary`, `task-summary`, `quiz-summary` | service and tests: pass |
| Teacher/homeroom report scope | legacy options/summary | `/api/v2/reports/homeroom-options`, `teacher-summary`, `homeroom-summary` | focused tests: pass |
| Dashboard aggregate used by report view | legacy aggregate path | `/api/v2/reports/dashboard-aggregate` | source uses service; runtime pending |
| Export dependencies | page-side legacy query dependency | V2-loaded report/grade/report-card data | static source: pass; browser pending |

The focused migration preserves tenant, academic-year, semester, teacher
subject, and homeroom scope through backend services/controllers. Server-owned
tenant and actor fields are not taken from the page payload.

## 3. Brief Global Legacy Search

The requested single global search returned 66 source/document/test files:

```text
rg -l "supabase|/api/db|api/db|api/db/batch" src --glob '!node_modules/**'
```

This search is deliberately not a full repository audit. It confirms that the
focused Laporan/Grades/Report-Cards path is clean while other legacy areas
remain in the hybrid architecture.

| Domain | Current observation | Classification |
|---|---|---|
| Laporan / Grades / Report Cards | No focused occurrence in page or services; V2 service calls are active | V2 consumer, runtime verification pending |
| Quiz | Migrated page/service paths are not present in the focused legacy result; global compatibility adapter and tests remain | V2 candidate; verify separately before removing DB proxy |
| Profile / Auth | Auth, profile, avatar, and account-security paths still include compatibility or storage integration references | active legacy/compatibility consumer |
| Dashboard / Navbar | Shared profile, dashboard, notification, and navigation consumers still include legacy integration references | active legacy/compatibility consumer |
| Attendance / Realtime | Attendance hooks, polling/realtime callbacks, and scan pages remain in the global result | active legacy/compatibility consumer |
| RFID / Devices | Admin/device API and student RFID actions remain in the global result | active legacy/compatibility consumer |
| Storage / Certificates | Certificate, profile, upload, and storage-manager paths remain in the global result | active legacy/compatibility consumer |
| Other | `src/lib/supabase.js`, compatibility tests, monitor filter placeholders, and documentation remain | adapter/test/documentation; adapter is active |

The global result means `/api/db` cannot be removed yet. It does not invalidate
the focused migration because `Laporan.jsx` and its three V2 services contain
zero active legacy occurrences.

## 4. Route Delta

Current `php artisan route:list --path=api/v2` reports **165 V2 routes**, up
from the baseline report's approximately 141. The relevant current contracts
are:

| Endpoint Group | Current Routes | Delta Result |
|---|---:|---|
| `/api/v2/grades/*` | 4 | weights and manual scores available |
| `/api/v2/report-cards/*` | 9 | list, read, items, metadata, lifecycle, preview, print available |
| `/api/v2/reports/*` | 7 | teacher, homeroom, attendance, task, quiz, dashboard summaries available |
| `/api/db` | 1 | still registered |
| `/api/db/batch` | 1 | still registered |

The DB route presence is expected for this delta and remains a blocker for
full V2 migration. No generic `/api/v2/db` endpoint was added.

## 5. Focused Quality Gates

| Quality Gate | Result |
|---|---|
| `php artisan test --filter=Grade` | 21 passed, 2 failed, 57 assertions; failures are legacy `DbSecurityTest` assignment-write expectations receiving `410 DB_LEGACY_WRITE_BLOCKED`, not Grade V2 failures |
| `php artisan test --filter=ReportCard` | 13 passed, 53 assertions |
| `php artisan test --filter=Report` | 21 passed, 119 assertions |
| `npm run test` | 5 files, 26 tests passed |
| `npm run build` | passed; large PDF/PWA bundle warnings remain |
| `npm run check` | passed; same bundle-size warnings remain |
| Focused Laporan/service legacy search | 0 matches |
| V2 route listing | passed; 165 routes observed |
| DB route absence | not passed; both DB proxy routes remain registered by design |
| Browser smoke for Admin/Guru/Wali Kelas/Siswa | not run; runtime fixtures/environment unavailable |
| Working tree clean | not passed; pre-existing tracked and untracked changes remain |
| Deploy/push/merge/VPS | not performed |

The two Grade-filter failures are not evidence that the migrated weight/manual
score endpoints fail. They show that unrelated old DB-proxy security tests
still expect the pre-blocking assignment behavior. They must be rewritten when
the Assignment domain is migrated, not deleted to obtain a green suite.

## 6. Hybrid Recommendation

### A. V2_ONLY

- `src/pages/guru/Laporan.jsx` for weights, manual scores, report-card reads,
  report-card item writes, summaries, and report scope options.
- `gradeService`, `reportService`, and `reportCardService` for the operations
  above.
- Backend Grade, Report Card, and Teacher Report contracts covered by the
  focused tests listed above.

### B. LEGACY_READ_ONLY_TEMPORARY

- Remaining read paths whose V2 replacement is not in this delta may continue
  through the compatibility layer only inside the isolated hybrid staging
  boundary.
- Such reads must remain tenant-scoped and must not be treated as permission
  proof merely because they are read-only.

### C. MUST_MIGRATE_BEFORE_PRODUCTION

- `/api/db` and `/api/db/batch`, including the active compatibility adapter.
- Remaining profile/auth, attendance/realtime, RFID/device, storage/certificate,
  dashboard, and other legacy business consumers identified by the global
  search.
- Legacy tests that protect behavior not yet covered by domain V2 tests.

### D. NEEDS_RUNTIME_VERIFICATION

- Browser Network for Laporan as Admin, Guru, and Wali Kelas.
- Student report visibility and cross-tenant isolation.
- Export, manual-score editing, weight editing, report-card item editing, and
  lifecycle actions in a real staging fixture.
- No `/api/db`, `/api/db/batch`, 404 API retry loop, 401 retry loop, or hidden
  V2-to-legacy fallback during those flows.

## Final Decision

**READY_FOR_HYBRID_STAGING**

This decision is limited to exercising the migrated teacher Grades/Reports/
Report-Cards consumer in isolated hybrid staging. It is not approval for
production, VPS deployment, full V2 staging, or removal of the DB proxy.
