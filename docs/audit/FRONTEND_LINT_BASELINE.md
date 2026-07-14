# Frontend Lint Baseline

- Date: 2026-07-14 (Asia/Jakarta)
- Initial commit: `45d8583f`
- Safety snapshot: `stash@{0}`
- Command: `npm run lint` (`eslint .` with the repository flat config)
- Policy: baseline debt is visible and cannot be used to claim full lint PASS

## Metrics

| Metric | Initial observed baseline | After Phase 0 changed-file cleanup | Status |
|---|---:|---:|---|
| Errors | 196 | 170 | IMPROVED_BASELINE |
| Warnings | 70 | 70 | UNCHANGED |
| Phase 0 changed-file errors | 23 | 0 | PASS |
| Phase 0 changed-file warnings | 10 | 10 | KNOWN_WARNINGS |

The initial baseline was captured after correcting ESLint scope and browser/test
globals, while the original mixed Phase 0/Phase 3 worktree was present. Phase 0
then removed errors only in files it needed to modify. It did not apply a
repository-wide lint rewrite.

## Most frequent findings after Phase 0

| Rule/category | Findings |
|---|---:|
| `no-unused-vars` | 111 |
| `react-hooks/exhaustive-deps` | 58 |
| `no-empty` | 24 |
| Rule-less/unused directive findings | 12 |
| `no-constant-binary-expression` | 11 |
| `no-useless-catch` | 9 |
| `no-useless-escape` | 8 |
| `no-undef` | 4 |
| `no-control-regex` | 2 |

## Files with the most findings after Phase 0

| File | Errors | Warnings |
|---|---:|---:|
| `src/pages/guru/Laporan.jsx` | 20 | 3 |
| `src/pages/admin/Home.jsx` | 16 | 6 |
| `src/pages/admin/StorageManager.jsx` | 15 | 7 |
| `src/pages/admin/Kelas.jsx` | 9 | 5 |
| `src/pages/admin/Guru.jsx` | 9 | 3 |
| `src/pages/guru/TugasGuru.jsx` | 6 | 5 |
| `src/lib/supabase.js` | 8 | 1 |
| `src/pages/siswa/Tugas.jsx` | 5 | 4 |
| `src/pages/admin/pengaturan.jsx` | 7 | 1 |
| `src/pages/siswa/Home.jsx` | 7 | 1 |

## Temporary Phase 0 gate

Phase 0 accepts full lint as `KNOWN_BASELINE_DEBT` or
`IMPROVED_BASELINE` only when all of the following hold:

1. Changed JavaScript/JSX/TypeScript files have zero lint errors.
2. Repository errors do not exceed 196.
3. Repository warnings do not exceed 70 without an explicit explanation.
4. No global ESLint disable or important-rule suppression is introduced.
5. Deleted native source is no longer linted.

This is not the production target. Before `READY_FOR_PRODUCTION`, the repository
must reach zero lint errors and every accepted warning must be documented.

## Remediation plan

1. Remove unused imports/dead helpers one domain at a time with focused tests.
2. Replace silent empty catches with explicit best-effort comments or safe error
   handling.
3. Review hook dependencies by feature instead of bulk auto-fixing behavior.
4. Correct constant expressions and parser findings before performance work.
5. Add changed-file lint to CI immediately; lower the full-repository ceiling
   after each domain cleanup until it reaches zero.
