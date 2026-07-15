# Hybrid RC1 Release Report

- Date: 2026-07-15 (Asia/Jakarta)
- Branch observed: `release/hybrid-rc1`
- Base commit: `668e7fe923d607b36522ff0828b7a9b6f0fa7310`
- Release SHA: authoritative value is `git rev-parse release/hybrid-rc1` at release time
- Release type: controlled hybrid staging candidate
- Production deploy: none
- Push/merge/tag: none
- VPS change: none
- Decision: **NOT_READY**

## Decision

The selected local branch is a clean Hybrid RC1 checkpoint candidate and its
source test suite is green. It is still **NOT_READY** for isolated staging
because the browser smoke environment, immutable artifact metadata, backup and
rollback evidence, Composer audit, and production-like readiness checks were
not available in this task.

The `/api/db` and `/api/db/batch` routes remain registered by design. They are
still required by the explicit compatibility register and must not be removed
in this release candidate.

## Release Snapshot

| Checkpoint | Result |
|---|---|
| Current branch | `release/hybrid-rc1` |
| Base commit | `668e7fe923d607b36522ff0828b7a9b6f0fa7310` |
| Safety stash | `stash@{0}` remains present |
| Release checkpoint | branch HEAD; verify with `git rev-parse release/hybrid-rc1` |
| Full backend suite | 432 passed, 0 failed, 10 skipped, 2301 assertions |
| Grades filter | 13 passed, 65 assertions |
| Reports filter | 21 passed, 119 assertions |
| Report Cards filter | 13 passed, 53 assertions |
| Frontend tests/build/check | BLOCKED; Node/npm unavailable in this environment |
| Legacy consumer guard | NOT RERUN; Node/npm unavailable (previous checkpoint evidence: PASS) |
| Staging flag audit | PASS, 8 explicit V2 flags verified |
| API DB legacy audit | NOT RERUN; Node/npm unavailable (previous checkpoint evidence: PASS) |
| Schedule V2 static audit | NOT RERUN; Node/npm unavailable (previous checkpoint evidence: PASS) |
| npm production dependency audit | NOT RERUN; Node/npm unavailable (previous checkpoint evidence: 0 vulnerabilities) |
| Changed-file ESLint | NOT RERUN; Node/npm unavailable (previous checkpoint evidence: 0 errors) |
| `/api/db` routes | 2 registered (`db`, `db/batch`) |
| V2 routes in selected checkpoint | 138 observed |
| Composer validate/audit | BLOCKED; Composer command unavailable |
| `optimize:clear` | BLOCKED; local PHP lacks `pdo_pgsql` |
| Full Pint | FAIL; remaining failures are baseline/unrelated files |
| Targeted Pint for release PHP diff | PASS after formatting `routes/api_v2.php` and `SubjectControllerTest.php` |
| Docker/image build | BLOCKED; Docker command unavailable |
| Browser smoke | BLOCKED; runtime and role fixtures unavailable |
| Worktree | CLEAN on `release/hybrid-rc1`; source worktree remains intentionally dirty |

`rg` is not installed in this local shell, so equivalent `grep` scans were
used for the static evidence. CI should run the repository's native Node guard
and the same scans in its complete environment.

## Change Classification

The following classification covers the tracked and untracked paths observed
in this checkpoint. No `UNKNOWN` path was deleted or overwritten.

| Classification | Path groups | Release handling |
|---|---|---|
| `RELEASE_REQUIRED` | `.env.production.example`, `backend/.env.example`, `.github/workflows/ci.yml`, `.github/workflows/staging.yml`, `package.json`, `config/api-legacy-consumers.json`, `scripts/check-legacy-consumers.mjs`, `docs/releases/*` | Keep in the eventual release checkpoint; validate in CI. |
| `OBSERVABILITY_SCOPE` | `backend/app/Support/Observability/*`, `backend/app/Services/Observability/*`, `backend/app/Http/Middleware/RequestTelemetry.php`, `backend/app/Http/Controllers/Api/HealthController.php`, frontend API error/request-ID modules, frontend observability components, monitor services/pages, frontend log model/controller/resource, DB proxy telemetry, queue observability, observability config/migrations/tests, `docs/architecture/*`, `docs/operations/*`, observability audit docs | Candidate release scope, but only after isolated commit selection and full gates. |
| `V2_MIGRATION_COMPLETED` | Existing V2 grade/report/report-card/quiz/schedule/class/attendance/organization and academic-period controllers/services/routes, their V2 requests/tests, and the matching frontend domain services/pages/docs | Existing migration work remains separate from the observability checkpoint. Do not fold dirty migration overlays into an RC without review. |
| `LEGACY_COMPATIBILITY_REQUIRED` | `backend/routes/api.php`, `backend/app/Http/Controllers/Api/DbController.php`, `backend/app/Http/Middleware/EnsureDbGatewayEnabled.php`, `src/lib/supabase.js`, compatibility client tests, and the entries in `config/api-legacy-consumers.json` | Retain. No new consumer and no automatic V2-to-legacy fallback. |
| `GENERATED` | `dist/*`, generated PWA service worker and build output | Exclude from source commits and regenerate from the selected release SHA. |
| `TEMPORARY` | `fix_controller.php`, `replace_*.cjs`, `tmp_*.cjs`, `tmp_rekap_wali.js` | Exclude from release. Preserve until the owning work is confirmed complete, then remove in a separate cleanup change. |
| `UNRELATED` | Pre-existing formatting debt and changes outside the selected RC scope, including known whitespace in `SubjectControllerTest.php`, `Kelas.jsx`, `AbsensiGuru.jsx`, and `RapotSiswa.jsx` | Do not rewrite as part of this release audit. |
| `UNKNOWN` | None after the shallow path/content review in this checkpoint | If a later diff introduces an unrecognized path, stop release selection and classify it before editing. |

The source worktree still contains broad existing V2 and academic-period
changes in addition to observability. Those paths were intentionally excluded
from this checkpoint and remain untouched in the source worktree.

## Backend Test Triage

| Test group | Result | Classification | Required action | Release impact |
|---|---:|---|---|---|
| Legacy boundary and academic-period tests | 0 failed | `HYBRID_CONTRACT` | Legacy route presence, registered reads, blocked writes, tenant scope, request ID, telemetry, and V2 replacements are asserted directly. | Passed in the selected checkpoint. |
| Subject/context compatibility tests | 0 failed | `TEST_FIXTURE_ALIGNMENT` | Route context uses `/organization-context`; subject fixtures resolve the seeded default tenant. | Passed in the selected checkpoint. |
| Skipped tests | 10 skipped | `PRE_EXISTING_UNRELATED` or environment-specific, individually unverified | Keep visible in CI output and assign owners before a production decision. | No green-suite claim. |

Legacy writes for migrated domains return the structured `410
DB_LEGACY_WRITE_BLOCKED` response. The hybrid tests verify that this boundary
does not silently fall back and that registered compatibility reads remain
tenant-scoped.

## Release Configuration Matrix

| Domain | Active path | Feature flag | Fallback | Status |
|---|---|---|---|---|
| Grades, teacher reports, report cards | Domain services -> `/api/v2/grades/*`, `/api/v2/reports/*`, `/api/v2/report-cards/*` | `Laporan.jsx` uses V2 services; `VITE_USE_GRADES_API_V2` exists for other consumers | None | V2-only for the migrated report path; browser pending |
| Quiz authoring and attempts | Quiz V2 services/routes | Existing quiz V2 rollout state | None on migrated paths | V2 candidate; browser pending |
| Schedules | Schedule V2 service/routes | `VITE_USE_SCHEDULES_API_V2` | Registered legacy consumers remain compatibility-scoped | Hybrid; staging flag must be explicit |
| Assignments and uploads | Assignment/submission/upload V2 paths where enabled | `VITE_USE_ASSIGNMENTS_API_V2`, `VITE_USE_ASSIGNMENT_UPLOADS_API_V2` | Explicit compatibility consumers only | Hybrid; staging flag must be explicit |
| Classes, attendance, announcements | V2 paths where the page flag is enabled | `VITE_USE_CLASSES_API_V2`, `VITE_USE_ATTENDANCE_API_V2`, `VITE_USE_ANNOUNCEMENTS_API_V2` | Compatibility register | Hybrid; staging values must be recorded |
| Students, RFID/devices, profile/auth, certificates, dashboards | Compatibility services and legacy domain routes | No completed V2 cutover | Compatibility only | Required for current application; migration pending |
| `/api/db` and `/api/db/batch` | Explicit legacy boundary | Gateway enable/disable controls | No V2 fallback behavior | Must remain in this hybrid release |

The staging workflow now forwards all eight flag names explicitly. The
effective values are recorded by `audit:staging-flags` and in staging release
evidence; an omitted variable is no longer the source of an accidental path.

## Environment Audit

The examples contain names for the following required configuration groups,
with values intentionally omitted from this report:

- application: `APP_ENV`, `APP_KEY`, `APP_URL`, `APP_RELEASE_SHA`;
- database: `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`,
  `DB_USERNAME`, `DB_PASSWORD`;
- Redis and queues: `REDIS_*`, `QUEUE_CONNECTION`, worker settings;
- storage: `FILESYSTEM_DISK` and provider credentials;
- frontend: `VITE_API_URL`, tenant/domain values, Google auth settings, and
  V2 flags;
- compatibility: DB gateway rate/limit and gateway enable controls;
- observability: `OBSERVABILITY_LOG_CHANNEL`, `OBSERVABILITY_LOG_PATH`, and
  `API_SLOW_REQUEST_THRESHOLD_MS`.

Local `composer` and PostgreSQL PDO are unavailable. `composer validate`,
`composer audit`, and the database-dependent portion of `optimize:clear` must
run in CI/container/staging with Composer and `pdo_pgsql`; this is an
environment gate, not a source-level pass.

## Immutable Artifact and Staging Evidence

| Item | Evidence |
|---|---|
| Official release SHA | branch HEAD; verify with `git rev-parse release/hybrid-rc1` immediately before release use |
| Backend image | NOT_CREATED; Docker and registry access unavailable |
| Frontend/nginx image | NOT_CREATED; Docker and registry access unavailable |
| Caddy image | NOT_CREATED; Docker and registry access unavailable |
| Previous release SHA | NOT_RECORDED |
| Migration set | `2026_07_15_000100_add_observability_context_to_frontend_error_logs.php`, `2026_07_15_000110_add_read_write_to_db_proxy_usage_telemetry.php` |
| Staging frontend/API/storage URLs | NOT_CONFIGURED in this environment |
| Staging PostgreSQL/Redis/storage/queue | NOT_AVAILABLE in this environment |
| Role and second-tenant fixtures | NOT_AVAILABLE in this environment |
| Database backup/checksum/restore owner | NOT_PERFORMED / NOT_RECORDED |

The image names required by the workflow are SHA-tagged only after CI builds
and pushes them to the configured registry. No mutable tag is being used as a
rollback identity.

## Staging Package Requirements

Before an isolated staging deployment is authorized, CI must produce:

1. An immutable release SHA and matching backend/frontend/Caddy artifacts.
2. `APP_RELEASE_SHA` and frontend build metadata matching that SHA.
3. Additive migrations applied and verified before traffic is enabled.
4. Queue worker and scheduler configuration for the same artifact SHA.
5. A passing `/api/ready` response for database, Redis, queue, and storage.
6. The previous staging artifact/image recorded for rollback.
7. A staging API URL that cannot resolve to the production API or production
   tenant.

No staging deployment was performed in this task.

## Required Next Gate

- run backend quality gates in CI with Composer and PostgreSQL PDO;
- pass browser smoke for all required roles;
- verify `/api/db` request count is zero for Laporan/Grades/Report Cards and
  compatibility requests are present only for registered domains;
- record immutable artifact SHA and rollback target.

Until these are complete, the release decision remains:

```text
NOT_READY
```
