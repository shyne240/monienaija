# Institutional Phase 1 remains blocked: SQL checker forgery

> **SUPERSEDED — historical record.** This document describes a state that has since been
> resolved and is retained for provenance only. It is **not** current acceptance evidence.
> Current status and results: [INSTITUTIONAL-CONSOLIDATION-STATUS.md](INSTITUTIONAL-CONSOLIDATION-STATUS.md).
> Phases 1–5 are accepted at the local/disposable-PostgreSQL level (Phase 1 `2cfeda6`,
> Phase 5 `a52602d`). Do not cite this file as evidence of the current implementation.

The institutional application candidate is durably committed as **unaccepted WIP** `8290c9194d6a088be886c5c71404538c7e84c9bb`. The last accepted application baseline remains `1acdf5085c77b3b299dea24f2b3eed614efeb8a1`. The source candidate was recovered from the `11d745e` patch after another sandbox reset; the pre-existing dirty checkout was separately stashed locally (`661597e2fc6c961166ae18a1d90bbaa8b56583c6`). Local stashes are not assumed durable. No main merge, deployment, live provider calls or real financial transactions occurred.

## Confirmed blocker

The shared application database connection can directly update a requested institutional lifecycle approval to `APPROVED`, provide any distinct `approved_by` string, update it to `CONSUMED`, then perform the matching institution transition in the same transaction. The candidate 0500 triggers accept the transaction and write execution evidence despite there being **no authenticated checker or MFA verification**. `approved_by` being different from the requester and `required_assurance = 'MFA'` are merely mutable database fields, not proof of checker authentication. The existing `PrivilegedActionApprovalService` performs its real checker role, scope and MFA checks in application code before it writes those same fields; direct SQL bypasses those checks. This is database-write access, not an unauthenticated HTTP exploit.

Two retained negative integration tests demonstrate the defect:

1. `rejects direct SQL forging of checker approval and institutional execution by the application connection`: disposable test application connection, transaction committed instead of throwing (`instrole1`: 1 failed, 27 skipped).
2. `rejects checker forgery by a non-owner SQL role with application DML privileges`: a fresh disposable `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE` role, granted schema usage and table SELECT/INSERT/UPDATE/DELETE, also committed instead of throwing (`instrole2`: 1 failed, 28 skipped). The test always revokes/drops the role in `finally`.

The test harness supplies the same TypeORM DataSource/`DB_USER` to the application. In the disposable embedded cluster, querying `pg_roles` showed `current_user = monienaija`, `rolsuper = true`, `rolcreaterole = true`, `rolcreatedb = true`, and the database owner is `monienaija`. The repository's local `docker-compose.yml` also sets `POSTGRES_USER` from `DB_USER`; this must not be mistaken for evidence of any production role configuration. A PostgreSQL superuser or table owner can bypass trigger governance by DDL, so the actual deployment role and ownership separation must be independently established. Merely testing under the disposable owner cannot prove a least-privileged production boundary.

Because all backend requests currently share one SQL role, restricting ordinary SQL writes while allowing the same role to assert any checker identity does not independently authenticate the checker. A real fix requires a protected, independently authenticated checker/approval authority and an appropriately restricted non-owner application role, with a reviewed threat model and provisioning. A session variable or self-declared approver string writable by the same SQL role is not proof. The current request rules out unrelated general governance redesign, and no actual deployment role, authentication boundary or privileged provisioning contract is present in the repository. Do not claim this defect is fixed or bypass the negative tests. Migration or application-role changes require care to preserve legitimate approved workflows and the existing MFA/maker-checker contract.

## Additional checks from this continuation

- `instrole3`: 2 passed, 29 skipped, 31 total. Legitimate Unicode, quotes, backslash, newline and tab affiliation payloads passed the JavaScript/SQL evidence digest path; changed reason was rejected. A replay after a later transfer returned the original execution snapshot and left the transferred affiliation active. This is representative coverage, not proof of all supported or historical canonical forms.
- `instrole4`: focused foundation and migration-chain suites: 1 failed, 1 passed; **49 passed, 2 failed, 51 total**. The only failures were the two checker-forgery tests above. Fresh migration and the existing 0400-to-0500 historical test passed.
- `instrole5`: final broader targeted PostgreSQL matrix: **6 passed, 1 failed suites; 139 passed, 2 failed tests, 141 total**. Wallet ownership, a8/a19/a20, migration-chain and readiness-sync passed; the foundation suite failed those same two direct-SQL tests. No skips.
- `instorder1`: a disposable source-pinned schema-only ordering probe passed **2/2**: 0400 → 0401 → 0500, and 0400 → 0500 → 0401. Both recorded the expected executed names and exposed both expected tables. This is not Phase 2 functional, historical-data, ledger isolation or readiness acceptance, and does not establish that all future integrations may safely run out of timestamp order.
- `instorder1` copied the unchanged 0401 migration from `1cf6ac75b18a2af68dfbd33389d1f2e5fb7f32f2` only into a temporary test-support file. The probe is retained as [plain text](phase2-order-probe.spec.txt): in a disposable clean test workspace, place it at `test/temporary-institution-order.integration.spec.ts`, obtain the source migration via `git show 1cf6ac75b18a2af68dfbd33389d1f2e5fb7f32f2:src/migrations/1785753600401-CreateInstitutionalFinancialOwnership.ts > test/support/temporary-phase2-0401.ts`, run that one Jest integration file with the established disposable PostgreSQL safety settings, then remove the two temporary files. Neither 0401 nor Phase 2 was integrated by this probe.

## Status

Phase 1 is **NOT ACCEPTED**. Full legacy affiliation/approval upgrade and canonicalization cases, independent role-boundary security, lifecycle/affiliation concurrency, the final integration registry and readiness still require completion. Phases 2–5 and the final full regression matrix are **NOT VERIFIED**. Do not advance the accepted baseline or label this WIP production-ready. The failing tests are intentionally retained, not skipped or weakened.
