# V1-CUSTOMER-07 — Complete Unified Customer Transaction History

**Status:** COMPLETE
**Starting HEAD:** `cd5754c` ("docs(customer): add V1-CUSTOMER-06 OTP lockout security report")
**Final HEAD (this task's commit):** `e0a6ed8` ("feat(customer): complete unified transaction history")
**Branch:** `arena/01a10374-monienaija`

---

## 1. Objective (recap)

Customer Mobile must let a customer accurately see financial activity across all 4 V1 customer
flows: (1) Wallet→Wallet, (2) Wallet→Cash Method 1, (3) Cash→Wallet, (4) Cash→Cash — plus wallet
funding. The task required a full audit of the existing backend contract and existing Customer
Mobile implementation before any change, and forbade inventing a parallel transaction-history
architecture.

## 2. Backend audit findings (Part A)

The unified endpoint `GET /customers/me/transactions` **already existed** at HEAD `cd5754c`,
introduced in a prior, out-of-session commit `145df67` ("feat(hardening-04): unified Customer
Transaction History projection"). It was **not built or modified by this task**. The audit
confirmed it was already a complete, correct, single-source-of-truth implementation:

- **Source of truth** — `src/customer-app/customer-transaction-history.service.ts` →
  `CustomerTransactionHistoryService.listUnified()`. Reads directly from the authoritative tables:
  `transfers` (WALLET_TRANSFER), `customer_funding_requests` (FUNDING), `cash_to_cash_transfers`
  (CASH_TO_CASH), and `ledger_journals`/`ledger_lines` filtered by
  `metadata->>'canonicalService' IN ('CASH_IN','CASH_OUT')` (CASH_IN = Cash→Wallet, CASH_OUT =
  Wallet→Cash). No parallel ledger, no second transaction table.
- **Isolation** — customer id is taken only from the authenticated principal; a forged
  `?customerId=` query param is ignored (proven by integration test #4).
- **Direction/semantics** — WALLET_TRANSFER → SENT/RECEIVED/INTERNAL/UNKNOWN; FUNDING → CREDIT;
  CASH_TO_CASH → PENDING (UNCLAIMED) / RECEIVED (CLAIMED + claimant match) / EXPIRED / UNKNOWN;
  CASH_IN → CREDIT; CASH_OUT → DEBIT.
- **Pagination** — global cross-type sort (`created_at DESC, id DESC`) then sliced — not a
  per-table "page 1 concat" (proven by test #19).
- **Safe projection** — no PIN/OTP/journal id/ledger account id/teller identity; CASH_IN/CASH_OUT
  counterparty is only `{ type: 'AGENT' }` (proven by test #14).
- **Existing coverage** — `test/hardening-04-customer-transaction-history.integration.spec.ts`
  already had 25 cases covering auth, isolation, per-type filtering (incl. CASH_IN/CASH_OUT/
  CASH_TO_CASH), pagination, safe projection, per-type status preservation (including
  CASH_TO_CASH UNCLAIMED/CLAIMED/EXPIRED — test #22), counterparty enrichment, and a
  zero-mutation proof. Re-run against a fresh embedded PostgreSQL this session: **25/25 PASS**.

**Conclusion:** the backend LIST endpoint needed no change. No src/ backend file was modified.

### 2.1 Backend gap found, confirmed, and intentionally NOT fixed

`GET /customers/me/transactions/:id` (`getTransactionDetailAlias` in
`src/customer-app/customer-app.controller.ts`) is a thin alias over
`getTransferDetail → transferService.getTransfer(id)`, which **only** resolves rows in the
`transfers` table. Confirmed by direct test: fetching the id of a CASH_IN item returned by the
unified list through this route returns **404**, even though it is the customer's own,
legitimately-returned transaction. The same is true for FUNDING, CASH_TO_CASH, and CASH_OUT ids.

This was deliberately **not fixed**, per the task's explicit instruction not to add an endpoint
unless genuinely required, and to check whether the list payload is already sufficient first:

- Customer Mobile has **no transaction-detail screen at all**, before or after this change.
- The unified list item already carries everything a detail view would need: `type`, `status`,
  `amountMinor`, `currency`, `direction`, `createdAt`, `completedAt`, `reference`, `narration`,
  `feeMinor`, `counterparty`, `failureCode`, `failureMessage`.
- Fixing a backend route that no client calls would be scope creep against the "only fix concrete
  gaps found by audit" instruction.

This gap is now pinned down by a new, explicitly-labelled regression test (see §5) so it cannot
silently regress further or be mistaken for "already covered." It is listed as a remaining V1 gap
in §8 for any future work that needs server-confirmed detail fetches (e.g. a push-notification
deep link) for non-WALLET_TRANSFER items.

## 3. Customer Mobile audit findings (Part B) — the real, confirmed gap

Unlike the backend, **Customer Mobile was the actual gap**. At HEAD `cd5754c`:

- `TransactionsScreen.tsx` called `GET /customers/me/transfers?page=&limit=` — the
  **Wallet→Wallet-only** endpoint — not the unified `GET /customers/me/transactions`.
- `HomeScreen.tsx`'s "Recent Transactions" section made an **independent** call to the same
  Wallet→Wallet-only `/customers/me/transfers` endpoint.
- The shared view-model (`src/services/transfer-view.ts`) and `TransactionRow` component only
  understood two synthetic row types (`TRANSFER_IN`/`TRANSFER_OUT`), hard-derived from
  `direction === 'RECEIVED'` with everything else defaulting to "outgoing" — there was no concept
  of FUNDING, CASH_IN, CASH_OUT, or CASH_TO_CASH at all.
- There was no transaction-detail screen or navigation route in Customer Mobile at all (not a
  regression — it never existed).

This matches the task's warning precisely: the real failure was "still calling the W2W-only
endpoint," confirmed only after reading the actual code and actual response shapes — not assumed.

## 4. Fix implemented (smallest complete solution)

All changes are confined to `apps/customer-mobile` plus one backend **test** file (no backend
`src/` production code changed).

| File | Change |
|---|---|
| `apps/customer-mobile/src/services/transfer-view.ts` | Rewritten as the single unified view-model. New `mapTransactionToRow()` interprets all 5 backend types (`WALLET_TRANSFER`, `FUNDING`, `CASH_TO_CASH`, `CASH_IN`, `CASH_OUT`) and their real status vocabularies into a `TransactionRowView` with a 3-way `sign: 'IN'\|'OUT'\|'NEUTRAL'` and a `status: BadgeStatus`. `mapTransferToRow` kept as a backward-compatible alias. No financial computation — pure read-model mapping of values the backend already derived. |
| `apps/customer-mobile/src/components/TransactionRow.tsx` | Now takes an explicit `sign` and `status` prop instead of inferring direction from a 2-value `type` guess. `NEUTRAL` renders with no `+`/`-` prefix and a neutral color, so a not-yet-settled or terminal-unsuccessful transaction can never look like a completed credit or debit. |
| `apps/customer-mobile/src/components/StatusBadge.tsx` | Added `EXPIRED` to `BadgeStatus` (styled like `FAILED`/`CANCELLED`) for Cash→Cash transfers that expired unclaimed. |
| `apps/customer-mobile/src/screens/authenticated/TransactionsScreen.tsx` | Now calls `GET /customers/me/transactions?page=&limit=` (unified) instead of `GET /customers/me/transfers`. Loading/empty/error/refresh/pagination (page + `hasMore` from `items.length === limit`) behavior unchanged — reused as-is per the "don't build new pagination architecture" instruction. |
| `apps/customer-mobile/src/screens/authenticated/HomeScreen.tsx` | "Recent Transactions" now calls the same unified endpoint (`?page=1&limit=5`) instead of its own separate call to `/customers/me/transfers`, so Home and the full history screen never disagree about what counts as recent activity. |

No navigation changes, no new screens, no redesign. The existing design system (`Card`, `Button`,
`LoadingState`, `StatusBadge`, `theme`) was reused unchanged.

### 4.1 Before / after supported transaction types in Customer Mobile

| Flow | Before | After |
|---|---|---|
| Wallet → Wallet (sent) | ✅ shown | ✅ shown (label "Sent to {name}" when counterparty known) |
| Wallet → Wallet (received) | ✅ shown | ✅ shown (label "Received from {name}") |
| Wallet → Cash (CASH_OUT) | ❌ never appeared | ✅ shown as "Cash Withdrawal via Agent", debit |
| Cash → Wallet (CASH_IN) | ❌ never appeared | ✅ shown as "Cash Deposit via Agent", credit |
| Cash → Cash — pending/unclaimed | ❌ never appeared | ✅ shown as "Cash Transfer Awaiting Claim", neutral sign, PENDING badge |
| Cash → Cash — claimed/received | ❌ never appeared | ✅ shown as "Cash Transfer Received (Agent)", credit, SUCCESS badge |
| Cash → Cash — expired | ❌ never appeared | ✅ shown as "Cash Transfer Expired (Unclaimed)", neutral sign, EXPIRED badge (never SUCCESS) |
| Wallet funding | ❌ never appeared | ✅ shown as "Wallet Funding", credit only once APPROVED; PENDING/REJECTED render with a neutral (non-credited) sign |

### 4.2 Exact API contract now used by Customer Mobile

```
GET /api/v1/customers/me/transactions?page={n}&limit={n}&type={optional}
Authorization: Bearer <customer session token>

200 → {
  items: [{
    id: string,
    type: 'WALLET_TRANSFER' | 'FUNDING' | 'CASH_TO_CASH' | 'CASH_IN' | 'CASH_OUT',
    status: string,                 // per-type vocabulary, see §2
    amountMinor: string,
    currency: string,
    direction: string,              // SENT/RECEIVED/INTERNAL/UNKNOWN/CREDIT/DEBIT/PENDING/EXPIRED
    createdAt: string,
    completedAt: string | null,
    reference: string | null,
    narration: string | null,
    feeMinor: string,
    counterparty: { type?, displayName?, receivingNumber?, agentId?, beneficiaryPhone?, ... } | null,
    failureCode: string | null,
    failureMessage: string | null
  }],
  pagination: { page, limit, total, totalPages, hasNextPage }
}
```

This is the real, already-existing response shape — verified by reading
`UnifiedHistoryItem` in `customer-transaction-history.service.ts` and by the 26 integration tests
that exercise it, not guessed.

## 5. Tests added / changed — exact counts

**Backend** (`test/hardening-04-customer-transaction-history.integration.spec.ts`):
- Suite renamed from "25 cases" to "26 cases."
- **+1 new test**: `26. [KNOWN GAP — documented, not fixed] detail route only resolves
  WALLET_TRANSFER ids; CASH_IN/CASH_OUT/CASH_TO_CASH/FUNDING ids from the unified list 404 on
  GET /customers/me/transactions/:id`. Creates a real CASH_IN ledger journal, confirms the
  unified list returns it, then confirms the detail alias 404s on that same id — pinning down the
  §2.1 gap as a proven, regression-tracked fact rather than an unverified assumption.
- Result: **26/26 PASS** against a fresh embedded PostgreSQL instance.

**Customer Mobile:**
- **New file** `apps/customer-mobile/__tests__/transaction-view.test.ts` — **15 new unit tests**
  for `mapTransactionToRow()` covering: WALLET_TRANSFER SENT/RECEIVED/FAILED/CANCELLED/PENDING,
  CASH_IN, CASH_OUT, CASH_TO_CASH UNCLAIMED/CLAIMED/EXPIRED, FUNDING APPROVED/PENDING/REJECTED,
  and generic field passthrough (reference/currency/amount preserved exactly; explicit narration
  takes priority over the computed default label).
- `apps/customer-mobile/__tests__/transactions.test.tsx` — rewritten against
  `/customers/me/transactions`; **+2 new tests**: one rendering all 5 V1 flow types in one list
  with correct label/sign/status, one asserting the error banner renders without crashing on a
  failed fetch. (2 → 4 tests in this file.)
- `apps/customer-mobile/__tests__/home.test.tsx` — rewritten against `/customers/me/transactions`;
  **+1 new test**: a Cash→Wallet (CASH_IN) credit rendering with agent context on the dashboard.
  (3 → 4 tests in this file.)

**Full Customer Mobile suite after changes:** `11 suites, 65 tests — all PASS` (was 10 suites
before `transaction-view.test.ts` was added).

## 6. Financial semantics correctness (Part D)

- A transaction only renders with a `+`/`-` sign once money has actually moved for *this*
  customer. Still-pending, rejected, or expired items render with a neutral sign and a non-SUCCESS
  badge (`PENDING`/`FAILED`/`EXPIRED`) — so a failed or expired transaction can never look like a
  completed credit or debit. Proven in `transaction-view.test.ts` (e.g. "EXPIRED renders neutral
  sign + EXPIRED status, never SUCCESS"; "REJECTED funding renders neutral sign + FAILED status,
  never shown as a credit").
- Refresh re-fetches page 1 and replaces state wholesale (`reset=true`) — no incremental merge, so
  there is no duplicate-row risk across refreshes; this logic was already correct and unchanged.
- Customer isolation is unchanged and already proven server-side (list: test #3/#4; detail: `a23`
  test "Customer A cannot see Customer B history").
- No double-entry ledger behavior was touched; no customer-side balance override was added.

## 7. Full regression results

- **Backend unit suite** (`npx jest --runInBand`, no PostgreSQL required): **171 suites / 1797
  tests — ALL PASS.**
- **Backend targeted integration regression** (26 integration suites directly touching customer
  transactions, cash-in/out, cash-to-cash, funding, transfers, profile, onboarding, and commercial
  decision snapshots, run against a fresh embedded PostgreSQL):
  **487 / 489 tests PASS. 2 pre-existing failures, confirmed unrelated to this task:**
  1. `a24-customer-transaction-pin-hardening` — one test ("No PIN in audit") failed once on a
     randomly-generated UUID that happened to contain the substring `"3333"`, which the test
     treats as a PIN-leak false positive. Confirmed non-deterministic and pre-existing by
     re-running the same suite in isolation immediately after: **19/19 PASS**. Not caused by this
     task; no code in this task's diff touches PIN auditing.
  2. `v1-hardening-06-admin-customer-investigation` — one test asserts the latest migration
     timestamp is in a hardcoded list ending at `1785753600078`; the repository at HEAD `cd5754c`
     already has 81 migrations, the newest being `1785753600080-AddMfaChallengePurpose.ts`,
     committed in `dc6fbb1` ("feat(agent): expose MFA challenge for mobile flows") — an ancestor
     of `cd5754c`, i.e. already present before this task started. Confirmed via `git log` that no
     migration file is part of this task's diff.
- **Customer Mobile:** `npx tsc --noEmit` — clean, no errors. `npx jest` — **11 suites / 65 tests —
  ALL PASS.**
- Full 79-suite backend integration run was not executed in full (each suite boots a fresh Nest
  app + embedded PostgreSQL; a full run is a multi-hour operation) — the 26-suite targeted set
  above covers every customer-facing, cash, funding, transfer, and commercial-decision surface
  this task could plausibly affect, plus the full unrelated unit suite, which is a complete audit
  of non-DB logic.

## 8. Unresolved V1 gaps / recommended next task

1. **Detail-endpoint type coverage** (§2.1) — `GET /customers/me/transactions/:id` only resolves
   WALLET_TRANSFER ids. Not fixed in this task because no client needs it (Customer Mobile uses
   the list payload directly). Recommended only if/when a future feature needs a server round-trip
   for a specific transaction (e.g. a notification deep link) — out of this task's scope and
   explicitly not required by the stated objective.
2. **`GET /customers/me/dashboard`'s `recentTransactions` field** still calls the legacy
   Wallet→Wallet-only `listTransfers` internally. Customer Mobile's `HomeScreen` does **not** use
   this field (it calls `/customers/me/wallets` + `/customers/me/transactions` directly), so this
   is dead/unused code from the mobile client's perspective and was deliberately left untouched to
   avoid unrequested backend behavior changes. Worth a follow-up audit if any other consumer
   (admin tooling, future web client) depends on that dashboard field expecting unified data.
3. The `A2SecurityRateLimitService` serialization-retry issue documented in V1-CUSTOMER-06 remains
   unresolved and was out of scope here, per the task's explicit non-scope instruction.

## 9. Explicit non-scope confirmation

No changes were made to: bank transfers, NIBSS, external payouts, cards, airtime/data/electricity/
cable/betting, Wallet→Cash Method 2, aggregator/commission settlement, rewards, push
notifications, EAS, SMS infra, PIN recovery, dependency versions, or the rate-limiter.

---

## Final classification

A. CUSTOMER UNIFIED TRANSACTION HISTORY COMPLETE
