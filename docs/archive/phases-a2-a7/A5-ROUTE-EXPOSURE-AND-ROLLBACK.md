# A5 Route Exposure, Disable, and Rollback Evidence

- **Phase:** A5 — Internal Financial Pilot
- **Task:** A5T10 — A5 Integration, Pilot Release Gate, and A6 Handoff
- **Status:** Exposure and rollback package prepared; no A5 route approved or activated
- **Classification:** Documentation-only route, deployment, disable, and rollback evidence
- **Application, database, API, controller, route, scheduler, and financial-runtime changes in this task:** None

## 1. Exposure decision

A5T10 introduces no controller, public API, route, scheduler, broker, provider, settlement rail, notification path, or external event publisher.

The repository contains pre-existing transfer routes, including `/transfers`, but route existence is not evidence of A5 pilot approval. Those routes are compatibility/source surfaces and must not be treated as the customer-aware, A2/A4/A3-gated pilot exposure without a separate approved A2 route/data-exposure decision.

| Surface                             | Repository status          | A5 interpretation                                                      | Required exposure decision                    |
| ----------------------------------- | -------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Existing transfer create/read route | Present before A5          | Not A5-approved; does not by itself invoke the complete pilot boundary | A2 route/data policy plus A5 release approval |
| `InternalTransferGateService`       | Internal service           | No route; gate result is not a public response contract                | Approved internal caller only                 |
| `PilotControlService`               | Internal service           | No route; durable mutations require A2 `pilot:control:write`           | Operations-controlled internal change only    |
| `TransferLifecycleService`          | Internal service           | No route; metadata/financial operations remain service-bound           | Approved internal execution caller only       |
| `TransferReconciliationService`     | Internal read-only service | No route; support/control access remains A2-governed                   | Approved Operations/Reconciliation read path  |
| Outbox persistence                  | Operations table/service   | No publisher or consumer route                                         | Operations-owned persistence only             |

No existing route is allowed to bypass pilot admission, A2 authorization, A4 policy, A3 binding, Ledger invariants, Operations idempotency, or reconciliation controls.

## 2. Pilot enablement prerequisites

Before any approved internal caller can execute the pilot, accountable owners must record:

1. A2 protected service/route policy for the exact source customer and transfer scope.
2. A3 binding/read/reconciliation approval for source and destination account assertions.
3. A4 policy/profile/version and current-evidence approval.
4. A5 pilot control configuration with an explicit Customer UUID cohort, currency, limits, thresholds, and `enabled = true`.
5. `A5_PILOT_EMERGENCY_STOP = false` under Operations/Release ownership.
6. Ledger/Finance chart/account and posting approval.
7. Operations audit, idempotency, outbox, metrics, diagnostics, and support ownership.
8. Live migration up/rollback evidence for transfer lifecycle, outbox contract, and pilot controls.
9. Independent Reconciliation verification and a support trace test.
10. A recorded A5 approval decision; implementation artifacts alone do not activate the pilot.

Until all conditions are recorded, the pilot remains disabled and new commands must fail closed.

## 3. Disable controls

A5 has two independent controls:

### Durable pilot disable

```text
PilotControlService.setEnabled(..., enabled: false)
```

This requires A2 authorization for `pilot:control:write`, uses Operations idempotency, and records an audit fact. It prevents new gate admission for the cohort/control key. It does not change Transfer, Ledger, Outbox, Audit, or Reconciliation records.

### Environment emergency stop

```text
A5_PILOT_EMERGENCY_STOP=true
```

This process-wide kill switch denies new pilot admission before A4 policy evaluation and financial execution. It is validated by the environment schema and is owned by Operations/Release. It is not a customer-facing setting.

If either control denies admission, the safe result is a deterministic pilot-control denial. It is not a failed financial transaction, cancellation of a completed transfer, or instruction to rewrite history.

## 4. Immediate stop conditions

Stop new pilot admission and escalate when any condition occurs:

- emergency stop is active or configuration cannot be established;
- durable pilot control is missing, disabled, invalid, stale, or has an empty/unapproved cohort;
- customer is outside the explicit cohort;
- amount/currency/daily usage exceeds the pilot envelope;
- A2 authorization failure, A4 non-current/non-allow result, or A3 binding/account discrepancy;
- Ledger journal imbalance, account/currency/accounting-unit mismatch, or negative-balance protection failure;
- repeated `UNKNOWN` or recovery outcomes;
- Transfer/Ledger correlation is missing or inconsistent;
- outbox event missing, duplicated, payload-mismatched, or corrupted;
- audit/idempotency evidence cannot be persisted;
- independent reconciliation reports an error;
- any change would require editing completed journals, lines, balances, transfers, or outbox facts; or
- any proposal introduces public exposure, external providers, settlement, notifications, or A6 work.

The safe action is to deny/hold new commands, preserve evidence, and escalate to the owning boundary.

## 5. Deployment and activation sequence

If an approved later release activates the pilot, the release owner must:

1. Confirm the A5 approval package and all upstream A2/A3/A4 approvals.
2. Confirm migration backup, apply, rollback, and readiness evidence for all A5 migrations.
3. Deploy code with the emergency stop active and durable control disabled.
4. Verify application startup, migrations, Operations audit/idempotency/outbox, diagnostics, and read-only reconciliation.
5. Configure a small explicit cohort and exact currency/amount/daily limits using the A2-authorized control mutation.
6. Run synthetic/internal validation through the complete A2 -> pilot -> A4 -> A3 -> lifecycle -> Ledger -> outbox -> reconciliation trace.
7. Verify duplicate/replay, changed payload, retry exhaustion, timeout/unknown, outbox rollback, reconciliation discrepancy, and disable behavior.
8. Obtain the recorded go/no-go decision from Architecture, Product, Risk, Compliance, Security, Finance, Ledger, Operations, Reconciliation, and Support owners.
9. Keep emergency stop available and record release version, control version, cohort, thresholds, incident channel, and rollback owner.
10. Enable only the approved internal caller path; do not make an existing route public by default.

No step silently broadens the cohort or converts an A4 allow into a public product capability.

## 6. Rollback-safe disable procedure

1. Set `A5_PILOT_EMERGENCY_STOP=true` or durably disable the pilot control.
2. Confirm new gate requests receive the expected deterministic denial code and do not reach A4/Ledger.
3. Preserve current pilot control version, cohort, request/correlation/trace IDs, audit facts, idempotency records, outbox facts, Transfer rows, and Ledger references.
4. Do not cancel, delete, reverse, edit, or backfill completed transfers or journals as part of disable.
5. Verify independent reconciliation and outbox/audit diagnostics for in-flight and completed commands.
6. Place any `PROCESSING`, `PENDING_RECOVERY`, or `UNKNOWN` outcomes into the approved Operations recovery path; do not retry blindly.
7. If code rollback is required, verify compatibility with A5 lifecycle/outbox/pilot-control schemas before deployment.
8. Keep new admission disabled until the root cause, mitigation, owner, and re-enable approval are recorded.
9. Re-enable only through a new authorized control mutation and explicit release decision.

A rollback changes admission, not financial history.

## 7. Prohibited production edges

A5T10 does not authorize or implement:

- public customer activation or broad rollout;
- mobile/web/API exposure;
- external banks, NIBSS, payment providers, settlement, suspense, callbacks, or partner reconciliation;
- deposits, withdrawals, bill payments, fees, FX, cards, QR, payroll, credit, savings, or product expansion;
- notifications or customer messaging;
- background schedulers, brokers, queues, or external event publishers;
- automatic reconciliation repair or financial correction; or
- A6, A7, A8, or product roadmap expansion.

## 8. Evidence status

- [x] Existing transfer route is explicitly classified as non-evidence of A5 exposure.
- [x] A5 durable disable and environment emergency-stop behavior are implemented.
- [x] Disable behavior preserves completed financial history.
- [x] Stop conditions and rollback-safe procedure are documented.
- [x] No route/controller/API/scheduler/external integration was added by A5T10.
- [ ] A2 route/data-exposure approval is recorded.
- [ ] Live migration/deployment/rollback drill is recorded.
- [ ] Pilot cohort activation and go/no-go approval are recorded.

This document is a release/rollback decision input, not route exposure or production approval.
