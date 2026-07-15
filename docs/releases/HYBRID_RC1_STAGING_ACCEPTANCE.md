# Hybrid RC1 Staging Acceptance

- Date: 2026-07-15 (Asia/Jakarta)
- Release branch: `release/hybrid-rc1`
- Base commit: `668e7fe923d607b36522ff0828b7a9b6f0fa7310`
- Release SHA: verify with `git rev-parse release/hybrid-rc1` immediately
  before artifact creation; the verified checkpoint before the release wiring
  changes was `15ab0e7604059654b7d78d9bbdea5d2bf29217ed`
- Migration set:
  `2026_07_15_000100_add_observability_context_to_frontend_error_logs.php`,
  `2026_07_15_000110_add_read_write_to_db_proxy_usage_telemetry.php`
- Production deploy, production push, merge, tag, and VPS mutation: **none**
- Decision: **NOT_READY**

## Decision Summary

The release identity is locked locally and the release branch is clean. The
selected checkpoint has a green backend test result and targeted formatting
result, but it cannot be accepted for isolated staging or a production canary
because the complete CI environment, immutable images, staging dependencies,
backup evidence, rollback target, and browser smoke evidence are unavailable.

A read-only SSH verification was attempted using the locally available
hardening key. The target reported `hostname=sismu`, `user=root`,
`pwd=/root`, and no `/opt/edusmart-staging` marker. The host identity is
therefore not proven to be isolated staging. No further remote inspection and
no remote change was performed; the target is recorded as
`TARGET_IDENTITY_UNSAFE`.

The authorized topology inspection then confirmed the target is production:
the active Compose project is `edusmart-prod`, the application root is
`/opt/edusmart-presensi`, and the active resources use the `edusmart-*`
production naming boundary. The staging procedure was stopped immediately.

The legacy `/api/db` and `/api/db/batch` routes remain registered by design for
the explicit compatibility register. They were not removed or bypassed by
this release procedure.

## Gate Matrix

| Gate | Result | Evidence | Blocker |
|---|---|---|---|
| Release branch identity | PASS | `git rev-parse release/hybrid-rc1` matched `HEAD`; branch clean | None locally |
| Secret and release-file audit | PASS | No tracked `.env`, private key, dump, generated `dist`, or temporary release script; only log `.gitignore` matched the broad scan | None found |
| Backend tests | PASS WITH SKIPS | `432 passed, 0 failed, 10 skipped, 2301 assertions` on the selected checkpoint | Full CI rerun requires Composer and PostgreSQL PDO |
| Focused Grade/Report/Report Card tests | PASS | Grade `13 passed/65 assertions`; Report `21 passed/119`; Report Card `13 passed/53` | Runtime smoke still required |
| Composer validate | BLOCKED | `composer` is not installed in this environment | Run in CI/container |
| Composer audit | BLOCKED | `composer` is not installed in this environment | Run in CI/container |
| Database-dependent artisan gate | BLOCKED | PHP has PDO but no `pdo_pgsql`; local PostgreSQL service is unavailable | Run with PostgreSQL and `pdo_pgsql` |
| Full Pint | FAIL | Existing baseline/unrelated files remain unformatted | Must be triaged in CI; not caused by this release report |
| Changed-file Pint | PASS | Release PHP changes were formatted and targeted `pint --test` passed | None for changed release PHP files |
| Frontend test/build/check | BLOCKED | `node`, `npm`, and `npx` are unavailable in this shell | Run Node 20.19 CI gate |
| Legacy consumer guard | PASS | Existing release checkpoint guard reviewed the registered compatibility boundary | Runtime consumer evidence still required |
| Staging flag audit | PASS STATIC / NOT EXECUTED | Workflow, Dockerfile, production example, and flag guard contain all eight explicit flags | `npm run audit:staging-flags` needs Node |
| Cloudflare Pages release wiring | PASS STATIC | Pages workflow now forwards all eight flags and `VITE_APP_RELEASE_SHA`; YAML parser passed | Runtime workflow has not run for this SHA |
| GitHub staging environment | BLOCKED | Environment exists but has no staging secret or variable names | Operator must provision staging-scoped inputs |
| CI for official release SHA | NOT_RUN | Release branch is not present on origin and no workflow was triggered | Push/trigger requires explicit operator authorization |
| Immutable images | BLOCKED | Docker/Podman unavailable; registry build and digests do not exist | Build in CI and record digests |
| Isolated staging configuration | TARGET_IDENTITY_UNSAFE | SSH target is production: Compose project `edusmart-prod`, app root `/opt/edusmart-presensi`, production network and containers | Operator must provide a separate staging VPS/target |
| Staging fixtures | BLOCKED | Required roles and second tenant are unavailable | Seed deterministic staging fixtures |
| Database backup/checksum | BLOCKED | No staging database or approved backup location available | Backup before any staging migration |
| Browser smoke | BLOCKED | No staging runtime, browser session, or role fixtures available | Execute the smoke checklist |
| Rollback drill | BLOCKED | No previous artifact or staging target recorded | Record previous SHA and perform staging drill |
| Production canary | NOT_ALLOWED | Preconditions above are incomplete | No production deployment |

## Feature Flag Matrix

The staging workflow supplies all required names to both the frontend image
build and runtime release evidence. The effective defaults in the workflow and
the static flag guard are:

| Flag | Value | Domain | Effective Path |
|---|---|---|---|
| `VITE_USE_GRADES_API_V2` | `true` | Grades/reports | Migrated grade and teacher report services use `/api/v2/*` |
| `VITE_USE_REPORT_CARDS_API_V2` | `true` | Report cards | Migrated report-card service uses `/api/v2/*` |
| `VITE_USE_SCHEDULES_API_V2` | `false` | Schedules | Compatibility path remains for non-cutover consumers |
| `VITE_USE_ASSIGNMENTS_API_V2` | `false` | Assignments | Compatibility path remains |
| `VITE_USE_ASSIGNMENT_UPLOADS_API_V2` | `false` | Assignment uploads | Compatibility path remains |
| `VITE_USE_CLASSES_API_V2` | `false` | Classes | Compatibility path remains |
| `VITE_USE_ATTENDANCE_API_V2` | `false` | Attendance | Compatibility path remains |
| `VITE_USE_ANNOUNCEMENTS_API_V2` | `false` | Announcements | Compatibility path remains |

No V2-to-legacy fallback is introduced by this checkpoint. The flag audit is
static evidence only until the Node CI job executes and staging Network traces
confirm the effective bundle behavior.

## Artifact Evidence

The workflow uses SHA tags derived from the selected commit. The repository
name below is the lower-case GitHub repository value used by the workflow.

| Artifact | Tag | Digest | Release SHA |
|---|---|---|---|
| Backend | `ghcr.io/franklnir/edusmart-presensi/backend:<RELEASE_SHA>` | NOT_CREATED | same SHA required |
| Frontend/nginx | `ghcr.io/franklnir/edusmart-presensi/nginx:<RELEASE_SHA>` | NOT_CREATED | same SHA required |
| Caddy | `ghcr.io/franklnir/edusmart-presensi/caddy:<RELEASE_SHA>` | NOT_CREATED | same SHA required |

`latest`, a branch name, and an environment-only mutable tag are not used as
rollback identities. Worker and scheduler containers must use the same backend
image and `APP_RELEASE_SHA` after CI creates the artifacts.

## Release Components

| Component | Deployment Target | Release SHA | Result |
|---|---|---|---|
| Backend API | Separate staging VPS | current branch HEAD | NOT_DEPLOYED |
| Queue worker | Separate staging VPS | current branch HEAD | NOT_DEPLOYED |
| Scheduler | Separate staging VPS | current branch HEAD | NOT_DEPLOYED |
| Frontend | Cloudflare Pages staging project | current branch HEAD | NOT_DEPLOYED |
| Reverse proxy/Caddy | Separate staging VPS | current branch HEAD | NOT_DEPLOYED |

The current branch SHA is intentionally expressed as branch HEAD in this
document because committing this report changes the commit hash. The concrete
SHA must be captured immediately before CI/artifact creation.

## CI Evidence

| CI Job | Result | Run ID | Evidence |
|---|---|---:|---|
| CI for `release/hybrid-rc1` | NOT_RUN | N/A | Branch is not on origin; no push or trigger authorization |
| Isolated Staging | NOT_RUN | N/A | Staging environment has no required inputs |
| Staging Cloudflare for release SHA | NOT_RUN | N/A | Current Pages workflow has only unrelated `staging-cloudflare` runs |
| Prior backend/frontend runs | NOT_RELEASE_EVIDENCE | `29355004389`, `29255450750` | Runs belong to other branches/SHAs |

## Frontend Deployment Evidence

| Cloudflare Deployment | URL | Deployment ID | Release SHA |
|---|---|---:|---|
| Hybrid RC1 Pages Preview | NOT_CREATED | N/A | NOT_BUILT |
| Prior `staging-cloudflare` deployment | not used for RC1 | `29255450750` | `15573fe1998137ea43a8494494f61573f34d7f42` |

The prior successful Pages run is not evidence for this release SHA. The
Cloudflare workflow now has explicit staging values for all eight V2 flags,
passes `VITE_APP_RELEASE_SHA`, validates the release identity, and runs the
staging flag guard before build.

## Environment Inputs

| Environment Variable | Location | Configured | Secret |
|---|---|---|---|
| `STAGING_VPS_HOST`, `STAGING_VPS_PORT`, `STAGING_VPS_USER`, `STAGING_VPS_SSH_KEY` | GitHub `staging` environment | MISSING | redacted |
| `STAGING_API_BASE_URL`, `STAGING_FRONTEND_HOST`, `STAGING_BACKEND_HOST` | GitHub `staging` variables | MISSING | public config |
| `STAGING_DATABASE_NAME`, `STAGING_DATABASE_USER`, `STAGING_DATABASE_PASSWORD` | GitHub `staging` environment | MISSING | redacted |
| `STAGING_REDIS_PASSWORD`, `STAGING_APP_KEY` | GitHub `staging` environment | MISSING | redacted |
| `STAGING_STORAGE_ACCESS_KEY`, `STAGING_STORAGE_SECRET_KEY`, `STAGING_STORAGE_BUCKET` | GitHub `staging` environment | MISSING | redacted |
| `STAGING_CLOUDFLARE_ACCOUNT_ID`, `STAGING_CLOUDFLARE_API_TOKEN` | GitHub `staging` environment | MISSING | redacted |
| `STAGING_FRONTEND_PROJECT`, `STAGING_BACKEND_ORIGIN`, `STAGING_TENANT_ROOT_DOMAIN` | GitHub `staging` variables | MISSING | public config |
| `GHCR_USERNAME`, `GHCR_TOKEN` | Repository-level names exist | CONFIGURED, not used as staging fallback | redacted |
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY` | Repository-level names exist | CONFIGURED, not accepted by staging workflow | redacted |

No secret value was printed, copied to the repository, or used for a staging
deployment. Repository-level production/deployment names are not treated as
staging credentials.

## Production Guard

| Production Guard | Result | Evidence |
|---|---|---|
| Staging API cannot target production | PASS STATIC | Workflow rejects `sismu.biz.id` and `origin.sismu.biz.id` |
| Staging hosts cannot equal production hosts | PASS STATIC | `deploy/staging/preflight.sh` rejects production hostnames and cookie domain |
| Staging app directory is isolated | PASS STATIC | Workflow requires an app directory containing `staging`; no deployment executed |
| Production VPS was not reused | PASS | Read-only audit identified `edusmart-prod`; no command changed it |
| Cloudflare staging fallback to production | PASS STATIC | Pages workflow rejects production backend/API origins |

## Runtime and Staging Evidence

| Runtime Component | Release SHA | Health | Status |
|---|---|---|---|
| Backend API | NOT_DEPLOYED | `/api/health` not queried | BLOCKED |
| Readiness dependencies | NOT_DEPLOYED | `/api/ready` not queried | BLOCKED |
| PostgreSQL | NO STAGING INSTANCE | identity not recorded | BLOCKED |
| Redis/queue | NO STAGING INSTANCE | worker readiness not recorded | BLOCKED |
| Storage | NO STAGING INSTANCE | bucket identity not recorded | BLOCKED |
| Frontend/reverse proxy | NO STAGING ARTIFACT | browser URL not configured | BLOCKED |
| Scheduler/worker | NO STAGING ARTIFACT | processing not verified | BLOCKED |

The staging workflow is fail-closed for missing hosts, credentials, storage,
database, Redis, fixtures, and release images. `.env.staging.example` is a
template and was not used as a deployment credential source.

The authorized SSH attempt performed only safe topology inspection. No `.env`,
database connection, storage object, migration, or service configuration was
read or changed. Because the target is production, it was not used for any
staging operation.

## Smoke Evidence

| Smoke Role | Passed | Failed | Blocked |
|---|---:|---:|---:|
| Super Admin | 0 | 0 | all flows |
| Admin Sekolah | 0 | 0 | all flows |
| Guru | 0 | 0 | all flows |
| Wali Kelas | 0 | 0 | all flows |
| Siswa | 0 | 0 | all flows |

No browser evidence was collected. Therefore these are BLOCKED, not PASS:

- `/api/db` and `/api/db/batch` count during `Laporan` flows;
- V2 grades, reports, and report-card requests;
- 404/500/502 and repeated 401-loop checks;
- request ID and safe error-envelope checks;
- tenant and academic-year isolation;
- cross-tenant denial;
- absence of hidden V2-to-legacy fallback.

## Network Evidence

| Flow | Endpoint | Legacy Count | Request ID | Result |
|---|---|---:|---|---|
| Laporan weights/manual scores | `/api/v2/grades/*` | NOT_CAPTURED | NOT_CAPTURED | BLOCKED |
| Laporan summaries/export | `/api/v2/reports/*` | NOT_CAPTURED | NOT_CAPTURED | BLOCKED |
| Report cards | `/api/v2/report-cards/*` | NOT_CAPTURED | NOT_CAPTURED | BLOCKED |
| Compatibility domains | registered legacy routes only | NOT_CAPTURED | NOT_CAPTURED | BLOCKED |

Static source evidence from the prior focused migration confirms that
`Laporan.jsx` and its grade/report/report-card services contain no active
`supabase`, `/api/db`, or `/api/reports` occurrence. Browser verification is
still mandatory because a successful build alone cannot prove runtime traffic.

## Backup and Rollback

| Backup | Timestamp | Database Identity | Checksum | Restore Owner |
|---|---|---|---|---|
| Staging logical backup | NOT_PERFORMED | NOT_RECORDED | NOT_RECORDED | NOT_ASSIGNED |

| Rollback | Previous SHA | Duration | Health | Result |
|---|---|---:|---|---|
| Staging rollback drill | NOT_RECORDED | N/A | NOT_CHECKED | BLOCKED |

This is not a first-release rollback approval: no previous staging image or
`PREVIOUS_RELEASE_SHA` was provided. If staging is genuinely first-use, the
operator must record `FIRST_STAGING_RELEASE` and the documented clean-staging
redeploy target before rollout.

## Remaining Risks

- Complete Composer, PostgreSQL/PDO, Redis, queue, storage, Node, and Docker
  gates have not run in this environment.
- Full Pint still reports baseline/unrelated style debt; targeted release PHP
  files are clean.
- `/api/db` and `/api/db/batch` remain active compatibility routes for other
  domains and must stay aligned with `config/api-legacy-consumers.json`.
- No immutable image digest, staging backup checksum, previous release SHA,
  readiness response, or browser Network trace is available.
- GitHub `staging` has no environment secrets or variables, so CI and Pages
  deployment are fail-closed until the operator provisions them.
- The release branch is not present on `origin`; no CI run can validate this
  exact SHA until an authorized push or equivalent CI checkout is provided.
- The only reachable SSH target is confirmed production and is recorded as
  `TARGET_IDENTITY_UNSAFE`; no remote configuration was changed.
- No production deployment or VPS mutation was performed.

## Final Decision

```text
NOT_READY
```

The next authorized step is CI execution in the project workflow environment,
followed by an isolated staging deployment only after immutable images,
staging dependencies, backup evidence, and rollback identity are available.
Production canary remains prohibited by this report.
