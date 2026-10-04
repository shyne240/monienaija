# V1-SYSTEM-01 — Cross-Domain V1 Security, Financial-Integrity & Authorization Audit

**Branch:** `arena/01a10374-monienaija`
**Starting HEAD:** `a805d93` (`docs(customer): add V1-CUSTOMER-09 support and account resolution report`)
**Final HEAD:** `049668b` (`fix(transfer,customer-funding): enforce customer-suspension at the money-movement boundary (V1-SYSTEM-01 high)`)
**Production code changed:** YES — two focused fixes (see §6)
**Exact commits:**
- `3f419bf` — `fix(agent): close C2C claim phone-binding bypass (V1-SYSTEM-01 critical)`
- `049668b` — `fix(transfer,customer-funding): enforce customer-suspension at the money-movement boundary (V1-SYSTEM-01 high)`

**Final status: B) AUDIT COMPLETE — P0/P1 FIXES IMPLEMENTED**

---

## 1. Executive Summary

This was an audit-first, cross-domain review of MonieNaija's V1 financial core: Wallet→Wallet
transfer, Wallet→Cash (agent cash-out), Cash→Wallet (agent cash-in), Cash→Cash (agent-desk C2C
initiate/claim/expiry), customer funding, fees/VAT/commission accounting, limits, and ledger
integrity — spanning authorization, PIN/OTP/MFA, idempotency, concurrency, commercial accounting,
and operational hygiene (Parts A–R as scoped).

Two real, exploitable findings were confirmed and fixed:

1. **CRITICAL — Cash→Cash claim phone-binding bypass.** The claim flow never verified that the
   claiming customer actually *owned* the transfer's beneficiary phone — only that they typed the
   right digits and could prove they controlled their *own* phone via OTP. Any registered,
   KYC-approved customer who learned a victim's phone number and the 8-digit transfer code could
   redirect the victim's Cash→Cash funds into their own wallet. **Fixed** in `3f419bf`.
2. **HIGH — Suspended customers could still receive money.** `TransferService` (Wallet→Wallet) and
   `CustomerFundingService.approve` (Customer Funding) never re-checked the *current*
   `customers.status` at the point money actually moved — only `WalletAccount.status`, which is
   set to `ACTIVE` at wallet creation and never transitioned when a customer is later suspended.
   Agent cash-in, agent cash-out, and C2C claim already correctly re-check customer status; W2W
   and funding-approval did not. **Fixed** in `049668b`.

Everything else audited (idempotency design, limit-reservation concurrency, PIN/transaction-PIN
lockout, C2C OTP purpose-binding, suspension enforcement for the *initiating* party via the
session-validation guard, ledger double-entry invariants, SUPPORT-boundary enforcement, and
dependency/infra posture) was found to be either already correctly implemented, already covered by
genuine concurrency tests from prior V1 tasks, or a pre-existing, explicitly out-of-scope/accepted
gap. No other P0/P1-caliber findings were identified. No unrelated refactoring was performed; no
excluded-scope functionality was touched; no dependency upgrades were made.

---

## 2. Architecture Areas Audited

- **Wallet→Wallet** (`src/transfer/transfer.service.ts`, `transfer-lifecycle.service.ts`)
- **Wallet→Cash / agent cash-out** (`src/agent/agent-cash-out.service.ts`)
- **Cash→Wallet / agent cash-in** (`src/agent/agent-cash-in.service.ts` — read via grep/targeted checks)
- **Cash→Cash** initiate (`agent-cash-to-cash.service.ts`), claim (`agent-cash-to-cash-claim.service.ts`,
  `agent-desk-otp.service.ts`, `agent-desk-otp.constants.ts`), expiry (`a17` suite / expiry service)
- **Customer funding** (`src/customer-funding/customer-funding.service.ts`)
- **Limits** (`src/limit-catalog/limit-enforcement.service.ts`)
- **Fees / VAT / commission / commercial accounting** (`src/fee-rules/*`, `src/commission/*`,
  `src/commercial-accounting/*`, `src/commercial-decision/*`)
- **Customer & agent authentication/session** (`src/customer-authentication/*`,
  `src/authorization/runtime-access.guard.ts`, `src/agent-authentication/*`)
- **Customer lifecycle / suspension** (`src/customer/customer.service.ts`, `src/customer-wallet/*`,
  `src/wallet/wallet-account.entity.ts`)
- **Transaction PIN** (`src/customer/customer-transaction-pin.service.ts`,
  `src/agent-authentication/agent-transaction-pin*`, `customer-app.controller.ts` PIN endpoints)
- **Workforce/SUPPORT boundary** (`src/authorization/workforce-session.service.ts`, route-policy)
- **Dependency/infra posture** (`npm audit`, `src/main.ts`, `src/config/environment.ts`)

---

## 3. Findings Table

| # | Severity | Category | Finding | Evidence | Impact | Exploitability | V1 Impact | Recommendation |
|---|----------|----------|---------|----------|--------|-----------------|-----------|-----------------|
| 1 | **CRITICAL** | G (C2C adversarial) / F (OTP binding) | C2C claim never verified the claimant owns the beneficiary phone | `agent-desk-otp.service.ts` sends OTP only to `customerId`'s own verified phone; `agent-cash-to-cash-claim.service.ts` only string-compared caller-supplied `beneficiaryPhone` to the stored value; zero references to `customer_contact_methods` anywhere in the claim service (pre-fix) | Attacker who knows victim's phone + transfer code can redirect victim's funds to their own wallet | Directly exploitable by any legitimate registered customer; no privileged access required | **A — must-fix-before-V1** | **FIXED** (`3f419bf`) |
| 2 | **HIGH** | K (suspension enforcement) / N (data consistency) | Suspended customers could still RECEIVE Wallet→Wallet transfers and have funding requests approved/credited after suspension | `WalletAccount.status` set once at creation, never transitioned on suspension (grep: zero write sites moving it away from ACTIVE); `transfer.service.ts` and `customer-funding.service.ts` approve() only checked wallet/request status, not live `customers.status` | A customer under investigation/suspension could still accumulate funds via internal transfers/funding, undermining the point of suspension | Exploitable by any other active customer sending to a known suspended account, or a maker/checker approving a stale pending request | **A — must-fix-before-V1** | **FIXED** (`049668b`) |
| 3 | Info/Positive | B/H (concurrency) | Limit reservation uses `INSERT...ON CONFLICT DO NOTHING` + `SELECT...FOR UPDATE` row lock per (principal, profile, product, direction, channel, dimension, currency, window) before check-then-update | `limit-enforcement.service.ts` lines ~347–468; genuine `Promise.all` concurrency tests already exist and pass (`v1-limit-03-limit-usage` tests 10–12, 16) | Correctly prevents double-counting/limit bypass under concurrent requests | N/A (control, not a gap) | **E — accepted by design** | No action |
| 4 | Info/Positive | F (PIN lockout) | Transaction-PIN create/change endpoints correctly prevent lockout bypass: first-time-create is blocked once a PIN exists (locked or not), and change requires proof of the current PIN (same lockout counter as transfer authorization) | `customer-app.controller.ts` `setTransactionPin`/`changeTransactionPin` (V1-CUSTOMER-05); mirrored for agents in `agent-authentication` controller | No bypass path found for either customer or agent transaction PIN lockout | N/A | **E — accepted by design** | No action |
| 5 | Info/Positive | K (suspension, initiating party) | A customer's own authenticated actions are blocked on their very next request after suspension — `AuthenticationSessionService.validate()` re-reads `customers.status` fresh from the DB on every call, not just at login, and is invoked by the single global `RuntimeAccessGuard` | `authentication-session.service.ts` (S-FIX-01 / audit contradiction C-4 comment), `runtime-access.guard.ts` | Stale sessions do NOT bypass suspension for the account holder's own actions | N/A | **E — accepted by design** | No action |
| 6 | Medium (narrowed) | G (C2C brute force) | `cash_to_cash_transfers.failed_attempts` increments via read-then-write (`UPDATE ... SET failed_attempts=$1 ...` using a value read outside a row lock), theoretically allowing two concurrent wrong-code guesses to both compute the same `nextAttempts` and under-count towards lockout | `agent-cash-to-cash-claim.service.ts` pre-check and SERIALIZABLE sections | Could marginally extend the effective brute-force budget beyond `MAX_FAILED_ATTEMPTS=5` under precise concurrent guessing | Post-fix-#1, exploitability is now narrow: the attacker would already need to own the phone matching the transfer's beneficiary (i.e. be a legitimate claimant who simply doesn't know the code) to get this far | **C — post-V1 hardening** | Wrap the failed-attempt increment in the existing SERIALIZABLE/row-lock pattern already used elsewhere in the same file |
| 7 | Low | E/L (trust boundary) | No dedicated, least-privilege `SUPPORT`-type workforce session can be issued anywhere in the codebase; real support staff must use a broader `OPERATOR` (or `FINANCE_ADMIN`-flagged `PRIVILEGED`) session | Re-confirmed from V1-CUSTOMER-09 (`A2WorkforceSessionService` only ever resolves `OPERATOR`/`PRIVILEGED`); route-policy and controller guards already correctly handle a `SUPPORT` principal if one is ever issued (36-test boundary suite from V1-CUSTOMER-09) | Support staff today operate with more privilege than a dedicated support role would have; this is an availability/least-privilege gap, not a bypass — the support boundary itself (no PIN reset, no OTP bypass, no suspension bypass, no cancellation, no C2C bypass, no balance mutation) is independently enforced and tested | Not directly exploitable; it is an authorization-model completeness gap, not a hole | **D — out of scope / recommended next task** (per standing instruction: reassess, do NOT fix here) | Dedicated follow-up task to design/implement a genuine least-privilege `SUPPORT` session issuance path |
| 8 | Low (residual, now reviewed) | D (IDOR) | `claimantPrincipal` binding check (`principal.customerId === dto.customerId`) in C2C claim only fires for `principal.type === 'CUSTOMER'`; no equivalent check for AGENT-principal/no-principal callers | `agent-cash-to-cash-claim.service.ts` | By design, the agent-desk flow lets an authenticated agent execute a claim on behalf of any walk-in customer (that is the intended business model — the customer is physically present at the agent, not self-serving); the phone-binding fix (#1) plus PIN+OTP jointly authenticate the real customer regardless of principal type | Not independently exploitable once #1 is fixed | **E — accepted by design** | No action |
| 9 | Low | Q (dependency/infra) | Backend `npm audit`: 41 vulnerabilities in full dev tree (1 moderate, 40 high — mostly transitive tooling e.g. `fast-uri`, `undici`); 4 high in production-only tree (`fastify` + `fast-uri` transitive via `@nestjs/platform-fastify`) | `npm audit` / `npm audit --omit=dev` output captured this session | Known, pre-existing; no evidence of exploitation in this codebase's usage pattern | Not assessed as directly exploitable in this deployment context | **C — post-V1 hardening** (per standing instruction: do not upgrade dependencies in this task) | Track for a dedicated dependency-upgrade task; re-run `npm audit fix` only after compatibility testing |
| 10 | Info | Q (CORS) | No `app.enableCors()` in `src/main.ts` | `src/main.ts` read in full | Backend is consumed by native mobile apps, not a browser SPA; absence of CORS headers is the secure default for a non-browser API and is not a gap | N/A | **E — accepted by design** | Revisit only if/when a browser-based admin console is added |
| 11 | Info | M (audit trail) | Audit events already capture actor/target/action/timestamp with no secrets (verified via existing C2C `30. audit contains no secrets` test and prior V1 task audit trails); no new gap found in the two services touched this session | `a16` test 30; `audit.service.ts` usage patterns in `transfer.service.ts`/`customer-funding.service.ts` | N/A | N/A | **E — accepted by design** | No action |
| 12 | Info | O (migration/test hygiene, not security) | `test/migration-chain.integration.spec.ts` and `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts` hardcode an expected migration count/latest-migration-name list that is now stale (81 migrations exist vs. an expected 80; latest timestamp `1785753600080` not in the hardcoded list); `test/v1-workforce-bootstrap-01.integration.spec.ts` references a missing template file | Confirmed **pre-existing** by stashing this session's changes and re-running — identical 4 failures occur on baseline `a805d93` | Test-maintenance debt only; not a security or financial-integrity defect; not introduced by this session | N/A | **C — post-V1 hardening** (out of this task's fix scope — not financial-integrity/security) | Update the hardcoded expectations in a dedicated documentation/test-hygiene task |

---

## 4. Severity Classification Summary

- **A — must-fix-before-V1:** Findings #1, #2 — both fixed in this session.
- **B — should-fix-if-practical:** none remaining (both A-classified findings were fixed; #6 was
  downgraded to C after #1 closed its primary attack path).
- **C — post-V1 hardening:** #6 (C2C failed-attempt counter race), #9 (dependency upgrades),
  #12 (stale migration-count test expectations).
- **D — V2/excluded/out of scope:** #7 (SUPPORT least-privilege session — explicitly must NOT be
  fixed in this task per standing instruction; reassessed only).
- **E — false-positive/accepted-by-design:** #3, #4, #5, #8, #10, #11.

---

## 5. Evidence Detail for the Two Fixed Findings

### 5.1 C2C claim phone-binding bypass (CRITICAL)

**Vulnerability.** `AgentCashToCashClaimService.execute()` validated:
- `preTransfer.beneficiary_phone !== canonicalPhone` — the caller-supplied phone string matches
  the transfer's stored beneficiary phone.
- A valid OTP for `customerId` with purpose `CASH_TO_CASH_CLAIM`.

But `AgentDeskOtpService.issue()` always sends that OTP to **`customerId`'s own** verified primary
phone (`SELECT value FROM customer_contact_methods WHERE customer_id=$1 AND type='PHONE' AND
is_primary=true AND verified_at IS NOT NULL`) — there is no parameter to target a different phone.
So the two checks together only proved "the caller typed the right digits" and "the caller controls
their own phone" — never that the claimant *owns* the beneficiary phone. A grep of the entire claim
service for `customer_contact_methods`/`registeredPhone`/`customerPhone` returned zero matches
before this fix.

**Root cause.** Missing authorization check: the claiming identity was never cross-referenced
against the transfer's intended recipient identity (phone), only against a client-supplied string.

**Fix.** New `AgentCashToCashClaimService.assertClaimantOwnsBeneficiaryPhone()`, called both in the
pre-check phase and again inside the SERIALIZABLE claim transaction (mirroring how every other
pre-check in this file is duplicated at both points). It looks up the claimant's own verified
primary phone, canonicalizes it with the same `AgentReceivingNumberService.canonicalizeTo10()` used
for the transfer's beneficiary phone (so `+234`/`234`/`0`-prefixed variants are handled
consistently), and fails closed with a generic `NotFoundException` (no enumeration) if the
claimant has no verified phone or it does not match.

**Regression tests** (`test/a16-agent-cash-to-cash-claim.integration.spec.ts`):
- `34. EXPLOIT BLOCKED: claimant whose own phone differs from the transfer beneficiary phone
  cannot steal the funds` — simulates the full attack (attacker supplies victim's phone string +
  their own valid OTP), asserts rejection, asserts the transfer stays `UNCLAIMED` with no ledger
  movement, then proves the legitimate beneficiary (owner of the phone) can still claim normally.
- `35. claimant with NO verified primary phone at all is rejected (fails closed, not open)`
- `36. claimant with an UNVERIFIED phone matching the transfer is rejected (verification is
  required, not just possession)`

All 36 tests in the suite pass (was 33; 3 added). The 33 pre-existing tests all passed unchanged
once their shared fixture helper (`createBeneficiaryCustomer`) was corrected to set `verified_at`
on the inserted contact method — those fixtures directly insert an `ACTIVE` customer via raw SQL,
bypassing the real activation gate (`CustomerService.assertVerifiedPrimaryPhone`) that would
otherwise guarantee a verified phone for any genuinely `ACTIVE` customer; the fixture fix restores
that real-world invariant rather than weakening the new check. The same stale-fixture issue existed
in 8 other PG integration test files that exercise the claim service
(`a17-agent-cash-to-cash-expiry`, `v1-agent-history-01`, `v1-commercial-accounting-01`,
`v1-commercial-decision-03c-cash-to-cash-snapshot`, `v1-commercial-scenario-matrix-01`,
`v1-commission-runtime-wiring`, `v1-commission-settlement-01`, `v1-fee-runtime-wiring`,
`v1-limit-05-flow-matrix`) and was corrected identically in each.

### 5.2 Suspended customer can still receive money (HIGH)

**Vulnerability.** `WalletAccount.status` is set to `ACTIVE` at creation
(`src/wallet/wallet.service.ts`) and is **never** written anywhere else in the codebase (confirmed
by grepping every `WalletStatus.*` assignment site). `TransferService.executeWithinTransaction`
only checked `sourceWallet.status`/`destinationWallet.status`, never the owning customer's live
`customers.status`. `CustomerFundingService.approve()` only checked the funding request's own
status and the destination wallet's status, never the customer's live status at approval time
(the request may have been created while the customer was `ACTIVE` and only approved later, after
suspension). By contrast, agent cash-in, agent cash-out, and C2C claim already independently
`SELECT status FROM customers WHERE id=$1` and reject with `customer.status !== 'ACTIVE'`.

**Root cause.** Inconsistent enforcement of the same business rule across sibling financial flows —
3 of 5 flows correctly re-checked live customer status at the point money moves; 2 did not.

**Fix.**
- `TransferService.executeWithinTransaction`: immediately after the existing `WALLET_NOT_ACTIVE`
  check, both wallets' owning customer status is re-checked (new `CUSTOMER_NOT_ACTIVE` failure
  code, HTTP 409). A UUID-shaped `customerId` with **no** backing `customers` row is intentionally
  **not** blocked — `WalletAccount.customerId` is documented as an "opaque reference," and in
  production every genuine wallet is created through flows that always supply a real customer id;
  an absent row only occurs for non-customer/system wallets (confirmed necessary: 40+ existing
  accounting/commission/fee tests in `v1-commercial-accounting-01` alone create wallets with
  synthetic `randomUUID()` customer ids with no backing customer row, by design, to isolate ledger
  behaviour from the customer domain).
- `CustomerFundingService.approve`: inside the same `SERIALIZABLE` transaction, immediately after
  the existing wallet-status check and before any ledger posting, the funding request's
  `customer_id` status is re-checked the same way. (Funding-request creation already guarantees a
  real customer row exists, so no "no row" carve-out is needed here.)

**Regression tests** (new file
`test/v1-system-01-suspended-customer-financial-boundary.integration.spec.ts`, 5 tests):
1. W2W transfer **to** a suspended destination customer is rejected, no ledger movement.
2. W2W transfer **from** a suspended source customer is rejected.
3. W2W transfer between two active customers still succeeds (no false-positive block).
4. Funding approval for a customer suspended **after** request creation is rejected, no credit,
   request stays `PENDING`.
5. Funding approval for a still-active customer still succeeds (no false-positive block).

---

## 6. Did Production Code Change? Exact Commits

**Yes**, two focused fixes, each with its own commit and regression tests:

| Commit | Files | Summary |
|---|---|---|
| `3f419bf` | `src/agent/agent-cash-to-cash-claim.service.ts`; `test/a16-agent-cash-to-cash-claim.integration.spec.ts`; `test/a17-agent-cash-to-cash-expiry.integration.spec.ts`; `test/v1-agent-history-01.integration.spec.ts`; `test/v1-commercial-accounting-01.integration.spec.ts`; `test/v1-commercial-decision-03c-cash-to-cash-snapshot.integration.spec.ts`; `test/v1-commercial-scenario-matrix-01.integration.spec.ts`; `test/v1-commission-runtime-wiring.integration.spec.ts`; `test/v1-commission-settlement-01.integration.spec.ts`; `test/v1-fee-runtime-wiring.integration.spec.ts`; `test/v1-limit-05-flow-matrix.integration.spec.ts` | C2C claim phone-binding fix + 3 new regression tests + 9 stale-fixture corrections |
| `049668b` | `src/transfer/transfer.enums.ts`; `src/transfer/transfer.service.ts`; `src/customer-funding/customer-funding.service.ts`; `test/v1-system-01-suspended-customer-financial-boundary.integration.spec.ts` (new) | Suspension-boundary fix for W2W + funding approval + 5 new regression tests |

No migrations were added or changed. No excluded-scope functionality was touched. No dependency
versions were changed.

---

## 7. Tests Executed — Exact Counts

- **PG integration suite** (`npm run test:pg`, real embedded PostgreSQL, 82 suites):
  **1632 passed / 1636 total** (4 pre-existing, unrelated failures — confirmed pre-existing by
  stashing this session's changes and re-running against baseline `a805d93`, which reproduces the
  identical 4 failures in `test/migration-chain.integration.spec.ts` (2) and
  `test/v1-workforce-bootstrap-01.integration.spec.ts` (1) and
  `test/v1-hardening-06-admin-customer-investigation.integration.spec.ts` (1) — all are stale
  hardcoded migration-count/template-path expectations, not security or financial-integrity
  defects, and not introduced by this session).
- **Unit suite** (`npm test`, 172 suites): **1801 passed / 1801 total**, no regressions.
- **New/modified regression tests added this session:** 8 new `it(...)` cases across 2 files
  (3 in `a16-agent-cash-to-cash-claim`, 5 in the new `v1-system-01-suspended-customer-financial-
  boundary` suite), all passing. 9 existing test files had a one-line fixture correction
  (`verified_at` on a raw-SQL-inserted `customer_contact_methods` row) to keep their ACTIVE-customer
  fixtures realistic post-fix; zero test assertions were weakened or removed to make this pass.
- **TypeScript compilation:** `npx tsc --noEmit` clean before and after all changes.

### Concurrency tests

No new concurrency test was required for the two shipped fixes (neither introduces a new
concurrency surface: the C2C phone check is a pure read inside the existing SERIALIZABLE
transaction boundary already covered by test `27. concurrent claims converge to one success`; the
suspension check is likewise a pure read inside the existing transaction boundaries already
covered by `a5-transfer-lifecycle` and `v1-001-customer-funding` concurrency tests). Genuine,
already-passing `Promise.all`-based concurrency tests covering the areas audited include:
- `v1-limit-03-limit-usage.integration.spec.ts` tests 10–12, 16 — `SELECT...FOR UPDATE`
  serialization of concurrent limit reservations, SERIALIZABLE retry races, concurrent
  same-window reservation summing.
- `a16-agent-cash-to-cash-claim.integration.spec.ts` test 27 — concurrent claims against the same
  transfer converge to exactly one success.
- `a17-agent-cash-to-cash-expiry.integration.spec.ts` tests 16–17 — concurrent expiry workers do
  not double-process; claim-vs-expiry race produces exactly one valid terminal state.
- `a13`/`a14`/`a15`/`a5-transfer-lifecycle`/`v1-commercial-accounting-01` and others also carry
  dedicated concurrent-request tests for cash-in, cash-out, transfer idempotency, and accounting
  journal single-posting guarantees.

These were read and (where touched by this session's changes) re-run; they were not rewritten.

---

## 8. Financial-Integrity, Authorization, Security, Commercial-Accounting, Ledger & Operational Findings

- **Financial atomicity (Part A):** All money-moving flows execute inside a single
  `SERIALIZABLE` database transaction per operation (transfer, cash-in, cash-out, C2C
  initiate/claim, funding approve), with retry-on-serialization-failure loops
  (`MAX_SERIALIZABLE_ATTEMPTS`), not try/catch-only error handling. Confirmed by direct code
  reading, not inference.
- **Idempotency (Part C):** Transfer and funding both use a global unique constraint on the
  idempotency key plus a stored request-hash comparison to distinguish a true replay (same hash →
  return prior result) from a key-reuse-for-different-request conflict (different hash → 409).
  C2C claim uses the canonical `idempotency_records` table with the same hash-comparison pattern.
  `customerId` is always taken from the server-side authenticated principal
  (`principal.customerId!`) in customer-facing controllers, never from client-controlled body
  fields — confirmed for customer funding creation.
- **Limits (Part H):** Five limit buckets (`WALLET_TRANSFER`, `CASH_TO_WALLET`, `WALLET_TO_CASH`,
  `CASH_TO_CASH`, `CUSTOMER_FUNDING`) are isolated by a composite key including `product` and
  `direction`, so usage in one bucket cannot leak into another. Reservation/commit/release timing
  follows a reserve-before-execute, commit-or-release-after pattern consistently across the flows
  reviewed.
- **Ledger integrity (Part J):** Every journal posting reviewed enforces debit=credit via
  `LedgerService.postJournal`'s line-sum validation; `WalletAccount` has no balance column (balance
  is always ledger-derived); NGN-only was enforced at the currency-normalization layer in every
  flow reviewed. Full reconciliation-platform-level review was out of scope per the standing
  instruction — this audit only re-confirmed the no-orphan/no-duplicate-posting invariants already
  covered by existing tests (e.g. `v1-commercial-accounting-01` tests 4–7, 24).
- **Suspension enforcement (Part K):** Now consistently enforced across all five money-moving
  flows at the point funds actually move (post-fix), in addition to the pre-existing, independent,
  per-request enforcement for the suspended customer's *own* actions via
  `AuthenticationSessionService.validate()` + `RuntimeAccessGuard` (re-reads live `customers.status`
  on every authenticated request, not just at login — stale sessions do not bypass suspension for
  self-service actions).
- **SUPPORT boundary (Part L):** Re-ranked, not fixed, per standing instruction. See Finding #7.
  The boundary itself (no PIN reset, no OTP bypass, no suspension bypass, no cancellation, no C2C
  bypass, no balance mutation reachable via any `SUPPORT`-eligible route) remains independently
  enforced and tested (V1-CUSTOMER-09's 36-test boundary suite); the only gap is that a *true*
  least-privilege `SUPPORT` session cannot currently be issued, so real support staff use a
  broader role. This is an availability/least-privilege completeness gap, not a security hole.
- **Audit trail (Part M):** Spot-checked for the two services modified; no secrets are logged, and
  actor/target/action/timestamp/reference are all present on the audit events written by both
  flows (unchanged by this session's fixes, which added no new audit event types).
- **Unknown-unknown search (Part P):** The `WalletAccount.customerId` "opaque reference / may be a
  non-customer system wallet" ambiguity, and the pre-existing inconsistency between flows on
  customer-status enforcement, were the two most significant findings surfaced by this
  cross-domain pass — each individual flow's own historical audit would not have caught the
  *inconsistency* between flows, only a holistic review would.

---

## 9. Dependency / Infrastructure Findings (Part Q)

- Backend `npm audit` (full tree, including dev/test dependencies): **41 vulnerabilities
  (1 moderate, 40 high)**, dominated by transitive tooling (`fast-uri`, `undici`, and `fastify`
  itself). Production-only tree (`npm audit --omit=dev`): **4 high** (`fastify` + its transitive
  `fast-uri` via `@nestjs/platform-fastify`).
- Per standing instruction, **no dependency upgrades were made** in this task (prior Agent Mobile
  finding of 1 critical/59 high/17 moderate, with the critical in transitive tooling requiring a
  breaking Expo downgrade, remains unresolved and is reaffirmed as out of scope here).
- `src/main.ts` / `src/config/environment.ts` spot-checked: environment validation uses a strict
  Zod schema with a `production`-environment cross-check (`A6_PARTNER_ENVIRONMENT === 'production'`
  requires `NODE_ENV === 'production'`); no CORS middleware is registered, which is the secure
  default for a backend serving only native mobile clients (not a browser SPA) and is not a gap;
  a `SecurityRateLimitService` exists and is wired into OTP/registration flows.
- No migration, env-template, secret-handling, or session-token-handling defect was found beyond
  the pre-existing, unrelated test-hygiene drift noted in Finding #12.

---

## 10. Must-Fix-Before-V1 List

Both items identified were fixed in this session:
1. C2C claim phone-binding bypass (Finding #1) — **FIXED**.
2. Suspended customer can still receive money via W2W/funding (Finding #2) — **FIXED**.

No other must-fix-before-V1 items were identified.

## 11. Post-V1 List

- Finding #6: harden the C2C `failed_attempts` counter against a narrow concurrent-guess race
  (now low-likelihood/impact after Finding #1's fix; a small, self-contained change reusing the
  file's existing row-lock pattern).
- Finding #9: dependency upgrades (backend `npm audit` + previously-identified Agent Mobile
  critical), each requiring its own compatibility-tested task.
- Finding #12: refresh the hardcoded migration-count/template-path expectations in
  `migration-chain`, `v1-hardening-06`, and `v1-workforce-bootstrap-01` test suites (pre-existing
  test-maintenance debt, not a security defect).

## 12. Accepted-by-Design Items

Findings #3, #4, #5, #8, #10, #11 (see §3/§4) — all reviewed and confirmed sound as implemented;
no action recommended.

## 13. Recommended Next Task

A dedicated task to design and implement a genuine least-privilege `SUPPORT`-type workforce
session issuance path (Finding #7 / V1-CUSTOMER-09's recorded recommendation) remains the most
valuable next authorization-hardening task. This is additive (a new session-issuance path) — the
route-policy and controller guards already correctly handle a `SUPPORT` principal today.

---

## 14. Final Status

**B) AUDIT COMPLETE — P0/P1 FIXES IMPLEMENTED**

This report does not claim release readiness and is not a release commit. It documents an
audit-first security/financial-integrity review with two confirmed, fixed, and regression-tested
findings, and a ranked list of remaining post-V1 and accepted-by-design items for future work.
