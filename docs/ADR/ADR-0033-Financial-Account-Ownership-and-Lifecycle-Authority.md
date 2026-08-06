# ADR-0033: Financial Account Ownership and Lifecycle Authority

- **Status:** Proposed for A3 schema-design approval
- **Date:** 2026-08-06
- **Decision owners:** Architecture, Customer Engineering, Wallet, Ledger, Finance, Reconciliation, Operations, and Security
- **Scope:** Source ownership, lifecycle authority, deactivation, closure, and repair state for customer-to-financial-account bindings
- **Task:** A3T02 — Binding Ownership and Financial Account Lifecycle Contract
- **Related decision:** [ADR-0031 — Customer-to-Financial-Account Identity Binding](ADR-0031-Customer-to-Financial-Account-Identity-Binding.md)
- **Implementation status:** Documentation-only decision input; no entity, migration, service, controller, API, or runtime behavior is introduced

> **ADR numbering note:** The A3 implementation plan and Architecture Phase Plan assign ADR-0031 and ADR-0033 to A3 decisions. The older `docs/ADR-INVENTORY.md` still assigns those numbers to later A6/A7 topics. This task follows the current A3 implementation plan; registry reconciliation remains a future review item and is not silently performed here.

## Context

The current repository has separate lifecycle vocabularies and owners:

- `Customer.status` is owned by `customer`.
- `CustomerWallet.status` is owned by `customer-wallet` and describes provisioning metadata.
- `WalletAccount.status` is owned by `wallet` and describes the financial wallet facade.
- `LedgerAccount.is_active` is owned by `ledger` and describes account availability for ledger use.
- Posted journals and lines are immutable financial facts owned by `ledger`.
- The A3 binding record and association lifecycle do not yet exist.

The source states can disagree without one domain being allowed to overwrite another. A customer-wallet suspension must not directly update a financial wallet row; a ledger account deactivation must not be hidden by changing customer metadata; and a reconciliation report must not edit either source to make the states match. At the same time, an A3 active binding must fail closed when a required source is missing, suspended, closed, inactive, or dimensionally incompatible.

A single lifecycle contract is needed before schema and command implementation so that:

- source owners remain authoritative for their own records;
- the binding owner has a deterministic active/non-active state;
- deactivation and reactivation do not silently reassign ownership;
- closed and repair-required records remain auditable; and
- later reads and financial commands cannot mistake metadata status for financial account availability.

## Decision

### 1. Lifecycle authority matrix

| Concept                            | Authoritative owner                    | State/value authority                                                                                                 | What another domain may read                                                                         | What another domain may not write                                                                      |
| ---------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Customer identity and lifecycle    | `customer`                             | `Customer.id`, deletion state, and `Customer.status` (`DRAFT`, `ACTIVE`, `SUSPENDED`, `CLOSED`)                       | Canonical UUID, current status, deletion/version state through an approved contract                  | Customer source fields, status, or deletion state                                                      |
| Customer-wallet provisioning       | `customer-wallet`                      | `CustomerWallet.status` (`PENDING`, `ACTIVE`, `SUSPENDED`, `CLOSED`), currency, type, ownership, and metadata version | CustomerWallet identity, matching Customer UUID, currency, type, status, ownership, and version      | CustomerWallet, WalletOwnership, alias, or provisioning-history source rows                            |
| Financial wallet facade            | `wallet`                               | `WalletAccount.status` (`ACTIVE`, `SUSPENDED`, `CLOSED`), currency, and `ledgerAccountId` relationship                | Wallet UUID, status, currency, relationship, and source version/state                                | WalletAccount status, customer compatibility value, or ledger relationship outside the Wallet contract |
| Ledger financial account           | `ledger`                               | `LedgerAccount.id`, currency, accounting unit, account type, normal balance, and `is_active`                          | Account identity and compatibility dimensions through an approved ledger read                        | Ledger account state, journals, lines, balances, or posted value outside Ledger contracts              |
| Binding association                | `wallet` A3 account-binding capability | Binding state and active-edge uniqueness (`PENDING`, `ACTIVE`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`)              | Binding identity, source IDs, explicit dimensions, status, version, and controlled discrepancy state | Customer, CustomerWallet, WalletAccount, LedgerAccount, journal, line, or balance source records       |
| Financial value and posted history | `ledger`                               | Ledger-derived balances, posted journals, and posted lines                                                            | Read-only ledger-derived results under A2 authorization                                              | Any balance mutation or posted journal/line update/delete                                              |
| Operational evidence               | `operations`                           | Audit, idempotency, outbox, diagnostics, and operational facts                                                        | Minimum evidence through Operations contracts                                                        | Direct table writes outside Operations services                                                        |
| Independent control                | `reconciliation` with Finance          | PASS/WARNING/ERROR checks and discrepancy evidence                                                                    | Source rows and read-only control results                                                            | Any source or binding repair mutation                                                                  |
| Runtime access                     | A2                                     | Principal, authorization, session/MFA, approval, and route/action decisions                                           | Authenticated/authorized context                                                                     | A3-local replacement authorization or unapproved access policy                                         |

The binding capability owns only the association lifecycle. It does not become a shared owner of source lifecycle fields or financial value.

### 2. Source lifecycle semantics

#### Customer

- `DRAFT` means the customer identity exists but is not an active customer subject for an active financial binding.
- `ACTIVE` is the source lifecycle precondition for an active binding, subject to all other A3 checks.
- `SUSPENDED` makes the customer unavailable for an active binding. A binding cannot silently remain active or be reactivated from this state.
- `CLOSED` is terminal under the current customer lifecycle. A confirmed closed customer cannot have an active binding.
- Soft deletion or missing identity is never treated as a valid active source.

A3 does not reinterpret eligibility, risk, compliance, or product policy. Customer status is a source lifecycle precondition; A4 remains the authority for action-specific policy decisions.

#### CustomerWallet

- `PENDING` means metadata provisioning is incomplete for active binding purposes.
- `ACTIVE` is the customer-wallet metadata precondition for an active binding.
- `SUSPENDED` makes the metadata wallet unavailable for an active binding until an explicit source-owner reactivation and binding recheck.
- `CLOSED` is terminal for that metadata wallet. A binding cannot reopen it or attach it to another account.

The customer-wallet service's existing state machine remains authoritative for the metadata record. A binding state change does not replace its history or status transition.

#### WalletAccount

- `ACTIVE` is the financial wallet precondition for an active binding.
- `SUSPENDED` is a known reversible financial-wallet unavailability state; the binding must not be active while it persists.
- `CLOSED` is terminal for the financial wallet record under the current model; a binding cannot reopen it or assign it to another customer-wallet.

Only the wallet owner may change `WalletAccount.status`. A binding operation may observe the status and update its own association state through the approved binding contract; it may not update the WalletAccount row as a side effect.

#### LedgerAccount

- `is_active = TRUE` is required for an active binding.
- `is_active = FALSE` is not silently interpreted as a customer-wallet closure because the current ledger record does not encode the reason or a complete lifecycle state machine.
- A ledger owner may deactivate an account under Ledger authority. The binding becomes non-active; if the reason is not explicitly classified as a reversible suspension, the binding enters `REPAIR_REQUIRED` until the Ledger/Finance owner supplies controlled evidence.
- Ledger account type, normal balance, currency, accounting unit, negative-balance rule, journals, lines, and balances remain Ledger/Finance authority.

### 3. Binding lifecycle state machine

The A3 binding lifecycle is:

```text
PENDING -------> ACTIVE -------> SUSPENDED -------> ACTIVE
   |              |  |              |  |
   |              |  +------------> |  +-----------> REPAIR_REQUIRED
   |              |                 |
   +-----------> REPAIR_REQUIRED <--+
   |              |                  |
   +-----------> CLOSED <-----------+

REPAIR_REQUIRED -------> PENDING
REPAIR_REQUIRED -------> CLOSED
CLOSED: terminal
```

The normative transition table is:

| Current state     | Allowed next state | Required condition                                                                                                      |
| ----------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `PENDING`         | `ACTIVE`           | All active-binding preconditions pass; A2 authorization and the approved binding command succeed.                       |
| `PENDING`         | `SUSPENDED`        | A known reversible source suspension is present; no active use is allowed.                                              |
| `PENDING`         | `REPAIR_REQUIRED`  | Identity, ownership, source, dimension, concurrency, or partial-failure ambiguity is detected.                          |
| `PENDING`         | `CLOSED`           | Explicit authorized terminal closure is recorded; no source reassignment occurs.                                        |
| `ACTIVE`          | `SUSPENDED`        | A known reversible source suspension is recorded or an authorized binding suspension is requested.                      |
| `ACTIVE`          | `REPAIR_REQUIRED`  | A source mismatch, missing record, incompatible dimension, stale version, or ambiguous outcome is detected.             |
| `ACTIVE`          | `CLOSED`           | Explicit terminal closure is approved and auditable; source records are not rewritten by the binding operation.         |
| `SUSPENDED`       | `ACTIVE`           | Source owners have restored all required preconditions and an explicit authorized reactivation rechecks them.           |
| `SUSPENDED`       | `REPAIR_REQUIRED`  | Source state, ownership, or recovery evidence is ambiguous or inconsistent.                                             |
| `SUSPENDED`       | `CLOSED`           | Explicit terminal closure is approved and auditable.                                                                    |
| `REPAIR_REQUIRED` | `PENDING`          | A controlled review/repair has resolved the discrepancy without reassigning an existing identity. A3T08 owns execution. |
| `REPAIR_REQUIRED` | `CLOSED`           | Review determines the binding cannot or must not be restored; closure and evidence are recorded.                        |
| `CLOSED`          | None               | Closed binding identity is never reopened, recycled, or assigned to another customer/account.                           |

A `REPAIR_REQUIRED` binding cannot transition directly to `ACTIVE`. A source owner changing a source status does not automatically reactivate or close a binding; the binding owner must record the association outcome through an authorized, auditable command or controlled recovery process.

### 4. Active-state conjunction and discrepancy precedence

A binding is `ACTIVE` only when every required source is compatible:

```text
Customer ACTIVE and not deleted
  AND CustomerWallet ACTIVE and not deleted
  AND CustomerWallet.customerId = Customer.id
  AND WalletAccount ACTIVE
  AND WalletAccount.currency = CustomerWallet.currency
  AND WalletAccount.ledgerAccountId = LedgerAccount.id
  AND LedgerAccount.is_active = TRUE
  AND LedgerAccount.currency = WalletAccount.currency
  AND LedgerAccount.accounting_unit = CUSTOMER_FUNDS
  AND LedgerAccount is a compatible customer-funds liability account
  AND at most one active binding exists for Customer.id + currency
  AND active edge uniqueness holds
```

If more than one condition fails, the binding evidence records all applicable discrepancies rather than selecting one source as correct. The state precedence is:

1. Missing or ambiguous identity/ownership/dimension evidence: `REPAIR_REQUIRED`.
2. Known reversible source suspension with otherwise consistent identity: `SUSPENDED`.
3. Confirmed terminal closure under the owning source and binding contract: `CLOSED`.
4. Waiting for approved provisioning or source activation: `PENDING`.
5. All active preconditions pass: `ACTIVE`.

This precedence fails closed. It does not authorize a financial command, alter a source state, or resolve an ownership conflict by guessing.

### 5. Deactivation rules

#### Source-owner deactivation

1. `customer` may change `Customer.status` only through the Customer contract. The binding owner observes the result; it does not change customer state.
2. `customer-wallet` may transition CustomerWallet metadata according to its existing state machine. It does not suspend, close, or reopen WalletAccount or LedgerAccount as a side effect.
3. `wallet` may transition WalletAccount status under the financial-wallet contract. It does not rewrite CustomerWallet ownership or ledger journals/lines as a binding side effect.
4. `ledger` may deactivate a LedgerAccount under Ledger/Finance authority. It does not change CustomerWallet or binding ownership fields.
5. A source deactivation that makes an active binding invalid must cause the binding to be observed as non-active by authorized reads and reconciliation. The binding owner records `SUSPENDED`, `CLOSED`, or `REPAIR_REQUIRED` through its own contract; it never edits the source to make the conjunction true.

#### Binding-owner deactivation

1. The A3 binding owner may transition the binding state only, not source lifecycle or financial value.
2. A binding suspension or closure requires A2 authorization, the required approval context for the action, an idempotency key/request hash, an audit fact, and a correlation ID.
3. Binding closure is terminal. It does not delete source records, reverse journals, alter balances, or release non-reusable identifiers.
4. A binding cannot be reactivated merely because a source later becomes active. Reactivation is a new explicit authorized transition with fresh source reads and active-edge uniqueness checks.
5. If a source closure is ambiguous, a timeout occurs, or two source states conflict, the binding enters `REPAIR_REQUIRED` rather than silently closing another source or assigning a replacement account.

### 6. Ownership transfer and account reassignment

Ownership transfer and implicit account reassignment are prohibited:

- `WalletOwnership` is immutable under ADR-0015.
- A binding cannot change its Customer UUID, CustomerWallet UUID, WalletAccount UUID, or LedgerAccount UUID in place.
- A closed or repair-required binding cannot be attached to a different customer or account to clear an exception.
- `WalletAccount.customerId` remains an opaque compatibility value; deactivation or binding creation does not rewrite it.
- A future legal/business transfer requires a separate approved workflow with source-owner authority, maker-checker approval, retention/history treatment, and independent reconciliation. It is out of A3T02.

### 7. Shared reads and safe status exposure

The following reads are permitted through approved contracts:

- Binding owner reads current source identifiers, versions, dimensions, and lifecycle state.
- A3 read models may expose a minimized binding status and ledger-derived account information after A3T06, subject to A2 authorization.
- Reconciliation reads source tables independently and reports binding/source discrepancies without invoking binding writes.
- Operations and Production may read health, audit, idempotency, diagnostics, and readiness evidence according to their contracts.

The following are prohibited:

- Treating a binding status as a copy of WalletAccount balance or LedgerAccount value.
- Exposing ledger IDs, account codes, opaque customer references, or control evidence to an unauthorized caller merely because a binding exists.
- Presenting `PENDING`, `SUSPENDED`, or `REPAIR_REQUIRED` as an active financial account.
- Hiding a source mismatch by returning a fabricated account or balance.

A2 decides principal, role, resource, and action authorization. A3 consumes that decision and does not implement a second authorization policy.

### 8. Operational, audit, and reconciliation controls

Every binding lifecycle mutation must use the existing cross-cutting contracts:

- A2 authenticated principal and authorization decision before mutation.
- Operations audit event with actor/principal, binding/resource IDs, action, reason, prior/new state, correlation/request context, and redacted values.
- Scoped idempotency and canonical request hash for retryable commands; exact command scope is defined by later A3 contract work.
- Optimistic version or equivalent stale-state protection for the binding and source records where applicable.
- Read-only reconciliation evidence for identity, ownership, lifecycle, currency, accounting unit, and wallet-to-ledger consistency.
- Pending/recovery/repair-required outcome when a financial result or source state is ambiguous.

Reconciliation remains independent: it queries source tables directly, does not call the binding write path to clear a discrepancy, and does not mutate financial rows. A readiness or dashboard report cannot be used as a lifecycle writer.

### 9. Alternatives considered

#### Let CustomerWallet lifecycle control WalletAccount lifecycle

Rejected. Customer-wallet metadata and financial-wallet state have different owners and failure semantics. A metadata transition may make a binding unavailable, but it cannot directly mutate financial source state.

#### Let WalletAccount lifecycle control CustomerWallet lifecycle

Rejected. A financial wallet cannot rewrite customer provisioning metadata or ownership history. Source states must remain independently auditable.

#### Let LedgerAccount inactivity mean automatic customer-wallet closure

Rejected. `LedgerAccount.is_active` is a ledger field without a complete customer-facing closure reason. It fails the binding closed-state precondition and requires a controlled suspension or repair classification.

#### Automatically cascade all source status changes across domains

Rejected. Cascading shared writes would create hidden coupling, race conditions, and competing lifecycle authorities. The binding records a controlled association outcome instead.

#### Allow reactivation or reassignment by changing the old binding row

Rejected. It would destroy identity history and make reconciliation/support evidence ambiguous. Closed identities remain closed; a future approved workflow must create a new explicit resource if transfer is ever permitted.

### 10. Consequences

#### Positive

- Each lifecycle field has one authoritative writer.
- Binding `ACTIVE` is a fail-closed conjunction rather than a copied status.
- Deactivation cannot mutate customer metadata, financial wallet records, ledger accounts, balances, journals, or lines across ownership boundaries.
- Suspended, closed, and repair-required outcomes remain explicit and auditable.
- Reconciliation can detect drift without becoming a repair writer.
- Later read and command implementations have a deterministic lifecycle contract.

#### Trade-offs

- Source transitions can create a temporary non-active or repair-required binding until the binding owner records the observed outcome.
- Operators need controlled workflows and evidence to reactivate or close a binding.
- Ledger inactivity requires an explicit reason/classification before a customer-facing lifecycle state can be finalized.
- A3T08 must implement repair and exception execution without weakening these authorities.
- Formal approval by accountable owners is still required before schema work.

## Dependencies and references

- [`A3-IMPLEMENTATION-PLAN.md`](../A3-IMPLEMENTATION-PLAN.md)
- [`A3-BINDING-BASELINE.md`](../A3-BINDING-BASELINE.md)
- [`A3-BINDING-OWNERSHIP-MATRIX.md`](../A3-BINDING-OWNERSHIP-MATRIX.md)
- [`CANONICAL-OWNERSHIP-MATRIX.md`](../CANONICAL-OWNERSHIP-MATRIX.md)
- [`CROSS-CUTTING-CONTRACTS.md`](../CROSS-CUTTING-CONTRACTS.md)
- [`ADR-0002-Money-Representation.md`](ADR-0002-Money-Representation.md)
- [`ADR-0004-Wallet-and-Ledger.md`](ADR-0004-Wallet-and-Ledger.md)
- [`ADR-0005-Independent-Reconciliation.md`](ADR-0005-Independent-Reconciliation.md)
- [`ADR-0008-Operational-Resilience.md`](ADR-0008-Operational-Resilience.md)
- [`ADR-0012-Customer-Foundation.md`](ADR-0012-Customer-Foundation.md)
- [`ADR-0015-Customer-Wallet-Provisioning.md`](ADR-0015-Customer-Wallet-Provisioning.md)
- [`ADR-0020-Foundation-Closure-and-Scope-Boundary.md`](ADR-0020-Foundation-Closure-and-Scope-Boundary.md)
- [`ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md`](ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md)
- [`ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR-0023-Customer-Identifier-and-Reference-Conventions.md)
- [`ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md)
- [`ADR-0031-Customer-to-Financial-Account-Identity-Binding.md`](ADR-0031-Customer-to-Financial-Account-Identity-Binding.md)

## Verification and approval record

A3T02 validation must confirm:

- [x] Customer, CustomerWallet, WalletAccount, LedgerAccount, binding, Operations, Reconciliation, and A2 lifecycle/access authorities are named.
- [x] Source lifecycle state machines are not merged or given competing writers.
- [x] Binding lifecycle states, active-state conjunction, transition rules, deactivation, closure, and repair-required behavior are explicit.
- [x] Ownership transfer and implicit account reassignment are prohibited.
- [x] Shared reads, status exposure, audit, idempotency, and independent reconciliation boundaries are explicit.
- [x] Ledger remains authoritative for financial value, account state, posted journals, and posted lines.
- [ ] Accountable-owner approval for schema design is recorded.

This ADR is a proposed decision input, not evidence that the listed owners have approved it. A3T03/A3T04 must not treat the proposal as approved until the approval record is completed.
