# ADR-0015: Customer Wallet Provisioning

- Status: Accepted
- Date: 2026-08-04
- Decision owners: Engineering, Operations, Risk
- Scope: P1.4 internal customer-wallet provisioning registry

## Context

P1.2 established completed customer onboarding and P1.3 established customer eligibility and product permissions. The platform now needs to record wallet provisioning for customers that satisfy both gates.

The existing `WalletAccount` module is a financial wallet implementation coupled to ledger accounts and balance reads. P1.4 explicitly does not introduce money movement, journals, balance mutation, or transactions. Provisioning therefore needs a separate customer-wallet registry that does not call the financial wallet or ledger modules.

## Decision

Create a separate `src/customer-wallet` NestJS module with:

- `CustomerWallet`
- `WalletProvisioningHistory`
- `WalletAlias`
- `WalletOwnership`

The module reads the existing `Customer`, P1.2 `CustomerOnboarding`, and P1.3 `CustomerEligibility` repositories. It does not import `WalletModule`, `LedgerModule`, `ReconciliationModule`, payment modules, or any external service.

### Provisioning gates

A customer wallet can be provisioned only when:

1. The customer exists.
2. A non-deleted onboarding record has status `COMPLETED`.
3. A non-deleted eligibility record has status `ELIGIBLE`.

The same gates apply when a wallet is explicitly transitioned to `ACTIVE`. Wallet creation defaults to `PENDING` so provisioning and activation remain distinct internal lifecycle actions.

### Wallet lifecycle

Wallet statuses follow this state machine:

```text
PENDING -> ACTIVE -> SUSPENDED -> ACTIVE
    |         |          |
    v         v          v
  CLOSED    CLOSED     CLOSED
```

`CLOSED` is terminal. `SUSPENDED` is not automatically reactivated; a separate explicit status update is required. A partial unique index allows one non-deleted `PRIMARY` wallet per customer.

### Ownership

A wallet creates exactly one ownership record in the same transaction. Ownership contains only the wallet and customer UUIDs, has no update endpoint, and is protected by a unique wallet index. P1.4 does not support ownership transfer.

### Aliases

Aliases are normalized lowercase internal identifiers and are globally unique while not soft-deleted. Alias creation is independent of financial account creation and appends a wallet history record.

### Provisioning history

Provisioning history is append-only. It records provisioning, ownership creation, alias addition, and wallet status transitions. History writes occur in the same transaction as the associated mutation. No history update or delete endpoint is exposed.

### Audit and concurrency

The existing immutable `AuditService` is called transactionally for wallet, ownership, alias, and history mutations. Wallet, alias, and ownership entities use optimistic version columns. Wallet status updates accept an optional expected version and reject stale versions. All records use soft deletion.

## Alternatives considered

### Reuse `WalletAccount`

Rejected. The existing financial wallet is coupled to ledger accounts and balance queries. Reusing it would violate the P1.4 prohibition on ledger interaction and balance mutation.

### Create a ledger account with each customer wallet

Rejected. P1.4 is provisioning metadata only. Ledger account creation belongs to a later milestone with explicit financial integration approval.

### Create wallets automatically during customer or eligibility changes

Rejected. Provisioning is an explicit customer-wallet API operation, gated by completed onboarding and eligibility. Customer and eligibility modules remain unchanged.

### Permit ownership updates

Rejected. Wallet ownership is immutable in P1.4. A later approved workflow would be required for any ownership change.

### Use an alias scoped to a customer or wallet

Rejected. The requirement is global alias uniqueness, so the database unique index is global across non-deleted aliases.

## Consequences

### Positive

- Eligible customers can receive an auditable wallet-provisioning record without financial side effects.
- Primary-wallet uniqueness and alias uniqueness are enforced at both service and database layers.
- Wallet status transitions are explicit and protected against reopening closed wallets.
- Ownership remains immutable and history remains append-only.
- Existing wallet, ledger, balance, payment, and reconciliation behavior remains unchanged.

### Trade-offs

- P1.4 customer wallets do not have ledger accounts or balances.
- Wallets default to `PENDING` and require a separate explicit activation request.
- A closed primary wallet remains the customer’s only primary wallet because the unique index preserves non-deleted history.
- Ownership and history are exposed as read-only records through P1.4 APIs.

## Verification

P1.4 verification includes:

- TypeScript build.
- ESLint.
- Prettier format checks.
- Unit tests for provisioning gates, duplicate primary wallets, global aliases, status transitions, closed-wallet protection, immutable ownership, append-only history, audit generation, DTO validation, and repository persistence.
- Existing wallet, ledger, payment, reconciliation, governance, production, customer, onboarding, eligibility, resilience, and maturity tests.
- PowerShell API verification in `docs/P1.4-CUSTOMER-WALLET-PROVISIONING.md`.
