# H-04/H-06 final verification evidence

The tested implementation is commit `377b1207905909867dbce75cf78717fa5015b90a`, with sole parent `8fa35c1d46c9afb7dbd6b3fb81049e0f4d18155d`. Test evidence and the handover are recorded in a later documentation-only child; they do not change that implementation. The implementation was non-force pushed and independently verified on the assigned branch.

## Isolation and collection

Dependencies came from the existing lockfiles (`npm ci --ignore-scripts --no-audit --no-fund`); only the package-local embedded PostgreSQL symlinks were explicitly hydrated. Tests used a new disposable PostgreSQL 18.4 instance bound to IPv4 loopback, namespaced test databases, synthetic keys and provider fixtures, and fake/console transports. The existing `test/support/mission-25c-network-guard.cjs` blocked non-loopback Node network calls. No production database, real provider credential, vendor activation or live notification was used.

PostgreSQL test processes loaded the public `.env.example` defaults and the five-role, rules and rate-limit fixtures from `docs/deployment/config/v1-workforce-bootstrap.env.template`, with test-only local database and independent synthetic encryption and binding keys. Unit tests used the network guard without that PostgreSQL environment preload. Expensive groups ran separately; the complete integration matrix used six files per batch, at most two concurrent batches and a 2048 MB Node old-space cap per batch. The full matrix independently enumerated the integration files and compared the discovered set with recorded suite results.

Evidence logs are an allowlist of commands, test-file paths, test counts, status and exit codes. Application payloads, environment values, raw request/response content and credential material are not included. Machine-readable Jest results are reduced to per-file statuses and numerical counts. Test results in focused runs overlap the complete runs and must not be summed as unique coverage.

## Files

- `preservation.json`, `implementation-inventory.txt`, `implementation-remote.json`: pre-change backup verification, exact 33-modified/6-added comparison, implementation inventory, remote commit and parent. The full verified backup is external to the repository.
- `dependency-setup.txt`, `backend-typecheck.txt`, `backend-build.txt`, `admin-typecheck.txt`, `static-checks-summary.json`: dependency and static/build results.
- `lint.txt`, `lint-summary.json`: all changed backend TypeScript files, a clean focused subset including all newly added TypeScript files, and a parent rule/severity count-profile comparison. Admin Web has no native lint script; all four changed frontend files were separately checked with an explicit overlay of the backend rules on the Admin Web TypeScript project and compared against their parent versions. No repository-wide lint-clean claim is made.
- `backend-unit.txt` and `backend-unit-summary.json`: complete backend unit run.
- `admin-notification.txt` and `admin-notification-summary.json`: Admin Web notification-management tests.
- `notification-migration.*`: H-04/H-06 governance, notification delivery, migration chain, and 102-to-103 upgrade tests.
- `h07-authorization.*`: H-07 binding, provider governance, notification authorization/diagnostics, and clean migration readiness.
- `security-agent.*`: customer-preference security, workforce revocation/session and Ordinary Agent V1 regressions.
- `finance.*`: financial execution, cash-to-cash, ledger, transfer and settlement regressions.
- `postgres-discovered-files.json`, `postgres-matrix.txt`, `postgres-matrix-summary.json`, and `postgres-matrix-progress.json`: independent discovery, sanitized matrix log, final aggregate and batch progress. A complete pass requires the final summary's `complete` flag, exit code zero, and no missing, duplicate or unexpected files.
- `postgres-cleanup.txt`: final disposable-database cleanup outcome.
- `test-summary.json`: consolidated results and evidence references.
- `final-inventory.txt`, `SHA256SUMS`: the complete implementation and evidence-file inventory, and checksums for those files other than the checksum file itself.
