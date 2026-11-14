# Protected checker authority — WIP record (superseded by the implementation)

> **SUPERSEDED — historical record.** This document describes a state that has since been
> resolved and is retained for provenance only. It is **not** current acceptance evidence.
> Current status and results: [INSTITUTIONAL-CONSOLIDATION-STATUS.md](INSTITUTIONAL-CONSOLIDATION-STATUS.md).
> Phases 1–5 are accepted at the local/disposable-PostgreSQL level (Phase 1 `2cfeda6`,
> Phase 5 `a52602d`). Do not cite this file as evidence of the current implementation.

> **Status: implemented.** The boundary described here as missing is now implemented by migration
> `1785753600501-ProtectedAuthorityBoundary`, the `ProtectedAuthorityModule`/authority credential,
> and `scripts/provision-database-roles.js`. See `PROTECTED-AUTHORITY.md` for the accepted design,
> provisioning, readiness and test evidence. This file is retained as the reproduction/decision
> history that led to it; statements below that describe "not implemented" are historical.

> **Historical WIP statement (no longer current):** at the time of this record the required protected checker authority and least-privilege runtime role model were not implemented, the failing direct-SQL reproductions were retained, and production readiness was an interim interlock. That interlock has now been replaced by verification of the implemented boundary (see `PROTECTED-AUTHORITY.md` §5).

## Trust boundary at the time of this record

- The ordinary application is configured with one TypeORM `DataSource` using `DB_USER`/`DB_PASSWORD`; `src/config/data-source.ts` also uses that configuration for migrations. The repository's local Docker setup derives PostgreSQL's initial `POSTGRES_USER` from `DB_USER`. The local disposable test user was a database owner and superuser. Actual production roles, privileges and provisioning are **NOT VERIFIED**.
- Workforce OIDC validation verifies the external signed identity assertion and recent MFA before `A2WorkforceSessionService.establish` creates a random bearer token and stores its hash with principal, MFA evidence and session expiry in `a2_workforce_sessions`. Subsequent bearer validation trusts those mutable rows and resolves current roles from `a2_finance_role_assignments` and the authorization catalogue. Other supported local administration identity paths also reach the workforce-session service. The stored assertion evidence is a summary, not an independently re-verifiable signed assertion.
- The ordinary application connection currently writes workforce sessions, role assignments and `privileged_action_approvals`. `PrivilegedActionApprovalService` enforces action roles, scopes, maker/checker separation and MFA in application code, then writes the approval decision to that same database. A role which can update those rows can bypass or impersonate that authority; a role which can alter protected tables, disable triggers or replace functions can also bypass database protections.
- A separately protected approval credential alone is insufficient if it accepts a `principalId`, session ID, MFA flag or payload from ordinary DML-writable records. Those records and their entitlement/configuration dependencies must be made trustworthy, and the authority must bind the actual authenticated checker and verified MFA, action, approval, approved fingerprint, expiry and single use. An app-controlled session variable or publicly callable definer function does not establish authority.
- Compromised ordinary SQL credentials must not be able to alter checker/session/role authority or protected evidence, assume privileged roles, change schema or bypass single-use governance. An authenticated checker must pass real workforce verification and authorization. A separate protected component or credential has to be provisioned independently and kept out of ordinary DB credentials. Migration/schema administration must be separately provisioned. These protections do not claim resistance to full application-process compromise, protected-authority compromise, database owners or superusers; such actors may access the protected credential, rewrite the data or disable controls.

## Reproductions and scope

The retained `99289ca` tests demonstrate direct checker forgery on the application connection and via a separate non-owner DML role. Two additional real-connection PostgreSQL reproductions were added:

1. An ephemeral `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE` connection granted only session-table `SELECT` and `UPDATE(token_hash)` replaces an active MFA checker's bearer hash. HTTP approval with the attacker-chosen token then returns 201. Role attributes are queried and asserted; the throwaway login is disconnected and dropped in `finally`.
2. An ephemeral separate non-owner login granted approval-table `SELECT` and `UPDATE(status, approved_by, approved_at)` forges the checker decision for a pending wallet ownership request. The legitimate controller execution endpoint then returns 201 and changes the synthetic wallet. This demonstrates the shared approval boundary affects the accepted wallet-ownership flow; no real financial transaction or production evidence is used.

Both are intentional negative tests and currently fail. The first shows why making only an approval-signing credential separate while leaving identity/session state writable by ordinary SQL credentials is not sufficient. The second verifies actual effect on a neighboring governed operation, not merely an approval-row write. Ledger reversal uses the same `PrivilegedActionApprovalService` and therefore has the same checker-decision trust dependency by inspection; no separate ledger exploit was executed. Its execution path currently calls approval consumption and then the reversal operation separately; transactional consequences and preservation of its existing behavior require dedicated review rather than an assumed fix.

## Interim fail-closed behavior

`ProductionReadinessService` now inspects the actual session and current database roles for superuser, role/database creation, replication and RLS bypass attributes; database/schema ownership or membership; `public` schema CREATE; and ownership/membership for a limited list of protected relations. An unsafe role or an inspection error fails production startup. This is only a preliminary **negative** privilege screen: `no_obvious_escalation` is not proof of least privilege. It does not yet validate effective object grants, `PUBLIC`, inherited protected-authority membership, function execution/search paths, separately provisioned authority credentials, all sensitive objects or the integrity of workforce state. Production also fails unconditionally with `protected_checker_authority_unavailable` even when this preliminary screen passes, because no protected authority exists yet. Non-production reports these checks as `not_evaluated`; this is not an assurance or an acceptance bypass.

## Results

- Readiness unit test: **1/1 suite, 9/9 tests**, including production authority-unavailable and role-inspection-error cases.
- Disposable PostgreSQL readiness suite after final changes: included in the combined run below, **5/5 tests**, including actual owner/superuser rejection and an actual separately logged-in non-owner role, which still fails closed because the authority is unavailable. This test role is a diagnostic fixture, not an approved provisioning template.
- Combined focused PostgreSQL run `authbound8`: **1 passed, 2 failed suites; 54 passed, 4 failed tests, 58 total**. The failures are the two prior lifecycle checker forgery tests plus the new workforce-session impersonation and wallet checker forgery tests. No skips. No security acceptance claim follows from the passing cases.
- `tsc --noEmit -p tsconfig.json`: passed after these changes. Targeted ESLint on the five changed TypeScript files also passed (the first run exposed seven lint errors, corrected before the passing run). No complete backend, ownership, institution, migration upgrade, role provisioning or consolidated regression was run in this continuation.
- Original 0400 and 0500 migration IDs remain unchanged. The earlier schema-only 0401 ordering probe remains partial evidence only. Protected authority provisioning, fresh installs, 0400/0401 historical upgrades and evidence compatibility after any future role/migration changes are **NOT VERIFIED**.

## Work still required

Implement and independently authenticate the protected authority using the existing workforce system; isolate the trusted identity/session/role state and approval evidence from the ordinary login; establish separate non-owner runtime, authority and migration roles with narrowly scoped grants; ensure immutable proof verification and transactional consumption/mutation/evidence; protect against PUBLIC/function/role escalation; and integrate the real availability and privilege assertions into readiness. Exercise separate actual database connections, authenticated checker/MFA success, negative forgery and privilege cases, historical upgrades, concurrency and rollback. Then fix the four retained failing tests, run focused wallet and ledger regressions and the Phase 1 matrix, and continue Phases 2–5 only after Phase 1 is accepted. The last accepted application baseline remains `1acdf5085c77b3b299dea24f2b3eed614efeb8a1`.
