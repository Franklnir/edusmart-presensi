# Academic Period Behavior Parity: Legacy vs V2

## Metadata

| Item | Value |
|------|-------|
| Legacy source | `AdminController::applyAcademicPeriod()` (L2026–2372) + rollover helpers |
| V2 source | `AcademicPeriodController::apply()` (L110–206) + `AcademicPeriodLifecycleService::activate()` |
| Scope | Behaviors observed during Academic Period application (apply, rollover, snapshot, restore) |

---

## Parity Matrix

| # | Behavior | Legacy | V2 Before | Required V2 | Tests | Status |
|---|---|---|---|---|---|---|
| 1 | **Validate period payload** | `ApplyAcademicPeriodRequest` validates structure, normalize year/semester | `ApplyAcademicPeriodRequest` validates structure | Same | Legacy | ✅ **Equivalent** |
| 2 | **Gate: admin only, tenant scoped** | Admin + tenant gate | `Gate::authorize('update', Setting)` | Same | — | ✅ **Equivalent** |
| 3 | **Impact preview** | `AcademicPeriodLifecycleService::impactPreview()` | `AcademicPeriodLifecycleService::impactPreview()` | Same | — | ✅ **Equivalent** |
| 4 | **Lifecycle validate** | `AcademicPeriodLifecycleService::validateActivation()` | `AcademicPeriodLifecycleService::validateActivation()` | Same | — | ✅ **Equivalent** |
| 5 | **Calendar/server confirmation** | Inline check: if year changed + calendar mismatch + not confirmed → 409 | Inline check: same | Same | — | ✅ **Equivalent** |
| 6 | **Rollover preview** | `previewAcademicYearRollover()` → reads classes, profiles, exceptions | **MISSING** | Add to preview endpoint | Legacy | ❌ **GAP** |
| 7 | **Settings save** | `saveAcademicPeriodSettings(tenantId, existing, payload)` → upserts tahun_ajaran, semester, date ranges, current_academic_year_id, current_academic_term_id into `settings` | Only `lifecycle->activate()` which sets `current_academic_year_id`/`current_academic_term_id` but NOT `tahun_ajaran`/`semester_aktif`/dates | Must also save `tahun_ajaran`, `semester_aktif`, date ranges to `settings` table | — | ❌ **GAP** |
| 8 | **Lifecycle activate** | `academicPeriodLifecycleService->activate()` → creates/updates academic_years, academic_terms, sets active | `lifecycle->activate()` | Same | — | ✅ **Equivalent** |
| 9 | **Locking** | `AcademicRolloverService::lockTenant()` → lockForUpdate on tenants, settings, academic_years | `activate()` has `lockForUpdate` on tenants, settings, academic_years inside transaction | Same + any additional tables we touch | — | ✅ **Equivalent** (activate handles it) |
| 10 | **Transaction** | `DB::transaction()` wrapping settings save + activate + snapshot + sync + rollover | `activate()` wraps its own transaction | All steps must be in one transaction | — | ❌ **GAP** (steps outside activate are untransacted) |
| 11 | **Snapshot BEFORE** | `snapshotStudentClassHistoriesForPeriod(..., 'before_period_change')` — captured before any mutation | **MISSING** | Must snapshot student_class_histories before changing period | — | ❌ **GAP** |
| 12 | **Semester-only: eskul catalog copy** | `ExtracurricularPeriodService::copyCatalog()` — copies eskul catalog, NOT memberships | **MISSING** | Must copy eskul catalog when semester changes but year stays | — | ❌ **GAP** |
| 13 | **Restore from snapshot (semester-only with snapshots)** | `syncClassPeriodMetadata()` + `restoreStudentProfilesFromPeriodSnapshot()` — restores profiles from existing snapshot | **MISSING** | Must restore profiles from snapshot when returning to previous period | — | ❌ **GAP** |
| 14 | **Rollover (naik kelas / kelulusan)** | `academicRolloverService->execute()` + `rolloverAcademicYearData()` — promotes students, marks alumni, handles retention, clears class leaders, syncs organisasi | **MISSING** | Must execute rollover when advancing to next academic year | Legacy | ❌ **GAP** |
| 15 | **Rollover: ensure target classes** | `ensureRolloverTargetClasses()` — creates missing target year classes | **MISSING** | Must create missing target classes before assigning students | — | ❌ **GAP** |
| 16 | **Rollover: eskul member carry** | `rolloverAcademicYearData()` includes `carryEskulMembers` flag — copies student eskul memberships to target period | **MISSING** | Must carry eskul memberships when rollover flag is set | — | ❌ **GAP** |
| 17 | **Rollover: assert matches preview** | `assertRolloverMatchesPreview()` — throws RuntimeException if preview vs execution counts differ | **MISSING** | Must verify rollover execution matches preview | — | ❌ **GAP** |
| 18 | **Sync class period metadata** | `syncClassPeriodMetadata()` — updates kelas.tahun_ajaran, kelas.semester, kelas.angkatan | **MISSING** (in apply, only in restore) | Must sync kelas metadata after activation | — | ❌ **GAP** |
| 19 | **Snapshot AFTER** | `snapshotStudentClassHistoriesForPeriod()` with source `'period_snapshot_restore'`, `'auto_rollover'`, or `'period_sync'` | **MISSING** | Must snapshot after all mutations | — | ❌ **GAP** |
| 20 | **Profile: mark missing students as nonaktif** | `markStudentsMissingFromPeriodSnapshot()` — marks active students not in snapshot as nonaktif | **MISSING** (in apply, only in restore) | Must mark students outside new period as inactive | — | ❌ **GAP** |
| 21 | **Profile: insert missing** | `restoreStudentProfilesFromPeriodSnapshot()` creates profiles for students in snapshot but missing from profiles table | **MISSING** (in apply, only in restore) | Must create missing profile rows | — | ❌ **GAP** |
| 22 | **Cache refresh post-transaction** | `refreshAdminPageCache()` with HOME, STRUCTURE, ORGANIZATIONS, TEACHER_OPTIONS scopes | **MISSING** | Must dispatch cache refresh after apply | — | ❌ **GAP** |
| 23 | **Audit log** | `logAudit()` with type `UPDATE` for restore, `APPLY` for apply | **MISSING** in V2 apply; present in restore endpoint | Should log audit entry | — | ❌ **GAP** (nice to have) |
| 24 | **Idempotency** | Not explicitly handled (relies on transaction atomicity) | `IdempotencyService::handle()` with `ap-apply:` + tenant + payload hash key | Same | — | ✅ **Better than legacy** |
| 25 | **Two concurrent applies** | `lockTenant()` + transaction prevents concurrent mutation | `activate()` lockForUpdate + idempotency key | Same | — | ✅ **Equivalent** |
| 26 | **Error: DomainException** | Caught → 409 with parsed code/message | Caught → 422 with parsed detail | Same (minor status difference: 409 vs 422) | — | ⚠️ **Minor diff** (legacy 409, V2 422) |
| 27 | **Error: RuntimeException** | Caught → 422 plain message | Caught → 422 wrapped in PERIOD_ERROR | Same | — | ✅ **Equivalent** |

**Status Legend:**
- ✅ Equivalent — behavior is present and functionally identical
- ❌ GAP — behavior is missing from V2 and must be added
- ⚠️ Minor diff — behavior exists but has minor differences

---

## Gap Summary

| Severity | Count | Key Items |
|:--------:|:-----:|-----------|
| ✅ Equivalent | 10 | Validation, gates, preview, lifecycle activate, locking, calendar confirmation, error handling |
| ❌ **GAP** | **15** | Settings save (year/semester), snapshot before/after, class sync, profile restore/rollover, eskul catalog copy, cache refresh, audit |
| ⚠️ Minor diff | 1 | DomainException status code (409 vs 422) |

### Missing Behaviors (Priority Order)

1. **Snapshot BEFORE** — no safety net before mutations
2. **Settings save** — `tahun_ajaran`/`semester_aktif` not persisted to `settings` table by V2 apply
3. **Rollover** — student promotion/alumni marking not executed
4. **Class metadata sync** — kelas rows not updated for new period
5. **Snapshot AFTER** — no record of new state after mutation
6. **Eskul catalog copy** — not carried to new semester
7. **Cache refresh** — admin page cache not invalidated
8. **Audit log** — no audit trail for apply action

---

## Implementation Plan

### 1. Create `ApplyAcademicPeriodAction`
- Orchestrates the full apply flow with transaction and locking
- Uses existing services: `AcademicPeriodLifecycleService`, `AcademicRolloverService`, `ExtracurricularPeriodService`, `RestoreAcademicRosterAction`
- Extracts rollover helpers from AdminController into a shared place

### 2. Extract Rollover Helpers
Move from `AdminController` private methods to shared locations:
- `rolloverAcademicYearData()` → `AcademicRolloverService::applyRollover()`
- `ensureRolloverTargetClasses()` → `AcademicRolloverService`
- `previewAcademicYearRollover()` → `AcademicRolloverService::previewRollover()`
- `assertRolloverMatchesPreview()` → `AcademicRolloverService`
- `rolloverExceptionStudentIds()` → `AcademicRolloverService`
- `syncStudentClassSnapshotTables()` → `AcademicRolloverService`

### 3. Expose Snapshot/Sync Helpers
Make `RestoreAcademicRosterAction` methods accessible:
- `snapshotStudentClassHistoriesForPeriod()` → public
- `syncClassPeriodMetadata()` → public
- `hasStudentClassSnapshotsForPeriod()` → public

### 4. Integrate into V2 Controller
- V2 `apply()` delegates to `ApplyAcademicPeriodAction::execute()`
- V2 controller handles validation/confirmation before calling action
- Action handles transaction + locking + data migration + cache refresh
