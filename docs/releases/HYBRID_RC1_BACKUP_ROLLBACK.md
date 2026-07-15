# Hybrid RC1 Backup and Rollback Package

This document is a release procedure. It does not perform a backup, deploy,
rollback, or VPS mutation by itself.

## Release Identity

Record these values before any isolated staging deployment:

```text
RELEASE_SHA=<output of git rev-parse release/hybrid-rc1 at release time>
PREVIOUS_RELEASE_SHA=NOT_RECORDED
BACKEND_IMAGE=NOT_CREATED_DOCKER_UNAVAILABLE
FRONTEND_IMAGE=NOT_CREATED_DOCKER_UNAVAILABLE
CADDY_IMAGE=NOT_CREATED_DOCKER_UNAVAILABLE
MIGRATION_SET=2026_07_15_000100_add_observability_context_to_frontend_error_logs.php,2026_07_15_000110_add_read_write_to_db_proxy_usage_telemetry.php
```

The three image tags must contain the same release SHA. A mutable branch tag
is not a rollback identity.

## Backup Before Staging

1. Confirm the target is the isolated staging database and storage account.
2. Create a PostgreSQL logical backup with the operator's approved command.
3. Record backup timestamp, database identity, object-store bucket, and
   checksum in the release record.
4. Back up application configuration references without exposing secret values.
5. Confirm storage backups contain metadata and object references according to
   the tenant policy; do not copy production objects into staging.
6. Verify the backup can be listed and that a restore drill owner is assigned.
7. Keep the previous staging image and migration state available.

Example operator procedure. Replace placeholders in the secure environment,
never commit the resulting command or credentials:

```sh
pg_dump --format=custom --file="$BACKUP_DIR/hybrid-rc1-${RELEASE_SHA}.dump" "$STAGING_DATABASE_URL"
sha256sum "$BACKUP_DIR/hybrid-rc1-${RELEASE_SHA}.dump" > "$BACKUP_DIR/hybrid-rc1-${RELEASE_SHA}.sha256"
```

## Deployment Guard

- [ ] `/api/ready` is green before traffic is enabled.
- [ ] Database migrations are additive and have a recorded before/after state.
- [ ] Queue workers and scheduler use the same release SHA.
- [ ] Staging API and tenant root cannot resolve to production.
- [ ] `APP_RELEASE_SHA` and frontend metadata equal `RELEASE_SHA`.
- [ ] The legacy DB gateway remains enabled only for the explicit compatibility
      register.
- [ ] No new compatibility consumer was introduced.

## Rollback Procedure

1. Freeze the staging rollout and capture request IDs and structured logs.
2. Stop routing new staging traffic to the candidate.
3. Restore the previous backend, frontend, and Caddy SHA-tagged images.
4. Do not run destructive or down migrations automatically.
5. If an additive migration is backward-compatible, keep it and verify the
   previous artifact against the schema. Otherwise restore the staging backup
   using the approved database recovery procedure.
6. Restart workers and scheduler on `PREVIOUS_RELEASE_SHA`.
7. Check `/api/health` and `/api/ready`, then run the smoke checklist.
8. Record the rollback reason, release SHA, previous SHA, request IDs, backup
   checksum, and operator.

## Rollback Validation

- [ ] Login/logout works for every staging role.
- [ ] No 500/502 or 401 retry loop.
- [ ] Tenant isolation remains enforced.
- [ ] The previous frontend does not request an endpoint removed by the
      candidate.
- [ ] Queue and scheduled jobs are processing normally.
- [ ] Backup and logs are retained for incident review.

## Current RC1 State

- Release SHA: **verify from release/hybrid-rc1 HEAD before execution**.
- Backup execution: **NOT PERFORMED**.
- Backup timestamp/checksum/database identity: **NOT RECORDED**.
- Restore drill: **NOT VERIFIED**.
- Previous immutable staging artifact: **NOT RECORDED IN THIS TASK**.
- Immutable application images: **NOT CREATED; Docker/registry unavailable**.
- Production/VPS action: **NONE**.
- Release decision: **NOT_READY**.
