# V1-CUSTOMER-05 — Secure Customer Transaction PIN Change/Reset

Branch: `arena/01a10374-monienaija`
Starting HEAD: `29cf7a6` (`fix(customer-mobile): complete OTP registration flow`)
Status: Backend + Customer Mobile fix implemented, tested, documented. No EAS/APK build, no physical device UAT, no real-money testing — none of that was in scope and none of it was performed.

---

## 1. Original vulnerability / gap

`POST /api/v1/customers/me/transaction-pin` accepted `{ pin }` from any
authenticated `CUSTOMER` principal and called
`CustomerTransactionPinService.setTransactionPin(customerId, …)`
unconditionally. If a PIN row already existed for that customer (active
**or locked**), the handler silently overwrote it — resetting
`failedCount`/`accountLocked` to a clean state — with **no proof of
knowledge of the previous PIN, no OTP, no password step-up, and no other
re-authentication**. The only prerequisite was a valid bearer session
token.

The Transaction PIN is a financial authorization factor: every
Wallet→Wallet transfer requires it (`createTransfer` in
`customer-app.controller.ts` calls
`CustomerTransactionPinService.verifyTransactionPin` immediately before
delegating to `TransferService`). A compromised or stolen bearer token —
without ever knowing the victim's PIN — was therefore sufficient to
**silently replace the victim's Transaction PIN and gain the ability to
authorize transfers out of their wallet**. The previous
`TransactionPinScreen.tsx` even documented this explicitly in its code
comment: *"The backend exposes a single idempotent 'set' operation (it
does not require proof of a previous PIN before overwriting it)."*

This was flagged P0 during V1-CUSTOMER-03.

## 2. Existing architecture (as audited)

- **Entity**: `src/customer/customer-transaction-pin.entity.ts` —
  `customer_transaction_pins` table: `pinHash`, `hashAlgorithm`,
  `pinVersion`, `failedCount`, `accountLocked`, `lockedAt`, `lockReason`,
  optimistic `version`, soft-delete (`deletedAt`). One active row per
  customer (unique partial index `WHERE deleted_at IS NULL`).
- **Service**: `src/customer/customer-transaction-pin.service.ts` —
  `setTransactionPin` (pure upsert, no old-PIN check, took `pinVersion`
  straight from the caller), `verifyTransactionPin` (PBKDF2 timing-safe
  verify via an injected verifier, increments `failedCount`, locks at
  `MAX_FAILED_PINS = 5`, resets `failedCount` to 0 on a successful
  verify, writes `PIN_VERIFIED`/`PIN_FAILED`/`PIN_CREATED`/`PIN_ROTATED`
  audit events with all values passed through `redactRecord` — no
  plaintext PIN or hash is ever audited), `getTransactionPin`.
- **Controller**: `src/customer-app/customer-app.controller.ts` — PBKDF2
  hashing happens in the controller (10,000 iterations, SHA-256, random
  16-byte salt per PIN), never in the service. `customers/me/*` routes
  are bound to `allowedPrincipalTypes: ['CUSTOMER']` /
  `customerAccess: 'SELF'` in `route-policy-registry.ts` — ownership was
  already correctly enforced (principal.customerId is used directly,
  never trusted from the body), and there is **no workforce bypass** of
  this route family. The gap was authentication *strength* for a
  replace, not authorization *scope*.
- **Established in-repo pattern for "prove the old secret, then
  replace"**: `POST customers/me/password` (`changePassword`) already
  requires `{currentPassword, newPassword}`, verifies the current
  password via `AuthenticationExecutionService.authenticate` (which
  enforces its own lockout), and only then rotates. This V1-CUSTOMER-05
  fix mirrors that exact shape for the PIN.
- **Agent PIN (`src/agent-authentication/agent-authentication.service.ts`
  + `.controller.ts`)** was inspected as the suggested reference
  pattern. It turned out to have the **identical defect** — `POST
  agents/me/transaction-pin` is also an unconditional overwrite with no
  old-PIN check. It was therefore **not** a safe pattern to copy for the
  "change" semantics; it was only reused for the `GET .../transaction-pin`
  status-shape (`NOT_SET`/`ACTIVE`/`LOCKED`), which is read-only and has
  no security implication. The Agent PIN overwrite defect is **out of
  scope for this Customer-only task** and is called out below as a
  separate, still-outstanding finding.

## 3. First-time creation semantics (unchanged behavior, new precondition)

`POST customers/me/transaction-pin { pin }` is now **create-only**:
- If no active PIN row exists for the authenticated customer → creates
  one exactly as before (PBKDF2 hash, `pinVersion: 1`, `PIN_CREATED`
  audit event).
- If a PIN row already exists (active **or locked**) → `409 Conflict`,
  `"A Transaction PIN already exists for this account. Use
  customers/me/transaction-pin/change to replace it."` No mutation
  occurs.

A brand-new customer is never asked for an "old PIN" — the Customer
Mobile screen only renders a bare create form when `GET
customers/me/transaction-pin` reports `NOT_SET`.

## 4. Known-PIN change semantics (new)

`POST customers/me/transaction-pin/change { currentPin, newPin }`:
1. Requires `CUSTOMER` principal (same `requireCustomerPrincipal` guard
   as every other `customers/me/*` route).
2. Format-validates both PINs (`/^\d{4,12}$/`).
3. Rejects `currentPin === newPin` (400) — defense-in-depth, mirrors the
   password-change endpoint's same rule.
4. `400` if no PIN exists yet (directs the caller to the create
   endpoint) — creation and change are never conflated.
5. `401` immediately if the existing PIN is already locked — **a locked
   PIN cannot be changed**. This is a hard stop with no bypass.
6. Verifies `currentPin` via the **existing**
   `CustomerTransactionPinService.verifyTransactionPin` — the exact same
   method, same `failedCount` column, same `MAX_FAILED_PINS = 5`
   constant used by Wallet→Wallet authorization. A wrong `currentPin`
   during a change attempt increments the same counter and can lock the
   PIN exactly as a wrong PIN on a transfer would. No second/parallel
   lockout counter was introduced.
7. Only once `currentPin` verifies does the handler compute a fresh
   PBKDF2 hash (new random salt) for `newPin` and call the existing
   `setTransactionPin` (its UPDATE branch), which resets
   `failedCount`/`accountLocked` to a clean state and writes the
   existing `PIN_ROTATED` audit event — no entity/service/migration
   changes were required; the whole fix is in the controller.
8. Response is `{ customerId, pinVersion, updatedAt }` — never the PIN
   or the hash. `pinVersion` is incremented (`existing.pinVersion + 1`)
   on every successful change, giving an auditable rotation counter that
   the original unconditional-overwrite endpoint never produced
   (previously every "replace" silently reset `pinVersion` back to `1`).

## 5. Recovery semantics (forgotten / locked PIN)

**There is intentionally no in-app recovery path for a locked or
forgotten Transaction PIN in V1.** `GET customers/me/transaction-pin`
reports `status: 'LOCKED'`; the change endpoint refuses to touch a
locked PIN; there is no third "reset" endpoint.

This is a deliberate decision, not an oversight: V1 has no secure,
independent channel (e.g. an OTP delivered to a verified phone, bound to
a fresh challenge, rate-limited and audited the way phone verification
is during registration) that could prove the customer's identity without
relying on the PIN itself. Building a recovery flow without such a
channel would reintroduce exactly the vulnerability this task closes —
an ordinary authenticated session overwriting a financial authorization
factor. Per the task's explicit instruction, it is "acceptable and
preferred" to leave recovery unavailable rather than invent an unsafe
mechanism. The Customer Mobile UI states this plainly and points the
customer to Support (`CreateSupportTicketScreen`, already built and
unchanged) rather than exposing a button that silently resets the PIN.

**Recommended follow-up** (not built, out of scope here): a dedicated
PIN-recovery OTP flow analogous to the registration phone-verification
challenge, with its own rate limiting and audit trail, gated behind a
reviewed security design — tracked in Section 11/12 below as the
suggested next task.

## 6. API contract (final)

| Method | Path | Auth | Body | Success | Failure |
|---|---|---|---|---|---|
| `GET` | `customers/me/transaction-pin` | CUSTOMER SELF | — | `200 { status: NOT_SET\|ACTIVE\|LOCKED, exists, accountLocked, pinVersion?, lastChangedAt?, failedCount?, lockedAt?, lockReason? }` | `401` unauthenticated |
| `POST` | `customers/me/transaction-pin` | CUSTOMER SELF | `{ pin }` | `200 { customerId, pinVersion, updatedAt }` — **create only** | `400` bad format, `409` PIN already exists |
| `POST` | `customers/me/transaction-pin/change` | CUSTOMER SELF | `{ currentPin, newPin }` | `200 { customerId, pinVersion, updatedAt }` | `400` bad format / same PIN / no PIN set yet, `401` wrong current PIN / now locked / already locked |
| `POST` | `customers/me/transaction-pin/verify` | CUSTOMER SELF | `{ pin }` | `200 { verified: true }` | `200 { verified: false, reason, locked }` (unchanged, not part of this fix) |

No new route-policy entry was needed: all four paths fall under the
existing `customers/me/*` wildcard in `route-policy-registry.ts`
(`allowedPrincipalTypes: ['CUSTOMER']`, `customerAccess: 'SELF'`,
`agentAccess: 'NONE'`, `aggregatorAccess: 'NONE'`) — there is no
workforce route that can touch a customer's PIN.

## 7. Customer Mobile UX

`apps/customer-mobile/src/screens/authenticated/TransactionPinScreen.tsx`
was rewritten to call `GET customers/me/transaction-pin` on focus and
render one of four states:
- **Loading** — spinner while the status call is in flight.
- **`NOT_SET`** — "Create Transaction PIN" form: new PIN + confirm only.
  No current-PIN field is ever shown here.
- **`ACTIVE`** — "Change Transaction PIN" form: current PIN + new PIN +
  confirm. Client-side validation mirrors the backend (format, confirm
  match, new ≠ current) so obviously-invalid submissions never hit the
  network.
- **`LOCKED`** — a plain-language banner explaining the PIN is locked
  and that V1 has no in-app reset, plus a single "Contact Support" button
  that navigates to the existing `CreateSupportTicketScreen`. There is
  **no "Reset PIN" button that overwrites anything**.
- **Status-fetch failure** — an error banner with a "Retry" button
  instead of a blank or crashed screen.

The PIN values live only in component state, are cleared on submit,
success, error, focus-change, and unmount, and are never written to
SecureStore, Zustand, navigation params, or logs. The submit buttons use
the existing `Button` component's `loading`/`disabled` wiring, so a
second tap while a request is in flight cannot fire a second API call
(the button swaps to a spinner and becomes non-interactive).

## 8. Security controls

- Old and new PINs are never logged (unchanged: pinoHttp redacts
  `req.body`, and the PIN is never written to `requestHash`/transfer
  metadata/journal metadata — verified by the pre-existing a24 suite and
  the new suite's test 11/12).
- PBKDF2 (SHA-256, 10,000 iterations, random 16-byte salt) hashing,
  unchanged scheme, fresh salt generated per create/change.
- Timing-safe comparison (`crypto.timingSafeEqual`) in the verifier,
  unchanged.
- The 5-attempt lockout (`MAX_FAILED_PINS`) is **not weakened** — it is
  the single counter shared by `/verify`, Wallet→Wallet authorization,
  and the new `/change` endpoint's current-PIN check. A locked PIN
  cannot be changed (no bypass), and a lockout triggered by a change
  attempt behaves identically to one triggered by a failed transfer.
- Ownership: the endpoint only ever reads `principal.customerId` from the
  verified bearer token; the request body carries no customer identifier
  that could be substituted. Verified in test 7 (`V1-CUSTOMER-05` suite)
  and unchanged from the pre-existing route-policy enforcement.
- Idempotency: considered but deliberately not implemented via a stored
  idempotency ledger (unlike money transfers). The PIN-change operation
  is already naturally retry-safe without one: a retried
  `{currentPin, newPin}` call either (a) still matches the live PIN and
  re-applies the identical `newPin` — a harmless no-op in effect — or
  (b) no longer matches because the first call already succeeded, in
  which case it fails closed with "current PIN is incorrect" rather than
  causing any double-application or corruption. There is no code path by
  which a retry can move money or silently chain multiple PIN changes.
- No workforce-only route can reach this logic (verified against
  `route-policy-registry.ts`); the `customers/me/*` family is customer
  principal–only end to end.
- A successful change resets `failedCount`/`accountLocked` to a clean
  state (same as the original create path) — this is intended: a
  legitimate, re-authenticated change should not leave stale lockout
  state behind.

## 9. Test coverage

### Backend — `test/v1-customer-05-transaction-pin-security.integration.spec.ts` (new, real PostgreSQL)

15 tests, all passing, exceeding the 12 minimum required cases:

1. First-time creation succeeds.
2. Create-only — a second `POST transaction-pin` for the same customer
   is rejected `409`, original PIN survives.
3. Known-PIN change succeeds with correct `currentPin`, `pinVersion`
   increments.
4. Known-PIN change fails `401` with incorrect `currentPin`; original
   PIN remains usable, new PIN is not.
5. Incorrect `currentPin` during change increments `failed_count` (the
   same column/counter used by Wallet→Wallet authorization).
6. Five failed change attempts lock the PIN; a subsequent change
   attempt — even with the correct current PIN — is rejected `401`; no
   lockout bypass via "change".
7. Ownership — Customer A's change never touches Customer B's PIN; an
   unauthenticated change request is `401` with no state change.
8/9. Wallet→Wallet regression — old PIN fails a transfer after a
   successful change, new PIN succeeds (combined into one test, see
   Section 10).
10. Wallet→Wallet regression — a failed change attempt (wrong current
    PIN) does not alter the PIN usable for a transfer.
11. No PIN/hash leakage in create/change/status response bodies.
12. `PIN_ROTATED` audit event exists for a successful change, alongside
    `PIN_CREATED`; no plaintext PIN or hash in any audit row.
13. Validation — `newPin === currentPin` is rejected `400`.
14. Separation — the change endpoint rejects (`400`) when no PIN has
    been created yet; creation and change are never conflated.
15. Status endpoint accurately reports `NOT_SET` → `ACTIVE` → `LOCKED`.
16. Format validation on the change endpoint (malformed PINs rejected,
    `400`, no state/counter mutated).

```
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

### Backend — pre-existing suites re-run unmodified (no deletions, no weakening)

```
test/a24-customer-transaction-pin-hardening.integration.spec.ts  19 passed, 19 total
test/a23-customer-app.integration.spec.ts                         — part of 107 passed, 5 suites
test/a25-customer-history-hardening.integration.spec.ts           — part of 107 passed, 5 suites
test/a26-customer-profile-hardening.integration.spec.ts           — part of 107 passed, 5 suites
test/v1-001-customer-funding.integration.spec.ts                  — part of 107 passed, 5 suites
test/v1-hardening-01-customer-beneficiary.integration.spec.ts     — part of 107 passed, 5 suites
```
(`a23/a25/a26/v1-001/v1-hardening-01` ran together: `5 passed, 107 tests passed`.)

### Backend — full repository regression (real PostgreSQL)

```
Test Suites: 4 failed, 74 passed, 78 total
Tests:       5 failed, 1554 passed, 1559 total
```

78 suites / 1559 tests total = the pre-existing baseline of 77 suites /
1544 tests **plus exactly** the one new suite / 15 new tests added here.
The same **4 suites / 5 tests** that were already failing before this
change are still failing, for the same pre-existing, unrelated reasons
(see Section 11 and the commit history for `v1-customer-onboarding-01`,
`v1-hardening-06-admin-customer-investigation`,
`v1-workforce-bootstrap-01`, `migration-chain`). **Zero new failures.**

### Customer Mobile — `apps/customer-mobile/__tests__/transaction-pin.test.tsx` (new)

7 tests, all passing:
1. First-time creation — `NOT_SET` renders the create form; successful
   submit shows confirmation.
2. Known-PIN change — `ACTIVE` renders current/new/confirm fields;
   successful change shows confirmation.
3. Incorrect current PIN — a `401` from the backend shows an inline
   error and keeps the user on the change form.
4. New PIN mismatch — client-side validation blocks submission before
   any API call.
5. Locked state — shows the honest "no in-app reset" message, renders no
   PIN input fields, and the "Contact Support" button navigates to
   `CreateSupportTicket`; no "Reset PIN" text anywhere.
6. API failure handling — a status-fetch failure shows an error with a
   working "Retry" action.
7. Loading/duplicate-submit prevention — a second tap while a create
   request is in flight does not trigger a second API call.

### Customer Mobile — full suite + typecheck

```
npx tsc --noEmit         → clean, zero errors
npx jest                 → Test Suites: 10 passed, 10 total
                            Tests:       47 passed, 47 total
```//
(10 suites / 47 tests = the pre-existing 9 suites / 40 tests plus the one
new suite / 7 new tests. No existing test was modified, deleted, or
weakened.)

### Backend typecheck

```
npx tsc --noEmit -p tsconfig.json   → clean, zero errors
```

## 10. Wallet→Wallet regression evidence

Proven by integration tests 8/9 and 10 in the new suite (real
PostgreSQL, real `WalletService`/`LedgerService`, real
`TransferService.createTransfer`, SERIALIZABLE isolation preserved —
no mocking of the ledger):

- **Old PIN stops working after a change**: a customer funds a wallet,
  successfully transfers `10000` minor units using PIN `1234`, changes
  the PIN to `5678` via `/change`, then attempts another transfer with
  the *old* PIN `1234` — the backend responds `401 Invalid PIN` and the
  wallet balance is **not** debited a second time.
- **New PIN works after a change**: the same test immediately retries
  the identical transfer with the *new* PIN `5678` — `201 COMPLETED`,
  and the final wallet balance (`80000`, i.e. `100000 − 10000 − 10000`)
  proves exactly two successful debits occurred and the failed old-PIN
  attempt caused none.
- **A failed change does not alter the PIN usable for a transfer**: a
  customer funds a wallet, attempts a PIN change with the *wrong*
  current PIN (`9999` against a real PIN of `1234`) — the change is
  rejected `401` — and then successfully transfers `5000` minor units
  using the original PIN `1234`, proving the failed change left the real
  PIN completely intact.

No environment blocker was hit for these tests: the embedded PostgreSQL
instance (`node scripts/embedded-pg.js`) ran these suites directly
against a real database, not mocks.

## 11. OTP lockout off-by-one — status: still outstanding, independent, not touched

The previously identified defect in
`test/v1-customer-onboarding-01.integration.spec.ts` ("19: failed-attempt
lockout — after 5 wrong attempts even the correct code is refused")
remains present and **unchanged** by this task:

```
Expected: 5
Received: 6
```

This asserts `attempt_count` on `customer_registration_phone_challenges`
— the **customer registration phone-OTP** table — which is architecturally
and physically separate from `customer_transaction_pins` (different
table, different service, different controller endpoint
(`POST customers/registration/...` vs `customers/me/transaction-pin*`),
no shared code path). Inspection during this task confirmed there is
**no coupling** between the two: the Transaction PIN lockout
(`MAX_FAILED_PINS` in `CustomerTransactionPinService`) is a completely
independent counter and code path from the OTP challenge's attempt
counter. Per the task's explicit instruction, it was **not** auto-fixed.

**This remains an outstanding P0/P1-track defect in the registration OTP
flow, separate from Transaction PIN security, and must stay visible in
the backlog as its own task** (suggested: "V1-CUSTOMER-06 — fix
registration OTP attempt-counter off-by-one").

## 12. Remaining limitations

- No in-app Transaction PIN recovery for a locked/forgotten PIN (by
  design — see Section 5). A locked customer must go through Support.
- The Agent Transaction PIN (`agents/me/transaction-pin`) has the
  **same unconditional-overwrite defect** this task fixed for customers.
  It was out of scope here (this task was explicitly Customer-only) and
  was **not modified**. It should be tracked and fixed with the same
  pattern in a follow-up task.
- The OTP-lockout off-by-one in customer registration (Section 11)
  remains open and is explicitly out of scope for this task.
- No EAS build, no physical device testing, no real-money/production
  testing was performed or claimed. All verification above is automated
  test execution against an embedded PostgreSQL instance and Jest/RNTL
  unit tests; this is not release-readiness evidence.
- Idempotency for the change endpoint relies on the operation's natural
  fail-closed retry safety (Section 8) rather than a stored idempotency
  ledger; this is believed sufficient for a low-frequency, non-monetary
  mutation, but has not been load- or chaos-tested.

## 13. Exact commits

- Starting HEAD for this task: `29cf7a6` (`fix(customer-mobile): complete
  OTP registration flow`), on `arena/01a10374-monienaija`.
- This task's commit(s): see the top-level session/PR history on
  `arena/01a10374-monienaija` immediately following `29cf7a6` — the
  backend/mobile code change is committed as `fix(customer): secure
  transaction PIN change flow`, with this document included in the same
  or an immediately following commit.
