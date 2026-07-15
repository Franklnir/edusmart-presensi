# Hybrid API Architecture

Status: controlled hybrid on `hardening/api-v2`.

## Boundary

Migrated domains use a V2-only path:

```text
Page -> Hook -> Domain service -> apiClient -> /api/v2/*
```

Domains that have not completed migration may use the compatibility boundary:

```text
Page -> Hook -> Legacy domain service -> legacyDbClient -> /api/db
```

The compatibility boundary is temporary, tenant-scoped, and observable. It is
not an authorization mechanism. New features and migrated domains must not add
new consumers or silently fall back from V2 to legacy.

## Request Context

Every API request receives one UUID `X-Request-ID`. The ID is returned in the
response, included in structured logs, frontend error records, and legacy DB
telemetry. `X-Correlation-ID` is optional for multi-request workflows. Queue
payloads carry the safe request context and clear worker log context after the
job completes.

## Error Contract

API errors use `success`, stable `code`, safe `message`, safe `details`, and
`request_id`. Validation details contain field messages only. Stack traces,
SQL, credentials, tokens, quiz answers, RFID UIDs, and signed URLs are never
part of the public error contract.

## Migration Rule

The legacy consumer register at `config/api-legacy-consumers.json` is an
explicit freeze list. Removing an entry is allowed when its domain is migrated;
adding an entry requires an architectural review and an identified V2 target.
