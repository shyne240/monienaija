# ARENA 4 · Phase 2 — Institutional Financial Ownership · Implementation Record

**Date:** 2026-11-13
**Branch:** `arena/5ee539a0-monienaija`
**Baseline:** `81793dd` (Arena 3 head) → Phase 1 `f3ebc9a` + `ca5b38d` → **Phase 2 code checkpoint `1cf6ac7`**
**Migration:** `1785753600401-CreateInstitutionalFinancialOwnership` (Arena 4 range `…0400–…0499`; `…0400` belongs to Phase 1)

This phase makes the **institution the authoritative owner of financial accounts and wallets**,
adds a **customer enrolment** relationship that is separate from the global customer identity, and
enforces — in the **database as well as in services** — that institution-scoped internal postings
never mix incompatible institutional accounts. Nothing was backfilled, defaulted or inferred.

---

## 1. Scope delivered

| Requirement                                            | Delivered                                                                                                                                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer institutional enrolment, one unified identity | `customer_institution_enrolments` + `CustomerInstitutionEnrolmentService`; unique `(customer_id, institution_id)`; identity never duplicated                                                   |
| Governed wallet/financial-account attribution          | `WALLET_INSTITUTION_ATTRIBUTION` + `governed_wallet_institution_attributions` + `WalletInstitutionAttributionService`                                                                          |
| Preserve ownership model                               | Arena 3 `owner_class`, wallet ids, ledger account ids, balances and journals untouched; institutional attribution is **orthogonal**                                                            |
| Existing data                                          | No default institution, no aggregator inference, no journal rewrite; reconciliation views report gaps; attribution of an account with posted history is refused (governed cut-over documented) |
| Ledger institutional isolation                         | `ledger_line_institution_guard` (DB) + `LedgerService.resolveJournalInstitution` (service) + four explicit account classes                                                                     |
| Financial context resolver                             | `FINANCIAL_CONTEXT_RESOLVER` / `DatabaseFinancialContextResolver` with typed outcomes, SHARE locking, deterministic fingerprint and a fail-closed consumption helper                           |
| Migration coordination                                 | `…0401`, applied on a clean database; `down()` refuses while any institution exists                                                                                                            |
| Acceptance (real PostgreSQL)                           | 16/16 integration cases + 11 unit cases + regression suites (see §11)                                                                                                                          |

**Deliberately out of scope** (unchanged, not started): institution fee engines, commission redesign,
provider-configuration isolation, live bank integration, cross-institution transfers, Admin Web
institution screens, general refunds/returns. Arena 1 commitment lifecycle and Arena 2 Cash-Out
lifecycle were **not** modified.

---

## 2. Schema — `1785753600401-CreateInstitutionalFinancialOwnership`

### 2.1 Additive columns (no defaults that fabricate meaning)

| Table             | Column(s)                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ledger_accounts` | `institutional_scope` (`UNATTRIBUTED` default, `INSTITUTION`, `PLATFORM`), `institution_id`, `institutional_purpose` |
| `ledger_journals` | `institution_id`                                                                                                     |
| `wallet_accounts` | `institution_id`, `institution_attribution_id`                                                                       |

Constraints:

- `CHECK ((institutional_scope = 'INSTITUTION') = (institution_id IS NOT NULL))`.
- `CHECK` tying purpose to scope (`UNATTRIBUTED`/`PLATFORM` purposes can never appear on an
  institution account, and vice versa).
- `wallet_accounts`: `institution_id` and `institution_attribution_id` are set together, and
  `CHECK (institution_id IS NULL OR owner_class IN ('CUSTOMER','AGENT'))`.
- `fk_institution_*` `ON DELETE RESTRICT`.

**Immutability interaction (important):** `ledger_journals`/`ledger_lines` are append-only
(`reject_ledger_mutation`). `institution_id` therefore **must** be written at `INSERT`, and can never
be backfilled: `LedgerService` derives it from the journal's accounts and writes it in the same
`INSERT`. Historical journals keep `institution_id IS NULL` forever — that is the honest state.

### 2.2 New tables

`governed_wallet_institution_attributions` — the immutable execution record: `approval_id`
(unique), `wallet_id` (unique — a wallet is attributed at most once in V1), `ledger_account_id`,
`institution_id`, `previous_institution_id`, `owner_class`, `owner_reference`, `evidence_type`,
`evidence_reference`, `evidence_digest CHAR(64) ^[a-f0-9]{64}$`, `reason`, `executed_by`,
`executed_at`. `UPDATE`/`DELETE` raise.

`customer_institution_enrolments` — `reference` (unique), `customer_id`, `institution_id` (unique
pair), `status ∈ {PENDING, ACTIVE, SUSPENDED, CLOSED}`, `financial_eligibility ∈
{PENDING_KYC, ELIGIBLE, RESTRICTED}`, `kyc_reuse_authorized` + evidence/consent/policy references,
**`approval_id` FK**, `effective_from/effective_to`, `version`, `created_by/updated_by`.
CHECKs: `ELIGIBLE ⇒ status = 'ACTIVE'`; KYC-reuse triad is all-or-nothing; `CLOSED ⇔ effective_to
IS NOT NULL`; effective ordering.

### 2.3 Guard functions (all enforced in PostgreSQL)

| Function                                        | Enforces                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet_institution_attribution_guard`          | Wallets are created unattributed; attribution can never be cleared or partially set; once set it is immutable; only `CUSTOMER`/`AGENT`; requires a matching execution record whose approval is **consumed** for `WALLET_INSTITUTION_ATTRIBUTION` on that wallet, and an `APPROVED` institution |
| `ledger_account_institution_guard`              | `INSTITUTION`/`CUSTOMER_FUNDS` accounts cannot be created directly; attribution requires a governed record and **refuses any account with `ledger_lines`**; scope is immutable once set; a wallet's ledger account can never become `PLATFORM`                                                 |
| `ledger_line_institution_guard`                 | An `INSTITUTION` account requires a journal with the **same** `institution_id` (`23514` “Cross-institution internal posting is not permitted”); a non-institutional account may never join an institutional journal (`23514`)                                                                  |
| `governed_wallet_institution_attribution_guard` | Execution records are append-only and require a consumed approval at insert                                                                                                                                                                                                                    |
| `customer_institution_enrolment_guard`          | No deletes; identity columns immutable; `CLOSED` is terminal; every status/eligibility change needs **its own** consumed `CUSTOMER_INSTITUTION_ENROLMENT_CHANGE` approval; `ACTIVE` requires an `APPROVED` institution                                                                         |

### 2.4 Views (read-only reconciliation)

- `unattributed_financial_accounts` — every wallet and non-wallet ledger account with no
  authoritative institutional owner, with `ledger_line_count` and signed `balance_minor`.
- `institution_financial_coverage` — per institution: active enrolments, active affiliations,
  attributed wallets, institutional ledger accounts.

### 2.5 `down()`

Drops only what `up()` created and **refuses** while `financial_institutions` holds rows (same
fail-closed convention as `…0400` and `…0118`).

---

## 3. Ownership model — extended, never replaced

| Concept                 | Where it lives (unchanged)                                              | Phase 2 relationship                                                               |
| ----------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Owner classification    | `wallet_accounts.owner_class` (`CUSTOMER`, `AGENT`, `SYSTEM`, `REVIEW`) | Preserved verbatim; a wallet keeps its class **and** gains one institutional owner |
| Ledger ownership        | `wallet_accounts.ledger_account_id`                                     | Unchanged; the ledger account is attributed together with the wallet               |
| Institutional ownership | `institution_id` + `institution_attribution_id`                         | Additive, nullable, immutable once set                                             |

Consequences enforced by code and tests: an **agent affiliation never moves a wallet or a balance**
(Phase 1 semantics preserved), `SYSTEM` custody and `REVIEW` wallets can never be attributed, and an
attributed wallet cannot be re-pointed by SQL or by a second governed request.

### Account classes (ledger isolation)

| Class                                    | `institutional_scope` | `institution_id` | `institutional_purpose`                | How it is created                                                                                                            |
| ---------------------------------------- | --------------------- | ---------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Historical / unattributed                | `UNATTRIBUTED`        | `NULL`           | `NULL`                                 | unchanged; joinable only by non-institutional journals                                                                       |
| Customer funds (institution)             | `INSTITUTION`         | set              | `CUSTOMER_FUNDS`                       | **only** via governed wallet attribution                                                                                     |
| Institution settlement/suspense/clearing | `INSTITUTION`         | set              | `SETTLEMENT` / `SUSPENSE` / `CLEARING` | `POST /internal/institutions/:id/ledger-accounts` (requires `institution.manage`, institution scope, `APPROVED` institution) |
| Platform-level                           | `PLATFORM`            | `NULL`           | `PLATFORM_OPERATIONS`                  | `POST /internal/institution-ledger/platform-accounts`, only while the account has **no wallet and no posted history**        |

Service rule (`LedgerService.resolveJournalInstitution`): the journal's institution is derived from
its accounts; **more than one institution ⇒ 409**; an institutional journal may contain **only**
accounts of that institution; a journal with no institutional account may contain only
`UNATTRIBUTED`/`PLATFORM` accounts. There is **no bypass** for unattributed accounts — they simply
cannot participate in an institutional journal at all.

---

## 4. Governed actions and catalogue functions

Registered in `src/authorization/governed-action.registry.ts` and the authorization catalogue; both
reuse the existing approval stack (no second framework), require MFA on both sides and prohibit
self-approval.

| Action                                  | Resource         | Maker (function)                                          | Checker (function)                                       |
| --------------------------------------- | ---------------- | --------------------------------------------------------- | -------------------------------------------------------- |
| `WALLET_INSTITUTION_ATTRIBUTION`        | `WALLET_ACCOUNT` | `FINANCE_PREPARER` · `institution.attribution.prepare`    | `FINANCE_CONTROLLER` · `institution.attribution.approve` |
| `CUSTOMER_INSTITUTION_ENROLMENT_CHANGE` | `CUSTOMER`       | `AGENT_NETWORK_MANAGER` · `institution.enrolment.prepare` | `FINANCE_CONTROLLER` · `institution.enrolment.approve`   |

`institution.attribution.view` remains the **only** platform-level institution marker (reads and the
cross-entity probes); it is not granted to any new role. `FINANCE_PREPARER` gained
`institution.view` + `institution.attribution.prepare`. No existing role was widened and `TREASURY`
still receives no institution function.

---

## 5. Customer institutional enrolment

- One `customers.id`; relationships are rows in `customer_institution_enrolments`, at most one per
  `(customer, institution)`. A customer may be ACTIVE at A and PENDING at B simultaneously.
- **Global identity grants no institutional financial eligibility.** `financial_eligibility` is a
  per-enrolment fact; `ELIGIBLE` requires `status = ACTIVE` (DB CHECK) and is stated explicitly by
  the governed change (omitting it means `PENDING_KYC` — a transition can never silently upgrade).
- **KYC reuse is never implicit.** Claiming it requires the triad (evidence + consent + applicable
  policy) _and_ proof that the customer actually holds reusable KYC (`kyc_status = APPROVED` and a
  level other than `NONE`); otherwise the claim is refused and the enrolment stays `PENDING_KYC`.
- Lifecycle: `PENDING → {ACTIVE, CLOSED}`, `ACTIVE → {SUSPENDED, CLOSED}`, `SUSPENDED → {ACTIVE,
CLOSED}`, `CLOSED` terminal. Every transition consumes its own approval; the trigger rejects
  reuse of the previous approval id.
- **Scope isolation:** institution-scoped staff read only their own institution's enrolments;
  enumerating a shared customer identity across institutions requires the explicit platform marker.

---

## 6. Governed wallet attribution

Preconditions (service **and** database): wallet `ACTIVE` and unattributed; `owner_class ∈
{CUSTOMER, AGENT}`; institution `APPROVED`; customer wallets need an `ACTIVE`, `ELIGIBLE`
enrolment at that institution; agent wallets need the **authoritative affiliation** to resolve to it
(a different institution is refused); the ledger account must have **no posted history**.

Execution is one transaction, in this order: lock approval (`FOR UPDATE`) → verify action/resource/
fingerprint/independence → re-validate preconditions → lock wallet and ledger account (`FOR UPDATE`)
→ consume the approval → insert the immutable execution record → attribute the ledger account →
attribute the wallet → audit. A failure anywhere rolls back **all** of it (proved by test case 5).
Replaying a consumed approval returns the original record; two approvals racing for the same wallet
yield exactly one attribution (the loser gets `409`) — proved by test case 6.

**History blocks attribution by design.** Attributing an account with `ledger_lines` would fabricate
historical institutional ownership, so it is refused with the documented remediation: close the
wallet, open an institution-attributed wallet, and move value through an explicit audited journal.
No such cut-over automation exists in V1.

---

## 7. Published financial-context resolver

```ts
export const FINANCIAL_CONTEXT_RESOLVER = Symbol('FINANCIAL_CONTEXT_RESOLVER');

interface FinancialContextResolver {
  resolve(manager: EntityManager, request: FinancialContextRequest): Promise<FinancialContext>;
}

type FinancialContextOutcome =
  | 'RESOLVED'
  | 'UNRESOLVED'
  | 'NOT_CONFIGURED'
  | 'INSTITUTION_INACTIVE'
  | 'INCOMPATIBLE';

type FinancialContextReason =
  | 'NO_INSTITUTION_CONTEXT'
  | 'SCHEMA_NOT_CONFIGURED'
  | 'AGENT_AFFILIATION_UNAVAILABLE'
  | 'CUSTOMER_NOT_ENROLLED'
  | 'ENROLMENT_SUSPENDED'
  | 'CUSTOMER_NOT_ELIGIBLE'
  | 'UNATTRIBUTED_WALLET'
  | 'UNATTRIBUTED_LEDGER_ACCOUNT'
  | 'PLATFORM_ACCOUNT_IN_INSTITUTIONAL_CONTEXT'
  | 'INSTITUTION_NOT_APPROVED'
  | 'INSTITUTION_SUSPENDED'
  | 'CROSS_INSTITUTION';
```

`FinancialContextRequest` accepts `institutionId?`, `agentId?`, `customerId?`, `walletIds?`,
`ledgerAccountIds?` and `lock?: 'SHARE' | 'NONE'` (default `'SHARE'`).

Guarantees:

1. The caller's `EntityManager` is mandatory; nothing is cached; the answer belongs to the caller's
   transaction.
2. `lock: 'SHARE'` takes row-share locks on wallets, ledger accounts, the enrolment and (through
   `AgentInstitutionResolver`) affiliations/institutions, so an institutional change cannot commit
   between authorization and execution — verified by test case 15, which proves a concurrent
   attribution blocks until the resolver's transaction ends.
3. The result is a discriminated outcome with explicit reasons; **never** a bare institution id,
   never a default institution, never an aggregator inference.
4. `evidenceFingerprint` = SHA-256 of the canonicalised outcome/parties/enrolment/affiliation.
5. `assertFinancialContextCompatible()` is the fail-closed consumer: `RESOLVED` returns; everything
   else throws (`409` for `INCOMPATIBLE`, `503` for unavailable/inactive).
6. `NotConfiguredFinancialContextResolver` exists for controlled tests only and reports
   `NOT_CONFIGURED` for every request.

---

## 8. HTTP surface

| Method & path                                                 | Function                          |
| ------------------------------------------------------------- | --------------------------------- |
| `POST /internal/institutions/:id/enrolments`                  | `institution.enrolment.prepare`   |
| `POST /internal/institutions/:id/enrolments/execute`          | `institution.enrolment.approve`   |
| `GET  /internal/institutions/:id/enrolments`                  | `institution.view`                |
| `POST /internal/institutions/:id/wallet-attributions`         | `institution.attribution.prepare` |
| `POST /internal/institutions/:id/wallet-attributions/execute` | `institution.attribution.approve` |
| `GET  /internal/institutions/:id/wallet-attributions`         | `institution.view`                |
| `POST /internal/institutions/:id/ledger-accounts`             | `institution.manage`              |
| `GET  /internal/institutions/:id/ledger-accounts`             | `institution.view`                |
| `POST /internal/institution-ledger/platform-accounts`         | `institution.manage`              |
| `GET  /internal/institution-ledger/unattributed`              | `institution.attribution.view`    |
| `GET  /internal/institution-ledger/coverage`                  | `institution.attribution.view`    |
| `GET  /internal/institution-enrolments/customers/:customerId` | `institution.attribution.view`    |
| `GET  /internal/institution-enrolments/wallets/:walletId`     | `institution.attribution.view`    |
| `POST /internal/financial-context/validate`                   | `institution.attribution.view`    |

Institution-scoped routes additionally require an ACTIVE
`workforce_institution_assignments` row resolved **at request time**; denial is a `404` so a
principal cannot probe which institutions exist.

---

## 9. Existing data treatment

- `wallet_accounts`, `ledger_accounts`, `ledger_journals`, `ledger_lines`, balances and
  `owner_class` were not touched, moved or rewritten.
- No institution is defaulted, inferred from an aggregator, or guessed from an agent affiliation.
- Every unattributed financial account is visible through `unattributed_financial_accounts`
  (`GET /internal/institution-ledger/unattributed`) with its history count and signed balance.
- Attribution of an account that already has history **fails closed** with the governed cut-over
  remediation in the message; there is no automated re-attribution and no journal rewrite.

---

## 10. What was intentionally not done

Arena 1/2 product code was not modified (contracts are published for later consolidated
integration). No cross-institution transfer, no external bank integration, no fee/commission work,
no provider-config isolation, no Admin Web screens, no real financial transaction, no deployment, no
merge to `main`.

One fixture nuance worth recording: posting a journal that touches a **wallet's** ledger account
additionally requires the pre-existing customer financial policy (`CustomerFinancialEligibilityService`),
which is unrelated to this phase and identical to the pre-existing `v1-harden-01` blocker. Isolation
acceptance therefore drives institution-owned settlement/suspense accounts and raw-SQL paths
instead of fabricating KYC evidence.

---

## 11. Verification

Commands (real PostgreSQL 18.4 on `127.0.0.1:5432`):

```bash
# Phase 2 acceptance (16 cases)
NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=monienaija DB_USER=monienaija \
DB_PASSWORD=… PG_TEST_CONFIRM_DISPOSABLE_CLUSTER=yes PG_TEST_RUN_ID=<id> \
npx jest --config jest.integration.config.js --runInBand \
  --runTestsByPath test/institution-financial-ownership.integration.spec.ts

# Phase 2 unit contract (11 cases) + Phase 1 suites
npx jest --runTestsByPath test/institution-financial-ownership.unit.spec.ts \
  test/institution-foundation.unit.spec.ts test/governed-action.registry.spec.ts

# full unit/backend suite, types, lint, format, build
npm test && npx tsc --noEmit -p tsconfig.json && npm run lint && npm run format:check && npm run build
```

| Check                                                             | Result                      |
| ----------------------------------------------------------------- | --------------------------- |
| Phase 2 acceptance integration                                    | **16/16**                   |
| Phase 2 unit contract                                             | **11/11**                   |
| Phase 1 acceptance (`institution-foundation`)                     | **18/18**                   |
| Phase 1 unit                                                      | **9/9**                     |
| Wallet ownership resolution integration                           | **18/18**                   |
| Migration chain from empty database                               | **17/17**                   |
| a8 + a19 + a20 (lifecycle/funding/outlets)                        | **67/67**                   |
| Authorization foundation + capability registry + ledger reversals | **82/82**                   |
| `npm test`                                                        | **240 suites / 2850 tests** |
| `tsc --noEmit`, `npm run lint`, `format:check`, `nest build`      | clean                       |

Phase 1's case 18 previously asserted that no institution column existed on
`wallet_accounts`/`ledger_journals`; Phase 2 adds them by design, so that assertion now proves the
stronger property — the columns exist and are **empty** (nothing fabricated).

### Acceptance case map

1. one identity, separate enrolments per institution · 2. enrolment access control ·
2. governed attribution with evidence · 4. unauthorized attribution rejected ·
3. atomic rollback of consumption + attribution · 6. concurrent attribution safety ·
4. historical wallet/journal preservation · 8. no fabricated default institution ·
5. affiliation ≠ wallet ownership · 10. same-institution posting succeeds ·
6. cross-institution posting rejected (service + DB) · 12. unattributed accounts cannot bypass ·
7. institution suspension blocks new authorization · 14. governed ownership protections intact ·
8. resolver revalidation + concurrency · 16. complete migration chain.
