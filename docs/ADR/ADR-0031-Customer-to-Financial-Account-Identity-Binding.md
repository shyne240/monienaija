# ADR-0031: Customer-to-Financial-Account Identity Binding

- **Status:** Proposed for A3 schema-design approval
- **Date:** 2026-08-06
- **Decision owners:** Architecture, Customer Engineering, Wallet, Ledger, Finance, Reconciliation, Operations, and Security
- **Scope:** Canonical identity binding between Customer Foundation wallet metadata and ledger-backed financial accounts
- **Task:** A3T02 — Binding Ownership and Financial Account Lifecycle Contract
- **Implementation status:** Documentation-only decision input; no entity, migration, service, controller, API, or runtime behavior is introduced

> **ADR numbering note:** The A3 implementation plan and Architecture Phase Plan assign ADR-0031 and ADR-0033 to A3 decisions. The older `docs/ADR-INVENTORY.md` still assigns those numbers to later A6/A7 topics. This task follows the current A3 implementation plan; the registry conflict remains a future architecture-documentation review item and is not silently resolved here.

## Context

A3T01 established that the repository contains three separate identity/value graphs:

- `Customer.id` is the canonical customer UUID owned by `customer`.
- `CustomerWallet` and `WalletOwnership` are customer-wallet provisioning and ownership metadata owned by `customer-wallet`.
- `WalletAccount` is the financial wallet facade owned by `wallet`, and its `ledgerAccountId` points to a `LedgerAccount` owned by `ledger`.

There is currently no explicit `CustomerWallet`-to-`WalletAccount` or `CustomerWallet`-to-`LedgerAccount` binding record. `WalletAccount.customerId` is a non-null opaque `varchar(160)` compatibility value without a customer foreign key or namespace discriminator. A customer reference, wallet alias, UUID-shaped string, or idempotency key cannot be treated as proof of financial identity.

The architecture already assigns source ownership:

- `customer` owns Customer identity and customer references.
- `customer-wallet` owns provisioning metadata, ownership metadata, aliases, and provisioning history.
- `wallet` owns the financial wallet facade and its relationship to a ledger account.
- `ledger` owns financial accounts, journals, lines, posted value, and ledger-derived balances.
- `operations` owns audit, idempotency, outbox, diagnostics, and operational evidence.
- `reconciliation` independently verifies source consistency and does not repair source rows.
- A2 owns authenticated principals, authorization decisions, and privileged-action context.

Without a single binding authority, a later implementation could add competing writers, treat metadata as a financial source of truth, silently rewrite opaque customer references, allow two metadata records to claim one financial account, or mutate ledger state while repairing an identity mismatch.

## Decision

### 1. Single binding authority

The **`wallet` bounded context, through an A3 account-binding capability co-located in the existing modular monolith, is the single authoritative owner and writer of the customer-to-financial-account binding record and binding lifecycle**.

This means:

- `wallet` owns the logical binding association and its active-mapping uniqueness rules.
- The binding capability may store references to `Customer.id`, `CustomerWallet.id`, `WalletAccount.id`, and `LedgerAccount.id` under an approved contract.
- The binding capability does **not** become the owner of Customer identity, CustomerWallet metadata, ledger value, posted journals, or ledger lines.
- The binding capability is a domain capability within the current topology, not a new microservice or a reason to extract `wallet` or `ledger`.
- `customer-wallet`, `wallet`, and `ledger` retain their current source authorities. The binding record is an explicit cross-domain association, not a merged wallet table and not a second financial account authority.

`wallet` is selected rather than `customer-wallet` because the binding terminates at the financial wallet facade and its existing wallet-to-ledger relationship. `customer-wallet` remains a provisioning input and must not acquire shared-table write authority over financial records. `ledger` is not selected because it owns financial account/value truth, not customer identity or customer-wallet provisioning metadata. A separate service is not selected because A3 does not require a topology or service-extraction change.

### 2. Binding identity and subjects

The logical binding subject is one explicit association containing, at minimum, these identity dimensions:

```text
Customer.id
  + CustomerWallet.id
  + WalletAccount.id
  + WalletAccount.ledgerAccountId / LedgerAccount.id
```

The following rules apply:

1. `Customer.id` is the only canonical customer identity in the binding. `Customer.reference`, `WalletAccount.customerId`, wallet aliases, payment references, provider identifiers, and correlation IDs are not substitutes.
2. `CustomerWallet.customerId` must equal the bound `Customer.id`. A valid UUID in each field is insufficient if the values differ.
3. The bound `WalletAccount.id` must be the financial wallet record owned by `wallet`.
4. The bound `LedgerAccount.id` must equal the `WalletAccount.ledgerAccountId` relationship already owned by `wallet` and constrained by `ledger`.
5. A binding is an association, not a copy of the balance, journal headers, journal lines, or other mutable financial value.
6. The binding stores or exposes only the minimum identity, dimension, lifecycle, version, audit, and correlation data required by its approved contract. It does not copy customer profile, KYC, credentials, risk reasoning, compliance comments, or ledger history.

### 3. Cardinality and uniqueness

A3 uses **one-to-one active binding at the record edges, one-to-many customer-to-currency relationships, and at most one active financial binding per canonical Customer-plus-currency scope**:

| Subject or dimension       | Proposed A3 rule                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer to bindings       | One `Customer` may have zero or many bindings across currencies. Each active binding remains separately attributable to one CustomerWallet and one financial wallet.                                                                                                                                                                                              |
| CustomerWallet to bindings | One `CustomerWallet` may have zero or one active binding. A customer-wallet metadata record cannot claim two active financial wallets.                                                                                                                                                                                                                            |
| WalletAccount to bindings  | One `WalletAccount` may have zero or one active binding. A financial wallet cannot be assigned to two customer-wallet metadata records.                                                                                                                                                                                                                           |
| LedgerAccount to bindings  | One `LedgerAccount` may have zero or one active binding. This preserves the existing one-wallet-to-one-ledger-account relationship and prevents shared financial-account ownership.                                                                                                                                                                               |
| Customer to currencies     | A customer may have multiple currencies. Currency is an explicit binding dimension, not a global customer identity.                                                                                                                                                                                                                                               |
| Customer and same currency | At most one active binding exists for a canonical Customer UUID and currency. If multiple CustomerWallet metadata records have the same customer/currency, A3 must not silently select or merge them; only an explicitly approved metadata record may bind, and the remainder require a controlled non-active outcome or a later approved account-class decision. |
| CustomerWallet type        | Wallet type (`PRIMARY`, `SAVINGS`, `BUSINESS`, or `ESCROW`) remains metadata owned by `customer-wallet`. A3 does not use type as an implicit account-selection or product-policy rule.                                                                                                                                                                            |
| Historical records         | Closed, superseded, or repair evidence remains attributable to its original binding/resource IDs. Historical identity is not reused for another customer or account.                                                                                                                                                                                              |

The existing unique `(wallet_accounts.customer_id, currency)` constraint remains a local constraint on the opaque financial-wallet value. It is not the canonical A3 uniqueness rule and cannot prove uniqueness for a customer whose legacy values differ by reference, UUID spelling, or another opaque namespace.

The active uniqueness rules are logical decisions for the later schema task. A3T04 must implement them only after this ADR and the ownership matrix receive accountable-owner approval; A3T02 does not create the constraints.

### 4. Active-binding preconditions

A binding may be `ACTIVE` only when all of the following are true:

- the canonical Customer UUID exists, is not deleted, and the Customer source is in `ACTIVE` status;
- the CustomerWallet exists, is not deleted, and is in the approved `ACTIVE` metadata state;
- the CustomerWallet customer UUID equals the binding Customer UUID;
- the CustomerWallet and WalletAccount currencies are equal;
- the WalletAccount exists and is in its approved active financial-wallet state;
- the WalletAccount points to the bound LedgerAccount UUID;
- the LedgerAccount exists, is active, has the compatible customer-funds account type/normal balance, and has the same currency;
- the LedgerAccount uses the approved accounting unit `CUSTOMER_FUNDS`; and
- no active binding already claims the CustomerWallet, WalletAccount, or LedgerAccount.

These are binding consistency preconditions, not A4 eligibility or product-policy decisions. A3 does not decide whether a customer may use a product, exceed a limit, pass a risk rule, or execute a transaction. A2 authorization and later A4/A5 contracts remain separate gates.

### 5. Binding lifecycle

The binding owner uses an explicit lifecycle that is separate from, but constrained by, the source lifecycles:

| Binding state     | Meaning                                                                                                                         | Active financial use                                                                               | Allowed next states                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `PENDING`         | Association is not yet active, is awaiting an approved provisioning/confirmation step, or is waiting for a source precondition. | Not eligible as an active binding. No account reassignment is implied.                             | `ACTIVE`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`    |
| `ACTIVE`          | All identity, ownership, currency, accounting-unit, source-state, and uniqueness preconditions pass.                            | Binding may be consumed by later authorized read/command contracts; A3 itself does not move money. | `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`              |
| `SUSPENDED`       | Association is intentionally unavailable because a known source is suspended or temporarily unavailable.                        | Not eligible as an active binding.                                                                 | `ACTIVE`, `REPAIR_REQUIRED`, `CLOSED`                 |
| `REPAIR_REQUIRED` | Identity, ownership, lifecycle, dimension, concurrency, or partial-failure evidence is ambiguous or inconsistent.               | Must fail closed; no reassignment or financial command is implied.                                 | `PENDING` after controlled repair review, or `CLOSED` |
| `CLOSED`          | Binding is terminally deactivated or its source ownership is terminally closed.                                                 | Never active again.                                                                                | None                                                  |

Required lifecycle rules:

- `ACTIVE` is a conjunctive state: the binding owner cannot mark a binding active while a required source is missing, incompatible, suspended, closed, inactive, or ambiguous.
- `REPAIR_REQUIRED` cannot transition directly to `ACTIVE`. It must pass a controlled repair/review step that returns it to `PENDING` or closes it; A3T08 owns the later repair execution.
- `CLOSED` is terminal for the binding identity. A closed binding cannot be reopened or reassigned to another customer, CustomerWallet, WalletAccount, or LedgerAccount.
- Reactivation from `SUSPENDED` requires an explicit authorized action and fresh source-precondition checks. Source status changes do not silently reactivate a binding.
- A binding status never authorizes money movement by itself. A2 authorization, A4 policy, and A5 financial-command contracts remain required.

The detailed source-lifecycle and deactivation authority is defined in [ADR-0033](ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md).

### 6. Ownership transfer and reassignment

Ownership transfer is **prohibited in A3**:

- `CustomerWallet` ownership remains immutable under ADR-0015.
- A binding cannot change its Customer UUID, CustomerWallet UUID, WalletAccount UUID, or LedgerAccount UUID in place.
- A binding cannot make a financial wallet appear to belong to a different customer by rewriting `WalletAccount.customerId`.
- A binding cannot reassign a ledger account or modify a posted journal/line to establish ownership.
- A legal/business ownership-transfer workflow would require a separate approved ADR, explicit source-domain authority, maker-checker/privileged approval, retention and history treatment, and independent reconciliation. No such workflow is part of A3T02.

### 7. Source ownership and permitted shared reads

The binding capability may consume narrowly scoped, versioned reads from source authorities:

| Read source       | Permitted binding use                                                                                                                    | Authority retained by source                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `customer`        | Verify canonical Customer UUID existence, deletion state, and version needed for the binding contract                                    | Customer identity, reference, profile, KYC, and customer lifecycle           |
| `customer-wallet` | Verify CustomerWallet UUID, Customer UUID, currency, type, metadata lifecycle, ownership, version, and deletion state                    | Customer-wallet metadata, ownership, aliases, and provisioning history       |
| `wallet`          | Verify WalletAccount UUID, currency, financial-wallet status, ledger-account relationship, and version/state contract                    | WalletAccount record and financial-wallet lifecycle                          |
| `ledger`          | Verify LedgerAccount UUID, currency, accounting unit, account type, normal balance, active state, and ledger-derived financial truth     | Ledger account state, journals, lines, balances, and posted value            |
| A2                | Consume authenticated principal, authorization decision, request/correlation/trace context, and privileged-action context where required | Runtime identity, authorization, sessions, MFA, approvals, and access policy |
| Operations        | Use audit, scoped idempotency, diagnostics, and approved outbox contracts                                                                | Operational evidence and retention-controlled records                        |
| Reconciliation    | Consume independent discrepancy/control results as read-only evidence                                                                    | Independent verification; no source repair                                   |

A read model or customer-facing view may read the binding result through an approved contract after A3T04/A3T05, but it cannot become a binding writer or a balance source. A2 decides whether a caller is allowed to receive a particular view.

### 8. Prohibited writes and financial invariants

Unless a later approved ADR explicitly supersedes this decision:

- `customer-wallet` cannot write `WalletAccount`, `LedgerAccount`, `LedgerJournal`, `LedgerLine`, or the binding record.
- The binding capability cannot write Customer, CustomerWallet, WalletOwnership, customer references, customer profile/KYC, or other customer source records.
- The binding capability cannot change a ledger balance, post a journal, update/delete a posted journal or line, or copy a mutable balance into metadata.
- The binding capability cannot make a financial account compatible by changing its currency, accounting unit, account type, normal balance, or negative-balance setting.
- `reconciliation` cannot repair source rows or call the binding write path to make a report pass.
- `operations` records are written only through `AuditService`, `IdempotencyService`, `OutboxService`, and their approved contracts.
- A customer reference, wallet alias, payment reference, provider ID, correlation ID, or idempotency key cannot be used as canonical financial identity.

The ledger remains the only authority for financial value and posted account state. CustomerWallet remains metadata and cannot mutate balances or posted journals.

### 9. A2, Operations, and Reconciliation dependencies

A3T02 establishes these dependencies without implementing them:

- Every binding mutation requires an A2-authenticated principal and an authorization decision for the action, resource, and scope. A3 does not duplicate route, role, MFA, or privileged-action policy.
- Every binding mutation uses the Operations audit contract with actor/principal, resource IDs, action, reason where required, correlation/request context, and redacted values.
- Retryable binding commands use a scoped idempotency key and canonical request hash through the Operations contract. Exact command scope and replay result are defined in A3T03/A3T05; an idempotency key is not the binding identity.
- Binding status and source references are independently consumable by Reconciliation. Reconciliation remains read-only and reports discrepancies for controlled investigation or later A3T08 repair.
- Any ambiguous outcome is represented as pending, suspended, repair-required, or another approved non-active state. No report or command claims active ownership without source and reconciliation evidence.

### 10. Decision alternatives

#### Make `CustomerWallet` the binding authority

Rejected. It would extend a metadata-only module into a writer of financial associations, risk violating ADR-0015's separation, and encourage customer metadata to become a competing financial boundary. CustomerWallet remains a required source read and provisioning authority, not the binding writer.

#### Make `ledger` the binding authority

Rejected. Ledger owns financial account/value truth, but customer identity and CustomerWallet provisioning are outside its domain. Adding customer ownership lifecycle to ledger would couple financial posting authority to customer metadata and create prohibited shared concerns.

#### Create a new binding microservice or independent financial store

Rejected for A3. The binding is a logical capability that can be co-located in the current modular monolith. A new topology or financial authority would add distributed consistency and migration risk without evidence that extraction is required.

#### Infer the binding from `WalletAccount.customerId`, customer reference, alias, or currency

Rejected. These values have different owners, namespaces, normalization, and retention semantics. Only an explicit, auditable binding may establish the association.

#### Permit multiple active bindings for one financial wallet or ledger account

Rejected. It would make ownership and balance views ambiguous and would undermine reconciliation. Each financial wallet and ledger account has at most one active customer-wallet binding.

#### Permit multiple active financial accounts for one canonical customer and currency

Rejected as the default A3 invariant. ADR-0004 and the current financial-wallet uniqueness model treat a customer/currency wallet as one financial account. Multiple CustomerWallet metadata candidates in one currency must not be silently merged or selected; any product/account-class exception requires a later approved decision without weakening record-edge uniqueness.

### 11. Consequences

#### Positive

- One named binding owner exists without moving customer or financial source ownership.
- Customer UUIDs, customer-wallet UUIDs, financial-wallet UUIDs, and ledger-account UUIDs remain distinct.
- Active uniqueness is explicit at every binding edge.
- Lifecycle failure and ambiguity fail closed without implicit reassignment or financial mutation.
- A2, Operations, and Reconciliation dependencies are explicit before schema or command work.
- The design preserves the current modular-monolith topology and the ledger financial boundary.

#### Trade-offs

- The binding owner must maintain cross-domain contracts and source-version checks.
- Customer-wallet and financial-wallet lifecycles can temporarily disagree; the binding must surface a non-active or repair-required state rather than silently choose an authority.
- A customer may have multiple bindings in one currency when distinct metadata wallets are explicitly approved; product-specific cardinality cannot be inferred from A3.
- Later schema work must implement active uniqueness without rewriting legacy opaque customer values.
- Formal approval by accountable owners is still required before A3T03/A3T04 schema work.

## Dependencies and references

- [`A3-IMPLEMENTATION-PLAN.md`](../A3-IMPLEMENTATION-PLAN.md)
- [`A3-BINDING-BASELINE.md`](../A3-BINDING-BASELINE.md)
- [`CANONICAL-OWNERSHIP-MATRIX.md`](../CANONICAL-OWNERSHIP-MATRIX.md)
- [`MODULE-SCHEMA-API-INVENTORY.md`](../MODULE-SCHEMA-API-INVENTORY.md)
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
- A2 principal, authorization, privileged-action, and protected-route contracts

## Verification and approval record

A3T02 validation must confirm:

- [x] One binding owner is named: the `wallet` bounded context's co-located A3 account-binding capability.
- [x] Customer identity, CustomerWallet metadata, WalletAccount lifecycle, LedgerAccount state/value, Operations evidence, and Reconciliation control have separate owners.
- [x] Active binding cardinality and uniqueness are explicit at CustomerWallet, WalletAccount, and LedgerAccount edges and at the canonical Customer-plus-currency scope.
- [x] Binding lifecycle states and non-active/repair-required behavior are explicit.
- [x] Ownership transfer and implicit reassignment are prohibited.
- [x] Shared reads and prohibited writes preserve source authority.
- [x] Ledger remains authoritative for financial value and posted account state.
- [x] A2 authorization, Operations audit/idempotency, and independent Reconciliation dependencies are explicit.
- [ ] Accountable-owner approval for schema design is recorded.

This ADR is a proposed decision input, not evidence that the listed owners have approved it. A3T03/A3T04 must not treat the proposal as approved until the approval record is completed.
