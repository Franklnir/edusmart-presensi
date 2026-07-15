# Hybrid RC1 Production Deployment Report

- Date: 2026-07-15 (Asia/Jakarta)
- Branch: release/hybrid-rc1
- Release SHA verified at the current release checkpoint: f8b1295bc4fc801e60120138081aa2b162d2a695
- CI run: 29431541669
- Production deploy: none
- VPS mutation: none
- Cloudflare production deployment: none
- Decision: BLOCKED_BEFORE_DEPLOYMENT

## Executive Decision

Production deployment was not started. The release branch was pushed normally,
the exact-SHA CI quality gate passed, and the production workflow was made
fail-closed for a controlled manual dispatch.

The deployment is blocked because the GitHub production Environment currently
does not expose the required Cloudflare project/origin inputs and edge proxy
secret names. The values were not read or printed. No SSH connection, database
backup, migration, container restart, Cloudflare deployment, or production
configuration change was performed.

## Release Identity

| Item | Result | Evidence |
|---|---|---|
| Release branch | PASS | release/hybrid-rc1 |
| Local release SHA at current checkpoint | PASS | f8b1295bc4fc801e60120138081aa2b162d2a695 |
| Remote branch SHA | PASS | matched local SHA after normal push |
| Working tree before report | PASS | clean before report and workflow validation changes |
| Force push | NOT USED | normal push only |
| Merge/tag/VPS | NOT PERFORMED | no production history or remote mutation |

Before any future dispatch, run git rev-parse release/hybrid-rc1 again and use
that exact HEAD as RELEASE_SHA. This report is evidence for the observed
checkpoint, not permission to use an older SHA.

## Changes Applied

- Production image build now reads production environment inputs.
- Release branch production deployment is manual workflow_dispatch only.
- A normal push to release/hybrid-rc1 does not deploy production.
- CI and Cloudflare workflows require deploy_production=true for this branch.
- VITE_APP_RELEASE_SHA is passed into the frontend image build.
- Hybrid RC1 flags are explicit:
  - Grades API V2: true
  - Report Cards API V2: true
  - Assignments API V2: false
  - Assignment Uploads API V2: false
  - Schedules API V2: false
  - Classes API V2: false
  - Attendance API V2: false
  - Announcements API V2: false
- CI now rejects missing, non-HTTPS, staging, preview, or local VITE_API_URL.

No application feature, database schema, legacy route, or legacy consumer was
added or removed.

## Gate Matrix

| Gate | Result | Evidence | Blocker |
|---|---|---|---|
| Secret preflight | PASS | CI run 29431541669 | None |
| Frontend tests and quality gate | PASS | CI run 29431541669 | None |
| Frontend security audit | PASS | CI run 29431541669 | None |
| Legacy consumer freeze gate | PASS | CI run 29431541669 | None |
| Schedule V2 static gate | PASS | CI run 29431541669 | None |
| DB proxy legacy migration gate | PASS | CI run 29431541669 | None |
| Backend tests | PASS | CI run 29431541669 | None |
| Pint | PASS | CI run 29431541669 | None |
| Production frontend input validation | PASS | CI run 29431541669; no production dispatch was attempted | Production Environment still lacks VITE_API_URL |
| Immutable backend image | NOT_CREATED | Production build job skipped on normal release push | Deployment blocked |
| Immutable frontend image | NOT_CREATED | Production build job skipped on normal release push | Deployment blocked |
| Immutable Caddy image | NOT_CREATED | Production build job skipped on normal release push | Deployment blocked |
| PostgreSQL backup | NOT_PERFORMED | No production operation started | Deployment blocked |
| Rollback target | NOT_CAPTURED | No release window opened | Deployment blocked |
| Health/readiness | NOT_QUERIED | No production operation started | Deployment blocked |
| Browser smoke | NOT_RUN | No production frontend deployment | Deployment blocked |

## Production Environment Input Audit

Names required by the production workflows but not present in the GitHub
production Environment inventory:

- CLOUDFLARE_PAGES_EDGE_PROXY_SECRET
- CLOUDFLARE_PAGES_PROJECT_NAME
- CLOUDFLARE_PAGES_BACKEND_ORIGIN
- CLOUDFLARE_PAGES_PLATFORM_API_HOST
- VITE_API_URL

The production workflow also requires CLOUDFLARE_ACCOUNT_ID and
CLOUDFLARE_API_TOKEN. Repository-level names for those were visible, but the
production workflow is intentionally fail-closed and must be checked in the
authorized production environment before use.

VPS secret names were visible at repository level, but no value was printed and
no SSH connection was attempted. TENANT_EDGE_PROXY_SECRET equality with the
Cloudflare edge secret was not verified because the required production
secret input is not available for a safe comparison.

## CI Evidence

| CI Job | Run ID | Commit SHA | Result |
|---|---:|---|---|
| CI | 29431541669 | f8b1295bc4fc801e60120138081aa2b162d2a695 | PASS |
| Build Release Images | 29431541669 | f8b1295bc4fc801e60120138081aa2b162d2a695 | SKIPPED by branch guard |
| Deploy To VPS | 29431541669 | f8b1295bc4fc801e60120138081aa2b162d2a695 | SKIPPED by branch guard |
| Cloudflare Pages production | not run | not applicable | BLOCKED |

The CI run completed successfully with frontend, backend, security, legacy
consumer, migration, and formatting checks. GitHub Actions emitted a
non-blocking Node.js 20 deprecation annotation for an action runtime.

## Artifacts and Runtime

| Component | Previous Release | New Release | Status |
|---|---|---|---|
| Backend API | not captured | f8b1295 candidate | NOT_DEPLOYED |
| Queue worker | not captured | same backend image required | NOT_DEPLOYED |
| Scheduler | not captured | same backend image required | NOT_DEPLOYED |
| Frontend | not captured | Cloudflare Pages SHA build required | NOT_DEPLOYED |
| Caddy/WAF | not captured | SHA image required | NOT_DEPLOYED |

No image tag, digest, container, deployment ID, health response, migration
state, or production log was changed or recorded.

## Backup and Rollback

| Backup | Timestamp | Identity | Checksum | Restore Owner |
|---|---|---|---|---|
| PostgreSQL production backup | NOT_PERFORMED | NOT_RECORDED | NOT_RECORDED | NOT_ASSIGNED |

| Rollback Target | Backend | Frontend | Database | Verified |
|---|---|---|---|---|
| Previous production release | NOT_CAPTURED | NOT_CAPTURED | additive migration state not captured | NO |

No backup was deleted or modified.

## Cloudflare Deployment

| Cloudflare Deployment | Previous ID | New ID | Release SHA | Result |
|---|---|---|---|---|
| Pages production | NOT_CAPTURED | NOT_CREATED | not built | BLOCKED |

The Cloudflare workflow rejects missing production inputs, unsafe project names,
non-HTTPS origins, and a missing release SHA match before deployment.

## Final Decision

BLOCKED_BEFORE_DEPLOYMENT

Required operator action before any production dispatch:

1. Configure and verify the production Environment names and values for the
   Cloudflare project, backend origin, platform API host, VITE_API_URL, and
   edge proxy secret.
2. Verify TENANT_EDGE_PROXY_SECRET on VPS equals the Cloudflare edge secret
   without printing either value.
3. Record the current production release, image digests, migration state,
   previous Cloudflare deployment, backup owner, and restore owner.
4. Re-run the full CI workflow for the exact final release SHA.
5. Create and checksum the PostgreSQL backup.
6. Dispatch CI with deploy_production=true only after all gates pass.
7. Dispatch Cloudflare Pages production with deploy_production=true for the
   same exact SHA after backend health and API smoke pass.
8. Run production browser smoke and record request IDs.

Do not use production deployment until these blockers are resolved.
