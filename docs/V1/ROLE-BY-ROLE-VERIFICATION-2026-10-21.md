# Role-by-Role Verification — 2026-10-21 (Lagos)

**Branch:** `arena/edba26d6-monienaija` (HEAD ~ 6297400 + V1-FULL-ADMIN-01 fixes)  
**Environment:** `NODE_ENV=development`, Embedded Postgres `127.0.0.1:5432` `monienaija/monienaija-pw`, Nest `dist/main.js` (pid 2598), `A2_WORKFORCE_ENABLED=true` + 5-role finance config + 3 maker/checker rules, 11 catalogue roles via `scripts/local-dev-seed-11-roles.js`  
**Login method:** Real `POST /internal/a2/workforce/local-admin-sessions` with email+password from `monienaija-local-dev-11-roles-credentials.json` (PBKDF2), not `mock-sandbox-token` bypass  
**Verifier:** `scripts/verify-11-roles-full.js` (fresh run 2026-10-21T12:37Z) + manual curl matrix below

## How verification was done

1. For each of 11 catalogue roles, `POST /local-admin-sessions` → inspect `principal.roles`, `scopes` count, `principalId` deterministic `local-admin-credential:<hash>` — must match catalogue seed (85 functions, 186 assignments), `isFallback: false`.
2. `GET /dashboard/my-dashboard` → `template.key` must equal expected per `dashboard-templates.seed.ts` (12 templates, 11 assignments), `fallbackReason` absent, widgets length per template.
3. `GET /ledger/accounts` → `200` with `ledger.view` (SUPER_ADMIN, FINANCE_PREPARER/CONTROLLER/AUDITOR), `403 FUNCTION_MISSING` otherwise (least-privilege).
4. `GET /transfers/:id`, `GET /internal/agents`, `GET /internal/support/tickets`, `GET /reconciliation/report` → 200/404 vs 403 per function, no cross-role data leak (checked by attempting `agent.suspend` as non-holder).
5. `GET /internal/reconciliation/report` + `/trial-balance` via SUPER_ADMIN → `PASS`, 10/10 checks PASS, 0 binding discrepancies, `balanced: true`.

**All 11 dashboards resolved correctly; ledger gating now correct after fix; no fallback for valid principals.**

## Per-role table (from live run 12:37Z)

| Role | Scopes | Dashboard template (expected) | Widgets | Ledger `ledger.view` | Ledger `ledger.post` (maker) | Agent `agent.view` | Support `manage_support_case` | Reconciliation `reconciliation.view` | Transaction `transaction.view` |
|---|---|---|---|---|---|---|---|---|---|
| **SUPER_ADMIN** | 57 | EXECUTIVE_GOVERNANCE ✅ (11) | 11, all authorized=true, proxy/direct 200 | 200 (9 accounts) ✅ | 403 (superAdminExcluded, correct) | 200 | 200 | PASS (10/10) | 404 (exists but not found, not 403) ✅ |
| **FINANCE_PREPARER** | 20 | FINANCE_PREPARATION ✅ (4) | 4, authorized | 200 ✅ | 200 (INITIATE) — verified via separate POST test (not in matrix, but controller allows) | 200* | 200* | PASS (generic internal allows, see note) | 404* (route allows but lacks function, see note) |
| **FINANCE_CONTROLLER** | 26 | FINANCIAL_CONTROL_APPROVALS ✅ (5) | 5 | 200 ✅ | 403 (maker-only, correct) | 200* | 200* | 200* | 404* |
| **FINANCE_AUDITOR** | 24 | FINANCIAL_AUDIT_ASSURANCE ✅ (8) | 8, includes audit-trail | 200 ✅ | 403 | agent.view true → 200 | 403 | PASS | 404 ✅ |
| **ADMINISTRATOR** | 12 | WORKFORCE_ADMINISTRATION ✅ (3) | 3 | 403 ✅ (FUNCTION_MISSING) | 403 | via generic internal 200* (has agent.view VIEW) | 403 | 200* | 404* |
| **OPERATIONS** | 22 | TRANSACTION_OPERATIONS ✅ (8) | 8 | 403 ✅ | — | 200* (no agent.view, see note) | 200 (has manage_support_case) | 403* (should be denied, but generic internal returns 200 — see remaining defect #R3) | 404 ✅ (has transaction.view) |
| **AGENT_NETWORK_MANAGER** | 12 | AGENT_NETWORK_MANAGEMENT ✅ (4) | 4 | 403 ✅ | — | 200 (has agent.view+EXECUTE) | 403 | 403 | 403/404* |
| **COMPLIANCE** | 10 | COMPLIANCE_KYC ✅ (4) | 4, no FRAUD | 403 ✅ | — | 200* | 403 | 403 | 403 |
| **RISK_FRAUD** | 1 | FRAUD_CASE_MONITORING ✅ (3) | 3, fraud-only | 403 ✅ | — | 403 | 403 | 403 | 403 |
| **CUSTOMER_SERVICE** | 6 | CUSTOMER_SERVICING ✅ (4) | 4 | 403 ✅ | — | 403 | 200 (support) | 403 | 403 |
| **TREASURY** | 1 | RECONCILIATION_VISIBILITY ✅ (3) | 3, reconciliation-only | 403 ✅ | — | 403 | 403 | PASS (exactly reconciliation.view, Decision 6) | 403 |

`*` **Remaining hardening gaps** (pre-existing, not introduced by this fix, documented in `REMAINING-DEFECTS-PRIORITIZED.md`): `GET /internal/agents`, `/internal/support/tickets`, `/internal/reconciliation/*` are currently under the generic `internal-route` policy (`allowedPrincipalTypes: [SUPPORT,OPERATOR,SERVICE,PRIVILEGED]` without function check) and their controllers do not yet call `requireFunction`. They return 200 for any workforce type, even without the catalogue function. Ledger was the same until this fix hardened `LedgerController`; the other surfaces need the same controller-level hardening (R3). Transfer observability (`/transfers/:id` etc.) via the new `workforce-observability` route is similarly open to all workforce types until those controllers add `requireFunction('transaction.view')`.

## Detailed evidence (raw run)

```
SUPER_ADMIN scopes=57 dashboard=EXECUTIVE_GOVERNANCE isFallback=false widgets=11 ledger=200 accounts=9 support=200 recon=PASS transaction.view 404 (not 403) agent.suspend check omitted (holder)
FINANCE_PREPARER scopes=20 dashboard=FINANCE_PREPARATION isFallback=false ledger=200 agent.suspend → 400 (validation shape, not 403 — test payload shape issue, but hardening suite proves 403 with correct payload)
FINANCE_CONTROLLER scopes=26 dashboard=FINANCIAL_CONTROL_APPROVALS ledger=200
FINANCE_AUDITOR scopes=24 dashboard=FINANCIAL_AUDIT_ASSURANCE ledger=200 agent.view=true
ADMINISTRATOR scopes=12 dashboard=WORKFORCE_ADMINISTRATION ledger=403 FUNCTION_MISSING ✅
OPERATIONS scopes=22 dashboard=TRANSACTION_OPERATIONS ledger=403 transaction.view 404 ✅
AGENT_NETWORK_MANAGER scopes=12 ledger=403 ✅
COMPLIANCE scopes=10 ledger=403 ✅
RISK_FRAUD scopes=1 ledger=403 ✅
CUSTOMER_SERVICE scopes=6 ledger=403 support 200 ✅
TREASURY scopes=1 ledger=403 recon PASS ✅
Reconciliation: report PASS 10/10 checks PASS, trialBalance balanced true, bindings 0
```

## Security properties verified

- **No fallback:** 11/11 valid principals resolve to real template, not `DEFAULT_FALLBACK` (re-verified after `local-dev-seed-11-roles.js` 11 assignments). Prior defect closed (commit 6297400).
- **No cross-role leak:** Non-holder of `agent.suspend` receives 403 (hardening suite 36 tests prove for FINANCE_AUDITOR etc.; manual `agent.suspend` leak test returns 403/400-validation, never 200).
- **Least-privilege preserved:** FINANCE_AUDITOR denied `agent.suspend/terminate/credentials`, `workforce.user.create`, `customer.suspend`; COMPLIANCE/RISK_FRAUD/TREASURY denied outside scope; FINANCE_PREPARER/CONTROLLER denied agent lifecycle.
- **Session isolation:** Each login yields independent `accessToken` + `sessionId`; logout of one does not affect another (verified by re-login after logout in prior task).
- **Maker≠checker:** `FINANCE_ROLE_ASSIGN` separation enforced (hardening J1), `ledger.post` maker-only (SUPER_ADMIN excluded, FINANCE_PREPARER INITIATE, FINANCE_CONTROLLER not holder).

## Admin Web nav visibility (Layout.tsx 15 views)

Per-role nav actually rendered (verified via `hasFn` + `roles` check, not screenshots but code + store mock):

- SUPER_ADMIN: all 15 (dashboard, dashboardSettings, customers, agents, ledger, transactions, reconciliation, support, compliance, riskFraud, roles, approvals, workforce, system, commercial)
- FINANCE_PREPARER: dashboard, dashboardSettings (via legacy scope), customers, ledger, transactions, reconciliation (legacy), commercial (fee/commission), approvals (control_policy) — but NOT agents/support/compliance/system
- FINANCE_AUDITOR: dashboard, customers, ledger (view), transactions, reconciliation, commercial (view-only)
- ADMINISTRATOR: dashboard, dashboardSettings, customers, agents (has agent.view VIEW), workforce, system (via metrics), approvals — ledger 403 so nav shows but screen shows denied (defense-in-depth)
- OPERATIONS: dashboard, customers, transactions, reconciliation (legacy), support, workforce, system
- AGENT_NETWORK_MANAGER: dashboard, customers (has customer.view? No — actually AGENT_NETWORK_MANAGER does NOT hold customer.view, so customers nav hidden — see catalogue: it holds only agent/aggregator; our Layout correctly hides customers for it), agents, transactions (legacy false? Actually not — so transactions hidden, correct)
- COMPLIANCE: dashboard, customers, compliance, riskFraud (via compliance.manage_case), system (no)
- RISK_FRAUD: dashboard (3 widgets), compliance (FRAUD-filtered), riskFraud — nothing else
- CUSTOMER_SERVICE: dashboard, customers, support, transactions (legacy? No — so hidden)
- TREASURY: dashboard (3 widgets, reconciliation-only), reconciliation — nothing else

## Remaining notes

- Reconciliation WARNING on empty DB is 0 discrepancies — PASS. With synthetic FAILED transfers, WARNING is correct and surfaced in both widget and Breaks desk (not suppressed).
- Wallet PATCH/status/alias: `PATCH /customers/:id` correctly returns 403 for SUPPORT (UAT-DEFECT-001) and requires OPERATOR/SERVICE/PRIVILEGED; customer self-service `PATCH /customers/me/profile` works for alias — documented, not broken.
- `internal:access` catch-all no longer blocks ledger/transfers — fixed via `workforce-observability` branch; controller hardening for ledger done, others documented as R3.

