# ADR-0032: Wallet Provisioning to Ledger Account Mapping

- **Status:** Proposed for A3 contract approval
- **Date:** 2026-08-06
- **Decision owners:** Architecture, Customer Engineering, Wallet, Ledger, Finance, Operations, Reconciliation, and Security
- **Scope:** Deterministic mapping contract from approved CustomerWallet provisioning state to WalletAccount and LedgerAccount references
- **Task:** A3T03 — Wallet Provisioning to Ledger Account Mapping Contract
- **Implementation status:** Documentation-only contract input; no entity, migration, service, controller, API, account provisioning, or runtime behavior is introduced

> **ADR numbering note:** The A3 implementation plan assigns ADR-0032 to this mapping decision. The older `docs/ADR-INVENTORY.md` assigns ADR-0032 to a later A7 notification topic. This task follows the current A3 implementation plan; registry reconciliation remains a future architecture-documentation review item and is not silently performed here.

## Context

A3T02 names the `wallet` bounded context's co-located A3 account-binding capability as the single binding authority. It also preserves these source authorities:

- `Customer.id` is the canonical customer identity owned by `customer`.
- `CustomerWallet` is provisioning metadata owned by `customer-wallet`.
- `WalletAccount` is the financial wallet facade owned by `wallet`.
- `LedgerAccount`, journals, lines, and ledger-derived balances are owned by `ledger`.
- Operations owns audit and scoped idempotency; Reconciliation independently verifies source consistency.

The current `WalletAccount.customerId` column is an opaque compatibility value. The existing wallet creation path accepts any non-empty value, creates a compatible liability ledger account and wallet in one transaction, and stores a local `creation_idempotency_key`; it does not establish a canonical Customer UUID relationship. A3 therefore needs an explicit mapping contract that does not select an account by customer reference, alias, opaque value, or currency alone.

The mapping contract must distinguish:

1. creating a new empty financial wallet/account for an approved CustomerWallet; and
2. binding an explicitly identified existing WalletAccount/LedgerAccount without silently claiming its history or rewriting its compatibility value.

The mapping operation is not a money movement command. It contains no amount, journal lines, transfer, deposit, withdrawal, settlement, or provider operation.

## Decision

### 1. Mapping authority and boundary

The `wallet` A3 account-binding capability owns the mapping command contract and the binding association. It must use Wallet-owned account provisioning/read contracts and Ledger-owned account validation/read contracts.

The mapping capability:

- accepts a canonical Customer UUID and CustomerWallet UUID;
- validates the approved CustomerWallet provisioning state and explicit currency/accounting-unit dimensions;
- either requests a Wallet-owned new financial account or binds an explicitly named existing WalletAccount;
- verifies that the WalletAccount points to the expected LedgerAccount;
- returns the canonical WalletAccount and LedgerAccount UUIDs as the mapping outcome; and
- records a durable, auditable, idempotent binding outcome without creating monetary value.

It must not:

- write `Customer`, `CustomerWallet`, `WalletOwnership`, customer references, or customer profile/KYC data;
- directly insert or update `ledger_accounts`, `ledger_journals`, or `ledger_lines` outside the Wallet/Ledger owner contracts;
- choose an account by `WalletAccount.customerId`, customer reference, alias, provider ID, account code, or currency alone;
- rewrite an existing `WalletAccount.customerId` compatibility value; or
- report a successful active mapping when identity, source state, dimensions, uniqueness, or transaction outcome is ambiguous.

### 2. Mapping modes

A version-one mapping request has one of two explicit modes:

| Mode            | Target selection                                                                                                                                                                                      | Allowed financial effect                                                                                                                                          | Result                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `PROVISION_NEW` | No target WalletAccount ID is supplied. The canonical Customer UUID, CustomerWallet UUID, and currency/accounting-unit scope determine the logical target.                                            | Wallet-owned provisioning may create one empty LedgerAccount and one WalletAccount in the same transaction as the binding outcome. No journal or line is created. | `PROVISIONED_AND_BOUND`, `REPLAYED`, `PENDING`, `REPAIR_REQUIRED`, or `REJECTED`. |
| `BIND_EXISTING` | An explicit `targetWalletAccountId` is required. The LedgerAccount is read through that WalletAccount relationship; an optional expected LedgerAccount UUID is an assertion, not an account selector. | No financial source row is created or changed. Only the approved binding association is written.                                                                  | `BOUND_EXISTING`, `REPLAYED`, `PENDING`, `REPAIR_REQUIRED`, or `REJECTED`.        |

`PROVISION_NEW` must not first search for an account by opaque customer value and then choose the first or oldest result. If an existing candidate is discovered outside the explicit binding record, the operation stops for controlled review rather than creating a second account or silently claiming the candidate.

`BIND_EXISTING` requires explicit target identity and approved ownership evidence. A UUID-shaped or reference-matched `WalletAccount.customerId` value is evidence for review only. If existing ledger activity or source history makes ownership ambiguous, the operation returns `REPAIR_REQUIRED`; it does not attach the account merely because its balance is zero or its currency matches.

### 3. Canonical mapping identity

The mapping identity is the normalized tuple:

```text
mappingVersion
+ mode
+ Customer.id
+ CustomerWallet.id
+ currency
+ accountingUnit
+ explicit targetWalletAccountId when BIND_EXISTING
```

The binding record remains the authoritative association after A3T04. The `WalletAccount.customerId` compatibility value, WalletAccount creation key, LedgerAccount code, customer reference, wallet alias, and caller idempotency key are not mapping identity.

For a new WalletAccount created by `PROVISION_NEW`, the Wallet owner must populate the existing compatibility column with the lowercase serialized canonical Customer UUID as a new-record compatibility value. This does not convert the legacy column into a foreign key or authority, and no existing row may be rewritten by this contract. If the Wallet owner cannot apply that explicit new-record compatibility rule, the request must fail closed rather than use a customer reference or alias.

### 4. Deterministic target and source rules

The mapping must be deterministic and reproducible:

- The same normalized mapping intent either returns the already durable mapping or produces one new mapping outcome under the active uniqueness rules.
- `BIND_EXISTING` uses the caller-supplied WalletAccount UUID only; it never scans by display/reference value or selects an arbitrary account.
- `PROVISION_NEW` derives its logical target from the canonical Customer UUID, CustomerWallet UUID, normalized currency, and approved accounting unit. Generated resource UUIDs may be random, but the durable result is the deterministic replay target for the same command intent.
- The Wallet owner chooses the new LedgerAccount code and resource UUID. A caller cannot select a ledger account code or create a second chart-of-accounts authority through the mapping request.
- A WalletAccount must point to exactly one LedgerAccount, and the returned LedgerAccount UUID must equal `WalletAccount.ledgerAccountId`.
- A mapping cannot use a LedgerAccount UUID independently of its WalletAccount relationship.
- A mapping cannot use `CustomerWallet.type`, alias, customer reference, provider ID, or account code as an implicit financial-account selector.

### 5. Currency and accounting-unit contract

The mapping uses explicit, normalized dimensions:

- Currency is trimmed and uppercased, then validated as a three-letter ISO 4217 code using the existing money contract.
- The normalized request currency must equal `CustomerWallet.currency` and `WalletAccount.currency`.
- The bound LedgerAccount currency must equal the WalletAccount currency.
- The only accounting unit supported by this customer-funds mapping contract is `CUSTOMER_FUNDS`.
- An omitted accounting unit is normalized to the existing default `CUSTOMER_FUNDS`; the normalized value is included in the request hash and result. A supplied non-`CUSTOMER_FUNDS` unit fails closed.
- No currency conversion, rate lookup, rounding, or amount calculation occurs in a mapping operation.
- Currency syntax acceptance is not a product or provider enablement decision. `NGN`, `USD`, and `GBP` are representative valid examples; actual supported-currency rollout remains subject to Finance/Product approval and existing source configuration.

The mapping cannot make `CustomerWallet` or `WalletAccount` an accounting-unit authority. The LedgerAccount remains the source of the stored accounting unit.

### 6. Ledger-account compatibility contract

For an `ACTIVE` mapping outcome, the target LedgerAccount must be:

- present and identified by UUID;
- `accountType = LIABILITY`;
- `normalBalance = CREDIT`;
- the same normalized currency as the WalletAccount;
- `accountingUnit = CUSTOMER_FUNDS`;
- `allowNegativeBalance = FALSE`; and
- `isActive = TRUE`.

These requirements reuse the existing wallet-to-ledger trigger and Ledger invariants. A mapping operation must not alter an incompatible account to make it pass. An incompatible existing target is rejected or placed in `REPAIR_REQUIRED` according to the failure matrix in the mapping contract.

### 7. Approved provisioning preconditions and postconditions

#### Preconditions

Before either mode can produce an active mapping:

1. A2 has supplied an authenticated principal and authorization decision for the operation, resource, and scope.
2. The canonical Customer UUID exists, is not deleted, and has the approved active customer lifecycle state.
3. The CustomerWallet exists, is not deleted, has matching `customerId`, has an active approved provisioning state, and has a valid current version.
4. CustomerWallet ownership evidence is present and matches the Customer UUID.
5. The request currency equals CustomerWallet currency.
6. No active binding already claims the CustomerWallet or canonical Customer-plus-currency scope.
7. For `BIND_EXISTING`, the target WalletAccount UUID is explicit and its LedgerAccount edge is present and compatible.
8. For `PROVISION_NEW`, no explicit target is supplied and no existing mapping is silently selected by a compatibility value.
9. The normalized idempotency request is reserved under the mapping command scope, or an identical durable replay is found.

The mapping consumes the approved CustomerWallet state; it does not independently recalculate onboarding, eligibility, risk, compliance, limits, or A4 policy. P1.4's active provisioning gates and later A4/A5 contracts remain their respective authorities.

#### Postconditions for `PROVISION_NEW`

On `PROVISIONED_AND_BOUND`:

- one binding outcome identifies the canonical Customer UUID and CustomerWallet UUID;
- one WalletAccount and one compatible LedgerAccount are returned;
- WalletAccount status is active and its ledger-account relationship is exact;
- currency and accounting unit are explicit and equal across the mapping dimensions;
- no ledger journal or line exists because of the mapping operation;
- the new account's ledger-derived balance remains zero unless an unrelated, pre-existing source fact is independently present; and
- the durable idempotency outcome can return the same mapping on an identical retry.

#### Postconditions for `BIND_EXISTING`

On `BOUND_EXISTING`:

- the returned WalletAccount and LedgerAccount UUIDs are the explicitly selected, compatible records;
- no existing WalletAccount customer compatibility value is changed;
- no ledger account, journal, line, balance, or posted financial record is changed;
- the active binding uniqueness rules hold; and
- the durable idempotency outcome can return the same mapping on an identical retry.

No successful result is returned until the binding outcome and required source writes commit together under the later approved persistence contract. An unknown commit result is not treated as success; it enters the pending/recovery path.

### 8. Idempotency, request hash, and correlation

The mapping command uses the Operations contract with this proposed scope:

```text
wallet.account-binding.v1
```

The scope is owned by the Wallet/A3 binding capability and remains distinct from:

- the caller's business reference;
- `WalletAccount.creation_idempotency_key`;
- Ledger journal idempotency keys; and
- any A5 financial command idempotency scope.

The request contract must:

- trim the opaque key and reject empty or overlong values under the existing Operations limits;
- preserve the key as an opaque value and never place customer data, secrets, or tokens in it;
- compute a lowercase 64-character SHA-256 request hash over canonical JSON of the normalized mapping fields;
- include mapping version, mode, Customer UUID, CustomerWallet UUID, currency, accounting unit, target WalletAccount UUID when applicable, expected source versions/assertions, and explicit mapping options that affect the result;
- exclude the idempotency key, request ID, trace ID, correlation ID, causation ID, transport headers, and actor presentation fields from the business request hash when they do not change the requested financial mapping; and
- carry request, trace, correlation, causation, and A2 actor/authorization context separately for audit and support evidence.

Replay rules:

1. Same `(scope, key)` and same request hash returns the durable original mapping result after A2 authorization is rechecked.
2. Same `(scope, key)` with a different request hash returns a conflict and performs no mapping or account write.
3. A second key for an already-active canonical Customer-plus-currency or CustomerWallet mapping returns a controlled duplicate/conflict result, not a second account.
4. A concurrent request with the same intent may return the committed winner after reading the durable outcome; a concurrent request with a different target or intent fails closed.
5. Idempotency expiration permits a new reservation only under the approved Operations retention policy. It never makes an old financial account, binding, journal, or payment reference reusable.

For `PROVISION_NEW`, a subordinate WalletAccount creation key must be derived deterministically from the canonical mapping scope and namespaced for the Wallet owner. A bare caller key must not be reused across Operations and Wallet command owners. The subordinate key is an implementation detail, not the binding identity.

### 9. Atomicity and concurrency contract

The later execution must use a transaction and database constraints as the final concurrency guard:

- Reserve or replay the mapping idempotency record before executing a new mapping.
- Read and validate Customer, CustomerWallet, ownership, and source versions under the approved transaction boundary.
- Serialize the canonical Customer-plus-currency/CustomerWallet mapping scope before selecting or creating a target.
- For `BIND_EXISTING`, lock/read the explicit WalletAccount and its LedgerAccount relationship before writing the binding.
- For `PROVISION_NEW`, provision the compatible LedgerAccount and WalletAccount through the Wallet/Ledger owner contract and write the binding outcome atomically.
- Use deterministic ordering for any multiple-resource locks, consistent with existing Ledger account-locking conventions.
- Rely on database active-uniqueness constraints to reject a race that passes application prechecks.
- On a unique-race winner with the same intent, reread and replay the committed mapping. On a different intent, return conflict or repair-required evidence without changing either source.
- Retry only bounded PostgreSQL serialization/deadlock failures under ADR-0008. Do not use an unbounded retry loop or in-memory duplicate flag.

A mapping command must never post a journal or mutate a balance as a concurrency remedy.

### 10. Failure and recovery boundary

The mapping operation has no compensating financial journal because it creates no monetary value. A rolled-back account-provisioning attempt is retried using the same idempotency key. An ambiguous or partially durable result becomes pending or repair-required evidence for later controlled recovery; it is not silently deleted or reassigned.

The detailed request/result and failure-state matrix is maintained in [`A3-WALLET-LEDGER-MAPPING-CONTRACT.md`](../A3-WALLET-LEDGER-MAPPING-CONTRACT.md).

## Alternatives considered

### Select a WalletAccount by `customerId`, customer reference, alias, or currency

Rejected. These values are not canonical financial identity and may be opaque, stale, ambiguous, or owned by another namespace. Existing records require explicit target selection and controlled evidence.

### Allow any accounting unit accepted by the generic Ledger API

Rejected for customer-wallet mapping. The current WalletAccount trigger and reconciliation contract require `CUSTOMER_FUNDS`; allowing settlement or another unit would blur financial ownership and violate the current wallet invariant.

### Store a balance snapshot in the mapping record

Rejected. Ledger-derived balance remains the only financial truth; a snapshot would drift and could be mistaken for an authoritative balance.

### Use the mapping idempotency key as the WalletAccount creation key and Ledger journal key

Rejected. Command scopes have different owners and lifecycles. A3 mapping idempotency, WalletAccount creation idempotency, and future journal idempotency must remain distinct and explicitly correlated.

### Automatically bind an existing non-empty or opaque wallet

Rejected. A matching currency or zero/non-zero balance does not prove ownership. Existing financial history with unresolved customer identity enters controlled review rather than silent binding.

### Create a journal or opening balance during mapping

Rejected. Account mapping creates no monetary value. Opening value, transfers, deposits, withdrawals, and compensating entries belong to later approved financial contracts.

## Consequences

### Positive

- Mapping is reproducible from canonical identity and explicit financial dimensions.
- Existing opaque customer references remain unchanged and cannot silently become financial identity.
- New account provisioning is separated from money movement and creates no journal value.
- Currency, accounting-unit, account type, normal balance, and activity checks fail closed.
- Idempotency, concurrent provisioning, retries, and unknown outcomes have explicit behavior.
- A3T04 receives a physical-schema contract without changing source authority.

### Trade-offs

- Existing financial wallets with opaque or ambiguous customer values require explicit target review or later repair rather than automatic migration.
- The Wallet owner must expose a safe provisioning/read contract that can participate in the binding transaction.
- The binding and WalletAccount creation idempotency records require distinct scopes and correlation.
- At most one active financial mapping per canonical Customer-plus-currency scope can leave additional same-currency metadata candidates pending until a separately approved account-class decision exists.
- Formal approval by Wallet, Ledger, Finance, Reconciliation, Operations, Security, and Customer Engineering remains required before implementation.

## Explicitly out of scope

This ADR does not:

- create or modify the binding entity, migration, indexes, foreign keys, repositories, or source schemas;
- implement the mapping/provisioning command, WalletAccount/LedgerAccount creation, read model, reconciliation query, repair executor, or API;
- migrate, normalize, or rewrite existing `WalletAccount.customerId` values;
- post journals, create transfers/deposits/withdrawals, change balances, create opening value, or perform financial correction; or
- implement A2 authentication/authorization, A4 policy, A5 financial commands, A6 providers, settlement, callbacks, or external sharing.

## Dependencies and references

- [`A3-IMPLEMENTATION-PLAN.md`](../A3-IMPLEMENTATION-PLAN.md)
- [`A3-BINDING-BASELINE.md`](../A3-BINDING-BASELINE.md)
- [`ADR-0031-Customer-to-Financial-Account-Identity-Binding.md`](ADR-0031-Customer-to-Financial-Account-Identity-Binding.md)
- [`ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md`](ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md)
- [`A3-BINDING-OWNERSHIP-MATRIX.md`](../A3-BINDING-OWNERSHIP-MATRIX.md)
- [`A5-COMMAND-CORRELATION-INPUTS.md`](../A5-COMMAND-CORRELATION-INPUTS.md)
- [`CROSS-CUTTING-CONTRACTS.md`](../CROSS-CUTTING-CONTRACTS.md)
- [`ADR-0002-Money-Representation.md`](ADR-0002-Money-Representation.md)
- [`ADR-0004-Wallet-and-Ledger.md`](ADR-0004-Wallet-and-Ledger.md)
- [`ADR-0005-Independent-Reconciliation.md`](ADR-0005-Independent-Reconciliation.md)
- [`ADR-0008-Operational-Resilience.md`](ADR-0008-Operational-Resilience.md)
- [`ADR-0012-Customer-Foundation.md`](ADR-0012-Customer-Foundation.md)
- [`ADR-0015-Customer-Wallet-Provisioning.md`](ADR-0015-Customer-Wallet-Provisioning.md)
- [`ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR-0023-Customer-Identifier-and-Reference-Conventions.md)
- [`ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md)

## Verification and approval record

A3T03 validation must confirm:

- [x] Mapping modes, canonical identity inputs, target-selection rules, and active postconditions are explicit.
- [x] Currency normalization and exact cross-record currency equality are explicit.
- [x] The only supported customer-wallet accounting unit is `CUSTOMER_FUNDS`.
- [x] Ledger account type, normal balance, negative-balance, activity, and WalletAccount relationship requirements are explicit.
- [x] Mapping contains no amount or journal-posting operation and cannot create monetary value unexpectedly.
- [x] Idempotency scope, request-hash inputs, replay, changed-payload conflict, and concurrent behavior are explicit.
- [x] Partial failure, timeout/unknown outcome, duplicate, missing-account, and incompatible-dimension outcomes have controlled states.
- [x] A3 does not use a display/reference value as financial identity.
- [ ] Mapping request/result and failure-state contract approval is recorded.

This ADR is a proposed decision input. It does not authorize schema, provisioning, migration, API, or runtime implementation until the accountable approval record is completed.
