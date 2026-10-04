# V1-CUSTOMER-09 — Customer Support & Account-Problem Resolution: Audit + Completion Report

**Starting HEAD:** `0d601e6e46ebc2cba15c1d5e1066269d5737f4fe` (docs commit closing V1-CUSTOMER-08)
**Final HEAD (this task):** committed as `feat(customer): complete support and account resolution` (see branch `arena/01a10374-monienaija`)
**Branch:** `arena/01a10374-monienaija`

**Files changed this task:**

Backend:
- `src/support/support.service.ts` — reply (`addMessage`) idempotency/concurrency fix
- `src/support/support-customer.controller.ts` — reads `Idempotency-Key` header and threads it through on customer replies
- `test/v1-007-support-ticket.integration.spec.ts` — extended with test `22b` (reply idempotency)
- `test/v1-customer-09-support-workforce-boundary.integration.spec.ts` — **new**, 36 real-HTTP tests
- `test/workforce-session-principal-type.spec.ts` — **new**, 4 unit tests

Customer Mobile:
- `apps/customer-mobile/src/navigation/types.ts` — new `SupportTicketDetail` route; extended `CreateSupportTicket` params
- `apps/customer-mobile/src/navigation/AppNavigator.tsx` — registers `SupportTicketDetailScreen`
- `apps/customer-mobile/src/screens/authenticated/SupportTicketDetailScreen.tsx` — **new**, ticket detail + reply screen
- `apps/customer-mobile/src/screens/authenticated/SupportScreen.tsx` — ticket rows now tappable → detail screen
- `apps/customer-mobile/src/screens/authenticated/CreateSupportTicketScreen.tsx` — rewritten: prefill from nav params, idempotency key, transaction-context banner
- `apps/customer-mobile/src/screens/authenticated/TransactionPinScreen.tsx` — locked-PIN "Contact Support" now prefills `category: 'PIN'`
- `apps/customer-mobile/src/screens/authenticated/TransactionsScreen.tsx` — rows gain a "Get help" affordance → prefilled ticket
- `apps/customer-mobile/src/components/TransactionRow.tsx` — optional `onGetHelp` affordance
- `apps/customer-mobile/src/services/transfer-view.ts` — new `buildSupportContextForTransaction()` mapping helper
- `apps/customer-mobile/__tests__/support.test.tsx` — **new**, 17 tests
- `apps/customer-mobile/__tests__/transactions.test.tsx` — extended, 3 new tests
- `apps/customer-mobile/__tests__/transaction-view.test.ts` — extended, 3 new tests
- `apps/customer-mobile/__tests__/transaction-pin.test.tsx` — 1 existing assertion updated (now asserts the `category: 'PIN'` param)

No new database migration, no new backend table/column, no new ticket status, no new category beyond what already existed.

---

## 0. Why this report opens with a correction

The task explicitly states that a prior historical audit claiming support-ticket detail/reply was "incomplete" on Customer Mobile is **not authoritative**, and that the actual repository must be inspected before writing any code. That audit was performed in full (summarized below). It turned out the prior claim was **independently reconfirmed true for one specific area** (Customer Mobile had no ticket-detail/reply screen) while being **false or irrelevant for almost everything else it implied** — the backend ticket system, authorization, lifecycle, and idempotency-on-create were all already mature and correct. The work below is scoped exactly to what the audit found missing, nothing more.

---

## 1. Part A — Backend architecture audit

`src/support/` is a single, coherent, already-mature V1 support-ticket subsystem:

- **Entities**: `support_tickets`, `support_ticket_messages` (raw SQL via `DataSource`/`manager.query`, not a TypeORM repository — consistent with this codebase's pattern elsewhere for transactional financial/adjacent subsystems).
- **Model** (pre-existing, confirmed, not reinvented):
  - Statuses: `OPEN → IN_PROGRESS → RESOLVED → CLOSED` (strictly forward-only; see Part I).
  - Categories: `TRANSFER`, `WALLET`, `PIN`, `AUTHENTICATION`, `PROFILE`, `CASH_IN`, `CASH_OUT`, `CASH_TO_CASH`, `FUNDING`, `OTHER`.
  - Optional structured links: `fundingRequestId`, `relatedTransferId` (both already existed; no new columns added).
  - Messages carry `authorType`/`authorId`/`body`/`isInternal` — `isInternal` messages are filtered out of every customer/agent-facing read path.
- **Routes**:
  - Customer-scoped: `GET/POST /customers/me/support/tickets`, `GET /customers/me/support/tickets/:id`, `GET/POST /customers/me/support/tickets/:id/messages` (`support-customer.controller.ts`).
  - Internal/workforce-scoped: `GET /internal/support/tickets`, `GET /internal/support/tickets/:id`, `POST .../assign`, `POST .../status`, `POST .../messages` (`support-internal.controller.ts`), gated by `route-policy-registry.ts` → `allowedPrincipalTypes: ['OPERATOR','PRIVILEGED','SUPPORT','SERVICE']` + a `requireWorkforce()` guard in the controller itself (defense in depth).
- **Create-ticket idempotency was already correct**: `createTicket()` already used `IdempotencyService.reserve()`/`.complete()` with a `requestHash` keyed on ticket fields + principal, inside the same DB transaction, with same-key/same-body → replay, same-key/different-body → `409 Conflict`. Confirmed by re-running pre-existing test `22` and extending it with a reply-side sibling (`22b`).
- **The one genuine backend gap**: `addMessage()` (the reply path) had **no idempotency protection at all** — every call, including a client-side double-tap or network retry, created a brand-new message row. This is now fixed (Part J, below) using the exact same `IdempotencyService` pattern already proven correct for `createTicket()` — no new idempotency framework was introduced.

**Conclusion: the backend ticket system itself did not need to be rebuilt or duplicated. One real correctness gap (reply idempotency) was found and fixed with the smallest correct change.**

---

## 2. Part B — Customer authorization / IDOR audit

Confirmed correct, unchanged. `support-customer.controller.ts`'s `requireCustomer()` + every `SupportService` method re-derives the customer id from the authenticated `principal`, never from a client-supplied id, and every lookup is scoped `WHERE customer_id = $principal.customerId`, so a customer requesting another customer's ticket id gets a `404` (not a `403`, which would leak existence). This is exercised by pre-existing tests `3` ("Customer cannot see another customer ticket (404)") and `15` ("message ownership isolation") in `v1-007-support-ticket.integration.spec.ts`, both re-run green this session — not duplicated, only reconfirmed.

---

## 3. Part C — Workforce (support-staff) authorization audit

### 3.1 What was confirmed

- The internal support routes are correctly locked to `OPERATOR`, `PRIVILEGED`, `SUPPORT`, `SERVICE` principal types at the route-policy layer, with a second `requireWorkforce()` check inside the controller (belt-and-braces, consistent with UAT-DEFECT-001/SEC-005/ADMIN-011-style "don't trust a single guard" vigilance called for in the task).
- `A2WorkforceSessionService` (`src/authorization/workforce-session.service.ts`) is the **only** place in the entire codebase that issues a workforce session principal, and it resolves every real workforce session to exactly `OPERATOR` (default) or `PRIVILEGED` (only when the session's active roles include `FINANCE_ADMIN`). **No code path anywhere in `src/` ever issues a `SUPPORT` or `SERVICE` principal type** — those two values exist only in the type union and in the route-policy allow-list, never in an actual session resolver.
- This was not just asserted by reading the code; it was verified two ways:
  1. `test/workforce-session-principal-type.spec.ts` (**new**, 4 tests) — a focused unit test directly exercising `A2WorkforceSessionService`'s resolution logic across no-assignment / non-admin-role / admin-role configurations, asserting the resolved type is always `OPERATOR` or `PRIVILEGED`, and explicitly asserting it is never `SUPPORT`/`SERVICE` for any role configuration tried.
  2. `test/v1-customer-09-support-workforce-boundary.integration.spec.ts` (**new**, 36 tests) — a genuine real-HTTP boundary test (full Nest app, real `FastifyAdapter`, real global guard chain, real route-policy lookup, real controller) that proves the actual permission boundary for `/internal/support/*` — not merely that a guard decorator exists. It overrides only the workforce OIDC/session-store step (the same already-covered, already-tested seam used by `test/v1-003-admin-operational-writes.integration.spec.ts`) so that `Bearer workforce-<TYPE>` resolves to a synthetic principal of that type, while everything downstream — `RuntimeAccessGuard`, `AuthorizationService` route-policy, `requireWorkforce()`, the actual support controllers and service — is the real production code. It proves, over real HTTP:
     - All four nominally-"workforce" types (`SUPPORT`, `OPERATOR`, `SERVICE`, `PRIVILEGED`) **can** list/fetch/assign/change-status/message a ticket (`200`/`201`).
     - All three non-workforce types (`CUSTOMER`, `AGENT`, `AGGREGATOR`) are **rejected with `403`** on every one of those same operations, even though they pass the authentication guard.
     - Unauthenticated requests are rejected with `401` before any principal type is even considered.

### 3.2 The genuine, scope-limited gap being documented (not fixed)

`SUPPORT` is allow-listed in the route policy and in `requireWorkforce()`, but there is **no actual way today to issue a session with `type: SUPPORT`** — real support staff can only operate via an `OPERATOR` (or `FINANCE_ADMIN`-flagged `PRIVILEGED`) workforce session, which is broader than a dedicated least-privilege "support agent" role would be. This is a real authorization-model gap, but it is explicitly out of scope per Part O ("broad workforce-authorization redesign — SUPPORT-type gap documented only, not fixed"). It is recorded here as the **recommended next task** (see §14).

---

## 4. Part D — Customer Mobile audit

Audited `apps/customer-mobile/src/screens/authenticated/SupportScreen.tsx` and `CreateSupportTicketScreen.tsx` as they stood at `0d601e6`:

| Capability | Status found | Action |
|---|---|---|
| List own tickets (`GET /customers/me/support/tickets`) | Present, correct, paginated, loading/empty/error/pull-to-refresh all present | None |
| Create ticket (`POST .../tickets`) | Present, correct, category chips, client-side validation | Extended (prefill + idempotency), not rebuilt |
| **Ticket detail view** | **Missing** — tapping a ticket did nothing | **Built**: `SupportTicketDetailScreen.tsx` |
| **Reply to a ticket** | **Missing** — no UI called `POST .../messages` anywhere on Customer Mobile | **Built**: part of the same new screen |
| Status display | List showed status badges; detail had nowhere to show it | Built into the new detail screen (header badge + forward-only-respecting reply gating) |
| Loading/empty/error/refresh | Present on the list; needed equivalents on the new detail screen | Added: `LoadingState`, `ErrorState` with retry, `RefreshControl` pull-to-refresh, empty-thread message |
| Navigation wiring | N/A (route didn't exist) | Added `SupportTicketDetail` route, registered in `AppNavigator.tsx` |

This reconfirms, narrowly, the one concrete claim from the historical audit that mattered: ticket detail/reply genuinely did not exist on Customer Mobile. Everything else about ticket list/create was already sufficient and was not rebuilt.

---

## 5. Part E — Locked-PIN support path

`TransactionPinScreen.tsx`'s locked state already showed an honest "contact support" message with no fake in-app PIN reset (confirmed correct, V1-CUSTOMER-05 territory, untouched). The only gap: its "Contact Support" button navigated to `CreateSupportTicket` with **no context**, forcing the customer to re-explain their problem from scratch. Fixed by passing navigation params only:

```ts
navigation.navigate('CreateSupportTicket', {
  category: 'PIN',
  subject: 'Transaction PIN locked',
  description: 'My Transaction PIN is locked after too many incorrect attempts and I need Support to unlock it.',
});
```

No PIN-reset, PIN-bypass, or security-question workaround logic was added anywhere — this is purely a form-prefill convenience; the customer still must wait for a human support agent to act, exactly as before.

---

## 6. Part F — Suspended-account support UX

Audited and found already sufficient: suspended/restricted-account messaging elsewhere in Customer Mobile does not leak admin notes, staff identity, or fraud-risk/investigation details, and already directs the customer toward the ordinary support-ticket flow where relevant. No change made (per the task's own guidance: "if existing system is already sufficient, document that honestly rather than manufacturing a feature").

---

## 7. Part G — Transaction-linked support (resolved: no schema change)

**Decision taken:** reuse the two existing backend fields (`relatedTransferId`, `fundingRequestId`) for the transaction types they genuinely describe, and use plain prefilled description text for the rest — no new backend field, no internal-ID typing burden placed on the customer.

Implemented via a new pure mapping function, `buildSupportContextForTransaction()` in `apps/customer-mobile/src/services/transfer-view.ts`, applied from a new "Get help" affordance on every row in `TransactionsScreen.tsx`:

| Unified transaction type | Category sent | Structured link sent | Why |
|---|---|---|---|
| `WALLET_TRANSFER` | `TRANSFER` | `relatedTransferId` | Row id is literally the `transfers.id` row |
| `FUNDING` | `FUNDING` | `fundingRequestId` | Row id is literally the `customer_funding_requests.id` row |
| `CASH_TO_CASH` | `CASH_TO_CASH` | *(none)* | Not a row in `transfers`/`customer_funding_requests` — no matching column exists or should be invented for one UI convenience |
| `CASH_IN` | `CASH_IN` | *(none)* | Same reasoning |
| `CASH_OUT` | `CASH_OUT` | *(none)* | Same reasoning |

For the three types with no structured link, the human-readable reference/amount/date is embedded directly into the prefilled (and still fully editable) description text, e.g.:

```
I have a question about this transaction:
- Reference: C2C-REF-7
- Amount: NGN 2,000.00
- Date: 1/5/2026

Details:
```

The customer never types or sees an internal UUID; the backend still independently re-derives ownership of any `relatedTransferId`/`fundingRequestId` from the authenticated session (not from the screen), exactly as it already did before this task — no new trust was placed in client input.

---

## 8. Part H — Cash-to-Cash (C2C) implications (resolved: no gap)

Confirmed there are **no customer-facing C2C self-service endpoints** anywhere in Customer Mobile or the customer-facing API surface — C2C claim/creation remains agent-mediated exactly as in prior V1 work, with exact beneficiary-phone/hashed-code/OTP verification, configurable expiry, and unclaimed-account fallback **completely untouched**. The only C2C-adjacent change in this task is cosmetic: the `CASH_TO_CASH` category's support-ticket prefill embeds the existing reference/amount/date as plain text (§7) — this is pure communication, with **zero reachable path** to cancellation, auto-refund, "claim all," or any other C2C financial-semantics change. Documented as a confirmed no-gap, not implemented as a new feature.

---

## 9. Part I — Ticket lifecycle correctness

Confirmed, unchanged: the state machine (`OPEN → IN_PROGRESS → RESOLVED → CLOSED`) is strictly forward-only (`support.service.ts`'s internal status-transition validation; pre-existing test `11`, "invalid status transition rejected"). Neither customers nor agents can close or reopen a ticket; only workforce can transition status (pre-existing tests `9`, `10`, `27`). Nothing was invented — the new `SupportTicketDetailScreen` purely *reflects* server-decided `status`, disabling its own reply form once the ticket is `RESOLVED`/`CLOSED`, with no client-side override.

---

## 10. Part J — Idempotency/concurrency (create ✅ already correct; reply — fixed)

### 10.1 Create — confirmed already correct, not touched

`createTicket()` already reserves/completes against `IdempotencyService` with a `requestHash` over the ticket payload + principal, inside the transaction. Pre-existing test `22` re-run green, unmodified.

### 10.2 Reply — the actual fix

`addMessage()` had zero idempotency handling. Fixed by reusing the exact same `IdempotencyService.reserve()`/`.complete()` pattern already proven in `createTicket()` — no new idempotency framework introduced:

- `support-customer.controller.ts`: reads the `Idempotency-Key` (case-insensitive) header and passes it through to the service.
- `support.service.ts::addMessage()`: computes a `requestHash` over `{ ticketId, body, isInternal, authorType, authorId }`, scoped per-ticket-and-author (`support.ticket.message.create:${ticketId}:${authorType}:${authorId}`), reserves inside the same DB transaction used for ownership/lifecycle checks:
  - Same key + same body → **replay**, returns the original message, no new row.
  - Same key + different body → **`409 Conflict`** (never silently swallowed as a different message).
  - No key supplied at all → **no dedup**, genuinely separate replies are always created (back-compatible with any caller that doesn't send a key).

New integration test `22b` in `test/v1-007-support-ticket.integration.spec.ts` proves all three behaviors over real HTTP + real Postgres. Customer Mobile's `SupportTicketDetailScreen` generates a fresh key per reply attempt (`support-reply-${ticketId}-${timestamp}-${random}`) and only regenerates it **after a successful send** — so a client-side double-tap or an in-flight network retry of the *same* attempt is protected, but a deliberate second message is not accidentally deduplicated. Verified by Customer Mobile test "the reply idempotency key is regenerated after a successful send (two sends use two different keys)".

---

## 11. Part K — Security/privacy audit

Confirmed, unchanged: no OTP/PIN/password-hash/internal-staff-identity/fraud-risk-score/other-customer-data field is ever projected on any customer-facing support route (pre-existing test `21`, "no PIN/password/OTP leakage"; pre-existing test `16`, "internal-only messages not leaked to customer/agent"). `SupportTicketDetailScreen` and `CreateSupportTicketScreen` only ever render fields already present on the customer-safe DTOs (`reference`, `subject`, `category`, `description`, `status`, `priority`, `createdAt`, message `authorType`/`body`). Internal list filter params on `/internal/support/tickets` were reviewed; no new filter was added, and none leaks beyond what workforce principals are already authorized to see.

---

## 12. Part L — Mobile UX changes (exactly what was genuinely required)

- New `SupportTicketDetailScreen.tsx`: header card (reference, status, category, priority), description card, message thread (`FlatList`, customer vs. support-agent bubble styling, pull-to-refresh), and a reply box that is replaced by an honest "this ticket is resolved/closed" message once the ticket leaves `OPEN`/`IN_PROGRESS` — reusing `Card`, `Button`, `Input`, `LoadingState`, `ErrorState` (existing design-system components only; no new component library, no chatbot, no AI, no push notifications).
- `SupportScreen.tsx` ticket rows are now `TouchableOpacity`-wrapped and navigate to the new detail screen.
- `CreateSupportTicketScreen.tsx` now accepts optional navigation params (`category`, `subject`, `description`, `relatedTransferId`, `fundingRequestId`) to prefill — while remaining fully editable — and shows a small context banner when a transaction link is present. An unrecognized/invalid prefilled category safely falls back to `OTHER` rather than inventing a new one.
- `TransactionPinScreen.tsx`'s locked-state "Contact Support" button now prefills `category: 'PIN'` plus a subject/description.
- `TransactionsScreen.tsx` rows gained a small "Get help" text affordance (via a new optional `onGetHelp` prop on `TransactionRow`) that routes to a prefilled ticket per §7.

No redesign of existing screens' visual language, no new navigation pattern beyond one additional stack screen, no SLA promise added anywhere.

---

## 13. Part M — Testing: added/changed, exact counts

### Backend

| Suite | Before | After | Delta |
|---|---|---|---|
| `test/v1-007-support-ticket.integration.spec.ts` | 28 tests | **29 tests** (added `22b`) | +1 |
| `test/v1-customer-09-support-workforce-boundary.integration.spec.ts` | — | **36 tests** (new) | +36 |
| `test/workforce-session-principal-type.spec.ts` | — | **4 tests** (new) | +4 |

Both new backend test files were re-run green this session: `v1-007-support-ticket.integration.spec.ts` → 29/29; `v1-customer-09-support-workforce-boundary.integration.spec.ts` → 36/36 (all over real HTTP + real Postgres).

Backend coverage added this task specifically satisfies: create/retrieve-own (pre-existing, re-confirmed), no-cross-access (pre-existing, re-confirmed), reply-to-own + duplicate-submission-safety for replies (**new**, `22b`), staff-access + unauthorized-role-rejection + status-transition-authorization as a genuine real-HTTP boundary (**new**, 36 tests), transaction-link isolation (pre-existing test `17`, re-confirmed).

### Customer Mobile

| Suite | Before | After | Delta |
|---|---|---|---|
| `__tests__/support.test.tsx` | — | **17 tests** (new) | +17 |
| `__tests__/transactions.test.tsx` | 4 tests | **7 tests** | +3 |
| `__tests__/transaction-view.test.ts` | existing | **+3 tests** (`buildSupportContextForTransaction`) | +3 |
| `__tests__/transaction-pin.test.tsx` | 7 tests | 7 tests (1 assertion updated, no new test) | 0 |

`support.test.tsx` covers: ticket-list render + tap-to-detail navigation, empty state, "New Ticket" navigation with no params; ticket-detail load/render (header/description/messages), successful reply with `Idempotency-Key`, idempotency-key regeneration across two sends, client-side empty-reply rejection, `RESOLVED`/`CLOSED` reply-form suppression, server-error-on-reply handling, 404/load-failure error state with retry; create-ticket default/no-prefill, locked-PIN-style prefill + submit, unknown-category fallback to `OTHER`, `relatedTransferId` inclusion + context banner, `fundingRequestId` inclusion, duplicate-submit prevention while in flight.

### Full Customer Mobile regression

```
Test Suites: 12 passed, 12 total
Tests:       92 passed, 92 total
```
(Baseline before this task: 11 suites / 69 tests, per prior session memory — all 11 original suites still pass unmodified in behavior, net +1 suite / +23 tests.)

`npx tsc --noEmit` in `apps/customer-mobile` → clean, exit code 0.

---

## 14. Final API contract (customer-facing support surface, confirmed as-is + the one addition)

No new routes were added. The final, confirmed customer-facing contract is:

- `GET /customers/me/support/tickets?page&limit` — list own tickets (pre-existing)
- `POST /customers/me/support/tickets` — create a ticket; optional `relatedTransferId`/`fundingRequestId`; supports `Idempotency-Key` (pre-existing, confirmed correct)
- `GET /customers/me/support/tickets/:id` — fetch own ticket (pre-existing; Customer Mobile now actually calls this)
- `GET /customers/me/support/tickets/:id/messages` — fetch own ticket's customer-visible messages (pre-existing; Customer Mobile now actually calls this)
- `POST /customers/me/support/tickets/:id/messages` — reply to own ticket; rejected once `RESOLVED`/`CLOSED`; **now supports `Idempotency-Key`** (the one backend behavior change this task made)

Internal/workforce contract (`/internal/support/*`) is unchanged; its actual enforced boundary (not just its decorator) is now covered by 36 real-HTTP tests (§3).

---

## 15. Regression results (full repository)

**Backend unit suite** (`npx jest --config jest.config.js`):
```
Test Suites: 172 passed, 172 total
Tests:       1801 passed, 1801 total
```

**Backend integration/PG suite** (`npx jest --config jest.integration.config.js --runInBand`, run earlier this session against the full tree including this task's changes):
```
Test Suites: 78 passed, 3 failed, 81 total
Tests:       1624 passed, 4 failed, 1628 total
```

The 3 failing suites / 4 failing tests (`v1-hardening-06-admin-customer-investigation.integration.spec.ts`, `v1-workforce-bootstrap-01.integration.spec.ts`, `migration-chain.integration.spec.ts`) are **pre-existing and unrelated to this task**. This was independently verified by `git stash`-ing every change made in this session and re-running: the exact same 81-migrations-on-disk-vs-80-hardcoded-expectation mismatch and missing `docs/config/v1-workforce-bootstrap.env.template` file reproduce identically with none of this session's work applied. This session touched zero migration files and zero workforce-bootstrap files. Both new backend support test files added this session (`v1-customer-09-support-workforce-boundary.integration.spec.ts`, `workforce-session-principal-type.spec.ts`) and the extended `v1-007-support-ticket.integration.spec.ts` were separately re-confirmed 100% green (36/36, 4/4, 29/29) after the stash/pop round-trip.

**Customer Mobile suite**: 12/12 suites, 92/92 tests, `tsc --noEmit` clean.

---

## 16. Remaining V1 gaps / recommended next task

1. **(Recommended next task, Part C)** There is no real way to issue a dedicated, least-privilege `SUPPORT`-type workforce session today; real support staff must use a broader `OPERATOR` (or `FINANCE_ADMIN`-flagged `PRIVILEGED`) session to reach `/internal/support/*`. The route-policy and controller guard already correctly handle a `SUPPORT` principal if one is ever issued (proven by this session's 36-test boundary suite), so implementing this is additive (a new session-issuance path), not a redesign of the existing authorization model. Recommend a dedicated task to design and implement a genuine least-privilege `SUPPORT` workforce role.
2. The 3 pre-existing failing integration suites (migration-count off-by-one at 81-vs-80-hardcoded; missing `docs/config/v1-workforce-bootstrap.env.template`) are real, pre-dating this task, and should be triaged and fixed in a dedicated hardening/housekeeping task — they are unrelated to support/account-resolution and were correctly left untouched here.
3. No in-app SLA/response-time promise exists for support tickets (by design, per Part O) — if the business wants one in future, that is a product-policy decision outside this task's scope, not a code gap.

---

## 17. Commit

`feat(customer): complete support and account resolution` — contains the backend reply-idempotency fix, its new/extended tests, and the full Customer Mobile ticket-detail/reply/prefill/transaction-linking implementation described above.

---

## Verdict

**A. CUSTOMER SUPPORT AND ACCOUNT RESOLUTION COMPLETE**
