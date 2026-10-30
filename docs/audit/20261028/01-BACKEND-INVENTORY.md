# 01 — Backend Inventory and Surface Map

## Inventory boundaries

The machine-readable `backend-route-inventory.csv` lists 470 Nest HTTP decorator declarations found beneath `src/**/*.controller.ts` at application SHA `73eb1ca`. It records method, controller prefix + decorator path, handler, file/line, DTO-name hints, and conservative evidence flags. Its route count is a static source count: it does not include dynamic routes or prove that every route is mounted, authorized as intended, or reachable in a running deployment. Every route must be checked against `src/main.ts`, `src/app.module.ts`, module imports, `RuntimeAccessGuard`, route policies, controller checks, and integration tests before describing effective access.

`backend-component-inventory.csv` contains file/class declaration records, not dependency-graph or reachability proof. `service-only`/class references must not be read as unused-code claims.

## Domain map

| Domain / source area | Primary responsibilities / representative source | Admin relationship and audit note |
|---|---|---|
| `src/agent`, `src/agent-authentication` | onboarding/application, lifecycle, cash-in/out/C2C, funding, limit interactions, history, OTP, locator claims and recovery; expiry worker and canonical settlement | Agent Network, classes, funding, history, C2C operations. Financial writes must be evaluated at canonical service + ledger + transaction boundary, not by UI labels. |
| `src/customer*` | registration/onboarding, KYC, identity, wallet, funding instruments, eligibility, preferences, risk/compliance, proof of address | Customer servicing, KYC/compliance/fraud/support. The generic customer route policy has security implications for case-management controllers. |
| `src/transfer`, `src/wallet`, `src/deposit`, `src/withdrawal`, `src/ledger`, `src/quote`, `src/fee*` | transfer and wallet operations, deposits/withdrawals, quoting, fees, ledger posting and operations | Transaction observability and ledger/reconciliation surfaces are mostly read/diagnostic; no screen presence proves a settlement/reversal procedure. |
| `src/authorization`, `src/authorization-catalogue`, `src/local-admin-authentication`, `src/support-authentication` | authentication principals, workforce roles/scopes, runtime route policy, governed actions, privileged approvals, recovery and role governance | Role governance, workforce, approvals, and super-admin recovery UI. UI gates are not API enforcement. |
| `src/notification` + `src/admin/admin-notification*` | event map, registry-driven SMS/email templates, provider abstractions, outbox/delivery worker, inbox, provider status/test-send, delivery diagnostics | Notification Management and System Health. Some notification routes are server-governed; delivery-list route is only workforce-type gated. |
| `src/commission`, `src/reward`, `src/fee-rules`, `src/product-catalog`, `src/product-governance`, `src/limit-catalog`, `src/commercial-*` | governed catalogues, runtime resolution, limits and commercial decision snapshots | Admin commercial screen is a registry viewer, not full change governance. Reward registry must be separated from operational reward effects. |
| `src/reconciliation`, `src/operations`, `src/production`, `src/health`, `src/capability-registry`, `src/dashboard` | reconciliation observability, audit, operational readiness, health, capability declarations and dashboards | Dashboards/diagnostics do not equal operator workflows or production proof. |
| `src/outlet`, `src/virtual-account`, `src/bank`, `src/partner`, `src/aggregator`, `src/beneficiary` | outlets, public locator, bank/virtual account, callbacks, aggregator, beneficiary records | Public and partner surfaces require separate threat and operational review; static route count does not characterize all access paths. |
| `src/support`, `src/customer-app`, `src/customer-registration`, `src/customer-eligibility` | support, customer-facing app API, registration and eligibility | Support inbox is a bounded UI; customer app API is outside this Admin Web audit's acceptance claim. |

## Cross-cutting controls to inspect per route

- Global API prefix, validation, exception mapping, and global guards: `src/main.ts`; application-wide modules/providers: `src/app.module.ts`.
- Route declarations and protected resource/function policy: `src/authorization/route-policy-registry.ts`, `src/authorization/runtime-access.guard.ts`, authorization catalogue and role seeds.
- Controller-local authorization and object-level checks: do not infer these from menu visibility or a route-policy comment; verify exact handler calls and service scoping.
- DTO validation: global `ValidationPipe` plus DTO decorators/custom parsing. Raw-body endpoints (`body: unknown`) require explicit shape/safety tests.
- Persistence: TypeORM entities under domain directories; migrations under `src/migrations/`. There are 100 migration files in source. Do not run migrations during the audit; no source inventory establishes which production migrations have been applied.
- Background work: `src/notification/notification-worker.service.ts` (feature-flagged delivery worker) and `src/agent/agent-cash-to-cash-expiry-worker.service.ts` (expiry worker); outbox model/service under `src/operations`. Flags/defaults, singleton/multi-process semantics, batch limits, alerting, failure visibility and deployment config are operational acceptance items. The component CSV contains explicit worker/outbox role rows in addition to their ordinary service/entity file rows.
- Outbox/provider: notification event map, dispatcher, rendering/redaction, provider adapters, worker, and delivery persistence. A trigger/outbox row, provider acceptance, and end-user receipt are distinct states.
- Tests: `test/` integration suites and source unit specs. Current source-file inventory has 315 files under `test/`, 5 `src/**/*.spec.ts` files, and 26 Admin Web test/spec files (346 source files across these scanned trees). Test source, passed test, PG setup, browser UAT, and production execution are distinct evidence classes.

## Financial and operational review boundaries

The backend inventory does not imply that a capability is a financial write. For money-moving paths, confirm transaction boundaries, ledger postings, idempotency, lock ordering, authorization, limits/reservations, audit, replay/recovery, and failure rollback from the canonical service path and integration test. For read/operations screens, confirm they do not accidentally imply mutate/retry/reversal authority. The audit makes no production accounting or runtime claim beyond cited source and inherited test reports.
