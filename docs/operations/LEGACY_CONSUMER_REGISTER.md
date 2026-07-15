# Legacy Consumer Register

The canonical freeze list is
[`config/api-legacy-consumers.json`](../../config/api-legacy-consumers.json).
It records owner, operation, read/write classification, reason, migration
target, and review date for every source file that still references the
temporary compatibility boundary.

Rules:

- `/api/db` and `/api/db/batch` are temporary compatibility routes only.
- A new consumer must not be added to the register to hide a new feature.
- Every entry needs a clear V2 migration target and owner.
- V2-only services cannot call the compatibility adapter.
- The guard is a freeze mechanism, not evidence that the legacy consumer count
  is zero.

Run `npm run lint:legacy` in CI and review the output with the domain owner.
