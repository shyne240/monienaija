# 04 — Security, False-Completion, and Financial Findings

**Evidence type:** static source inspection at integrated application SHA `73eb1ca`. No unauthorized requests, production systems, or financial operations were exercised. Source findings are not exploit claims.

## F-01 — P0: Customer compliance case routes lack a dedicated compliance function check

`CustomerComplianceController` exposes list/detail/create/update/comment/evidence/assignment/history routes under `/customers/:id/compliance-cases...` (`src/customer-compliance/customer-compliance.controller.ts:14-82`) and delegates to its service without an explicit `requireFunction`. The generic customer path policy in `src/authorization/route-policy-registry.ts:220-233` allows `CUSTOMER`, `OPERATOR`, `SERVICE`, and `PRIVILEGED`; the controller does not itself establish a compliance-specific workforce scope. A generic `SELF` policy does not inherently limit a workforce caller to the appropriate customer subject. Confirm actual guard behavior and service-level scope before making any exploit statement; the static gap is sufficient to require a negative authorization test.

**Acceptance:** define entitled functions and principal types, enforce at the API/service boundary, test no-scope 403, wrong-resource/cross-customer denial, permitted read and mutation, audit of mutation, and customer self-service behavior if intended.

## F-02 — P0: Notification delivery list is workforce-type-only

`AdminNotificationController.listDeliveries` calls `requireWorkforce` (`src/admin/admin-notification.controller.ts:29-46,157-168`), excluding customer/agent/aggregator principals but not requiring `notification.view_deliveries`. The Admin UI separately checks the scope (`SystemHealthScreen.tsx:111,183-205`). **Do not generalize:** provider-status and test-send do call server-side function checks in `AdminNotificationProviderController`; registry routes delegate to function/role governed service logic. The risk is the delivery list's scope mismatch and sensitive operational metadata projection.

**Acceptance:** approved function-scope test at the real controller/guard boundary; bounded safe DTO assertion; no recipient destination/payload/provider secret exposure; test privileged and unauthorized workforce identities.

## F-03 — P0: Limit diagnostics route access differs from Admin `limit.view` navigation policy

`LimitOperationsController` checks workforce principal type for usages/reservations (`src/limit-catalog/limit-operations.controller.ts:43-95`); Admin `LimitAssignmentScreen` uses `limit.view` for diagnostics and has a source warning about the backend policy mismatch (`apps/admin-web/src/screens/authenticated/LimitAssignmentScreen.tsx:81-86,332-335`). Reservation release is a separate mutation and should not be conflated with these GET diagnostics. Confirm whether broad workforce access is intentional; enforce the selected policy at the API boundary.

## F-04 — P1: Risk/Fraud category “filter” is frontend-only

`RiskFraudScreen.tsx:18-45` retrieves the broader compliance case set and filters in client state. A user can call the API independently; the UI does not enforce case-category access. The current finding is about server-enforced isolation, not the visible filter control itself. Add server filters and per-category authorization before relying on this as a sensitive queue.

## F-05 — P1: Commercial registry views overstate management coverage if called “configuration”

`CommercialRulesScreen.tsx:108-198` provides structured read/refresh views. Backend governed write APIs exist in fee rules (`src/fee-rules/fee-rule-registry.controller.ts`), commission (`src/commission/commission-rule-registry.controller.ts`), rewards (`src/reward/reward-rule-registry.controller.ts`), product catalogue (`src/product-catalog/product-catalog.controller.ts`) and limits (`src/limit-catalog/limit-catalog.controller.ts`). A list plus row values does not establish Admin create/edit/approval, DB persistence, versioning, audit, reload, or consumer effect.

**Reward-specific:** source policy notes reward rules do not demonstrate runtime crediting (`src/authorization/route-policy-registry.ts:809-825`). Do not claim reward accrual/credit/reversal because a registry endpoint exists.

## F-06 — P1: Compliance case UI is lookup-oriented; backend has additional actions

Admin case mode is a table/search surface (`ComplianceScreen.tsx:130-176`). Backend also exposes update/comment/evidence/assignment/history operations. A complete case-management claim needs UI mapping, independent server authorization, secure evidence handling, state transitions, audit, persistence, reload and browser/negative tests. Address together with F-01, but keep workflow gap distinct from access-control gap.

## F-07 — P1: C2C expiry worker implementation exists, activation remains unverified

The earlier 20261027 audit described an expiry service with no production trigger. Integrated source now has `AgentCashToCashExpiryWorker` with bounded batch, startup catch-up, single-flight protection and safe error logging (`src/agent/agent-cash-to-cash-expiry-worker.service.ts:21-84`). It runs only if `CASH_TO_CASH_EXPIRY_WORKER_ENABLED` is true; schema default is false (`src/config/environment.ts:49-52`, `.env.example:142-145`). Thus the correct current classification is **implementation present / operational execution unverified**, not “no trigger.” Release needs explicit flag config, deployment single/multi-replica strategy, monitoring, and DB evidence. This does not authorize refund/forfeiture or any expired-liability disposition.

## F-08 — P1: “Privileged Approvals” is not a general queue

`ApprovalsScreen` asks for a known approval ID and then supports detail/decision interactions (`apps/admin-web/src/screens/authenticated/ApprovalsScreen.tsx:57,127,184-191`). Distinct funding approval flows should not be mistaken for a general discoverable queue. Whether a general queue is required is product scope, not an assumed defect.

## F-09 — P1: Historical test evidence is strong but not current browser/runtime proof

Notification final-closure report documents green backend build/unit tests, 119/119 PG files and Admin typecheck/tests/build at `73eb1ca`; it also explicitly says no browser UAT and no real-provider delivery. The current audit did not rerun those suites (environment did not initially have node_modules; installation/build checks are attempted and recorded separately). A historic PG suite proves only its scenarios and run environment; it does not prove production migrations, config or live delivery.

## F-10 — Medium: JSON configuration and nested metadata

Agent class configuration includes structured JSON/config inputs; Agent Network displays nested metadata. These are not whole-page raw JSON endpoint explorers, but still require schema errors, permission, persist/reload, audit diff and downstream validation. Track as usability/evidence, not a completed management flow.

## Guardrails against false completion

- A route is not a workflow; a screen is not authorization.
- A mocked `ApiClient` test is not real HTTP, DB persistence, or browser UAT.
- A registry record is not proof of active use or downstream accounting.
- Provider acceptance is not recipient delivery; no webhook/polling evidence is asserted.
- C2C event/template registry entries are not event emitters. In particular, closure report says `cash_to_cash.claimed` and `.expired` lack outbox emitters; do not mark these events LIVE merely because templates exist.
- Manual notification retry remains deferred by V1 requirement; do not create or expose a retry control.
- No financial or notification policy is changed by this audit.
