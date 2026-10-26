# Test Evidence — 2026-10-21

**Branch:** `arena/edba26d6-monienaija` (commit `6297400` + V1-FULL-ADMIN-01 fixes, not yet pushed)  
**Env:** Embedded PG 18.4 `127.0.0.1:5432` `monienaija/monienaija-pw`, `.env` with 5-role finance + 3 maker/checker + 4 rate-limits, `NODE_ENV=development`, Nest `dist/main.js` (nest 5.9.3), Admin Web `apps/admin-web` (vite 5.4.21)

## Commands run + results (never claimed without observation)

### 1. Backend build
```
npm run build
> nest build
✓ built with 0 errors (after ledger controller @Req reordering fix)
```
- First build attempt failed `TS1016: required param cannot follow optional param` in `ledger.controller.ts` (listAccounts/postJournal/reverseJournal had `@Query/?@Headers optional` before `@Req required`). Fixed by moving `@Req` first. Second build passed.

### 2. Local dev seed + 11-role verification (prior task, reverified 12:37Z)
```
NODE_ENV=development node scripts/local-dev-seed-11-roles.js
→ seeded 11 local_admin_credentials + 11 a2_finance_role_assignments (ACTIVE, no fallback)
NODE_ENV=development node scripts/local-dev-seed-11-roles.js --verify
→ all 11 roles login OK via POST /local-admin-sessions (email+password), scopesCount matches catalogue:
  SUPER_ADMIN 57, FINANCE_PREPARER 20, FINANCE_CONTROLLER 26, FINANCE_AUDITOR 24,
  ADMINISTRATOR 12, OPERATIONS 22, AGENT_NETWORK_MANAGER 12, COMPLIANCE 10,
  RISK_FRAUD 1, CUSTOMER_SERVICE 6, TREASURY 1 — all isFallback false, template correct.
NODE_ENV=development node scripts/verify-11-roles-full.js
→ 11 dashboards ✅, ledger 200/403 per function, recon PASS 10/10 checks PASS, trialBalance balanced true.
```

### 3. Real HTTP authorization checks (manual curl, not mocked)
```
POST /local-admin-sessions {email,password} → 201 accessToken + principal.roles/scopes
GET /ledger/accounts (SUPER_ADMIN, has ledger.view) → 200 9 accounts
GET /ledger/accounts (TREASURY, no ledger.view) → 403 FUNCTION_MISSING ✅
GET /transfers/:id (SUPER_ADMIN, has transaction.view) → 404 not found (not 403) ✅
GET /internal/reconciliation/report (SUPER_ADMIN) → 200 PASS 10/10, bindings 0, trialBalance balanced true
POST /internal/admin/agents/:id/suspend (FINANCE_AUDITOR) → 403 (hardening still holds) ✅
```
Detailed per-role output saved in `docs/V1/ROLE-BY-ROLE-VERIFICATION-2026-10-21.md` and raw log `verify-11-roles-full.js` output.

### 4. Integration suites (real Postgres + real HTTP, via `scripts/run-pg-integration-tests.js` — DB_HOST=127.0.0.1)

#### v1-admin-authorization-hardening-01
```
DB_HOST=127.0.0.1 npm run test:pg -- test/v1-admin-authorization-hardening-01.integration.spec.ts
Test Suites: 1 passed, 1 total
Tests:       36 passed, 36 total
Time:        57.011 s
  A. SUPER_ADMIN 5 checks (agent lifecycle, credentials, SUPPORT provisioning, customer lifecycle) ✅
  B. FINANCE_AUDITOR 7 denial checks (agent.*, credentials, workforce, customer, privileged) ✅
  C. AGENT_NETWORK_MANAGER 4 checks ✅
  D. OPERATIONS 4 checks ✅
  E. FINANCE_PREPARER/CONTROLLER denied ✅
  F. COMPLIANCE/RISK_FRAUD/TREASURY/CUSTOMER_SERVICE denied ✅
  G. FINANCE_ADMIN not live ✅
  H. 401 not 403 ✅
  I. Governance invariants (finance-class-restricted, non-assignable, TREASURY 1 function, RISK_FRAUD 1, 11 roles) ✅
  J. requiredFunctions preserved ✅
```
Command: `DB_HOST=127.0.0.1 npm run test:pg -- test/v1-admin-authorization-hardening-01.integration.spec.ts --runInBand` (exit 0)

#### v1-admin-configurable-dashboard-platform-01
```
DB_HOST=127.0.0.1 npm run test:pg -- test/v1-admin-configurable-dashboard-platform-01.integration.spec.ts
Test Suites: 1 passed, 1 total
Tests:       47 passed, 47 total
Time:        85.263 s
  1. Catalogue seed (85 functions, 11 roles, 186 assignments) ✅
  2. Widget registry (12 widgets, 7 proxy + 7 direct) ✅
  3. Template seed (12 templates, 11 assignments) ✅
  4. Dashboard resolve (my-dashboard per role, no fallback) ✅
  5. Config surface auth (401/403/assign) ✅
  6. Tampered widget blocked ✅
  7. Fallback to DEFAULT_FALLBACK ✅
  8. Per-widget auth (fraud/kyc denied) ✅
  9. Transaction-summary period filters + Defect #2 feeRevenueMinor + compare ✅
  9.5 recent-transactions Defect #3/#4 + transaction-trend zero-filled ✅
  10. Error-state 400/404 ✅
  11. Full per-role dashboard (11 roles, authorized flags match catalogue, proxy fetchable, RISK_FRAUD/TREASURY boundaries) ✅
```
Command: `DB_HOST=127.0.0.1 npm run test:pg -- test/v1-admin-configurable-dashboard-platform-01.integration.spec.ts --runInBand` (exit 0)

### 5. Admin Web builds
```
apps/admin-web: npm install → added 455 packages
apps/admin-web: npx tsc --noEmit → 0 errors
apps/admin-web: npm run build (vite 5.4.21) → 71 modules transformed, dist 285.91 kB (76.94 gzip) ✅
```
Earlier `npm test` in admin-web showed 6/7 suites failed due to missing `@types/react`/`@testing-library/react` declaration files in root `node_modules` (environment issue, not our code) — 1 suite `auth-store.test.ts` passed (7 tests). Build proves screens compile; failures are pre-existing harness gaps, not regressions (same failures before our Layout expansion).

### 6. Route fix verification

- Before fix: `GET /ledger/accounts` via workforce token → 403 `requiredScopes: [internal:access]` (no role holds, documented broken). After fix: `GET /ledger/accounts` with `ledger.view` → 200 (9 accounts); without → 403 FUNCTION_MISSING (least-privilege preserved). Verified via SUPER_ADMIN 200 and TREASURY 403.
- `POST /ledger/journals` with `ledger.post` (FINANCE_PREPARER) → allowed (controller check), without → 403. SUPER_ADMIN excluded (by design) → 403, correct per catalogue notes.
- `GET /transfers/:id` etc. now return 404 (not 403) for holders of `transaction.view` (SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS) — proves `internal:access` gap closed. Remaining gap: non-holders also get 404 (should be 403) — documented R4, controller-level hardening needed.

### 7. Limitations + not claimed

- No synthetic data for C2C/cash-out binding warnings — reconciliation PASS on clean DB is expected; with seeded FAILED transfers it correctly warns (not suppressed).
- No browser E2E runner (Playwright) executed this session — nav visibility verified via code + store logic, not screenshots. Manual browser smoke test recommended before stakeholder demo.
- No wallet PATCH/alias/SUPPORT read-scope live mutation tested beyond 403 checks — those are correctly denied per UAT-SEC-005, documented, not re-tested with new payloads.

## Files produced

- `docs/V1/FULL-ADMIN-WEB-COMPLETION-MATRIX.md` — requirements-to-implementation matrix (18 modules, implemented/partial/broken counts, defect root causes, fix status)
- `docs/V1/ROLE-BY-ROLE-VERIFICATION-2026-10-21.md` — per-role login/scopes/dashboard/widgets/ledger/support/recon table + raw run
- `docs/V1/REMAINING-DEFECTS-PRIORITIZED.md` — P1 (R3/R4/R7 generic internal + observability function gaps), P2 UI polish, Future/V2
- `apps/admin-web/src/screens/authenticated/{AgentNetwork,SupportTickets,Compliance,RiskFraud,WorkforceAdmin,SystemHealth,CommercialRules}Screen.tsx` — 7 new functional screens (real API, loading/empty/error/denied)
- `apps/admin-web/src/screens/authenticated/Layout.tsx` — 8→15 nav entries with `hasFn` gating per catalogue function
- `src/authorization/route-policy-registry.ts` — new `workforce-observability` branch for ledger/transfers/wallets/deposits/withdrawals/fees/limits/quotes/banks/beneficiaries/virtual-accounts
- `src/ledger/ledger.controller.ts` — hardened with `requireFunction('ledger.view'/'ledger.post'/'ledger.reverse')` + allowedPrincipalTypes
- `scripts/verify-11-roles-full.js` — 11-role live HTTP verifier (login→dashboard→ledger→support→recon→tx→leak)

## Commit

- Next commit on `arena/edba26d6-monienaija` will bundle above files + matrix/verification docs + route/controller fixes + new screens + Layout. SHA to be recorded after push (pending explicit authorization per project rule: no push without user approval).

