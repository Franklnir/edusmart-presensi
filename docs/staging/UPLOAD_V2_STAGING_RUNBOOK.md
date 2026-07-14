# Upload V2 Isolated Staging Runbook

## Safety boundary

The staging stack is defined by `docker-compose.staging.yml` and must never be
started with production environment values. `deploy/staging/preflight.sh` and
the Laravel `StagingIsolationGuard` independently reject unsafe targets.

The only supported deployment branch is `staging`, or a manual dispatch of
`.github/workflows/staging.yml` with a full commit SHA descended from
`9adf23a0`. Application images use only that SHA as their tag. The staging
workflow does not read repository-level `VPS_*` or production credentials.

## Required GitHub environment

Create the GitHub Environment `staging`, restrict it to the `staging` branch,
and require an approver when the repository plan supports protection rules.
Configure these values in that environment only; never put their values in the
repository or deployment logs.

Secrets:

- `STAGING_VPS_HOST`, `STAGING_VPS_USER`, `STAGING_VPS_SSH_KEY`, and
  `STAGING_VPS_KNOWN_HOSTS`
- `STAGING_APP_DIRECTORY` (must contain `staging`)
- `STAGING_APP_KEY`
- `STAGING_DATABASE_USER` and `STAGING_DATABASE_PASSWORD`
- `STAGING_REDIS_PASSWORD`
- `STAGING_STORAGE_ACCESS_KEY` and `STAGING_STORAGE_SECRET_KEY`
- `STAGING_EDGE_PROXY_SECRET`
- `STAGING_TEST_PASSWORD`
- `STAGING_CLOUDFLARE_ACCOUNT_ID` and `STAGING_CLOUDFLARE_API_TOKEN`

Variables:

- `STAGING_FRONTEND_HOST`, `STAGING_BACKEND_HOST`, and `STAGING_STORAGE_HOST`
- `STAGING_API_BASE_URL` (the HTTPS backend origin, without `/api` because
  frontend consumers already pass `/api/...` paths)
- `STAGING_BACKEND_ORIGIN`
- `STAGING_TENANT_ROOT_DOMAIN`, `STAGING_DEFAULT_TENANT_SLUG`
- `STAGING_DATABASE_NAME` and `STAGING_STORAGE_BUCKET`; both names must include
  `staging`
- `STAGING_ACME_EMAIL`, `STAGING_FRONTEND_PROJECT`, and optional
  `STAGING_VPS_PORT`
- `STAGING_USE_UPLOADS_API_V2`, `STAGING_USE_ASSIGNMENTS_API_V2`, and
  `STAGING_USE_ASSIGNMENT_UPLOADS_API_V2`

Cloudflare staging uses the same environment. Its workflow has no production
URL defaults and stops if any required staging target is missing.

## Infrastructure contract

- Compose project: `edusmart_staging_*`.
- PostgreSQL: project-owned volume and staging-only database/user.
- Redis: project-owned volume, staging credential, DB separation, and all
  prefixes beginning with `edusmart:staging:`.
- Queue: Redis queue `staging-default`, one dedicated worker.
- Scheduler: one `schedule:work` container; Laravel `onOneServer` and
  `withoutOverlapping` use staging Redis.
- Object storage: project-owned MinIO volume and bucket, private anonymous
  policy, staging-only browser CORS, and a 14-day lifecycle rule.
- Backend: two replicas sharing the same staging Redis to exercise distributed
  locks.
- External effects: log mailer; Google OAuth/Drive, WhatsApp, MQTT, Mosquitto,
  and production device events disabled.

## Synthetic fixture

`Database\Seeders\StagingUploadFixtureSeeder` is staging-only and idempotently
creates:

- Tenant A: Admin A, Guru A1/A2, Siswa A1/A2, Kelas A1/A2, Assignment A1.
- Tenant B: Admin B, Guru B1, Siswa B1, Kelas B1, Assignment B1.

All fixture email addresses end in `@staging.invalid`. The password is supplied
only by the `STAGING_TEST_PASSWORD` environment secret and must not appear in a
report.

## Deployment sequence

1. Verify DNS A/AAAA records for the backend and storage staging hosts point to
   the isolated staging target. Verify the frontend custom domain belongs to
   the staging Pages project.
2. Dispatch `Isolated Staging` with operation `deploy`. The first deployment
   must leave all three V2 flags `false`.
3. The workflow runs Composer validation/audit, PHP tests with `ext-zip`, Pint,
   npm audit/tests/build, then builds SHA-only images.
4. The remote script runs fail-closed preflight, creates the bucket policy/CORS,
   runs migrations against the staging database only, loads synthetic fixtures,
   starts two backends plus queue/scheduler, and executes
   `php artisan staging:verify-runtime`.
5. Confirm `/api/health` returns the selected full `release_sha` and no other
   deployment detail.
6. Exercise legacy assignment/upload flows before changing flags.

## Upload V2 rollout and live verification

After default-off checks pass, set all three staging variables to `true` and
redeploy so Vite rebuilds. Production flags remain unchanged. Use browser
Network tools and API/provider telemetry to verify:

- Assignment and submission calls use `/api/v2/assignments` and
  `/api/v2/submissions`.
- Upload calls use `/api/v2/uploads`, completion, and attachment endpoints.
- No `/api/storage/*` request occurs in the flag-on assignment flow.
- PDF, image, supported office document, near-limit, over-limit, empty,
  MIME-mismatch, traversal filename, correct checksum, and bad checksum cases.
- Initiate, signed PUT, HEAD verification, complete, claim, authorized
  download, detach/delete, retryable delete, and `uploads:cleanup`.
- Guest, cross-tenant, same-tenant teacher/student IDOR, wrong purpose/parent,
  expired/cancelled/quarantined sessions, repeated complete, concurrent claim,
  and idempotency conflict scenarios.

Record only request IDs, opaque resource IDs, status, duration, and failure
codes. Never record signed URLs, credentials, authorization headers, cookies,
or complete object keys.

## Rollback

Each successful deployment records `.staging-current-release` and the prior SHA
in `.staging-previous-release`. Dispatch operation `rollback` only after the
previous SHA-tagged backend, nginx, and Caddy images have been built and are
available. `deploy/staging/rollback.sh` refuses `latest`, recreates the stack,
reruns additive migrations, repeats runtime verification, and checks the public
health SHA.

For a flag-only rollback, set the three staging V2 variables to `false` and
redeploy the same SHA. This rebuild is required for the two frontend flags.

## Stop conditions

Stop and report `NOT_READY` if a target resolves to production, an isolated
secret is missing, CORS or provider verification fails, a staging lock is not
shared across both replicas, an external side effect is enabled, any security
scenario leaks access, or rollback has not been executed successfully.
