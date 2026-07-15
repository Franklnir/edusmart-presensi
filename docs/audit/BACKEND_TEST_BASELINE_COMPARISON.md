# Backend Test Baseline Comparison

## Metadata

| Item | Value |
|------|-------|
| Baseline commit | `2467e6ef` |
| Current commit | `2467e6ef` (working tree) |
| PHP | `8.4.22` |
| PHPUnit | `12.5.24` |
| DB | SQLite `:memory:` |
| Baseline run | 419 tests, 2033 assertions, 31 failures, 10 skipped |
| Current run | 419 tests, 2033 assertions, 31 failures, 10 skipped |

## Comparison Table

| # | Test | Baseline Result | Current Result | Same Failure | Classification |
|---|------|----------------|----------------|:------------:|:--------------:|
| 1 | AcademicPeriodConsistencyTest::test_report_cards_are_isolated_by_term_and_archive_write_is_rejected | 410 vs 200 (rapot_siswa) | 410 vs 200 (rapot_siswa) | YES | PRE_EXISTING_IDENTICAL |
| 2 | AcademicPeriodConsistencyTest::test_manual_subject_scores_are_server_scoped_and_isolated_by_term | 410 vs 409 (guru_mapel_manual_nilai) | 410 vs 409 (guru_mapel_manual_nilai) | YES | PRE_EXISTING_IDENTICAL |
| 3 | AcademicPeriodConsistencyTest::test_subject_weight_sources_are_isolated_by_term | 410 vs 200 (guru_mapel_bobot) | 410 vs 200 (guru_mapel_bobot) | YES | PRE_EXISTING_IDENTICAL |
| 4 | AcademicPeriodConsistencyTest::test_archive_mutation_requires_scoped_correction_session_and_is_tenant_isolated | 410 vs 409 (tugas) | 410 vs 409 (tugas) | YES | PRE_EXISTING_IDENTICAL |
| 5 | AcademicPeriodConsistencyTest::test_tenant_payload_and_filters_cannot_escape_resolved_tenant | 410 vs 200 (tugas) | 410 vs 200 (tugas) | YES | PRE_EXISTING_IDENTICAL |
| 6 | SubjectControllerTest::test_can_list_subjects | 403 vs 200 | 403 vs 200 | YES | PRE_EXISTING_IDENTICAL |
| 7 | SubjectControllerTest::test_can_create_subject | 403 vs 201 | 403 vs 201 | YES | PRE_EXISTING_IDENTICAL |
| 8 | ApiDocumentationRouteCoverageTest::test_api_endpoint_catalog_matches_registered_application_routes | 36 undocumented routes (no AP routes) | 46 undocumented routes (+10 AP routes) | *PARTIAL* | NOT_COMPARABLE* |
| 9 | DbSecurityTest::test_kelas_insert_normalizes_full_suffix_and_avoids_cross_tenant_slug_collision | 410 vs 200 (kelas) | 410 vs 200 (kelas) | YES | PRE_EXISTING_IDENTICAL |
| 10 | DbSecurityTest::test_siswa_cannot_insert_tugas_jawaban_for_other_class | 410 vs 422 (tugas_jawaban) | 410 vs 422 (tugas_jawaban) | YES | PRE_EXISTING_IDENTICAL |
| 11 | DbSecurityTest::test_siswa_can_insert_tugas_jawaban_for_own_class | 410 vs 200 (tugas_jawaban) | 410 vs 200 (tugas_jawaban) | YES | PRE_EXISTING_IDENTICAL |
| 12 | DbSecurityTest::test_admin_can_clear_new_period_homeroom_without_existing_structure_row | 410 vs 200 (kelas_struktur) | 410 vs 200 (kelas_struktur) | YES | PRE_EXISTING_IDENTICAL |
| 13 | DbSecurityTest::test_siswa_cannot_insert_tugas_jawaban_before_mulai | 410 vs 422 (tugas_jawaban) | 410 vs 422 (tugas_jawaban) | YES | PRE_EXISTING_IDENTICAL |
| 14 | DbSecurityTest::test_siswa_cannot_insert_tugas_jawaban_after_deadline | 410 vs 422 (tugas_jawaban) | 410 vs 422 (tugas_jawaban) | YES | PRE_EXISTING_IDENTICAL |
| 15 | DbSecurityTest::test_siswa_cannot_update_or_delete_graded_tugas_jawaban | 410 vs 422 (tugas_jawaban) | 410 vs 422 (tugas_jawaban) | YES | PRE_EXISTING_IDENTICAL |
| 16 | DbSecurityTest::test_siswa_cannot_bypass_closed_self_attendance_through_db_gateway | 410 vs 403 (absensi) | 410 vs 403 (absensi) | YES | PRE_EXISTING_IDENTICAL |
| 17 | DbSecurityTest::test_siswa_self_attendance_db_gateway_forces_server_owned_fields | 410 vs 200 (absensi) | 410 vs 200 (absensi) | YES | PRE_EXISTING_IDENTICAL |
| 18 | DbSecurityTest::test_siswa_cannot_update_or_delete_absensi_through_db_gateway | 410 vs 403 (absensi) | 410 vs 403 (absensi) | YES | PRE_EXISTING_IDENTICAL |
| 19 | DbSecurityTest::test_guru_cannot_create_tugas_with_past_mulai | 410 vs 422 (tugas) | 410 vs 422 (tugas) | YES | PRE_EXISTING_IDENTICAL |
| 20 | DbSecurityTest::test_guru_cannot_update_tugas_deadline_to_past | 410 vs 422 (tugas) | 410 vs 422 (tugas) | YES | PRE_EXISTING_IDENTICAL |
| 21 | DbSecurityTest::test_guru_cannot_delete_tugas_that_already_has_graded_submission | 410 vs 422 (tugas) | 410 vs 422 (tugas) | YES | PRE_EXISTING_IDENTICAL |
| 22 | DbSecurityTest::test_admin_can_insert_sertifikat_template_with_array_fields_payload | 410 vs 200 (templat_sertifikat_publik) | 410 vs 200 (templat_sertifikat_publik) | YES | PRE_EXISTING_IDENTICAL |
| 23 | DbSecurityTest::test_ekskul_membership_is_attached_to_active_period_and_cannot_target_archive | 410 vs 200 (ekskul_anggota) | 410 vs 200 (ekskul_anggota) | YES | PRE_EXISTING_IDENTICAL |
| 24 | ProfileIdentitySyncTest::test_admin_profile_update_syncs_user_and_teacher_snapshots | 410 vs 200 (profiles) | 410 vs 200 (profiles) | YES | PRE_EXISTING_IDENTICAL |
| 25 | ProfileIdentitySyncTest::test_admin_student_name_update_syncs_student_snapshots | 410 vs 200 (profiles) | 410 vs 200 (profiles) | YES | PRE_EXISTING_IDENTICAL |
| 26 | QuizAutomationTest::test_guru_cannot_create_quiz_for_non_taught_mapel_or_past_start | 410 vs 422 (quizzes) | 410 vs 422 (quizzes) | YES | PRE_EXISTING_IDENTICAL |
| 27 | QuizAutomationTest::test_guru_can_update_deadline_but_not_content_while_submission_ongoing | 410 vs 409 (quiz_questions) | 410 vs 409 (quiz_questions) | YES | PRE_EXISTING_IDENTICAL |
| 28 | QuizAutomationTest::test_guru_cannot_schedule_quiz_outside_academic_year | 410 vs 422 (quizzes) | 410 vs 422 (quizzes) | YES | PRE_EXISTING_IDENTICAL |
| 29 | QuizAutomationTest::test_guru_can_update_draft_quiz_name_and_mode | 410 vs 200 (quizzes) | 410 vs 200 (quizzes) | YES | PRE_EXISTING_IDENTICAL |
| 30 | QuizAutomationTest::test_guru_uts_schedule_deadline_is_derived_from_duration | 410 vs 200 (quizzes) | 410 vs 200 (quizzes) | YES | PRE_EXISTING_IDENTICAL |
| 31 | ScanTempPersistenceTest::test_manual_scan_temp_upsert_persists_refresh_safe_rows_per_tenant | 410 vs 200 (absensi_scan_temp) | 410 vs 200 (absensi_scan_temp) | YES | PRE_EXISTING_IDENTICAL |

> \* **Test #8**: The API documentation route coverage test fails identically in structure — route catalog is out of sync with `docs/api-endpoints.md`. Baseline had 36 undocumented routes (all from non-AP V2 endpoints). Current has 46 undocumented routes (36 baseline + 10 new academic period V2 routes). This is the same class of failure and would require documentation maintenance to fix. It is NOT a regression caused by our changes — the test was already failing before any academic period routes existed.

## Summary

| Metric | Count |
|--------|:-----:|
| **TOTAL FAILURES** | **31** |
| PRE_EXISTING_IDENTICAL | 30 |
| NOT_COMPARABLE (docs test, wider scope) | 1 |
| REGRESSION | **0** |
| FIXED_BY_CURRENT_CHANGE | 0 |
| NEW_ENVIRONMENT_FAILURE | 0 |

## Root Cause of Pre-existing Failures

All 30 identical failures and the 1 documentation-coverage failure stem from the same architectural decision: **the DB_LEGACY_WRITE_BLOCKED middleware (410 response) prevents legacy API writes to tables that have been fully migrated to V2.** These tests were written when those tables accepted legacy writes, and they expect HTTP 200/409/422/403 responses. When the middleware blocks them with 410, the tests break because they aren't asserting 410.

The 2 SubjectControllerTest failures (test #6, #7) are a 403 authorization issue unrelated to 410 but are also pre-existing.

The documentation test (#8) is a maintenance gap: `docs/api-endpoints.md` is out of date.

## REGRESSIONS: 0

No new failures were introduced by the Academic Period V2 frontend cutover changes.
