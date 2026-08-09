# ADR-0084 — B2 Finance Chart Classification and A5 Account Mapping

- **ADR ID:** ADR-0084
- **Platform:** B2 — Finance Platform
- **Task:** B2F03 — Finance Chart Classification and A5 Account Mapping Contract
- **Status:** Accepted for the B2F03 architecture contract; runtime mapping not implemented
- **Decision date:** 2026-08-09
- **Authoritative contract:** [`docs/B2F-CHART-CLASSIFICATION-CONTRACT.md`](../B2F-CHART-CLASSIFICATION-CONTRACT.md)
- **Application source, entity, migration, service, controller, route, API, configuration, ledger-account, mapping-record, posting, balance, and frontend changes:** None

## 1. Context

A5 already owns `ledger_accounts`, canonical UUIDs, account codes/names, types, normal balances, currency, accounting unit, active state, negative-balance policy, journals, lines, postings, balances, invariants, and reversals. Evidence: `src/ledger/*` and migration `1785753600000-CreateWalletAndLedger.ts`.

A5 supports five account types (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`) but has no verified hierarchy, financial-statement group, operating classification, contra metadata, legal-entity field, Finance book, period, cost center, tax class, or reporting dimension. `LedgerService` creates and reads accounts, while balances are derived from immutable lines.

Migration `1785753600002-CreatePaymentCapabilities.ts` seeds three legacy `PAYMENT-*` accounts. Wallet provisioning creates customer-funds liability accounts. Existing reconciliation aggregates by A5 type/currency/accounting unit. B1 produces commercial-financial decisions, and A6 produces settlement/suspense evidence, but neither defines Finance-to-A5 chart classification.

B2 Finance needs classification and mapping metadata for future accounting treatment, reconciliation, close, and accounting outputs. Creating another account table or numbering authority would duplicate A5.

## 2. Decision

### 2.1 Separate Finance classification from A5 identity

A5 UUID remains the only canonical account identity and posting target. B2 Finance defines classification metadata and one-to-one mapping records from a Finance role to one A5 UUID.

A Finance classification:

- is not an A5 account ID/code;
- cannot receive a journal line;
- has no balance;
- cannot create/update/deactivate an A5 account;
- cannot override A5 type, normal balance, currency, unit, flags, posting, or reversal.

### 2.2 Classification hierarchy

The hierarchy is:

```text
Finance Book
  -> Statement Section
    -> A5-Compatible Account Class
      -> Finance Account Group
        -> Finance Account Role
          -> A5 Account Mapping
```

Statement sections are `BALANCE_SHEET` and `PROFIT_AND_LOSS`. Finance classes exactly mirror A5 types. Groups define current/non-current asset/liability, equity, operating/non-operating revenue, cost of revenue, operating/non-operating expense, and tax expense.

The hierarchy is Finance reporting/accounting metadata only; A5 has no verified account hierarchy.

### 2.3 Normal-balance and compatibility

Ordinary mappings require:

- assets/expenses -> debit-normal A5 accounts;
- liabilities/equity/revenue -> credit-normal A5 accounts;
- `NGN`;
- `CUSTOMER_FUNDS`;
- active A5 account;
- role-compatible negative-balance policy;
- effective compatible book/classification/mapping versions;
- no duplicate active primary mapping.

Type or normal-balance mismatch fails closed.

### 2.4 Customer funds

Customer wallet A5 accounts map to `finance.liability.customer-funds` only when canonical wallet/A3 ownership evidence confirms a non-negative `LIABILITY`/`CREDIT` NGN customer-funds account.

Many wallet A5 accounts may map to the same classification. Code prefix alone is insufficient.

### 2.5 Settlement and suspense

The contract defines:

- `finance.asset.settlement`;
- `finance.asset.settlement-clearing`;
- `finance.liability.settlement-suspense`.

The seeded accounts are candidate mappings, not active B2 records:

- `...0201` / `PAYMENT-SETTLEMENT_ASSET-NGN` -> settlement asset candidate;
- `...0202` / `PAYMENT-SETTLEMENT_CLEARING-NGN` -> clearing candidate pending usage review;
- `...0203` / `PAYMENT-SYSTEM_SUSPENSE-NGN` -> suspense candidate pending negative-balance/economic-control review.

A6 settlement/suspense evidence remains A6-owned. An A6 suspense row is not automatically an A5 suspense-account balance.

### 2.6 Revenue, expense, liability, equity, and contra roles

The contract defines bounded role vocabularies for fee/commission/revenue-share revenue, commission/revenue-share/cost/tax expenses, future payables, and equity groups. No concrete A5 revenue, expense, payable, or equity accounts were verified; those roles remain unmapped.

B1 decision kind alone cannot select a Finance account. B2F09 must determine accounting treatment first.

Contra semantics are documented but active contra mapping is prohibited in v1 because A5 enforces standard normal balances by account type. B2 cannot simulate contra treatment by negating balances or misclassifying accounts.

### 2.7 Mapping model and cardinality

A future immutable mapping binds one book/classification version to one A5 UUID and carries an observed A5 metadata snapshot/hash, purpose, status, effective interval, approval, audit, and retention evidence.

- One classification may map many A5 accounts.
- Each mapping record targets one A5 account.
- One A5 account may have only one overlapping active `PRIMARY` classification per book.
- Split/percentage and many-to-many mappings are prohibited.

Statuses are `DRAFT`, `PENDING_APPROVAL`, `ACTIVE`, `SUSPENDED`, `REJECTED`, and `RETIRED`.

### 2.8 Ambiguity and unmapped handling

Missing, inactive, incompatible, duplicated, overlapping, drifted, unsupported contra, source-less, code-only, or otherwise ambiguous mappings fail closed. B2 never resolves ambiguity by creating/renaming an A5 account or selecting the first textual match.

Unmapped A5 accounts remain valid A5 history but cannot be used by a future B2 Finance posting request. Finance reconciliation must report them.

### 2.9 B1/A6 handoffs

B1 remains authoritative for fee, commission, revenue share, billing, invoice, commercial statement, recognition, tax, cost, profitability, and commercial reconciliation. B2 references B1 versions/hashes and later maps approved Finance treatment to roles.

A6 remains authoritative for external operation, settlement, suspense, reversal, and external reconciliation. B2 correlates A6 account/journal references and never mutates A6 source evidence.

### 2.10 Idempotency, audit, approval, and hashing

The future mapping idempotency scope is reserved as:

```text
b2.finance.account-mapping.idempotency.v1
```

No idempotency record is created by this ADR.

Classification/mapping definitions use canonical SHA-256 hashes, immutable versions, effective dates, replay/conflict rules, shared Operations audit/idempotency, and A2 privileged approvals. Activation/reactivation/retirement and material exceptions require requester/approver separation. B9 later administers IAM.

### 2.11 No runtime implementation

ADR-0084 creates no mapping table/entity/service/API or active mapping. Runtime implementation requires a separate task. No A5 account or migration changes are authorized.

## 3. Consequences

### 3.1 Positive

- Finance can classify and aggregate A5 facts without copying account authority.
- Existing A5 UUIDs/codes and migrations remain stable.
- Customer funds, settlement assets, clearing, and suspense receive explicit bounded treatment.
- B1 commercial decisions and A6 settlement facts remain source-owned.
- Ambiguous/unmapped/drifted accounts fail visibly instead of being silently guessed.
- Later B2F05/B2F10/B2F12 can resolve postings, reconciliation, and outputs through effective mappings.

### 3.2 Constraints and review obligations

- Revenue, expense, payable, equity, and contra mappings cannot activate without approved A5 accounts/treatment.
- Clearing-account use and suspense negative-balance policy require review.
- Current A5 has no hierarchy or contra support.
- Current reconciliation is not mapping-aware.
- Finance cannot post using classification keys.
- Chart overlays for tax/regulatory/management/consolidation are outside v1.

## 4. Alternatives considered

### 4.1 Copy A5 accounts into a Finance chart table

**Rejected.** This would create a competing account master and drift risk.

### 4.2 Use A5 account code as Finance identity

**Rejected.** Canonical identity is UUID; codes are mutable/descriptive in principle and code-prefix inference is ambiguous.

### 4.3 Encode Finance classification in A5 code

**Rejected.** It couples accounting presentation to numbering text and would require renaming existing accounts.

### 4.4 Allow one A5 account to split across classifications

**Rejected for v1.** Percentage allocation introduces many-to-many ambiguity and cost-allocation behavior that belongs to later approved accounting treatment.

### 4.5 Automatically map all `WALLET-*` and `PAYMENT-*` codes

**Rejected.** Wallet/A3 and payment/A6 relationships are required; text alone is insufficient.

### 4.6 Create missing revenue/expense/equity accounts now

**Rejected.** B2F03 is contract-only, and account creation remains A5 authority with future Finance-governed approval.

### 4.7 Support contra accounts by reversing report signs

**Rejected.** It would hide incompatibility with A5 normal-balance rules and create a second balance interpretation.

## 5. Required follow-up

1. Finance/Ledger review the seeded `PAYMENT-*` candidates.
2. Finance/Operations define clearing use, aging, and zero-balance controls.
3. Finance/Ledger/Reconciliation define suspense sign, aging, clearing, and negative-balance policy.
4. B2F05 uses only active mappings to resolve A5 posting targets.
5. B2F06 defines mapping approval/materiality roles.
6. B2F09 defines B1/A6/A7 source-to-accounting treatment.
7. B2F10 implements mapping/unmapped/drift reconciliation.
8. B2F12 consumes effective mappings for accounting output grouping.
9. Retention durations and any future overlay/contra requirements receive accountable review.

No follow-up begins automatically.

## 6. Verification

- [x] ADR-0084 follows highest existing ADR-0083; no ADR was renumbered.
- [x] A5 UUID/type/normal-balance/currency/unit/status/flag authority is preserved.
- [x] Finance classifications are non-posting metadata with no balance.
- [x] Classification hierarchy, classes, groups, roles, statement grouping, and operating split are defined.
- [x] Customer-funds, settlement, clearing, suspense, revenue, expense, asset, liability, equity, and contra semantics are bounded.
- [x] Mapping identity/version/effective dates/status/cardinality/ambiguity/unmapped handling are defined.
- [x] Legacy accounts are candidates only; no replacement account is created.
- [x] B1 and A6 authority remains intact.
- [x] Reconciliation, idempotency, audit, maker-checker, hash/version, compatibility, retention, and failure expectations are defined.
- [x] No runtime source, migration, A5 account, mapping record, API, or frontend is created.
