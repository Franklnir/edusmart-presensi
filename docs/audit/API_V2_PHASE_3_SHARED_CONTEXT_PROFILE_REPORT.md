# API V2 Phase 3 Report - Academic Context and Self Profile

- Date: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Status: implemented and covered by tests; production rollout remains controlled by the normal deployment process.

## Delivered scope

| Resource | Endpoint | Consumer migrated | Status |
|---|---|---|---|
| Academic context | `GET /api/v2/academic-context` | `src/context/AcademicContext.jsx` | MIGRATED |
| Current profile | `GET /api/v2/profile` | shared client service | IMPLEMENTED |
| Current profile | `PATCH /api/v2/profile` | text profile save in `src/pages/siswa/EditProfile.jsx` | PARTIAL |
| Classes for profile display | `GET /api/v2/classes` | `src/pages/siswa/EditProfile.jsx` | MIGRATED |

`AcademicContextProvider` refreshes its cached context at most once per minute and when the application emits `sismu:academic-context-updated`. It no longer performs a generic database query.

## Server-side controls

- Tenant scope is resolved exclusively from tenancy middleware.
- The browser cannot choose the tenant for either resource.
- The profile endpoint only reads the authenticated actor's own profile.
- `PATCH /api/v2/profile` applies a role-specific allowlist, transaction lock, validation, and idempotency replay protection.
- A teacher's NIP/NUPTK (`nis` legacy field) is unique inside its tenant when it is changed.
- Profile audit records store only the list of changed field names, never the previous or new personal values.
- Server-managed fields such as tenant, role, status, class assignment, and avatar path are not accepted by this endpoint.

## Intentional boundary

Avatar upload and download remain on the old storage compatibility path. They are not marked migrated because a profile avatar still needs a parent-aware Attachment V2 policy and temporary authorized download endpoint. The profile resource deliberately does not expose persistent avatar object paths or URLs.

The remaining profile provisioning flow after authentication is also still legacy. It must move together with the identity/provisioning contract rather than being routed through a generic database endpoint.

## Acceptance checks

1. A tenant member only receives that tenant's academic context.
2. An authenticated user only reads or changes their own profile.
3. Forged `tenant_id`, `role`, and avatar fields cannot change profile authority or storage ownership.
4. The same idempotency key produces one profile mutation and one audit change.
5. A student cannot change server-managed name or NIS through the self-profile endpoint.
6. `AcademicContext.jsx` issues `GET /api/v2/academic-context`, not `/api/db`.

## Verification commands

```bash
cd backend
php artisan test tests/Feature/DbSecurityTest.php tests/Feature/Api/V2/SharedContextAndProfileControllerTest.php
./vendor/bin/pint --test
php artisan route:list --path=api/v2 --json

cd ..
npx eslint src/pages/siswa/EditProfile.jsx src/context/AcademicContext.jsx src/services/academicContextService.js src/services/currentProfileService.js src/services/__tests__/phaseThreeServices.test.js
npm run test -- --run src/services/__tests__/phaseThreeServices.test.js
npm run audit:api-db-legacy
```

The full migration state remains in [API_V2_REMAINING_CONSUMERS.md](API_V2_REMAINING_CONSUMERS.md) and [API_DB_FINAL_MIGRATION_MATRIX.md](API_DB_FINAL_MIGRATION_MATRIX.md).
