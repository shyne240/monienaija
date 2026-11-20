# ARENA 5 — FROZEN / BLACKLISTED customer restriction admission fix

**Date:** 2026-11-20
**Branch:** `arena/d085888e-monienaija` (branched from `f8d5105` of `arena/5-main-web-integration`)
**Authorization:** `docs/integration/COMMERCIAL-IMPLEMENTATION-COORDINATION.md` §6 ("this document is the authorization")
**Scope:** one authorized defect fix in the frozen module `src/kyc-verification/customer-financial-eligibility.service.ts`, plus the restriction writer that must serialize with it (`src/customer-eligibility/customer-eligibility.service.ts`). No financial-engine module was otherwise modified. No production flag was enabled and nothing was deployed.

---

## 1. Defect (confirmed, then reproduced)

`CustomerFinancialEligibilityService.require()` — the single transactional gate every financial path
goes through — never read `customer_restrictions`. `CustomerEligibilityService.getOperatingStatus()`
correctly reported `canOperate=false` / `blockedReasons=['FROZEN']`, but no money path consulted it.

Reproduction (before the fix, real PostgreSQL, same suite as the evidence below):
`expect(...).rejects.toThrow(/frozen/i)` failed with **"Received promise resolved"** for transfer,
funding, withdrawal-lane journal, wallet provisioning and the wallet-ownership boundary. That is the
Arena 3 finding: an administratively FROZEN customer could still move money.

---

## 2. The fix

### 2.1 Admission (the authorization's exact placement)

`require()` now reads active restrictions **inside the caller's existing transaction, after the
`customers` row lock, and before any policy/evidence I/O**:

```sql
SELECT type FROM customer_restrictions
 WHERE customer_id=$1 AND type IN ('BLACKLISTED','FROZEN') AND is_active=true AND deleted_at IS NULL
 ORDER BY type <same rowLock as the customer read>
```

- `BLACKLISTED` → `409 Customer account is restricted — financial operations are blocked`
  (precedence matches `operatingStatus()`, where `BLACKLISTED` outranks `FROZEN`).
- `FROZEN` → `409 Customer account is frozen — financial operations are blocked`.
- One statement, one round trip, read-only, reusing the caller's lock strength
  (`FOR UPDATE` by default, `FOR SHARE` for read-only callers). No new transaction, no cross-service
  call, no change to `WalletFinancialBoundaryService`, `TransferService` or any controller.
- `LIMITED` / `MANUAL_REVIEW` are **not** selected by the predicate (see §5).

### 2.2 Restriction writer (the part the authorization's snippet alone could not cover)

A restriction row that does not exist yet cannot be locked. In-flight `SERIALIZABLE` financial
transactions take their snapshot at their **first statement** — the customer row read — so a plain
read of `customer_restrictions` can miss a freeze committed a millisecond later. §4 of the task
called this out; it is closed as follows.

`CustomerEligibilityService.createRestriction()` now takes the **same `customers` row lock** before it
writes, as a real write rather than a bare locking read:

```sql
UPDATE customers SET updated_at = NOW() WHERE id=$1
```

`updated_at` only — never `version` (TypeORM's optimistic-lock column, so admin edits keep working),
and never a business/identity column (so `kyc_customer_identity_revision_changed` /
`kyc_customer_evidence_changed` triggers, which are `AFTER UPDATE OF <identity columns>`, do not fire).

### 2.3 Why this is a real serialization strategy, not a race with a smaller window

| Interleaving                                                                    | Outcome                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Freeze commits **before** the admission transaction starts                      | Admission's snapshot already contains the row → 409.                                                                                                                                                                                                                                                                                                                                                      |
| Admission takes the customer lock **first**                                     | The freeze's `UPDATE` blocks until the financial transaction commits; the restriction becomes effective only afterwards → serialized _before_ the freeze, never after it.                                                                                                                                                                                                                                 |
| Freeze holds the customer lock, admission starts (READ COMMITTED)               | Admission blocks; after commit its locking read returns the newest row and its next statement takes a fresh snapshot → sees the restriction → 409.                                                                                                                                                                                                                                                        |
| Freeze commits while a `SERIALIZABLE` admission already holds an older snapshot | The admission's locking read on a row updated after its snapshot is aborted by PostgreSQL with `40001 could not serialize access due to concurrent update`; the bounded retries the financial flows already run (`TransferService` 3 attempts, `runSerializableWithRetry`, funding/agent paths) re-run admission against a fresh snapshot, where the row is present → 409, instead of silently admitting. |
| Restriction row exists but `is_active=false` or soft-deleted                    | Not selected → not a freeze (verified).                                                                                                                                                                                                                                                                                                                                                                   |

Tests 10, 11 and 12 in `test/v1-frozen-restriction-admission.integration.spec.ts` prove each of these
against real PostgreSQL (two/three real connections, not mocks). Test 11 asserts the actual driver
error code `40001` is produced by stale-snapshot admission.

**Documented obligation:** any future restriction _deactivation/reactivation_ endpoint must call
`lockCustomerFinancialControl()` too. No such endpoint exists today (see §7).

---

## 3. Idempotency, journal integrity and failure semantics — preserved

- Nothing was added to the ledger, journal, reservation or idempotency code. The restriction check
  sits before all of it and only throws `ConflictException` (409), which is the status the gate
  already used.
- `TransferService` catches 4xx from the ledger post and records `markFailed` in the same
  transaction (`failureCode=LEDGER_REJECTED`, `failureStatusCode=409`, message preserved) and posts
  **no journal**; a replay of the same idempotency key returns the same failed result. Pinned by
  test 9: two calls with one key → two identical `/frozen/i` rejections, **1** `transfers` row, **0**
  journals, balances unchanged.
- `CustomerFundingService.approve` leaves the request `PENDING` and credits nothing (test 6).
- Existing retryable-error handling in `require()` is untouched: the restriction read happens before
  the policy/evidence `try` blocks, so `40001`/`40P01` from the _lock itself_ propagate exactly as
  before (the caller owns the retry), and the existing policy/evidence abort tests still pass.

---

## 4. Reachability — which entry points actually reach the boundary

`test/financial-admission-reachability.spec.ts` pins this as an executable reviewed table (29
assertions). Summary:

| Entry point                                                                                  | Reaches the boundary via                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Wallet→wallet transfer (`transfer.service`)                                                  | **Ledger** — `postJournalInTransaction` → `WalletFinancialBoundaryService.requireAccounts` for **both** legs |
| Transfer quote / confirmation (`transfer-quote.service`)                                     | Direct — `requireAccounts`                                                                                   |
| Transfer lifecycle commit/reverse                                                            | Ledger                                                                                                       |
| Customer funding request approval (`customer-funding.service`)                               | Ledger + direct eligibility                                                                                  |
| Withdrawal (`withdrawal.service`)                                                            | Ledger (reserve/journal line on the customer wallet)                                                         |
| Deposit / inbound settlement (`deposit.service`)                                             | Ledger                                                                                                       |
| Agent cash-out (customer leg, `agent-cash-out.service`, `agent-financial-execution.service`) | Direct `require(..., lockMode 'UPDATE')` + ledger                                                            |
| Agent cash-to-cash claim (`agent-cash-to-cash-claim.service`)                                | Direct `require()` (no customer ledger line exists for cash payout)                                          |
| Agent cash-to-cash initiation (`agent-cash-to-cash.service`)                                 | Ledger (institution suspense leg; customer admitted at claim)                                                |
| Virtual-account inbound funding                                                              | Direct — `requireCustomerWallet`                                                                             |
| Partner external operations (+lifecycle)                                                     | Direct — `requireCustomerWallet`                                                                             |
| Financial commitment (wallet obligation)                                                     | Direct — `requireCustomerWallet`                                                                             |
| Wallet provisioning (`wallet.service`, `customer-wallet.service`)                            | Direct `require()`                                                                                           |
| Customer self-service profile write                                                          | Direct `require(..., false)`                                                                                 |
| Limit enforcement / KYC tier resolution                                                      | Direct `require()`                                                                                           |
| a7 product persistence / financial effect                                                    | Direct `require()` + ledger                                                                                  |
| B2F journal governance                                                                       | Ledger                                                                                                       |
| Authentication session issue/validate/step-up                                                | Direct `require()` — see §5 side effect                                                                      |

**Reviewed exceptions (no customer-owned account moves, so customer restriction admission is not the
governing authority):**

1. `agent-funding.service`, `banking/agent-float-funding.service` — institution ↔ agent wallet float.
2. `commercial-accounting.service` — finance revenue/VAT/commission accounts (SYSTEM-owned) only.
3. Agent operating-wallet lane (`requireAgentWallet`) — governed by agent status/class, not customer
   tier policy. Unchanged by this patch.
4. Governed exact reversals with `recoveryAuthority` in `LedgerService.postWithinTransaction` — the
   only documented exemption from the ledger gate; it requires every immutable original line to be
   inverted exactly. Unchanged, and pinned by the reachability test.
5. `SYSTEM`-owned (platform custody) wallets — never a customer financial lane. Unchanged.

No controller carries its own restriction check, and the reachability test fails if one ever does.

---

## 5. Product policy: LIMITED / MANUAL*REVIEW are unchanged, and the blast radius that \_did* change

- `LIMITED` and `MANUAL_REVIEW` remain **not** admission blockers. They keep computing
  `operatingStatus='RESTRICTED'` (`canOperate=false`) exactly as approved, and they are still
  governed by tier/purpose/limit policy. Tests 5 and 13 assert both halves of that split: the
  operating status still says RESTRICTED while a transfer and a direct admission still succeed.
  They were deliberately **not** reinterpreted as freezes.
- Because the check lives in `require()`, every _caller_ of the gate inherits it. Beyond financial
  execution this includes:
  - **customer authentication sessions** — a FROZEN/BLACKLISTED customer's session now fails closed
    (`CUSTOMER_STATUS_INELIGIBLE`, existing revocation path) instead of staying usable;
  - **wallet provisioning** — a frozen customer cannot open another wallet (test 8);
  - **customer self-service profile write** and **limit/tier diagnostics**.
    These follow the pre-existing convention that an ineligible customer has no usable session
    (`customers.status='SUSPENDED'` already behaved this way). **Product decision to confirm:** if the
    app must let a frozen customer log in to see a "your account is restricted" state, that requires a
    follow-up that separates _session issuance_ from _financial admission_ — it must not be done by
    weakening this gate.

---

## 6. Test evidence (executed, not projected)

Runtime: PostgreSQL 18.4 (embedded, disposable local cluster), Node 22.22.3.

```
test/v1-frozen-restriction-admission.integration.spec.ts   (real PostgreSQL)
  ✓ 1. TRANSFER: a FROZEN source customer is refused and no money moves
  ✓ 2. TRANSFER: a FROZEN destination customer is refused (no silent credit)
  ✓ 3. TRANSFER: BLACKLISTED is refused with its own restricted verdict
  ✓ 4. TRANSFER: an INACTIVE FROZEN restriction no longer blocks
  ✓ 5. TRANSFER: LIMITED is NOT reinterpreted as a full freeze
  ✓ 5. TRANSFER: MANUAL_REVIEW is NOT reinterpreted as a full freeze
  ✓ 6. CUSTOMER_FUNDING: approval for a frozen customer is refused and stays PENDING
  ✓ 7. WITHDRAWAL / CASH-TO-CASH / settlement lane: every journal touching a frozen wallet is refused
  ✓ 8. WALLET PROVISIONING: a frozen customer cannot open another wallet
  ✓ 9. IDEMPOTENCY: a refused transfer replays the same 409 and never posts a journal
  ✓ 10. CONCURRENCY: a freeze waits for the in-flight admission and applies afterwards
  ✓ 11. CONCURRENCY: a stale SERIALIZABLE snapshot aborts instead of admitting a frozen customer
  ✓ 12. CONCURRENCY: an uncommitted freeze blocks admission, which is refused once it commits
  ✓ 13. OPERATING STATUS stays consistent with admission for every restriction type
  14 passed
```

```
test/customer-financial-restriction-admission.spec.ts   12 passed   (decision table + statement shape/order)
test/financial-admission-reachability.spec.ts           29 passed   (wiring table + ledger-gate invariant)
test/customer-eligibility.service.spec.ts                6 passed   (incl. writer lock assertion)
test/customer-financial-eligibility-contention.spec.ts   2 passed   (unchanged abort semantics)
```

Regression runs re-executed here against the same disposable cluster (all green):

```
test/v1-system-01-suspended-customer-financial-boundary.integration.spec.ts   5 passed
test/funding-defunding-conservation.integration.spec.ts + bank-transfer-commercial-settlement   10 passed
test/v1-limit-04-limit-runtime.integration.spec.ts + v1-agent-cash-to-cash-operations   33 passed
npm test (root unit suite, 292 files)          289 suites / 3409 tests passed
```

`npm test` reports three unrelated failures, all pre-existing in this sandbox:
`consolidated-matrix.spec.ts` asserts a recorded evidence commit
(`dd1b6314…`) is an ancestor of `HEAD`, which cannot hold in this single-commit clone; and
`module-di-wiring.spec.ts` / `a7-product-command.module.spec.ts` were killed by the OS
(`signal=SIGKILL`, jest worker OOM) while a second Jest process was running concurrently — both pass
when re-run alone (`12 passed`). None of the three touches the changed code.

**Negative control (the tests are not vacuous).** With only the admission check removed from
`require()` and everything else identical, the same integration file reports **11 failed, 3 passed**
— every frozen/blacklist transfer, funding, withdrawal-lane, provisioning, idempotency and
concurrency case fails with "Received promise resolved", exactly the reported defect. The 3 that
pass are the `LIMITED`/`MANUAL_REVIEW` non-regression cases, which must pass either way.

---

## 7. Remaining gaps and integration status

1. **No restriction deactivation/reactivation API exists.** `POST /customers/:id/restriction` can only
   create; there is no `PATCH`/`DELETE` and the unique index is `(customer_id, type) WHERE deleted_at
IS NULL`, so an active FROZEN row cannot currently be lifted through the API. Tests 4 and 13 model
   the required state (`is_active=false`) with the same lock discipline. **A deactivation endpoint is a
   product/authorization decision and must call `lockCustomerFinancialControl()`.** The security
   direction is safe (fail-closed); the operational direction is not yet available.
2. **Cash-to-cash initiation and withdrawal were verified at the boundary, not end-to-end.** Driving
   those two flows end-to-end needs the institution/agent fixture stack; the assertion used here is
   the exact code path they take (`LedgerService.postWithinTransaction → requireAccounts → require()`
   plus `requireCustomerWallet`), proven on real journals, plus the reachability table.
3. **Full-PostgreSQL suite not re-run in this sandbox.** Only the suites listed in §6 were executed
   against the disposable cluster (the suite in `test:pg` takes ~15 minutes per its own header note and
   was not re-run here); the root unit suite was run separately in full. CI remains the authoritative
   full-matrix gate.
4. **Session/authentication side effect** (§5) needs a product confirmation, not a code change in this
   fix.
5. **No flags enabled, no deployment.** No `KYC_TIER_*`/financial feature flag was touched; the
   coordination doc's remaining next steps (enabling tier-limit enforcement in non-prod acceptance,
   publishing §4 contracts) are untouched by this patch.
6. **Files changed:** `src/kyc-verification/customer-financial-eligibility.service.ts` (fix),
   `src/customer-eligibility/customer-eligibility.service.ts` (writer serialization),
   `test/customer-eligibility.service.spec.ts`, `test/customer-financial-eligibility-contention.spec.ts`
   (fixture support for the new read/lock), plus the three new test files above.
