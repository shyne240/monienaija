# V1-AGENT-MOBILE-IDEMPOTENCY-PERSISTENCE-AUDIT-01 — App-Restart Idempotency-Key Durability (Agent Mobile)

**Branch:** `arena/01a10374-monienaija`. **HEAD at start of task:** `df04920` (the prior
Customer Mobile idempotency fix, `V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01`).
**Scope:** Agent Mobile only — the three financial flows whose backend idempotency boundary is
the generic `agent-financial.v1:<agentId>` ledger reservation with no independent business-level
duplicate guard: Cash-In (Cash→Wallet), Cash-Out (Wallet→Cash), Cash-to-Cash Send. Cash-to-Cash
*Claim* is explicitly out of scope for the fix (see Part 2) but is independently re-proven as
not needing one.
**Builds on, does not reopen:**
`docs/V1/V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01.md` (PART 10 residual-limitation note — "none
persists the pending key to durable storage, so none can automatically recover after a genuine
app process kill... noted as a residual limitation for the Agent flows") and
`docs/V1/V1-W2W-RECOVERY-SECURITY-AUDIT-01.md` (UNK-03, remains NOT REPRODUCED, untouched).
**Not touched:** `ProductCatalogService`, branding/logo/splash/icons, Admin Web, V2-excluded
features, bank/NIBSS, cards, bills, push notifications, `wallet_accounts`/legacy
`customer_wallets` schema.

---

## 1. Starting point — the residual gap this task closes

`V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01` (prior task) proved that all four Agent Mobile
Confirm screens mint their Idempotency-Key exactly once per attempt (via `useRef`, immutable
route param) and never regenerate it on error — so, *within a single running app process*, an
ambiguous outcome (NetworkError / 5xx) followed by a manual retry on the same screen instance
already reuses the same key safely. That task deliberately left one narrower gap unaddressed for
Agent Mobile: **the key lives only in a React `useRef`, in memory.** If the Agent's device/app
process is killed between "request sent" and "response received" — OS kills the app, battery
dies, app crashes, Agent force-closes it — the in-memory key is gone. Reopening the app and
re-navigating Home → Recipient → Amount → Confirm for what the Agent believes is the same
operation causes the Amount screen to mint a **brand-new** key (its `useRef` cannot have
survived process death), and submitting with that new key creates a **second, independent**
financial effect against the backend's `agent-financial.v1:<agentId>` idempotency boundary —
because to the backend, a different key is, by design, a different request.

## 2. Which flows are actually exposed (PART 1 audit matrix, unchanged, re-confirmed)

| Flow | Idempotency scope | Business-level resource guard? | Verdict |
|---|---|---|---|
| Cash-In (Cash→Wallet) | `agent-financial.v1:<agentId>` | None | **Category B — vulnerable** |
| Cash-Out (Wallet→Cash) | `agent-financial.v1:<agentId>` | None | **Category B — vulnerable** |
| Cash-to-Cash Send | `agent-financial.v1:<agentId>` | None | **Category B — vulnerable** |
| Cash-to-Cash Claim | `cash-to-cash-claim.v1:<transferId>` | Yes — `cash_to_cash_transfers.status` state machine (`src/agent/agent-cash-to-cash-claim.service.ts`) | **Not vulnerable to this defect; Category C (UI-only inconvenience) at most** |

Claim is excluded by design: a retry with a brand-new key after process death still lands on
the *same* `transferId`, and the claim service's own `UNCLAIMED → CLAIMED` state machine
independently rejects a second claim attempt with a definitive 409 (`"already claimed"`),
regardless of what Idempotency-Key accompanies it. Persisting a key for Claim would add
complexity (a `CASH_TO_CASH_CLAIM` storage lane, another resume path to audit) without closing
any real gap — confirmed by the standalone backend regression (Scenario C, Part 5 below), run
independently of the other three.

## 3. Design — what was built, and why not more

Reused Agent Mobile's existing `SecureStorage` abstraction (already used for the three
auth-session keys) rather than inventing a new persistence mechanism. New module:
`apps/agent-mobile/src/services/pending-operation.ts` (148 lines).

Key design decisions, each a deliberate divergence from blindly copying Customer Mobile's
`pending-transfer.ts` pattern, justified by how Agent Mobile actually differs:

1. **Namespaced by `agentId` *and* `operationType` in the storage key itself**
   (`pending_agent_operation:<agentId>:<CASH_IN|CASH_OUT|CASH_TO_CASH_SEND>`), not just a field
   inside the record. Customer Mobile has exactly one flow/shape (Wallet→Wallet), so one storage
   key sufficed there. Agent Mobile has three distinct operation shapes in the same app and must
   not let one flow's pending state collide with, or be read by, another — nor let one Agent's
   pending record ever become reachable from another Agent's session.

2. **The Idempotency-Key is the sole identity of a pending operation** (per the prior task's
   PART 6 principle — never identify a financial operation by amount/recipient/phone/narration
   alone). The `counterpartyId`/`amountMinor`/`currency` captured alongside it
   (`matchesPendingAgentOperation`) are used only as a defense-in-depth sanity check — do the
   details the Agent is re-entering actually look like the same attempt? — never as the basis
   for deciding whether to resume a key. If they don't match, the fresh route-param key is used
   and the stale record is left untouched (not force-cleared, not silently reused).

3. **24-hour staleness window** (`MAX_PENDING_AGE_MS`), matching the Customer Mobile precedent:
   comfortably exceeds any realistic ambiguous-timeout recovery window without resurrecting a
   long-abandoned attempt against a much later, unrelated operation that happens to reuse the
   same screen. A stale record is dropped from storage on read, not just ignored.

4. **Corrupt-JSON / malformed-shape / cross-agent / cross-type mismatch all fail closed** —
   `loadPendingAgentOperation` returns `null` (never throws, never falls back to a guess) on any
   parse failure, missing field, or `agentId`/`operationType` mismatch against the key it was
   read under.

5. **Cleared on logout** (`clearAllPendingAgentOperations`, wired into `auth-store.ts`'s sign-out
   path) — no pending operation may ever cross an Agent identity boundary via shared-device
   reuse.

6. **No new backend endpoint, no new identity system, no heavyweight state management** — the
   fix is entirely client-side; the backend's existing `agent-financial.v1:<agentId>` idempotency
   boundary is unchanged and is what actually makes key-reuse safe (proven in Part 5).

### Per-screen integration (three Confirm screens)

Each of `CashToWalletConfirmScreen.tsx`, `WalletToCashConfirmScreen.tsx`,
`CashToCashConfirmScreen.tsx` was changed identically in shape:

- On submit: before sending the request, check for an existing persisted record for this
  `agentId` + `operationType`; if present and its captured params match the current screen's
  candidate params, use its key instead of the fresh route-param key. Then persist the
  *effective* key (existing-or-fresh) immediately, **before** the network call — so an app kill
  right after send is still covered, not just an app kill after a response starts arriving.
- `onSuccess`: clear the persisted record, then proceed with existing success handling
  (navigation reset, query invalidation).
- `onError`: clear the persisted record **only if the outcome is definitive**
  (`!isAmbiguousOperationOutcome(err)`, reusing the classifier already shipped in the prior
  task's `agent-api.ts`) — i.e. clear on a 4xx the server actually processed and rejected, leave
  the record in place on NetworkError/5xx so a later resume can still find it.

`isAmbiguousOperationOutcome` was already exported from `agent-api.ts` by the prior task's
commit (`df04920`) for Customer Mobile; it is reused as-is here, not reimplemented, since the
definitive-vs-ambiguous classification logic (based on `ApiError.status` presence/class vs.
`NetworkError`/no-status) is identical regardless of which actor is making the request.

### What was deliberately left unchanged

The three Amount screens (`CashToWalletAmountScreen.tsx`, `WalletToCashAmountScreen.tsx`,
`CashToCashAmountScreen.tsx`) still mint a fresh key via `useRef` exactly as before. This was
verified to need no change: the Confirm screen's own resume logic is what decides, at submit
time, whether to honor that fresh key or override it with a persisted match — the Amount screen
itself has no way to know in advance whether a resumable record exists, and does not need to.

The generic 401→session-purge path in `api-client.ts`'s `request()` was also left unmodified
(confirmed in the prior session of this task and re-confirmed here by inspection — no changes
appear in `git diff` for that file): it is intentionally agent-id-unaware and applies only to
true non-financial session expiry. The four financial mutation endpoints
(`agentCashIn`, `agentCashOut`, `agentCashToCash`, and the claim endpoint) already set
`preserveSessionOn401: true`, so a PIN-failure 401 on a financial call does not trigger it.
Residual same-agent stale records are bounded by the 24-hour window; cross-agent leakage is
structurally impossible since storage keys are namespaced by `agentId`.

## 4. Backend confirmatory test — proving the vulnerability was real, and the fix closes it

New file: `test/v1-agent-mobile-idempotency-persistence-01.integration.spec.ts` (494 lines),
run against real embedded PostgreSQL via `jest.integration.config.js`
(`npx jest --config jest.integration.config.js test/v1-agent-mobile-idempotency-persistence-01.integration.spec.ts --runInBand`).
Run **4 times total across this task's sessions** (3 times in the prior session after the two
fixture bugs below were corrected, once more in this session against a freshly re-initialized
database) — **4/4 tests pass every time, fully deterministic**:

| Test | Scenario | Result proven |
|---|---|---|
| **A** | Cash-In: same Idempotency-Key resubmitted after the original request (simulating a resumed key after restart) | Replays — exactly **one** journal entry, one debit/credit pair. The shipped mobile fix (reusing the persisted key) is replay-safe at the backend. |
| **B** | Cash-In: a genuinely different Idempotency-Key submitted for what the Agent believes is "the same" operation (simulating the pre-fix bug — a fresh key minted after an app restart) | **Two independent journal entries** — the agent's float is debited twice and the customer's wallet credited twice. This is the confirmed pre-fix vulnerability, reproduced deterministically. |
| **B2** | Cash-to-Cash Send: same pattern as B | Generalizes B — `cash_to_cash_transfers` row count **+2**, confirming the defect was not Cash-In-specific. |
| **C** | Cash-to-Cash Claim: a different Idempotency-Key submitted against an already-claimed transfer | Rejected with a definitive error matching `/already claimed/i`; journal count **+1, not +2** — independently re-proves Part 2's claim exclusion is correct, pinned as a standalone regression. |

Two fixture bugs were found and fixed while building this test (neither affects production
code, both are test-harness-only):

1. The test originally invented a `createMfaChallengeFallback` helper against a guessed
   `mfa_enrollments`/`mfa_methods` schema. Replaced with a `createMfaChallenge` helper copied
   and adapted from the existing, already-correct pattern in
   `test/a16-agent-cash-to-cash-claim.integration.spec.ts` — imports `MfaExecutionService`
   (`src/customer-authentication/mfa-execution.service`) and calls its real
   `issueChallenge({ principal, enrollmentId, methodId, challengeHash, ttlSeconds, actor })`
   method rather than hand-rolling SQL inserts against assumed columns.
2. `createCustomerWithPhone`'s `customer_contact_methods` INSERT was missing `verified_at`;
   added `NOW()`.

## 5. Agent Mobile regression tests — client-side behavior, deterministic, all green

**New file:** `apps/agent-mobile/__tests__/pending-operation.test.ts` (172 lines, 12 tests) —
direct unit coverage of `pending-operation.ts` in isolation: round-trip save/load, per-agent
isolation, per-operation-type isolation, tamper rejection (mismatched embedded `agentId`),
24-hour staleness expiry, corrupt-JSON fail-closed, exact-field matching
(`matchesPendingAgentOperation` requires every field, no fuzzy/partial match), and
`clearAllPendingAgentOperations` clearing every lane on logout. **12/12 pass.**

**Extended existing files** — each of the three Confirm-screen test suites gained a new
`describe('… — Idempotency-Key durability across a simulated process kill', …)` block with the
same 5-test structure, adapted to each flow's own submission shape (Cash-In's single PIN field;
Cash-Out's three-credential OTP + customer PIN + agent PIN multi-party flow; Cash-to-Cash's
single agent PIN):

1. An ambiguous outcome (`NetworkError`) durably persists the pending operation (not just an
   in-memory value) — asserted directly against `loadPendingAgentOperation`.
2. A **fresh Confirm screen instance** (simulating "app reopened after restart", with a
   brand-new route-param key that a real Amount screen's `useRef` would mint post-restart)
   recognizes and reuses the *persisted* key instead of its own fresh one — asserted against the
   actual network-call arguments the mutation sends.
3. Success clears the persisted record.
4. A definitive rejection (4xx) clears the persisted record, and a genuinely later attempt gets
   a clean new key (not forced to reuse anything stale).
5. A persisted record for a **different amount** is never reused for a new, different-amount
   operation on the same recipient — no fuzzy attribution by recipient/agent alone.

Tests 2 and 5 stage the "left behind by an earlier ambiguous attempt" precondition directly via
`savePendingAgentOperation(...)` rather than driving a real submission through a
never-resolving network mock and `unmount()`. Test 1 already proves the persistence side of that
path end-to-end; isolating 2 and 5 to only the "does a fresh instance recognize and reuse an
existing record" question keeps each test's failure mode unambiguous, and avoids leaving a
permanently-unresolved mocked `Promise` as an open Jest handle (an actual dead end hit and
resolved during this task, described in the section immediately below).

| File | New tests added | File total | Result |
|---|---|---|---|
| `apps/agent-mobile/__tests__/cash-to-wallet.test.tsx` | 5 | 27 | **27/27 pass** |
| `apps/agent-mobile/__tests__/wallet-to-cash.test.tsx` | 5 | 33 | **33/33 pass** |
| `apps/agent-mobile/__tests__/cash-to-cash.test.tsx` | 5 | 30 | **30/30 pass** |
| `apps/agent-mobile/__tests__/pending-operation.test.ts` | 12 (new file) | 12 | **12/12 pass** |

**Full `apps/agent-mobile` suite** (`npx jest` from `apps/agent-mobile`, no filters): **18 test
suites, 261 tests, 261 passed**, clean process exit (no open-handle warnings), run twice for
determinism with identical results. `npx tsc --noEmit` from `apps/agent-mobile`: **zero errors.**

### A note on an early dead end (process-kill simulation and Jest open handles)

An earlier version of tests 2 and 5 drove a real submission through a mocked network call that
deliberately never resolved (`new Promise(() => {})`, representing "the process was killed
before any response ever arrived") and then called `.unmount()` on the component — semantically
accurate, but it left a dangling, permanently-pending `Promise` tied into React Query's mutation
internals, which kept Jest's process alive past test completion (`"Jest did not exit one second
after the test run has completed"`). This did not fail any assertion, but made a plain `npx jest
<file>` invocation (no explicit `--testTimeout`) appear hung to an external caller. Resolving
the dangling promise *after* `unmount()` was tried first but was rejected as a fix, because
resolving it with a success result still fired the mutation's `onSuccess` handler (clearing the
very persisted record the test needed to still exist) even though nothing was listening to the
UI anymore. The adopted fix — staging the "left behind" precondition directly via
`savePendingAgentOperation`, described above — produces an equivalent regression guarantee
without ever creating an unresolved handle, and was independently verified to still fail
correctly if the resume logic is deleted from the production code (confirmed by temporarily
reverting the `loadPendingAgentOperation`/`matchesPendingAgentOperation` call in each Confirm
screen and observing test 2 fail as expected, then restoring it).

## 6. Severity classification

**Category B — legitimate-duplicate-transfer risk, not ledger corruption.** Every individual
transfer created by the pre-fix bug is itself internally consistent and correctly double-entry
balanced (proven by test B/B2 above) — the backend's `agent-financial.v1:<agentId>` idempotency
guarantee for any *single* key is intact throughout. The risk was purely that an app-process
kill at exactly the wrong moment could cause the Agent's own retry to use a *different* key than
the original ambiguous attempt, producing two real, separately-valid financial effects for what
the Agent and customer both believed was one Cash-In/Cash-Out/Cash-to-Cash-Send. This is the same
category and severity class as the Customer Mobile W2W finding in the prior task
(`V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01`), narrowed here specifically to the app-restart case
(the in-session ambiguous-retry case was already proven safe for Agent Mobile by that prior
task).

## 7. Final state

- **Production code changed:** `apps/agent-mobile/src/services/pending-operation.ts` (new, 148
  lines), `apps/agent-mobile/src/services/agent-api.ts` (export surface only — reuses existing
  `isAmbiguousOperationOutcome`), `apps/agent-mobile/src/store/auth-store.ts` (logout wiring),
  and the three Confirm screens
  (`CashToWalletConfirmScreen.tsx`, `WalletToCashConfirmScreen.tsx`,
  `CashToCashConfirmScreen.tsx`).
- **Tests added:** `apps/agent-mobile/__tests__/pending-operation.test.ts` (new, 12 tests);
  `cash-to-wallet.test.tsx` (+5), `wallet-to-cash.test.tsx` (+5), `cash-to-cash.test.tsx` (+5);
  `test/v1-agent-mobile-idempotency-persistence-01.integration.spec.ts` (new, 4 tests, real
  PostgreSQL).
- **Validation run:** `tsc --noEmit` clean (agent-mobile); full agent-mobile Jest suite 261/261,
  run twice; the new integration spec 4/4, run 4 times total (3 in the prior session, 1 more in
  this session against a freshly re-initialized database) — fully deterministic throughout.
- **Not changed, verified intentionally so:** Amount screens (3), `api-client.ts`'s generic
  401 handling, Cash-to-Cash Claim's confirm screen/service, Customer Mobile (already fixed by
  the prior, separate task), `ProductCatalogService`, branding, Admin Web.
