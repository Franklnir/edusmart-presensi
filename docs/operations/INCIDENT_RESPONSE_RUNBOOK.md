# Incident Response Runbook

## Triage

1. Record time zone, tenant, role, route, release SHA, and Request ID.
2. Check `/api/health` for liveness and `/api/ready` for dependency readiness.
3. Search Monitor Log by Request ID, then by route, status, and error code.
4. Check structured API access records for slow requests or dependency errors.
5. Check queue events for the related `job_id`, attempts, duration, and safe
   failure code.

## Containment

- Stop or isolate the affected workflow when data integrity is at risk.
- Do not disable tenant isolation, WAF, authentication, or audit logging.
- Do not replay a mutation unless its idempotency policy is understood.
- Use a staging tenant to verify a fix.

## Recovery

1. Apply the smallest reviewed change.
2. Run focused backend and frontend tests.
3. Verify request ID propagation and redaction.
4. Confirm the release and rollback artifact before any release action.
5. Document impact, cause, resolution, and follow-up regression coverage.
