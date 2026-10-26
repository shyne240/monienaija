# V1-ADMINISTRATOR-ROLE-AND-ASSIGNMENT-IMPLEMENTATION-01 — Implementation Report

Implements the ADMINISTRATOR role and its approved delegated role-assignment authority per
`docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-01.md` and
`docs/V1/V1-ADMIN-ADMINISTRATOR-GOVERNANCE-DECISIONS-01.md`.

## 1. Summary

- Added an 11th role, `ADMINISTRATOR`, to the function-level authorization catalogue
  (`authorization_roles` / `authorization_role_functions`), built strictly from function grants
  that already existed in the catalogue, plus two new, narrowly-scoped functions
  (`workforce.role.assign_operational`, `workforce.role.revoke_operational`).
- Removed the legacy hard-coded 4-role assignment limit by adding a new, dedicated
  ADMINISTRATOR-initiated direct-EXECUTE assignment path for exactly the six approved operational
  roles (`OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`,
  `TREASURY`). This path is structurally distinct from the pre-existing SUPER_ADMIN/Finance
  maker-checker path, which is untouched.
- Added a real database-level (PostgreSQL `CHECK` constraint) restriction — not merely an
  application-level check — that makes it physically impossible for any row tagged as an
  ADMINISTRATOR-initiated assignment to ever name `SUPER_ADMIN` or any `FINANCE_*` role, regardless
  of application bugs, catalogue misconfiguration, or direct SQL access.
- ADMINISTRATOR's own grant/revoke remains exclusively SUPER_ADMIN-gated, using the same
  maker/checker machinery the three Finance roles already use (own-assignment is categorically
  different from the operational-role delegation ADMINISTRATOR performs on others).
- No new unrestricted route was added; no existing authn/authz check was weakened; self-assignment
  and self-escalation protections are preserved and independently tested.
- No second source of truth was introduced: the catalogue (`authorization_roles` /
  `authorization_role_functions`) remains the sole authority for what a role can *do*; the
  `a2_finance_role_assignments` table (with its new `initiated_scope` column/constraints) remains
  the sole authority for *who holds which role*; `A2WorkforceSessionService.resolve()` continues to
  join the two fresh on every request — no caching, no duplicated role list.

## 2. Changed files

### Implementation
| File | Change |
|---|---|
| `src/migrations/1785753600085-AddAdministratorRoleAssignmentScope.ts` (new) | Adds `a2_finance_role_assignments.initiated_scope` column (`VARCHAR(32)`, default `'SUPER_ADMIN_SCOPE'`) and two `CHECK` constraints: `chk_a2_finance_assignment_initiated_scope` (value must be `'SUPER_ADMIN_SCOPE'` or `'ADMINISTRATOR_SCOPE'`) and `chk_administrator_scope_role_allowlist` (`'ADMINISTRATOR_SCOPE'` rows may only name one of the six operational roles). Reversible `down()` provided. |
| `src/authorization/workforce-authentication.entity.ts` | Mirrors the migration: adds `initiatedScope` column + the two `@Check(...)` decorators on `A2FinanceRoleAssignment`. |
| `src/authorization-catalogue/authorization-catalogue.seed.ts` | Adds `workforce.role.assign_operational` / `workforce.role.revoke_operational` functions (direct-EXECUTE, no maker/checker metadata — deliberately distinct function codes from `workforce.role.assign`/`.revoke`, which stay SUPER_ADMIN/Finance-maker-checker-only). Adds the `ADMINISTRATOR` role definition and its exactly-9-function grant set (see §4). Grants `SUPER_ADMIN` the two new functions too (strict superset, per Decision 2). |
| `src/authorization/finance-role-administration.service.ts` | Exports `ADMINISTRATOR_OPERATIONAL_ROLE_KEYS` (the six-role allow-list, kept manually in sync with the DB CHECK constraint — the DB constraint is the backstop, not a duplicate control). Adds `ADMINISTRATOR` to `INITIAL_BOOTSTRAP_ASSIGNABLE_ROLES` (SUPER_ADMIN-only first assignment, same as the three Finance roles). Routes `assign()`/`revoke()` to new private `assignOperational()`/`revokeOperational()` methods whenever `roleKey` is one of the six operational roles — these never touch the legacy Finance maker/checker rule lookup. `validateCommand()` is now async and additionally recognizes roles defined only in the catalogue (not in the legacy `A2_FINANCE_ROLES_JSON` vocabulary) via `AuthorizationCatalogueRuntimeService`; `SUPER_ADMIN` remains unconditionally rejected regardless of source. `persist()` generalized to accept an `auditAction` and `initiatedScope` tag so one insert/audit implementation serves both paths. |
| `src/authorization/workforce-administration.controller.ts` | Assign/revoke endpoints branch on `ADMINISTRATOR_OPERATIONAL_ROLE_KEYS`: operational roles require the `workforce.role.assign_operational`/`.revoke_operational` catalogue function (via `AuthorizationService.requireFunction()`); all other roles continue through the existing `FINANCE_ROLE_ASSIGN`/`FINANCE_ROLE_REVOKE` maker/checker-gated path, unchanged. |
| `src/authorization/workforce-configuration.ts` | `REQUIRED_ROLES` extended from 4 to 5 (`ADMINISTRATOR` added) because ADMINISTRATOR's *own* assignment needs this legacy scope-compatibility vocabulary (SUPER_ADMIN-gated, like the three Finance roles); the six operational roles deliberately get no entry here (no legacy scope/maker-checker/rate-limit semantics — role membership for them is catalogue-only). `A2_FINANCE_ROLES_JSON` schema bound changed from exactly 4 to exactly 5 entries. |
| `src/production/production-readiness.service.ts` | `EXPECTED_MIGRATION_TIMESTAMP`/`EXPECTED_MIGRATION_NAME` updated to the new latest migration (`1785753600085` / `AddAdministratorRoleAssignmentScope1785753600085`), keeping the fail-closed migration-sync check aligned (verified by `v1-release-01-production-readiness-migration-sync.integration.spec.ts`). |
| `docs/deployment/config/v1-workforce-bootstrap.env.template` | `A2_FINANCE_ROLES_JSON` gains the fifth (`ADMINISTRATOR`) role entry (all capability flags `false`, no `applicableActions` — it carries no legacy scope semantics of its own, only its *own* assignment uses this vocabulary). Comment block updated to explain the five-role/six-operational-role split. `A2_MAKER_CHECKER_RULES_JSON` unchanged (still exactly 3 required rules; ADMINISTRATOR's own assignment reuses the existing `FINANCE_ROLE_ASSIGN`/`FINANCE_ROLE_REVOKE` rules rather than needing a fourth). |

### Tests updated for the new 11th role / 5th legacy-vocabulary role / 86th migration
`test/v1-workforce-bootstrap-01.integration.spec.ts`, `test/a2-workforce-configuration.spec.ts`,
`test/a2-workforce-session.integration.spec.ts`, `test/v1-admin-authorization-foundation-01.integration.spec.ts`,
`test/v1-admin-authorization-hardening-01.integration.spec.ts`, `test/v1-capability-registry.integration.spec.ts`,
`test/production-readiness.spec.ts`, and ten further integration specs that assert the total migration
count or the latest migration's identifying timestamp (`a17`/`a18`/`a19`/`a20`/`a8` agent specs,
`v1-001`/`v1-003`/`v1-005`/`v1-006`/`v1-007`, `v1-hardening-07`/`v1-hardening-09`,
`v1-limit-01`/`v1-limit-02`/`v1-limit-03`) — all updated to expect 86 migrations (was 85) and/or
the new latest-migration identifier, consistent with the new additive migration.

### New test file
`test/v1-administrator-role-and-assignment-implementation-01.integration.spec.ts` — 38 tests across
12 `describe` blocks, one per required category (see §5).

## 3. Final 11-role seed (summary)

`SUPER_ADMIN`, `OPERATIONS`, `AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`,
`CUSTOMER_SERVICE`, `TREASURY`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` (all
unchanged from prior tasks) plus the new **`ADMINISTRATOR`** role.

**ADMINISTRATOR's exact function grants (9 total, all pre-existing functions except the two new
operational-assignment functions added alongside it):**

| Function | Access | Rationale |
|---|---|---|
| `workforce.user.view` | VIEW | read workforce user identities |
| `workforce.user.create` | EXECUTE | provision workforce users (within boundaries) |
| `workforce.user.suspend` | EXECUTE | suspend/disable workforce users |
| `workforce.role.view` | VIEW | read role assignments |
| `workforce.role.assign_operational` | EXECUTE | assign exactly the six operational roles (new, dedicated function) |
| `workforce.role.revoke_operational` | EXECUTE | revoke exactly the six operational roles (new, dedicated function) |
| `customer.view` | VIEW | operational read |
| `agent.view` | VIEW | operational read |
| `aggregator.view` | VIEW | operational read |

**Explicitly excluded (verified absent):** `workforce.role.create`, `workforce.role.modify`,
`workforce.role.assign`, `workforce.role.revoke` (the SUPER_ADMIN/Finance-scope maker/checker
functions — unscoped, would implicitly include SUPER_ADMIN/Finance roles), any `ledger.*`
post/reverse/adjust/approve function, any `finance.control_policy.*` function, `kyc.approve`,
`kyc.reject`, `compliance.manage_case`, `compliance.manage_risk_profile`,
`risk_fraud.manage_fraud_case`.

## 4. Assignment authorization matrix

| Actor role | Can assign/revoke | Mechanism | Second approver |
|---|---|---|---|
| `SUPER_ADMIN` | Any of the 6 operational roles | direct EXECUTE (`workforce.role.assign_operational`/`.revoke_operational`) | none |
| `SUPER_ADMIN` | `ADMINISTRATOR`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR` | legacy `FINANCE_ROLE_ASSIGN`/`FINANCE_ROLE_REVOKE` maker/checker rule | `FINANCE_CONTROLLER` (except the very first bootstrap assignment of each) |
| `SUPER_ADMIN` | `SUPER_ADMIN` | **not permitted** (unconditionally rejected in `validateCommand`) | n/a |
| `ADMINISTRATOR` | Any of the 6 operational roles, **for another principal** | direct EXECUTE (`workforce.role.assign_operational`/`.revoke_operational`) | none (direct-EXECUTE by design — Decision 2) |
| `ADMINISTRATOR` | Own role (any role, including operational roles, on itself) | **not permitted** — self-assignment/self-revocation guard fires before role-type dispatch | n/a |
| `ADMINISTRATOR` | `SUPER_ADMIN` | **not permitted** — hard-rejected in `validateCommand()`; also DB-CHECK-impossible | n/a |
| `ADMINISTRATOR` | `FINANCE_PREPARER`/`FINANCE_CONTROLLER`/`FINANCE_AUDITOR` | **not permitted** — not in `ADMINISTRATOR_OPERATIONAL_ROLE_KEYS`, falls through to the legacy maker/checker path where `ADMINISTRATOR` is not a listed `initiatingRole` | n/a |
| `ADMINISTRATOR` | `ADMINISTRATOR` (granting the role itself to someone else) | **not permitted** — not an operational role, not a legacy `initiatingRole` | n/a |
| Any other role (`FINANCE_AUDITOR`, operational roles, etc.) | Anything | **not permitted** — denied at the controller (`requireFunction`) and/or service layer | n/a |
| Unauthenticated | Anything | 401 | n/a |

## 5. DB-enforced restrictions

- **Column:** `a2_finance_role_assignments.initiated_scope VARCHAR(32) NOT NULL DEFAULT 'SUPER_ADMIN_SCOPE'`, set once at insert time by the service layer and never updated afterwards.
- **`chk_a2_finance_assignment_initiated_scope`:** `initiated_scope IN ('SUPER_ADMIN_SCOPE','ADMINISTRATOR_SCOPE')`.
- **`chk_administrator_scope_role_allowlist`:** `initiated_scope <> 'ADMINISTRATOR_SCOPE' OR role_key IN ('OPERATIONS','AGENT_NETWORK_MANAGER','COMPLIANCE','RISK_FRAUD','CUSTOMER_SERVICE','TREASURY')`.
- Because `a2_finance_role_assignments.role_key` has no foreign key to the catalogue (confirmed by inspection before design), this constraint pair is a self-contained, table-local guarantee — the same guarantee *class* as the existing `fn_authorization_enforce_finance_class_restriction()` trigger on `authorization_role_functions`, reproduced in simpler form fit for this table's actual shape. It holds even if `ADMINISTRATOR_OPERATIONAL_ROLE_KEYS` in TypeScript were ever wrong, the catalogue were misconfigured, or a row were inserted via raw SQL — proven directly by category-5 tests (`INSERT ... initiated_scope='ADMINISTRATOR_SCOPE', role_key='SUPER_ADMIN'` / `'FINANCE_PREPARER'` / `'FINANCE_CONTROLLER'` / `'FINANCE_AUDITOR'` all reject; the six operational roles with `'ADMINISTRATOR_SCOPE'` succeed; `'SUPER_ADMIN_SCOPE'` rows are unrestricted as before).

## 6. Audit behavior

- `ADMINISTRATOR`-initiated operational assignments/revocations record `audit_events` rows with
  `action = 'WORKFORCE_ROLE_ASSIGN_OPERATIONAL'` / `'WORKFORCE_ROLE_REVOKED_OPERATIONAL'`,
  `entityType = 'A2_FINANCE_ROLE_ASSIGNMENT'`, `actor` = the acting ADMINISTRATOR's `principalId`,
  and `newValues` containing `targetPrincipalId`, `roleKey`, `initiatedScope`, plus (for
  assignment) `scopes`/`effectiveFrom`/`effectiveTo` — correlation/request IDs are populated the
  same way as every other audited action in this service. Verified directly against real
  `audit_events` rows in category-10 tests.
- All pre-existing Finance-role audit behavior (`FINANCE_ROLE_ASSIGNED` etc.) is unchanged — the
  `persist()` method was generalized to take the action name as a parameter rather than having its
  mechanics duplicated.

## 7. Test results (all run this session, PostgreSQL-backed where applicable)

### New required test file (standalone)
`test/v1-administrator-role-and-assignment-implementation-01.integration.spec.ts`:
**38/38 passed**, covering all 12 required categories (seed correctness; delegated assignment of
all 6 operational roles via real HTTP; self-assignment/self-escalation protection; ADMINISTRATOR
denied SUPER_ADMIN/Finance grants; DB CHECK-constraint enforcement via raw SQL; SUPER_ADMIN-only
ADMINISTRATOR grant/revoke; auth boundary 401/403; FINANCE_AUDITOR denied operational authority;
existing Finance maker/checker safeguards intact; audit trail actor/target correctness; live
revocation effect on an already-issued token; concurrency/race safety).

### Full PostgreSQL integration suite
```
npm run test:pg
=== PG integration suite: 7 batch(es), 101 files, concurrency=2 — all passed ===
```
Aggregate across all 7 batches: **101/101 test files passed, 1937/1937 tests passed** (772.9s wall
time). This includes the new file and all 10 integration suites updated for the 85→86 migration
count, plus every pre-existing suite in the repository (customer, agent, commercial, KYC, admin
authorization foundation/hardening/KYC, workforce bootstrap, capability registry, production
readiness, etc.) — no regressions.

One real defect was found and fixed during this run: `test/v1-capability-registry.integration.spec.ts`
had already been edited (in an earlier session) to expect the new migration's identifying
timestamp as the *latest* migration, but its total-migration-count assertion had been left at the
old value (85) instead of the new value (86) produced by adding
`1785753600085-AddAdministratorRoleAssignmentScope.ts`. Fixed by updating both count assertions to
86; re-verified both standalone (22/22 passed) and as part of the full suite re-run.

### Full backend unit test suite (non-PG)
```
npm run test
Test Suites: 174 passed, 174 total
Tests:       1823 passed, 1823 total
```

### Typecheck
```
./node_modules/.bin/tsc --noEmit -p tsconfig.json
```
Clean, no errors.

### Build
```
npm run build   (nest build)
```
Clean, exit code 0.

## 8. Known gaps / explicitly out of scope (unchanged from governance docs)

- The offline SUPER_ADMIN recovery ceremony (Decision 3) is not implemented — out of scope for this task.
- Role-definition create/modify workflows and their approval process (Decision 1) are not implemented — `workforce.role.create`/`.modify` remain `FUTURE`/unassigned to any role, including SUPER_ADMIN, exactly as before this task.
- Admin Web UI for workforce administration is not addressed by this task; this is a backend API implementation only, and no claim is made about Admin Web readiness.
- `ADMINISTRATOR`'s legacy-vocabulary `scopes` array in `A2_FINANCE_ROLES_JSON` is intentionally empty (`[]`) — it carries no legacy `privileged:*`/`finance:*` scope semantics of its own; all of its actual authority is catalogue-governed, resolved fresh by `A2WorkforceSessionService.resolve()` on every request, independent of this legacy configuration file.
