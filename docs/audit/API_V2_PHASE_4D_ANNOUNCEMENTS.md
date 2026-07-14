# API V2 Phase 4D Report - Announcements

- Date: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Status: implementation complete; rollout remains staging-gated

## Delivered Contract

| Method | Endpoint | Role | Notes |
|---|---|---|---|
| `GET` | `/api/v2/announcements` | Admin, Guru, Siswa | Tenant-scoped; non-admin roles receive only `semua` and their own target. |
| `POST` | `/api/v2/announcements` | Admin | Server assigns tenant and ID; requires idempotency. |
| `PATCH` | `/api/v2/announcements/{id}` | Admin | Tenant-scoped update; requires idempotency. |
| `DELETE` | `/api/v2/announcements/{id}` | Admin | Tenant-scoped delete; requires idempotency. |

## Frontend Rollout

The admin home, teacher dashboard, and student dashboard use the V2 service
when the build flag below is true. The default remains false until staging
acceptance passes:

```text
VITE_USE_ANNOUNCEMENTS_API_V2=true
```

When enabled, V2 failures are surfaced to the UI; there is no hidden fallback
to `/api/db`. The legacy branch remains available only while the migration
flag is disabled and the matrix is non-zero.

## Controls

- Tenant is taken from server tenancy middleware, never from the request body.
- Read visibility is filtered by authenticated role and target.
- Mutation payloads are validated by Form Requests.
- Mutations use `Idempotency-Key` and tenant-scoped lookup before writing.
- Responses expose only announcement fields and request metadata.

## Verification

- `php artisan test tests/Feature/Api/V2/AnnouncementControllerTest.php`
- `npm run test -- --run src/services/__tests__/phaseThreeServices.test.js`
- `npm run audit:api-db-legacy`
- `npm run check`

## Remaining Work

The announcement domain is complete behind the staging flag. The admin home
still contains legacy extracurricular consumers, and `/api/db` stays enabled
while the wider migration matrix contains active consumers. Before enabling
this flag in production, staging must verify create, update, delete, and
role-scoped reads on all three dashboard surfaces.
