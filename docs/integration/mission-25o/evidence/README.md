# Mission 25O — final verification evidence

These files describe **new runs against implementation commit** `3a0f87eafe86b455e1906d7779f83ca3152b9d00`. The later handover/evidence-only commit does not change the tested source. Earlier Mission 25O raw logs did not survive checkout restoration and are not treated as this evidence. An earlier full PostgreSQL run preceded the last added TTL/cancellation test and is not a full-matrix pass for this implementation.

## Isolation and collection

- Dependencies were installed with `npm ci --ignore-scripts --no-audit --no-fund`; only the package-local embedded PostgreSQL symlinks were then hydrated explicitly. The database was a new, disposable PostgreSQL 18.4 cluster listening only on loopback, outside the checkout. No production database, credentials or keys were used.
- PostgreSQL tests loaded `.env.example` defaults plus its synthetic local workforce fixture (including the fifth `ADMINISTRATOR` role), the required database/migration defaults, and distinct synthetic 32-byte AES and binding keys. The existing `test/support/mission-25c-network-guard.cjs` blocked non-loopback egress. Provider transports in these tests were synthetic/fake; no live vendor traffic was permitted.
- Unit tests used the network guard without the PostgreSQL environment preload to avoid changing unit-test assumptions. Expensive test runs were sequential; the repository PostgreSQL runner used 6 files per batch and at most 2 concurrent batches. Each batch used its own dedicated test databases and the runner's namespace.
- Text evidence is deliberately an allowlist of commands, implementation SHA, test file names, aggregate counts and exits. Application logs, request/response contents, credentials, environment values and stack traces are discarded rather than committed. Jest JSON is reduced to file statuses and numeric counts; the raw JSON is deleted. PostgreSQL aggregate counts are derived from the sanitized runner summaries and checked against independently discovered test files.
- `unit-preflight.txt`/`unit-preflight-summary.json` record a harness invocation with an incorrect config path; it failed before running a suite and was corrected. `postgres-matrix-preflight.txt` records an intentionally interrupted start before completion, stopped to add the missing synthetic binding/AES fixture; it is not counted as a pass. The final runs are recorded separately.

## Files

- `typecheck.txt`, `build.txt`: exit status for TypeScript and the Nest build.
- `unit.txt`, `unit-summary.json`: complete backend unit run and machine-readable per-file status/counts.
- `postgres-matrix.txt`, `postgres-matrix-summary.json`, `postgres-cleanup.txt`: complete real-PostgreSQL matrix, batch/aggregate counts, discovered-file completeness check and post-test cleanup result.
- `h07-provider-readiness.*`: focused H-07, readiness race, maker/checker, provider configuration, clean migration/readiness and upgrade regression.
- `security-finance-agent-*.{txt,json}`: focused preference, workforce session/revocation, Ordinary Agent V1, ledger, settlement, PIN and notification reliability regression.
- `eslint-*.{txt,json}`: changed-file lint and parent-baseline comparison; this does not claim that repository-wide lint is clean.
- `test-summary.json`: consolidated results and paths. `preservation.json`: preservation identifiers, inventory counts and external-backup verification.
