# Finance Operations — implementation report

**Branch:** `arena/76e596b2-monienaija` (base `41edf587c262edafbd3eb2cc1b3042c614a9730e`)
**Date:** 2026-11-25

## What was built

A read-only finance-operations surface across the API and the admin web:

| Layer | Artifact |
| --- | --- |
| API | `src/finance-operations/*` — `FinanceOperationsService`, controller, module, types |
| Route policy | `FINANCE_OPERATIONS_ROUTE_POLICIES` in `src/authorization/route-policy-registry.ts` |
| Ledger hardening | institution attribution on journal/account views and scope enforcement in `src/ledger/ledger.controller.ts` |
| Admin web | ledger record search + journal evidence in `LedgerOperationsScreen.tsx`; transaction→journal link in `TransactionObservabilityScreen.tsx`; `ReconciliationBreaksPanel.tsx` in the reconciliation desk; evidence-boundary and exception filters in `BankingOperationsScreen.tsx`; deep-link plumbing in `Layout.tsx` |
| Tests | `test/finance-operations.service.spec.ts` (23), `test/finance-operations.route-policy.spec.ts` (9), `scripts/finance-operations-browser-acceptance.cjs` (8 browser checks) |

### API surface

All routes are `GET`, `WORKFORCE_SESSION`, `auditDeniedWorkforceFunction: true`, under
`/api/v1/internal/finance-operations`:

| Route | Function |
| --- | --- |
| `ledger/journals` | `ledger.view` |
| `ledger/journals/:id` | `ledger.view` |
| `ledger/journals/:id/reversal-eligibility` | `ledger.view` |
| `transactions/:id/journal` | `transaction.view` |
| `reconciliation/institutions` | `reconciliation.view` |
| `reconciliation/breaks` | `reconciliation.view` |

There is deliberately **no write route**. Reversal requests and executions continue to use the
existing governed endpoints (`POST /ledger/journals/:id/reversal-request`,
`POST /ledger/journals/:id/reversal`); the new surface only reports eligibility and blockers.

### Scope semantics

* Platform authority is `institution.attribution.view`; it removes the institution predicate and
  reports mode `PLATFORM`.
* Otherwise the predicate is `(j.institution_id IS NULL OR j.institution_id = ANY($n))`, with mode
  `INSTITUTIONS`, or `NONE` when the principal has no active assignment.
* An explicit `institutionId` filter is asserted before any read, so an out-of-scope record is a
  `404` identical to a missing one (anti-probe). Legacy unattributed rows remain visible under the
  function gate.
* Ledger journal/account reads now follow the same rule: institution-attributed resources are `404`
  outside the caller's assignments, and both reversal routes re-assert it.

### Reversal eligibility

The server computes the next permitted action (`REQUEST_REVERSAL`, `AWAIT_APPROVAL`,
`EXECUTE_REVERSAL`, `NONE`) from the caller's functions, the journal state, and the pending
approval. The screen shows that label verbatim, lists blockers, and offers “Load approval into
reversal form” only when the caller can execute. Loading copies the approval id **and its exact
reason**, because execution is bound to the approval by fingerprint.

### Reconciliation semantics

Four internal checks (`journal_balance_integrity`, `journal_account_attribution`,
`completed_transaction_journal_link`, `wallet_balance_non_negative`) are reported alongside
`EXTERNAL_PROVIDER` and `EXTERNAL_STATEMENT` sources. A source that cannot be read is
`UNAVAILABLE` → `NOT_PERFORMED`, never a pass. `reconciliationEstablished` is true only when every
internal check passes **and** every external source is available and agreed. The UI states this
in its own banner rather than deriving a friendlier summary. Failed or abandoned provider runs
surface as an `ERROR` break, not a silent zero.

## Verification actually performed

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` (API) | clean |
| `npx nest build` | exit 0 |
| `npx jest test/finance-operations.service.spec.ts` | 23/23 |
| `npx jest test/finance-operations.route-policy.spec.ts` | 9/9 |
| `npx jest test/a7-product-financial-effect.service.spec.ts test/transfer-lifecycle.service.spec.ts test/ledger-reversal-governance.service.spec.ts …` | 117/117 across 5 suites |
| `npx jest test/authorization-http-matrix.spec.ts` | 160/160 |
| `npx jest test/controller-promise-contract.spec.ts test/a5-ar-control-account-provisioning.module.spec.ts test/b2f-finance-control.module.spec.ts` | 4/4 |
| `npx tsc --noEmit -p apps/admin-web/tsconfig.json` | clean |
| `npm test` in `apps/admin-web` | 98 suites / 991 tests pass |
| `ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build` | exit 0, 456 modules |
| `scripts/admin-web-browser-acceptance.cjs` (Chromium 153) | 27/27 |
| `scripts/finance-operations-browser-acceptance.cjs` (Chromium 153) | 8/8 |

Browser evidence is in `docs/integration/evidence/finance-operations/`.

### Local runtime facts

* A disposable PostgreSQL 18.4 cluster was created with `scripts/embedded-pg.js`; all 169 migration
  entries applied and `scripts/local-dev-seed-11-roles.js` created the 11 role credentials plus the
  legacy `admin@monienaija.local` identity.
* Bootstrapping the Nest application exposed a real defect introduced by the ledger change:
  `LedgerController` gained an `InstitutionWorkforceScopeService` dependency without `LedgerModule`
  importing `InstitutionModule`. That is fixed (`src/ledger/ledger.module.ts`) and the application
  context now builds successfully against the live database.
* The API still refuses to serve while the eight financial dependencies are unverified
  (`financial_dependencies_not_ready`). No claim in this report depends on a live HTTP response:
  all browser assertions run against stubbed responses at the browser network layer.

## Not performed / limitations

* No live end-to-end HTTP call against these six routes: the server refuses to start in this
  environment by design.
* Provider reconciliation remains unusable locally (`Monnify` reports
  `RECONCILIATION_OBSERVATIONS: false`), so external sources correctly render as not performed.
* ESLint was not run: the repository’s type-aware flat config fails to load for
  `apps/admin-web/**` files (`await-thenable` requires parser options). This is a pre-existing
  configuration issue, unaffected by these changes.
* Browser acceptance is Chromium-only, desktop viewport, no assistive technology; it certifies
  rendering and interaction, not server behaviour or accessibility announcements.
