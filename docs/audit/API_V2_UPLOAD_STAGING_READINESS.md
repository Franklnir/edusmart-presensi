# API V2 Upload Staging Readiness

- Snapshot: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Requested immutable base: `9adf23a0`
- Decision: `NOT_READY`

The repository baseline is green and an isolated, fail-closed staging delivery
path is now defined. A live deployment was intentionally not attempted because
the external staging control plane is not yet isolated: the GitHub Environment
`staging` has no dedicated values, the existing staging Pages variables point
to production hosts, and no independent staging VPS/DNS/database/Redis/bucket
has been supplied. Production was not mutated.

## Isolation inventory

| Isolation Layer | Production | Staging | Verified | Status |
|---|---|---|---|---|
| Frontend domain | `sismu.biz.id` | Required `STAGING_FRONTEND_HOST` | No live DNS/TLS evidence | BLOCKED |
| Backend domain | `origin.sismu.biz.id`/production API | Required `STAGING_BACKEND_HOST` | No live DNS/TLS evidence | BLOCKED |
| PostgreSQL | Existing production database | Project-owned `STAGING_DATABASE_NAME` | Definition only | NOT_RUN |
| Redis/cache/session | Existing production Redis | Project volume, credential, DBs, `edusmart:staging:` prefixes | Definition only | NOT_RUN |
| Queue | Production Redis/Horizon | `staging-default` worker | Definition only | NOT_RUN |
| Scheduler | Production scheduler | One project scheduler | Definition only | NOT_RUN |
| Object storage | Existing production provider/bucket | Project MinIO bucket and staging credentials | Definition only | NOT_RUN |
| App directory | Existing production release directory | `STAGING_APP_DIRECTORY` containing `staging` | No host supplied | BLOCKED |
| Docker project | `edusmart-prod` | `edusmart_staging_*` | Static preflight | PASS |
| Secrets | Repository/production values exist | Environment-only `STAGING_*`, no fallback | Environment empty | BLOCKED |

## Upload gate

| Upload Gate | Result | Evidence | Status |
|---|---|---|---|
| Default-off configuration | All three flags default false | Compose/workflow definitions | PASS |
| Provider credentials and bucket | Not provisioned | GitHub staging environment empty | NOT_RUN |
| Browser CORS | Staging-only policy defined | Live browser preflight unavailable | NOT_RUN |
| Signed PUT/POST | Not executed | No isolated provider | NOT_RUN |
| HEAD verification | Not executed | No isolated provider | NOT_RUN |
| Complete and claim | Not executed | No deployed release | NOT_RUN |
| Authorized download | Not executed | No deployed release | NOT_RUN |
| Delete and cleanup | Not executed | No deployed release/scheduler | NOT_RUN |
| Assignment/submission browser flow | Not executed | No frontend/backend staging | NOT_RUN |
| `/api/storage/*` count when flag-on | Not observed | No flag-on browser test | NOT_RUN |
| Multi-node Redis lock | Two replicas defined, not started | No staging host/Redis | NOT_RUN |
| Rollback | SHA rollback path defined, not executed | No two deployed releases | NOT_RUN |

## Security scenarios

| Security Scenario | Expected | Actual | Status |
|---|---|---|---|
| Production host/resource rejection | Runtime/workflow stops | Covered by static and Laravel guards | PASS (CODE) |
| Guest initiate | Denied | Not live-tested | NOT_RUN |
| Cross-tenant read/complete/claim | Denied | Not live-tested | NOT_RUN |
| Same-tenant teacher/student IDOR | Denied | Not live-tested | NOT_RUN |
| Wrong purpose/assignment/session state | Structured 4xx | Not live-tested | NOT_RUN |
| Repeated/concurrent mutation | One effect or safe replay/conflict | Not live-tested | NOT_RUN |
| Storage/provider override and key guessing | Denied with no metadata leak | Not live-tested | NOT_RUN |
| External mail/WhatsApp/OAuth/MQTT | Disabled | Enforced in compose and boot guard; not deployed | PASS (CODE) |

## Quality evidence

| Quality Gate | Result | Evidence |
|---|---|---|
| Backend tests | 350 passed, 0 failed, 1876 assertions | Local full suite after staging changes |
| Skipped backend tests | 10 skipped | Local host lacks `ext-zip`; CI/runtime image installs it |
| Frontend tests | 14 passed, 0 failed | Local verification after staging changes |
| Frontend/PWA build | PASS, 124 precache entries | Local verification after staging changes |
| Pint | PASS | Full backend check after staging changes |
| Composer validate/audit | Valid; no advisories | Verified with checksum-validated Composer PHAR |
| npm audit | 0 vulnerabilities | Local baseline |
| Release health metadata | Focused tests pass | `HealthReleaseTest` |
| Staging isolation guard | Focused tests pass | `StagingIsolationGuardTest` |
| Request ID end-to-end trace | Not live-tested | No staging deployment | NOT_RUN |
| p50/p95 provider latency | No samples | No live provider | NOT_RUN |

## Remaining risks

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| Staging DNS/Pages target may still be production | CRITICAL | Replace with isolated hosts and validate DNS/TLS before dispatch | OPEN |
| Environment-specific secrets are absent | CRITICAL | Populate and protect GitHub Environment `staging` | OPEN |
| Database, Redis, and bucket isolation is unproven | CRITICAL | Provision stack and run `staging:verify-runtime` | OPEN |
| Provider CORS/IAM behavior is unproven | HIGH | Run browser/provider matrix in runbook | OPEN |
| Rollback compatibility is unproven | HIGH | Deploy two immutable SHAs and execute rollback | OPEN |
| Local XLSX tests remain skipped | MEDIUM | Require CI quality job with `ext-zip` and zero skips for XLSX | OPEN |

## Decision

`NOT_READY`. Code-level staging isolation is prepared, but none of the critical
live provider, browser, concurrency, cleanup, traceability, or rollback gates
can be marked passed without dedicated external staging resources.
