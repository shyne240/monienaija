# V1-CUSTOMER-03 — Customer Mobile V1 Gap Audit and Prioritization

**Type:** Audit and prioritization only. No feature implementation was performed in this task, per explicit instruction. The only non-documentation artifacts created (a local `.env` and an embedded-PostgreSQL data directory under `data/`) are git-ignored, were used solely to gather evidence, and are not part of this commit.

---

## 1. Repository Baseline

- Branch: `arena/01a10374-monienaija`
- HEAD at audit time: `37d313dac63906880235cfa56e73e223e1c759e6` (previous documentation commit, unchanged by this audit until the doc below is added)
- `git status --short` before this audit's doc commit: clean (0 lines)
- **Session note:** this task's session began from a fresh clone whose local branch ref initially landed on the pre-task baseline `3d05aae` (symptom: large apparent diff). Verified via `git fetch` that `origin/arena/01a10374-monienaija` was correctly at `37d313d`; corrected the local ref with a metadata-only `git reset 37d313d` (no working-tree files touched) and restored upstream tracking. This is the same class of session-boundary artifact documented in the prior V1-CUSTOMER-02 forensic report and is not a code change.
- Authoritative prior report consulted: `docs/V1/V1-CUSTOMER-02-WALLET-TO-WALLET-AUTHORIZATION-COMPLETION-01.md`. Per instruction, V1-CUSTOMER-02 through 08 historical reports were **not** assumed to exist beyond this one file; all findings below come from fresh inspection of the current repository.
- **New capability discovered this session:** the repository ships `embedded-postgres` (devDependency) and `scripts/embedded-pg.js`, which successfully starts a real local PostgreSQL 18.4 instance (verified this session). This directly changes the status of the 77 `*.integration.spec.ts` files from "cannot run" (as reported in V1-CUSTOMER-02) to "can run, and were run, in this session" (Section 8).

## 2. Customer Mobile Inventory (fresh `find`/`grep`, this session)

Screens present: `SplashScreen`, `WelcomeScreen`, `LoginScreen`, `RegistrationScreen` (unauthenticated); `HomeScreen`, `SendMoneyScreen`, `TransactionsScreen`, `ProfileScreen`, `TransactionPinScreen`, `SupportScreen`, `CreateSupportTicketScreen` (authenticated).
Services: `api-client.ts`, `secure-storage.ts`, `transfer-view.ts`.
No screens exist for: notifications/inbox, transaction detail, limits, cash-to-wallet, cash-to-cash, PIN change/reset (distinct from initial set).
Backend endpoints actually called by Customer Mobile (grepped from source, not assumed):
`POST /customers`, `POST /customers/sessions`, `POST /customers/sessions/logout`, `GET /customers/me`, `GET /customers/me/profile`, `GET /customers/me/wallets`, `GET /customers/me/transfers` (list + paged), `POST /customers/me/transfers`, `POST /customers/me/transaction-pin`, `POST /customers/me/support/tickets`, `GET /customers/me/support/tickets`.

## 3. PIN Audit

Source: `src/customer-app/customer-app.controller.ts` (`POST customers/me/transaction-pin`, `POST customers/me/transaction-pin/verify`), `src/customer/customer-transaction-pin.service.ts`, `apps/customer-mobile/src/screens/authenticated/TransactionPinScreen.tsx`.

| Capability | Status | Evidence |
|---|---|---|
| Create | COMPLETE | `POST customers/me/transaction-pin`: PBKDF2 (10,000 iterations, 16-byte salt), format `PBKDF2$sha256$<iter>$<salt>$<hash>` |
| Verify | COMPLETE | `POST customers/me/transaction-pin/verify` and inline verify inside `POST customers/me/transfers`; `timingSafeEqual` compare |
| Failed-attempt handling | COMPLETE | `failedCount` incremented per bad verify (`customer-transaction-pin.service.ts`) |
| Lockout | COMPLETE | `MAX_FAILED_PINS = 5`; at/above threshold, `verifyTransactionPin` returns `locked: true` / `PIN_LOCKED`, enforced before any transfer executes (confirmed live in `test/a24-customer-transaction-pin-hardening.integration.spec.ts` tests 4–5, which this session **re-ran against a real PostgreSQL instance and passed**) |
| Unlock (distinct from re-set) | MISSING | No endpoint or service method named/behaving as "unlock" exists. The only path back from a locked state is calling `set` again, which resets `failedCount` to 0 as a side effect of overwriting the hash. |
| Change (customer knows current PIN) | MISSING as a distinct, re-authenticated operation | `set` has no "confirm old PIN first" step — it is pure overwrite, gated only by the existing session (JWT). There is no `PATCH`/dedicated change endpoint that requires the current PIN before accepting a new one. |
| Reset (forgotten PIN) | MISSING as a distinct flow | No separate "forgot PIN" flow exists (no OTP-to-reset-PIN binding). The generic `set` endpoint is the only mechanism, and it does not ask for the old PIN or for any additional out-of-band proof beyond the already-active session. |
| "Set again" ≡ "reset"? | Functionally yes, security-wise this is a gap | Calling `set` again is operationally indistinguishable from a reset (overwrites hash, zeroes `failedCount`) — **but it requires no proof of knowledge of the old PIN and no step-up authentication**, meaning anyone who has a valid, already-authenticated session (e.g., via a stolen/hijacked session token) can silently replace the customer's Transaction PIN with no original-PIN confirmation and no OTP/step-up challenge. |
| Authentication requirement for `set` | Session (JWT) only | `requireCustomerPrincipal(req)` — no re-entry of password, no OTP, no current-PIN confirmation |
| **Could any operation permit unauthorized PIN replacement?** | **Yes — this is the most important PIN finding** | Given only a valid customer session (no re-auth, no current-PIN, no OTP), `POST customers/me/transaction-pin` silently replaces the Transaction PIN. Since the Transaction PIN is the sole authorization factor gating Wallet→Wallet transfers (Section 4 of the prior report), an attacker who compromises a session token (e.g., XSS-equivalent on a future web client, or a leaked/overlong-lived mobile session) could: (1) call `set` with a PIN of their choosing, (2) then immediately execute transfers using that PIN, with the legitimate customer having had no PIN, no password, and no OTP challenge along the way. **This is a genuine security gap**, not a hypothetical one — it follows directly from reading the actual guard clauses in the `set` handler. |
| Backend tests | PARTIAL | Create/verify/lockout/ownership/binding/idempotency are covered by `test/a24-customer-transaction-pin-hardening.integration.spec.ts` (19/19 passed, reproduced this session against real PostgreSQL). **No test exists** that exercises "re-set PIN while already-set, without old-PIN confirmation" as a security scenario — the current suite tests the happy-path create/verify/lockout, not the replacement-without-reauth risk identified above. |
| `TransactionPinScreen` dedicated test | MISSING | `grep -rl "TransactionPinScreen" apps/customer-mobile/__tests__/` → no matches. The screen is exercised only indirectly via `transfer.test.tsx` (which tests the PIN field on `SendMoneyScreen`, a different screen). |

**Recommended governing security rule (not implemented — stated per instruction):** PIN replacement should require step-up proof beyond the ambient session: either (a) the current PIN (if one is already set and not locked) **or** (b) an OTP/password re-entry challenge equivalent to login, before the `set` handler is permitted to overwrite an existing PIN. A first-time `set` (no PIN currently on file) can reasonably remain session-gated only, since there is nothing yet to protect. A locked-PIN "reset" should require the stronger of the two (OTP/password), never a bare re-set, precisely because the customer cannot prove the old PIN in that state.

## 4. Support Audit

Source: `src/support/support.service.ts`, `src/support/support-customer.controller.ts`, `src/support/support.enums.ts`, `apps/customer-mobile/src/screens/authenticated/{SupportScreen,CreateSupportTicketScreen}.tsx`.

| Item | Status | Evidence |
|---|---|---|
| Create ticket | COMPLETE | `POST customers/me/support/tickets`, bound to `principal.customerId`, cannot target another customer (`ForbiddenException` if `targetCustomerId`/`targetAgentId` supplied by a CUSTOMER principal) |
| Category | COMPLETE (subset exposed) | Backend enum has 13 values (`FUNDING, TRANSFER, WALLET, CASH_IN, CASH_OUT, CASH_TO_CASH, PROFILE, PIN, AUTHENTICATION, AGENT_FUNDING, OUTLET, TERMINAL, OTHER`); mobile exposes 10 customer-relevant ones (omits the 3 agent-only categories `AGENT_FUNDING`/`OUTLET`/`TERMINAL` — a sensible, not a missing, scoping decision) |
| Priority | PARTIAL | Backend accepts an optional `priority` field (`LOW/MEDIUM/HIGH/CRITICAL`); mobile's `CreateSupportTicketScreen` does not expose a priority selector at all and never sends the field (defaults applied server-side) |
| Description | COMPLETE | Free-text, min-length validated client-side (≥3 chars) and presumably server-side too |
| Ticket listing | COMPLETE | `GET customers/me/support/tickets`, strictly `WHERE customer_id=$1` (no leakage possible by construction) |
| Ticket detail | MISSING on mobile | Backend has `GET customers/me/support/tickets/:id` (ownership-checked, 404 on mismatch), but `SupportScreen.tsx` has no tap-to-detail navigation and no screen consumes this endpoint |
| Message/reply | MISSING on mobile | Backend has `POST .../tickets/:id/messages` and `GET .../tickets/:id/messages`; no mobile screen or API call uses either |
| Status | Visible in list only | `SupportTicketStatus` (`OPEN/IN_PROGRESS/RESOLVED/CLOSED`) returned in the list payload; whether the mobile list UI actually renders it was not independently re-verified pixel-by-pixel this session but the field is present in the API response |
| Ownership isolation | COMPLETE | `listForCustomer`/`getForCustomer` both filter/verify by `customer_id`, generic 404 on mismatch (no existence leak) |
| Backend authorization | COMPLETE | `requireCustomer(req)` enforces `principal.type === 'CUSTOMER'` with a bound `customerId` on every route in `SupportCustomerController` |
| Mobile API integration | PARTIAL | Create + list wired; detail + messages not wired (see above) |
| Error handling | COMPLETE for the two wired calls | `CreateSupportTicketScreen` maps `ApiError` to a user message; `SupportScreen` shows a loading state |
| Idempotency | MISSING on mobile client | Backend supports an optional `Idempotency-Key` header on ticket creation (`SupportCustomerController.create`), but `CreateSupportTicketScreen.tsx` never sends one — a double-tap or client retry after a timeout could create a duplicate ticket. This is a lower-severity gap than the financial-transfer idempotency requirement (support tickets carry no money), but it is real. |
| Tests | Missing, specifically | No backend test file dedicated to `support-customer.controller.ts` was found by name; no customer-mobile `__tests__` file exists for `SupportScreen.tsx` or `CreateSupportTicketScreen.tsx` (confirmed: these are not among the 9 passing Customer Mobile suites). `test/v1-007-support-ticket.integration.spec.ts` exists and covers the backend support-ticket lifecycle generally (ran and passed this session as part of the 73/77 passing integration suites), but it is not customer-mobile-specific and does not exercise the two unwired endpoints from a customer-app perspective. |

**Minimum V1 support scope (recommendation, not implemented):** create + list + read-only detail view is the smallest complete "V1 support" experience; message/reply can reasonably be deferred to a later iteration without being a V1 blocker, since a customer can still raise and track a ticket. No SLA claim and no financial-control action should ever be reachable from support (confirmed true today — the ticket flow touches no wallet/transfer/PIN mutation path).

## 5. Limits Audit

Source: `src/limit-catalog/*`, `src/limit/limit.controller.ts`.

- **Entities/services that exist:** `LimitProfile`, `LimitRule` (11 dimensions: `MIN_AMOUNT_PER_TX, MAX_AMOUNT_PER_TX, DAILY_AMOUNT, WEEKLY_AMOUNT, MONTHLY_AMOUNT, YEARLY_AMOUNT, DAILY_COUNT, WEEKLY_COUNT, MONTHLY_COUNT, YEARLY_COUNT, WALLET_BALANCE_MAX`), `LimitAssignment` (binds a profile to a subject: `GLOBAL/CUSTOMER/AGENT/AGENT_CLASS/SEGMENT`, with precedence + effective dates), `LimitUsage` (tracks consumption per window), `LimitReservation` (reserve/commit/release lifecycle), `LimitProfileResolverService` (resolves the single winning assignment by precedence), `LimitUsageService` (reserve/commit/release/getUsage, all inside `SERIALIZABLE` transactions), `LimitEnforcementService`, `LimitDiagnosticsService`.
- **Endpoints that exist today:** `POST limits/evaluate` (generic, not customer-scoped); three `@Controller('internal')` controllers (`limit-catalog`, `limit-assignment`, `limit-operations`) — all workforce/ops-only, not customer-reachable.
- **Dimensions:** per-transaction min/max, daily/weekly/monthly/yearly amount and count, and max wallet balance — a configurable internal risk/product-limit system.
- **Customer identity → limit profile mapping:** `LimitProfileResolverService.resolve({ principalType: 'CUSTOMER', principalId, segmentCodes, now })` — SQL-driven precedence resolution (`GLOBAL` < `SEGMENT`/`AGENT_CLASS` < specific `CUSTOMER`/`AGENT`, tie-broken by precedence then effective date then creation date). Confirmed via direct code reading, not assumption.
- **Internal risk/product limits, not CBN tiers:** confirmed by the resolver's own code comment — "Never hardcodes tier/KYC" — and by the absence of any `CBN`/`tier` string anywhere in `src/limit-catalog/` or `src/limit/`. No CBN-tier claim is made anywhere in this report.
- **Enforcement on transactions:** `TransferService` imports and calls `LimitEnforcementService` (`src/transfer/transfer.service.ts` line ~25/92/347) inside the same `SERIALIZABLE` transaction as the ledger post, before completion.
- **Exact `LIMIT_*` codes emitted** (from `src/limit-catalog/limit-error.codes.ts`): `LIMIT_MIN_AMOUNT_NOT_MET`, `LIMIT_MAX_AMOUNT_EXCEEDED`, `LIMIT_DAILY_AMOUNT_EXCEEDED`, `LIMIT_WEEKLY_AMOUNT_EXCEEDED`, `LIMIT_MONTHLY_AMOUNT_EXCEEDED`, `LIMIT_YEARLY_AMOUNT_EXCEEDED`, `LIMIT_DAILY_COUNT_EXCEEDED`, `LIMIT_WEEKLY_COUNT_EXCEEDED`, `LIMIT_MONTHLY_COUNT_EXCEEDED`, `LIMIT_YEARLY_COUNT_EXCEEDED`, `LIMIT_WALLET_BALANCE_EXCEEDED`, plus configuration-error codes `LIMIT_PROFILE_MISSING`, `LIMIT_RULE_INVALID`, `LIMIT_CONFIGURATION_INVALID`, `LIMIT_RESERVATION_FAILED`.
- **Is a Customer Mobile endpoint genuinely missing?** Yes — there is no `GET customers/me/limits` or equivalent anywhere in the codebase (confirmed by exhaustive grep of all controllers for `customers/me` + `limit`).
- **Can `GET customers/me/limits` safely expose existing information without a second source of truth?** Yes. The correct minimal design is a thin, read-only composition: (1) call the existing `LimitProfileResolverService.resolve()` for the authenticated customer, (2) read the resolved profile's `LimitRule` rows, (3) read current `LimitUsage` rows via the existing `LimitUsageService` query path for that `principalType=CUSTOMER, principalId`, (4) return a customer-facing projection (`{ dimension, limitAmount, usedAmount, remainingAmount, windowResetsAt }`). This reuses every existing calculation and storage path — it adds a new **read-only endpoint**, not a new calculation engine, so it does not create a second source of truth. The only genuinely new code would be the thin controller/view-mapping layer.
- **Mobile display:** MISSING (no screen).
- **Limit-error UX:** PARTIAL/exists reactively — `apps/customer-mobile/src/services/transfer-view.ts` is not actually where this lives; it was found in the SendMoneyScreen's error-mapping path (any `err.code` starting with `LIMIT_` is mapped to "This transfer exceeds an account transaction limit. Try a smaller amount or contact support."). This means the customer only learns about a limit after attempting and failing a transfer, never proactively.

**Smallest correct V1 "My Limits" implementation (recommendation, not implemented):** one new thin backend endpoint (`GET customers/me/limits`) composing the three existing services above, plus one new read-only mobile screen rendering the returned array. No new limit-calculation logic anywhere, no hardcoded tiers, no client-side math beyond formatting currency for display.

## 6. Transaction History / Detail Audit

This is the most significant functional finding of this audit.

- The backend has **two parallel customer transaction-history surfaces**:
  1. `GET customers/me/transfers` (+ `GET customers/me/transfers/:transferId`) — queries the `transfers` table **only**. Returns `transactionType: 'WALLET_TRANSFER'` exclusively. This is what **Customer Mobile's `HomeScreen.tsx` and `TransactionsScreen.tsx` actually call** (confirmed via source grep).
  2. `GET customers/me/transactions` (+ alias `GET customers/me/transactions/:transferId`, which simply forwards to the same `getTransferDetail` handler as above) — a genuinely **unified** read-model (`src/customer-app/customer-transaction-history.service.ts`, `listUnified()`) that queries, in one global-sorted/paginated result set: `transfers` (WALLET_TRANSFER), `customer_funding_requests` (FUNDING), `cash_to_cash_transfers` (CASH_TO_CASH, matched by `claimant_customer_id` OR beneficiary phone), and `ledger_journals`/`ledger_lines` filtered by `metadata->>'canonicalService' IN ('CASH_IN','CASH_OUT')` (agent-mediated Wallet↔Cash). This endpoint is fully implemented, supports a `type` filter, and is exercised by `test/hardening-04-customer-transaction-history.integration.spec.ts` and `test/a25-customer-history-hardening.integration.spec.ts` (both re-run this session against real PostgreSQL and **passed**).
- **Customer Mobile never calls the unified endpoint.** `grep -rn "customers/me/transactions" apps/customer-mobile/src` returns no matches. The app is wired exclusively to the WALLET_TRANSFER-only `/customers/me/transfers` surface.
- **Consequence:** a customer who receives an agent-mediated Cash→Wallet deposit, sends/receives via Cash→Cash, or submits a Funding request will see **none of these in the Customer Mobile transaction history or home-screen recent-activity list today**, even though the backend fully supports surfacing them. Only Wallet→Wallet transfers are visible.
- **Detail view:** Customer Mobile has no tap-to-detail screen at all (`TransactionRow` has no `onPress`), so even the backend's existing `GET customers/me/transfers/:transferId` is unused.
- **Status/amount/timestamps/references:** present and correctly mapped for the WALLET_TRANSFER-only data that is shown (`transfer-view.ts`'s `mapTransferToRow`).
- **Fees:** the WALLET_TRANSFER list always returns `feeMinor: '0'` (both in `listTransfers` and `getTransferDetail` in `customer-app.controller.ts`) — the unified history endpoint carries a real computed fee for some types but the narrower endpoint the app actually uses does not.
- **Ownership/privacy:** correct wherever checked — both endpoints scope strictly to the authenticated customer's own wallets/records, with generic 404s on cross-customer access attempts.
- **Classification:** Backend coverage for Wallet→Wallet, Wallet→Cash, Cash→Wallet, Cash→Cash, and Funding history is COMPLETE. **Customer Mobile's consumption of it is PARTIAL — Wallet→Wallet only; Cash→Wallet, Cash→Cash, and Funding visibility are MISSING from the app despite existing, tested backend support.** This directly updates/corrects the prior V1-CUSTOMER-02 report's Section 13 claim of "COMPLETE for list," which was evaluated only against the narrower endpoint the app happens to call and did not cross-check the existence of the broader unified endpoint.

## 7. Cash-Flow Responsibility Audit

- **Cash→Wallet (agent cash-in):** `POST agents/cash-in` requires `principal.type === 'AGENT'` (hard-coded guard in `agent-cash-in.controller.ts`). A customer can never call this endpoint, by design — the agent physically receives cash and credits the customer's wallet. **Classification: NO CUSTOMER INITIATION UI REQUIRED.** The customer's only legitimate app-side role is passive visibility (seeing the resulting wallet credit), which — per Section 6 above — currently does not surface in Customer Mobile because the app queries the WALLET_TRANSFER-only endpoint. This is a visibility gap, not a missing-initiation-UI gap.
- **Wallet→Cash Method 1 (agent cash-out):** `POST agents/cash-out` likewise requires `principal.type === 'AGENT'`; the customer's PIN and an OTP code are collected **at the agent's terminal** (via `agent-cash-out.service.ts`'s `customerPin`/`otp` inputs), not via a customer-mobile screen. **Classification: NO CUSTOMER INITIATION UI REQUIRED** for the transaction itself — the customer's role is supplying PIN/OTP verbally/on a shared device at the point of service, which is an intentional agent-mediated design, not an oversight. Visibility (seeing the resulting debit afterward) has the same gap as above.
- **Cash→Cash:** both `POST agents/cash-to-cash` (create) and `POST agents/cash-to-cash/claim` (claim) require `principal.type === 'AGENT'`. The `cash_to_cash_transfers` table does carry a `claimant_customer_id` column (so a customer can be identified as the ultimate beneficiary), but there is **no customer-initiated API path anywhere** — not even a "claim" action — the entire lifecycle is agent-to-agent, mediated by a code the customer presents at an agent location. **Classification: NO CUSTOMER INITIATION UI REQUIRED.** Same visibility caveat as above applies.
- **Summary distinction (per the task's framework):**
  - Agent-initiated action: Cash→Wallet, Wallet→Cash Method 1, Cash→Cash — all three, entirely.
  - Customer authorization/action: present only for Wallet→Cash Method 1 (PIN+OTP supplied at the point of service, not through the customer's own app session).
  - Customer notification/history visibility: **should exist, currently does not** (Section 6 finding) — this is the one legitimate customer-mobile gap in this area, and it is a visibility gap, not an "initiation UI" gap.
  - Customer Mobile transaction initiation: not applicable to any of the three flows; only Wallet→Wallet is customer-initiated.
- No new Customer Mobile screens are recommended for initiating any of these three flows. The one recommended fix is **visibility**: point `TransactionsScreen`/`HomeScreen` at the already-existing, already-tested unified `GET customers/me/transactions` endpoint instead of the WALLET_TRANSFER-only one.

## 8. PostgreSQL Integration-Test Inventory

**Major correction to the prior report:** the prior V1-CUSTOMER-02 report concluded the 77 `*.integration.spec.ts` files "cannot run in this sandbox" due to missing PostgreSQL. This session discovered and used the repository's own `embedded-postgres` devDependency + `scripts/embedded-pg.js` helper, which **successfully started a real local PostgreSQL 18.4 server** (confirmed via its own startup log: "database system is ready to accept connections"). Using that instance (env: `DB_HOST=localhost, DB_PORT=5432, DB_NAME=monienaija, DB_USER=monienaija, DB_PASSWORD=monienaija-pw, DB_SSL=false`, matching the credentials hardcoded in `scripts/embedded-pg.js`), this session ran the **entire** `npm run test:pg` suite (`jest --config jest.integration.config.js --runInBand`) to completion.

**Result (this session, fresh):**
```
Test Suites: 4 failed, 73 passed, 77 total
Tests:       5 failed, 1539 passed, 1544 total
```

**Coverage assessment (by file name/content, this session):**
- Customer PIN / Wallet→Wallet: YES — `a24-customer-transaction-pin-hardening` (19/19 passed, re-confirmed this session), `a23-customer-app` (passed), `s-fix-01-customer-lifecycle-authorization` (passed).
- Limits: YES — `v1-limit-01` through `v1-limit-05-*` (catalogue, assignment, usage, runtime, diagnostics, flow-matrix, recovery) — all passed.
- Support: YES — `v1-007-support-ticket` (passed); general support-ticket lifecycle only, not customer-mobile-specific.
- Agent flows: YES, extensively — `a7` through `a21` (authentication, lifecycle, receiving-number, service-capability, transaction-authorization, financial-execution, cash-in, cash-out, otp-hardening, cash-to-cash + claim + expiry, aggregator-foundation, funding, outlets/terminals, agent-app) — all passed.
- Ledger/accounting: YES — `transaction-boundary`, `a5-ledger-reversal`, `a5-transfer-lifecycle`, `a5-payment-lifecycle`, `b2f-finance-lifecycle`, `a5t11-b2f03-convergence` — all passed.
- Commercial fees/commission: YES — `v1-commercial-*` (product-catalogue, fee-rule-schema, fee-rule-resolver, decision snapshots 02/03a–03e, scenario-matrix), `v1-commission-*`, `v1-fee-runtime-wiring` — all passed.
- C2C (Cash-to-Cash): YES — `a15/a16/a17-agent-cash-to-cash*`, `v1-commercial-decision-03c-cash-to-cash-snapshot` — all passed.
- Authorization/idempotency/concurrency: YES — idempotency explicitly covered inside `a24` (tests 9–11), limit reservations (`v1-limit-05-recovery`), transfer SERIALIZABLE boundary (`transaction-boundary.integration.spec.ts`) — all passed.
- Current vs legacy: the suite is overwhelmingly current/V1-aligned by naming convention (`a*`, `v1-*`, `b2f-*`); no suite was found that is unambiguously testing pre-V1/obsolete functionality that no longer exists in the codebase.

**The 4 failing suites (5 failing tests), with root cause for each — none were deleted, weakened, or skipped to obtain this result:**

1. **`test/v1-hardening-06-admin-customer-investigation.integration.spec.ts`** (1 test) — asserts the latest migration timestamp is one of a hardcoded list ending at `1785753600078`. The repository now has migration `1785753600080` (`AddMfaChallengePurpose`), added after this test's expected-list was last updated. **Root cause: stale hardcoded migration-count assertion, not a functional defect.** Scope: admin/internal, not Customer Mobile.
2. **`test/migration-chain.integration.spec.ts`** (2 tests) — hardcodes `expectedMigrations = 80`; the actual, correct count is 81 (confirmed: `ls src/migrations/ | wc -l` → 81). Same root cause as #1 — the constant was not bumped when the 81st migration was added. **Root cause: stale hardcoded migration count, not a functional defect.** Scope: infrastructure-wide, not Customer Mobile-specific.
3. **`test/v1-workforce-bootstrap-01.integration.spec.ts`** (1 test) — `ENOENT` on `docs/config/v1-workforce-bootstrap.env.template`; the file actually lives at `docs/deployment/config/v1-workforce-bootstrap.env.template` (confirmed via `find`). **Root cause: stale file path left behind by a docs reorganization into `docs/deployment/`, not a functional defect.** Scope: workforce/admin bootstrap, not Customer Mobile.
4. **`test/v1-customer-onboarding-01.integration.spec.ts`** (1 test) — "failed-attempt lockout" test expects `attempt_count` to cap at 5 after 5 wrong codes; the real value returned is 6. **Root cause: a genuine, small off-by-one in the registration-OTP attempt counter** (it increments once past the point where lockout should have frozen it), though the test's own log shows the lockout itself still correctly refuses the 6th/subsequent attempt — the counter overshoots its cap, it does not fail to lock. Scope: customer **registration** OTP (phone verification), which is a different subsystem from the Wallet→Wallet Transaction PIN covered in Section 3; still customer-facing and worth fixing, but not a Wallet→Wallet/PIN authorization defect.

**None of the 4 failures touch Wallet→Wallet transfer authorization, Transaction PIN enforcement, Support, or Limits** — the suites covering those areas (A24, A23, v1-limit-*, v1-007-support-ticket) all passed in full.

**Exact environment configuration required (reusable, documented here since the task asked for it):**
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=monienaija
DB_USER=monienaija
DB_PASSWORD=monienaija-pw
DB_SSL=false
```
Start with `node scripts/embedded-pg.js` (keep running in the background), then run `npm run test:pg` (or `npx jest --config jest.integration.config.js --runInBand`) in a separate shell with the above variables exported. No Docker is required (`docker` is not installed in this sandbox, and was not needed). No application or test code was modified to achieve this — only an `.env` file (git-ignored) was created locally to supply the above variables, and it was removed from consideration for commit (verified git-ignored, confirmed absent from `git status`).

## 9. Agent Mobile Dependency Security Assessment (re-verified, not remediated)

- Re-ran `npm ci` (1077 packages) + `npm audit --json` in `apps/agent-mobile` this session. Result: **77 total — 1 critical, 59 high, 17 moderate, 0 low** — **identical** to the number reported in the prior V1-CUSTOMER-02 report. `git status --short apps/agent-mobile/` shows no diff, confirming `package.json`/`package-lock.json` are unchanged since that prior audit, so an identical result is the expected, correct outcome (not a stale reuse — it was independently re-executed this session).
- **Critical package:** `tar` (transitive). Dependency path confirmed via `npm ls tar`: `agent-mobile → expo@52.0.49 → @expo/cli@0.22.28 → {cacache, tar}`. `@expo/cli` is Expo's **command-line/build tooling** (used for `expo start`, prebuild, etc. on a developer's or CI machine) — it is not part of the compiled application binary that runs on an agent's physical device.
- **High-risk packages (representative):** `expo` (direct) and `react-native` (direct) are both flagged, but in both cases the actual vulnerable paths are exclusively through **dev/build/test tooling**: `expo`'s findings route through `@expo/cli`, `babel-preset-expo`, `expo-modules-autolinking`, `metro*`; `react-native`'s findings route through `@react-native/codegen`, `@react-native/community-cli-plugin`, `babel-jest`, `jest-environment-node` (confirmed via `npm audit --json`'s `via` field for each, read directly this session).
- **Direct vs transitive:** 8 direct packages flagged (`expo`, `react-native`, `jest`, `@types/jest`, `babel-preset-expo`, `jest-expo`, `@react-navigation/native`, `@react-navigation/native-stack`); the remaining 69 are transitive.
- **Runtime vs development exposure:** checked every pure-runtime dependency individually (`zustand`, `@tanstack/react-query`, `expo-secure-store`, `expo-status-bar`, `react-native-safe-area-context`, `react-native-screens`, `zod`) — **none are flagged**. All critical/high findings trace to the Metro/Jest/Babel/Expo-CLI build-and-test toolchain, which executes on the developer/CI machine, not inside the shipped app running on an agent's device.
- **Does the current Expo/RN version prevent safe remediation?** Yes, confirmed again this session: `npm audit`'s own `fixAvailable` field for `expo` points to `expo@44.0.6` (`isSemVerMajor: true` — a downgrade from the pinned `52.0.49`); for `react-native` it points to `0.87.1` (also `isSemVerMajor: true`). No in-range, non-breaking fix exists for either.
- **No remediation was performed this task**, per instruction. No broad upgrade was attempted.

**Classification: ACCEPTABLE V1 RISK WITH DOCUMENTED MITIGATION.** Rationale: the critical and high-severity findings are concentrated entirely in build-time/test-time tooling (Metro, Jest, Babel, Expo CLI) that does not ship inside the compiled mobile application; every pure runtime/business-logic dependency is clean; no non-breaking fix exists for any flagged package without a major, breaking Expo/React-Native downgrade that is out of scope for a security-patch task. This is not "RELEASE BLOCKER" because there is no evidence of exploitable runtime exposure on a deployed device, and it is more specific than a blanket "FOLLOW-UP SECURITY WORK" because a concrete mitigation argument (dev-tooling-only exposure) is already documented and verifiable. This classification should be revisited whenever the Expo SDK is next upgraded for feature reasons, at which point the dependency tree should be re-audited.

## 10. Unknown-Unknown Findings

Ordered roughly by severity; all are supported by direct source inspection performed this session.

1. **(Most severe) Customer Mobile registration calls the wrong backend endpoint.** `RegistrationScreen.tsx` calls `ApiClient.post('/customers', {...})` — the bare `POST /customers` route on `CustomerController` (`src/customer/customer.controller.ts`). Per `src/authorization/route-policy-registry.ts`, this exact path does **not** match any of the public-route or customer-self-service branches (it is not `/customers/me*`, and `/customers/registration` is a distinct, separately-registered path that **is** correctly in `PUBLIC_ROUTES`). It falls through to the registry's final default case: `resourceType: 'internal-route'`, `requiredScopes: ['internal:access']`, `allowedPrincipalTypes: ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']` — i.e., **workforce-only**. An unauthenticated mobile customer calling this endpoint should receive 401/403 in a correctly enforced environment. Separately, even if it were reachable, this endpoint does not collect a password, does not verify phone ownership via OTP, and does not provision a wallet — so a "successful" call would produce a customer record the owner could never subsequently log into (`auth-store.ts`'s login flow requires `identifier + password` against `/customers/sessions`). **The correct, fully-built, OTP-verified, wallet-provisioning, password-setting public registration flow already exists** (`POST customers/registration/otp` → `POST customers/registration/otp/verify` → `POST customers/registration`, implemented in `CustomerRegistrationController`/`CustomerRegistrationService`, covered by `test/v1-customer-onboarding-01/02.integration.spec.ts`, both of which passed this session except the one off-by-one noted in Section 8) — Customer Mobile simply is not wired to it.
2. **The bug above is actively masked by the passing test suite.** `apps/customer-mobile/__tests__/registration.test.tsx` mocks `ApiClient.post` entirely and asserts `expect(ApiClient.post).toHaveBeenCalledWith('/customers', {...})` — i.e., the test enshrines the incorrect endpoint as the expected behavior rather than catching the contract mismatch. This is a textbook case of "tests passing ≠ completion proof": Customer Mobile's registration suite is green while the feature it tests is very likely non-functional end-to-end against the real backend's authorization rules.
3. **PIN replacement without re-authentication** (detailed in Section 3) — a session-authenticated caller can silently overwrite an existing Transaction PIN with no old-PIN confirmation and no step-up challenge.
4. **Transaction history endpoint mismatch** (detailed in Section 6) — Customer Mobile shows only Wallet→Wallet transfers; Cash→Wallet/Cash→Cash/Funding activity is invisible in the app despite full, tested backend support via the unused unified endpoint.
5. **Backend endpoint with no mobile consumer:** `GET customers/me/notifications` (`src/notification/notification-inbox.controller.ts`) is fully implemented, ownership-scoped, and has no Customer Mobile screen or API call anywhere referencing it. Combined with finding #4, this means a customer currently has **no in-app way to learn about an agent-mediated deposit/withdrawal/cash-to-cash event** — not via history, and not via notifications.
6. **Customer-visible UI states that cannot actually occur:** `TransactionRow`'s `type` prop accepts `'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT'` and `status` accepts `'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'CANCELLED'`, but the only mapper that feeds it (`transfer-view.ts`'s `mapTransferToRow`) can only ever produce `'TRANSFER_IN' | 'TRANSFER_OUT'` and collapses `PROCESSING`/`PENDING_RECOVERY`/`UNKNOWN` backend statuses into a generic `'PENDING'`, while `'REVERSED'` is never produced at all. `DEPOSIT`/`WITHDRAWAL`/`REVERSED` are dead, unreachable UI states — leftover from the deleted `FundWalletScreen`/`WithdrawScreen` (removed in V1-CUSTOMER-02) and from a status taxonomy the mapper never fully wires up.
7. **Support ticket creation has no client-side idempotency protection** (detailed in Section 4) — unlike the financial transfer flow, `CreateSupportTicketScreen` never sends an `Idempotency-Key`, so retries/double-taps can create duplicate tickets (low severity — no money moves — but real).
8. **Support ticket detail/reply endpoints exist server-side with no mobile consumer** (Section 4) — `GET .../tickets/:id`, `POST/GET .../tickets/:id/messages` are implemented and ownership-checked but entirely unused by the app.
9. **No duplicated client-side limit calculation was found** — confirmed clean; the app does not attempt to compute or predict limits itself anywhere, it only maps server error codes after the fact (Section 5). This is a positive finding, included for completeness since the task asked to check for it.
10. **No sensitive data found in mobile logs/storage** — checked `secure-storage.ts` (session token + customerId only, no PIN/password ever stored) and grepped for `console.log`/`console.warn`/`console.error` mentioning pin/password/token/otp across `apps/customer-mobile/src` — zero matches. This is a positive finding.
11. **Stale/hardcoded test assertions in the integration suite** (Section 8, failures #1–#3) — two different hardcoded migration-count constants (80 vs the real 81) and one stale documentation file path left over from a `docs/` reorganization. These are maintenance debt, not functional defects, but they do mean the "migration chain" and "admin customer investigation" suites currently report false negatives that could mask a real future regression if left uncorrected.
12. **Minor off-by-one in registration-OTP attempt counter** (Section 8, failure #4) — the lockout itself still functions (confirmed by the test's own later assertions being reached only after the counter mismatch, and by the test's explicit scenario title "even the correct code is refused"), but the stored `attempt_count` overshoots the documented cap of 5 by one. Low severity, customer-facing (registration, not Wallet→Wallet PIN), worth a small fix.

## 11. Complete Customer V1 Gap Matrix

| Capability | Current State | Evidence | V1 Required? | Gap | Priority |
|---|---|---|---|---|---|
| Registration | Broken end-to-end against real backend authorization rules; calls workforce-only `POST /customers` instead of the existing public OTP flow; test suite mocks around the bug | `RegistrationScreen.tsx`, `route-policy-registry.ts`, `registration.test.tsx` | Yes | Wire to `POST customers/registration/otp` → `otp/verify` → `POST customers/registration`; add password + OTP fields to the screen; fix/rewrite the test to assert against the real flow | **P0** |
| Login | Functional | `auth-store.ts` → `POST customers/sessions`; passing test | Yes | None found | — |
| Authentication (session) | Functional | SecureStore-backed token, correct logout call | Yes | None found | — |
| Transaction PIN — create/verify/lockout | COMPLETE at source level, verified via real-PG integration tests (19/19 passed) | Section 3 | Yes | None for create/verify/lockout | — |
| Transaction PIN — unauthorized replacement risk | Security gap | Section 3 | Yes | Require step-up (old PIN or OTP/password) before overwriting an existing PIN | **P0** |
| Transaction PIN — change/unlock as distinct flows | MISSING | Section 3 | Yes (for a mature V1) | Build real change (old PIN required) and reset (OTP-gated) flows | **P1** |
| `TransactionPinScreen` test coverage | MISSING | Section 3 | Yes | Add dedicated screen test | **P2** |
| Wallet→Wallet | COMPLETE at source level; A24 suite 19/19 passed this session against real PostgreSQL | Section 3/8 | Yes | None found beyond the PIN-replacement issue above | — |
| Wallet→Cash Method 1 | COMPLETE (agent+backend); no customer-mobile role needed | Section 7 | Yes (as agent flow) | None for initiation; visibility gap shared with #below | — |
| Cash→Wallet | NO CUSTOMER INITIATION UI REQUIRED; visibility gap | Section 7 | Visibility: yes. Initiation UI: no. | Customer cannot see these in history/notifications today | **P1** |
| Cash→Cash | NO CUSTOMER INITIATION UI REQUIRED; visibility gap | Section 7 | Visibility: yes. Initiation UI: no. | Same visibility gap | **P1** |
| Transaction history (list) | PARTIAL — Wallet→Wallet only; unified multi-type endpoint exists, unused | Section 6 | Yes | Point mobile at `GET customers/me/transactions` instead of `/transfers` | **P0** (it is the direct cause of the Cash→Wallet/Cash→Cash visibility gaps above) |
| Transaction detail | MISSING on mobile (backend ready) | Section 6 | Yes | Add tap-to-detail screen calling the existing detail endpoint | **P1** |
| Limits | MISSING (no endpoint, no screen); reactive error-mapping only | Section 5 | Yes | Add thin `GET customers/me/limits` (compose existing services) + a display screen | **P1** |
| Support — create/list | COMPLETE | Section 4 | Yes | None | — |
| Support — detail/reply | MISSING on mobile (backend ready) | Section 4 | Yes for a complete V1 experience; can be deferred without blocking V1 | Add detail screen + message thread UI | **P2** |
| Support — priority selector | MISSING on mobile | Section 4 | No (defaults are acceptable) | Optional enhancement | **P3** |
| Support — client idempotency | MISSING | Section 4 | No (non-financial) | Add `Idempotency-Key` header on ticket creation | **P3** |
| Profile | Functional (view + detail) | `ProfileScreen.tsx` → `GET customers/me`, `GET customers/me/profile` | Yes | None found this session | — |
| Credential management (password) | Backend has `POST customers/me/password`; not independently re-verified against a mobile screen this session (no screen found calling it) | `customer-app.controller.ts:375` | Yes | Confirm whether a "change password" screen is actually needed/missing — **not conclusively audited this session, flagged as open** | **P2 (needs follow-up confirmation)** |
| Error handling | Good coverage on wired screens; LIMIT_*-aware | `transfer-view.ts`, `SendMoneyScreen.tsx` | Yes | None found on wired paths | — |
| Idempotency/recovery — transfers | COMPLETE | Section 3/8 (A24 tests 9–11) | Yes | None | — |
| Idempotency/recovery — support tickets | MISSING on client | Section 4/10 | No (non-financial) | Low-priority fix | **P3** |
| Notifications/SMS | Backend `GET customers/me/notifications` fully built, ownership-scoped; zero mobile consumer | Section 10 finding #5 | Yes, for the Cash→Wallet/Cash→Cash visibility gap specifically | Add a notifications screen, or fold into the history fix above | **P1** |

Priority legend used above (per task instruction): **P0** = financial/security correctness; **P1** = required V1 functionality; **P2** = important usability/operational completeness; **P3** = polish/follow-up.

## 12. Prioritized Implementation Order (recommendation only — not implemented this task)

1. **P0 — Fix Customer Mobile registration** to use the real, existing, OTP-verified `customers/registration` flow (collect password; call `otp` → `otp/verify` → `registration`); rewrite `registration.test.tsx` to assert against the corrected flow instead of the current broken one.
2. **P0 — Point `TransactionsScreen`/`HomeScreen` at `GET customers/me/transactions`** (the existing unified endpoint) instead of `GET customers/me/transfers`, so Cash→Wallet, Cash→Cash, and Funding activity become visible. This is a client-side wiring change against an endpoint that already exists and is already tested — no new backend work required.
3. **P0 — Require step-up authentication before PIN replacement** (old PIN if one exists, or OTP/password re-entry if locked/forgotten) — closes the unauthorized-PIN-replacement gap.
4. **P1 — Build `GET customers/me/limits`** (thin composition of existing services, Section 5) + a "My Limits" mobile screen.
5. **P1 — Add a Transaction Detail screen** on mobile consuming the existing `GET customers/me/transfers/:transferId` (or, once #2 lands, the unified detail path).
6. **P1 — Add a Notifications screen** on mobile consuming the existing `GET customers/me/notifications`, or fold equivalent visibility into the history screen from #2.
7. **P1 — Build real PIN change (old-PIN-required) and reset (OTP-gated) flows**, replacing the current "set-again-with-no-proof" behavior.
8. **P2 — Add a Support ticket detail/reply screen** consuming the existing backend endpoints.
9. **P2 — Add a dedicated `TransactionPinScreen` test.**
10. **P2 — Confirm whether a "change password" screen is needed** against the existing `POST customers/me/password` backend endpoint (open item from the gap matrix).
11. **P3 — Fix the two stale hardcoded migration-count test assertions** (`migration-chain.integration.spec.ts`, `v1-hardening-06-admin-customer-investigation.integration.spec.ts`) and the stale file path in `v1-workforce-bootstrap-01.integration.spec.ts`.
12. **P3 — Fix the registration-OTP attempt-counter off-by-one** and add support-ticket-creation idempotency header on the client.

## 13. Exact Next Recommended Implementation Task

Given the severity ranking above, the single highest-value, lowest-risk next implementation task is **fixing Customer Mobile registration to use the real backend OTP-verified flow** (gap-matrix item P0 #1) — it is the most severe functional defect found (new customers likely cannot genuinely self-register and log in today), it has a fully-built, already-tested backend counterpart requiring no backend changes, and it is scoped tightly enough to implement and verify in one focused task. This is stated as the recommendation only; per instruction it is **not** implemented in this task.

---

*Audit performed: 2026-10-04, against HEAD `37d313d` on branch `arena/01a10374-monienaija`. All test numbers and source citations in this document were reproduced or read directly during this session.*
