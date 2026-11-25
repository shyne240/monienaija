# Finance Operations — implementation report

**Branch:** `arena/76e596b2-monienaija` (base `41edf587c262edafbd3eb2cc1b3042c614a9730e`)
**Date:** 2026-11-25

## What was built

A read-only finance-operations surface across the API and the admin web:

| Layer            | Artifact                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API              | `src/finance-operations/*` — `FinanceOperationsService`, controller, module, types                                                                                                                                                                                                                                  |
| Route policy     | `FINANCE_OPERATIONS_ROUTE_POLICIES` in `src/authorization/route-policy-registry.ts`                                                                                                                                                                                                                                 |
| Ledger hardening | institution attribution on journal/account views and scope enforcement in `src/ledger/ledger.controller.ts`                                                                                                                                                                                                         |
| Admin web        | ledger record search + journal evidence in `LedgerOperationsScreen.tsx`; transaction→journal link in `TransactionObservabilityScreen.tsx`; `ReconciliationBreaksPanel.tsx` in the reconciliation desk; evidence-boundary and exception filters in `BankingOperationsScreen.tsx`; deep-link plumbing in `Layout.tsx` |
| Tests            | `test/finance-operations.service.spec.ts` (23), `test/finance-operations.route-policy.spec.ts` (9), `scripts/finance-operations-browser-acceptance.cjs` (8 browser checks)                                                                                                                                          |

### API surface

All routes are `GET`, `WORKFORCE_SESSION`, `auditDeniedWorkforceFunction: true`, under
`/api/v1/internal/finance-operations`:

| Route                                      | Function              |
| ------------------------------------------ | --------------------- |
| `ledger/journals`                          | `ledger.view`         |
| `ledger/journals/:id`                      | `ledger.view`         |
| `ledger/journals/:id/reversal-eligibility` | `ledger.view`         |
| `transactions/:id/journal`                 | `transaction.view`    |
| `reconciliation/institutions`              | `reconciliation.view` |
| `reconciliation/breaks`                    | `reconciliation.view` |

There is deliberately **no write route**. Reversal requests and executions continue to use the
existing governed endpoints (`POST /ledger/journals/:id/reversal-request`,
`POST /ledger/journals/:id/reversal`); the new surface only reports eligibility and blockers.

### Scope semantics

- Platform authority is `institution.attribution.view`; it removes the institution predicate and
  reports mode `PLATFORM`.
- Otherwise the predicate is `(j.institution_id IS NULL OR j.institution_id = ANY($n))`, with mode
  `INSTITUTIONS`, or `NONE` when the principal has no active assignment.
- An explicit `institutionId` filter is asserted before any read, so an out-of-scope record is a
  `404` identical to a missing one (anti-probe). Legacy unattributed rows remain visible under the
  function gate.
- Ledger journal/account reads now follow the same rule: institution-attributed resources are `404`
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

## Transaction History handoff (PR #23 contract)

PR #23 owns the unified Transaction History. This PR consumes its published contract and invents no
taxonomy of its own:

| Source record                                                                       | History type      | Identifier used                           | Notes                                                        |
| ----------------------------------------------------------------------------------- | ----------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `transfers`                                                                         | `WALLET_TRANSFER` | business transaction id                   | the transfer row is the business key                         |
| `deposits`                                                                          | `CASH_IN`         | **original canonical-service journal id** | the deposit row id is never used                             |
| `withdrawals`                                                                       | `CASH_OUT`        | **original canonical-service journal id** | the withdrawal row id is never used                          |
| `cash_to_cash_transfers`                                                            | `CASH_TO_CASH`    | business transaction id                   |                                                              |
| reversal journals (`reversal_of_journal_id` set)                                    | —                 | —                                         | link unavailable: a reversal is not the business transaction |
| customer/agent funding, inbound funding, cash-out execution, external bank transfer | —                 | —                                         | link unavailable, with the reason shown                      |

`apps/admin-web/src/screens/authenticated/transaction-history-link.ts` is the single adapter:
`resolveTransactionHistoryLink(source, journalDetail)` returns either
`#transaction-history/<TYPE>/<UUID>` or an explicit unavailable reason. The ledger desk renders an
anchor (`open-unified-transaction-detail`) only for a supported mapping and otherwise renders
`transaction-history-unavailable` with that reason. It never guesses a type from a reference prefix
and never substitutes a ledger-line, event, approval or bank-commitment id.

Verified on a **temporary combined build of PR #25 and PR #23** (`git merge` of
`dd37997` + `82752357`, one `Layout.tsx` conflict resolved by taking #23's navigation cases):
customer → transaction trace → ledger journal → unified transaction detail, 6/6 browser checks.
The evidence includes the exact contract URL requested
(`/api/v1/internal/admin/transaction-history/CASH_IN/<journal id>`) and asserts that the deposit row
id never appears in the link or the rendered detail.

## Verification actually performed

All commands below were run against the pushed head of this branch.

| Check                                                                                                                                                 | Result                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` (CI Backend job step)                                                                                                                  | exit 0                                                                                                                                                                                                                                   |
| `npm run format:check` (CI step)                                                                                                                      | clean                                                                                                                                                                                                                                    |
| `npx tsc --noEmit -p tsconfig.json`                                                                                                                   | clean                                                                                                                                                                                                                                    |
| `npx nest build`                                                                                                                                      | exit 0                                                                                                                                                                                                                                   |
| `npx jest test/finance-operations.service.spec.ts`                                                                                                    | 23/23                                                                                                                                                                                                                                    |
| `npx jest test/finance-operations.route-policy.spec.ts`                                                                                               | 9/9                                                                                                                                                                                                                                      |
| `npx jest test/a7-product-financial-effect.service.spec.ts test/transfer-lifecycle.service.spec.ts test/ledger-reversal-governance.service.spec.ts …` | 117/117 across 5 suites                                                                                                                                                                                                                  |
| `npx jest test/authorization-http-matrix.spec.ts`                                                                                                     | 160/160                                                                                                                                                                                                                                  |
| `npx jest apps/admin-web/__tests__/finance-transaction-history-link.test.ts`                                                                          | 7/7                                                                                                                                                                                                                                      |
| `npm test` in `apps/admin-web`                                                                                                                        | 98 suites / 991 tests pass                                                                                                                                                                                                               |
| `ADMIN_WEB_API_BASE_URL=/api/v1 npx vite build`                                                                                                       | exit 0                                                                                                                                                                                                                                   |
| `scripts/finance-operations-http-acceptance.cjs` (real HTTP, real DB)                                                                                 | **25/25**                                                                                                                                                                                                                                |
| `scripts/finance-operations-browser-acceptance.cjs` (Chromium 153)                                                                                    | **9/9**                                                                                                                                                                                                                                  |
| `scripts/finance-pr23-combined-acceptance.cjs` (temporary #25+#23 build)                                                                              | **6/6**                                                                                                                                                                                                                                  |
| GitHub Actions on this head                                                                                                                           | Backend (lint, format, build, unit tests), Backend (isolated PostgreSQL suites), Backend (container image builds), Backend (real PostgreSQL integration), Admin Web (types, tests, build), Agent Mobile, Customer Mobile — see PR checks |

Combined real-session evidence is in `docs/integration/evidence/finance25-cashin-bank/`
(`results.json`, 8 screenshots, and the harness template used in the temporary checkout).
Ledger-deep-link coordination for PR #23 is in
`docs/integration/FINANCE-LEDGER-DEEPLINK-CONTRACT.md`.

Evidence lives in `docs/integration/evidence/finance-operations/`:
`finance-operations-http-acceptance.json` (25 assertions + redacted request transcript),
`finance-operations-browser-acceptance.json`/`.png`, and
`finance-pr23-combined-acceptance.json`/`.png`. Credentials and bearer tokens are redacted from the
transcript; the local role passwords were never changed.

### HTTP validation against a fully migrated, disposable PostgreSQL database

`scripts/finance-operations-http-acceptance.cjs` builds the real `AppModule` with the Fastify
adapter, `fastifyAdapterOptions`, `applyHttpSecurity`, `registerRequestContextHooks`, the global
`ValidationPipe`, `GlobalExceptionFilter` and the `api/v1` prefix. The **only** thing it skips is
`ProductionReadinessService.verifyStartup()`; every guard, route policy, authorization check and
repository query is the production one, against a disposable local database. The production
`financial_dependencies_not_ready` gate itself is untouched, and the harness refuses to run unless
`FINANCE_HTTP_ACCEPTANCE_CONFIRM=disposable-local-database`, `NODE_ENV=test|development`, a loopback
database host and no worker drivers are configured.

The 25 assertions cover: real workforce sign-in for the seeded `FINANCE_AUDITOR`,
`FINANCE_PREPARER`, `FINANCE_CONTROLLER`, `TREASURY` and `SUPER_ADMIN` accounts; unauthenticated 401;
institution-scoped journal search; no cross-institution leakage; journal detail attribution and
lines; 404 (not 403, not a hint) for cross-institution finance reads, legacy ledger reads and
reconciliation breaks; `READ_ONLY_PRINCIPAL` for the auditor; `REQUEST_REVERSAL` for the preparer;
cross-institution reversal-request 404; the maker request → `AWAIT_APPROVAL` → checker approval →
`EXECUTE_REVERSAL` → execute reversal workflow; `REVERSED` detail state and `ALREADY_REVERSED`;
platform-scope reads for `SUPER_ADMIN`; function denial for a role without `ledger.view`;
`NOT_PERFORMED` external evidence with `reconciliationEstablished=false`; and a 400 for an invalid
date range.

### Defects found by real-database HTTP

- **`BankingReadinessService.forInstitution` could not run against the migrated schema.** It selected
  `credential_bundle_fingerprint` from `banking_provider_configuration_versions`, but that column
  exists only on `banking_provider_configuration_proposals`. Unit tests stub the readiness service,
  so only a real database surfaced the 500 on `reconciliation/breaks`. Fixed by joining the approved
  proposal; the fingerprint now comes from the approved proposal that produced the version.
- **Unavailable provider evidence reported `UNAVAILABLE` as a source result.** An external source
  that cannot be read must stay `NOT_PERFORMED`, never look like a completed-but-unavailable pass.
  Fixed, and a regression assertion added.

### Local runtime facts

- A disposable PostgreSQL 18.4 cluster was created with `scripts/embedded-pg.js`; all 169 migration
  entries applied and `scripts/local-dev-seed-11-roles.js` created the 11 role credentials plus the
  legacy `admin@monienaija.local` identity. Existing local passwords were preserved.
- `LedgerModule` was missing an `InstitutionModule` import after the ledger change; fixed in
  `src/ledger/ledger.module.ts`.
- `node dist/main.js` still exits 1 with `financial_dependencies_not_ready` in this environment, by
  design. No production behaviour was relaxed to make it start.

## Not performed / limitations

- External provider/statement reconciliation remains not performed: Monnify reports
  `RECONCILIATION_OBSERVATIONS: false` and there is no statement-ingestion contract. Both external
  sources correctly render `NOT_PERFORMED`, and `reconciliationEstablished` stays false.
- The HTTP harness is a test bootstrap: it proves the HTTP surface, guards, route policies and SQL,
  but it is not a production deployment. The production startup gate was not weakened and was not
  exercised as a passing gate.
- Browser acceptance is Chromium-only, desktop viewport, no assistive technology; it certifies
  rendering and interaction, not accessibility announcements. Both browser runs stub the API at the
  browser network layer — server behaviour is covered by the HTTP harness instead.
- Customer/Agent mobile apps are out of scope for this PR and were not changed.
