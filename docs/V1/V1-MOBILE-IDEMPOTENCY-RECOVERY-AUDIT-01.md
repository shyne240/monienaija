# V1-MOBILE-IDEMPOTENCY-RECOVERY-AUDIT-01 — Ambiguous-Timeout Retry Safety

**Branch:** `arena/01a10374-monienaija`. **HEAD at start of task:** `707bed8`.
**Scope:** Customer Mobile Wallet→Wallet (`SendMoneyScreen`) and, per PART 6, all four Agent
Mobile financial flows (Cash-In, Cash-Out, Cash-to-Cash send, Cash-to-Cash claim).
**Does not reopen:** `docs/V1/V1-W2W-RECOVERY-SECURITY-AUDIT-01.md` (UNK-03, the alleged
heuristic transaction-history matcher) — that finding remains NOT REPRODUCED and is untouched.
**Not touched:** `ProductCatalogService`, branding/logo/splash/icons, V2-excluded features,
bank/NIBSS, cards, bills, push notifications.

---

## 1. Exact current behavior (before this fix)

Traced directly in `apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx`
(`handleConfirmTransfer`, pre-fix):

| Question | Answer (traced from code, not inferred from comments) |
|---|---|
| 1. When is the key generated? | On component mount (`useEffect` → `generateNewIdempotencyKey()`), and again inside the `catch` block after **any** thrown error. |
| 2. Once per logical attempt? | No — the mount-time key is the default, but the catch block regenerates it after every single error, with no distinction by error type. |
| 3. Where stored? | Only in React component `useState`, in memory, for the lifetime of the mounted screen instance. |
| 4. When deleted? | Never explicitly "deleted" — overwritten on error, or discarded entirely when the screen unmounts (including after a successful submit, which navigates away). |
| 5. When is a new key generated? | Inside the single, undifferentiated `catch (err: any)` block — unconditionally, for every exception. |
| 6. Network timeout → new key? | **Yes.** A `NetworkError` (thrown by `ApiClient.request()` when `fetch` rejects) is caught by the same generic handler as everything else. |
| 7. HTTP 4xx → new key? | Yes (correctly so — see root cause below). |
| 8. HTTP 5xx → new key? | **Yes** (this is the bug — a 5xx is an ambiguous outcome, not a proven non-effect). |
| 9. Connection-reset/network error → new key? | **Yes**, same `NetworkError` path as #6. |
| 10. Success deletes the key? | Not "deleted" as such, but the screen immediately `navigation.navigate('Home')`s, unmounting the component and discarding all local state including the key. |
| 11. Ambiguous failure preserves the key? | **No** — this is the confirmed defect. |
| 12. UI message on ambiguous failure? | `describeTransferError` has no branch for `NetworkError`; it falls through to the generic `'Transfer failed. Check connection or try again.'` — which flatly claims failure and implicitly invites a free retry, with no acknowledgment that the outcome is actually unknown. |

**PART 4 — double-tap / concurrent submission (pre-fix):** The "Send Funds"/"Confirm" buttons are
declaratively `disabled={isLoading}` via the shared `Button` component, but `handleConfirmTransfer`
itself had **no synchronous guard** — `isLoading` is only enforced after React re-renders with the
disabled prop, leaving a narrow window where two rapid taps landing in the same tick could both
reach the handler before either re-render takes effect. The UI lock was therefore not provably
sufficient on its own (confirmed by reasoning about React's render-cycle timing, not assumed) —
though even in that scenario, both concurrent calls would share the *same* unmodified
`idempotencyKey` value (nothing regenerates it between the two calls), so the backend's existing
idempotency guarantee (independently proven in `test/v1-w2w-recovery-audit-01.integration.spec.ts`,
test #2) would still have collapsed the race into one financial effect. The gap was redundant
network calls / redundant PIN re-verification, not a double-debit path.

**PART 5 — app restart / process death:** The key lived only in React state, never in
`SecureStorage`/`AsyncStorage` (confirmed: `SecureStorage` in this app is only ever used for the
three auth-session keys — `auth_session_token`, `auth_customer_id`, `auth_session_data`). An app
kill between send and an ambiguous response therefore destroyed the key permanently; reopening
the app and revisiting `SendMoneyScreen` minted a brand-new one with no memory of the earlier
attempt. The customer had no automatic way to learn the original attempt's outcome — only a
manual check of Transaction History (which is always correct, since it reads server truth).

## 2. Affected flows (PART 6 — do not assume shared implementation)

| Flow | Key generated | Persisted | Reused after ambiguous failure (pre-fix) | Safe after app restart (pre-fix) | Risk |
|---|---|---|---|---|---|
| **Customer Mobile — Wallet→Wallet** (`SendMoneyScreen`) | Once per attempt, in `useState`, regenerated on **every** error | No | **No — regenerated unconditionally** | No | **CONFIRMED — see PART 9** |
| Agent Mobile — Cash-In (Cash→Wallet) | Once, via `useRef` in `CashToWalletAmountScreen`, passed as an immutable route param | No | **Yes — never regenerated on any error, including ambiguous ones** | No | Not vulnerable to this defect (app-restart gap only, same as all four Agent flows) |
| Agent Mobile — Cash-Out (Wallet→Cash) | Once, via `useRef` in `WalletToCashAmountScreen`, immutable route param | No | **Yes** | No | Not vulnerable |
| Agent Mobile — Cash-to-Cash send | Once, via `useRef` in `CashToCashAmountScreen`, immutable route param | No | **Yes** | No | Not vulnerable |
| Agent Mobile — Cash-to-Cash claim | Once, via `useRef` directly in `CashToCashClaimConfirmScreen` | No | **Yes** | No | Not vulnerable |

**Finding: the defect is unique to Customer Mobile's `SendMoneyScreen`.** All four Agent Mobile
financial-flow Confirm screens generate their Idempotency-Key exactly once (via `useRef`, which
is stable across re-renders and across React Navigation's typical keep-alive-on-back-navigation
behavior) and **never** call a key-regeneration function inside their `onError` handlers — grep
of all four Confirm screens for `newIdempotencyKey` found zero call sites inside error handling
(only the single initial-generation call site each). This was additionally pinned down with a new
confirmatory regression test (`apps/agent-mobile/__tests__/cash-to-wallet.test.tsx`, test "21. an
ambiguous outcome... never changes the Idempotency-Key used by a retry") proving three consecutive
attempts (NetworkError, then 5xx, then success) all used the identical key. No Agent-side
production code change was needed or made.

All five flows (Customer W2W + 4 Agent flows) share the **same, separate, narrower** gap: none
persists the pending key to durable storage, so none can automatically recover after a genuine
app process kill — this is addressed for Customer W2W (PART 10) and noted as a residual limitation
for the Agent flows (PART 10 scope — the task's confirmed, implementable defect was specific to
Customer W2W's key-regeneration behavior, not the app-restart gap in isolation, which exists even
in the already-safe Agent screens and is a materially smaller, lower-frequency risk given Agent
flows never regenerate a key on error in the first place).

## 3. Reproduction (PART 3)

### Backend-level: `test/v1-mobile-idempotency-recovery-01.integration.spec.ts` (new, real PostgreSQL)

Two tests, directly reproducing the task's primary-risk framing:

- **A. Retry with the original key K1** after it already committed → `201`, **same** transfer id
  returned both times, exactly one `transfers` row, one real debit. **Exactly-once/replay-safe**,
  as required.
- **B. Retry with a fresh key K2** after K1 already committed → `201` again, but a **different**
  transfer id, two `transfers` rows, **two real debits** (source wallet fully drained by both
  ₦5,000 transfers). This is the backend correctly, legitimately treating K2 as a brand-new
  logical operation — exactly as PART 2/PART 3 describe, and exactly why the client must never
  silently choose path B after an ambiguous outcome.

Run 3 times total (1 initial + 2 repeats): 2/2 passing every run, deterministic.

### Mobile-level: `apps/customer-mobile/__tests__/transfer.test.tsx` (extended, real production component)

Six new tests against the actual `SendMoneyScreen` component (not a reimplementation):
`NetworkError` preserves the key and shows an honest "couldn't confirm" message (not "failed");
a 5xx does the same; a definitive 4xx mints a fresh key and clears the pending intent; a
different customer's pending intent is never visible to or reused by this customer; logout
clears the pending intent; a rapid double-tap sends exactly one request. All 13 tests in the
file (7 pre-existing + 6 new) run 3 times for determinism: 13/13 passing every run.

## 4. Severity (PART 9)

- **A. Actual ledger corruption: NO.** Every posting involved (both in the K1-replay case and the
  K1-then-K2 double-debit case) is a correctly double-entry-balanced, fully auditable, properly
  recorded transfer. The ledger itself is never in an inconsistent state.
- **B. Legitimate duplicate financial transfers caused by client retry semantics: YES — CONFIRMED.**
  This is the actual mechanism. Precondition chain required for a real customer to experience it:
  (1) the original POST must reach the backend and its `SERIALIZABLE` transaction must commit;
  (2) the response must fail to reach the client (network drop in transit, or the local `fetch`
  call errors/times out before the body is received) — an inherently real, if not everyday,
  class of mobile-network failure; (3) the customer must manually retry the same transfer after
  seeing the "Transfer failed" message; (4) the retry must succeed in reaching the backend and
  pass PIN re-verification. If the customer's balance only covered one transfer, the second
  attempt would correctly fail with insufficient funds (incidentally preventing the duplicate in
  that specific case) — but if the balance covers two, both post as real, separate debits.
- **C. False UI status only: PARTIALLY, as a contributing factor.** The "Transfer failed" message
  shown on an ambiguous outcome is misleading (the outcome is unknown, not negative) and is what
  leads a reasonable customer to retry at all — but the actual financial consequence (B) only
  materializes if they do retry and it succeeds, so this is not a pure UI-only issue.
  Realistic customer impact: a confused/alarmed customer acting on bad information, who may then
  genuinely lose money by following the app's own (wrong) advice to "try again."
- **D. Operational/support burden: YES**, as a consequence of B — a customer with two real
  debits for one intended transfer would reasonably dispute one of them, requiring support
  investigation. The data to resolve the dispute is always available and unambiguous (two
  separate, correctly-recorded `transfers` rows), so reconciliation is possible, just manual.

**Not exaggerated:** this is not a "every transfer is at risk" defect — it requires a genuine
network-layer failure specifically in the narrow post-commit/pre-response window, which is real
but not a frequent occurrence. It was nonetheless a confirmed, traceable, reproducible gap in a
financial-integrity-critical code path, and is now fixed.

## 5. Root cause

`SendMoneyScreen.handleConfirmTransfer`'s single `catch (err: any)` block applied the same
"regenerate the Idempotency-Key" logic to every thrown error, without distinguishing a
**definitive** rejection (the backend received, understood, and rejected the request — PIN
error, validation, limit, 404, 409 — proving no financial effect occurred) from an **ambiguous**
outcome (`NetworkError` — no response was ever received — or a `5xx` — the server answered, but
with an unexpected failure, which does not prove the transfer never committed). The code's own
comment ("A rejected attempt... is not safely retryable... issue a new key") only ever described
the definitive case; the implementation never actually branched to apply that logic selectively.

## 6. Existing backend protection (PART 2)

- **No dedicated status-lookup endpoint exists** for a given idempotency key. `GET
  /transfers/:transferId` (`src/transfer/transfer.controller.ts`) and `GET
  /customers/me/transfers/:transferId` (`src/customer-app/customer-app.controller.ts`) both
  require the **server-generated transfer ID** — which, by definition, the client does not have
  if it never received the original response. There is no `GET .../transfers?idempotencyKey=...`
  or equivalent. **This was confirmed absent, not assumed, and no such endpoint was invented.**
- **What already exists, and is what the fix relies on:** re-POSTing the exact same
  `Idempotency-Key` + exact same body to `POST /customers/me/transfers` is itself a safe,
  already-implemented "ask the backend what happened" operation —
  `TransferService.executeWithinTransaction` looks up any existing `transfers` row by
  `idempotency_key` inside the same `SERIALIZABLE` transaction; if found with a matching
  `request_hash` it returns the original transfer without any new financial effect (replay); if
  the hash differs it returns a deterministic `409`. A separate, defensive catch-block in
  `createTransfer` handles the same outcome for the narrow race where two identical requests
  reach the unique-constraint check concurrently (`uq_transfers_idempotency_key`). **This
  mechanism is correct and sufficient — the fix only needed to make the client reliably reuse it,
  not to add anything new to it.**
- `requestHash` is a SHA-256 of `{sourceWalletId, destinationWalletId, amountMinor, currency,
  reference, narration}` — the customer transaction PIN is explicitly excluded from it (confirmed
  by a code comment in `customer-app.controller.ts`: *"PIN is never persisted in
  requestHash/transfer metadata/journal/audit/response/logs"*) — so the PIN re-entry required on
  every retry (including a safe replay) is a separate, unrelated authorization control, not part
  of the transfer's own identity.

## 7. Chosen V1 design (PART 8)

Before writing any code, the following existing infrastructure was inspected and found directly
reusable, avoiding new architecture:

- `apps/customer-mobile/src/services/secure-storage.ts` — already the app's one storage
  abstraction (used today only for session data); it already degrades to an in-memory store in
  the Jest test environment, so no new test infrastructure was needed either.
- The backend's existing Idempotency-Key + request-hash replay mechanism (PART 6/Section 6
  above) — already exactly the "query/reconcile the exact original logical operation" model the
  task describes as desirable; nothing new was added to the backend.

**Design implemented** (`apps/customer-mobile/src/services/pending-transfer.ts`, new, ~90 lines):

- One pending-transfer-intent record, persisted via the existing `SecureStorage` abstraction,
  under a **per-customerId storage key** (`pending_wallet_transfer_intent:<customerId>`) — so two
  different customers signing in on the same device never share a slot (no eviction, no leakage
  in either direction).
- Written immediately **before** the network call is made (covers an app kill right after send).
- Carries exactly the fields that define "the same logical transfer": `idempotencyKey`,
  `sourceWalletId`, `destinationWalletId`, `amountMinor`, `currency`, `narration`, plus
  `customerId` and `createdAt` for isolation/staleness checks. The customer PIN is never part of
  it (matches the backend's own exclusion).
- At submit time, if a still-valid (same customer, same business fields, < 24h old) pending
  intent exists, its key is reused instead of a freshly-minted one.
- Cleared on a **definitive** outcome (success, or any 4xx rejection) and on logout. **Preserved**
  on an **ambiguous** outcome (`NetworkError`, or any 5xx/other unknown error shape).
- A 24-hour staleness window (chosen for simple, conservative hygiene — the backend's own
  `transfers.idempotency_key` uniqueness never expires, so there is no correctness reason to pick
  any particular value; 24h comfortably covers any realistic recovery window without a stale
  intent lingering indefinitely) causes an old, abandoned intent to be dropped and ignored rather
  than resurrected against an unrelated future transfer.
- **Not implemented:** a new backend endpoint (none needed — see Section 6); a second transaction-identity
  system (the existing Idempotency-Key is reused as-is); automatic mount-time form-field
  restoration from a pending intent (out of the minimal scope — the submit-time reuse check alone
  is sufficient for correctness; the customer re-entering the same destination/amount/narration,
  which they would naturally do when manually retrying, already triggers correct key reuse);
  Jest-worker-level or cross-process persistence beyond `SecureStorage` (unnecessary — the mobile
  app is a single process per device).

## 8. Implementation

### Files changed

| File | Change |
|---|---|
| `apps/customer-mobile/src/services/pending-transfer.ts` | **New.** Persistence module described above. |
| `apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx` | `handleConfirmTransfer` now computes/reuses the effective key via the pending-intent check, persists it before sending, and branches on `isAmbiguousTransferOutcome(err)` (new helper) to either preserve the key + show an honest "couldn't confirm" message, or clear it + mint a fresh key + show the existing definitive-rejection message. Also adds a synchronous `useRef`-based in-flight guard against rapid double-taps (PART 4 hardening; defense-in-depth only — the backend's idempotency guarantee was already the real safety net). |
| `apps/customer-mobile/src/store/auth-store.ts` | `logout()` now also clears the pending transfer intent for the logged-out customer (reads `customerId` from state before it is reset). |
| `apps/agent-mobile/__tests__/cash-to-wallet.test.tsx` | **New confirmatory test only** (no production code change) proving Agent Cash-In does not share this vulnerability. |
| `test/v1-mobile-idempotency-recovery-01.integration.spec.ts` | **New.** Backend reproduction of scenarios A and B against real PostgreSQL. |
| `apps/customer-mobile/__tests__/transfer.test.tsx` | Extended with 6 new tests (see PART 11) and the mock surface needed to support them (`NetworkError`, `useAuthStore`). |

**No backend/production API code was changed.** The investigation (PART 2) confirmed the
backend's existing idempotency architecture is already correct and sufficient; per the task's own
instruction ("if it's test infra, optimize test infra; if production code, only change it if
profiling proves it's responsible"), no backend change was proven necessary or made. Authorization
(PIN verification), audit behavior, and backend financial semantics are completely unchanged.

### Before / after behavior

| Scenario | Before | After |
|---|---|---|
| Ambiguous failure (NetworkError/5xx) | Shows "Transfer failed...", mints a new key | Shows "We couldn't confirm whether this transfer went through...", **keeps the same key** |
| Retry after ambiguous failure (same transfer) | Backend sees it as a brand-new request (key K2) → could create a real second debit if K1 had committed | Backend sees the same key K1 → safely replays the original result, no second debit |
| Definitive 4xx rejection | Mints a new key | **Unchanged** — still mints a new key (this was always correct) |
| Success | Navigates to Home | **Unchanged**, plus the pending intent is now explicitly cleared |
| Rapid double-tap | Relied solely on `isLoading`-disabled button | Also guarded by a synchronous ref check (defense-in-depth) |
| Logout | Cleared 3 auth keys | Also clears this customer's pending transfer intent |
| Different customer on same device | N/A (no pending state existed) | Can never see or reuse another customer's pending intent (separate storage key per customerId) |

## 9. Regression tests (PART 11)

| # | Requirement | Test |
|---|---|---|
| 1 | Same logical transfer retry uses same idempotency key | `transfer.test.tsx` "a NetworkError... preserves the Idempotency-Key for a safe retry" (asserts `secondCallKey === firstCallKey`) |
| 2 | Ambiguous failure does not mint a fresh key | Same test, plus "a 5xx response... preserves the Idempotency-Key exactly like a NetworkError" |
| 3 | Definitive rejection permits a new logical attempt | "a definitive 4xx rejection DOES mint a fresh Idempotency-Key and clears any pending intent" |
| 4 | Successful operation clears pending state | Asserted inline in "should execute transfer..." (pre-existing test, extended) and in the NetworkError-then-retry test (post-success clear) |
| 5 | Duplicate submission does not create duplicate financial effect | "rapid double-tap on Confirm only sends ONE request" (mobile); `test/v1-w2w-recovery-audit-01.integration.spec.ts` test #2 (backend, real concurrent PostgreSQL requests, pre-existing from the prior audit, re-run here for confirmation) |
| 6 | App/customer isolation preserved | "a pending intent belonging to a DIFFERENT customer is never reused (customer isolation)" |
| 7 | Agent flows — equivalent coverage if vulnerable | Agent flows are **not** vulnerable (Section 2); confirmatory test added anyway: `cash-to-wallet.test.tsx` test 21 |
| — | Backend A-vs-B reproduction | `test/v1-mobile-idempotency-recovery-01.integration.spec.ts` (new, real PostgreSQL) |

## 10. Residual limitations (explicitly not fixed, and why)

- **App-restart/process-kill recovery depends on the customer re-entering the identical transfer
  details.** The fix persists the pending intent to `SecureStorage`, which does survive an app
  restart, and the submit-time matching logic will correctly find and reuse it — but there is no
  mount-time UI that proactively tells the customer "you have an unresolved transfer, do you want
  to resume it?" The customer must re-enter the same destination/amount/narration for the reuse
  check to match. This was a deliberate, minimal-scope choice (Section 7) rather than an
  oversight — building a resumption UI was judged unnecessary architecture for closing the actual
  financial-safety gap, which does not require it.
- **Agent Mobile flows still do not persist their key to durable storage**, so an app kill during
  one of their in-flight requests still loses the key on restart — but since none of the four
  Agent flows ever regenerates a key on error in the first place (Section 2), this is the same,
  smaller, already-existing gap shared by the Customer flow's own app-restart case, not the
  confirmed defect this task targeted. No change was made to Agent Mobile production code.
  Should Agent flows later need the same durable-persistence treatment for defense-in-depth, the
  same `pending-transfer.ts`-style module could be reused per flow — not attempted here to avoid
  unrelated changes beyond the task's confirmed scope.
- **5xx is conservatively always treated as ambiguous**, even in cases where a specific 5xx might
  in principle prove no commit occurred. This is the safe default (erring toward preserving the
  key costs nothing — a preserved key for an attempt that in fact never reached the database
  still results in a normal, successful first execution on retry) and was a deliberate choice,
  not an oversight.

## 11. Validation — exact commands and results

```
cd apps/customer-mobile && npx tsc --noEmit -p tsconfig.json      → exit 0, no errors
cd apps/customer-mobile && npx jest __tests__/transfer.test.tsx   → 13 passed, 13 total (×3 runs, deterministic)
cd apps/customer-mobile && npx jest                               → 12 suites, 98 tests passed, 98 total (no regressions)

cd apps/agent-mobile && npx tsc --noEmit -p tsconfig.json         → exit 0, no errors
cd apps/agent-mobile && npx jest __tests__/cash-to-wallet.test.tsx → 22 passed, 22 total
cd apps/agent-mobile && npx jest                                  → 17 suites, 234 tests passed, 234 total (no regressions)

npx tsc --noEmit -p tsconfig.json  (backend)                      → exit 0, no errors
npm run build  (backend, nest build)                              → exit 0

node ... jest --config jest.integration.config.js --runInBand \
  test/v1-mobile-idempotency-recovery-01.integration.spec.ts      → 2 passed, 2 total (×3 runs, deterministic)
node ... jest --config jest.integration.config.js --runInBand \
  test/a23-customer-app.integration.spec.ts \
  test/v1-w2w-recovery-audit-01.integration.spec.ts               → 18 passed, 18 total (no regressions to the
                                                                      pre-existing transfer/idempotency coverage)
```

No orphaned `mn_it_%` PostgreSQL databases after any run (verified via direct `pg_database`
query). The full `npm run test:pg` suite (89 files) was **not** re-run in full for this task — not
required, since no backend production code changed, and the directly-relevant backend suites
(transfer creation/idempotency, customer-app endpoint, the prior W2W audit) were run and passed.

## 12. Exact files changed

```
 apps/agent-mobile/__tests__/cash-to-wallet.test.tsx           |  29 +++  (new test only)
 apps/customer-mobile/__tests__/transfer.test.tsx              | 215 ++++++++++++++++++++-
 apps/customer-mobile/src/screens/authenticated/SendMoneyScreen.tsx | 129 +++++++++++--
 apps/customer-mobile/src/store/auth-store.ts                  |   9 +
 apps/customer-mobile/src/services/pending-transfer.ts         | new file
 test/v1-mobile-idempotency-recovery-01.integration.spec.ts    | new file
```

No branding, mobile UI unrelated to this flow, product scope, commercial rules, ledger semantics,
or security rules were touched. `ProductCatalogService` was not touched. The prior
`V1-W2W-RECOVERY-SECURITY-AUDIT-01` finding was not reopened or altered.
