# API V2 Phase 4C Report - Shared Organization Context

- Date: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Status: implementation complete; rollout remains staging-gated

## Scope

The application shell now has a tenant-scoped V2 resource for the small set of
organization values needed by navigation and role-aware menu construction. It
does not expose arbitrary settings or a generic table query.

## Delivered Contract

| Method | Endpoint | Role | Notes |
|---|---|---|---|
| `GET` | `/api/v2/organizations` | Admin, Guru, Siswa | Returns organization display data, active academic context, teacher homeroom membership, and delegated feature keys. |

The server derives the tenant from tenancy middleware and the actor from the
authenticated Sanctum user. The browser cannot choose `tenant_id`, user ID,
academic year, or permission owner in this request.

## Consumers Migrated

- `src/components/Navbar/hooks.js` loads school name/logo through the V2
  resource rather than querying `settings` directly.
- The wali-kelas menu flag uses the server's active-year-scoped membership
  result rather than reading `kelas_struktur` in the browser.
- Delegated teacher features use the tenant-scoped V2 permission result rather
  than the legacy delegated-permission adapter.
- Requests are deduplicated through the shared API client and do not fall back
  to `/api/db` when V2 fails.

## Server Controls

- Tenant access is enforced by the existing tenant middleware and profile
  tenant guard.
- Organization settings, homeroom rows, and delegated permissions are filtered
  by the server-side tenant context.
- Homeroom membership is limited to the active academic year returned by the
  lifecycle service.
- The resource returns a deliberately small allowlisted response and omits
  tenant IDs, profile data, permission metadata, and storage credentials.

## Verification

- `php artisan test tests/Feature/Api/V2/OrganizationContextControllerTest.php`
- `npm run test -- --run src/services/__tests__/phaseThreeServices.test.js`
- `npm run audit:api-db-legacy`
- `npm run check`

## Remaining Work

Notifications, presence/monitoring, profile attachments, school structure,
settings management, and role dashboards still have legacy consumers. The DB
gateway must remain enabled until the migration matrix reaches zero active
consumers and staging proves `API_DB_ENABLED=false` behavior.
