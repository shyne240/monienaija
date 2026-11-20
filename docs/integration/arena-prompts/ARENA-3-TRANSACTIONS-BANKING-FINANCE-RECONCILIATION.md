# ARENA 3 — Transactions, Banking, Finance & Reconciliation (Commercial)

**Copy-ready implementation prompt — paste into Arena 3 branch session**
**Author:** Arena 5 (integration/architecture) · **Date:** 2026-11-20
**Baseline:** `arena/1f37a4f3-monienaija @ 98b067bc` (→ `arena/5-main-web-audit` integration branch) · 166 migrations
**Frozen predecessors:** `arena/defdd0fd-monienaija`, `arena/bcf44621-monienaija`, `main` — never mutate.
**Financial engine:** **Preserved and central to your Arena** — you work *around* it, not through it. `src/ledger`, `src/reconciliation`, `src/commercial-accounting`, `src/banking`, `src/transfer` double-entry/balance logic is frozen unless Arena 5 approves a demonstrated defect with reproduction + regression.

---

## 1) Mission

Own **transactions observability + cash-to-cash ops + ledger & reversals + reconciliation + banking operations + commercial rules (fees/commissions/rewards/products) + limit catalogue**. Make PARTIAL→COMPLETE, PLACEHOLDER→governed-notice-or-wired. This is the highest financial-safety scope — every mutation is proposal→checker.

---

## 2) Scope — menu/routes

| Section | View key | Label | Guard | Baseline |
|---|---|---|---|---|
| Transactions | `transfers` | Transfers | `transaction.view` | PARTIAL (observability) |
| Transactions | `cashIn` | Deposits | `transaction.view` | PLACEHOLDER (alias of transfers) |
| Transactions | `cashOut` | Withdrawals | `transaction.view` | PLACEHOLDER (alias) |
| Transactions | `cashToCashOps` | Cash to cash | `transaction.view` | COMPLETE |
| Finance | `ledgerExplorer` | Ledger & reversals | `ledger.view` | PARTIAL |
| Finance | `reconciliation` | Reconciliation | `reconciliation.view` | PARTIAL |
| Finance | `bankingOperations` | Banking operations | `reconciliation.view` | PARTIAL |
| Pricing | `feeRules` | Fee rules | `fee_rule.view` | PARTIAL |
| Pricing | `commissionRules` | Commission rules | `commission_rule.view` | PARTIAL |
| Pricing | `rewardRules` | Reward rules | `reward_rule.view` | PLACEHOLDER |
| Pricing | `productCatalogue` | Products | `product.view` | PLACEHOLDER |
| Pricing | `limitCatalogue` | Limit catalogue | `limit.view` | COMPLETE |

`cashIn`/`cashOut` are intentionally aliases (admin observes; customer/agent apps initiate). Your job: keep them honest filter aliases or add governed-notice, not duplicate transaction screens.

---

## 3) Files you own

```
apps/admin-web/src/screens/authenticated/TransactionObservabilityScreen.tsx       # 1129
apps/admin-web/src/screens/authenticated/CashToCashOperationsScreen.tsx         # 1081
apps/admin-web/src/screens/authenticated/LedgerOperationsScreen.tsx             # 1251
apps/admin-web/src/screens/authenticated/ReconciliationObservabilityScreen.tsx   # 1327
apps/admin-web/src/screens/authenticated/BankingOperationsScreen.tsx            # 413
apps/admin-web/src/screens/authenticated/CommercialRulesScreen.tsx              # 581 — all tabs
apps/admin-web/__tests__/a3-*.test.tsx
```

Services:

```
apps/admin-web/src/services/banking-admin-api.ts   # owned — readiness, reconciliation, banking ops
```

Backend modules (frontend-first; backend change only with Arena 5 approval):

`src/ledger`, `src/transfer`, `src/banking`, `src/bank` (read), `src/virtual-account`, `src/reconciliation`, `src/fee`, `src/fee-rules`, `src/commission`, `src/reward`, `src/product-catalog`, `src/product-governance`, `src/commercial-accounting`, `src/commercial-decision`, `src/limit`, `src/limit-catalog`

---

## 4) Prohibited — never edit in Arena 3 PRs without Arena 5

```
apps/admin-web/src/screens/authenticated/Layout.tsx
apps/admin-web/src/screens/authenticated/navigation-access.ts
apps/admin-web/src/services/api-client.ts
apps/admin-web/src/store/auth-store.ts
apps/admin-web/src/config/*
apps/admin-web/src/design-system/tokens.css
apps/admin-web/src/screens/authenticated/Customer*.tsx
apps/admin-web/src/screens/authenticated/AgentNetworkScreen.tsx
apps/admin-web/src/screens/authenticated/NotificationManagementScreen.tsx
# Financial core — read-only unless defect proven:
src/ledger/**  (double-entry, balance invariants)
src/reconciliation/**  (run engine, matching rules)
src/commercial-accounting/** (posting, accrual)
src/banking/** (NIP provider adapters, partner callbacks)
src/transfer/** (money-movement state machine)
```

If you must fix a defect in those, open an issue with reproduction + current-vs-expected + invariant violated → Arena 5 approves before you branch.

---

## 5) Backend requirements — endpoints (all exist)

| Need | Endpoint | Module |
|---|---|---|
| Transactions (observability) | `GET internal/financial-context/transactions?type=TRANSFER\|DEPOSIT\|WITHDRAWAL`, `GET transfer/:id`, `GET transfers` | `transfer`, `financial-context` |
| Cash-to-cash ops | `GET internal/admin/cash-to-cash/*`, `GET agents/cash-to-cash` | `agent/cash-to-cash*` |
| Ledger | `GET ledger/entries`, `GET ledger/journals/:id`, `GET internal/ledger/*`, `POST ledger/reversals` (via proposal) | `ledger`, `commercial-accounting` |
| Reconciliation | `GET internal/reconciliation/runs`, `GET internal/reconciliation/exceptions`, `POST internal/reconciliation/exceptions/:id/resolve` (proposal) | `reconciliation`, `banking` |
| Banking ops | `GET internal/banking/providers?institutionId=`, `GET internal/banking/provider-status`, `GET internal/banking/reconciliation/runs` | `banking` |
| Fees/commissions | `GET fee-rules/*`, `POST fee-rules/*` (proposal), `GET commission/*` | `fee`, `fee-rules`, `commission` |
| Rewards/products | `GET reward/*`, `GET product-catalog/*` (deferred — exists, not wired) | `reward`, `product-catalog` |
| Product governance | `GET internal/product-governance:*`, `POST internal/product-governance:propose` | `product-governance` |
| Limits catalogue | `GET limit-catalog/*`, `GET limits/catalogue` | `limit`, `limit-catalog` |

Maker→checker: fee/commission/reward activation, limit publication, ledger reversal, reconciliation resolution are **proposals** → `FINANCE_CONTROLLER` checker in Arena 4's `approvalsInbox`.

---

## 6) Acceptance criteria

- [ ] **Transactions:** Type-filtered (TRANSFER/DEPOSIT/WITHDRAWAL) real list from `internal/financial-context`; search by reference/customer/amount/date, pagination, detail drawer shows ledger entry linkage; contextual `onBackToCustomer` when `navContext.customerId` present. No fabricated maker — observability is correct scope.
- [ ] **cashIn/cashOut aliases:** Remain filter views of same screen; do not duplicate logic. Add governed-notice badge if you keep as placeholder ("Admin observes; funding initiated via customer/agent channel").
- [ ] **Cash-to-cash ops:** Read-only ops view accurate (expiry, claim, handoff, recovery); no financial mutation from this screen — correct.
- [ ] **Ledger explorer:** Browse journal/entries with real pagination, balance display (no invented balance), reversal **draft creation** (validate debit=credit, reference exists) and submit as proposal → visible in `approvalsInbox` (Arena 4). Reversal execution itself is checker-only — your screen does not execute without approval.
- [ ] **Reconciliation:** Runs + exceptions with real pagination/filters; assign, comment, escalate; manual resolve action (MATCHED/ACCEPTED_DIFFERENCE/ESCALATED) via proposal where backend supports it. No silent exception dismissal.
- [ ] **Banking operations:** Per-institution, per-provider 7-state readiness (`IMPLEMENTED_NOT_APPROVED`→`OPERATIONAL_BUT_ENTITLEMENT_UNCONFIRMED`) with correct `usable` semantics; no global "banking is up" badge (per-institution scope is intentional). No live NIP trigger — read-only readiness is correct. Add exception triage linkage if available.
- [ ] **Fee/commission rules:** Rule CRUD (list/create/edit) via `product-governance` with versioning; activation/version-publish requires checker approval. Fee tab separated from commission — no cross-rule mutation.
- [ ] **Reward/product catalogue:** Either wire CRUD (list/create/edit) to `reward`/`product-catalog` when endpoints are ready, or keep governed placeholder tab with notice ("Governance notice — catalogue pending wiring") — not broken, not faked data.
- [ ] **Limit catalogue:** Browse real `limit-catalog` with search/type filters; link to `limitAssignments` (Arena 1) assignment flow.
- [ ] **Guards:** `transaction.view`, `ledger.view`, `reconciliation.view`, `fee_rule.view`, `commission_rule.view`, `reward_rule.view`, `product.view`, `limit.view` all enforce nav + screen. `menu-visibility-11-roles` coverage for your views.
- [ ] **Financial invariants never violated:** No client-side `amountMinor` arithmetic altering balance; no double-entry bypass; all writes proposal-gated; idempotency on POST.
- [ ] **Design/API hygiene:** `ApiClient` only; `Guarded` banner on guard fail; `WorkspaceDrawer` for detail; loading/empty/error per screen.
- [ ] **Tests:** `__tests__/a3-transactions-finance.test.tsx` — guards, transaction pagination/filter, ledger browse + reversal draft, reconciliation actions, banking readiness, fee/commission CRUD; all `apps/admin-web` tests pass.
- [ ] **Handoff:** PR lists files | routes | endpoints | guards | tests | evidence | regression. Evidence includes ledger reversal proposal → approval round-trip screenshot/log.

---

## 7) Branch & integration

- **Branch from:** `arena/5-main-web-audit` → `arena/5-a3-transactions-finance`.
- **PR into:** `arena/5-main-web-integration`.
- **Coordination:** You consume customer context from Arena 1 (`navContext.customerId`); your proposals are approved in Arena 4's inbox; your limit catalogue is consumed by Arena 1's assignments — contract via Arena 5. After Arenas 1+2 (customer/agent context) is ideal start.
- **Handoff format:** `files | routes | endpoints | guards | tests | evidence | regression`.

---

## 8) Start commands

```bash
git fetch origin
git checkout arena/5-main-web-audit
git checkout -b arena/5-a3-transactions-finance
# implement, then:
npm run --prefix apps/admin-web test -- --watchAll=false
# verify financial engine untouched:
git diff --name-only origin/arena/5-main-web-audit | grep -E "src/(ledger|reconciliation|commercial-accounting|banking)/" && echo "BLOCKED — get Arena 5 approval" || echo "OK"
gh pr create --base arena/5-main-web-integration --title "Arena 3: transactions/finance — COMPLETE" --body "See criteria"
```
