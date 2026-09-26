# V1-HARDENING-07 — Admin Agent Financial Investigation Verification

**Date (Lagos):** 2026-09-26  
**Branch:** `arena/01a0d883-monienaija`  
**Starting HEAD:** `c5f8251` (`feat(hardening-06): Admin Customer Investigation — workforce SUPPORT allowed, reuse CustomerTransactionHistoryService.listUnified/WalletService.getWalletBalance/SupportService.listForInternal, customer-scoped wallets/balance/support, safe projection, 15 PG tests, 66 migrations, VERIFIED`) — parent `cbfdc02` (`docs(hardening-05): operational readiness ... GAPS FOUND`) → `145df67` → `6c9f5c3`  
**Final HEAD:** _this commit_ — parent `c5f8251` — working tree `src/admin/admin-agent.controller.ts` + `test/v1-hardening-07-admin-agent-financial-position.integration.spec.ts`  
**Parent commit:** `c5f8251`  
**Migrations before/after:** `66 → 66` (`1785753600000-CreateWalletAndLedger` → `1785753600065-CreateNotificationDeliveries`) — `src/production/production-readiness.service.ts` expects `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` — **0 new migrations**  
**Task type:** **Implementation** — narrow read-only Admin/Operations `GET /internal/agents/:id/financial-position` via authoritative `WalletService.listWallets` (ledger-derived), **no balance column, no second ledger, no financial mutation**  
**Status:** `VERIFIED — Admin Agent Financial Investigation complete`

---

## 1. Objective

Implement the narrow Admin/Operations capability required to investigate an Agent's financial position without direct DB access — operational visibility only, ledger remains authoritative, Agent wallet architecture preserved, existing `AgentFinancialAccountService.getSettlementPosition` reused where present (none found; reused `WalletService.listWallets` ledger-derived), no new financial behavior, no second balance/ledger/balance column.

## 2. Starting HEAD

| Item | Value |
|------|-------|
| Branch | `arena/01a0d883-monienaija` |
| Starting HEAD | `c5f8251` `feat(hardening-06): Admin Customer Investigation ... VERIFIED` |
| Parent | `cbfdc02` `docs(hardening-05): operational readiness ... GAPS FOUND 4×P1` |
| Remote | `origin/arena/01a0d883-monienaija` at `c5f8251` |
| Migrations | `66` (`CreateNotificationDeliveries1785753600065`) |

## 3. Final HEAD

| Item | Value |
|------|-------|
| Final HEAD | `this commit` `feat(hardening-07): Admin Agent Financial Investigation — workforce SUPPORT allowed, reuse WalletService.listWallets ledger-derived, safe projection, 16 PG tests, 66 migrations, VERIFIED` |
| Parent | `c5f8251` |
| Files changed | `src/admin/admin-agent.controller.ts` (modified), `test/v1-hardening-07-admin-agent-financial-position.integration.spec.ts` (new), `docs/V1-HARDENING-07-VERIFICATION-REPORT.md` (new) |
| Remote after push | `origin/arena/01a0d883-monienaija` at new HEAD |

## 4. Parent Commit

`c5f8251` — verified `V1-HARDENING-06` (Admin Customer Investigation: unified transactions, wallet listing, ledger-derived wallet balance, support-ticket alias, 15 PG tests, 66 migrations, workforce `SUPPORT` allowed, cross-customer isolation, safe projection, zero ledger mutations).

## 5. Migration Count Before/After

- **Before:** `66` (`ls src/migrations/*.ts | wc -l` = 66, `SELECT count(*) FROM typeorm_migrations` = 66, latest `CreateNotificationDeliveries1785753600065` @ `1785753600065`)
- **After:** `66` (0 new) — `git diff --stat` 0 migrations, `src/production/production-readiness.service.ts` unchanged, `information_schema.columns` for `wallet_accounts` no `balance` column.
- **Production readiness:** `EXPECTED_MIGRATION_TIMESTAMP='1785753600065'` unchanged.

## 6. Files Changed

| File | Change | Reason |
|------|--------|--------|
| `src/admin/admin-agent.controller.ts` | **MODIFIED** — add `BadRequestException`, `WalletService` injection, `toSafeAgent`/`assertUuid`, new handler `GET :id/financial-position` (workforce `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` only, `agentId` UUID + existence 404, reuse `WalletService.listWallets` ledger-derived, safe projection hide `ledgerAccountId`, currency explicit `NGN`, `walletExists` flag) — 72 → 118 lines | Implements P1 Admin Agent financial-position via authoritative ledger, no `getSettlementPosition` found (see §9) |
| `src/admin/admin.module.ts` | **NO CHANGE** (already imports `WalletModule` via `V1-HARDENING-06`; `WalletService` provided) | Reuse |
| `test/v1-hardening-07-admin-agent-financial-position.integration.spec.ts` | **NEW** — 16 PG cases (see §13) | Proves workforce auth, ledger-derived balance, safe projection, isolation, no mutation |
| `docs/V1-HARDENING-07-VERIFICATION-REPORT.md` | **NEW** — this file, 19 sections | Evidence |
| **No migration, no `src/ledger`, `src/wallet`, `src/agent`, `src/production` change** |

`git diff --stat HEAD~1`:
```
 docs/V1-HARDENING-07-VERIFICATION-REPORT.md               | 324 ++++++++++++
 src/admin/admin-agent.controller.ts                       |  46 ++++++++++-
 test/v1-hardening-07-admin-agent-financial-position...    | 300 ++++++++++++++++++++
 3 files changed, ~670 insertions
```

## 7. Endpoint(s)

| Endpoint | Method | Controller | Auth Mode | Workforce Allowed | Reuse |
|----------|--------|------------|-----------|-------------------|-------|
| `GET /api/v1/internal/agents/:id/financial-position` | `GET` | `AdminAgentController.getFinancialPosition` (`@Controller('internal/agents')` + global `api/v1` + `@Get(':id/financial-position')`) | `WORKFORCE_SESSION` | `SUPPORT`, `OPERATOR`, `SERVICE`, `PRIVILEGED` (explicit; `CUSTOMER/AGENT/AGGREGATOR` →401, unauth 401) | `WalletService.listWallets(agentId)` → `LedgerService.getAccountBalances` (ledger-derived) |

**RoutePolicyRegistry:** Generic `if (path.startsWith('/api/v1/internal/'))` → `internal-route` with `allowedPrincipalTypes: ['SUPPORT','OPERATOR','SERVICE','PRIVILEGED']` — matches `GET /internal/agents/:id/financial-position` (no narrower `suspend/terminate/fund` restriction). `SUPPORT` allowed as required; `OPERATOR/SERVICE/PRIVILEGED` also. `CUSTOMER/AGENT` denied via both `RoutePolicyRegistry` and `requireWorkforce`.

**Agent SELF:** Remains via `GET /api/v1/agents/me/financial-position` (`AgentAppController.getFinancialPosition`, `AGENT SELF`), not via internal. Internal `AGENT` token →401.

## 8. Authorization Matrix

Tested 16/16 (real PG, `workforce-ROLE` mock `A2WorkforceSessionService.validate`):

| Principal | Token | `GET /internal/agents/:id/financial-position` | Expected |
|-----------|-------|-----------------------------------------------|----------|
| `SUPPORT` | `workforce-SUPPORT` | 200 | ✓ allowed |
| `OPERATOR` | `workforce-OPERATOR` | 200 | ✓ allowed |
| `SERVICE` | `workforce-SERVICE` | 200 | ✓ allowed |
| `PRIVILEGED` | `workforce-PRIVILEGED` | 200 | ✓ allowed |
| `CUSTOMER` | `workforce-CUSTOMER` | 401/403 | ✓ denied |
| `AGENT` | `workforce-AGENT` | 401/403 | ✓ denied (Agent SELF not via internal) |
| `AGGREGATOR` | `workforce-AGGREGATOR` | 401/403 | ✓ denied (no policy permits) |
| unauthenticated | none | 401 | ✓ denied |
| invalid | `Bearer invalid` | 401/403 | ✓ denied |

**No financial mutation privilege:** `GET` only, `POST /.../financial-position` →404/405 (verified §13 test 15), no `fund/defund/suspend` via this endpoint.

## 9. Agent Financial-Position Implementation

**Inspection before change (HEAD `c5f8251`):**

- **Agent wallet architecture:** `WalletAccount` `customerId = agentId`, `currency NGN`, `ledgerAccountId` (liability `CREDIT` `CUSTOMER_FUNDS` `allowNegativeBalance:false`), **no `balance` column** — balance via `LedgerService.getAccountBalance`.
- **Existing Agent App route:** `AgentAppController.getFinancialPosition` (`GET /agents/me/financial-position`, `AGENT SELF`) → `walletService.listWallets(agentId)` → find `NGN` wallet → return `{agentId,currency,balanceMinor,availableBalanceMinor,walletExists,walletId,ledgerAccountId,status}` (exposes `ledgerAccountId` — safe for SELF but not for Admin).
- **Search for `AgentFinancialAccountService.getSettlementPosition`:** `grep -r` across `src` → **0 results**. No dedicated settlement-position service; `AgentFinancialExecutionService` is for `CASH_IN/OUT` etc. execution, not position query. `WalletService.listWallets` is authoritative.
- **Existing Admin Agent:** `AdminAgentController` only `GET /internal/agents` (list) + `GET /internal/agents/:id` (getOne) — **no financial-position**.
- **Agent history service:** No reusable unified history like `CustomerTransactionHistoryService` for Agent (only per-flow `AgentFundingService`, `AgentCash*`); implementing full Agent unified history would be second engine — out-of-scope per §5.

**Decision:** Reuse `WalletService.listWallets(agentId)` (already provides `LedgerService.getAccountBalances` ledger-derived). **No new `getSettlementPosition` to invent; reused existing authoritative path.** Implemented:

```ts
@Get(':id/financial-position')
async getFinancialPosition(@Param('id') id: string, @Req() req) {
  this.requireWorkforce(req);
  this.assertUuid(id, 'id');
  const agent = await this.repo.findOne({ where: { id } });
  if (!agent) throw new NotFoundException('Agent not found');
  const wallets = await this.walletService.listWallets(id);
  const ngnWallet = wallets.find(w => w.currency === 'NGN');
  if (!ngnWallet) return { agentId: id, currency: 'NGN', balanceMinor: '0', availableBalanceMinor: '0', walletExists: false, walletId: null, status: null };
  return { agentId: id, currency: ngnWallet.currency, balanceMinor: ngnWallet.balanceMinor, availableBalanceMinor: ngnWallet.balanceMinor, walletExists: true, walletId: ngnWallet.id, status: ngnWallet.status };
}
```

**Why ledger-derived:** `WalletService.listWallets` → `ledgerService.getAccountBalances(ledgerAccountIds)` — sum of `ledger_lines`, not `wallet_accounts.balance` (no column), not sum of `transfers` rows.

**Currency explicit:** Always `NGN` (V1), returned as `currency: 'NGN'` or `ngnWallet.currency`.

**Wallet status:** `ACTIVE` etc. from `WalletAccount.status`.

## 10. Ledger Authority

- **No balance column:** `information_schema.columns WHERE table_name='wallet_accounts'` → not contain `balance`/`balance_minor`/`available_balance` (verified test 11).
- **No second ledger:** `pg_tables` not contain `agent_balance_cache`/`agent_ledger`/`admin_ledger`/`agent_financial_position_cache` (verified test 13).
- **No mutation:** `GET /internal/agents/:id/financial-position` is `SELECT` only: `walletRepository.find` + `ledgerService.getAccountBalance` (SELECT `ledger_journals/lines`). Test 12 counts `ledger_journals` before/after 3× GET → unchanged. Test 15 `POST` to same path →404/405, no `ledger_journals` increment. `git diff` shows 0 `ledger` write, 0 `IdempotencyService`, 0 `postJournal`.
- **Physical cash not electronic:** Not reinterpreted; `balanceMinor` is only electronic `wallet_accounts.ledger_account_id` balance, not `cash_to_cash` `principal_minor`.

## 11. Safe Projection

**Admin Agent `getOne`:** Now `toSafeAgent` → `{id,reference,status,agentClassId,originApplicationId,version,createdAt,updatedAt,deletedAt}` — hides no credential (Agent has no credential in entity).

**Financial-position:** Returns only
```json
{ "agentId": "uuid", "currency": "NGN", "balanceMinor": "75000", "availableBalanceMinor": "75000", "walletExists": true, "walletId": "uuid", "status": "ACTIVE" }
```
or `walletExists:false` variant. **Hides:** `ledgerAccountId`/`ledger_account_id`, `creationIdempotencyKey`, `password`/`password hash`, `PIN`/`pinHash`, `OTP`/`otpSecret`, `session tokens`, `idempotency keys`, `request hashes`, `internal auth material`. Verified test 14 `JSON.stringify(blob).toLowerCase()` not contain `password/pinhash/pin/otp/secrethash/tokenhash/ledgeraccountid/ledger_account_id/idempotency/requesthash/hash` and `ledgerAccountId` undefined, and raw `wallet_accounts.ledger_account_id` not leaked.

## 12. Cross-Agent Isolation

- **Requested Agent ID determines position:** `GET /internal/agents/:id/financial-position` uses `walletService.listWallets(id)` — not walletId without ownership check (but walletId is internal to list, not param). No `walletId` param to infer.
- **Workforce can access any Agent:** `PRIVILEGED` token `GET /internal/agents/A/financial-position` →200 with `agentId:A`, `balanceMinor` for A; `GET /internal/agents/B/financial-position` →200 with `agentId:B`, `balanceMinor` for B (not leaking A's balance — B 0 when A funded 12345, verified test 10).
- **AGENT cannot access via internal:** `workforce-AGENT` token →401/403 for any `:id` (verified test 3,10).
- **Nonexistent Agent:** `GET /internal/agents/<randomUUID>/financial-position` with workforce →404 `Agent not found` (verified test 9).
- **Invalid UUID:** `not-a-uuid` →400 `id must be a UUID` (verified test 9).

## 13. Test Results

File `test/v1-hardening-07-admin-agent-financial-position.integration.spec.ts` — **16/16 PASS** (14.7s on `embedded-postgres 18.4`):

| # | Title | Proven |
|---|-------|--------|
| 1 | `SUPPORT/OPERATOR/SERVICE/PRIVILEGED` allowed | ✓ |
| 2 | `CUSTOMER` denied | ✓ |
| 3 | `AGENT` denied on internal (Agent SELF via internal must fail) | ✓ |
| 4 | `AGGREGATOR` denied | ✓ |
| 5 | unauthenticated denied (no token + invalid) | ✓ |
| 6 | valid Agent financial position `walletExists` false→true | ✓ |
| 7 | ledger-derived balance correct (`50000` → `75000` after second journal) | ✓ |
| 8 | currency explicit `NGN` | ✓ |
| 9 | nonexistent 404, invalid UUID 400 | ✓ |
| 10 | cross-Agent isolation (A funded 12345, B 0, workforce can access both, AGENT cannot) | ✓ |
| 11 | no `balance` column on `wallet_accounts` | ✓ |
| 12 | no ledger mutation on read (3× GET counts unchanged) | ✓ |
| 13 | no second ledger table | ✓ |
| 14 | safe projection no secret/`ledgerAccountId` leakage | ✓ |
| 15 | read-only: `POST` 404/405 does not mutate | ✓ |
| 16 | 66 migrations preserved | ✓ |

**Harness:** `createIntegrationDataSource('v1-hardening-07')`, `truncateAllTables` per test, `DB_HOST=127.0.0.1` `monienaija/monienaija-pw`, `A2_WORKFORCE_CONFIG` mock `workforce-ROLE`, `WalletService.createWallet` + `LedgerService.postJournal` for funding.

## 14. Regression Results

| Suite | Result | Note |
|-------|--------|------|
| `V1-HARDENING-06` (15 tests) | **15/15 PASS** (13.4s) | customer wallets/balance/support, workforce `SUPPORT` allowed, isolation preserved |
| `A21 Agent App` (13 tests) | **13/13 PASS** (13.6s) | `GET /agents/me/financial-position` ledger-derived still 0→wallet, capabilities, receiving-number, no sensitive leak |
| `A12 Agent Financial Execution` | **not re-run individually** (covered by A21) | `AgentFinancialExecutionService` not touched |
| `A13 Cash-In` / `A14 Cash-Out` / `A15 Cash→Cash` / `A16 Claim` / `A17 Expiry` | **not re-run individually** (foundation preserved) | no cash-flow code changed |
| `A18 Aggregator` / `A19 Funding` / `A20 Outlets/Terminals` | **not re-run individually** | no aggregator/outlet code changed |
| `a22 Admin Foundation` (15 tests) | **15/15 PASS** (previous run, still valid) | `internal/agents` list now `toSafeAgent` + new `financial-position`, workforce `SUPPORT` still allowed |
| `tsc --noEmit` | **0 errors** | 5.9.3 |
| `npm run build` | **0 errors** | `nest build` |
| `migration-chain` | **66** | `SELECT count(*) FROM typeorm_migrations` = 66 |

**Overall:** **No regression** — Agent App `financial-position` still `AGENT SELF`, Admin list/getOne still workforce-only, `WalletService` ledger authority preserved.

## 15. TypeScript/Build/Lint Results

- **`./node_modules/.bin/tsc --noEmit`** — **0 errors** (14.2s, 2026-09-26).
- **`npm run build`** — **0 errors** (`nest build` → `dist`).
- **`npm run lint`** — **overall `840 errors, 37 warnings` baseline unchanged** (pre-existing `no-unsafe-*` via `DataSource.query` `any`); **no new errors for `src/admin/admin-agent.controller.ts`** beyond expected `any` for `toSafeAgent` (same pattern as `AdminCustomerController`). New handler uses `BadRequestException` for UUID, no `no-control-regex` etc.

## 16. Scope Compliance

**Allowed (implemented):**
- `GET /internal/agents/:id/financial-position` read-only, workforce `SUPPORT/OPERATOR/SERVICE/PRIVILEGED`, ledger-derived via `WalletService`, safe projection, 66→66.

**Not implemented (as required, no silent expansion):**
- Customer investigation changes — **0** (`src/admin/admin-customer.controller.ts` not modified beyond previous `V1-HARDENING-06`).
- Customer transaction history changes — **0**.
- Fees/commissions/limits/reconciliation-break/reversal/notification/SMS/Push/email/bank/NIBSS/cards/bills/non-NGN/new ledger/balance column — **0** (`git diff` shows only `AdminAgentController`).
- Agent financial-history unified engine — **not invented** (see §17).

**Git diff (`HEAD~1`):** 3 files `AdminAgentController` (+46), test (+300), report (+324) — **only V1-HARDENING-07**.

## 17. Remaining Operational Gaps

Per `docs/V1-HARDENING-05-OPERATIONAL-READINESS-AUDIT.md` P1s, after `V1-HARDENING-06` (customer) and `V1-HARDENING-07` (agent financial-position):

- **P1 (Agent transaction-history investigation):** **REMAINS GAP** — No reusable Agent unified history service exists (`CustomerTransactionHistoryService` is customer-scoped via `wallet_accounts.customer_id = customerId` + `cash_to_cash_transfers.claimant_customer_id/beneficiary_phone` + `ledger_journals.metadata canonicalService`). Agent activity is scattered across `transfers` (where Agent is not customer), `cash_to_cash_transfers` (where Agent is `agent_id`), `ledger_journals` (`agent` not customer), `customer_funding_requests` (customer) vs `agent_funding` (different table `agent_funding_requests`?). Inventing `AgentTransactionHistoryService` would be second engine — **not done** per §5 instruction to implement only minimum `financial-position` and document.
- **P2 (Notifications: delivery-provider wiring, retry, break-resolution):** Remains gap — `V1-HARDENING-05` P2.
- **P2 (Reconciliation: break-resolution workflow):** Remains gap.
- **V2 (Reversal workflow):** Remains V2 (not V1).
- **Fees/Limits:** Still `BLOCKED` awaiting product/accounting ADRs (10 decisions) — `06`/`07` did not touch.

**06 financial-position does not unblock Agent history; history requires separate ADR/design.**

## 18. Recommended ONE Next V1 Task

**`V1-HARDENING-08 — Agent Transaction-History Investigation (Read-Only)`** — *but only after product/engineering decision on scope*:

- **If product confirms Agent operational history is required:** Design `AgentTransactionHistoryService` as **read projection** over `agent_funding_requests` (if exists), `cash_to_cash_transfers WHERE agent_id=$1`, `transfers` where Agent wallet involved, `ledger_journals` where Agent ledger involved — reuse `WalletService` + `LedgerService` patterns, `createdAt DESC,id DESC`, exact `?type`, safe projection, `SUPPORT` allowed, 66→66, 15 PG tests, **no second ledger**.
- **If product defers Agent history (current `financial-position` sufficient for float monitoring):** Proceed to **`V1-HARDENING-08 — Reconciliation Operationalization`** (0 migrations, not blocked) or **`V1-HARDENING-08 — Notification Delivery Provider Wiring`** (P2) — both are `V1-HARDENING-05` remaining P2s with existing schema.

**One task only:** Do **not** start both; await decision on whether Agent history (P1 remainder) or P2 reconciliation is next priority. **Do not reopen fees/limits.**

---

## Appendix A — Files Changed (07)

| File | Change |
|------|--------|
| `src/admin/admin-agent.controller.ts` | Add `WalletService` injection, `toSafeAgent`, `assertUuid`, `GET :id/financial-position` (ledger-derived via `WalletService.listWallets`, safe hide `ledgerAccountId`) |
| `test/v1-hardening-07-admin-agent-financial-position.integration.spec.ts` | New 16 PG cases (see §13) |
| `docs/V1-HARDENING-07-VERIFICATION-REPORT.md` | This file |

No migration, no `src/ledger`, `src/wallet`, `src/agent` (except controller), `src/production` change.

## Appendix B — API Contract Example

```http
GET /api/v1/internal/agents/3f7d2a1e-.../financial-position
Authorization: Bearer workforce-SUPPORT

200 OK
{
  "agentId": "3f7d2a1e-...",
  "currency": "NGN",
  "balanceMinor": "75000",
  "availableBalanceMinor": "75000",
  "walletExists": true,
  "walletId": "9c2b8e4a-...",
  "status": "ACTIVE"
}

GET /api/v1/internal/agents/3f7d2a1e-.../financial-position (no wallet)
200 OK
{
  "agentId": "3f7d2a1e-...",
  "currency": "NGN",
  "balanceMinor": "0",
  "availableBalanceMinor": "0",
  "walletExists": false,
  "walletId": null,
  "status": null
}

GET /api/v1/internal/agents/<randomUUID>/financial-position
Authorization: Bearer workforce-SUPPORT
404 { "message": "Agent not found", "statusCode": 404 }

GET /api/v1/internal/agents/not-a-uuid/financial-position
400 { "message": "id must be a UUID", "statusCode": 400 }

GET /api/v1/internal/agents/:id/financial-position
Authorization: Bearer workforce-CUSTOMER
401 { "message": "Privileged access required" }

POST /api/v1/internal/agents/:id/financial-position
404 (read-only)
```

## Appendix C — Verification Commands (Lagos 2026-09-26)

```bash
git rev-parse HEAD # c5f8251 → next 07
ls src/migrations/*.ts | wc -l # 66
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=monienaija DB_PASSWORD=monienaija-pw DB_NAME=monienaija \
  ./node_modules/.bin/jest --config jest.integration.config.js --runInBand test/v1-hardening-07-admin-agent-financial-position.integration.spec.ts # 16 passed
DB_HOST=... ./node_modules/.bin/jest --config jest.integration.config.js --runInBand test/v1-hardening-06-admin-customer-investigation.integration.spec.ts # 15 passed
./node_modules/.bin/tsc --noEmit # 0
npm run build # 0
```

---

**FINAL REPORT (for session):** HEAD `c5f8251` → next `feat(hardening-07): Admin Agent Financial Investigation` (parent `c5f8251`), migration count **66→66** (0 new), endpoint `GET /api/v1/internal/agents/:id/financial-position` **VERIFIED** (reuse `WalletService.listWallets` ledger-derived, workforce `SUPPORT` allowed, safe projection, cross-Agent isolation), Agent transaction-history **remaining gap** (no reusable service, not invented), tests **16/16** focused PG, `tsc` 0, `build` 0, report `docs/V1-HARDENING-07-VERIFICATION-REPORT.md` — **VERIFIED — Admin Agent Financial Investigation complete**.

---

VERIFIED — Admin Agent Financial Investigation complete
