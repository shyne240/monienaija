# A3T03 — Wallet Provisioning to Ledger Account Mapping Contract

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T03 — Wallet Provisioning to Ledger Account Mapping Contract
- **Status:** Proposed for contract approval
- **Contract version:** `A3-WALLET-LEDGER-MAPPING.v1`
- **Date:** 2026-08-06
- **Owner:** `wallet` bounded context, through the co-located A3 account-binding capability
- **Application changes:** None
- **Database/data changes:** None

## 1. Purpose and boundary

This document defines the deterministic, auditable contract for mapping an approved `CustomerWallet` provisioning record to a ledger-backed `WalletAccount` and its `LedgerAccount`.

It is a contract design only. It does not create the A3 binding record, alter the current Wallet or Ledger services, create a migration, provision an account, expose an API, post a journal, or repair existing data.

The contract preserves these authorities:

- `Customer.id` is the canonical customer identity.
- `CustomerWallet` is customer-wallet provisioning metadata.
- `WalletAccount` is the financial wallet facade.
- `LedgerAccount`, journals, lines, and balances are Ledger/Finance authority.
- Operations owns scoped idempotency and audit evidence.
- Reconciliation independently verifies the mapping and source relationships.
- A2 supplies the authenticated principal and authorization decision.

The mapping contains no amount and has no journal-posting effect. Creating an empty financial account is account provisioning, not creation of monetary value.

## 2. Contract decisions

### 2.1 Supported mapping modes

| Mode            | Required target                  | Purpose                                                                                                                                    | Financial source effect                                                                                                                 |
| --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `PROVISION_NEW` | No `targetWalletAccountId`       | Request one new WalletAccount/LedgerAccount pair for the canonical Customer-plus-currency scope and bind it to the approved CustomerWallet | May create one empty compatible LedgerAccount and one WalletAccount through Wallet/Ledger owner contracts; creates no journals or lines |
| `BIND_EXISTING` | Explicit `targetWalletAccountId` | Bind one specifically identified existing WalletAccount after source, ownership, dimension, and history review                             | Creates or updates only the binding association; does not change WalletAccount, LedgerAccount, journals, lines, or balances             |

A mapping must never search for a financial account by `WalletAccount.customerId`, Customer reference, wallet alias, account code, provider ID, or currency alone. An existing candidate discovered through a compatibility scan is not selected automatically.

### 2.2 Canonical identity and target rules

- `customerId` is the canonical `Customer.id` UUID. A customer reference or opaque compatibility value is rejected as the customer identity input.
- `customerWalletId` is the explicit `CustomerWallet.id` UUID.
- `targetWalletAccountId` is required for `BIND_EXISTING` and forbidden for `PROVISION_NEW`.
- `expectedLedgerAccountId`, when present, is an expected-value assertion only. It must equal the actual `WalletAccount.ledgerAccountId`; it cannot select an independent LedgerAccount.
- A successful result returns the actual `WalletAccount.id` and the actual `LedgerAccount.id` reached through the WalletAccount relationship.
- A `CustomerWallet` can have at most one active binding, a WalletAccount can have at most one active binding, and a LedgerAccount can have at most one active binding.
- At most one active mapping exists for a canonical Customer UUID and normalized currency. Multiple metadata candidates in that scope are not silently merged or selected.
- `WalletAccount.customerId` remains an opaque compatibility field. For a newly provisioned WalletAccount, the approved new-record compatibility value is the lowercase serialized Customer UUID; existing compatibility values are never rewritten by this contract.

### 2.3 Account compatibility rules

For an active mapping, the target must satisfy all of the following:

```text
Customer.status = ACTIVE and Customer is not deleted
CustomerWallet.status = ACTIVE and CustomerWallet is not deleted
CustomerWallet.customerId = Customer.id
CustomerWallet.currency = WalletAccount.currency
WalletAccount.status = ACTIVE
WalletAccount.ledgerAccountId = LedgerAccount.id
LedgerAccount.currency = WalletAccount.currency
LedgerAccount.accountingUnit = CUSTOMER_FUNDS
LedgerAccount.accountType = LIABILITY
LedgerAccount.normalBalance = CREDIT
LedgerAccount.allowNegativeBalance = FALSE
LedgerAccount.isActive = TRUE
```

The current `wallet_accounts` database trigger already requires the WalletAccount-to-LedgerAccount compatibility conditions. A3 mapping must use those conditions; it must not weaken or bypass them.

### 2.4 Approved CustomerWallet provisioning state

The mapping consumes an approved active CustomerWallet state. It does not reimplement P1.4 onboarding/eligibility logic or introduce A4 policy:

- `ACTIVE` CustomerWallet metadata is required for an active mapping.
- `PENDING` CustomerWallet metadata produces a non-active pending outcome and must not provision a financial account.
- `SUSPENDED` or `CLOSED` metadata does not produce an active mapping.
- Customer identity, CustomerWallet ownership evidence, deletion state, and optimistic versions must be checked before a new result is returned.

A3 uses source state as a precondition; A4 remains the authority for product eligibility, risk, compliance, limits, and policy decisions.

## 3. Mapping request contract

The following is a logical contract. Physical DTOs, entities, and persistence columns belong to later tasks and are explicitly out of scope here.

| Field                           | Required                          | Normalization/validation                                                         | Contract role                                                                         |
| ------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `mappingVersion`                | Yes                               | Exactly `1` for this document                                                    | Prevents replaying a request under a changed contract interpretation                  |
| `mode`                          | Yes                               | `PROVISION_NEW` or `BIND_EXISTING`                                               | Selects deterministic target behavior                                                 |
| `customerId`                    | Yes                               | Lowercase hyphenated UUID; must resolve to `Customer.id`                         | Canonical customer subject                                                            |
| `customerWalletId`              | Yes                               | Lowercase hyphenated UUID                                                        | Explicit CustomerWallet metadata subject                                              |
| `currency`                      | Yes                               | Trim, uppercase, three-letter ISO 4217 code                                      | Must equal CustomerWallet and WalletAccount currency                                  |
| `accountingUnit`                | Boundary-normalized               | Trim, uppercase; omitted value becomes `CUSTOMER_FUNDS`                          | Only `CUSTOMER_FUNDS` is accepted for customer-wallet mapping                         |
| `targetWalletAccountId`         | Required only for `BIND_EXISTING` | UUID; absent for `PROVISION_NEW`                                                 | Explicit financial-wallet target; never inferred                                      |
| `expectedLedgerAccountId`       | Optional                          | UUID assertion                                                                   | Must equal WalletAccount.ledgerAccountId when supplied; never an independent selector |
| `expectedCustomerVersion`       | Optional                          | Positive integer when supplied                                                   | Rejects a stale customer source snapshot                                              |
| `expectedCustomerWalletVersion` | Optional                          | Positive integer when supplied                                                   | Rejects a stale CustomerWallet source snapshot                                        |
| `idempotencyKey`                | Yes                               | Trimmed opaque value, 1-255 characters under Operations rules                    | Retry identity for this command scope, not a resource identity                        |
| `requestId`                     | Context                           | Production/HTTP request context                                                  | Evidence for one transport attempt; excluded from business request hash               |
| `traceId`                       | Context                           | Production/observability context                                                 | Trace evidence; excluded from business request hash                                   |
| `correlationId`                 | Context                           | Workflow/request correlation context                                             | Joins audit/support/reconciliation evidence; excluded from business request hash      |
| `causationId`                   | Optional context                  | Immediate parent command/event where applicable                                  | Causation evidence; excluded from business request hash                               |
| `actorContext`                  | Required at protected boundary    | A2 principal, authorization decision, scope, and approval context where required | Authorization evidence; not a substitute for customer or account identity             |

### 3.1 Request invariants

- `PROVISION_NEW` must not include `targetWalletAccountId`.
- `BIND_EXISTING` must include `targetWalletAccountId`; an expected LedgerAccount UUID can only assert the target's existing relationship.
- No request field accepts a customer reference, wallet alias, payment reference, provider reference, account code, or arbitrary `WalletAccount.customerId` as canonical identity.
- The request contains no `amountMinor`, journal lines, transfer details, deposit/withdrawal details, opening balance, or settlement data.
- Transport context and authorization are carried separately from the canonical mapping intent so a retry from a new HTTP request can be recognized without treating request IDs as resource identity.

## 4. Normalization and request hash

### 4.1 Normalized mapping intent

The canonical business request is the following object, with keys serialized in lexicographic order and no insignificant whitespace:

```json
{
  "accountingUnit": "CUSTOMER_FUNDS",
  "customerId": "<canonical-customer-uuid>",
  "customerWalletId": "<customer-wallet-uuid>",
  "currency": "NGN",
  "expectedCustomerVersion": 3,
  "expectedCustomerWalletVersion": 2,
  "expectedLedgerAccountId": null,
  "mappingVersion": 1,
  "mode": "PROVISION_NEW",
  "targetWalletAccountId": null
}
```

The exact normalized object includes only fields present in the contract and uses explicit `null` for optional target/assertion fields when the mode requires them to be absent. The request hash must include any optional source-version assertion or mapping option that can change the result.

### 4.2 Hash rules

- Compute a SHA-256 digest of the canonical normalized JSON.
- Persist and compare the result as lowercase hexadecimal, exactly 64 characters, matching the existing Operations and financial request-hash conventions.
- Do not include `idempotencyKey`, `requestId`, `traceId`, `correlationId`, `causationId`, transport headers, or presentation-only actor fields in the business request hash.
- Do include mapping version, mode, canonical IDs, normalized currency/accounting unit, explicit target/assertion IDs, expected source versions, and any approved behavior-affecting option.
- A changed canonical request under the same idempotency key is a conflict, even if the changed request would otherwise be valid.

### 4.3 Idempotency scope and subordinate wallet key

The proposed Operations scope is:

```text
wallet.account-binding.v1
```

The scope is distinct from Ledger journal scopes, future A5 financial command scopes, and the current WalletAccount `creation_idempotency_key` column.

For `PROVISION_NEW`, the Wallet owner may need a subordinate creation key. It must be derived deterministically from the canonical mapping scope, for example:

```text
A3-WALLET-PROVISION-V1:<sha256(Customer.id + "|" + currency)>
```

The exact encoding is an implementation detail for A3T05, but it must be namespaced, bounded, deterministic, and distinct from the caller's mapping idempotency key. It must not contain a raw secret or become the binding resource ID.

## 5. Provisioning and binding flow contract

### 5.1 `PROVISION_NEW`

The later execution contract must:

1. Authenticate and authorize the actor through A2.
2. Normalize the request and reserve/replay the mapping idempotency record through Operations.
3. Read Customer, CustomerWallet, ownership, source versions, and existing active binding scope.
4. Require active, non-deleted, ownership-consistent Customer and CustomerWallet sources.
5. Require no existing active mapping for the CustomerWallet or canonical Customer-plus-currency scope.
6. Ask the Wallet owner to provision one compatible empty LedgerAccount and WalletAccount, using the approved Wallet/Ledger contracts.
7. Ensure the new WalletAccount compatibility value is the canonical Customer UUID only as a new-record compatibility value; do not use that column as authority.
8. Write the binding association and required audit/idempotency outcome in the same approved transaction boundary.
9. Return the WalletAccount and LedgerAccount UUIDs with explicit currency, accounting unit, binding state, and recovery status.
10. Confirm that no journal or line was created and no balance was changed.

If a legacy or opaque candidate account is discovered during step 3, the operation must not create a second account or select the candidate. It enters a controlled duplicate/repair outcome for later review.

### 5.2 `BIND_EXISTING`

The later execution contract must:

1. Authenticate and authorize the actor through A2.
2. Normalize the request and reserve/replay the mapping idempotency record through Operations.
3. Read Customer, CustomerWallet, ownership, and source versions.
4. Require an explicit `targetWalletAccountId`; never infer the target.
5. Read the WalletAccount and its actual LedgerAccount relationship through Wallet/Ledger contracts.
6. Validate currency, accounting unit, account type, normal balance, negative-balance rule, activity, lifecycle, and active-edge uniqueness.
7. Review existing compatibility value and financial-history evidence. An opaque or ambiguous customer value, unresolved ownership history, or unexpected existing financial activity enters `REPAIR_REQUIRED`; it is not silently claimed.
8. Write only the approved binding association and required operational evidence.
9. Return the unchanged WalletAccount/LedgerAccount source IDs and explicit dimensions.
10. Confirm that no WalletAccount compatibility value, LedgerAccount, journal, line, balance, or posted financial record was changed.

A zero balance is not by itself proof of ownership. A non-zero or historically active account is not automatically bindable without explicit approved evidence.

## 6. Mapping result contract

A logical result contains the following fields; it does not expose a mutable balance source:

| Field              | Meaning                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `outcome`          | `PROVISIONED_AND_BOUND`, `BOUND_EXISTING`, `REPLAYED`, `PENDING`, `REPAIR_REQUIRED`, or `REJECTED`                  |
| `bindingState`     | `PENDING`, `ACTIVE`, `SUSPENDED`, `REPAIR_REQUIRED`, or `CLOSED`, when a binding state exists                       |
| `mappingVersion`   | Contract version used for the result                                                                                |
| `customerId`       | Canonical Customer UUID                                                                                             |
| `customerWalletId` | CustomerWallet UUID                                                                                                 |
| `walletAccountId`  | WalletAccount UUID when a durable target exists                                                                     |
| `ledgerAccountId`  | LedgerAccount UUID reached through WalletAccount                                                                    |
| `currency`         | Normalized explicit currency                                                                                        |
| `accountingUnit`   | Explicit `CUSTOMER_FUNDS` value                                                                                     |
| `idempotency`      | Scope, key reference/status, request hash, and replay indicator under Operations controls; secrets are not returned |
| `sourceVersions`   | Customer/CustomerWallet versions or source snapshot values used for the decision                                    |
| `correlationId`    | Workflow evidence for support/reconciliation                                                                        |
| `recovery`         | Retry, pending, repair owner/state, or controlled failure information when not active                               |

A result must not include `balanceMinor`, journal lines, credentials, raw customer profile/KYC data, raw compatibility values, or authorization secrets. A later read model may obtain a ledger-derived balance through an approved read contract; this mapping result is not that read model.

### 6.1 Outcome semantics

| Outcome                 | Meaning                                                                                                                   | Active mapping claim                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `PROVISIONED_AND_BOUND` | New compatible empty financial account and binding committed                                                              | Yes, only when `bindingState = ACTIVE` and all active preconditions pass |
| `BOUND_EXISTING`        | Explicit existing compatible target was bound without changing financial source records                                   | Yes, only when `bindingState = ACTIVE` and ownership/history checks pass |
| `REPLAYED`              | Identical idempotent request returned the durable original result                                                         | Same as the original result; never creates a second effect               |
| `PENDING`               | Source activation or transaction outcome is not complete/known                                                            | No; callers and reconciliation must not present active account success   |
| `REPAIR_REQUIRED`       | Duplicate, ambiguity, partial failure, source drift, or ownership evidence requires controlled review                     | No; no reassignment or financial command is implied                      |
| `REJECTED`              | Deterministic validation, authorization, state, dimension, or changed-payload conflict failed before a successful mapping | No; no successful mapping is claimed                                     |

## 7. Failure-state and recovery matrix

| Failure or scenario                                                                                          | Result/outcome                                                                                    | Source writes                                                     | Retry/recovery behavior                                                                     | Owner/evidence                                           |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Invalid UUID, missing required mode/target, malformed currency, or invalid unit                              | `REJECTED`                                                                                        | None                                                              | Correct request; same key with changed hash conflicts                                       | A3 boundary; A2/Operations denial/audit where applicable |
| Customer reference, alias, provider value, or opaque `customerId` supplied as canonical identity             | `REJECTED`                                                                                        | None                                                              | Do not transform; caller must provide Customer UUID                                         | Customer/Wallet; identifier-control evidence             |
| Customer missing, deleted, or not `ACTIVE`                                                                   | `REJECTED`                                                                                        | None                                                              | No account creation; source owner resolves lifecycle                                        | Customer and Operations evidence                         |
| CustomerWallet missing, deleted, ownership-mismatched, or stale                                              | `REJECTED` for a new request; `REPAIR_REQUIRED` if an existing binding/source drift is discovered | None for rejected request                                         | Refresh source/version; repair existing drift through A3T08                                 | Customer-wallet, Wallet, Reconciliation                  |
| CustomerWallet `PENDING`                                                                                     | `PENDING`                                                                                         | No financial account creation                                     | Retry the same intent after approved activation                                             | Customer-wallet source and correlation evidence          |
| CustomerWallet `SUSPENDED` or `CLOSED`                                                                       | `REJECTED` for new activation; existing binding becomes non-active under ADR-0033                 | No cross-domain cascade                                           | Source owner controls reactivation; closed identity is not reopened                         | Customer-wallet and binding owner                        |
| CustomerWallet currency differs from requested currency                                                      | `REJECTED`                                                                                        | None                                                              | Correct the request or use the matching source currency; no conversion                      | Finance/Wallet validation                                |
| WalletAccount currency differs from CustomerWallet/request                                                   | `REJECTED` or `REPAIR_REQUIRED` if durable mapping already exists                                 | No financial mutation                                             | Do not adjust currency; controlled review for existing drift                                | Wallet/Ledger/Reconciliation                             |
| Accounting unit is not `CUSTOMER_FUNDS`                                                                      | `REJECTED` or `REPAIR_REQUIRED` for existing drift                                                | None                                                              | Do not remap or change LedgerAccount unit                                                   | Ledger/Finance                                           |
| LedgerAccount missing, inactive, wrong type, wrong normal balance, negative allowed, or wrong currency/unit  | `REJECTED` for an uncommitted candidate; `REPAIR_REQUIRED` for durable source drift               | No account mutation by mapping                                    | Wallet/Ledger owner reviews target; no mutation to force compatibility                      | Wallet/Ledger/Finance                                    |
| `BIND_EXISTING` target omitted or target found only by a compatibility scan                                  | `REJECTED`                                                                                        | None                                                              | Require explicit WalletAccount UUID and approved evidence                                   | Wallet/Customer Engineering                              |
| Existing target has ambiguous opaque customer value or unresolved financial history                          | `REPAIR_REQUIRED`                                                                                 | No source mutation                                                | Do not bind, rewrite, or delete; A3T08 handles controlled review                            | Wallet, Finance, Reconciliation                          |
| Existing active binding claims CustomerWallet, WalletAccount, LedgerAccount, or Customer-plus-currency scope | `REJECTED` conflict or `REPAIR_REQUIRED` if duplicate durable state exists                        | None                                                              | Same-intent request replays winner; different intent requires review                        | Binding owner and Reconciliation                         |
| Same idempotency scope/key with different request hash                                                       | `REJECTED` conflict                                                                               | None                                                              | Caller must use a new key for a genuinely new intent; no mapping effect                     | Operations                                               |
| Same key/hash already completed                                                                              | `REPLAYED`                                                                                        | None                                                              | Return original durable result after A2 authorization recheck                               | Operations and binding owner                             |
| Same key/hash is currently in progress                                                                       | Controlled in-progress conflict or `PENDING`                                                      | None from duplicate attempt                                       | Do not execute a second operation; query durable outcome/retry safely                       | Operations and binding owner                             |
| Concurrent request with same intent loses active uniqueness race                                             | `REPLAYED` or existing durable result                                                             | One winner only                                                   | Reread committed winner; no duplicate account/binding                                       | Database constraint, Wallet, Reconciliation              |
| Concurrent request with different target/intent                                                              | `REJECTED` conflict or `REPAIR_REQUIRED`                                                          | None from losing request                                          | Preserve winner; investigate conflicting intent                                             | Binding owner, Operations                                |
| Serialization/deadlock failure within bounded retry budget                                                   | Retryable failure; no active success claim                                                        | Transaction rolls back if failure is known                        | Retry bounded under ADR-0008 using same mapping intent/key                                  | Operations/Wallet                                        |
| Timeout or unknown transaction commit outcome                                                                | `PENDING` until durable outcome is verified                                                       | Unknown; do not assume rollback/commit                            | Read idempotency/binding/source state and reconcile; never repeat with a new intent blindly | Operations, Wallet, Reconciliation                       |
| Partial durable account/binding state after failure                                                          | `REPAIR_REQUIRED`                                                                                 | No automatic delete, reassignment, journal, or balance correction | Preserve evidence; A3T08 performs authorized repair/recovery                                | Wallet, Ledger, Finance, Reconciliation                  |
| Audit/idempotency required write fails                                                                       | Transaction fails or `PENDING` if commit is unknown                                               | No success may be reported without required evidence              | Retry same key after outcome check; metrics are not a substitute                            | Operations                                               |
| A2 authorization denied or stale                                                                             | `REJECTED`                                                                                        | None                                                              | Do not retry as a different actor without a new authorized request                          | A2 and Operations                                        |

The matrix distinguishes a rejected precondition from an existing durable drift condition. A mapping operation never “repairs” a source by changing it to match the requested result.

## 8. Concurrency and replay scenarios

### 8.1 Same intent, concurrent requests

Two callers submit the same canonical CustomerWallet, currency, mode, and request intent:

1. Both normalize to the same request hash.
2. Operations reserves one `(wallet.account-binding.v1, key)` or two different keys with the same canonical scope.
3. The database binding scope and active-edge uniqueness rules serialize the result.
4. One operation commits the mapping.
5. The other rereads the durable result and returns `REPLAYED` or the existing mapping result.
6. No second WalletAccount, LedgerAccount, binding, journal, or line is created.

### 8.2 Same key, changed intent

A caller reuses a key with a different target WalletAccount, currency, mode, or source-version assertion. The canonical hash differs, so Operations rejects the request before any mapping mutation.

### 8.3 Different key, same canonical scope

A second key attempts to create another active mapping for the same Customer UUID and currency or CustomerWallet. Active uniqueness rejects it. The request returns the existing mapping only when the target and intent are unambiguous; otherwise it returns conflict/repair evidence. It never silently chooses a different financial account.

### 8.4 Unknown outcome

If the transaction response is lost after the database may have committed:

- do not create a new key or target;
- query the Operations idempotency result, binding scope, WalletAccount, and LedgerAccount relationship;
- return the committed mapping only after identity/dimension checks pass; or
- return `PENDING`/`REPAIR_REQUIRED` and hand the evidence to Reconciliation.

## 9. Partial-failure and compensating-action boundary

A mapping operation does not create monetary value and therefore does not use a compensating ledger journal. Recovery rules are:

- Known transaction rollback: retry the same normalized request with the same idempotency key.
- Unknown commit: inspect durable Operations and binding evidence before retrying; do not assume either outcome.
- Empty LedgerAccount/WalletAccount created without a committed binding: preserve source evidence and mark the operation repair-required; do not delete, reassign, or create a replacement from the mapping command.
- Binding committed while source compatibility cannot be verified: expose `REPAIR_REQUIRED`; do not mark active or copy a balance.
- Any posted journal/line or non-zero financial history discovered on an ambiguous existing target: do not alter it; require Finance/Ledger/Reconciliation review.
- Audit and idempotency evidence must remain correlated with the same request/correlation context and be retained under the approved schedule/hold.

A3T08 owns repair execution. A3T03 defines the safe outcome boundary only.

## 10. Mapping examples

These examples are contract examples, not executable requests or API definitions.

### Example A — new NGN customer-funds account

```text
mode: PROVISION_NEW
customerId: canonical Customer UUID
customerWalletId: active CustomerWallet UUID
currency: " ngn " -> "NGN"
accountingUnit: omitted -> "CUSTOMER_FUNDS"
targetWalletAccountId: absent
```

Expected result: one compatible empty WalletAccount/LedgerAccount pair and one active binding if all source and uniqueness preconditions pass. No journal, line, amount, or opening balance is created.

### Example B — explicit existing USD target

```text
mode: BIND_EXISTING
customerId: canonical Customer UUID
customerWalletId: active USD CustomerWallet UUID
currency: "USD"
accountingUnit: "CUSTOMER_FUNDS"
targetWalletAccountId: explicit WalletAccount UUID
expectedLedgerAccountId assertion: must equal WalletAccount.ledgerAccountId
```

Expected result: `BOUND_EXISTING` only if source ownership/history evidence, active uniqueness, WalletAccount status, LedgerAccount compatibility, and currency/unit checks pass. The legacy `WalletAccount.customerId` value is preserved.

### Example C — currency mismatch

```text
CustomerWallet.currency: NGN
request.currency: USD
```

Expected result: `REJECTED`; no WalletAccount, LedgerAccount, binding, journal, line, or balance change.

### Example D — settlement accounting unit

```text
request.accountingUnit: SETTLEMENT
CustomerWallet.currency: NGN
```

Expected result: `REJECTED`; the customer-wallet mapping contract supports only `CUSTOMER_FUNDS`. A settlement account is not a customer WalletAccount target.

### Example E — opaque legacy candidate

```text
WalletAccount.customerId: legacy opaque value
request.customerId: canonical Customer UUID
mode: PROVISION_NEW
```

Expected result: no string-based selection. If the legacy candidate creates ambiguity, return `REPAIR_REQUIRED`; otherwise provision only under the explicit canonical mapping scope. Existing legacy value is never rewritten.

## 11. A3T04 handoff

A3T04 may implement the physical binding record and migration only after this contract is approved. The physical design must represent or enforce, under the approved owner:

- canonical Customer UUID;
- CustomerWallet UUID;
- WalletAccount UUID;
- LedgerAccount UUID or exact WalletAccount relationship assertion;
- normalized currency;
- explicit accounting unit;
- binding lifecycle state;
- source/version and audit/correlation evidence as approved;
- active uniqueness for CustomerWallet, WalletAccount, LedgerAccount, and canonical Customer-plus-currency scopes; and
- idempotency/resource outcome references without copying balances or journal lines.

A3T04 must not add a second financial authority, rewrite existing opaque customer values, or create a journal/balance snapshot. Physical column names, indexes, foreign keys, migration order, and rollback mechanics remain A3T04 work.

## 12. Validation and approval record

A3T03 validation must confirm:

- [x] `PROVISION_NEW` and `BIND_EXISTING` modes have deterministic target-selection rules.
- [x] Canonical Customer UUID and CustomerWallet UUID are required; display/reference/opaque values are prohibited as financial identity.
- [x] Currency normalization and exact CustomerWallet/WalletAccount/LedgerAccount currency equality are explicit.
- [x] `CUSTOMER_FUNDS` is the only supported accounting unit for this mapping.
- [x] Liability/credit/non-negative/active LedgerAccount requirements are explicit.
- [x] New account provisioning creates no journal, line, amount, or balance mutation.
- [x] Existing account binding preserves WalletAccount compatibility values and financial history.
- [x] Idempotency scope, canonical request hash, replay, changed-payload conflict, subordinate Wallet key, and concurrent behavior are explicit.
- [x] Missing account, duplicate, mismatch, timeout, partial failure, stale source, and repair-required outcomes are explicit.
- [x] A2 authorization, Operations evidence, and independent Reconciliation are required.
- [x] A5 command-correlation identifiers are cross-referenced without beginning A5 implementation.
- [ ] Wallet, Ledger, Finance, Operations, Reconciliation, Security, and Customer Engineering approval is recorded.

## 13. Explicitly out of scope

A3T03 does not:

- create or modify the binding entity, migration, indexes, foreign keys, repositories, or source schemas;
- implement the WalletAccount/LedgerAccount provisioning command or binding execution;
- migrate, normalize, or rewrite existing `WalletAccount.customerId` values;
- implement customer account/balance read models or reconciliation queries;
- post journals, create transfers/deposits/withdrawals, change balances, create opening value, or perform financial correction;
- implement A2 authentication/authorization, A4 policy, A5 financial commands, A6 providers, settlement, callbacks, or external sharing; or
- execute repair, exception handling, or recovery beyond documenting controlled outcomes.

This contract is a proposed decision input. Formal approval is required before A3T04 schema/migration work begins.
