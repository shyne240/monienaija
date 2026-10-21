# Remaining Defects — Prioritized (after P1 hardening 2026-10-21 13:23 UTC)

**Baseline:** `arena/edba26d6-monienaija` with ledger route fix + 7 new Admin Web screens + Layout 8→15 + P1 controller hardening  
**Method:** Each defect traced to code (route → controller → service → DB), classification per `V1-SCOPE-CHALLENGE-01` (P0 blocks V1 acceptance, P1 gaps that still allow V1 workflows via other surfaces, P2/Future explicitly out of V1 scope). No invented requirements — every gap mapped to `authorization-catalogue.seed.ts` + `route-policy-registry`.

## P0 — None (V1 acceptance not blocked)

All V1-required administrative workflows now have a reachable backend route + functional Admin Web screen + authorization gate at both route + controller layer. Previously BROKEN modules (Ledger, Transaction observability) unblocked, dashboard fallback defect closed, and P1 least-privilege gap closed (see below).

## P1 — FIXED (2026-10-21) — controller-level function checks added

### R3, R4, R7 — Generic internal + workforce-observability surfaces now enforce catalogue functions

- **Was:** `GET /internal/agents`, `/internal/customers`, `/internal/support/tickets`, `/internal/reconciliation/*`, `/transfers/:id`, `/deposits/:id`, `/internal/fee-rules`, `/internal/commission-rules`, `/internal/limit-profiles` etc. returned 200 for any WORKFORCE_SESSION even without catalogue function. Example: FINANCE_PREPARER (no `agent.view`) could list agents; OPERATIONS (no `ledger.view`) was blocked only on Ledger because it was the sole hardened example.
- **Root cause:** `route-policy-registry` generic `internal-route` + `workforce-observability` branches allow `allowedPrincipalTypes: [SUPPORT,OPERATOR,SERVICE,PRIVILEGED]` without `requiredScopes`. Controllers only checked `requireWorkforce(req)` (type check), not `requireFunction`.
- **Fix (this task — 2026-10-21 13:23 UTC):** 11 → 14 controllers now call `AuthorizationService.requireFunction` with `isWorkforce` guard (workforce principals must hold function, customer/agent principals bypass via self-access branch):
  - `AdminAgentController` → `agent.view` (GET list/get, financial-position; OPERATOR/SERVICE/PRIVILEGED)
  - `AdminCustomerController` → `customer.view` / `view_transactions` / `view_wallets` / `manage_support_case` per endpoint (SUPPORT/OPERATOR/SERVICE/PRIVILEGED, wallet balance same)
  - `SupportInternalController` → `customer.manage_support_case` (GET list, PATCH status, GET ticket)
  - `ReconciliationController` → `reconciliation.view` (report, trial-balance, breaks, run)
  - `Transfer/Deposit/Withdrawal/WalletTransactionController` → `transaction.view`
  - `WalletController` → `customer.view_wallets`
  - `LedgerController` → `ledger.view` (already hardened, kept)
  - `FeeRuleRegistryController` → `fee_rule.view` (GET) / `fee_rule.create` (POST) / `fee_rule.modify` (PATCH)
  - `CommissionRuleRegistryController` → `commission_rule.view|create|modify`
  - `LimitCatalogController` → `limit.view` / `limit.modify`
  - Fee engine `FeeController` + `LimitController` (`/fees/calculate`, `/limits/evaluate`) reverted to unrestricted (not catalogue-registered; they are workforce-observability reads that take principal-only input, not registry definitions — restricting them by `fee_rule.view` was incorrect and broke OPERATIONS which legitimately uses them for ops tracing; registry endpoints are the correct catalogue surface).
- **DI fix:** Added `forwardRef(() => AuthorizationModule)` to `FeeRulesModule`, `CommissionModule`, `LimitCatalogModule`, plus prior 6 modules (`FeeModule`, `LimitModule`, `DepositModule`, `WithdrawalModule`, `ReconciliationModule`, `SupportModule`) to avoid circular `App→Agent→Operations→Authorization→CustomerAuthentication→Operations` UndefinedModuleException. Verified build `nest build` 0 errors (24.7s) and `Nest application successfully started` on 0.0.0.0:3000 (PID 4433, health `{"status":"ok"}`).
- **Tests:** Created `test/v1-admin-p1-authorization-hardening.integration.spec.ts` (16 tests, real PG + real HTTP, `truncateAllTables` beforeEach, 11-role tokens via `A2WorkforceSessionService.establish` + `A2FinanceRoleAssignment` with `assignmentVersion:1`, `fakeCustomerId/WalletId/TransferId` for 404-vs-403):
  - A. agent.view list (SUPER_ADMIN/AGENT_NETWORK_MANAGER/FINANCE_AUDITOR/ADMINISTRATOR 200 vs FINANCE_PREPARER/OPERATIONS denied 403)
  - B. customer.view / view_transactions / view_wallets / manage_support_case (per-function matrices)
  - C. support tickets list + write
  - D. reconciliation.view report + trial-balance (SUPER_ADMIN/FINANCE_AUDITOR/TREASURY 200 vs others 403)
  - E. transaction.view (transfers/deposits/withdrawals GET), wallets, fee-rules registry (fee_rule.view), commission-rules registry (commission_rule.view), limit catalogue (limit.view) — each with allowed vs denied matrices matching `authorization-catalogue.seed.ts` (e.g., fee_rule.view: SUPER_ADMIN/FINANCE_PREPARER/CONTROLLER/AUDITOR 200 vs OPERATIONS/AGENT_NETWORK_MANAGER denied 403; limit.view: +AGENT_NETWORK_MANAGER allowed)
  - F. ledger.view (SUPER_ADMIN/FINANCE_* 200 vs others 403)
  - Result: `DB_HOST=127.0.0.1 npm run test:pg -- v1-admin-p1-authorization-hardening` → 16/16 PASS (29.4s). No cross-role leak (every denied role gets 403, every allowed gets 200/404, read-only FINANCE_AUDITOR denied on unsafe POST via `denyUnsafeMethodForReadOnlyPrincipal`).

## P2 — Nice to have (UI completeness, not functional block)

### R8. Customer Directory PII tabs hidden
- Backend `GET /customers/:id/addresses`, `/contact-methods`, `/identity-documents`, `/kyc` exists, but `CustomerDirectoryScreen` shows only wallets/KYC/status, not full PII tabs.
- Fix: Add tabs to detail drawer gated by `customer.view_address` etc. ~half day.

### R9. Compliance/Risk screens require manual UUID entry
- Link from CustomerDirectory drawer with customerId prop. ~2h.

### R10. Commercial Rules is read-only
- Fee/commission/reward/product/limit registries have maker/checker (PREPARER INITIATE, CONTROLLER APPROVE). Screen shows definitions but no propose/approve buttons.
- Fix: Add proposal flows gated by `fee_rule.create` INITIATE vs APPROVE. ~1 day.

## Future / V2 (correctly out of V1, not defects)

- F1 Aggregator login / scoped financial position (Decision 8)
- F2 Reconciliation-break resolver workflow (Decision 3)
- F3 Operations reversal workflow (Decision 4)
- F4 Commission settlement payout rail / external bank/NIBSS (V2)
- F5 Per-agent granular permissions, audit export, two-step KYC review

## Verification of remaining items (not suppressed)

- Reconciliation WARNINGs for `failed_transfer_attempts` and `customer_financial_account_binding_integrity` correctly surfaced (not suppressed).
- `PATCH /customers/:id` 403 for SUPPORT correct (UAT-DEFECT-001), alias via PATCH /customers/me/profile works.
- `internal:access` no longer blocks ledger/transfers; fine-grained denial now at controller layer, not hidden.
- Wallet PATCH status/alias, C2C, cash-out, internal:access ownership documented as synthetic-data-only gaps, not reintroduced.
