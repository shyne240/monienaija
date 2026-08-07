# A5 Internal Financial Pilot — Implementation Plan

- **Phase:** A5 — Internal Financial Pilot
- **Status:** Planned
- **Scope:** One bounded, customer-aware, internal money-moving capability using A2 authorization, A3 account binding, A4 policy, Wallet, Ledger, Operations, Outbox, and independent Reconciliation
- **Implementation order:** Architecture phase after the completed A1 Foundation Consolidation, A2 Runtime Identity & Access, A3 Customer-to-Financial Account Binding, and A4 Capability & Policy Engine
- **Recommended first capability:** Internal customer-to-customer transfer
- **Source planning documents:** [`ROADMAP.md`](ROADMAP.md), [`PHASES.md`](PHASES.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md), [`A3-A4-HANDOFF-PACKAGE.md`](A3-A4-HANDOFF-PACKAGE.md), [`A5-COMMAND-CORRELATION-INPUTS.md`](A5-COMMAND-CORRELATION-INPUTS.md)

This document is a planning artifact only. It creates no application source, entity, migration, service, controller, API, route, scheduler, provider integration, financial behavior, or runtime activation.

## 1. Official phase title

**A5 — Internal Financial Pilot**

A5 is an Architecture phase and is not a Product Roadmap milestone. It proves one controlled internal financial command after A2, A3, and A4 have established the trust, account-binding, and policy boundaries. It does not implement external banks, NIBSS, settlement, provider callbacks, public APIs, product expansion, or a general payment platform.

## 2. Phase objective

Activate one narrowly bounded internal money-moving flow—recommended as customer-to-customer transfer—that is:

- initiated for a canonical `Customer.id` subject;
- authorized by A2 at the command boundary;
- gated by the current A4 capability decision for the declared capability/action;
- bound to explicit A3 customer-to-financial-account relationships;
- executed through Wallet/Ledger financial invariants and deterministic account locking;
- represented by an immutable, correlated transaction lifecycle;
- safe under duplicate requests, changed payloads, concurrent commands, timeouts, serialization failures, and unknown outcomes;
- audited and connected to a minimal transactional outbox fact;
- independently verifiable through Reconciliation and support trace evidence; and
- limited to an approved pilot cohort, amount/risk boundary, and reversible release control.

A5 must prove a complete identity-to-command-to-policy-to-account-to-journal-to-outbox-to-reconciliation trace without allowing any A5 command to become an alternative A2, A3, A4, Wallet, Ledger, Operations, or Reconciliation authority.

## 3. Selected pilot boundary

### 3.1 Recommended first capability

The initial pilot is:

```text
capability: wallet.transfer
action: create
scope: internal customer-to-customer transfer
```

The pilot uses two existing, explicitly identified WalletAccount/LedgerAccount targets and one canonical customer subject. It does not call an external provider or settlement rail.

The existing `transfer` module is a starting implementation input, not evidence that the A5 command boundary is complete. A5 must reconcile its current behavior with the A2/A3/A4 contracts before controlled activation.

### 3.2 Pilot financial effect

A successful transfer must produce one balanced Ledger journal with:

- one source customer-funds debit line;
- one destination customer-funds credit line;
- one explicit currency and accounting unit;
- positive integer minor-unit amounts;
- deterministic source/destination account locking;
- a durable transfer-to-journal correlation; and
- no independent balance mutation outside Ledger.

A failed or ambiguous command must not silently report success, post a second effect, or fabricate a balance. A pending/unknown outcome requires durable verification and controlled recovery.

### 3.3 Existing implementation inputs

A5 consumes and must preserve:

- existing `transfer` command/entity/history behavior as compatibility input;
- existing WalletAccount and CustomerFinancialAccountBinding boundaries;
- existing Ledger account/journal/line posting and balance rules;
- Operations AuditService, IdempotencyService, OutboxService, MetricsService, DiagnosticsService, request context, and readiness primitives;
- A2 principal/authorization/privileged-action contracts;
- A4 `wallet.transfer/create` policy profile, decision, limits, obligations, expiry, source references, and recovery result; and
- independent Reconciliation and Finance verification.

Existing transfer, wallet, quote, fee, payment, and ledger routes must not be assumed to be A5-approved exposure merely because they exist in the repository.

## 4. A5 non-goals

A5 does not implement:

- Authentication, sessions, MFA, authorization, route protection, or privileged-action issuance; those remain A2 responsibilities.
- Customer-to-financial-account binding, binding repair, account reassignment, or account provisioning; those remain A3 responsibilities.
- Capability/risk/eligibility/restriction/compliance/limit precedence; those remain A4 responsibilities.
- External banks, NIBSS, providers, settlement, callbacks, suspense, external funding, or partner reconciliation; those are A6 work.
- Deposits, withdrawals, bill payments, airtime, cards, QR payments, virtual-account activation, payroll, savings, credit, or other product expansion; those are later A6/A7/product work.
- A public API, customer portal, notification sender, background scheduler, or external event publisher.
- A second wallet balance, account, journal, line, audit, idempotency, outbox, reconciliation, or policy authority.
- AML, sanctions, fraud, PEP, transaction-monitoring, automated screening, or risk-scoring behavior.
- In-place correction or deletion of financial history. Corrections use approved compensating entries owned by Ledger/Finance.

## 5. Governing architectural boundaries

A5 must preserve the following rules from A1-A4 and the financial core:

1. `Customer.id` is the only canonical customer identity. Customer references, aliases, case numbers, payment references, provider IDs, command IDs, correlation IDs, and idempotency keys remain distinct values.
2. A2 authenticates and authorizes the command caller. An A4 `ALLOW` is not A2 authorization, privileged approval, A3 binding, or financial execution approval.
3. A4 owns action-specific eligibility/policy. A5 consumes the current result and must not duplicate risk, restriction, eligibility, enrollment, permission, compliance, or limit precedence.
4. A3 owns the explicit Customer-to-Financial-Account binding. A5 must not infer or repair a binding from CustomerWallet, WalletAccount compatibility values, currency, alias, or policy output.
5. `CustomerWallet` remains provisioning/ownership metadata, `WalletAccount` remains the financial wallet facade, and `Ledger` remains the authority for financial accounts, journals, lines, balances, and posted value.
6. Money uses integer minor units and explicit currency. No floating-point arithmetic or implicit conversion is permitted.
7. A transfer and its Ledger journal/lines must commit atomically or enter an explicitly defined pending/recovery state. A partial command must never become an untraceable financial effect.
8. Operations owns audit, idempotency, outbox, metrics, diagnostics, request context, and readiness. A5 reuses those primitives.
9. Reconciliation remains independent and read-only. It verifies source and financial truth; it does not repair rows or clear a failed command.
10. Sensitive customer, risk, compliance, security, credential, device, and financial-control data is minimized, classified, access-controlled, and excluded from broad command/event payloads.
11. A5 is a bounded command boundary inside the existing modular monolith. It does not create a microservice or topology change based only on pilot scope.

## 6. Dependencies and required inputs

### A2 inputs

- Authenticated principal, customer scope, audience, assurance, roles/scopes, authorization decision, request/correlation/trace/causation context.
- Protected route/service action policy for the selected internal command.
- Privileged approval only if the selected pilot command or recovery action requires it.
- Session/revocation and security-event behavior.

### A3 inputs

- Canonical Customer UUID.
- Explicit source and destination customer/account binding references.
- CustomerWallet, WalletAccount, and LedgerAccount IDs and ownership relationships.
- Currency, accounting unit, account type, normal balance, active state, source versions, and control/reconciliation state.
- A3 read states including missing, stale, pending, suspended, repair-required, closed, and Ledger-unavailable.

### A4 inputs

- `wallet.transfer/create` policy decision.
- Policy/profile version, definition hash, decision reference, expiry/review, reason codes, obligations, and exact limits.
- Snapshot reference, normalized input hash, source versions, freshness, and recovery/currentness result.
- A2 authorization-context reference and independent downstream recheck obligation.

### Financial and Operations inputs

- Ledger account/journal/line contracts and deterministic locking rules.
- Existing Transfer entity/status/reference behavior as a compatibility input.
- Operations audit, idempotency, transactional outbox, diagnostics, metrics, request context, migration, and readiness contracts.
- Independent Reconciliation and Finance verification queries.
- Existing [`A5-COMMAND-CORRELATION-INPUTS.md`](A5-COMMAND-CORRELATION-INPUTS.md).

## 7. Sequential task breakdown

### A5T01 — Internal Financial Pilot Baseline and Capability Selection

- **Type:** Documentation and implementation baseline
- **ADR input:** ADR-0041 — Customer-Aware Internal Transfer Command Boundary

#### Objective

Inventory the existing transfer, Wallet, Ledger, Operations, quote, fee, payment-reference, reconciliation, route, and support surfaces and select one bounded internal pilot command without treating existing behavior as A5-approved.

#### Deliverables

- `docs/A5-PILOT-BASELINE.md`.
- Existing transfer/ledger/wallet behavior and schema inventory.
- Current transfer idempotency, failure, transaction, audit, outbox, and route gap register.
- A5 pilot capability/action selection and prohibited-capability register.
- A5 dependency, risk, and rollback register.
- Compatibility classification for existing `TransferService` and routes.

#### Acceptance criteria

- Customer-to-customer transfer is either selected as the bounded pilot or a documented alternative is approved before implementation continues.
- Existing transfer behavior is classified as source/compatibility behavior versus required A5 command behavior.
- External provider, settlement, deposit, withdrawal, payment-expansion, and product-expansion edges are explicitly excluded.
- A2, A3, A4, Ledger, Operations, and Reconciliation dependencies are mapped.
- No money movement, schema, API, route, or runtime behavior is changed by this task.

#### Dependencies

- A2, A3, and A4 completed implementation artifacts.
- [`A3-A4-HANDOFF-PACKAGE.md`](A3-A4-HANDOFF-PACKAGE.md).
- [`A4-A5-HANDOFF-PACKAGE.md`](A4-A5-HANDOFF-PACKAGE.md).
- Existing transfer, wallet, ledger, operations, and reconciliation inventories.

#### Explicitly out of scope

- Selecting or activating a pilot cohort.
- Implementing a command, migration, ledger posting, route, or external integration.

### A5T02 — Customer-Aware Transfer Command and Correlation Contract

- **Type:** Documentation and contract design
- **ADR:** ADR-0041 — Customer-Aware Internal Transfer Command Boundary

#### Objective

Define the stable command envelope, canonical customer/account identity, transfer scope, amount/currency, policy references, request context, and correlation chain for the internal pilot.

#### Deliverables

- `docs/ADR/ADR-0041-Customer-Aware-Internal-Transfer-Command-Boundary.md`.
- `docs/A5-TRANSFER-COMMAND-CONTRACT.md`.
- Command ID, Customer UUID, source/destination WalletAccount IDs, A3 binding references, capability/action, request/correlation/trace/causation, and business-reference rules.
- Command normalization and request-hash contract.
- Transfer-to-journal, audit, outbox, and reconciliation correlation map.
- Command error and pending/unknown outcome vocabulary.

#### Acceptance criteria

- The command has one canonical Customer UUID and explicit source/destination account assertions.
- Amounts are positive integer minor-unit values with explicit currency.
- The command carries A2/A4/A3 references without treating any reference as a replacement for canonical identity.
- Request hashes exclude transport-only values and include every command field that changes the financial effect.
- Command ID, idempotency key, request ID, correlation ID, trace ID, causation ID, payment reference, journal ID, and outbox ID remain distinct.
- The contract does not authorize, post, or mutate any financial state.

#### Dependencies

- A5T01.
- ADR-0002, ADR-0003, ADR-0004, ADR-0005, ADR-0008.
- A2/A3/A4 handoff contracts.
- [`A5-COMMAND-CORRELATION-INPUTS.md`](A5-COMMAND-CORRELATION-INPUTS.md).

#### Explicitly out of scope

- Controller/API exposure, provider references, settlement, or command execution.

### A5T03 — Authorization, Policy, and Account-Binding Consumer Gates

- **Type:** Runtime command-boundary implementation
- **ADR:** ADR-0042 — Financial Command Authorization and Policy Evaluation

#### Objective

Implement the consumer gate that validates current A2 authorization, A4 policy, and A3 binding/account state before the transfer can enter a financial transaction.

#### Deliverables

- `docs/ADR/ADR-0042-Financial-Command-Authorization-and-Policy-Evaluation.md`.
- A5 command gate/service integration.
- A2 authorization recheck for the exact command/customer/account scope.
- A4 policy decision subject/capability/action/policy-version/expiry/obligation validation.
- A3 binding/account recheck for source and destination accounts.
- Fail-closed error mapping for missing, stale, expired, denied, pending, suspended, conflicting, or unavailable gates.
- Gate contract and authorization-separation tests.

#### Acceptance criteria

- A2 authorization is checked before any transfer or Ledger mutation.
- A4 `ALLOW`/`ALLOW_WITH_LIMITS` is accepted only for the same canonical customer, capability, action, policy version, evidence scope, and valid time window.
- `PENDING_REVIEW`, `DENY`, `SUSPEND`, expired, superseded, integrity-mismatched, or unavailable policy results cannot execute.
- A3 source/destination binding and account dimensions are current and compatible before posting.
- A5 does not duplicate A4 precedence or mutate A2/A3/A4 source records.
- Missing policy or binding evidence is never interpreted as allow.

#### Dependencies

- A5T01 and A5T02.
- A2 authorization and protected-route contracts.
- A3 binding/read/reconciliation contracts.
- A4 policy/recovery/handoff contracts.

#### Explicitly out of scope

- Creating or repairing bindings, changing eligibility, changing policy decisions, or posting a journal.

### A5T04 — Transfer State, Persistence, and Pending Outcomes

- **Type:** Runtime persistence and lifecycle implementation
- **ADR:** ADR-0045 — Customer Transaction State and Pending Outcomes

#### Objective

Define and implement the transfer lifecycle needed to distinguish accepted, processing, completed, failed, pending-recovery, and unknown outcomes without rewriting financial history.

#### Deliverables

- `docs/ADR/ADR-0045-Customer-Transaction-State-and-Pending-Outcomes.md`.
- Transfer state machine and transition guards.
- Transfer persistence fields for command, customer, account, policy, request, correlation, journal, failure, and recovery references.
- Migration and rollback package where state/schema changes are required.
- Optimistic-lock/version and immutable-completion rules.
- Pending/unknown outcome read contract and state tests.

#### Acceptance criteria

- Every command has a durable state and canonical Customer UUID before or atomically with its financial effect.
- A completed transfer always has one valid Ledger journal reference and cannot be edited into another outcome.
- A failed/pending/unknown outcome is explicit and support-traceable.
- State transitions cannot delete history, silently turn an unknown outcome into success, or clear a journal reference without an approved correction boundary.
- Existing transfer compatibility behavior is changed only through the approved A5 state contract.
- Migration up/down preserves existing Ledger, Wallet, A2, A3, Operations, and Reconciliation records.

#### Dependencies

- A5T01-A5T03.
- ADR-0004, ADR-0005, ADR-0008, ADR-0041.

#### Explicitly out of scope

- External settlement, background workers, financial corrections, and public transaction history APIs.

### A5T05 — Ledger Posting and Financial Invariants Integration

- **Type:** Runtime financial integration
- **ADR:** ADR-0043 — Ledger Posting and Customer Transaction Correlation

#### Objective

Connect the approved transfer command to the existing Ledger posting boundary while preserving double-entry, currency, account-state, balance, and locking invariants.

#### Deliverables

- `docs/ADR/ADR-0043-Ledger-Posting-and-Customer-Transaction-Correlation.md`.
- Transfer-to-Ledger journal/line mapping.
- Source/destination account lock ordering and concurrency contract.
- Explicit currency/accounting-unit validation.
- Journal reference, transfer ID, customer UUID, command ID, and correlation metadata mapping.
- Insufficient-funds, inactive-account, currency-mismatch, and journal-rejection behavior.
- Financial invariant and no-side-effect tests.

#### Acceptance criteria

- One successful transfer creates one balanced journal with equal debit/credit minor units.
- Source and destination accounts are explicitly bound and currency-compatible.
- Concurrent transfers cannot create negative customer-funds balances or duplicate financial effects.
- Ledger remains the authority for balances and posted value.
- A failed command does not leave an untraceable or partially posted financial effect.
- Reversal/correction behavior uses a new approved compensating entry and never mutates posted journal/line history.

#### Dependencies

- A5T03 and A5T04.
- Existing `LedgerService`, WalletAccount, Transfer, and financial invariant contracts.
- ADR-0002, ADR-0004, ADR-0005.

#### Explicitly out of scope

- Ledger redesign, chart-of-accounts expansion beyond approved pilot needs, external rails, fees/commissions, and settlement.

### A5T06 — Idempotency, Concurrency, and Transaction Recovery

- **Type:** Runtime resilience implementation
- **ADR:** ADR-0044 — Transfer Idempotency, Outbox, and Recovery

#### Objective

Make the internal transfer command safe under duplicate requests, changed payloads, concurrent execution, serialization failures, timeouts, and unknown transaction outcomes.

#### Deliverables

- Durable A5 transfer idempotency scope and request-hash implementation.
- Same-key/same-payload replay behavior.
- Same-key/changed-payload conflict behavior.
- Deterministic account locking and bounded serialization/deadlock retry.
- Commit-timeout and unknown-outcome verification path.
- Recovery states and support diagnostics.
- Idempotency, concurrency, timeout, replay, conflict, and failure tests.

#### Acceptance criteria

- An identical retry returns the durable original transfer outcome without a second journal or line set.
- A changed payload under the same scope/key is rejected without financial mutation.
- Concurrent commands cannot create duplicate transfer effects or ambiguous current state.
- Serialization/deadlock retries are bounded and use the same logical command identity.
- A client timeout after commit is resolved from durable Transfer/Ledger/Operations evidence before any retry decision.
- An unknown outcome never becomes an optimistic success and never instructs a financial command to retry blindly.
- A5 does not create a module-local idempotency or audit store.

#### Dependencies

- A5T02-A5T05.
- Existing Operations IdempotencyService, AuditService, DiagnosticsService, and ADR-0008.

#### Explicitly out of scope

- Distributed caches, message brokers, external provider retries, and unbounded background recovery workers.

### A5T07 — Transactional Outbox and Internal Transfer Event Contract

- **Type:** Runtime event-boundary implementation
- **ADR:** ADR-0044 — Transfer Idempotency, Outbox, and Recovery

#### Objective

Publish a minimal durable internal transfer fact atomically with the transfer state/financial transaction without introducing an external event publisher.

#### Deliverables

- Versioned internal transfer event contract.
- `transfer.completed`, `transfer.failed`, and pending/recovery facts as approved by the command state model.
- Transactional outbox write linked to the transfer and journal where applicable.
- Event identity, aggregate identity, command/correlation/causation references, occurrence time, classification, and retention fields.
- Duplicate/replay/tamper-safe outbox tests.
- No-broker/no-external-publisher boundary evidence.

#### Acceptance criteria

- Transfer domain state, Ledger posting, audit evidence, and the approved outbox fact commit atomically where the flow requires it.
- Outbox payloads contain minimum necessary data and no credentials, raw risk/compliance content, full ledger payloads, or unnecessary customer data.
- Event identity/payload is immutable after creation; publisher lifecycle state remains Operations-owned.
- Consumers are not assumed to receive exactly-once delivery.
- Duplicate, delayed, and out-of-order internal facts are safe for future consumers.
- An outbox fact never replaces the authoritative Transfer or Ledger record.

#### Dependencies

- A5T04-A5T06.
- ADR-0003, ADR-0008, Operations OutboxService, and existing outbox schema.

#### Explicitly out of scope

- Broker/publisher deployment, external notifications, partner callbacks, A6 events, and customer messaging.

### A5T08 — Independent Reconciliation, Diagnostics, and Support Trace

- **Type:** Runtime control and operational evidence implementation
- **ADR inputs:** ADR-0005, ADR-0008, ADR-0045

#### Objective

Prove that transfer, Wallet, Ledger, Operations, policy, account-binding, and outbox evidence can be inspected independently and support can trace a command without repairing source records.

#### Deliverables

- Transfer-to-journal-to-customer/account reconciliation query/report.
- Independent checks for balanced journal, transfer status/journal linkage, customer/account ownership, currency/accounting unit, idempotency outcome, and outbox linkage.
- Diagnostics/readiness integration for transfer pilot state.
- Support trace contract using canonical IDs, command/request/correlation/causation, policy, journal, outbox, and reconciliation references.
- Failure, drift, unknown-outcome, and read-only reconciliation tests.
- A5 operational recovery runbook inputs.

#### Acceptance criteria

- Reconciliation queries source tables independently of TransferService/LedgerService write methods.
- A completed transfer without a valid journal, or a journal without a valid transfer correlation, is reported as a controlled discrepancy.
- Customer/account ownership and currency/control mismatches are explicit.
- Reconciliation never updates Transfer, Wallet, Ledger, audit, outbox, or policy rows to make a report pass.
- Diagnostics are observational and cannot authorize or repair a financial command.
- Support trace output is classified and minimized.

#### Dependencies

- A5T04-A5T07.
- Existing ReconciliationService, Ledger, Wallet, Operations, A3 control, and A4 recovery contracts.

#### Explicitly out of scope

- Automatic reconciliation repair, financial correction, settlement reconciliation, or external provider reconciliation.

### A5T09 — Pilot Limits, Cohorts, Rollback, and Safety Controls

- **Type:** Pilot safety and release-control implementation
- **ADR:** ADR-0046 — Pilot Limits, Cohorts, and Rollback

#### Objective

Constrain the internal pilot to an explicit cohort and bounded amount/risk envelope with a command-level disable/rollback strategy that does not corrupt financial history.

#### Deliverables

- `docs/ADR/ADR-0046-Pilot-Limits-Cohorts-and-Rollback.md`.
- Pilot cohort eligibility/allowlist or equivalent approved control.
- A4 limit/obligation handoff to execution-time usage checks.
- Feature/command kill switch or disable control.
- Pilot amount, currency, frequency, account, and operational thresholds.
- Go/no-go, stop-condition, rollback, and customer/support communication contract.
- Pilot safety and rollback tests.

#### Acceptance criteria

- Only explicitly selected internal customers/accounts can enter the pilot.
- Pilot limits are exact, currency-labelled, bounded, and independently enforced at command time.
- Disable behavior stops new commands without deleting or rewriting completed financial history.
- Rollback does not reverse financial value by editing rows; approved compensating entries remain the Ledger/Finance boundary.
- A4 `PENDING_REVIEW`, `DENY`, `SUSPEND`, expired, or unknown results cannot enter the cohort execution path.
- Pilot stop conditions include reconciliation error, audit/idempotency failure, unexplained balance drift, journal imbalance, outbox corruption, authorization failure, and repeated unknown outcomes.

#### Dependencies

- A5T03-A5T08.
- ADR-0005, ADR-0008, ADR-0009, ADR-0010, ADR-0046.
- A4 limit/expiry/recovery contract.

#### Explicitly out of scope

- Broad customer activation, public launch, external provider activation, product expansion, and A6 settlement.

### A5T10 — A5 Integration, Pilot Release Gate, and A6 Handoff

- **Type:** Integration and phase-exit evidence
- **ADR review:** ADR-0041 through ADR-0046

#### Objective

Validate the complete internal financial pilot and prepare the next-phase handoff without beginning A6 external-partner implementation or broader Product Roadmap activation.

#### Deliverables

- `docs/A5-INTEGRATION-MATRIX.md`.
- `docs/A5-ROUTE-EXPOSURE-AND-ROLLBACK.md`.
- `docs/A5-ADR-REVIEW-STATUS.md`.
- `docs/A5-OPERATIONAL-RECOVERY-RUNBOOK.md`.
- `docs/A5-EXIT-CHECKLIST.md`.
- `docs/A5-APPROVAL-PACKAGE.md`.
- `docs/A5-A6-HANDOFF-PACKAGE.md`.
- End-to-end identity-to-command-to-policy-to-binding-to-Ledger-to-outbox-to-reconciliation trace.
- Concurrent double-spend, idempotent retry, changed-payload, timeout/unknown-outcome, journal, outbox, audit, support, and rollback evidence.
- Pilot cohort/limit/disable evidence.
- A6 entry conditions and prohibited-edge register.

#### Acceptance criteria

- The selected pilot command maps to A2 authorization, A4 policy, A3 binding, Wallet, Ledger, Operations, Outbox, and Reconciliation contracts.
- One successful command produces one traceable balanced financial effect and one approved internal event fact.
- Duplicate, changed, concurrent, failed, timed-out, and unknown commands have deterministic safe outcomes.
- Independent Reconciliation confirms transfer/journal/account/currency integrity.
- Support can trace a command without exposing secrets or unrestricted financial/risk/compliance data.
- Disable/rollback controls stop new pilot activity without rewriting financial history.
- No external provider, settlement, public API, product expansion, A6, A7, or A8 implementation is included.
- All unresolved implementation risks have an owner, severity, mitigation, stop condition, and rollback/disable behavior.

#### Dependencies

- A5T01-A5T09.
- A2, A3, and A4 phase artifacts.
- Existing transfer, Wallet, Ledger, Operations, and Reconciliation modules.
- Finance, Risk, Security, Compliance, Operations, Product, and support review inputs.

#### Explicitly out of scope

- A6 external partner and settlement implementation.
- A7 product expansion infrastructure.
- Public APIs, mobile/web channels, notification delivery, and general customer activation.

## 8. A5 critical path

```text
A5T01 Pilot baseline and capability selection
  -> A5T02 Customer-aware command/correlation contract
  -> A5T03 A2/A4/A3 consumer gates
  -> A5T04 Transfer state and persistence
  -> A5T05 Ledger posting and financial invariants
  -> A5T06 Idempotency, concurrency, and recovery
  -> A5T07 Transactional outbox and internal event
  -> A5T08 Independent reconciliation and support trace
  -> A5T09 Pilot limits, cohort, and rollback controls
  -> A5T10 A5 integration, pilot release gate, and A6 handoff
```

A5T02 and A5T03 may be reviewed in parallel after A5T01, but no command implementation may execute before both are defined. A5T05 and A5T06 must be designed together because the command transaction, Ledger locks, idempotency outcome, and timeout/retry behavior must be one coherent boundary. A5T08 may prepare independent queries alongside A5T04-A5T07 but cannot pass until the transfer and journal records exist. A5T09 cannot authorize a cohort until the full command/reconciliation path is tested. A6 remains outside A5.

## 9. A5 integration trace

```text
A2 authenticated principal / authorization context
                       |
                       v
A5 InternalTransferCommand
  Customer.id + source/destination WalletAccount IDs
  amountMinor + currency + idempotency + correlation
                       |
                       v
A4 current policy decision
  wallet.transfer/create + policy version + limits + expiry
                       |
                       v
A3 binding/account recheck
  CustomerWallet -> WalletAccount -> LedgerAccount
  currency + accounting unit + lifecycle/control state
                       |
                       v
A5 transaction boundary
  transfer lifecycle record
  deterministic Wallet/Ledger account locks
  balanced Ledger journal and lines
  Operations audit + idempotency + transactional outbox
                       |
                       v
Read/support/recovery
  transfer result + journal reference + outbox fact
  independent reconciliation + diagnostics
                       |
                       v
Pilot cohort control
  bounded internal exposure + disable/rollback
```

A5 is a command/execution boundary, not a replacement for A2, A3, A4, Wallet, Ledger, Operations, or Reconciliation.

## 10. A5 prohibited edges

- A5 treats A4 `ALLOW` as authentication, authorization, account ownership, or sufficient financial execution approval.
- A5 chooses a WalletAccount/LedgerAccount from a customer reference, alias, provider ID, currency, or policy result.
- A5 writes Customer, CustomerWallet, eligibility, restrictions, limits, enrollment, permissions, risk, compliance, A3 binding, or policy records to make a transfer pass.
- A5 posts unbalanced journals, mutates posted lines/balances, or stores an independent wallet balance.
- A5 executes a financial effect before A2/A3/A4 gates and command invariants pass.
- A5 creates module-local idempotency, audit, outbox, reconciliation, or readiness authorities.
- A5 treats an outbox fact, payment reference, command ID, or provider ID as financial truth.
- A5 uses reconciliation, diagnostics, readiness, or support views as repair writers.
- A5 retries an unknown financial outcome blindly or selects a new financial target after an ambiguous commit.
- A5 calls banks, NIBSS, external providers, settlement, notification providers, or partner systems.
- A5 exposes a route merely because a transfer service exists; A2 route/data-exposure controls remain required.
- A5 begins A6, A7, A8, public APIs, product expansion, or external settlement.

## 11. A5 phase exit criteria

A5 is complete only when:

- One approved bounded internal financial capability has a customer-aware command contract.
- A2 authorization, A4 policy, A3 binding, Wallet, Ledger, Operations, Outbox, and Reconciliation boundaries are integrated and independently traceable.
- Customer UUID, WalletAccount IDs, LedgerAccount IDs, command ID, idempotency key/hash, request/correlation/trace/causation IDs, policy decision reference/version, journal ID, and outbox ID remain distinct and queryable.
- Successful commands create one balanced journal with exact currency/minor-unit behavior and no duplicate financial effect.
- Concurrent commands cannot create a double-spend, duplicate mapping, duplicate journal, or ambiguous current transfer state.
- Identical retries replay the durable original; changed payloads conflict; timeout/unknown outcomes are verified from durable evidence before retry.
- Transfer lifecycle and pending/failed states are truthful, immutable where required, and support-traceable.
- Outbox facts are minimal, redacted, versioned, durable, and transactionally linked to the owning state mutation.
- Independent Reconciliation confirms financial/source integrity and never repairs rows.
- Pilot limits, cohort controls, stop conditions, disable behavior, rollback, and support ownership are documented and tested.
- No A6 external partner, settlement, public API, A7 product expansion, A8 extraction, or mobile/web implementation is included.
- A5 approval and A6 handoff conditions are recorded without claiming activation solely from implementation evidence.

## 12. A5 handoff to A6/A7

A5 may provide later phases with:

- bounded customer-aware command and transaction-state contracts;
- canonical customer/account/journal/outbox correlation chain;
- idempotent recovery and unknown-outcome evidence;
- Ledger and independent Reconciliation evidence;
- Operations audit/idempotency/outbox/diagnostic patterns;
- pilot limit/cohort/disable/rollback controls; and
- explicit external-integration and product-expansion boundaries.

A5 must not provide later phases with:

- a claim that the pilot proves external settlement or provider reliability;
- credentials, tokens, raw risk/compliance evidence, or unrestricted financial history;
- mutable balance or journal sources;
- a replacement A2 authorization, A3 binding, A4 policy, Ledger, or Reconciliation authority; or
- permission to skip A6 partner/callback/settlement review or A7 product-specific governance.

A6 remains responsible for external adapters, callback authenticity, settlement, suspense, provider idempotency, external reconciliation, and partner rollback. A7 remains responsible for product expansion contracts, channels, notifications, support/reporting infrastructure, and product-specific governance.

## 13. A5 plan verification record

- [x] Official phase title is A5 — Internal Financial Pilot.
- [x] Recommended first capability is one internal customer-to-customer transfer.
- [x] A2, A3, A4, Wallet, Ledger, Operations, Outbox, and Reconciliation dependencies are explicit.
- [x] Command identity, financial correlation, idempotency, causation, and support-trace requirements are explicit.
- [x] Ledger, currency, minor-unit, deterministic-locking, double-entry, and no-balance-mutation boundaries are explicit.
- [x] Pending/unknown outcomes, bounded retry, outbox replay, independent reconciliation, and rollback are explicit.
- [x] Pilot limits/cohort/disable controls are separated from broad product activation.
- [x] A5 prohibited edges and A6/A7 handoff conditions are explicit.
- [x] No application source, entity, migration, service, controller, API, route, scheduler, provider, financial behavior, or runtime activation is created by this planning task.
