# V1-ADMIN-AUTHORIZATION-FOUNDATION-01 — Implementation Report

**Status:** First implementation task in the authorization-modernization sequence. Builds the
database-backed FUNCTION CATALOGUE → ROLE → ROLE/FUNCTION foundation described in the two
prior, now-authoritative documents:

- `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` (function catalogue, role definitions, matrix)
- `docs/V1/V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md` (ten final Product Owner decisions)

Neither document's content is reopened, reinterpreted, or redesigned here. No new product
decisions are introduced. **This is a foundation-only task.** It does not wire the new model
into the live authorization runtime, does not implement any maker/checker workflow, and does
not touch Admin Web.

---

## 1. Scope actually implemented in this task

1. A new, additive database schema: three tables (`authorization_functions`,
   `authorization_roles`, `authorization_role_functions`), plus two PostgreSQL triggers and one
   partial unique index that enforce specific governance invariants structurally.
2. A new, standalone NestJS module (`src/authorization-catalogue/`) with TypeORM entities and an
   idempotent bootstrap seed service, registered in `app.module.ts` alongside (not inside) the
   existing `AuthorizationModule`.
3. Seed data for the exact ten approved V1 roles, the full function catalogue from the approved
   spec (including non-assignable/FUTURE/OUT_OF_V1_SCOPE entries, catalogued but not assignable),
   and the approved role→function assignment matrix.
4. A focused integration test suite (14 tests) plus bookkeeping fixes to pre-existing tests that
   hardcode "the latest migration" (a pre-existing repository pattern, unrelated to this task's
   design, that every new migration must update).
5. This report.

**Nothing in the existing A2 workforce/finance authorization runtime was modified.** The six
documented hardcoded dependencies (see §6) all remain exactly as they were before this task —
they are inventoried, not fixed, per the explicit task instructions.

---

## 2. Migration

- **New migration:** `src/migrations/1785753600083-CreateAuthorizationCatalogue.ts`
  (class `CreateAuthorizationCatalogue1785753600083`), the 84th migration in the chain
  (previous latest: `1785753600082-CreateLocalAdminAuthentication.ts`).
- The migration creates schema **only** — no seed rows are inserted by the migration itself,
  mirroring the existing convention set by
  `1785753600066-CreateCapabilityRegistry.ts` (table-creation-only migration; idempotent seed
  service performs seeding at application bootstrap). This keeps the migration deterministic,
  reviewable, and safe to re-run/rollback independent of seed-data changes.
- The migration is purely additive: it creates three new tables and touches no existing table,
  column, or constraint. `down()` drops only what `up()` created.
- Verified by running `npm run migration:run` against a real, freshly-started PostgreSQL
  instance (via the repo's `scripts/embedded-pg.js`) — the full 84-migration chain applied
  cleanly in a single run with no errors.
- Verified again via `test/migration-chain.integration.spec.ts` (16/16 passing), which boots a
  fresh database, runs every migration from empty in one atomic chain, and cross-checks that the
  TypeORM entity metadata is consistent with the migrated schema — this passed for the three new
  entities exactly as written.

### Schema created

```
authorization_functions (
  function_code VARCHAR(100) PRIMARY KEY,
  domain, name, description,
  sensitivity VARCHAR(30) CHECK IN (READ, OPERATIONAL, SENSITIVE, PRIVILEGED, CRITICAL_FINANCIAL),
  v1_status VARCHAR(30) CHECK IN (IMPLEMENTED, PARTIALLY_IMPLEMENTED, BACKEND_ONLY, FUTURE, OUT_OF_V1_SCOPE),
  assignable BOOLEAN,
  finance_class_restricted BOOLEAN,
  maker_checker_required BOOLEAN,
  approval_required BOOLEAN,
  super_admin_excluded BOOLEAN,
  auditor_visible BOOLEAN,
  notes, created_at, updated_at
)

authorization_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key VARCHAR(100) UNIQUE,         -- NOT an enum; free-form, extensible
  display_name, description,
  is_active BOOLEAN,
  is_system_seeded BOOLEAN,             -- provenance marker only, not an immutability lock
  finance_role_class BOOLEAN,
  administrative_capability BOOLEAN,    -- partial-unique-indexed: at most one TRUE row, ever
  read_only BOOLEAN,
  maker_eligible BOOLEAN,
  checker_eligible BOOLEAN,
  created_by, updated_by, created_at, updated_at
)

authorization_role_functions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID REFERENCES authorization_roles(id) ON DELETE CASCADE,
  function_code VARCHAR(100) REFERENCES authorization_functions(function_code) ON DELETE RESTRICT,
  access_type VARCHAR(20) CHECK IN (VIEW, EXECUTE, INITIATE, APPROVE),
  is_active BOOLEAN,
  assigned_by, assigned_at, created_at, updated_at,
  UNIQUE (role_id, function_code)
)
```

### Why no DB enum, no fixed role count, no immutability

- `authorization_roles.role_key` is a plain unique `VARCHAR`, not a PostgreSQL `ENUM` type and
  not constrained to any fixed list by a `CHECK (role_key IN (...))` clause. New roles can be
  added later by inserting rows — no schema change, no code change to the authorization tables
  themselves required. This directly avoids recreating the old four-role hardcoded limitation
  (`workforce-configuration.ts`'s `.min(4).max(4)` Zod bound) in a new form.
- `is_system_seeded` is a provenance/traceability flag only (distinguishes the ten bootstrap
  roles from any future admin-created role). It does not block updates, deactivation, or
  deletion of a seeded role — there is no trigger or constraint anywhere that treats the ten
  roles as special or protected. They are an **initial configuration**, not an immutable set.

### Governance invariants enforced structurally by this migration (and what is NOT enforced)

Two PostgreSQL trigger functions and one partial unique index are created. These are **static,
assignment-time integrity checks inside the three new tables only** — they say nothing about
live, request-time enforcement by the existing `AuthorizationService` / `RuntimeAccessGuard` /
`RoutePolicyRegistry`, which this task does not touch or wire this catalogue into.

1. **`uq_authorization_roles_single_administrative_capability`** (partial unique index on
   `authorization_roles(administrative_capability) WHERE administrative_capability = TRUE`):
   at most one role may ever hold the single reserved "administrative capability" at a time.
   This generalizes the old hardcoded single-FINANCE_ADMIN reservation in
   `workforce-configuration.ts` into a reusable, role-name-agnostic DB invariant. Verified: only
   `SUPER_ADMIN` holds it after seeding; a second attempt would be rejected by PostgreSQL itself.

2. **`trg_authorization_role_functions_finance_class`** (`BEFORE INSERT OR UPDATE` on
   `authorization_role_functions`): rejects any attempt to assign a function flagged
   `finance_class_restricted = TRUE` to a role flagged `finance_role_class = FALSE`. Since every
   `CRITICAL_FINANCIAL` function in the seed is flagged `finance_class_restricted = TRUE`, and
   `SUPER_ADMIN.finance_role_class = FALSE`, this trigger **structurally prevents** — at the data
   layer, today, provably (see §5 test 10) — `SUPER_ADMIN` or any non-Finance-class role from
   ever being assigned `ledger.post`, `ledger.reverse`, or any other critical financial function.
   This is a genuine, already-working implementation of two of the named security invariants
   ("CRITICAL FINANCIAL functions cannot be assigned outside the Finance role class" and
   "SUPER_ADMIN cannot directly execute or approve critical financial functions") **at the
   catalogue/assignment level**. It is explicitly **not** the same thing as live transaction-time
   maker/checker enforcement, which remains unimplemented (see §7).

3. **`trg_authorization_role_functions_read_only`** (`BEFORE INSERT OR UPDATE` on
   `authorization_role_functions`): rejects any attempt to assign a non-`READ`-sensitivity
   function to a role flagged `read_only = TRUE`. `FINANCE_AUDITOR` is the only role seeded with
   `read_only = TRUE`. This is a generalized, non-role-name-specific implementation of "a role
   with zero mutation overlap" — the same mechanism would apply automatically to any future
   role an administrator flags `read_only`. Verified: an attempted insert of
   `FINANCE_AUDITOR` + `customer.create` (a mutation function) is rejected by PostgreSQL
   (see §5 test 9).

**Why `access_type` lives on the assignment, not the function** (required justification per the
task instructions): the same `function_code` can legitimately be held by two different roles in
two different capacities — e.g. `fee_rule.create` is held by `FINANCE_PREPARER` as `INITIATE`
and by `FINANCE_CONTROLLER` as `APPROVE`; `workforce.role.assign` is held by `SUPER_ADMIN` as
`INITIATE` and by `FINANCE_CONTROLLER` as `APPROVE`. This mirrors the existing
`A2_MAKER_CHECKER_RULES_JSON` convention already in production, where one governed action has
separate `initiatingRoles`/`approvingRoles` arrays. Putting `access_type` on the function itself
would force inventing duplicate function codes per role (e.g. `fee_rule.create` and a fictitious
`fee_rule.create.approve`), which the approved spec's catalogue does not define and which the
task explicitly warns against ("do not invent functions").

---

## 3. Module and wiring

- New directory: `src/authorization-catalogue/` —
  `authorization-function.entity.ts`, `authorization-role.entity.ts`,
  `authorization-role-function.entity.ts`, `authorization-catalogue.enums.ts`,
  `authorization-catalogue.seed.ts` (seed data constants, source-commented to the spec),
  `authorization-catalogue-seed.service.ts` (idempotent `OnApplicationBootstrap` seed, modeled
  directly on `CapabilitySeedService`), `authorization-catalogue.module.ts`.
- Registered in `src/app.module.ts` as `AuthorizationCatalogueModule`, imported alongside (not
  inside) `AuthorizationModule` and `CapabilityRegistryModule`.
- **Deliberately separate from `src/authorization/`** (the existing, sensitive A2 workforce/
  finance runtime) so this task does not touch that module's wiring at all. Nothing in
  `AuthorizationService`, `RuntimeAccessGuard`, `RoutePolicyRegistry`, or any controller reads
  from the new tables — the two systems coexist but are not yet connected. Connecting the live
  runtime to this catalogue is explicitly a later task.
- Seeding is idempotent and count-based (count functions/roles/role_functions already present;
  insert only missing seed items; never duplicate), exactly matching the pattern already used by
  `CapabilitySeedService`. Verified directly in the test suite (re-running the seed produces zero
  new inserts and the same final row counts).

---

## 4. Seeded data

### 4.1 Roles — exactly the ten approved, no more, no less

`SUPER_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `FINANCE_AUDITOR`, `OPERATIONS`,
`AGENT_NETWORK_MANAGER`, `COMPLIANCE`, `RISK_FRAUD`, `CUSTOMER_SERVICE`, `TREASURY`.

**`FINANCE_ADMIN` is not seeded as an organizational role** — verified by test (§5 test 2).
`SUPER_ADMIN` is the sole role flagged `administrative_capability = TRUE`, generalizing (not
copying) the single administrative capability `FINANCE_ADMIN` previously held exclusively in
`workforce-configuration.ts`. Per the approved spec/decisions, `SUPER_ADMIN` does **not** inherit
`FINANCE_ADMIN`'s legacy financial-execution surface: it does not hold any `CRITICAL_FINANCIAL`
function (structurally blocked by the finance-class trigger, see §2), it does not hold any
Finance maker/checker function, and it does not hold `agent.fund`/`agent.defund` (reserved to
`AGENT_NETWORK_MANAGER` as maker / `FINANCE_CONTROLLER` as checker, per Decision 7). What
`SUPER_ADMIN` does inherit from `FINANCE_ADMIN`'s former administrative surface is exactly the
broad, non-financial administrative/governance/visibility authority described in the approved
spec's §6.1 definition: workforce role assign/revoke (maker side), customer/agent/aggregator
administration, workforce user provisioning, KYC review/approve/reject (shared with
`COMPLIANCE`), compliance case administration (non-FRAUD), and read access across every
operational and Finance-domain `*.view` function.

### 4.2 Function catalogue — 76 entries, sourced verbatim from the approved spec

- **76 total catalogued functions** across 13 domains (CUSTOMER, AGENT, AGGREGATOR, TRANSACTION,
  LEDGER, FINANCE, WORKFORCE, COMPLIANCE, RISK_FRAUD, AUDIT, RECONCILIATION, TREASURY,
  OPERATIONS). Every `function_code` is taken verbatim from
  `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` §7 — none are invented.
- **62 of the 76 are `assignable = true`**; 14 are `assignable = false` (every `FUTURE` or
  `OUT_OF_V1_SCOPE` function, by construction — verified by test §5-6 that no `FUTURE`/
  `OUT_OF_V1_SCOPE` function is ever `assignable = true`, and that none of the explicitly-named
  non-assignable functions has any row in `authorization_role_functions`):
  `customer.terminate`, `agent.manage_permissions`, `transaction.search`,
  `transaction.reversal.request`, `transaction.reversal.approve`, `ledger.approve_adjustment`,
  `workforce.role.create`, `workforce.role.modify`, `compliance.restrict_account`,
  `compliance.release_restriction`, `audit.export`, `reconciliation.investigate`,
  `reconciliation.resolve`, `treasury.manage_settlement`, `treasury.resolve_suspense`.
- **The catalogue intentionally includes non-assignable entries** (all 14 above) so the
  distinction between "exists in the catalogue" and "assignable/implemented" required by the
  task is structurally visible, not just documented in prose — e.g. `workforce.role.create` is
  catalogued with its Decision-10 governance metadata (`maker_checker_required = true`,
  `approval_required = true`) attached, ready for a future task to flip `assignable = true` once
  the dynamic-role-creation capability and its dual-control workflow are actually built.
- **One deliberate asymmetry, called out explicitly:** `ledger.post` and `ledger.reverse` are
  `BACKEND_ONLY` (the backend code path exists, today unreachable due to the known
  `internal:access` gap) and are seeded `assignable = true` so the approved matrix's intended
  maker ownership (`FINANCE_PREPARER`, `INITIATE`) is represented now. `ledger.approve_adjustment`
  — the corresponding checker-side function — is classified `FUTURE` (no governed action exists
  for it at all today, unlike post/reverse), so per the task's explicit instruction it is seeded
  `assignable = false` and is **not** assigned to `FINANCE_CONTROLLER` or anyone else. This means
  `FINANCE_PREPARER` currently holds a maker-side ledger function with no matching assignable
  checker-side counterpart in the catalogue — intentional, and will be resolved when a later task
  creates the actual governed action for `ledger.approve_adjustment`.

### 4.3 Role → function assignments — 147 rows

| Role | Assignment count | Notes |
|---|---:|---|
| `SUPER_ADMIN` | 46 | Broad admin/visibility; zero `CRITICAL_FINANCIAL`, zero Finance maker/checker, zero `agent.fund`/`defund`, zero `risk_fraud.manage_fraud_case` |
| `FINANCE_PREPARER` | 18 | Maker-only (`INITIATE`): ledger postings, fee/commission/reward/product/limit changes, finance control policy |
| `FINANCE_CONTROLLER` | 20 | Checker-only (`APPROVE`) for the same governed actions, plus `agent.fund`/`defund` approval and `workforce.role.assign`/`revoke` approval; never holds a maker-side function |
| `FINANCE_AUDITOR` | 21 | 100% `VIEW` access to `READ`-sensitivity functions only — zero mutation, DB-enforced |
| `OPERATIONS` | 17 | Customer/aggregator/support-workforce administration, observability views; no financial mutation, no agent-network lifecycle ownership |
| `AGENT_NETWORK_MANAGER` | 12 | Full agent lifecycle + credentials/outlets/limit-assignment; `agent.fund`/`defund` as `INITIATE` only (Decision 7) |
| `COMPLIANCE` | 7 | KYC review/approve/reject, non-FRAUD compliance case + risk-profile administration |
| `RISK_FRAUD` | 1 | `risk_fraud.manage_fraud_case` only — no AML/SANCTIONS case authority |
| `CUSTOMER_SERVICE` | 4 | View + support-case only; no lifecycle mutation, no financial mutation |
| `TREASURY` | 1 | `reconciliation.view` only (Decision 6) |
| **Total** | **147** | |

Every number above was computed from, and directly verified against, the committed seed data by
the test suite in §5 (not estimated).

---

## 5. Tests run and exact results

### 5.1 New focused suite: `test/v1-admin-authorization-foundation-01.integration.spec.ts`

Boots the **full `AppModule`** (with a real, freshly-migrated PostgreSQL database produced by the
existing `test/support/pg-harness.ts` real-Postgres harness) specifically to prove the new
`AuthorizationCatalogueModule` composes cleanly alongside the unmodified, existing A2 workforce/
finance authorization runtime, then asserts directly against the new tables via SQL and via the
seed service. No HTTP route is exercised (none is added by this task).

```
PASS test/v1-admin-authorization-foundation-01.integration.spec.ts
  V1-ADMIN-AUTHORIZATION-FOUNDATION-01 — Function/Role Catalogue (real PostgreSQL)
    ✓ seeds exactly the ten approved V1 roles
    ✓ does not seed FINANCE_ADMIN as an organizational role
    ✓ seeds the full approved function catalogue with exact stable identifiers
    ✓ seeds every role/function assignment in the approved matrix
    ✓ has no duplicate role/function assignments
    ✓ does not mark any FUTURE or OUT_OF_V1_SCOPE function as assignable, and never assigns a non-assignable function to a role
    ✓ TREASURY holds exactly one function: reconciliation.view
    ✓ RISK_FRAUD holds only risk_fraud.manage_fraud_case among compliance-case mutation functions
    ✓ FINANCE_AUDITOR is read_only and holds zero mutation (non-READ) functions
    ✓ restricts every CRITICAL_FINANCIAL function to roles flagged finance_role_class = true, and the DB rejects violating assignments
    ✓ recorded the new migration in typeorm_migrations
    ✓ does not alter the existing A2 finance role assignment table/shape
    ✓ enforces at most one role may hold administrative_capability = true
    ✓ reseeding is idempotent and produces no duplicate rows

Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

Mapping to the task's twelve required minimum tests:

| # | Requirement | Covered by |
|---|---|---|
| 1 | All ten roles exist after migration/seed | "seeds exactly the ten approved V1 roles" |
| 2 | FINANCE_ADMIN not seeded as an organizational role | "does not seed FINANCE_ADMIN..." |
| 3 | Required functions exist | "seeds the full approved function catalogue..." |
| 4 | Required role/function assignments exist | "seeds every role/function assignment..." |
| 5 | No duplicate role/function assignments | "has no duplicate role/function assignments" |
| 6 | Future/out-of-scope functions not accidentally assignable | "does not mark any FUTURE or OUT_OF_V1_SCOPE function as assignable..." |
| 7 | Treasury has only `reconciliation.view` | "TREASURY holds exactly one function..." |
| 8 | Risk/Fraud has only FRAUD-category authority | "RISK_FRAUD holds only risk_fraud.manage_fraud_case..." |
| 9 | Finance Auditor receives only approved read/audit functions | "FINANCE_AUDITOR is read_only and holds zero mutation..." |
| 10 | Critical financial functions restricted to Finance role class | "restricts every CRITICAL_FINANCIAL function..." |
| 11 | Migration runs successfully against current schema | "recorded the new migration..." + `migration-chain.integration.spec.ts` (below) |
| 12 | Existing relevant Finance behavior not broken | "does not alter the existing A2 finance role assignment table/shape" + broader suite (below) |

Two additional tests beyond the required twelve were added for stronger structural coverage:
the partial-unique-index invariant on `administrative_capability`, and full idempotent-reseed
verification (byte-for-byte same row counts on a second bootstrap pass).

### 5.2 Broader verification — full real-PostgreSQL integration suite (`npm run test:pg`)

Ran the entire 95-file real-Postgres integration suite (not just authorization-adjacent files)
to confirm no regression anywhere in the application from adding the 84th migration:

- **First run surfaced 17 pre-existing tests across the suite that hardcode "the set of
  acceptable latest-migration timestamps/names"** — a long-standing repository convention (seen
  in files like `v1-007-support-ticket.integration.spec.ts`,
  `test/v1-capability-registry.integration.spec.ts`, `a8-agent-lifecycle.integration.spec.ts`,
  and 14 others) where each test asserts the migration chain's tip is one of a known, growing
  list of timestamps. Adding migration `1785753600083` is exactly the kind of additive chain
  growth that convention anticipates and requires each test to be updated for (the same pattern
  every migration before this one had to satisfy). All 17 files were updated to add
  `1785753600083` / `CreateAuthorizationCatalogue1785753600083` to their existing allow-lists —
  no test's actual logic, intent, or pass/fail boundary was changed, only the "latest migration"
  bookkeeping constant. `src/production/production-readiness.service.ts`'s own
  `EXPECTED_MIGRATION_TIMESTAMP`/`EXPECTED_MIGRATION_NAME` constants (which gate real production
  boot) were updated identically, and its own unit test (`test/production-readiness.spec.ts`)
  was updated to match.
- **After those fixes, a second full run of `npm run test:pg` produced exactly 95/95 test
  suites executed, 93 passing, 2 failing** — both of the 2 failures
  (`test/v1-admin-local-login-01.integration.spec.ts`,
  `test/v1-admin-full-surface-audit-01-auth-propagation.integration.spec.ts`) were independently
  reproduced as failing **identically, with the same `ForbiddenException: FINANCE_ADMIN role is
  disabled or undefined in configuration` error, on a clean `git stash` of this task's entire
  changeset** (i.e. on the pre-existing `f15d426` commit, before any file in this task was
  touched). This is a pre-existing environment/configuration issue in this sandbox unrelated to
  this task (neither `finance-role-administration.service.ts`,
  `local-admin-authentication.service.ts`, nor `workforce-configuration.ts` were touched by this
  task), reported here per the "any unexpected repository issue" requirement, not something this
  task introduced or should fix.
- The full default (non-Postgres) unit suite was also run: **174 suites, 1823 tests, all
  passing.**
- `test/migration-chain.integration.spec.ts` (16/16), `test/v1-capability-registry.integration.spec.ts`
  (22/22), `test/v1-release-01-production-readiness-migration-sync.integration.spec.ts` (3/3),
  `test/a2-workforce-session.integration.spec.ts`, `test/v1-workforce-bootstrap-01.integration.spec.ts`,
  `test/b2f-finance-lifecycle.integration.spec.ts`, `test/authorization.service.spec.ts`,
  `test/a2-workforce-configuration.spec.ts`, `test/workforce-session-principal-type.spec.ts` were
  all run individually and pass — this directly satisfies minimum test #12 ("existing relevant
  Finance behavior not broken") beyond the one targeted assertion in the new focused suite.

---

## 6. Remaining hardcoded dependencies (inventoried, not fixed — exactly as instructed)

None of the following was modified in this task. Each remains exactly as documented in the prior
audit reports, re-verified by direct inspection this turn:

1. **`src/authorization/workforce-session.service.ts:152`** — single occurrence:
   `roles.includes('FINANCE_ADMIN') ? 'PRIVILEGED' : 'OPERATOR'`. Principal-type derivation is
   still a literal string check against `FINANCE_ADMIN`, not a function-bundle lookup against the
   new catalogue.
2. **`src/authorization/workforce-configuration.ts`** — `administrativeCapability` is still
   reserved to the literal string `'FINANCE_ADMIN'` in a `superRefine` check; the new catalogue's
   generalized `administrative_capability` flag (now held by `SUPER_ADMIN`) is not consulted.
3. **`src/authorization/workforce-configuration.ts`** — `REQUIRED_ROLES` is still exactly the
   four literal keys (`FINANCE_ADMIN`, `FINANCE_PREPARER`, `FINANCE_CONTROLLER`,
   `FINANCE_AUDITOR`) with a Zod `.min(4).max(4)` bound; the live runtime still cannot boot with
   any role vocabulary other than exactly these four. This was deliberately **not** touched, per
   the explicit instruction not to attempt the full migration and to keep the application
   buildable/testable with its existing configuration.
4. **`src/authorization/finance-role-administration.service.ts`** — **18 distinct literal
   `'FINANCE_ADMIN'` references** (bootstrap grant, single-active-FINANCE_ADMIN invariant,
   assignment prohibition, role exclusion checks). Still entirely untouched.
5. **`src/authorization/route-policy-registry.ts`** — **31 occurrences** of the `'PRIVILEGED'`
   principal-type string. Route policies still gate on principal *type*, not on function-level
   authorization against the new catalogue.
6. **17 controllers** still directly inspect `principal.type ===` rather than consulting
   function-level authorization: `admin-agent-credentials.controller.ts`,
   `admin-agent-lifecycle.controller.ts`, `admin-agent.controller.ts`,
   `admin-aggregator.controller.ts`, `admin-customer-credentials.controller.ts`,
   `admin-customer.controller.ts`, `admin-notification.controller.ts`,
   `admin-support-credentials.controller.ts`, `customer.controller.ts`,
   `agent-application-admin.controller.ts`, `agent-class.controller.ts`,
   `agent-funding.controller.ts`, `agent-lifecycle.controller.ts`, `aggregator.controller.ts`,
   `capability.controller.ts`, `customer-funding-internal.controller.ts`,
   `support-internal.controller.ts`.

**None of these six items is "solved" by this task.** The new catalogue exists as an independent
source of truth that a later task can wire the above code paths onto; until that wiring task is
done, the live authorization behavior of the application is governed entirely by the pre-existing
A2 workforce/finance runtime, unaffected by anything in this task.

### Agent funding — explicitly verified unchanged

`src/agent/agent-funding.service.ts` still calls `LedgerService.postJournalInTransaction(...)`
directly for all four fund/defund routes, and `src/agent/agent-funding.controller.ts` still
captures actor identity via `@Req()` → `req.authorizationPrincipal` → `principal.principalId` on
every route. Neither file was read-write touched by this task beyond being grepped for
verification. No second ledger-posting path was created; no generic ledger actor capture was
added or modified. The catalogue represents `agent.fund`/`agent.defund` ownership (maker =
`AGENT_NETWORK_MANAGER`, checker = `FINANCE_CONTROLLER`, per Decision 7) purely as metadata — the
approval workflow itself is not implemented.

---

## 7. Security invariants — what is architecturally represented vs. runtime-enforced

| Invariant | Status in this task |
|---|---|
| CRITICAL_FINANCIAL functions restricted to the Finance role class | **Enforced today**, at the catalogue/assignment layer, by a PostgreSQL trigger (`trg_authorization_role_functions_finance_class`). Not yet consulted by the live request-time authorization path. |
| SUPER_ADMIN cannot directly execute/approve critical financial functions | **Enforced today** by the same trigger (SUPER_ADMIN is `finance_role_class = false`); also true by construction in the seed data (zero such assignments exist). Not yet consulted live. |
| FINANCE_AUDITOR has zero mutation overlap | **Enforced today**, generically (not role-name-hardcoded), by `trg_authorization_role_functions_read_only`; true in the current seed. Not yet consulted live — `FINANCE_AUDITOR`'s actual HTTP route defect (documented in prior audits) is untouched. |
| Maker ≠ checker for the same governed action | **Represented in the seed data** (e.g. `FINANCE_PREPARER` never holds an `APPROVE` row, `FINANCE_CONTROLLER` never holds an `INITIATE` row for the same function) but **not enforced by any DB constraint or runtime check** — a future direct SQL write or application bug could still violate it. No live maker/checker engine reads this table. |
| No self-approval | **Not represented or enforced anywhere in this task** — self-approval is a live-transaction/session concept (the same actor approving their own earlier action), which has no meaning at the static role/function catalogue level. This remains entirely a later runtime task. |
| No role may assign itself critical functions | **Not applicable to this task** — there is no dynamic role-editing capability yet (`workforce.role.create`/`modify` are explicitly non-assignable, §4.2). This invariant matters once a role-editing UI/API exists. |
| Role/function configuration must never become a security bypass | The new tables are **not consulted by any live authorization decision** in this task, so they cannot yet be a bypass of anything — the existing runtime's security posture is completely unchanged. This will become the operative concern the moment a later task wires the live runtime onto this catalogue; that wiring task must preserve every invariant above as an actual runtime check, not just a seed-time one. |

**This task does not claim full V1 authorization readiness.** It is a foundation only.

---

## 8. Explicitly deferred to later authorization tasks (not implemented here)

Ledger maker/checker runtime; ledger actor-identity capture (generic); FINANCE_AUDITOR route
remediation; `internal:access` reachability remediation; fee/commission/reward/product/limit
maker-checker **runtime** enforcement (the catalogue models the intended maker/checker roles;
no enforcement engine reads it); agent fund/defund approval **workflow** (ownership is modeled,
workflow is not); dynamic role creation UI/API; wiring the live `AuthorizationService` /
`RuntimeAccessGuard` / `RoutePolicyRegistry` / any controller onto this catalogue; Admin Web
Roles & Permissions UI; any other Admin Web functional surface; a fraud engine; Treasury
functionality beyond `reconciliation.view`; external bank/NIBSS/settlement functionality; any
customer/agent/payment business-flow change.

---

## 9. Explicit confirmations

- **No Admin Web work was performed.** No frontend file was touched.
- **No unrelated business-flow change was made.** The only non-authorization-catalogue files
  touched were: `src/app.module.ts` (one-line module registration),
  `src/production/production-readiness.service.ts` (the pre-existing "expected latest migration"
  constants, which every migration-adding task must update to keep production boot working), and
  18 pre-existing test files whose only change is appending the new migration
  timestamp/name to an existing hardcoded allow-list (no test logic/intent changed).
- **No Product Owner decision was reopened, reinterpreted, or added to.** The ten roles, the
  function catalogue, and the role→function matrix all trace directly to
  `V1-ADMIN-ROLE-AND-PERMISSION-SPEC-01.md` and `V1-ADMIN-ROLE-AND-PERMISSION-DECISIONS-01.md`.
- **The application remains fully buildable and testable** with its existing `A2_FINANCE_ROLES_JSON`
  configuration untouched — `npm run build` succeeds; the full unit suite (1823 tests) and 93/95
  real-Postgres integration suites pass (the 2 non-passing suites are pre-existing and unrelated,
  per §5.2).

---

## 10. Final summary for the record

- **Branch:** `arena/01a10374-monienaija`
- **New migration:** `1785753600083-CreateAuthorizationCatalogue.ts` (84th in the chain)
- **New tables/entities:** `authorization_functions` / `AuthorizationFunction`,
  `authorization_roles` / `AuthorizationRole`, `authorization_role_functions` /
  `AuthorizationRoleFunction`
- **Ten seeded roles:** SUPER_ADMIN, FINANCE_PREPARER, FINANCE_CONTROLLER, FINANCE_AUDITOR,
  OPERATIONS, AGENT_NETWORK_MANAGER, COMPLIANCE, RISK_FRAUD, CUSTOMER_SERVICE, TREASURY
  (FINANCE_ADMIN confirmed absent)
- **Function catalogue:** 76 entries (62 assignable, 14 catalogued-but-non-assignable)
- **Role/function assignments:** 147 rows, zero duplicates, zero invariant violations
- **Tests:** 14/14 new focused tests passing; 93/95 broader real-Postgres integration suites
  passing (2 pre-existing, unrelated failures, reproduced on clean HEAD); full unit suite
  1823/1823 passing
- **STOP:** per explicit instruction, this task stops here. The next authorization task (wiring
  the live runtime onto this catalogue, or any further migration of the six hardcoded
  dependencies) is not started.
