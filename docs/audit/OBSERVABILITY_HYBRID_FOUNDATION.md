# Observability Hybrid Foundation Audit

- Date: 2026-07-15 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- HEAD: `668e7fe923d6`
- Scope: observability and maintainability foundation only
- Deployment, push, merge, and VPS action: **none**
- Decision: **NOT_READY**

## Delivered

- Server-generated UUID request IDs with invalid-header replacement.
- Optional correlation IDs across API responses, structured logs, frontend
  error records, legacy DB telemetry, and queue payloads.
- Structured API access logs with slow-request warnings, release SHA, tenant,
  actor, domain, route, status, and duration metadata.
- Sanitized API error envelopes and fail-open access logging.
- Frontend API client request IDs, normalized errors, safe reporter, root error
  boundary, logout/401 handling, and safe retry controls.
- Monitor and Super Monitor filters for request ID, domain, route, status,
  error code, tenant, actor, and release.
- `/api/ready` dependency probe independent of tenant resolution.
- Explicit legacy consumer registry and CI/staging freeze guard via
  `npm run lint:legacy`.
- Architecture, debugging, incident response, and legacy register docs.

## Verification

| Check | Result |
|---|---|
| Focused observability/upload/auth/docs backend tests | 38 passed, 159 assertions |
| Readiness and route catalog tests | 3 passed, 25 assertions |
| Full backend suite | 405 passed, 23 failed, 10 skipped, 2163 assertions |
| Frontend Vitest | 26 passed |
| Frontend build/check | passed; large PDF/PWA chunks remain warnings |
| Focused ESLint | passed with no errors |
| Legacy consumer guard | passed; 26 registered files reviewed |
| V2 route count | 165 |
| `/api/db` and `/api/db/batch` | 2 routes remain intentionally |
| Browser smoke | blocked; no isolated runtime and role fixtures |
| Full Pint | failed on existing Phase 4/5 style debt outside this scope |
| Composer validate/audit | blocked; Composer is unavailable locally |
| Optimize clear | blocked; local PHP lacks PostgreSQL PDO driver |
| `git diff --check` | failed on existing dirty files outside this scope |
| Working tree | not clean; pre-existing Phase 4/5 changes remain |

## Gate

The observability foundation is ready to be reviewed in an isolated hybrid
staging environment, but the repository is not ready for deployment approval.
The DB compatibility routes remain because active legacy business consumers
still exist. Full backend green status, browser smoke evidence, dependency
checks, and a clean release/rollback workspace are still required before a
staging release is accepted.
