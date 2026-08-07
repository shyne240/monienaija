# ADR-0046: Pilot Limits, Cohorts, and Rollback

- **Status:** Proposed A5 pilot-control decision; controls implemented, pilot activation not approved
- **Date:** 2026-08-07
- **Decision owners:** Architecture, Product, Finance, Operations, Security, Risk, Compliance, Wallet, Ledger, and Customer Engineering
- **Scope:** Durable internal transfer cohort/limit controls, environment emergency stop, safety thresholds, authorization, audit, idempotency, and rollback-safe disable behavior
- **Task:** A5T09 — Pilot Limits, Cohorts, Rollback, and Safety Controls
- **Implementation status:** Runtime pilot-control service, durable configuration, environment kill switch, gate integration, migration, and tests added; no public exposure or A5T10 release evidence added

## Context

A5T01 through A5T08 establish the customer-aware command, A2/A4/A3 gates, transfer lifecycle, Ledger posting, recovery, outbox, and independent reconciliation boundaries. Those capabilities must not automatically become a broad product launch.

A5T09 constrains new internal transfer commands to an explicit cohort and bounded financial envelope. Disable behavior must stop new commands without editing completed transfers, journals, balances, or outbox facts. Controls must fail closed when configuration, authorization, usage, safety signals, or the emergency-stop state cannot be established.

The pilot uses a hybrid control model:

- durable cohort and limit configuration is stored in `pilot_controls`;
- an environment-level `A5_PILOT_EMERGENCY_STOP` provides an immediate process-wide stop; and
- Operations metrics provide configured safety-threshold signals.

No control is a substitute for A2 authorization, A4 policy, A3 binding, Ledger invariants, Operations idempotency, or independent Reconciliation.

## Decision

### 1. Durable pilot control boundary

The `PilotControlService` owns the logical pilot-control boundary inside the existing modular monolith. It does not expose a controller or route.

The seeded control is:

```text
controlKey: wallet.transfer.create.internal.v1
capability: wallet.transfer
action: create
scope: INTERNAL_CUSTOMER_TO_CUSTOMER
enabled: false
```

The default migration row is disabled with an empty cohort. A later authorized internal control mutation must explicitly select customers and limits before a command can pass. No customer is activated by the migration alone.

Durable control fields include:

- enabled flag;
- explicit Customer UUID cohort;
- exact currency;
- positive minimum and maximum transaction amounts in minor units;
- optional per-customer daily count and amount limits;
- safety thresholds for unknown outcomes, reconciliation errors, outbox failures, and authorization failures;
- optimistic version and update actor/request/correlation metadata.

The pilot control is configuration and admission evidence. It is not a financial account, balance, policy record, customer eligibility record, or Ledger authority.

### 2. Admission decision sequence

A new internal transfer command passes pilot admission only after A2 has authorized the command:

```text
A2 authorization
  -> environment emergency-stop check
  -> durable control lookup
  -> enabled/capability/action/scope/currency check
  -> cohort Customer.id check
  -> transaction amount check
  -> per-customer daily usage check
  -> Operations safety-threshold check
  -> pilot decision audit
  -> A4 policy and A3/Ledger command boundaries
```

The A5 gate records the pilot decision in its gate result and Operations audit evidence. A denied pilot decision does not reserve the financial command idempotency record, enter A4 execution, create lifecycle state, or reach Ledger.

Decision codes are deterministic:

```text
PILOT_ALLOWED
PILOT_DISABLED
PILOT_EMERGENCY_STOP
PILOT_CONTROL_UNAVAILABLE
PILOT_AUTHORIZATION_REQUIRED
PILOT_COHORT_DENIED
PILOT_CURRENCY_DENIED
PILOT_AMOUNT_BELOW_MINIMUM
PILOT_TRANSACTION_LIMIT_EXCEEDED
PILOT_DAILY_COUNT_LIMIT_EXCEEDED
PILOT_DAILY_AMOUNT_LIMIT_EXCEEDED
PILOT_USAGE_UNAVAILABLE
PILOT_SAFETY_STOP
PILOT_SAFETY_SIGNAL_UNAVAILABLE
```

A missing control, invalid control, unavailable safety signal, missing daily usage when a daily limit is configured, or unavailable audit path fails closed. It is never interpreted as pilot allow.

### 3. Cohort selection

The cohort is an explicit list of canonical `Customer.id` UUIDs in the durable control row.

Rules:

- Customer references, aliases, WalletAccount compatibility values, payment references, email addresses, and provider IDs are not cohort identity.
- A customer outside the cohort is denied before A4 execution and Ledger posting.
- The source customer is the pilot subject; destination customer membership is not inferred or required as a substitute for A3 destination binding validation.
- Cohort membership is read-only during command evaluation.
- Cohort updates require the A2 `pilot:control:write` authorization policy, Operations idempotency, and an audit fact.
- Cohort changes affect new admission decisions only; they do not edit completed transfer history.

### 4. Transaction and customer limits

The control enforces exact normalized values:

- minimum amount, inclusive;
- maximum single-transaction amount, inclusive;
- optional daily transaction count per source customer; and
- optional daily transaction amount per source customer.

Amounts are positive integer minor-unit strings and are compared using `bigint`-safe arithmetic. Currency must equal the configured pilot currency. If a configured daily limit has no current usage evidence, the decision is `PILOT_USAGE_UNAVAILABLE` and the command is denied.

A4 remains the authority for policy limits and obligations. Pilot limits are an additional release-control envelope, not a replacement A4 limit evaluator. A command must satisfy both the A4 policy result and the pilot control.

### 5. Emergency stop and disable behavior

The environment variable:

```text
A5_PILOT_EMERGENCY_STOP=false
```

is validated by the application environment schema. When true, every new transfer admission returns `PILOT_EMERGENCY_STOP`, regardless of durable control state. The kill switch is fail closed and is not writable by a customer-facing command.

Durable disable uses `PilotControlService.setEnabled(..., enabled: false)` and requires the A2 `pilot:control:write` policy. Disable:

- prevents new transfer gate admission;
- records a `PILOT_DISABLED` Operations audit fact;
- is idempotent and replay-safe;
- does not update Transfer rows;
- does not cancel, reverse, or edit completed transfers;
- does not edit Ledger journals, lines, balances, or account state; and
- does not delete or rewrite outbox facts.

Re-enabling requires a new authorized durable configuration mutation. An environment emergency stop remains authoritative even when the database control is enabled.

### 6. Safety thresholds and stop conditions

A control may configure thresholds for these Operations metric names:

| Threshold              | Metric                  | Stop behavior                                                 |
| ---------------------- | ----------------------- | ------------------------------------------------------------- |
| Unknown outcomes       | `transfers.unknown`     | Deny new pilot commands when observed count reaches threshold |
| Reconciliation errors  | `reconciliation.errors` | Deny new pilot commands when observed count reaches threshold |
| Outbox failures        | `outbox.failed`         | Deny new pilot commands when observed count reaches threshold |
| Authorization failures | `authorization.denied`  | Deny new pilot commands when observed count reaches threshold |

Configured thresholds are positive integers. If a configured signal is missing, malformed, or unavailable, the decision is `PILOT_SAFETY_SIGNAL_UNAVAILABLE` and admission fails closed. A breached signal returns `PILOT_SAFETY_STOP` and does not mutate the signal or any financial record.

The pilot must be stopped for any later operational condition indicating reconciliation drift, unexplained unknown outcomes, outbox corruption, authorization failure, or other threshold breach. A5T09 observes existing Operations metrics; it does not create a second metrics authority or automatically repair the condition.

### 7. Control mutation audit and idempotency

Control mutations use:

```text
idempotency scope: pilot.control.v1
A2 action:          pilot:control:write
```

The mutation request hash includes control key, capability/action/scope, enabled state, cohort, currency, exact limits, safety thresholds, and reason. Transport IDs and actor presentation fields are not financial identity.

Operations audit facts include:

- control ID/key/version;
- enabled/disabled action;
- cohort count and limit envelope;
- actor/principal, request ID, and correlation ID; and
- bounded mutation reason.

Pilot admission decisions are also audited with the decision code, control version, customer ID, amount, currency, and emergency-stop state. Raw credentials, tokens, policy evidence, and unnecessary customer data are excluded.

### 8. Ledger and lifecycle separation

Pilot controls run before the transfer enters the A4/A3/financial execution path. They do not:

- select a WalletAccount or LedgerAccount;
- create or update Transfer lifecycle rows;
- create journals or lines;
- read or mutate balances as an authority;
- change A4 policy decisions or source eligibility; or
- replace A2 authorization.

Ledger remains the only authority for posted value. A disabled pilot cannot affect completed financial history.

## Alternatives considered

### Use only an environment flag

Rejected. An environment flag cannot provide a durable cohort, exact customer limits, versioned control mutation, or auditable configuration history.

### Use only a database flag

Rejected. An operational emergency stop must be available without waiting for a database write or relying on a database control row.

### Use a customer reference or WalletAccount.customerId for cohort membership

Rejected. Those values are not canonical Customer identity and may be ambiguous compatibility data.

### Allow missing usage or safety metrics

Rejected. Missing evidence is not allow. A configured control must fail closed when its required usage or safety signal is unavailable.

### Disable by cancelling or editing transfers

Rejected. Disable stops new admission only. Completed transfers, journals, balances, and outbox facts are immutable financial history.

## Consequences

### Positive

- Pilot exposure is explicitly bounded and disabled by default.
- Emergency stop and durable disable are independent controls.
- Cohort, amount, usage, and safety decisions are deterministic and auditable.
- Completed financial history is unaffected by rollback or disable.
- A2, A4, A3, Ledger, Operations, and Reconciliation ownership remains separate.

### Future review items

- A5T10 must provide release-gate evidence and pilot approval without broadening the cohort implicitly.
- Operations must decide the production source and retention of safety metrics and control mutation audit evidence.
- Finance, Risk, Security, Compliance, and Product must approve actual pilot customers, currency, amounts, and stop thresholds before activation.
- A later architecture review may evaluate a richer feature-control service only after pilot evidence; no new topology is implied here.

## Explicitly out of scope

This ADR and A5T09 do not:

- implement A5T10 release evidence, public launch, broad rollout, or production activation;
- add controllers, public APIs, routes, schedulers, brokers, providers, settlement, callbacks, or external integrations;
- modify completed Transfer rows, journals, lines, balances, accounts, outbox records, or reconciliation records;
- mutate A2, A3, A4, eligibility, risk, compliance, or customer source records; or
- claim owner approval, live migration execution, or pilot activation.

## Implementation evidence

- [`src/pilot/pilot-control.entity.ts`](../../src/pilot/pilot-control.entity.ts)
- [`src/pilot/pilot-control.types.ts`](../../src/pilot/pilot-control.types.ts)
- [`src/pilot/pilot-control.service.ts`](../../src/pilot/pilot-control.service.ts)
- [`src/pilot/pilot-control.module.ts`](../../src/pilot/pilot-control.module.ts)
- [`src/migrations/1785753600025-CreatePilotControls.ts`](../../src/migrations/1785753600025-CreatePilotControls.ts)
- [`src/transfer/internal-transfer-gate.service.ts`](../../src/transfer/internal-transfer-gate.service.ts)
- [`src/operations/audit.service.ts`](../../src/operations/audit.service.ts)
- [`src/operations/idempotency.service.ts`](../../src/operations/idempotency.service.ts)
- [`src/operations/metrics.service.ts`](../../src/operations/metrics.service.ts)
- [`src/config/environment.ts`](../../src/config/environment.ts)
- [`test/pilot-control.service.spec.ts`](../../test/pilot-control.service.spec.ts)
- [`test/internal-transfer-gate.service.spec.ts`](../../test/internal-transfer-gate.service.spec.ts)
- [`A5-IMPLEMENTATION-PLAN.md`](../A5-IMPLEMENTATION-PLAN.md)
- [`ADR-0044-Transfer-Idempotency-Outbox-and-Recovery.md`](ADR-0044-Transfer-Idempotency-Outbox-and-Recovery.md)

## A5T09 verification record

- [x] Durable internal pilot control configuration exists and is disabled by default.
- [x] Explicit canonical Customer UUID cohort selection is enforced.
- [x] Single-transaction and per-customer daily limits are enforced with integer minor units.
- [x] Environment emergency stop fails closed before new transfer admission.
- [x] Durable enable/disable mutation requires A2 authorization, Operations idempotency, and audit evidence.
- [x] Safety thresholds fail closed on missing signals and deny at breached thresholds.
- [x] Disabled controls do not mutate completed transfers or financial history.
- [x] Gate integration prevents disabled/out-of-cohort/over-limit commands from reaching A4 or Ledger.
- [x] No public exposure, external rollout, settlement, A5T10 release evidence, or later task is implemented.
- [ ] Pilot owner approval and activation evidence remain unresolved.
