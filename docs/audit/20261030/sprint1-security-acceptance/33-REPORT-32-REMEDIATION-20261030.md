# Report 32 remediation — H-01 and M-01

**Date:** 2026-10-30
**Branch:** `integration/main-backend-frontend-20261030`
**Remediated starting point (Report 32 pinned target):** `bc9fadf54466d274218129261d66c17d9387e3c5`
**Report remediated:** `docs/audit/20261030/sprint1-security-acceptance/32-INTEGRATION-BC9FADF-INDEPENDENT-SECURITY-ACCEPTANCE-REVIEW-20261030.md`
**Disposition requested:** FAIL → narrow remediation, focused authorization tests, report remaining failures honestly.

Scope of this change: **authorization policy + authorization tests only.** No frontend, no mobile, no migrations, no financial business rules, no ledger/posting/fee/balance/reconciliation logic, no provider activation, no deploy, no merge into `main`, no Report 30 architecture.

---

## 1. Findings closed

| Report 32 finding | Status after this change |
|---|---|
| **H-01** — internal operational routes authorized by principal type, not capability; `ProductionController` had no controller-level check at all | **Closed.** Every operational read route now declares explicit catalogue functions in the route policy, enforced by `RuntimeAccessGuard`. |
| **M-01** — `GET /api/v1/internal/version` was in `PUBLIC_ROUTES` and answered anonymous callers `200` | **Closed.** Removed from `PUBLIC_ROUTES`; now a function-gated workforce read. |
| Readiness GET performs reconciliation (`getReadiness()` → `runReconciliation()`) | **Reviewed, not changed.** Verified read-only. Concrete change proposal recorded in §6 for approval. |
| 17 red assertions | **All 17 individually dispositioned; none deleted or weakened** — see §4. Suite now **85/85 green**. |
| OI-01 (FundWallet/Withdraw dark) | **Unchanged and still dark** — mobile owner disposition still outstanding (§7). |

---

## 2. H-01 — explicit least-privilege gates on the internal operational surface

### 2.1 The defect

`RoutePolicyRegistry.resolve()` had a generic `/api/v1/internal/*` branch whose policy was:

```ts
allowedPrincipalTypes: ['SUPPORT', 'OPERATOR', 'SERVICE', 'PRIVILEGED']
// no requiredFunctions, no requiredRoles, no requiredScopes
```

`RuntimeAccessGuard` only enforces the gates a policy explicitly declares, so that branch granted every valid workforce principal (including a real SUPPORT session) access to:

`GET /api/v1/internal/{version,configuration,deployment,readiness,diagnostics,metrics,outbox,audit}`

`OperationsController` already re-checked `metrics.view` / `diagnostics.view` / `outbox.view` at the controller; **`ProductionController` had no capability check for `version`, `configuration`, `deployment` or `readiness`**, and `readiness` returns data-source state, migration name/timestamp/count, reconciliation status and pending-outbox count.

Principal type is authentication evidence, not an authorization decision. That was the finding.

### 2.2 The fix — `src/authorization/route-policy-registry.ts`

A single explicit table now governs the surface (no function identifier is invented; every code is from `authorization-catalogue.seed.ts`):

| Route | Required catalogue function(s) | Roles holding them today |
|---|---|---|
| `GET /internal/readiness` | `diagnostics.view` **and** `reconciliation.view` | SUPER_ADMIN, FINANCE_AUDITOR |
| `GET /internal/deployment` | `diagnostics.view` **and** `reconciliation.view` | SUPER_ADMIN, FINANCE_AUDITOR |
| `GET /internal/configuration` | `diagnostics.view` | SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS |
| `GET /internal/version` | `diagnostics.view` | SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS |
| `GET /internal/metrics` | `metrics.view` | SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS |
| `GET /internal/diagnostics` | `diagnostics.view` | SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS |
| `GET /internal/outbox` | `outbox.view` | SUPER_ADMIN, FINANCE_AUDITOR, OPERATIONS |

`allowedPrincipalTypes` for these routes is `['OPERATOR', 'SERVICE', 'PRIVILEGED']` — **SUPPORT is deliberately excluded** (approved V1 SUPPORT scope is "read + funding-maker + support-queue only", UAT-SEC-005 / UAT-ADMIN-011, and SUPPORT holds none of these functions). Denial is therefore doubly enforced: principal type, then function.

`readiness`/`deployment` require **both** `diagnostics.view` and `reconciliation.view` because the payload embeds financial reconciliation state (all-of gate). OPERATIONS keeps metrics/diagnostics/outbox/configuration/version plus the public `GET /health/ready` probe; TREASURY (whose V1 grant is exactly `reconciliation.view`) gains no deployment or migration visibility.

This is a guard-level gate layered **on top of** the existing controller-level `requireFunction` calls — no controller check was removed.

### 2.3 Audit — explicit allow-list, capability retained (approved decision)

`GET /api/v1/internal/audit` keeps SUPPORT reach **by explicit product decision** (recorded during this remediation after being raised for approval, because a pre-existing passing test proves a real SUPPORT session is a deliberate consumer and SUPPORT is not catalogue-governed). It is no longer an accident of the catch-all: it has its own registry branch (`resourceType: 'internal-audit-read'`) whose reachable principal set is stated in one auditable place — `SUPPORT, OPERATOR, SERVICE, PRIVILEGED` — and excludes CUSTOMER/AGENT/AGGREGATOR. The narrower `notification.provider.view` restriction on provider-configuration audit rows is unchanged. Residual risk noted in §7.

---

## 3. M-01 — `/internal/version` is no longer public

* `'GET /api/v1/internal/version'` removed from `PUBLIC_ROUTES` (comment records why).
* Anonymous → `401`; customer → `403`; workforce without `diagnostics.view` → `403`.
* Public probe needs remain served by `GET /api/v1/health` and `GET /api/v1/health/ready`.

---

## 4. Disposition of the 17 red assertions (replaced, never deleted)

| # | Report 32 disposition | What now asserts the contract |
|---:|---|---|
| 1, 8 | Real defect (M-01) | Anonymous `internal/version` → `401`; customer `internal/version` → `403` (matrix) |
| 2 | Obsolete route (generic deposit create) | Customer `POST /deposits` → `403`, `createDeposit` not called |
| 3 | Stale (400 vs 403) | Spoofed-body generic deposit → `403`, service not called (denial precedes validation because the command does not exist for customers) |
| 4 | Obsolete (generic transfer) | Customer `POST /transfers` → `403`, `createTransfer` not called; SELF ownership for the supported route remains in `customer-app.controller.ts` and its PG suites |
| 5 | Obsolete (wallet listing) | Customer `GET /wallets` and `?customerId=` variant → `403`, `listWallets` never called |
| 6 | Obsolete (generic reads) | Customer reads on `/deposits/:id`, `/withdrawals/:id`, `/transfers/:id`, `/wallets/:id/balance`, `/wallets/:id/transactions`, `/deposits?walletId=` → `403` with every `*ForCustomer`/generic service entry point asserted uncalled |
| 7 | Obsolete (generic withdrawal) | Customer `POST /withdrawals` → `403`, `createWithdrawal` not called |
| 9 | Correct denial, wrong code | Workforce token on customer `/wallets` → **`403`** (denial assertion retained) |
| 10, 11, 12 | Stale `internal:access` fixture | Catalogue-backed principals: FINANCE_AUDITOR shape → `200`; retired `internal:access` scope → `403`; no-scope → `403` |
| 13 | Real least-privilege defect (H-01) | SUPPORT → `403` on readiness/deployment/configuration/version/diagnostics/metrics/outbox with services asserted uncalled; OPERATIONS-shape denied on readiness/deployment because it lacks `reconciliation.view` |
| 14, 15 | Obsolete registration contract | Anonymous `POST /customers` → `401`, `customerService.create` not called; OTP registration routes asserted public (`otp`, `otp/verify`, `registration`) at registry level |
| 16 | Stale scope expectation | Registry must declare `requiredFunctions` per route (exact list asserted); `requiredScopes` asserted `undefined` |
| 17 | Obsolete customer-on-generic-routes | Customers excluded from every generic financial route/collection; `/customers/me/*` asserted `CUSTOMER` + `customerAccess: 'SELF'` |

No assertion was relaxed to make the new policy pass: every replacement is a real-HTTP assertion against the deployed registry + guard + controllers, and every denial assertion also proves the service was never reached.

### New positive/negative coverage (requirement 6)

`test/authorization-http-matrix.spec.ts` now proves, over real HTTP:

* **Positive:** a FINANCE_AUDITOR-shape principal (`audit.view`, `diagnostics.view`, `metrics.view`, `outbox.view`, `reconciliation.view`) → `200` on **all eight** internal operational endpoints.
* **Positive:** an OPERATIONS-shape principal (`diagnostics.view`, `metrics.view`, `outbox.view`) → `200` on metrics, diagnostics, outbox, configuration, version; `403` on readiness and deployment.
* **Negative:** a genuine SUPPORT principal shape → `403` on all seven gated endpoints, with each backing service asserted never called; `200` only on the explicitly-approved audit listing.
* **Negative:** the retired `internal:access`-only principal → `403` on every gated endpoint (proves the legacy scope no longer grants reach).
* **Negative:** a scope-less workforce principal → `403` on every gated endpoint.
* **Negative:** anonymous → `401` and customer → `403` on the internal surface.

`test/a22-admin-foundation.integration.spec.ts` #12 (PostgreSQL, real `AppModule`) now asserts the same contract end-to-end for SUPPORT-shaped denial and FINANCE_AUDITOR-shaped allow.

---

## 5. Files changed

| File | Change |
|---|---|
| `src/authorization/route-policy-registry.ts` | `PUBLIC_ROUTES` no longer contains `internal/version`; new `INTERNAL_OPERATIONAL_ROUTE_POLICIES` table + `INTERNAL_AUDIT_READ` allow-list and their resolution branches, inserted ahead of the generic `/api/v1/internal/*` branch |
| `test/authorization-http-matrix.spec.ts` | Catalogue-backed workforce fixtures (FINANCE_AUDITOR / OPERATIONS / SUPPORT / retired-`internal:access` / no-scope); obsolete customer-route expectations replaced with approved-contract assertions; new internal allow/deny matrix; registration contract corrected |
| `test/runtime-access.guard.spec.ts` | Public-route inventory corrected (OTP registration in, `POST /customers` out); operational routes asserted to require exact `requiredFunctions`; audit allow-list asserted; customer money-movement contract asserted |
| `test/a22-admin-foundation.integration.spec.ts` | Test #12 rewritten to the capability contract (was asserting that a SUPPORT session reads readiness/configuration and that version is public) |

**Unchanged:** all financial controllers/services, all migrations, `src/production/*` runtime behaviour, frontend (`apps/admin-web`), mobile (`apps/customer-mobile`), `docs/` policy records.

---

## 6. Requirement 3 — readiness side effect: verified, proposal only (no code change)

`GET /api/v1/internal/readiness` (and `/internal/deployment`, same handler) calls `ReconciliationService.runReconciliation()`.

**Verified:** the scan runs inside `dataSource.transaction('REPEATABLE READ')` with `SET TRANSACTION READ ONLY`. It issues only `SELECT`s; it creates no reconciliation record, posts no journal, moves no money and mutates no state. **No financial or operational behaviour was changed.**

Residual concern: a plain GET executes a full-ledger consistency scan (cost / amplification), and `ProductionReadinessService.verifyStartup()` depends on that same call as a startup gate.

**Proposed change (NOT implemented, awaiting approval):**

1. Split the service into `runChecks(): Promise<ReadinessSnapshot>` (database, migrations, pending outbox — cheap) and `runFullReadiness()` (adds the reconciliation scan).
2. `GET /internal/readiness` returns the cheap snapshot plus a `reconciliation: { status: 'LAST_KNOWN', checkedAt }` field sourced from the last recorded run.
3. `verifyStartup()` keeps calling `runFullReadiness()` unchanged, so the startup gate is not weakened.
4. A dedicated operator-triggered scan route (or the existing scheduled job) refreshes the last-known status.

This changes operational behaviour (fields and scan timing), so per the mission rules it is **reported, not implemented**.

---

## 7. Remaining items (not closed by this remediation)

1. **OI-01 / mobile owner:** `FundWalletScreen` and `WithdrawScreen` remain unregistered and are non-functional pending the mobile owner's disposition; four mobile merge resolutions still need owner ratification. Unchanged by this work (no mobile files touched).
2. **Admin Web owner ratification** of the four reconstructed merge files — outstanding.
3. **Product Owner ratification** of the selected V1 contract (`/customers/me/*`, generic customer commands disabled, OTP registration) as the record that supersedes main's alternative design. The tests now encode this contract; the PO decision record is still separate.
4. **SUPPORT audit read** is retained deliberately. If Security prefers strict least privilege here, the change is one line (add `requiredFunctions: ['audit.view']`) plus the matching test flip — it was held back because it removes a documented, tested SUPPORT capability.
5. **Readiness scan decoupling** — proposal in §6 awaiting approval.

---

## 8. Test results (this tree)

| Check | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | **PASS**, 0 errors |
| `npm test` (full unit/component suite) | **PASS — 222/222 suites, 2,495/2,495 tests** (was 220/222 suites, 2,446/2,463 with the 17 D-01 failures) |
| `jest test/runtime-access.guard.spec.ts` | **PASS — 10/10** |
| `jest test/authorization-http-matrix.spec.ts` | **PASS — 85/85** (was 46 passed / 17 failed) |
| PostgreSQL `a22-admin-foundation` | **PASS — 15/15** (incl. new #12) |
| PostgreSQL `v1-admin-authorization-read-surface-01`, `v1-admin-full-surface-audit-01-auth-propagation` | **PASS — 23/23** |
| PostgreSQL `a2-workforce-session`, `v1-harden-01-runtime-access-guard-boundary`, `v1-harden-01-support-adversarial`, `s-fix-01-customer-lifecycle-authorization`, `v1-admin-authorization-hardening-01` | **PASS — 74/74** |
| PostgreSQL `v1-admin-p1-authorization-hardening`, `v1-admin-configurable-dashboard-platform-01`, `v1-003-admin-operational-writes`, `v1-007-support-ticket`, `v1-customer-09-support-workforce-boundary` | **PASS — 149/149** |
| PostgreSQL `a23-customer-app`, `a5-transfer-lifecycle`, `transfer-notification-producer-01` (financial/ownership preservation) | **PASS — 34/34** |

**Remaining failures: none in the suites above.** The full PostgreSQL matrix (126 suites) was not re-run in this pass; 18 of 126 suites were executed, selected for authorization, support-boundary, operational and financial-contract coverage.

---

## 9. Ready for another Arena 4 review?

**Yes, for the authorization scope.** H-01 and M-01 are closed with explicit per-route catalogue gates and both allow and deny real-HTTP tests, including SUPPORT and low-privilege principals, and the 17 previously red assertions are replaced by contract-correct coverage (net +49 tests).

Not yet closed, and outside an authorization-only remediation: mobile owner disposition (OI-01) and the Admin Web/PO ratifications. This document does **not** claim production readiness, does not authorize merge to `main`, deploy, production migrations, provider activation, or Report 30 implementation.

---

## 10. Branch note

The remediation was applied to `integration/main-backend-frontend-20261030` because that is the branch Report 32 reviewed and the branch this mission explicitly authorised. The session's pinned lineage branch `arena/8e59e188-monienaija` is untouched at `06dc30b` (verified). Because `06dc30b` is an ancestor of the integration branch, the fix propagates to the lineage automatically when the integration is merged; to take it onto the lineage branch alone: `git cherry-pick <remediation-sha>`.

## 11. Reproduction

```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
./node_modules/.bin/jest --runInBand test/runtime-access.guard.spec.ts test/authorization-http-matrix.spec.ts
npm test

# PostgreSQL (embedded)
node scripts/embedded-pg.js
NODE_ENV=test PG_TEST_RUN_ID=r32fixa ./node_modules/.bin/jest \
  --config jest.integration.config.js --runInBand \
  test/a22-admin-foundation.integration.spec.ts \
  test/v1-admin-authorization-read-surface-01.integration.spec.ts
```
