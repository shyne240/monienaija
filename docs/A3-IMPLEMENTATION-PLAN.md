# A3 Customer-to-Financial Account Binding — Implementation Plan

- **Phase:** A3 Customer-to-Financial Account Binding
- **Status:** Planned
- **Scope:** Canonical, idempotent, repairable mapping between Customer Foundation wallet metadata and ledger-backed financial accounts
- **Implementation order:** Architecture phase after the completed A1 Foundation Consolidation and A2 Runtime Identity & Access
- **Source planning documents:** [`ROADMAP.md`](ROADMAP.md), [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md), [`PHASES.md`](PHASES.md), [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md)

## 1. Purpose of A3

A3 makes the relationship between Customer Foundation identity/wallet metadata and ledger-backed financial accounts explicit, unique, idempotent, repairable, and independently reconcilable. It enables truthful customer account and balance reads without moving money or making customer metadata a financial source of truth.

A3 must preserve:

- `Customer.id` as the canonical customer identity.
- `CustomerWallet` as provisioning/ownership metadata until the approved binding exists.
- `WalletAccount` as the financial wallet facade.
- `ledger` as the sole authority for financial accounts, journals, lines, balances, and posted value.
- Independent reconciliation as a read-only financial control.
- Operations audit, idempotency, diagnostics, readiness, and recovery primitives.
- A2 authentication/authorization as a prerequisite for protected binding commands.

## 2. A3 non-goals

A3 does not implement:

- Authentication, sessions, MFA, authorization, privileged approval, or route protection; those belong to A2.
- A capability/policy engine, risk precedence, compliance screening, or product eligibility decisions; those belong to A4.
- Transfers, deposits, withdrawals, payment execution, external banks/NIBSS, settlement, suspense, or partner callbacks; those belong to A5/A6.
- Customer balances stored or mutated in Customer Foundation tables.
- A new mutable financial account or ledger authority outside `wallet`/`ledger`.
- Product-specific pricing, fees, commissions, customer tiers, classes of service, or notification behavior.
- Service extraction or a microservice boundary based only on account-binding requirements.

## 3. Governing inputs and dependencies

### Architecture and ADR inputs

- [`ADR-0002-Money-Representation.md`](ADR/ADR-0002-Money-Representation.md): exact minor units and explicit currency.
- [`ADR-0004-Wallet-and-Ledger.md`](ADR/ADR-0004-Wallet-and-Ledger.md): ledger-backed liability wallets and immutable financial value.
- [`ADR-0005-Independent-Reconciliation.md`](ADR/ADR-0005-Independent-Reconciliation.md): independent read-only finance verification.
- [`ADR-0008-Operational-Resilience.md`](ADR/ADR-0008-Operational-Resilience.md): idempotency, audit, outbox, readiness, and bounded retry.
- [`ADR-0012-Customer-Foundation.md`](ADR/ADR-0012-Customer-Foundation.md): canonical customer identity and financial separation.
- [`ADR-0015-Customer-Wallet-Provisioning.md`](ADR/ADR-0015-Customer-Wallet-Provisioning.md): non-financial Customer Wallet metadata.
- [`ADR-0020-Foundation-Closure-and-Scope-Boundary.md`](ADR/ADR-0020-Foundation-Closure-and-Scope-Boundary.md): A1 boundary and no premature activation.
- [`ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md`](ADR/ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md): ownership and prohibited shared writes.
- [`ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md): canonical IDs, references, scoped idempotency, and correlation.
- [`ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md): data handling, retention, holds, and external-sharing restrictions.

### Platform inputs

- A1 canonical ownership, dependency, privacy, and exit package.
- A2 authenticated principal, authorization decision, request/correlation/trace context, and privileged-action controls.
- [`PLATFORM-CUSTOMER-INVENTORY.md`](PLATFORM-CUSTOMER-INVENTORY.md), [`MODULE-SCHEMA-API-INVENTORY.md`](MODULE-SCHEMA-API-INVENTORY.md), and [`ARCHITECTURE-INVENTORY.md`](ARCHITECTURE-INVENTORY.md).
- Existing `customer-wallet`, `wallet`, `ledger`, `reconciliation`, `operations`, and `production` modules.

## 4. Sequential task breakdown

### A3T01 — Binding Baseline and Customer-to-Account Identity Map

- **Type:** Documentation and implementation baseline
- **ADR input:** ADR-0031 — Customer-to-Financial-Account Identity Binding

#### Objective

Inventory current CustomerWallet, WalletAccount, LedgerAccount, legacy customer references, currencies, accounting units, and existing reconciliation paths before binding implementation.

#### Prerequisites

- A1 and A2 exit approvals.
- Current module/schema/API inventory.
- Existing wallet, ledger, migration, and reconciliation evidence.

#### Scope

- Canonical Customer UUID to CustomerWallet relationships.
- Legacy/opaque `WalletAccount.customerId` compatibility values.
- Wallet/currency/accounting-unit combinations.
- Existing financial and metadata ownership.
- Mapping gaps, duplicates, orphaned metadata, and incompatible lifecycle states.

#### Expected files to change

- `docs/A3-BINDING-BASELINE.md`
- A3 decision/identity-map documentation only
- No application source, entity, migration, or API changes

#### Validation requirements

- Source/entity/migration scan for customer, wallet, ledger, and account IDs.
- Duplicate/orphan mapping query design review.
- Cross-reference review against ADR-0002, ADR-0004, ADR-0005, ADR-0012, and ADR-0015.

#### Acceptance criteria

- Every existing customer-wallet/financial-wallet relationship has a declared current owner.
- Canonical Customer UUID and financial account identifiers are distinguished.
- Legacy opaque references are identified without silently rewriting financial records.
- Duplicate, orphan, currency, accounting-unit, and lifecycle risks are enumerated.

#### Exit criteria

- A3 identity map and gap register are approved by Customer Engineering, Wallet, Ledger, Finance, and Reconciliation owners.
- A3T02 has an agreed ownership decision input.

#### Dependencies on previous tasks

- A1T02, A1T03, A1T05, A1T08, A1T13, A1T14.
- A2T06 and A2T08 for protected command context.

#### Explicitly out of scope

- Binding schema creation, data migration, balance changes, account creation, or repair execution.

### A3T02 — Binding Ownership and Financial Account Lifecycle Contract

- **Type:** Documentation/ADR decision
- **ADR:** ADR-0031 — Customer-to-Financial-Account Identity Binding and ADR-0033 — Financial Account Ownership and Lifecycle Authority

#### Objective

Choose the single binding authority and define source ownership, lifecycle, uniqueness, shared-read, prohibited-write, and deactivation rules.

#### Prerequisites

- A3T01 baseline and gap register.
- A1 canonical ownership matrix.
- A2 principal/authorization contract.

#### Scope

- Binding subject: Customer UUID, CustomerWallet UUID, WalletAccount UUID, LedgerAccount UUID.
- One-to-one/one-to-many currency and account rules.
- Active, pending, suspended, closed, and repair-required states.
- Ownership transfer prohibition or approved workflow boundary.
- Source/projection/read-model write rules.
- Financial account lifecycle versus customer-wallet provisioning lifecycle.

#### Expected files to change

- `docs/ADR/ADR-0031-Customer-to-Financial-Account-Identity-Binding.md`
- `docs/ADR/ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md`
- `docs/A3-BINDING-OWNERSHIP-MATRIX.md`
- No application source changes

#### Validation requirements

- Matrix-to-ADR consistency review.
- Wallet/ledger/customer ownership review.
- Prohibited-shared-write and financial-invariant review.

#### Acceptance criteria

- One authoritative binding owner is named.
- Ledger remains authoritative for financial value and account state.
- CustomerWallet cannot mutate balances or posted journals.
- Binding uniqueness and lifecycle transitions are explicit.
- A2 authorization, Operations audit/idempotency, and Reconciliation dependencies are explicit.

#### Exit criteria

- ADR-0031/0033 decision inputs are approved for schema design.
- A3T03 may define the binding record without changing source authorities.

#### Dependencies on previous tasks

- A3T01; ADR-0004, ADR-0005, ADR-0012, ADR-0015, ADR-0021.

#### Explicitly out of scope

- Implementing the binding entity, migration, account provisioning, or financial commands.

### A3T03 — Wallet Provisioning to Ledger Account Mapping Contract

- **Type:** Documentation/contract design
- **ADR:** ADR-0032 — Wallet Provisioning to Ledger Account Mapping

#### Objective

Define the deterministic mapping contract from approved CustomerWallet provisioning state to WalletAccount/LedgerAccount references.

#### Prerequisites

- A3T02 ownership/lifecycle contract.
- ADR-0002 currency/money rules.
- Existing Wallet and Ledger APIs/services and migration schema.

#### Scope

- Currency and accounting-unit compatibility.
- Ledger account type/normal-balance requirements.
- Provisioning preconditions and postconditions.
- Binding idempotency key/request hash.
- Duplicate mapping and concurrent-provisioning behavior.
- Failure states and compensating/retry-safe actions.

#### Expected files to change

- `docs/ADR/ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md`
- `docs/A3-WALLET-LEDGER-MAPPING-CONTRACT.md`
- No application source changes

#### Validation requirements

- Mapping examples for supported currencies and accounting units.
- Currency mismatch, missing account, duplicate mapping, and partial-failure scenarios.
- Cross-reference against ADR-0002, ADR-0004, ADR-0005, and A5 command-correlation inputs.

#### Acceptance criteria

- Mapping is deterministic and reproducible.
- No mapping operation creates or changes monetary value unexpectedly.
- Currency/accounting-unit mismatch fails closed.
- Retry behavior is idempotent and auditable.
- A3 never uses a display/reference value as financial identity.

#### Exit criteria

- Mapping request/result contract and failure-state matrix are approved.
- A3T04 can implement the binding record and migration.

#### Dependencies on previous tasks

- A3T02; A2T02-A2T08; ADR-0002, ADR-0004, ADR-0023.

#### Explicitly out of scope

- Journal posting, transfers, balance mutation, external providers, and settlement.

### A3T04 — Binding Record Schema and Migration Package

- **Type:** Runtime persistence implementation
- **ADR:** ADR-0031, ADR-0032, ADR-0033

#### Objective

Implement the approved binding record, database constraints, indexes, relationships, migration, and repository contract without copying balances.

#### Prerequisites

- A3T01-A3T03 approval.
- Exact migration-head and rollback procedure.
- A2 protected command context.

#### Scope

- Binding record owned by the authority selected in A3T02.
- CustomerWallet, WalletAccount, LedgerAccount identifiers.
- Currency/accounting-unit and lifecycle fields.
- Unique active mapping constraints.
- Optimistic locking, timestamps, audit fields, and soft-deletion/retention rules where approved.
- Migration up/down and backward-compatible deployment order.

#### Expected files to change

- Approved A3 binding module/entity/service/repository files selected by ADR-0031.
- A new migration after the current migration head.
- A3 persistence tests.
- No changes to ledger source tables beyond approved foreign keys/constraints.

#### Validation requirements

- Migration apply/revert test.
- Constraint/index/foreign-key inspection.
- Duplicate and concurrent write tests.
- No balance/journal copy scan.

#### Acceptance criteria

- Exactly one active approved mapping is possible for each declared binding scope.
- Invalid customer/wallet/ledger relationships fail closed.
- Posted financial records remain immutable.
- Migration is reversible and does not delete source financial data.
- All mutations use Operations audit and approved idempotency contracts.

#### Exit criteria

- Schema migration and persistence tests pass.
- Migration head/readiness evidence is updated only for the A3 migration.
- A3T05 can execute idempotent provisioning.

#### Dependencies on previous tasks

- A3T01-A3T03 and A2T08.

#### Explicitly out of scope

- Customer-facing balance API, policy decisions, transfer execution, and external integration.

### A3T05 — Idempotent Customer-Wallet Account Binding Execution

- **Type:** Runtime command implementation
- **ADR:** ADR-0035 — Account Binding Idempotency and Repair

#### Objective

Provision or bind a financial account through the approved contract with safe retries, authorization, audit, optimistic locking, and no monetary side effects.

#### Prerequisites

- A3T04 binding schema/migration.
- A2 authenticated principal and authorization decision.
- Approved Wallet/Ledger read/write contract.
- Operations idempotency and audit services.

#### Scope

- Binding/provisioning command.
- Scoped idempotency key and canonical request hash.
- CustomerWallet precondition checks.
- WalletAccount/LedgerAccount relationship checks.
- Safe retry/replay and changed-payload rejection.
- Transactional audit/outbox fact where the approved contract requires it.

#### Expected files to change

- A3 binding service/command/DTO/contract files in the approved owner module.
- A3 service/controller integration only for the approved internal route.
- Unit/concurrency/replay tests.

#### Validation requirements

- Identical retry returns the original mapping.
- Changed request under the same key conflicts.
- Concurrent provisioning cannot create duplicate mappings.
- Authorization, audit, migration, and ledger-read checks are exercised.

#### Acceptance criteria

- A2 authorization is checked before binding mutation.
- CustomerWallet metadata never writes balances or journals.
- Binding creates no monetary value and cannot silently choose another customer/account.
- Errors are safe, auditable, and recoverable.

#### Exit criteria

- Provisioning and replay/concurrency tests pass.
- A3T06 may implement read-only customer account views.

#### Dependencies on previous tasks

- A3T04; A2T02-A2T08; ADR-0004, ADR-0005, ADR-0008, ADR-0035.

#### Explicitly out of scope

- Payment authorization, transaction execution, balance mutation, external rails, and A4 policy evaluation.

### A3T06 — Customer Financial Account Read Model

- **Type:** Runtime read-model implementation
- **ADR:** ADR-0034 — Customer Financial Account Read Model

#### Objective

Expose an authorized, read-only customer financial-account view that derives account/balance information from the binding and ledger authorities.

#### Prerequisites

- A3T04 binding record and A3T05 provisioning contract.
- A2 route/authentication/authorization boundary.
- Ledger balance/read contracts and reconciliation definitions.

#### Scope

- Customer-to-wallet/account view.
- Ledger-derived balance, currency, accounting unit, and lifecycle status.
- Read-only customer self-access and approved operator/support scopes.
- Stale/missing binding and reconciliation warning representation.
- Response minimization and data classification.

#### Expected files to change

- A3 read-model/view/DTO/query files in the approved owner module.
- Authorized route integration files only for the approved account-view route.
- Read-model and authorization tests.

#### Validation requirements

- Customer cannot read another customer’s account.
- Returned balance is ledger-derived and currency-labelled.
- Missing/stale binding does not produce a fabricated account or balance.
- Read model does not write source tables.

#### Acceptance criteria

- Ledger remains the balance authority.
- Read model contains no mutable balance source.
- A2 authorization is enforced before restricted financial data is returned.
- Currency/accounting-unit context is explicit.
- Reconciliation/control status is not confused with financial execution status.

#### Exit criteria

- Self-access, operator-scope, missing-binding, stale-binding, currency, and read-only tests pass.
- A3T07 can validate binding/read-model consistency independently.

#### Dependencies on previous tasks

- A3T05; ADR-0005, ADR-0034; A2T06/A2T08.

#### Explicitly out of scope

- Customer-facing product activation, transaction commands, payments, fees, commissions, or A4 policy decisions.

### A3T07 — Binding Reconciliation and Drift Controls

- **Type:** Runtime control implementation
- **ADR:** ADR-0005, ADR-0035

#### Objective

Independently reconcile customer-wallet bindings, WalletAccount relationships, ledger accounts, lifecycle state, currency, and accounting unit.

#### Prerequisites

- A3T04 binding schema.
- A3T05 provisioning lifecycle.
- A3T06 read model.
- Existing Reconciliation and Operations contracts.

#### Scope

- Binding-to-wallet-to-ledger consistency queries.
- Duplicate, orphan, missing, closed, stale, currency-mismatch, and account-ownership discrepancy classes.
- Read-only reconciliation report and severity/owner assignment.
- Release/readiness integration without source mutation.
- Evidence retention and legal-hold handling.

#### Expected files to change

- Reconciliation query/report files.
- A3 discrepancy types and read-only diagnostics.
- Reconciliation/concurrency/failure tests.

#### Validation requirements

- Synthetic consistent and inconsistent mapping scenarios.
- Independent queries do not call binding write services.
- Reports identify source references, severity, owner, and recovery state.
- No repair is performed by a report query.

#### Acceptance criteria

- Every discrepancy class has an owner and controlled outcome.
- Ledger/source records are never edited to clear a discrepancy.
- Reconciliation warnings/errors affect readiness only through existing policy.
- Evidence is correlated and classified without exposing secrets.

#### Exit criteria

- Binding reconciliation passes consistent-state scenarios and detects injected drift.
- Repair/exception work is handed to A3T08.

#### Dependencies on previous tasks

- A3T04-A3T06; ADR-0005, ADR-0008, ADR-0035.

#### Explicitly out of scope

- Automated financial correction, journal posting, external reconciliation, settlement, or provider callbacks.

### A3T08 — Mapping Repair, Exceptions, and Recovery

- **Type:** Runtime recovery implementation
- **ADR:** ADR-0035 — Account Binding Idempotency and Repair

#### Objective

Provide controlled, authorized, auditable repair and exception handling for failed or ambiguous account-binding operations.

#### Prerequisites

- A3T07 discrepancy classes and ownership.
- A2 privileged-action approval and route policy.
- Operations audit/idempotency/diagnostics and existing recovery conventions.

#### Scope

- Repair command and approval requirements.
- Retryable versus manual-review versus blocked states.
- Stale/duplicate/orphan mapping resolution.
- Rollback/compensating metadata for incomplete provisioning.
- Audit, incident, legal-hold, and support evidence.

#### Expected files to change

- A3 repair/exception service, command, DTO, and approved internal route files.
- Repair/replay/failure tests.
- A3 operational runbook evidence.

#### Validation requirements

- Partial failure, timeout, duplicate, stale version, authorization denial, and replay scenarios.
- Repair cannot mutate balances or posted journals.
- Every repair has an owner, reason, approval, correlation ID, and audit record.

#### Acceptance criteria

- No silent repair or implicit account reassignment is possible.
- Privileged repair requires A2 approval and separation of duties.
- Repair outcomes are idempotent and reconciled.
- Customer-visible state remains truthful during pending/recovery outcomes.

#### Exit criteria

- Repair and exception tests pass.
- A3T09 can use defined drift/recovery outcomes as a release gate.

#### Dependencies on previous tasks

- A3T05-A3T07; A2T06-A2T08; ADR-0021, ADR-0024, ADR-0035.

#### Explicitly out of scope

- Ledger correction entries, payment recovery, external settlement, and A5 financial command recovery.

### A3T09 — A3 Integration, Reconciliation, and Release Gate

- **Type:** Integration and release evidence
- **ADR review:** ADR-0031 through ADR-0035

#### Objective

Validate the complete A3 binding boundary and prepare A3 approval without beginning A4 or A5 implementation.

#### Prerequisites

- A3T01-A3T08.
- A1 and A2 exit approvals.
- Finance, Ledger, Wallet, Reconciliation, Security, Operations, and accountable release-owner review.

#### Scope

- End-to-end identity-to-binding-to-read-model trace.
- Concurrent provisioning, retry, repair, drift, reconciliation, authorization, and rollback evidence.
- Migration/readiness and operational runbook evidence.
- ADR-0031 through ADR-0035 review.
- A4/A5 handoff conditions.

#### Expected files to change

- A3 integration matrix.
- A3 route/exposure and rollback evidence.
- A3 ADR review status.
- A3 exit checklist and approval package.
- No A4/A5 implementation files.

#### Validation requirements

- Full A3 test suite, lint, build, migration apply/revert, route/authorization, concurrency, and reconciliation checks.
- Confirm no balance/journal mutation outside Ledger.
- Confirm Product Roadmap and A1/A2 boundaries remain unchanged.

#### Acceptance criteria

- Customer UUID to account mappings reconcile.
- Duplicate mappings are impossible.
- Provisioning is idempotent and repairable.
- Customer account/balance views are read-only and ledger-derived.
- No mapping operation creates or changes monetary value unexpectedly.
- All unresolved risks have owners, dates, severity, and rollback/mitigation state.

#### Exit criteria

- A3 is approved by accountable owners as a truthful customer-to-financial-account binding boundary.
- A4 and A5 may begin only through their approved dependencies.
- No A4/A5/A6/A7/A8 implementation is included in the A3 exit package.

#### Dependencies on previous tasks

- A3T01-A3T08; A1/A2 exit packages; ADR-0031 through ADR-0035.

#### Explicitly out of scope

- A4 capability/policy implementation, A5 money movement, A6 external partners, A7 product expansion, and A8 scale/extraction.

## 5. A3 critical path

```text
A3T01 Baseline and identity map
  -> A3T02 Ownership/lifecycle contract
  -> A3T03 Wallet/ledger mapping contract
  -> A3T04 Binding schema and migration
  -> A3T05 Idempotent provisioning/binding
  -> A3T06 Read-only financial account view
  -> A3T07 Independent binding reconciliation
  -> A3T08 Repair and exception recovery
  -> A3T09 A3 integration and release gate
```

A3T07 reconciliation query design may be prepared alongside A3T04-A3T06, but A3T07 acceptance waits for the binding record and read model. A3T08 cannot repair records without A2 privileged-action approval. A4/A5 implementation remains blocked until A3T09 approval.

## 6. A3 prohibited edges

- Customer metadata or the A3 binding record mutates ledger balances, posted journals, or journal lines.
- A3 treats a customer reference, wallet alias, payment reference, or provider ID as canonical financial identity.
- A3 embeds A4 eligibility/risk/compliance policy or duplicates A2 authorization.
- A3 reports repair success without independent reconciliation evidence.
- A3 calls external banks, NIBSS, settlement, or partner systems.
- A3 creates transfers, deposits, withdrawals, payments, fees, commissions, or product pricing.
- A3 copies mutable balances into CustomerWallet or another customer metadata table.
- A3 uses a dashboard or readiness report to mutate source records.
