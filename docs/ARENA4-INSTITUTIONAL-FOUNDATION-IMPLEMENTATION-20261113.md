# ARENA 4 — Phase 1 institutional foundation (implementation record)

- **Date:** 2026-11-13
- **Branch:** `arena/5ee539a0-monienaija`
- **Baseline:** `81793dd7956963c40e823a4f6b2d2d9186fbce43`
- **Design input:** `docs/ARENA4-INSTITUTIONAL-ARCHITECTURE-PROPOSAL-20261113.md` (accepted, `de21b82`)
- **Investigation input:** `docs/ARENA4-INSTITUTIONAL-AFFILIATION-INVESTIGATION-20261113.md` (`af67f52`)

Phase 1 builds the **minimum institutional foundation**: a first-class financial-institution
party, an explicit governed agent→institution affiliation, request-time workforce institution
scoping, one authoritative resolver contract, and read-only attribution visibility. It does not
build institution ledger books, wallet institutional attribution, customer enrolments, settlement
accounts, fee/limit engines, provider configuration isolation, cross-institution transactions or
Admin Web screens.

---

## 1. What changed

### 1.1 Migration `1785753600400-CreateInstitutionFoundation`

Allocated from Arena 4's reserved range `1785753600400–1785753600499`. The range was verified
free against `origin/main` (head `1785753600052-CreateA2WorkforceAuthenticationTables`) and against
the branch before allocation; nothing in `…0400–0499` existed remotely or locally.

**Five tables** (the proposal's §14 phase note said "four tables and one view" — that was an
inventory undercount; the governed execution record needed its own immutable table, see §1.2):

| Table                                  | Purpose                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `financial_institutions`               | First-class institution party + administrative/regulatory/operational lifecycle |
| `institution_agent_affiliations`       | The single authoritative agent↔institution affiliation, current and historical |
| `aggregator_institution_relationships` | Organizational aggregator↔institution link (never an affiliation)              |
| `governed_institution_affiliations`    | Immutable execution receipt for every governed affiliation change               |
| `workforce_institution_assignments`    | Institution-scoped workforce authority, read at request time                    |

**Two read-only views:** `agent_institution_resolution` (one row per agent, with
`resolution_state`, `unresolved_reason` and `open_affiliation_count`) and
`institution_attribution_gaps` (unattributed agents and why).

**Guard functions / triggers** (structural, not advisory):

- `fn_institution_approval_consumed(approval, action, resource_type, resource_id)` — the single
  definition of "this approval may authorize this write".
- `financial_institution_guard` — refuses `DELETE`; refuses `REGISTERED → APPROVED` (evidence must
  be recorded first); refuses every transition into `APPROVED`/`SUSPENDED`/`CLOSED` unless
  `lifecycle_approval_id` is a **CONSUMED** `FINANCIAL_INSTITUTION_LIFECYCLE_CHANGE` approval for
  that institution; freezes reference/code/legal name/type/created_at/deleted_at.
- `institution_affiliation_guard` — refuses `DELETE`; every `INSERT` must be `ACTIVE` and carry a
  **CONSUMED** `INSTITUTION_AGENT_AFFILIATION_CHANGE` approval for that agent; every status change
  needs its **own** consumed approval; terminated rows are frozen; a non-terminated row requires the
  institution to be `APPROVED`; version/timestamps are owned by the trigger.
- `governed_institution_affiliation_guard` — the receipt table is insert-only and insertable only
  with a consumed approval for that agent.

`down()` refuses to drop the foundation while any institution exists (fail-closed, mirroring
`1785753600118`).

### 1.2 Why a fifth table

The requirement is an **immutable execution record** per governed change, independently readable
from the affiliation row it mutated (the row is updated later by a _different_ approval, and a
transfer mutates two rows). Keying the receipt by `approval_id` gives exactly-once semantics and
gives the API a durable return value, so `governed_institution_affiliations` is a table, not a
column. Hence five tables, not four.

### 1.3 Code

| Area                                                                                        | File                                                                                                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Enums / types                                                                               | `src/institution/institution.enums.ts`, `institution.types.ts`                                                     |
| Resolver contract + production resolver + non-configured test resolver + enforcement policy | `src/institution/agent-institution-resolver.ts`                                                                    |
| Institution registration / evidence / lifecycle                                             | `src/institution/financial-institution.service.ts`                                                                 |
| Governed affiliation                                                                        | `src/institution/institution-affiliation.service.ts`                                                               |
| Request-time workforce scope                                                                | `src/institution/institution-workforce-scope.service.ts`                                                           |
| Attribution gaps                                                                            | `src/institution/institution-reconciliation.service.ts`                                                            |
| HTTP surface + DTOs                                                                         | `src/institution/institution.controller.ts`, `src/institution/dto/institution.dto.ts`                              |
| Wiring                                                                                      | `src/institution/institution.module.ts`, `src/app.module.ts`                                                       |
| Registry                                                                                    | `src/authorization/governed-action.registry.ts` (two actions, `GOVERNED_ACTIONS`)                                  |
| Route policy                                                                                | `src/authorization/route-policy-registry.ts` (`/internal/institutions`, `/internal/agent-affiliations`)            |
| Catalogue                                                                                   | `src/authorization-catalogue/authorization-catalogue.seed.ts` (8 functions, 12 role assignments)                   |
| Readiness head                                                                              | `src/production/production-readiness.service.ts`                                                                   |
| Acceptance                                                                                  | `test/institution-foundation.integration.spec.ts` (18 cases), `test/institution-foundation.unit.spec.ts` (9 cases) |

No second approval framework: both actions run through `PrivilegedActionApprovalService`
(`requestInTransaction` / `consumeInTransaction`) exactly like `WALLET_OWNERSHIP_RESOLUTION`.

### 1.4 Catalogue functions (new, no existing role widened)

`institution.view`, `institution.manage`, `institution.lifecycle.prepare`,
`institution.lifecycle.approve`, `institution.affiliation.prepare`,
`institution.affiliation.approve`, `institution.attribution.view`,
`institution.workforce.assign`.

Role assignments: `SUPER_ADMIN` (view/manage/attribution/workforce.assign), `OPERATIONS`
(view/manage/lifecycle.prepare), `AGENT_NETWORK_MANAGER` (view/affiliation.prepare),
`FINANCE_CONTROLLER` (view/lifecycle.approve/affiliation.approve/attribution),
`FINANCE_AUDITOR` and `COMPLIANCE` (view/attribution).

**TREASURY deliberately receives nothing.** The approved V1 decision pins TREASURY to exactly
`reconciliation.view`; the existing suite asserts it, and this phase does not widen any existing
role. "Existing operators must not silently gain access to all institutions" is therefore enforced
twice: no role gains a new institution function by inheritance, and `institution.view` alone grants
access only to institutions the principal holds an `ACTIVE` assignment for.

---

## 2. Lifecycle semantics

```
REGISTERED ──(administrative)──▶ EVIDENCE_SUBMITTED ──(governed)──▶ APPROVED ⇄ SUSPENDED
     │                                   │                             │         │
     └────────────(governed)─────────────┴──────────(governed)─────────┴────▶ CLOSED
```

- Administrative steps (`register`, `recordRegulatoryEvidence`) never grant authority.
- `licenceReference` is recorded as **evidence for verification** (`evidence_reference`,
  `evidence_digest`, `licence_reference_recorded_at/by`). There is no automated regulatory
  verification, no provider call, and no code path where a licence reference produces `APPROVED`.
- `APPROVED` is the only status that yields `operationalAuthority: true` and the only status an
  institution can hold an `ACTIVE` affiliation under.
- `SUSPENDED` withdraws authority immediately: existing affiliations remain recorded but resolve
  `INSTITUTION_INACTIVE / INSTITUTION_SUSPENDED`, and new affiliation work is refused.
- `CLOSED` is terminal: no new affiliations, no workforce grants, no deletion.
- Every governed transition is atomic with approval consumption and audited
  (`FINANCIAL_INSTITUTION_LIFECYCLE_CHANGED`).

## 3. Governed affiliation semantics

| changeKind   | Precondition                                                       | Effect                                                          |
| ------------ | ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `ASSIGN`     | no open affiliation; target `APPROVED`                             | new `ACTIVE` row                                                |
| `TRANSFER`   | `ACTIVE` affiliation at a different institution; target `APPROVED` | previous row `TERMINATED` (+ `effective_to`), new `ACTIVE` row  |
| `SUSPEND`    | `ACTIVE` affiliation at the named institution                      | row `SUSPENDED` (still open, so it cannot be silently replaced) |
| `REACTIVATE` | `SUSPENDED` affiliation; institution `APPROVED`                    | row `ACTIVE`                                                    |
| `TERMINATE`  | open affiliation at the named institution                          | row `TERMINATED` (+ `effective_to`)                             |

One `INSTITUTION_AGENT_AFFILIATION_CHANGE` approval per change; the fingerprint binds
`agentId, institutionId, changeKind, evidenceType, evidenceReference, reason, currentAffiliationId,
currentInstitutionId`, so a request approved against state _S_ cannot execute against state _S'_.

Execution order (`InstitutionAffiliationService.executeAffiliation`):

1. approval row `pessimistic_write`; action/resource/agent/customer binding checks; maker ≠ checker
   and `privileged:approve` membership; `CONSUMED` ⇒ **idempotent replay** of the receipt;
2. `SELECT … FROM agents WHERE id = $1 FOR UPDATE` — serializes all affiliation changes per agent;
3. current affiliation `FOR UPDATE`; re-validate change kind, institution status and obligations;
4. re-compute the fingerprint and compare (state changed ⇒ `FINGERPRINT_MISMATCH` 403);
5. `consumeInTransaction` (atomic, caller's `EntityManager`);
6. apply the rows (trigger re-verifies the consumed approval);
7. insert the immutable receipt; 8. audit with previous + new values; 9. re-read and return.

**Unsettled obligations.** `TRANSFER` and `TERMINATE` are refused (`409`) while the agent still
holds a non-zero wallet balance or any `UNCLAIMED` cash-to-cash obligation. Nothing is ever moved,
merged, netted or written off: the affiliation change either happens with the agent's value already
settled, or it does not happen. A future governed "forced reassignment with settlement" workflow
would have to move value explicitly and is out of Phase 1 scope.

**Historical safety.** No wallet row, ledger account, journal, journal line or existing transaction
is read-modified by this phase. Test 18 asserts the columns `wallet_accounts`, `ledger_journals`
and `ledger_lines` contain no `%institution%` column at all, i.e. no attribution was back-filled.

---

## 4. Workforce institution scoping (request time)

- `workforce_institution_assignments` rows are authoritative and re-read on **every** request
  (`InstitutionWorkforceScopeService.assertCanAccessInstitution`). Token/session claims are never
  used for institution scope, so a revocation applies immediately to an already-issued session
  (acceptance case 15).
- Platform-level staff are recognized only by holding the explicit catalogue function
  `institution.attribution.view` — never by role name, principal type, or a claim.
- Denial is `404` for institution-scoped reads/writes so an unauthorized principal cannot probe
  which institutions exist.
- Cross-entity reads (`/internal/agent-affiliations/*`) require the platform marker only, so an
  institution-scoped operator cannot enumerate another institution's agents (acceptance case 16).
- `GET /internal/institutions` returns only the principal's assigned institutions; the platform
  marker sees all.
- `SUPER_ADMIN` holds `institution.workforce.assign`, the only way to grant/revoke scope.

---

## 5. Attribution-gap visibility

`GET /internal/institutions/attribution-gaps` and `/attribution-gaps/summary` read
`institution_attribution_gaps` and never write. Gap reasons are explicit
(`NO_AFFILIATION`, `AFFILIATION_SUSPENDED`, `CONFLICTING_AFFILIATION`, `INSTITUTION_REGISTERED`,
`INSTITUTION_EVIDENCE_SUBMITTED`, `INSTITUTION_SUSPENDED`, `INSTITUTION_CLOSED`,
`INSTITUTION_MISSING`). Every pre-existing agent therefore appears as a gap — truthfully
unattributed — rather than being silently attributed to a default institution.

---

## 6. Resolver contract (published interface, §8)

`src/institution/agent-institution-resolver.ts` exports `AGENT_INSTITUTION_RESOLVER` and the
`AgentInstitutionResolver` interface for Arena 1 (financial commitments) and Arena 2 (Cash-Out)
consumers. `InstitutionModule` exports the token and the database implementation.

### 6.1 Result shape — never a bare nullable id

```ts
type InstitutionResolution =
  | {
      outcome: 'RESOLVED';
      agentId: string;
      institutionId: string;
      affiliationId: string;
      institutionStatus: 'APPROVED';
      resolvedAt: string;
      evidenceFingerprint: string;
    }
  | {
      outcome: 'UNRESOLVED' | 'NOT_CONFIGURED' | 'INSTITUTION_INACTIVE' | 'INVALID_AFFILIATION';
      agentId: string;
      institutionId: string | null;
      affiliationId: string | null;
      reason:
        | 'NO_AFFILIATION'
        | 'AFFILIATION_SUSPENDED'
        | 'CONFLICTING_AFFILIATION'
        | 'INSTITUTION_MISSING'
        | 'INSTITUTION_REGISTERED'
        | 'INSTITUTION_EVIDENCE_SUBMITTED'
        | 'INSTITUTION_SUSPENDED'
        | 'INSTITUTION_CLOSED'
        | 'SCHEMA_NOT_CONFIGURED';
      resolvedAt: string;
      evidenceFingerprint: string;
    };
```

Rules:

1. Resolution derives **only** from the authenticated agent identity plus
   `institution_agent_affiliations` / `financial_institutions`. Never from an aggregator, outlet,
   terminal, caller-supplied identifier, token claim, configuration default or institution name
   (acceptance case 14 proves an aggregator link yields `NO_AFFILIATION`).
2. `RESOLVED` requires affiliation `ACTIVE`, institution `APPROVED` and `deleted_at IS NULL`.
3. More than one non-terminated affiliation ⇒ `INVALID_AFFILIATION / CONFLICTING_AFFILIATION`.
   The resolver never picks one and never falls back to "most recent".
4. A non-UUID agent id is a `400`, not a guess.

### 6.2 Transaction participation and locking

`resolve(manager, agentId, { lock?: 'SHARE' | 'NONE' })`. `manager` is mandatory: the answer
belongs to the caller's transaction snapshot. The default `lock: 'SHARE'` takes `FOR SHARE` on the
current affiliation row and then on the institution row, held until the caller commits.
Affiliation changes (`FOR UPDATE` on the agent, then on the affiliation row) and lifecycle changes
(`FOR UPDATE` on the institution row) take conflicting locks, so an affiliation or lifecycle change
cannot commit between authorization and posting. `lock: 'NONE'` exists only for read-only
diagnostics; financial authorization paths must not use it.

### 6.3 Evidence fingerprint

`evidenceFingerprint = sha256(canonical({agentId, outcome, institutionId, affiliationId, reason}))`
— deterministic, 64 hex chars, and different for every distinct outcome. Consumers bind it into
their own idempotency/authorization fingerprint so a decision recorded against institution _X_ can
never be replayed against institution _Y_.

### 6.4 Revalidation (mandatory for financial paths)

`revalidateInstitutionResolution(resolver, manager, previous)` re-reads and throws
`ServiceUnavailableException` if the outcome, institution or affiliation changed. A changed
institutional context is a **new authorization**, never a silent continuation of the previous one.

### 6.5 Receipt recovery

The governed receipt is keyed by `approval_id` (`governed_institution_affiliations.approval_id`
primary key) and written in the same transaction as consumption. Recovery is therefore
deterministic:

- a caller that lost the HTTP response may re-POST the execution with the same `approvalId` and
  receives the **stored** receipt (`201`) instead of a duplicate effect;
- a caller presenting a _different_ payload with an already-consumed approval cannot reach the
  replay branch: the agent/affiliation binding and fingerprint are checked before it, and the
  unique constraints (`uq_institution_affiliation_active`,
  `uq_institution_affiliation_pair_open`) make a second ACTIVE affiliation structurally impossible;
- `404` = unknown approval; `409` = approval consumed with no recoverable receipt; `403` =
  fingerprint/resource/scope mismatch.

### 6.6 Fail-closed enforcement

`InstitutionEnforcementPolicy`:

- `ENFORCED` (default; forced whenever the value is unset or unrecognized) permits a financial
  operation only for `RESOLVED`;
- `ADVISORY` is opt-in, refuses to construct in `production`, and records the outcome without
  blocking — a migration runway, not a substitute for resolution;
- there is **no** mode that substitutes `MONIENAIJA`, a default institution, or advisory behavior
  for authoritative resolution;
- `NotConfiguredInstitutionResolver` returns `NOT_CONFIGURED` and is test/dry-run only; the
  application module binds `DatabaseAgentInstitutionResolver`. Production wiring never swaps it.

---

## 7. Acceptance evidence (real PostgreSQL 18.4 + real HTTP)

`test/institution-foundation.integration.spec.ts` — **18/18 passed**; `test/institution-foundation.unit.spec.ts`
— **9/9 passed**.

| #   | Case                                                                                                            | Result |
| --- | --------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Registration confers no financial authority (`REGISTERED`, `operationalAuthority:false`)                        | pass   |
| 2   | Regulatory evidence recorded, still no authority; unscoped operator 404                                         | pass   |
| 3   | DB refuses `APPROVED` without a consumed approval; `REGISTERED→APPROVED` refused                                | pass   |
| 4   | Independent checker approval yields authority (`APPROVED`, `operationalApprovedAt`)                             | pass   |
| 5   | Lifecycle maker can neither approve nor execute; state unchanged, approval unconsumed                           | pass   |
| 6   | Direct-SQL affiliation insert refused; governed path creates exactly one ACTIVE row                             | pass   |
| 7   | Affiliation maker cannot approve/execute; auditor denied; checker completes                                     | pass   |
| 8   | Replayed execution returns the same receipt; one row, one receipt                                               | pass   |
| 9   | Two competing approvals + concurrent execution ⇒ `201`/`409`, single ACTIVE row                                 | pass   |
| 10  | `TRANSFER` terminates the previous row, creates the new one, history immutable                                  | pass   |
| 11  | Institution suspension ⇒ `INSTITUTION_INACTIVE/INSTITUTION_SUSPENDED`, new work `409`                           | pass   |
| 12  | Governed surface cannot create ambiguity; out-of-band conflict ⇒ `CONFLICTING_AFFILIATION`, ids `null`          | pass   |
| 13  | `RESOLVED` / `UNRESOLVED` / `NOT_CONFIGURED` distinguished; fingerprints differ                                 | pass   |
| 14  | Aggregator relationship establishes no affiliation; linking adds nothing                                        | pass   |
| 15  | Scope resolved per request; cross-institution `404`; revocation effective on the live token                     | pass   |
| 16  | Institution-scoped operator cannot enumerate agents (403); anonymous 401                                        | pass   |
| 17  | Attribution gaps read-only; ledger lines/balance/institution count unchanged                                    | pass   |
| 18  | Reassignment blocked while value is held; after settlement, wallet/ledger untouched; no `%institution%` columns | pass   |

Regression executed for this phase:

| Suite                                                                                             | Result  |
| ------------------------------------------------------------------------------------------------- | ------- |
| `test/migration-chain.integration.spec.ts` (full chain from empty DB + entity/schema consistency) | 17/17   |
| `test/institution-foundation.integration.spec.ts`                                                 | 18/18   |
| `test/institution-foundation.unit.spec.ts`                                                        | 9/9     |
| `test/wallet-ownership-resolution.integration.spec.ts` (Arena 3)                                  | 18/18   |
| `test/a8-agent-lifecycle.integration.spec.ts` (+ a19, a20)                                        | 67/67   |
| `test/v1-admin-authorization-foundation-01.integration.spec.ts`                                   | 14/14   |
| `test/v1-release-01-production-readiness-migration-sync.integration.spec.ts`                      | pass    |
| `test/governed-action.registry.spec.ts`, `authorization-http-matrix`, `runtime-access.guard`      | 186/186 |
| `npm test` (full unit/backend suite)                                                              | see §9  |

`src/production/production-readiness.service.ts` markers raised to
`1785753600400` / `CreateInstitutionFoundation1785753600400`; the head allow-lists in
`test/a8-agent-lifecycle`, `test/a19-agent-funding` and `test/a20-outlets-terminals` were raised in
the same change.

---

## 8. Phase plan and dependencies

| Phase        | Scope                                                                                                                                                                              | Depends on                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **1 (this)** | Institution party + lifecycle, governed affiliation, workforce scope, resolver, attribution gaps                                                                                   | —                                                                                                                                  |
| 2            | Wallet/transaction institutional attribution (nullable column + backfill of _authoritative_ attributions only), resolver consumption in Arena 1/2 financial paths under `ENFORCED` | Phase 1 affiliations populated; a governed re-attribution workflow for historical rows; explicit decision on unrecoverable history |
| 3            | Institution ledger books / accounting-unit-per-institution, settlement accounts                                                                                                    | Phase 2 attribution; accounting treatment decision (no cross-institution internal transactions)                                    |
| 4            | Customer institution enrolments (unified customer identity already decided)                                                                                                        | Phase 1 institutions; enrolment policy decision                                                                                    |
| 5            | Fee/limit engines scoped per institution                                                                                                                                           | Phase 2 + 3                                                                                                                        |
| 6            | Provider configuration isolation per institution                                                                                                                                   | Phase 1; credentials/binding model                                                                                                 |
| 7            | Admin Web screens                                                                                                                                                                  | Phase 1–2 APIs (this phase ships API only)                                                                                         |
| Deferred     | Cross-institution transactions, live provider integrations, automated regulatory verification                                                                                      | Product/legal decisions; not scheduled                                                                                             |

Dependencies still outstanding after Phase 1:

- **Arena 1 / Arena 2 adoption:** the resolver is published and exported, but the financial
  commitment and Cash-Out paths are intentionally unmodified in this phase (explicit instruction).
  Until they call it, `ENFORCED` has no production surface to gate.
- **Affiliation coverage:** no existing agent is affiliated. That is deliberate — no fabricated
  attribution — so the attribution-gap report lists every pre-existing agent until an operator
  performs a governed assignment.
- **Evidence verification is human:** the digest stored for affiliation evidence is a server-side
  canonical digest of the recorded payload, not a document hash of an uploaded artifact. Document
  custody/hashing belongs with the proof-of-address artifact store in a later phase.
- **No Admin Web UI** for institutions, affiliations, lifecycle or gaps.
- **No catalogue code for `WALLET_OWNERSHIP_RESOLUTION`** (Arena 3 carry-over) — unchanged.

---

## 9. Verification commands

```bash
# full unit/backend suite
npm test

# type, lint, format
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run format:check

# migration chain from an empty database + readiness markers
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija \
DB_PASSWORD=… PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=<id> \
npx jest --config jest.integration.config.js --runTestsByPath \
  test/migration-chain.integration.spec.ts --runInBand

# Phase 1 acceptance
NODE_ENV=test … npx jest --config jest.integration.config.js --runInBand \
  --runTestsByPath test/institution-foundation.integration.spec.ts
```

No deployment, no live provider call, no real financial transaction, no `main` merge was performed.
