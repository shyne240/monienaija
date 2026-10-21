# Admin Web — Frontend Test Failure Tracker

**Status:** Tracked — not fixed in current design-only phase  
**Scope:** `apps/admin-web` Jest suite  
**Proposal companion:** [`ADMIN-INFORMATION-ARCHITECTURE-PROPOSAL.md` §8](./ADMIN-INFORMATION-ARCHITECTURE-PROPOSAL.md#8-appendix--six-frontend-test-failures-separate-tracked-follow-up)  
**Branch:** `arena/edba26d6-monienaija`  
**Date created:** 2026-10-21 (Revision 2 correction — resolves broken-reference finding before implementation approval)  
**Last verified run:** `npm --prefix apps/admin-web test` → 51 passed / 6 failed (8 suites; 2 suites red)  
**Backend authorization:** Unaffected — every backend route remains `403` for unauthorised roles. Failures below are render/mock mismatches in the web client only.

> **Constraint:** Do not fix these tests by granting every role, hard-coding a privileged role, or weakening backend guards. Fixes are limited to test harnesses (`getByText` literals, `mockResolvedValueOnce` chains, principals, payload shapes). This file exists solely so the broken reference in the Revision 2 proposal is no longer dangling. The authoritative summary remains in the proposal §8; this tracker is the detailed companion.

---

## 1. Inventory — six failing tests (all in `apps/admin-web`)

| # | Suite file | Test name(s) | Jest message | Classification |
|---|---|---|---|---|
| 1 | `apps/admin-web/__tests__/customer-servicing.test.tsx` | `should submit customer registration payload on form submit` | `Unable to find an element with the text: ➕ Register Customer` | Button-label drift |
| 2 | `apps/admin-web/__tests__/customer-servicing.test.tsx` | `should load details, submit KYC assessment, and provision an NGN kobo wallet` | `Unable to find an element with the placeholder text of: e.g. Identity documents successfully verified` | Placeholder drift + mock-chain offset |
| 3 | `apps/admin-web/__tests__/customer-servicing.test.tsx` | `should submit status lock updates when suspend button is clicked` | `Unable to find an element with the text: SUSPEND` | Label casing + principal scope |
| 4 | `apps/admin-web/__tests__/ledger-operations.test.tsx` | `should load ledger accounts list and format balance correctly` + `should search journal ID and display double-entry lines` (2 tests) | `ApiClient.get is not a function` / empty list — mock chain off-by-one | Missing dashboard mount fetch stub |
| 5 | `apps/admin-web/__tests__/ledger-operations.test.tsx` | `should submit controller direct journal reversal override on click` + `should submit preparer approval maker request` (2 tests, counted as one entry in proposal §8) | Same as #4 plus `POST /ledger/journals/:id/reverse` payload expects `approvalId` | Payload shape drift (see #4) |
| 6 | `apps/admin-web/__tests__/transaction-observability.test.tsx` | `should run fee simulator calculations and display gross output` | `Unable to find fee simulator display` / `ApiClient.post` payload mismatch | Engine response shape drift (`gross` → `feeMinor`/`vatMinor`) |

**Counts:** 3 suites green / 8, 51/57 tests green. Ledger failures account for 4 of the 6 red tests; customer-servicing accounts for 3 (one entry merges two ledger tests — see row #5).

---

## 2. Root cause per failure

### #1 — Register Customer button label
- **Screen:** `apps/admin-web/src/screens/authenticated/CustomerDirectoryScreen.tsx` (replaces old simple `POST /customers` form).
- **What changed:** Button now renders as `Register Customer` (no emoji prefix) or `➕ New Customer` in drawer header, depending on layout breakpoint. Test still does `getByText('➕ Register Customer')`.
- **Why not a regression:** API `POST /customers` + `POST /customers/:id/wallets` still works for `OPERATIONS`/`SUPER_ADMIN`; only the literal differs.
- **Fix:** Update harnesses to `getByRole('button', { name: /Register Customer/i })` or `getByText(/New Customer/i)` matching live `CustomerDirectoryScreen`.

### #2 — KYC reason placeholder
- **Screen:** `CustomerDirectoryScreen` KYC tab.
- **What changed:** Placeholder is now `Reason (optional)` / `Provide context` (per PII redesign), not `e.g. Identity documents successfully verified`.
- **Secondary:** This test also fails if the `mockResolvedValueOnce` chain does not include the dashboard mount fetch (see #4) — it will return the wrong fixture before reaching the KYC step.
- **Fix:** Align `getByPlaceholderText` to current placeholder; prepend `DASHBOARD_FETCH_STUB` to mock chain (see §3 step 2).

### #3 — Suspend label / principal
- **Screen:** `CustomerDirectoryScreen` detail drawer → status lock.
- **What changed:** Label is `Suspend` / `Suspend Customer` (title case), not `SUSPEND`. Button is also disabled unless principal has `customer.suspend`.
- **Test principal:** Currently `FINANCE_PREPARER` (no `customer.suspend`); correct is `OPERATIONS` or `SUPER_ADMIN`.
- **Fix:** Use case-insensitive query `getByText(/Suspend/i)` + set principal to `OPERATIONS`; include `actor` in `PATCH /customers/:id` mock payload.

### #4 — Ledger `mockResolvedValueOnce` off-by-one
- **Suites:** `ledger-operations.test.tsx` — first two tests.
- **What changed:** `DashboardScreen` now mounts with an initial `GET /dashboard/my-dashboard` (`V1-ADMIN-CONFIGURABLE-DASHBOARD-PLATFORM-01`). No test was updated to include this fetch, so the `mockResolvedValueOnce` queue is shifted by one: `GET /ledger/accounts` receives the dashboard stub instead of ledger data → empty list / `ApiClient.get is not a function` when the stub shape lacks the method.
- **Fix:** Prefix every `mockResolvedValueOnce` chain with a `DASHBOARD_FETCH_STUB`: `{ templateKey: 'DEFAULT_FALLBACK', widgets: [] }` or the mock returned by `DashboardWidgetDataService.getMyDashboard`. Also set principal to `SUPER_ADMIN` with `ledger.view` so `Layout` renders the Ledger menu.

### #5 — Ledger reversal / maker request payload
- **Suites:** Same file — last two tests.
- **What changed:** Same off-by-one as #4, plus `POST /ledger/journals/:id/reverse` now requires `approvalId` when `finance.control_policy.activate` is present (maker/checker flow). Test posts without it.
- **Fix:** Apply #4 fix first, then update `ApiClient.post` mock to include `approvalId` in the expected body.

### #6 — Fee simulator gross vs feeMinor
- **Suites:** `transaction-observability.test.tsx` — fee simulator test.
- **What changed:** `FeeController` (`B1-Fee-Engine`) now returns `{ feeMinor, vatMinor }` (foundation-only `FeeEngine.calculate`), not `{ gross: ... }`. Screen renders `feeMinor`.
- **Fix:** Update `ApiClient.post` mock for `POST /fees/calculate` to return `{ feeMinor: '100', vatMinor: '0' }` and assert via `getByText(/feeMinor/i)` or the formatted minor value shown by `TransactionObservabilityScreen`.

---

## 3. Fix plan (documentation-only — separate PR, not this branch)

**Constraint reminder:** No backend change, no menu change, no grant-every-role workaround. All fixes are test-harness only.

1. **Principal alignment** — For each failing test, set `useAuthStore.setState` to a role that actually holds the menu's catalogue function (per `authorization-catalogue.seed.ts`):
   - customer-servicing → `OPERATIONS` (`customer.view` + `customer.suspend` + `kyc.view`) or `SUPER_ADMIN`
   - ledger-operations → `SUPER_ADMIN` (`ledger.view`)
   - transaction-observability → `FINANCE_AUDITOR` or `SUPER_ADMIN` (`fee_rule.view` + `transaction.view`)
2. **Dashboard stub prefix** — Prepend `DASHBOARD_FETCH_STUB` (`GET /dashboard/my-dashboard`) to every `mockResolvedValueOnce` chain so the initial dashboard mount does not consume a domain fixture.
3. **Literal alignment** — Update `getByText` / `getByPlaceholderText` literals to the strings actually rendered by `src/screens/authenticated/*.tsx` (check live labels: `Register Customer`, `Reason (optional)`, `Suspend`, `feeMinor`).
4. **Payload shape** — Update `ApiClient.post` / `patch` expected bodies to current DTOs (`actor`, `approvalId`, `feeMinor`/`vatMinor` vs `gross`, version for optimistic locking where present).
5. **Verification** — Re-run:
   ```bash
   npm --prefix apps/admin-web run build
   npx jest --prefix apps/admin-web --passWithNoTests
   ```
   **Expected:** 8 suites PASS, 57/57 tests PASS, `menu-visibility-11-roles.test.tsx` still 23/23 PASS.

---

## 4. Verification that referenced files exist on this branch

| Referenced as "newly created" in Revision 2 | Exists on `arena/edba26d6-monienaija` at this commit? | Location |
|---|---|---|
| `docs/V1/ADMIN-WEB-TEST-FAILURE-TRACKER.md` (this file) | **Yes** — created in this correction commit | `docs/V1/ADMIN-WEB-TEST-FAILURE-TRACKER.md` |
| `docs/V1/ADMIN-INFORMATION-ARCHITECTURE-PROPOSAL.md` (updated, not new) | Yes | `docs/V1/ADMIN-INFORMATION-ARCHITECTURE-PROPOSAL.md` (415 lines, Revision 2 + correction) |

No other files were claimed as newly created in Revision 2. The pre-existing Verification Matrix (`docs/V1/FULL-ADMIN-WEB-COMPLETION-MATRIX.md`, `MENU-VERIFICATION-11-ROLES.md`, `ROLE-BY-ROLE-VERIFICATION-2026-10-21.md`) and `authorization-catalogue.seed.ts` remain the authorities and were not re-created.

---

## 5. Ownership

- **Issue owner:** Admin web maintainers (follow-up PR).
- **Review gate:** Proposal implementation must not start until this tracker's 6 failures are green in that follow-up PR.
- **Do not:** Close this tracker by deleting tests or by granting all roles `ledger.view` / `customer.suspend`.

*End of tracker. See proposal §8 for summary. Implement dashboard, then fix these tests, then demo.*
