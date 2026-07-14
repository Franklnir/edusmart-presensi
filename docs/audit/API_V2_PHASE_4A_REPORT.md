# API V2 Phase 4A Report — Upload Sessions and Attachments

- Date: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Program base: `53dffaea`
- Phase 4A implementation base: `01c5c92e`
- Phase 4A implementation end: `67450252`
- Safety stash: retained

## Scope and commits

| Commit | Scope |
|---|---|
| `80f3b4f2` | Remaining consumer and `/api/db` static inventory |
| `01c5c92e` | Global idempotency identity, response, lock, and cache-failure hardening |
| `8a56f497` | Upload provider, state machine, Attachment API/policy, cleanup, migration, backend tests |
| `67450252` | Strict assignment/submission upload V2 service and frontend cutover path |

## Domain implementation

| Item | Result |
|---|---|
| Domain | Upload Session and Attachment |
| Endpoints | `POST/GET/DELETE /api/v2/uploads*`; `GET/DELETE /api/v2/attachments*` (7 routes) |
| Controller | Thin `UploadController` and `AttachmentController` |
| Requests | Store, complete, cancel, and delete Form Requests |
| Resource | `UploadSessionResource`, `AttachmentResource`; internal object key/bucket omitted |
| Policy | `AttachmentPolicy` delegates claimed access to assignment/submission parent policy |
| Actions | Create, complete, cancel, delete, and cleanup actions |
| Provider | `UploadStorageProvider`; S3-compatible production adapter; test-only local fake |
| Frontend | `uploadService`; teacher assignment and student submission flows behind a strict flag |
| Feature flags | Backend and frontend default `false` |
| Fallback | None when `VITE_USE_ASSIGNMENT_UPLOADS_API_V2=true` |

## Storage and schema

Migration `2026_07_14_030000_finalize_api_v2_upload_records.php` is additive.
It records provider, physical bucket, actual size, optional checksum, lifecycle
timestamps, failure code, status, and attachment soft deletion. It adds:

- `upload_sessions_cleanup_idx (status, expires_at)`;
- `attachments_cleanup_idx (status, claimed_at, created_at)`;
- the Phase 3 unique `attachments_upload_session_unique` remains the duplicate
  attachment guard.

Upload state is `pending → uploading → verifying → uploaded → completed`, with
terminal/recovery states `cancelled`, `expired`, `failed`, and `quarantined`.
Verification checks the server-owned provider/bucket/key, existence, actual and
declared size, exact MIME/extension, and SHA-256 when supported. Claim and final
completion use transactions and row locks.

`uploads:cleanup` is scheduled every 15 minutes with `onOneServer()` and
`withoutOverlapping()`. It expires sessions, deletes cancelled/failed/expired/
quarantined objects, and removes detached attachments after the configured age.

## Security and correctness tests

| Coverage | Result |
|---|---|
| Actor and tenant ownership | PASS |
| Same-tenant attachment IDOR | PASS |
| Cross-tenant concealment | PASS |
| Assignment parent download policy | PASS |
| Submission owner/teacher download policy | PASS |
| Permanent public URL/object key exposure | PASS (not exposed) |
| Idempotent complete/replay | PASS |
| Duplicate attachment constraint | PASS |
| Size/MIME/checksum verification | PASS |
| Expiry/cancel/quarantine state handling | PASS |
| Cleanup scheduler action | PASS |
| S3-compatible adapter with signed PUT/HEAD/GET/DELETE (HTTP fake) | PASS |
| Browser PUT and POST instruction handling | PASS |
| Progress and AbortSignal plumbing | PASS |
| Live staging provider credential/CORS test | NOT RUN — staging target/credentials unavailable |

## Quality gates

| Quality Gate | Result | Evidence |
|---|---|---|
| API V2 routes | PASS | 45 total, up from 42; 7 upload/attachment routes |
| Backend tests | PASS | 343 passed, 0 failed, 10 skipped, 1856 assertions |
| Skipped tests | BLOCKED | 10 XLSX tests require `ext-zip` |
| Frontend tests | PASS | 14 passed, 0 failed |
| Upload service tests | PASS | PUT/POST instruction, progress, completion, authorized download/delete |
| Changed-file ESLint | PASS WITH WARNINGS | 0 errors, 6 pre-existing hook warnings in the two migrated pages |
| Full ESLint | IMPROVED / KNOWN DEBT | 154 errors, 67 warnings; baseline was 165/70 |
| Full Pint | PASS | `./vendor/bin/pint --test` |
| Production/PWA build | PASS | Vite build and service worker generation completed |
| Dependency audit | PASS at baseline | `npm ci --legacy-peer-deps`, 0 vulnerabilities |
| Scheduler registration | PASS | `uploads:cleanup` appears every 15 minutes with array cache override |
| Shared Redis lock | NOT VERIFIED HERE | local cache is database; staging Redis is mandatory |
| Storage integration | PARTIAL | adapter integration passes with HTTP fake; live bucket not verified |
| Staging smoke/rollback | NOT RUN | no staging target or credential supplied |

## Active legacy consumers after Phase 4A

- Assignment/submission pages still execute `/api/storage/*` while the new
  frontend flag is false. This is intentional until the staging provider gate.
- Certificate, settings, profile, and quiz media uploads remain legacy and are
  separately inventoried.
- Grades, quiz, schedules, announcements, extracurriculars, reports, RFID, and
  device domains remain legacy/partial per the remaining-consumer inventory.
- `/api/db` remains required and must not be disabled.

## Risk and decision

| Risk | Severity | Mitigation | Status |
|---|---|---|---|
| Wrong bucket/CORS/credential behavior in real staging | High | Run browser PUT, HEAD verification, authorized GET, DELETE, expiry, and cleanup against the configured staging bucket | OPEN |
| Shared lock differs from local database cache | High | Verify Redis atomic locks and owner-token expiry on all staging nodes | OPEN |
| Flag enabled without assignment V2 | High | Roll out assignments V2 before/with assignment-upload V2 and smoke teacher/student roles | OPEN |
| Detached objects after failed client completion | Medium | 15-minute cleanup plus detached-attachment TTL | MITIGATED |
| `ext-zip` tests skipped | Medium | Execute full backend suite in staging/container with `ext-zip` | OPEN |
| Full legacy lint debt | Medium | Continue scoped remediation; production gate remains zero errors | OPEN |

Phase 4A code is ready for the staging provider gate, but the active upload flag
must remain off until that gate passes. Because the execution instructions forbid
advancing while the previous domain still actively uses legacy and explicitly
allow stopping when mandatory external credentials are unavailable, Phase 4B is
not started in this run.

Overall decision: **READY_FOR_NEXT_PHASE** (next action is Phase 4A staging
provider verification, not Grades activation).
