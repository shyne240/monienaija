# V1-INFRA-02 — CORS & Wallet Authority / Reconciliation Audit

**Scope:** A focused investigation of exactly two unresolved findings left open by
V1-INFRA-01: (1) the backend has no CORS configuration anywhere, and (2) the
`customer_financial_account_binding_integrity` reconciliation check flags an unpopulated
legacy `customer_wallets` / `customer_financial_account_bindings` model while V1 actually
runs on `wallet_accounts`. This is **not** a broad V1 security audit, and no new fixes
were invented beyond what the evidence required.

**Status tags used in this document:** `VERIFIED`, `SAFE/INTENTIONAL`, `FINDING`, `FIXED`,
`REQUIRES INFRASTRUCTURE`, `UNKNOWN`.

---

## 1. Starting HEAD

`5658bcfb735e62308ff2c22b74a201cac7f0aea5` — the same commit that closed V1-INFRA-01
(`docs(V1): add V1-INFRA-01 staging deployment audit`). No commits occurred between the
two tasks. Before any investigation began, local git state was found stale (HEAD stuck at
the branch-creation commit `3d05aaec1d5...`) due to a stale ref/index issue unrelated to
this task. This was recovered via the standard procedure — `git fetch`, `merge-base
--is-ancestor` ancestor confirmation, byte-identical content verification (1746/1746 files
matching origin, multiple files diffed byte-for-byte), `git stash push -u`, `git merge
--ff-only origin/arena/01a10374-monienaija`, and a final re-verification before dropping
the now-redundant stash. **Status: `VERIFIED`.**

## 2. Final HEAD

`5658bcfb735e62308ff2c22b74a201cac7f0aea5` (unchanged — no code changes were required by
this audit; see §14). This document itself is committed on top of that HEAD. **Status:
`VERIFIED`.**

## 3. CORS architecture

The backend is a NestJS application on Fastify (`src/main.ts`). Confirmed by direct
source inspection:

- No `app.enableCors()`, no `@fastify/cors` plugin, no manual `Access-Control-*` header
  logic anywhere in `src/`.
- No cookie plugin (`@fastify/cookie` or equivalent) is registered, and no
  `Set-Cookie`/cookie-based session exists anywhere in the backend. The only places the
  string `"cookie"` appears in `src/` are **log-redaction and sensitive-data-classification
  lists** (`src/app.module.ts` request/response log redaction paths, `src/common/
  sensitive-data-redaction.ts`, `src/partner/external-data-minimization.types.ts`) — i.e.
  defensive handling in case a header named `cookie` ever appeared, not actual cookie
  issuance or consumption.
- Every authenticated surface (customer app, agent app, admin-web, internal/workforce
  endpoints) uses a bearer token delivered in the JSON response body
  (`accessToken`/`tokenType`) and presented back via an explicit `Authorization: Bearer
  <token>` header. This was confirmed in `src/customer-app/customer-app.controller.ts`
  (`session.accessToken`) and in `apps/admin-web/src/services/api-client.ts` (manual
  `headers['Authorization'] = \`Bearer ${token}\`` read from `localStorage`).
- `package.json` has no `cors`, `csurf`, `express-session`, or cookie-parser dependency.

**Status: `VERIFIED`.**

## 4. Browser / client analysis

| Client | Type | Auth transport | CORS-relevant? |
|---|---|---|---|
| `apps/customer-mobile` | React Native (native, not a browser engine) | Bearer token in `SecureStore` | No — native HTTP clients are never subject to the browser same-origin/CORS model. |
| `apps/agent-mobile` | React Native (native) | Bearer token in `SecureStore` | No, same reasoning. |
| `apps/admin-web` | Vite + React **browser SPA** (confirmed via `vite.config.ts`, `index.html`, real DOM-based Jest tests) | Bearer token stored in `localStorage` (`admin_workforce_token`), manually attached per request in `apps/admin-web/src/services/api-client.ts` | **Yes** — this is the only real browser client in the system. |

`admin-web`'s own `src/config/index.ts` carries an explicit, pre-existing engineering
decision (left over from a prior task, V1-RELEASE-01) that is directly relevant:

> Production default is a same-origin relative path (`/api/v1`), which works when the
> backend is reverse-proxied under the same origin as this static app (the common gateway
> pattern). Cross-origin deployments must set `ADMIN_WEB_API_BASE_URL` at build time.

This confirms the **intended production topology is same-origin** (admin-web's static
bundle and the API reverse-proxied under one origin), with cross-origin deployment treated
as an explicit, opt-in configuration choice a deployer must make, not the default.

No cookie usage, no `credentials: 'include'`/`credentials: 'same-origin'` fetch option, and
no CSRF-style ambient credential exists anywhere in `apps/admin-web/src`.

**Could a malicious third-party site induce an authenticated browser session to call the
API (CSRF-style)?** No, for two independent, compounding reasons proven from source and
from a live running instance (§5):

1. **No ambient credential.** The browser never automatically attaches the admin token to
   any request — there is no cookie. The token lives in `localStorage`, which is strictly
   isolated per-origin by the browser's Same-Origin Policy; JavaScript running on
   `https://evil-attacker.example` cannot read `localStorage` belonging to the legitimate
   admin-web origin. Without the token, a forged request from a malicious site is simply
   unauthenticated and gets `401`.
2. **Preflight requirement.** Every authenticated admin-web request sets both
   `Content-Type: application/json` and a custom `Authorization` header, which are
   non-"simple" per the Fetch/CORS spec and therefore force the browser to send a
   preflight `OPTIONS` request before the real request is ever dispatched. The backend has
   no route handling for `OPTIONS` (confirmed live, §5), so any cross-origin preflighted
   request a malicious page's JS attempted would be rejected by the browser itself before
   the real request is ever sent, regardless of what the (hypothetically stolen) token
   contained.

**Status: `VERIFIED`.**

## 5. CORS security finding (real test evidence, not curl-only)

A literal headless-browser (Chromium engine) replay was attempted via Playwright to give a
true browser-level reproduction, per the explicit instruction that curl is not sufficient
proof of browser behaviour. This failed for infrastructure reasons identical to those
already documented in V1-INFRA-01: the sandbox's network egress allowlist does not include
`cdn.playwright.dev`, so no browser binary could be downloaded (`ECONNRESET` on every
attempt). **This specific sub-step is `REQUIRES INFRASTRUCTURE`.**

In its place, the actual HTTP artifacts that a real browser's CORS algorithm deterministically
keys off of were captured from the running backend (local embedded PostgreSQL 18.4 +
freshly built `dist/main.js`, two real customers registered end-to-end through OTP →
verification → registration → login, a real seeded ledger credit, and a real completed
wallet-to-wallet transfer — see §11). These are not inferences from curl's own behaviour;
they are the literal response headers and status codes a browser's Fetch/CORS algorithm
reads to decide whether to let cross-origin JavaScript proceed:

1. **Legitimate origin, unauthenticated GET** (`Origin: http://localhost:5173`) →
   `401 Unauthorized`, **no `Access-Control-Allow-Origin` header present**.
2. **Malicious origin, same unauthenticated GET** (`Origin: https://evil-attacker.example`)
   → `401 Unauthorized`, **no `Access-Control-Allow-Origin` header present** — byte-for-byte
   identical treatment to the legitimate origin. The server does not even branch on
   `Origin` — it is not inspected anywhere in the request pipeline (confirmed by the
   structured request logs, which show `origin` captured only for logging).
3. **Preflight `OPTIONS`** for a POST with `Access-Control-Request-Method: POST` and
   `Access-Control-Request-Headers: authorization,content-type` → `404 Not Found`. There is
   no OPTIONS route handling anywhere in the app — identical to the finding already
   recorded in V1-INFRA-01.
4. **Real authenticated GET with a valid bearer token, legitimate origin** → `200 OK` with
   real customer data, **no `Access-Control-Allow-Origin` header present**.
5. **Real authenticated GET with the same valid bearer token, malicious origin** → `200 OK`
   with the same real customer data at the HTTP layer, **still no `Access-Control-Allow-
   Origin` header present**.

Test 5 is the crux of the browser-vs-curl distinction demanded by this task: curl happily
reads the response because curl does not implement CORS. A **real browser** would behave
completely differently: it would still receive and process the response (CORS does not
block the server from processing a request), but it would **refuse to let the calling
page's JavaScript read that response**, because the response carries no `Access-Control-
Allow-Origin` header matching (or wildcarding) the calling origin. Combined with the proof
in §4 that an attacker cannot obtain a legitimate session token in the first place
(no ambient cookie, no cross-origin `localStorage` access, preflight blocks anything
requiring a non-simple header), there is no scenario under the current architecture in
which a malicious site can either (a) cause the victim's browser to send a credentialed
request on the attacker's behalf, or (b) read any response, authenticated or not, from a
different origin.

The **worst-case consequence of the current configuration is not a security hole — it is
an availability failure if admin-web is ever deployed cross-origin from the API**: every
authenticated admin-web request would be blocked by the browser's own preflight check
(since `OPTIONS` returns 404), and admin-web would not function at all. This is the exact
scenario admin-web's own code comment already anticipates and requires an explicit opt-in
(`ADMIN_WEB_API_BASE_URL`) to create.

**Status: `VERIFIED`** for the HTTP/CORS-algorithm-level evidence; **`REQUIRES
INFRASTRUCTURE`** only for literal Chromium-engine reproduction (blocked by sandbox
network egress, not by anything in the codebase).

## 6. CORS decision

Classification against the Part A options: **(A) safe/intentional for the current and
documented default (same-origin reverse-proxy) deployment topology**, with a known,
already-documented conditional dependency equivalent to option (C) ("required only for
admin-web") **if and only if** a deployer chooses the non-default, explicitly-opt-in
cross-origin topology.

Per the explicit task instruction not to add CORS "because production applications should
have CORS," and because no genuine browser client in this codebase currently requires
cross-origin access (native mobile apps are exempt from CORS entirely; admin-web is
designed, documented, and tested against a same-origin deployment by default): **no CORS
middleware was added.** Adding CORS unconditionally would not improve security (there is
no CSRF/credential-theft exposure to close — see §4–5) and would not be "the smallest safe
config" demanded by Part C, because there is currently no legitimate cross-origin caller to
configure for. Hard-coding an allowed-origin list today would mean guessing at a future
deployment's real domain, which is exactly the kind of invented fix this task explicitly
forbids.

If a future deployment genuinely serves admin-web from a different origin than the API
(by setting `ADMIN_WEB_API_BASE_URL` to a cross-origin URL), that is the correct trigger
point to add a minimal, explicit-origin CORS policy (allowed methods `GET,POST,PATCH,
DELETE`, allowed headers `Content-Type,Authorization,Idempotency-Key`, no credentials mode,
no wildcard, production origin list sourced from real deployment config, not hard-coded) —
but doing so now, for a topology that does not exist, would be speculative and is out of
scope.

**Decision: SAFE/INTENTIONAL for the current default architecture. No code change.**
**Status: `SAFE/INTENTIONAL`.**

## 7. Wallet architecture

A full, live PostgreSQL instance (embedded Postgres 18.4, migrated from a clean schema
using the repository's real TypeORM migrations — no hand-edited schema) revealed the
complete picture, which is larger than the two tables named in the originating finding:

| Table | Rows after real registration + funding + transfer | Role |
|---|---|---|
| `wallet_accounts` | 2 (one per real customer) | **Live, authoritative wallet table.** |
| `ledger_accounts` / `ledger_journals` / `ledger_lines` | populated and internally consistent | Double-entry ledger backing every wallet balance. |
| `customer_wallets` | 0 | Legacy/parallel wallet model — see §9. |
| `customer_financial_account_bindings` | 0 | Bridge table intended to link `customer_wallets` ↔ `wallet_accounts` ↔ `ledger_accounts` — see §9–10. |
| `wallet_provisioning_histories`, `wallet_aliases`, `wallet_ownerships` | 0 | Satellite tables of the legacy `customer_wallets` model (FK to `customer_wallets.id`), never populated. |

**Status: `VERIFIED`.**

## 8. `wallet_accounts` authority analysis

Traced the actual, live, production code path — not inferred from naming:

- `src/customer-registration/customer-registration.service.ts` (the real registration flow
  exercised live end-to-end in this audit) creates exactly one `WalletAccount` row and one
  dedicated `ledger_accounts` row per new customer. It never touches `CustomerWallet`.
- `src/transfer/transfer.service.ts` — the class backing the live `POST
  /customers/me/transfers` endpoint actually exercised in this audit — injects
  `@InjectRepository(WalletAccount)`, `@InjectRepository(LedgerJournal)`, and
  `LedgerService`. It has **no** dependency on `CustomerWallet`,
  `CustomerFinancialAccountBindingService`, or any binding entity.
- `src/agent/agent-cash-to-cash.service.ts` (C2C), `src/agent/agent-funding.service.ts`
  (agent cash-in, the C2W/W2C "Method 1" backing service), and
  `src/customer-funding/customer-funding.service.ts` (customer funding requests) all use
  `WalletAccount` exclusively (`import { WalletAccount } from '../wallet/wallet-account.
  entity'`, `this.dataSource.getRepository(WalletAccount)`); **none import or reference
  `CustomerWallet`.**
- A live GET `/customers/me/wallets` returns `balanceMinor` computed from `ledger_lines`
  joined through `wallet_accounts.ledger_account_id` (confirmed by seeding a raw ledger
  credit directly in Postgres and observing the API correctly report the new balance with
  zero application code touched) — i.e. balance, currency, and status are all
  `wallet_accounts`/ledger-derived, never read from `customer_wallets`.
- `apps/customer-mobile/src/screens/authenticated/HomeScreen.tsx` carries a pre-existing
  code comment from an earlier task making this explicit: *"ownership-scoped `GET
  /customers/me/wallets` surface, not the legacy unauthenticated `/customers/:id/wallets`
  route."* This independently corroborates the same conclusion reached here from first
  principles.

**Conclusion: `wallet_accounts` (backed by the `ledger_*` tables) is the sole authoritative
source for wallet identity, customer↔wallet binding, balance, currency, status, and
ownership across every live V1 money-movement code path.** **Status: `VERIFIED`.**

## 9. `customer_wallets` analysis (legacy table, 14 sub-questions)

1. **Why does it exist?** It is the persistence model for a parallel, more elaborate
   wallet concept (`type IN ('PRIMARY','SAVINGS','BUSINESS','ESCROW')`, with alias,
   ownership-evidence, and provisioning-history satellite tables) built under ticket series
   **A3** (migration `CreateCustomerWalletProvisioning1785753600011`, service/controller
   under `src/customer-wallet/`, reconciliation references tagged `A3T07`/`A3T08_HANDOFF`
   in `src/reconciliation/reconciliation.service.ts` and
   `src/reconciliation/customer-financial-account-reconciliation.types.ts`).
2. **Legacy status:** It predates (or was built in parallel with and never cut over to)
   the simpler `wallet_accounts` model that the actual V1 registration/transfer/funding
   pipeline uses. It is forward/staged scaffolding for an unfinished feature, not
   historical production data carried over from a predecessor system — there is no
   evidence of a prior "V0" system in this repository.
3. **Read usage:** `CustomerWalletService` (`src/customer-wallet/customer-wallet.service.
   ts`) reads/writes it, but is **never injected by any other service** in the codebase
   (confirmed by a full-repo grep for `CustomerWalletService` outside its own module —
   zero consumers).
4. **Write usage:** The only write path is `CustomerWalletController`
   (`POST/GET/PATCH /customers/:id/wallets[...]`), reachable only via direct HTTP call. No
   client calls it: `apps/customer-mobile` explicitly avoids it (see §8); no agent-mobile
   or admin-web code references it either. It is gated by the same global `RuntimeAccessGuard`
   (`APP_GUARD`) as every other route, so it is not unauthenticated, but it is unreached by
   any real UI.
5. **FK references:** `wallet_provisioning_histories.wallet_id`, `wallet_aliases.wallet_id`,
   `wallet_ownerships.wallet_id`, `customer_financial_account_bindings.customer_wallet_id`/
   `.customer_id`, and — importantly — `transfers.source_customer_wallet_id` /
   `transfers.destination_customer_wallet_id` all carry FK constraints to `customer_wallets.
   id`. These columns exist on the live `transfers` table but are **nullable and were
   confirmed `NULL` on a real, completed transfer row** executed in this audit (see §11) —
   i.e. the schema was extended for a future command-based transfer model (the same `A3`
   series: `command_id`, `command_type`, `capability`, `action`, `source_binding_id`,
   `destination_binding_id`, `source_ledger_account_id`, etc. are all present and all
   `NULL` on real traffic). The live `TransferService` populates only `source_wallet_id`/
   `destination_wallet_id` (the `wallet_accounts` columns).
6. **Reconciliation references:** Yes — the only place `customer_wallets` meaningfully
   participates in live production code today, see §10.
7. **Report references:** None found in any reporting/export code.
8. **Customer-facing API references:** None (see #4; mobile explicitly bypasses it).
9. **Agent-facing API references:** None found in `apps/agent-mobile` or `src/agent/`.
10. **Support-facing API references:** None found in `src/support/`.
11. **Financial-transaction-code references:** None in `src/ledger`, `src/payment`,
    `src/commission`, `src/fee-rules`, or `src/commercial-accounting` — all confirmed
    clean via grep.
12. **Population in fresh vs. upgraded deployments:** Identical — a completely fresh
    database, migrated from scratch and exercised through two real customer registrations,
    a real seeded funding credit, and three real transfers, left `customer_wallets` at 0
    rows throughout. There is no migration or bootstrap step anywhere in the codebase that
    backfills it. A fresh deployment and an "upgraded" deployment would behave identically:
    the table stays empty unless someone calls the orphaned `CustomerWalletController`
    directly.
13. **Could divergence affect money movement?** No — proven empirically in §12 (mutation
    test): inserting and then deleting a `customer_wallets` row for a real, actively
    trading customer had **zero effect** on wallet listings, balances, or the ability to
    execute real transfers.
14. **Repo-wide search:** A full-repository grep for `customer_wallets` / `CustomerWallet\b`
    found exactly the files enumerated in §7/§8/§9 above — `src/customer-wallet/*`,
    `src/wallet/customer-financial-account-binding*.ts`, `src/reconciliation/
    reconciliation.service.ts`, and the three migrations that created the schema. No other
    occurrences exist anywhere in `src/`, `apps/`, or `test/` beyond those already listed
    and their own unit specs.

**Status: `FINDING`** (confirmed stale/incomplete feature, not a security or financial
correctness defect — see §14 for why no removal is recommended).

## 10. Reconciliation analysis

The `customer_financial_account_binding_integrity` check (`src/reconciliation/
reconciliation.service.ts`, tagged `A3T07`/`A3T08_HANDOFF` throughout) runs this query
(abbreviated) as part of `ReconciliationService.runReconciliation()`, exposed at the real,
live internal endpoint `GET /internal/reconciliation/report`:

```sql
SELECT wa.id AS wallet_account_id, ...
  FROM wallet_accounts wa
  LEFT JOIN customer_financial_account_bindings b ON b.wallet_account_id = wa.id
  LEFT JOIN ledger_accounts la ON la.id = wa.ledger_account_id
 WHERE b.id IS NULL
   AND wa.status IN ('ACTIVE', 'SUSPENDED')
```

Every `wallet_accounts` row with no matching `customer_financial_account_bindings` row is
flagged `UNBOUND_FINANCIAL_WALLET` (`severity: WARNING`). Because **no live code path ever
creates a `customer_financial_account_bindings` row** (the only writer,
`CustomerFinancialAccountBindingService`, is invoked solely through
`A3InternalTransferBindingAdapter`, which is wired as the `INTERNAL_TRANSFER_BINDING_PORT`
implementation inside `src/transfer/transfer.module.ts` — but the consuming class,
`InternalTransferGateService`, is registered and exported by that module and then **never
injected or called by anything else in the entire codebase** — confirmed by a full-repo
grep finding zero consumers outside its own module file), this check is **guaranteed to
fire a WARNING for every single wallet that will ever exist in V1**, regardless of whether
the system is financially correct.

This was proven directly against the live database used throughout this audit (two real
customers, a real seeded credit, three real completed transfers): running the actual
`ReconciliationService.runReconciliation()` method (via `NestFactory.
createApplicationContext`, bypassing only the HTTP auth layer, not the business logic)
produced:

```
status: WARNING
  wallet_balances_ledger_derived            → PASS (2 wallets checked, 0 violations)
  wallet_liability_account_ownership        → PASS (2 wallets checked, 0 violations)
  journal_balance_integrity                 → PASS (2 journals checked, 0 violations)
  orphan_ledger_entries                     → PASS (0 violations)
  journal_line_account_integrity            → PASS (0 violations)
  completed_payment_journal_integrity       → PASS (0 violations)
  failed_transfer_attempts                  → PASS (0 failed transfers)
  currency_consistency                      → PASS (0 violations)
  accounting_unit_consistency               → PASS (0 violations)
  customer_financial_account_binding_integrity → WARNING (2 UNBOUND_FINANCIAL_WALLET, 0 ERRORs)
```

Every check that actually governs financial correctness (balances, journal balancing,
ledger/journal/account referential integrity, currency and accounting-unit consistency,
failed-transfer detection) **passed cleanly**. The single WARNING is exclusively the
`UNBOUND_FINANCIAL_WALLET` discrepancy, at `WARNING` (not `ERROR`) severity, against both
of the two real, newly-created, fully-functional wallets.

**Classification (per the Part F options): primarily (F) incomplete V1 cleanup of a
staged-but-unfinished feature (the "A3" internal-transfer-binding-gate work: schema
columns, services, and this reconciliation check were all built, but the integration step
that would actually create bindings at wallet-creation time, and the companion
`InternalTransferGateService`/`CustomerFinancialAccountBindingRepairService` that would
consume/repair them, were never wired into any live code path), with secondary
characteristics of (B) a stale legacy expectation — the check still assumes every active
wallet must have a binding, which was true for the design the A3 ticket series was building
toward but is not true for V1's actual, simpler, live architecture.** It is **not** (A) a
genuine inconsistency (nothing is actually wrong), **not** (D) broken logic (the check
correctly and accurately detects what it was written to detect), and **not** (E) simply a
missing migration (completing it would mean finishing an entire unfinished feature, not
running one migration).

Per the explicit instruction not to simply suppress the warning, and because fixing it
properly would require either (a) finishing the A3 binding-integration feature end-to-end
(building a wallet-creation-time binding writer, which is a wallet-architecture change
explicitly out of scope) or (b) removing/rewriting the reconciliation check itself (a
"new reconciliation system" change, also explicitly out of scope) — **no reconciliation
code change was made.** This is documented here precisely so the WARNING is never
mistaken, in a future on-call rotation, for a real financial discrepancy: it is a known,
permanent, by-design artifact of incomplete feature work, not evidence of money being at
risk.

**Status: `FINDING`** (documented, no code change — see §14 for rationale).

## 11. Four-flow authority proof

All four proofs below were produced against a real, freshly migrated local PostgreSQL
instance with the real, compiled application (`dist/main.js`), not mocks.

- **W2W (wallet-to-wallet):** Two real customers were registered end-to-end through the
  live OTP → verify → complete-registration flow. A real ledger credit of ₦5,000.00 was
  seeded for customer 1 via a balanced, trigger-validated journal (the database enforces a
  deferred `assert_ledger_journal_balanced()` constraint — an unbalanced attempt was
  rejected before a valid one was accepted). A real `POST /customers/me/transfers` call
  moved ₦1,500.00 from customer 1 to customer 2. Result: `status: "COMPLETED"`, a new
  `ledger_journals`/`ledger_lines` pair with matching DEBIT/CREDIT amounts against each
  customer's own `wallet_accounts`-linked ledger account, and `GET /customers/me/wallets`
  correctly reporting the new balance (₦3,500.00) computed purely from the ledger. The
  persisted `transfers` row has `source_wallet_id`/`destination_wallet_id` populated (both
  `wallet_accounts` IDs) and **every legacy/A3 column
  (`source_customer_wallet_id`, `destination_customer_wallet_id`, `source_binding_id`,
  `destination_binding_id`, `source_ledger_account_id`, `destination_ledger_account_id`,
  `command_id`, `command_type`, `capability`, `action`) is `NULL`.**
- **W2C-Method-1 / C2W (agent cash-in/out):** Traced statically — `src/agent/agent-
  funding.service.ts` resolves the agent's own wallet via `this.dataSource.
  getRepository(WalletAccount)` / `this.ensureWalletAccount(...)` and posts through the
  same `LedgerService` used by the W2W path above. No reference to `CustomerWallet`
  anywhere in the file.
- **C2C (agent cash-to-cash):** Traced statically — `src/agent/agent-cash-to-cash.service.
  ts` resolves wallets via the identical `WalletAccount`/`ensureWalletAccount` pattern, and
  its dedicated `cash_to_cash_transfers` table (`src/agent/cash-to-cash.entity.ts`) has
  **zero wallet-related columns of any kind referencing the legacy model** — confirmed by
  direct schema inspection of the live database.
- **Does any flow still touch `customer_wallets`?** No. The only code in the entire
  repository that can write to `customer_financial_account_bindings` (the one table that
  could, in principle, bridge a live transfer to the legacy model) is reachable solely
  through `InternalTransferGateService`, which is proven dead code (registered, exported,
  never injected anywhere) — see §10.

**Status: `VERIFIED`** — all four V1 flows use `wallet_accounts` (+ `ledger_*`) exclusively,
proven through a combination of live execution (W2W) and static code-path tracing (W2C,
C2W, C2C), not inferred from naming.

## 12. Legacy mutation analysis (disposable DB only)

Performed exclusively against the **local embedded Postgres instance stood up for this
audit** (a brand-new, disposable database created solely for this investigation, running
on `localhost:5432` via `scripts/embedded-pg.js`) — **never against the shared staging
database**, per the explicit instruction.

1. Inserted a new `customer_wallets` row (`type='PRIMARY', currency='NGN',
   status='ACTIVE'`) for the real, actively-trading customer from §11.
2. Immediately re-checked `GET /customers/me/wallets` (unchanged) and executed a further
   real `POST /customers/me/transfers` (₦100.00) — **succeeded, `status: "COMPLETED"`,**
   identical in every respect to the pre-insert transfer.
3. Deleted the inserted `customer_wallets` row.
4. Re-checked the wallet listing (unchanged, now correctly reflecting the post-transfer
   balance) and executed one more real transfer (₦50.00) — **succeeded, `status:
   "COMPLETED"`,** with no error, no FK violation, and no behavioural difference of any
   kind before, during, or after either mutation.

**Conclusion: `customer_wallets` is proven, by direct empirical mutation testing against a
disposable database, to have zero operational coupling to any live V1 financial flow.** It
is **not** authoritative (per §8–9), **not** advisory (nothing reads it to inform a
decision), and **not** dangerous residue (mutating/deleting rows from it has no observable
effect on money movement). The correct classification is **inert, unused scaffolding for
an unfinished feature** — distinguishable from "harmless residue" only in that the
reconciliation query in §10 still structurally references it (a `LEFT JOIN` against
`customer_financial_account_bindings`, which itself FK-references `customer_wallets`),
meaning the table cannot be dropped without first touching that reconciliation code — which
is exactly why no removal was performed in this task (see §14).

**Status: `VERIFIED`.**

## 13. Unknown-unknown findings (evidence-backed only)

- **`InternalTransferGateService` and `CustomerFinancialAccountBindingRepairService` are
  both fully built, DI-registered, and exported, but have zero consumers anywhere in the
  codebase.** This is a genuine "hidden dead code path" finding: the binding-validation and
  binding-repair machinery for the A3 feature exists and compiles, but nothing — no
  controller, no cron, no other service — ever calls it. A future engineer searching for
  "where are bindings repaired" would find the repair service and reasonably assume it
  runs somewhere; it does not. **Evidence:** full-repo grep for both class names found only
  their own definitions and `wallet.module.ts` registration/export — no other call sites.
- **The `transfers` table schema carries an entire second generation of columns
  (`command_id`, `command_type`, `command_version`, `capability`, `action`,
  `command_scope`, `source_customer_id`, `destination_customer_id`,
  `source_customer_wallet_id`, `destination_customer_wallet_id`, `source_binding_id`,
  `destination_binding_id`, `source_binding_version`, `destination_binding_version`,
  `source_ledger_account_id`, `destination_ledger_account_id`,
  `authorization_context_reference`, `policy_decision_reference`, `policy_version`,
  `policy_profile_reference`, `policy_profile_version`, `policy_snapshot_reference`,
  `policy_input_hash`, `idempotency_scope`) that is entirely unpopulated (`NULL`) on every
  real transfer produced by the live `TransferService`.** This is a genuine "incompatible-
  generation schema" finding: a future reconciliation or reporting query that assumes these
  columns are populated (because they exist and are not obviously deprecated) would
  silently operate on `NULL`s for 100% of real V1 traffic. **Evidence:** direct inspection
  of the real `transfers` row produced by the live W2W transfer in §11.
- **No evidence was found** of: hidden joins against `customer_wallets` from reporting
  code, stale reports exposing it, admin/support endpoints surfacing it, ORM entities
  silently treated as authoritative elsewhere, or staging-vs-production CORS/config
  divergence (the `.env.example` and `vite.config.ts` config is environment-driven and
  symmetric; no staging-only or production-only CORS branch exists anywhere in the code).
  These negative results are reported because the task requires only evidence-backed
  findings — absence of evidence after a full-repository search is itself the evidence for
  "no finding" in these categories.

**Status: `FINDING`** for the two dead-code/unpopulated-schema items above; **`VERIFIED`
(no finding)** for every other unknown-unknown category searched.

## 14. Exact fixes

**No source code changes were made.** Rationale, matching the Part J options:

- **(1) No code change required** is the correct decision for CORS: the absence is
  safe/intentional for the current, documented, default same-origin deployment topology,
  and no genuine browser client requires cross-origin access today (§6). Adding CORS now
  would mean guessing at a hypothetical future deployment's origin, which this task
  explicitly forbids as an invented fix.
- **(1) No code change required** is also the correct decision for the wallet/reconciliation
  finding, for three independent reasons: (a) the underlying financial architecture is
  proven correct and `wallet_accounts`-authoritative (§8, §11) — there is nothing broken to
  fix; (b) the task explicitly forbids simply suppressing the WARNING, and the only
  non-suppressing fixes available — finishing the unfinished A3 binding-integration
  feature, or rewriting the reconciliation check's binding model — are both explicitly
  out of scope (no wallet redesign, no new reconciliation system); (c) the legacy table
  cannot be safely removed without first modifying the reconciliation query that still
  structurally joins against it (§10, §12), and that modification is itself the
  reconciliation-logic-correction option this task declines to invent without a
  product/engineering decision on whether the A3 feature will ever be completed or
  formally retired.

This audit's job was to determine *which* model is authoritative and *why* the WARNING
fires, not to decide the A3 feature's fate — that decision belongs to whoever owns that
ticket series, and is flagged here as a recommendation (§17), not performed as a fix.

**Status: `FINDING` (documented), no `FIXED` items this task.**

## 15. Tests

No source code was changed, so no regression suite was required to validate a fix.
Targeted verification was nonetheless run to confirm the baseline the findings above rest
on is itself healthy:

- `npx tsc --noEmit -p tsconfig.json` → **clean, exit 0.**
- Targeted Jest suites directly covering the investigated areas — `reconciliation.service.
  spec.ts`, `customer-financial-account-binding.service.spec.ts`,
  `customer-financial-account-reconciliation.spec.ts`, `customer-wallet.service.spec.ts`,
  `transfer.service.spec.ts`, `transfer-reconciliation.service.spec.ts`,
  `external-reconciliation.service.spec.ts`, `a7-product-reconciliation.service.spec.ts` →
  **8 suites, 96 tests, all passed.**
- `apps/admin-web` full Jest suite (6 suites covering `App`, `auth-store`,
  `customer-servicing`, `ledger-operations`, `reconciliation-observability`,
  `transaction-observability`) → **6 suites, 21 tests, all passed** (one benign React
  `act()`/DOM-prop development warning, not a failure).
- `eslint` on `src/reconciliation/**`, `src/wallet/**`, `src/customer-wallet/**`,
  `src/transfer/**`, `src/main.ts` → 4 pre-existing `@typescript-eslint/no-explicit-any` /
  `no-unsafe-member-access` errors in `src/transfer/transfer.service.ts` (lines 390–398).
  These predate this audit (the file was not modified by this task), are unrelated to CORS
  or wallet authority, and are out of this task's scope to fix.
- Real HTTP-level CORS regression evidence: captured in §5, produced against a live,
  freshly built instance of the unmodified backend.
- Real PostgreSQL regression evidence: captured in §10–12, produced against a live,
  freshly migrated database with real registration, funding, and transfer traffic.

The full V1 test suite was **not** re-run, per the explicit instruction to keep testing
targeted to the two findings under investigation.

**Status: `VERIFIED`.**

## 16. Remaining risks

- **`REQUIRES INFRASTRUCTURE`:** a literal Chromium-engine browser replay of the CORS
  scenarios in §5 could not be performed in this sandbox (network egress does not permit
  downloading a browser binary). The protocol-level evidence gathered is a faithful proxy
  for actual browser behaviour (it tests the exact header/response conditions the Fetch/
  CORS algorithm evaluates), but a true browser run would be a stronger artifact if this
  environment's egress policy changes.
- **`FINDING` (low severity, documentation-only):** the `customer_financial_account_
  binding_integrity` reconciliation check will continue to report `WARNING` for every
  wallet in the system, forever, until either the A3 binding-integration feature is
  completed or the check is retired/rewritten. On-call staff should be made aware (via this
  document) that this specific WARNING is expected and does not indicate a financial
  problem, to avoid wasted incident-response effort.
- **`FINDING` (low severity):** `InternalTransferGateService`,
  `CustomerFinancialAccountBindingRepairService`, and the legacy `CustomerWalletController`
  HTTP surface (`/customers/:id/wallets*`) remain live, compiled, reachable-by-direct-call
  (for the controller) dead/unused code. They carry no current risk (proven inert in §12),
  but represent maintenance surface and a potential source of future confusion if someone
  extends them believing they are part of the live transfer path.
- **No P0 or P1 severity finding exists.** Nothing discovered in this audit is exploitable,
  broken, or capable of causing incorrect money movement.

## 17. Recommendation

No code changes were required or made. The CORS absence is a safe, intentional consequence
of a bearer-token-only, no-cookie authentication architecture combined with a documented
same-origin default deployment topology; it should only be revisited if/when a genuine
cross-origin browser deployment is actually planned. The wallet authority question is fully
resolved: `wallet_accounts` (backed by the double-entry `ledger_*` tables) is proven, from
real production code paths and real live transaction execution — not from table naming —
to be the sole authoritative source for wallet identity, customer↔wallet binding, balance,
currency, status, and ownership across all four V1 money-movement flows. The legacy
`customer_wallets`/`customer_financial_account_bindings` model is real, staged, unfinished
"A3" feature scaffolding that is provably inert and carries zero financial risk today, but
should not be deleted without a separate, deliberate decision about the A3 feature's
future, because the reconciliation check still structurally depends on its schema. The
`customer_financial_account_binding_integrity` WARNING is a known, permanent,
by-design artifact of that incomplete feature and should be read as informational, not
alarming, until that separate decision is made.

**FINAL STATUS: A. INFRASTRUCTURE BOUNDARIES VERIFIED — NO P0/P1 FINDINGS**
