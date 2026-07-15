# Request ID And Error Debugging

## User Workflow

1. Ask the user for the visible Request ID, or use the ID shown by the error
   notice. It is safe to share with the support team.
2. Search Monitor Log or Super Monitor by Request ID.
3. Confirm domain, route, status, error code, tenant, actor, release SHA, and
   duration.
4. Check the structured backend log for the same Request ID.
5. If the operation dispatched work, search the related `job_id` or
   `correlation_id`.
6. Reproduce with a staging tenant and non-sensitive data.
7. Add or update a regression test before changing the production path.
8. Record the resolution and the release SHA.

## Error Fields

The frontend normalizes errors to `status`, `code`, `message`, `details`,
`requestId`, and flags for network, validation, unauthorized, and conflict
errors. Mutation retries require an `Idempotency-Key`. V2 failures never fall
back to `/api/db`.

## Security

Never request passwords, cookies, authorization headers, full payloads, SQL,
quiz answer keys, RFID UIDs, or signed URLs for debugging. Request IDs identify
a request; they do not grant access.
