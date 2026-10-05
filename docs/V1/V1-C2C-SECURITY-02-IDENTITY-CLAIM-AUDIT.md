# V1-C2C-SECURITY-02 — Cash-to-Cash Identity, Beneficiary Binding & Claim Invariant Audit

**Scope.** Narrow, proof-oriented audit of the Agent Cash→Cash (C2C) product only:
initiation (`AgentCashToCashService`), claim (`AgentCashToCashClaimService`), OTP issuance
(`AgentDeskOtpService` + `MfaExecutionService`), and expiry (`AgentCashToCashExpiryService`).
This is **not** a repeat of the V1-SYSTEM-01 cross-domain audit — V1-SYSTEM-01 and its two
fixes (commits `3f419bf`, `049668b`) are cited and their regression proof re-verified
end-to-end (Part L), but the rest of that audit's surface (wallet-to-wallet transfer, customer
funding, workforce boundary, etc.) is out of scope here and was not re-examined.

**Starting HEAD:** `7fa6935` (= V1-SYSTEM-01's final HEAD; confirmed via `git fetch origin` +
`git reset --hard origin/arena/01a10374-monienaija` at the start of this session — the
sandbox's local git state was stale/desynced but the working tree content was already
byte-identical to `7fa6935`; see "Environment note" below).

**Final HEAD:** this commit (test-only addition, no production code changed).

**Core invariant under test:** the wallet receiving the C2C principal must belong to the
same beneficiary identity designated at C2C initiation. No caller may redirect the
principal via manipulation of phone number, customer ID, wallet ID, transfer ID, claim
request, OTP target, identity-verification subject, Agent identity, or request ordering.

**Environment note.** `node_modules` and a live PostgreSQL server were not present at the
start of this session (fresh sandbox). Dependencies were reinstalled via `npm ci` (930
packages, matches prior session) and PostgreSQL 18.4 was started via the repo's own
`scripts/embedded-pg.js` (`embedded-postgres` package) — the same mechanism the repository
already uses for its real-PostgreSQL integration harness. All test runs below are against
this live server, not mocks.

---

## Part A — Initiation binding

Traced `AgentCashToCashService.execute()` (`src/agent/agent-cash-to-cash.service.ts`)
end-to-end.

- The only beneficiary identity captured at initiation is the **phone number**, canonicalized
  via `AgentReceivingNumberService.canonicalizeTo10()` (strips `+234`/`234`/`0` prefixes,
  validates `^[789]\d{9}$`). There is **no `customerId` or `walletId` captured or persisted
  at initiation** — the beneficiary is explicitly unregistered/unknown at this point (code
  comment: "We do not create beneficiary Customer wallet — beneficiary is unregistered").
- The `cash_to_cash_transfers` row created inside the SERIALIZABLE transaction persists:
  `id, agent_id, beneficiary_phone (canonical), principal_minor, fee_minor, vat_minor,
  total_minor, currency, status='UNCLAIMED', transfer_code_hash, hash_algorithm,
  transfer_code_version, failed_attempts=0, is_locked=FALSE, journal_id, reference,
  idempotency_key, correlation_id, expires_at`.
- **Beneficiary phone immutability — proven structurally, not just by convention.** Every
  `UPDATE cash_to_cash_transfers` statement in the codebase was enumerated (`grep -rn
  "UPDATE cash_to_cash_transfers"`); there are exactly four, in
  `agent-cash-to-cash-claim.service.ts` (failed-attempt/lock bookkeeping ×3, and the
  claim-success transition that sets `status='CLAIMED', claimed_at, claimant_customer_id,
  claim_journal_id, claim_idempotency_key, claim_reference`) and one in
  `agent-cash-to-cash-expiry.service.ts` (`status='EXPIRED', expired_at`). **None of them
  ever write `beneficiary_phone`.** There is no TypeORM repository for `CashToCashTransfer`
  anywhere in `src/` (`grep` for `getRepository(CashToCashTransfer)` returns nothing) — all
  access is the explicit raw SQL enumerated above, so there is no generic/ORM update path
  that could touch the column either. No admin/support/internal endpoint references
  `cash_to_cash_transfers` for writes (the only other references, in
  `agent-transaction-history.service.ts` and `customer-transaction-history.service.ts`, are
  read-only `SELECT`s for history views).
- **Conclusion: `beneficiary_phone` is immutable post-creation at the database layer — there
  is no code path, ORM or raw SQL, anywhere in the codebase, that can change it.** No
  customerId/walletId exists at initiation to manipulate in the first place. No fix needed
  (Category E — correct by construction).

## Part B — Beneficiary resolution at claim time (most important part)

Traced `AgentCashToCashClaimService.execute()` (`src/agent/agent-cash-to-cash-claim.service.ts`).

- **Phone normalization consistency.** Claim calls the exact same
  `AgentReceivingNumberService.canonicalizeTo10()` used at initiation. The claim's
  caller-supplied `beneficiaryPhone` is checked (`preTransfer.beneficiary_phone !==
  canonicalPhone`) purely as a typed-confirmation UX check — it is **not** the authority for
  destination.
- **Authoritative ownership check.** `assertClaimantOwnsBeneficiaryPhone(queryable,
  customerId, canonicalPhone)` (lines 785–801) is the actual binding: it looks up the
  claiming `customerId`'s own `customer_contact_methods` row
  (`type='PHONE' AND is_primary=true AND verified_at IS NOT NULL AND deleted_at IS NULL`),
  canonicalizes **that** value, and requires it to equal the transfer's canonical
  `beneficiary_phone`. This is the V1-SYSTEM-01 critical fix (commit `3f419bf`) — re-verified
  present and correct in this session (Part L below).
- **Destination wallet is 100% server-derived, never client-supplied.** There is no
  `walletId` field anywhere in `CashToCashClaimDto` or `AgentCashToCashClaimInput` (confirmed
  by reading both files in full). `resolveBeneficiaryWallet(manager, customerId)` (lines
  842–850) looks up `WalletAccount` purely by `{ customerId, currency: 'NGN' }` — the
  `customerId` used is the one validated by `assertClaimantOwnsBeneficiaryPhone` +
  OTP + KYC checks, not any value the claimant could redirect by passing extra parameters.
- **Multi-wallet-customer ambiguity: structurally impossible.** `wallet_accounts` has a
  database-level `UNIQUE (customer_id, currency)` constraint
  (`uq_wallet_accounts_customer_currency`, migration `1785753600000`). A customer can have at
  most one NGN wallet, so `resolveBeneficiaryWallet` can never be ambiguous.
- **Agent influence on destination wallet: none.** The Agent's own `agentId`/session plays no
  role in `resolveBeneficiaryWallet` — only the beneficiary `customerId` does (see Part H).
- **Conclusion: the final wallet is proven server-side derived — from a server-validated,
  phone-ownership-checked `customerId`, through a DB-unique wallet lookup, with no
  client-controlled identifier anywhere in the path.**

## Part C — OTP binding

Traced `AgentDeskOtpService.issue()` (`src/agent/agent-desk-otp.service.ts`) and
`MfaExecutionService.verifyChallenge()` (`src/customer-authentication/mfa-execution.service.ts`)
with exact parameters, not by assumption.

- **Issuance.** The OTP is generated server-side (CSPRNG 6-digit, PBKDF2-100000 digest at
  rest) and delivered via SMS to the `customerId`'s own `customer_contact_methods` row with
  `type='PHONE' AND is_primary=true AND verified_at IS NOT NULL` — the **same table and same
  predicate** used by the claim's `assertClaimantOwnsBeneficiaryPhone`. The OTP is never sent
  to an arbitrary caller-supplied "target phone" — there is no such parameter in
  `IssueDeskOtpChallengeCommand`. A fresh `authentication_sessions` row is created bound to
  that `customerId` (`sessionId`), and the challenge is issued with `purpose:
  'CASH_TO_CASH_CLAIM'` (`AGENT_DESK_OTP_PURPOSE_CASH_TO_CASH_CLAIM`), distinct from
  `'WALLET_TO_CASH'`.
- **Verification binding (`MfaExecutionService.verifyChallenge`, lines 136–219).** Checks, in
  order: `challenge.customerId !== command.principal.customerId` → `WRONG_CUSTOMER`;
  `challenge.sessionId !== command.principal.sessionId` → `WRONG_SESSION`; challenge
  `status !== ACTIVE` → `EXPIRED`/`REPLAYED`/`MFA_UNAVAILABLE`; `expiresAt` check → `EXPIRED`;
  **purpose mismatch** (`challenge.purpose !== command.expectedPurpose`, when the challenge
  carries a purpose) → `WRONG_PURPOSE`; enrollment/method `ENABLED` check; hash comparison via
  `challengeMatches`. The claim service passes `expectedPurpose:
  AGENT_DESK_OTP_PURPOSE_CASH_TO_CASH_CLAIM` and reconstructs `principalForMfaPre` with
  `customerId` = the claim's own `customerId` parameter, so a challenge issued for a
  different customer or a different purpose is rejected before any financial logic runs.
  Covered by existing test a16 #13 ("OTP binding to correct customer" — an OTP issued to
  customer B cannot be presented while claiming as customer A; rejects with
  `/belong|OTP/i`) and a16 #14/#15 (expired/replayed).
- **Transitive proof: OTP control of beneficiary phone ⇒ authenticated beneficiary identity
  ⇒ beneficiary wallet.** OTP success only proves the claimant controls `customerId`'s own
  verified phone (via SMS delivery + session/credential binding). `assertClaimantOwnsBeneficiaryPhone`
  separately proves that same phone equals the transfer's `beneficiary_phone`. Composing the
  two: a successful claim proves the claimant controls the exact phone number the Agent
  designated as beneficiary at initiation — which is the invariant required. Neither check
  alone would be sufficient (this is exactly the gap V1-SYSTEM-01 found and `3f419bf` closed);
  both are present and both are re-checked a second time inside the SERIALIZABLE transaction
  (TOCTOU-resistant — see Part F).
- **Conclusion: OTP is correctly and exclusively bound to the claiming customer's own verified
  phone, not to any arbitrary target phone; shared MFA infrastructure parameters were traced
  explicitly rather than assumed correct.**

## Part D — Identity verification

- The claimant must be `customers.status === 'ACTIVE'` and `deleted_at IS NULL`
  (re-checked both pre-transaction and inside the SERIALIZABLE transaction).
- KYC gate: `kyc_status === 'APPROVED'` **or** at least one non-deleted row in
  `customer_identity_documents`. This fallback (existence of *a* document record, not
  necessarily reviewed/approved) is weaker than a strict KYC-APPROVED gate, but it does **not**
  affect the beneficiary-binding invariant under audit: it only gates *whether* a given
  claimant may claim at all, not *which* wallet receives funds — that is governed entirely by
  the separate phone-ownership check (Part B/C). No other code path in the repository uses
  this same existence-only fallback (`kyc_status` is referenced in exactly 3 non-test files,
  and only this claim service has the fallback), so it is a pre-existing, narrow KYC-strictness
  observation, not an identity-substitution vulnerability. **Classified Category C
  (post-V1 KYC-strictness hardening, not a security finding) — left unmodified per the
  standing instruction not to invent new business rules.**
- No code path allows a customer to supply "another's" identity info in this flow — identity
  documents are looked up by the server-validated `customerId`, never by a client-supplied
  document number or similar.
- Replay resistance of identity state: re-checked inside the SERIALIZABLE transaction
  (`custRows2`) in case the customer's status/KYC changed between the pre-check and the lock.

## Part E — Claim code

- **Storage.** `PBKDF2$sha256$10000$<salt>$<derived>` — random 16-byte salt per transfer,
  10,000 iterations, verified via `verifyTransferCode()` which parses the format and compares
  with `pbkdf2Sync` + `timingSafeEqual`.
- **1:1 association with transfer, no cross-transfer reuse.** The code is always verified
  against the specific `transfer_code_hash` fetched by `WHERE id=$1` for the exact
  `transferId` in the request — there is no code path that checks a provided code against
  any other transfer's hash. A valid code for transfer A has no bearing on transfer B.
- **Expiry enforcement.** `status === 'EXPIRED'` is checked before any code/OTP logic (fails
  closed with `ConflictException`).
- **Lockout.** `MAX_FAILED_ATTEMPTS = 5`; each wrong-code attempt increments
  `failed_attempts` and sets `is_locked=TRUE, lock_reason='TRANSFER_CODE_LOCKED'` on the 5th.
  A locked transfer rejects even the correct code (`is_locked` checked before code
  verification). Covered by a16 tests #7–#9.
- **No beneficiary-selection via code.** The code has no bearing on which `customerId`/wallet
  receives funds — that is determined solely by the phone-ownership chain (Parts B/C),
  independent of the code.
- **No double-settlement under concurrency.** See Part F.
- Confirmed with real tests: a16 #3–#10 (code lifecycle), #26 (already-claimed), #27
  (concurrency).

## Part F — Concurrency

`AgentCashToCashClaimService` locks the transfer row with `SELECT * FROM
cash_to_cash_transfers WHERE id = $1 FOR UPDATE` inside a `SERIALIZABLE` transaction, and
re-checks `status`, `is_locked`, `beneficiary_phone`, phone ownership, customer status/KYC,
and the code hash **after** acquiring the lock (duplicating every pre-check). This closes the
TOCTOU window between the pre-checks (run outside the transaction, before consuming the OTP)
and the actual settlement.

Executed existing tests prove this directly, against a live PostgreSQL server in this
session:

- **a16 #27 "concurrent claims converge to one success"** — two simultaneous
  `claimService.execute()` calls for the same transfer with two independently-issued OTPs for
  the *same legitimate* customer: exactly 1 fulfilled, 1 rejected
  (`/already claimed|locked|conflict/i`), and exactly 1 new row in `ledger_journals`
  (asserted via `beforeJournals`/`afterJournals` count delta). **PASSED.**
- **a16 #26 "already-claimed rejects second claim"** — legitimate claim followed by a
  *different* customer's claim attempt on the same code: second attempt rejected
  (`/already claimed/i`), first customer's settlement untouched. **PASSED.**
- **a17 #17 "claim-vs-expiry concurrency produces exactly one valid terminal state"** —
  `claimService.execute()` and `expiryService.expireDueTransfers()` run via `Promise.all` on
  the same due-and-unclaimed transfer; final status is proven to be exactly one of
  `CLAIMED`/`EXPIRED` (never both, never neither), with the losing side's action proven to
  have had no effect (no expiry audit row if claimed; claim rejected with `/expired/i` if
  expired). **PASSED.**
- **a17 #18 "CLAIMED never becomes EXPIRED"** and **#19 "EXPIRED never becomes CLAIMED"** —
  direct proof of the terminal-state invariant. **PASSED.**

"Same code, different Agent sessions" and "same code, different customer sessions" are
structurally covered by the same row-lock + status-check mechanism: the code hash lives on
the transfer row (not bound to any Agent/customer session), and the Agent HTTP session is not
part of the settlement-determining logic at all (see Part H) — whichever caller's request
acquires the `FOR UPDATE` lock first and passes all checks wins; every other concurrent
request, regardless of which Agent or customer session it rides on, sees the post-transition
`status` and is rejected. This is the same mechanism already proven by a16 #26/#27 and a17
#17–19, so no additional test was needed to prove the Agent-session/customer-session
dimensions specifically.

**Conclusion: proven — one principal, at most one settlement; the final wallet is always the
one belonging to the authorized beneficiary identity (never the losing concurrent caller's).**

## Part G — Status changes during claim

- **Beneficiary suspended before/during claim.** `customers.status !== 'ACTIVE'` is checked
  both in the pre-check (outside the transaction, before OTP is even verified) and again
  inside the SERIALIZABLE transaction after the row lock — the same defense-in-depth pattern
  V1-SYSTEM-01 commit `049668b` documents as *already correctly applied here* for C2C claim
  (that commit had to add the equivalent check to `TransferService` and
  `CustomerFundingService`, which were missing it; C2C claim was cited as already correct).
  **This session found no existing regression test proving this for C2C specifically, so one
  was added** (new test a16 #37, see "Tests added" below): a SUSPENDED beneficiary's claim
  attempt is rejected (`NotFoundException`, no enumeration), the transfer stays `UNCLAIMED`,
  neither the unclaimed pool nor the beneficiary wallet balance changes, and — to prove this
  is a status gate and not an accidental permanent lock — reactivating the customer allows the
  identical claim to succeed normally afterward. **PASSED.**
- **C2C expires during claim.** Proven by a17 #17 (Part F) — no partial settlement either
  way.
- **Already-claimed / already-invalid.** Proven by a16 #26 and a17 #6/#19.
- **Beneficiary wallet status.** `WalletAccount.status` exists (`ACTIVE`/`SUSPENDED`/`CLOSED`)
  but **no code path in the entire repository ever transitions a wallet away from `ACTIVE`**
  (`grep` for `WalletStatus.SUSPENDED`/`WalletStatus.CLOSED` assignments in `src/wallet`
  returns nothing) — this is explicitly documented in the V1-SYSTEM-01 `049668b` commit
  message ("WalletAccount.status is set to ACTIVE at creation and is never transitioned").
  Since no wallet-level suspension feature exists in V1, there is nothing for the C2C claim
  to additionally check here; relying on `customers.status` (the actual authoritative
  lifecycle signal) is correct and consistent with the rest of the codebase. No new business
  rule invented.
- No invented status semantics were introduced; only existing V1 status values
  (`ACTIVE`/`SUSPENDED`/`CLOSED`/`DRAFT` for customers; `UNCLAIMED`/`CLAIMED`/`EXPIRED` for
  transfers) were exercised.

## Part H — Agent boundary

- **The claim HTTP endpoint (`POST /agents/cash-to-cash/claim`) requires an AGENT principal,
  not a CUSTOMER principal.** Traced the full authorization chain:
  `RuntimeAccessGuard` (global `APP_GUARD`) → `RoutePolicyRegistry.resolve()` → for any path
  under `/api/v1/agents/*` without a more specific rule, the policy is
  `{ allowedPrincipalTypes: ['AGENT'], agentAccess: 'SELF' }` →
  `AuthorizationService.authorize()` rejects any non-`AGENT` principal with
  `PRINCIPAL_TYPE_DENIED`. This confirms the product's actual design: C2C claim is an
  **Agent-desk-mediated** flow (the beneficiary visits an Agent, the Agent issues the OTP via
  `AgentDeskOtpService`, the beneficiary reads the OTP off their own phone and tells the
  Agent, the Agent submits the claim). The `claimantPrincipal.type === 'CUSTOMER'` branch in
  the service code is defensive/future-facing for direct service-level invocation (e.g. by
  tests) and is never reachable via the real HTTP surface today.
- **The Agent cannot redirect the beneficiary, choose another wallet, or substitute another
  customer's identity**, because none of those are parameters the Agent controls that feed
  into `resolveBeneficiaryWallet` — only the server-validated `customerId` (gated by phone
  ownership + OTP + KYC, none of which the Agent can forge) does. The Agent's own `agentId`
  is used only for authorization/audit, never as a candidate beneficiary identity.
- **The Agent cannot reuse another C2C code or claim across sessions** — the code is bound to
  the specific transfer row (Part E), not to any Agent session.
- **Agent identity never becomes beneficiary identity** — `agentId` and `customerId` are
  distinct fields throughout; there is no fallback anywhere that substitutes one for the
  other.

## Part I — Support boundary

Searched the entire `admin`/`support`/`ops` surface for any reference to C2C:
`cash_to_cash_transfers`, `CashToCashTransfer`, `cash-to-cash` all return **zero matches**
outside `src/agent/*`, `src/capability-registry/capability.seed.ts` (a capability-catalogue
description, not an access path), and the two read-only transaction-history services already
covered in Part A. **There is no Support/Admin code path into C2C initiation, claim, OTP, or
expiry at all** — nothing to bypass, because nothing exists. Left unmodified per the standing
instruction (no bypass found, so no change made).

## Part J — Ledger destination

- **Credited account is the beneficiary's own wallet's ledger account**, derived via
  `resolveBeneficiaryWallet(manager, customerId).ledgerAccountId` — not a client-supplied
  identifier at any point (Part B).
- **Correct wallet/customer/amount/currency, no duplicate settlement, balanced journal**:
  proven by existing tests a16 #21–#25 (`UNCLAIMED→CLAIMED` transition, unclaimed pool
  decreases by exactly the principal, beneficiary wallet increases by exactly the principal,
  journal is balanced, only one financial effect per claim).
- **Regression test asserting the actual destination wallet/customer (attacker vs. victim)
  already exists** from the V1-SYSTEM-01 fix: a16 #34 explicitly asserts the attacker's own
  wallet balance is **unchanged** and the legitimate beneficiary's wallet balance increases by
  exactly the transfer `amount` after a real claim. Re-ran in this session — **PASSED**
  (see Part L).
- **Conclusion: the principal is proven credited to the beneficiary's actual wallet, not
  merely a client-supplied-identifier-resolved wallet** — no new test was needed since this
  proof already exists and was re-verified live.

## Part K — Expiry

- `expires_at` is persisted at initiation (`computeExpiresAt()`, default 604800s/7 days,
  documented as an implementation assumption, not a regulatory one) and is **stable** —
  changing `CASH_TO_CASH_EXPIRY_SECONDS` configuration afterward does not mutate already-persisted
  rows (proven by a17 #21).
- Claim-after-expiry cannot settle: `status === 'EXPIRED'` is checked before any
  code/OTP/financial logic, both in the pre-check and (implicitly, since the row would already
  read `EXPIRED`) inside the transaction. Proven by a17 #6, #19.
- No race into unintended settlement: proven by a17 #17 (Part F).
- Expired principal remains in `CASH_TO_CASH-UNCLAIMED-NGN` — expiry **does not move money**
  (no journal is posted on expiry; proven by a17 #7/#8/#11/#12).
- No auto-refund to the Agent: proven by a17 #10.
- No unauthorized claim post-expiry: proven by a17 #6/#19.
- All of this is pre-existing, correct V1 semantics; no changes made.

## Part L — Previous vulnerability regression (MANDATORY)

Reproduced and re-verified the exact V1-SYSTEM-01 critical finding and its fix in this
session, against a live PostgreSQL server, with the current HEAD:

- **The vulnerability (pre-`3f419bf`):** the claim flow checked only that the
  caller-*typed* `beneficiaryPhone` string matched the transfer's stored value — it never
  verified that the *claiming* `customerId` actually owned that phone. Since the agent-desk
  OTP is always delivered to the claiming customer's own phone (never an arbitrary target),
  any registered, KYC-approved customer who learned a victim's phone number + the valid
  transfer code could claim the victim's funds into their own wallet using their own valid
  OTP.
- **The fix (`3f419bf`):** `assertClaimantOwnsBeneficiaryPhone()`, enforced both in the
  pre-check and again inside the SERIALIZABLE transaction (Part B/F).
- **Re-run in this session: a16 #34 "EXPLOIT BLOCKED: claimant whose own phone differs from
  the transfer beneficiary phone cannot steal the funds" — PASSED.** This test: (1) creates a
  transfer to a victim's phone; (2) has a fully legitimate, KYC-approved attacker (with a
  *different* own verified phone) submit the victim's phone string + the correct transfer
  code + their own valid OTP; (3) asserts the attempt is rejected with `NotFoundException`;
  (4) asserts the transfer is still `UNCLAIMED` and **neither the unclaimed pool nor the
  attacker's own wallet balance changed at all**; (5) then has the real victim (owning that
  phone, newly registered) claim the same transfer with their own OTP and asserts
  `status === 'COMPLETED'` and the victim's wallet balance increased by exactly the transfer
  amount. **Both halves proven in the same test, live, in this session.**
- **a16 #35 "claimant with NO verified primary phone at all is rejected (fails closed, not
  open)" — PASSED.**
- **a16 #36 "claimant with an UNVERIFIED phone matching the transfer is rejected (verification
  is required, not just possession)" — PASSED.**

**Conclusion: the previous critical vulnerability remains fully blocked at the current HEAD,
and legitimate beneficiaries with correct credentials can still claim normally. No
regression.**

## Part M — Unknown-unknown search

Investigated several specific hypotheses beyond the explicit parts above, each resolved with
code-level proof (not left as open questions):

1. **Duplicate phone representations across customers (the most substantive lead
   investigated).** `AgentReceivingNumberService.canonicalizeTo10()` collapses `+234X`,
   `234X`, `0X`, and bare 10-digit `X` to the same canonical value, but the generic
   `CustomerService.createContactMethod()` → `normalizeContact()` path does **not** — it only
   strips whitespace/parentheses/dashes and validates a loose `^\+?[1-9]\d{7,14}$` pattern,
   so two different textual representations of the same real phone number *could* in
   principle pass the DB's `uq_customer_contacts_type_value UNIQUE(type, normalized_value)
   WHERE deleted_at IS NULL` constraint as distinct rows for two different customers. This
   was traced all the way through to determine whether it is exploitable:
   - `CustomerService.createContactMethod()` **always** sets `verifiedAt: null` — grep across
     the entire `src/` tree confirms there is **no** code path, anywhere, that ever sets
     `customer_contact_methods.verified_at` to a non-null value except
     `customer-registration.service.ts` (self-registration OTP flow).
   - That registration flow uses its **own**, independently-implemented
     `normalizeNigerianPhone()`, which produces the exact same canonical 10-digit form as
     `canonicalizeTo10()`, and explicitly checks for an already-bound phone
     (`customer_contact_methods` with that canonical `normalized_value` and `deleted_at IS
     NULL`) before allowing a new registration — rejecting/no-oping a second registration of
     an already-claimed canonical number.
   - No admin/support code path sets `verified_at` either (`admin-customer.controller.ts` and
     `admin-customer-credentials.controller.ts` only *read* `verifiedAt`, never write it).
   - **Conclusion: not exploitable.** A "verified primary phone" can only ever be produced by
     the one flow that both canonicalizes correctly and prevents duplicate canonical
     registration. The weaker `normalizeContact()` path exists (used for secondary, non-primary
     contact methods) but can never produce a `verified_at`-set row, so it can never satisfy
     `assertClaimantOwnsBeneficiaryPhone`'s `verified_at IS NOT NULL` requirement. This was
     confirmed by full code trace (every write site of `verified_at` enumerated), not by
     assumption. No fix needed; recorded here as due-diligence evidence per the task's
     explicit request to look for "duplicate phone representations" and "normalization
     differences."
2. **TOCTOU across the OTP-verification / SERIALIZABLE-transaction boundary.** OTP
   verification runs in its own, separate transaction *before* the main claim's SERIALIZABLE
   transaction begins. Every check that could have changed in between (customer status, KYC,
   phone ownership, code hash/lock state) is explicitly re-run inside the SERIALIZABLE
   transaction after the row lock is acquired (Parts B, D, E, F, G). The only residual
   effect of a race in this specific window is that a legitimately-issued OTP could be
   "spent" (marked `VERIFIED`) even if the subsequent in-transaction re-check then rejects the
   claim for an unrelated reason (e.g. concurrent lock-out) — a minor UX/robustness nuisance
   (the customer would need a new OTP), not an identity-binding or fund-redirection defect.
   Not classified as a finding.
3. **OTP issuance rate limiting.** `AgentDeskOtpService.issue()` has no dedicated rate limit
   of its own (unlike the customer self-registration OTP flow, which has
   `SecurityRateLimitService`-backed per-phone/per-IP limits). This is an abuse/cost (SMS
   spam) concern, not a beneficiary-redirection concern — no amount of OTP-issuance frequency
   changes which wallet can be credited. Recorded as Category C (post-V1 hardening), not a
   P0/P1 finding for this audit's invariant.
4. **Agent-identity-becomes-beneficiary-identity, code→transfer, support→customer, and other
   boundaries listed in the task** were each walked explicitly in Parts A, H, and I above and
   found to have no viable substitution path.

No fabricated or invented business rules were introduced anywhere in this investigation.

---

## Proof table

| INVARIANT | ENFORCEMENT POINT | DATABASE FIELD(S) | TEST PROOF | RESULT |
|---|---|---|---|---|
| Beneficiary phone immutable after initiation | No UPDATE statement anywhere touches the column (code-level enumeration) | `cash_to_cash_transfers.beneficiary_phone` | Static trace of all 5 `UPDATE` sites in the codebase | PROVEN |
| No client-supplied walletId/customerId at initiation | Field does not exist in DTO/types | n/a (absence proven) | Static trace of `agent-cash-to-cash.types.ts`, `dto/cash-to-cash.dto.ts` | PROVEN |
| Claimant must own the beneficiary phone | `assertClaimantOwnsBeneficiaryPhone()`, pre-check + in-transaction | `customer_contact_methods.{normalized_value,is_primary,verified_at,deleted_at}` | a16 #34, #35, #36 | PASSED |
| Destination wallet is server-derived only | `resolveBeneficiaryWallet(manager, customerId)` — no walletId param exists | `wallet_accounts` UNIQUE(customer_id,currency) | a16 #23, #34 | PASSED |
| OTP bound to claiming customer, not arbitrary phone | `MfaExecutionService.verifyChallenge` WRONG_CUSTOMER/WRONG_SESSION/WRONG_PURPOSE checks | `mfa_challenges.{customer_id,session_id,purpose}` | a16 #11–#15 | PASSED |
| Claim code is per-transfer, hashed, lockout after 5 | `verifyTransferCode()` + failed_attempts/is_locked update | `cash_to_cash_transfers.{transfer_code_hash,failed_attempts,is_locked}` | a16 #3–#10 | PASSED |
| Exactly one settlement under concurrency | `SELECT...FOR UPDATE` + SERIALIZABLE + status re-check | `cash_to_cash_transfers.status` | a16 #26, #27 | PASSED |
| Claim-vs-expiry race yields one terminal state | Row lock shared by claim and expiry sweep | `cash_to_cash_transfers.status` | a17 #17, #18, #19 | PASSED |
| Suspended beneficiary cannot claim | `customers.status === 'ACTIVE'` re-checked pre-check + in-transaction | `customers.status` | a16 #37 (new) | PASSED |
| Ledger destination correct, balanced, no duplicate | Journal lines `[DEBIT unclaimed, CREDIT beneficiary wallet]` | `ledger_journals`, `ledger_entries` | a16 #21–#25 | PASSED |
| Expiry does not move funds, no auto-refund | `expireDueTransfers()` only flips status | `cash_to_cash_transfers.{status,expired_at}` | a17 #7, #8, #10–#12 | PASSED |
| Previous critical vuln (phone-binding bypass) remains blocked | `assertClaimantOwnsBeneficiaryPhone()` (commit `3f419bf`) | same as above | a16 #34 | PASSED |
| Agent desk endpoint requires AGENT principal; Agent cannot become beneficiary | `RoutePolicyRegistry` + `AuthorizationService` | n/a (authz layer) | Static trace + existing a16/a17 HTTP-session tests | PROVEN |
| Support has no access to C2C at all | No code reference exists | n/a | Repo-wide grep, zero matches | PROVEN |
| Duplicate-phone-representation identity ambiguity | `verified_at` only ever set by canonicalized, duplicate-checked registration flow | `customer_contact_methods.verified_at` | Static trace of every write site | PROVEN NOT EXPLOITABLE |

---

## Findings and severity classification

| # | Finding | Severity | Classification | Action |
|---|---|---|---|---|
| 1 | *(Historical, already fixed before this audit)* C2C claim phone-binding bypass — malicious registered customer could redirect a victim's C2C funds | Critical | A (was a V1 blocker) | Already fixed in `3f419bf`; re-verified in Part L; no action in this audit |
| 2 | *(Historical, already fixed before this audit)* Suspended customer could still receive W2W transfer / have funding approved | High | A (was a V1 blocker) | Already fixed in `049668b` (not a C2C-specific fix; C2C claim already had the correct check); no action in this audit |
| 3 | No existing regression test proving suspended-beneficiary-blocks-C2C-claim | Low (test-coverage gap, not a behavioral defect — the code was already correct) | C (hardening/proof-completeness) | Fixed in this audit: added a16 #37 |
| 4 | KYC gate accepts existence of *any* identity document (not necessarily reviewed) as an alternative to `kyc_status === 'APPROVED'` | Low (does not affect beneficiary-binding invariant; affects only who may claim at all) | C (post-V1 KYC-strictness hardening) | Not modified — no new business rule invented per standing instruction |
| 5 | `AgentDeskOtpService.issue()` has no dedicated rate limit (unlike customer self-registration OTP) | Low (abuse/cost concern, not fund-redirection) | C (post-V1 hardening) | Not modified — out of this audit's invariant scope |
| 6 | Dependency vulnerabilities (`npm audit`: 41 total / 4 production-only, inherited from V1-SYSTEM-01 audit, unrelated to C2C) | n/a — out of scope, not re-audited this session | n/a | Not re-examined; see V1-SYSTEM-01 report |

**No Critical or High findings exist in this audit.** The one Critical and one High finding
in the table are historical citations (from V1-SYSTEM-01, already fixed before this audit
began) presented for completeness of the regression proof (Part L), not new findings.

## Tests added/changed in this session

- `test/a16-agent-cash-to-cash-claim.integration.spec.ts`: added test **#37** ("SUSPENDED
  beneficiary cannot claim: no status transition, no ledger movement") — proves Part G for
  C2C specifically, with a reactivation step proving it is a status gate and not an
  accidental permanent lock. No production code changed to pass this test — the underlying
  `customers.status === 'ACTIVE'` check already existed.
- No other files changed. No production/`src/` files were modified in this session.

## Exact test counts (this session, live PostgreSQL)

- `test/a15-agent-cash-to-cash.integration.spec.ts`: 23/23 passed
- `test/a16-agent-cash-to-cash-claim.integration.spec.ts`: **37/37 passed** (36 pre-existing + 1 new)
- `test/a17-agent-cash-to-cash-expiry.integration.spec.ts`: 26/26 passed
- `test/v1-agent-mfa-api-01.integration.spec.ts`: 10/10 passed
- `test/v1-system-01-suspended-customer-financial-boundary.integration.spec.ts`: 7/7 passed
- **Full unit suite:** 1801/1801 passed, 172 suites, no regressions
- **Full PG integration suite:** 1632/1637 passed, 78/82 suites fully green. 5 failing tests,
  4 of which are the same pre-existing, unrelated failures documented in the V1-SYSTEM-01
  report (stale hardcoded migration-count/template-path expectations in
  `migration-chain.integration.spec.ts` ×2, `v1-workforce-bootstrap-01.integration.spec.ts`
  ×1, `v1-hardening-06-admin-customer-investigation.integration.spec.ts` ×1 — all expect an
  older, smaller migration count/template path than what now exists, unrelated to security).
  The 5th failure (`v1-customer-onboarding-01.integration.spec.ts`, test "19e: concurrent
  wrong attempts cannot race past the cap") is a **new observation this session**: it failed
  only under the full 82-suite sequential run and **passed cleanly (20/20) when re-run in
  isolation**, confirming it is a timing-sensitive flake under this sandbox's load/scheduling
  characteristics, not a regression — it belongs to the customer self-registration OTP domain
  entirely, which this session's change (a C2C test file only) cannot have affected.

## Remaining risks

- The KYC existence-only fallback (Finding #4) and the missing OTP-issuance rate limit
  (Finding #5) are legitimate, low-severity, non-blocking hardening items for a future task —
  they do not threaten the core beneficiary-binding invariant audited here.
- Dependency vulnerabilities from `npm audit` were not re-examined in this session (out of
  scope); see the V1-SYSTEM-01 report for the last recorded numbers.
- The flaky `v1-customer-onboarding-01` concurrency test (#19e) is unrelated to C2C but was
  observed in this session's full-suite run; worth a future look at tightening its
  assertions for CI stability, independent of this audit.

## Recommended next task

No P0/P1 C2C findings remain to fix. A reasonable next task would be a similarly narrow,
proof-oriented audit of the **Wallet→Cash (W2C)** claim flow (`agent-desk-otp` also serves a
`WALLET_TO_CASH` purpose per Part C, implying a parallel claim surface worth the same
identity-binding scrutiny applied here), or addressing Finding #4/#5 as standalone low-risk
hardening tasks if the product wants stricter KYC/anti-abuse posture ahead of launch.

---

## Final status

**C2C IDENTITY & CLAIM SECURITY VERIFIED — NO P0/P1 FINDINGS**
