# API V2 Phase 4E Report - Grade Weights and Manual Scores

- Date: 2026-07-14 (Asia/Jakarta)
- Branch: `hardening/api-v2`
- Status: implementation complete; rollout remains staging-gated

## Scope

This phase migrates the teacher subject-weight configuration and manual student scores
used by the reporting page. It does not claim that quiz attempts, report cards,
or exports have migrated; those remain explicit follow-up work.

## Delivered Contract

| Method | Endpoint | Role | Notes |
|---|---|---|---|
| `GET` | `/api/v2/grades/weights` | Admin, Guru | Tenant, academic year, and semester scoped. Guru sees only own rows; admin may filter by `guru_id`. |
| `PUT` | `/api/v2/grades/weights` | Admin, Guru | Fixed payload for one teacher/mapel. Server writes tenant, teacher identity for guru, normalized period references, and timestamps. |
| `GET` | `/api/v2/grades/manual-scores` | Admin, Guru | Tenant, academic year, and semester scoped. Guru sees only own rows; admin may filter by `guru_id`. |
| `PUT` | `/api/v2/grades/manual-scores` | Admin, Guru | Validates teacher assignment (jadwal) and student class history. Fixed payload per student/mapel. Server sets metadata. |

The contract includes the four component weights and the source metadata for
the midterm/final components. A total up to 100% is accepted so the remaining
weight can continue to represent a configured manual component in the current
reporting model.

## Server Controls

- Tenant comes exclusively from tenancy middleware.
- Guru identity is derived from the authenticated profile. An admin may target
  only a teacher profile in the same tenant.
- The request period is used for context verification only. The persisted year,
  semester, and normalized academic IDs come from the server context.
- Active-period writes use `AcademicMutationGuard`; archive writes require an
  approved correction session and are not silently redirected to the active
  period.
- Payloads are validated by a Form Request, including component ranges, source
  enums, label length, and the total-weight limit.
- Writes use a fixed resource endpoint, a row lock, tenant/period composite
  lookup, idempotency, and an audit record with before/after data and context.
- No arbitrary table, column, filter, or action is accepted.

## Frontend Rollout

The teacher report page uses the V2 weight read/write service only when the
following build flag is enabled:

```text
VITE_USE_GRADES_API_V2=true
```

The production example remains `false`. When enabled, a V2 error is surfaced
to the page and does not fall back to `/api/db`. The UI blocks archive writes
until a correction-session flow is available.

## Verification

- `php artisan test tests/Feature/Api/V2/GradeControllerTest.php`
- `npm run test -- --run src/services/__tests__/phaseThreeServices.test.js`
- `npm run audit:api-db-legacy`
- `npm run check`

## Remaining Work

The wider grade/report domain still needs resource contracts for digital and paper UTS/UAS/UKK inputs, quiz summaries, report cards, and report exports. The legacy gateway remains enabled while those consumers are active.
