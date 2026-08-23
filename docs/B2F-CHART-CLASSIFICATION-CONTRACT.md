# B2F03 — Finance Chart Classification and A5 Account Mapping Contract

- **Platform:** B2 — Finance Platform
- **Task:** B2F03 — Finance Chart Classification and A5 Account Mapping Contract
- **Contract:** `B2FinanceChartClassificationContractV1`
- **Contract name:** `B2-FINANCE-CHART-CLASSIFICATION`
- **Contract version:** `1`
- **ADRs:** [`ADR-0084 — B2 Finance Chart Classification and A5 Account Mapping`](ADR/ADR-0084-B2-Finance-Chart-Classification-and-A5-Account-Mapping.md); [`ADR-0089 — B2 Finance-to-A5 Account Mapping Runtime`](ADR/ADR-0089-B2-Finance-to-A5-Account-Mapping-Runtime.md)
- **Status:** Contract and bounded durable mapping runtime implemented; no mapping is auto-activated
- **Book scope:** `finance.book.ng.primary` v1
- **Depends on:** [`B2F-ACCOUNTING-MODEL-CONTRACT.md`](B2F-ACCOUNTING-MODEL-CONTRACT.md), [`B2F-FINANCE-INVENTORY.md`](B2F-FINANCE-INVENTORY.md), and existing A5/B1/A6/A7 authorities
- **Application source, entity, migration, service, controller, route, API, configuration, ledger-account, mapping-record, posting, balance, and frontend changes:** None

## 1. Purpose and bounded first scope

This contract defines the B2 Finance classification hierarchy and the controlled relationship between Finance classifications and existing A5 ledger accounts. It gives Finance a stable vocabulary for accounting role, financial-statement grouping, operating classification, and later reporting without creating another ledger account or account-numbering authority.

The first scope remains exactly:

```text
book:                 finance.book.ng.primary / 1
accounting basis:     ACCRUAL
legal-entity scope:   finance.legal-entity.ng.primary (PENDING_LEGAL_RATIFICATION)
jurisdiction:         NG
currency:             NGN
accounting unit:      CUSTOMER_FUNDS
```

The original B2F03 task defined classifications and mapping contracts without runtime persistence. The bounded prerequisite completed under ADR-0089 now persists and governs Finance mapping metadata only. It does not create an A5 account, copy an A5 account authority, alter an A5 code/type/status, or post value.

### 1.1 Implemented runtime status

The runtime now provides:

- durable `b2f_finance_account_mappings` records;
- lifecycle `DRAFT → PENDING_APPROVAL → ACTIVE`, plus `REJECTED`, `EXPIRED`, and `REVOKED` terminal outcomes;
- canonical A5 verification through `LedgerService.getAccount()`;
- effective dating, immutable semantic versions, deterministic hashes, and shared idempotency;
- A2 privileged approval plus B2F06 controls for activation/rejection/revocation;
- audit, outbox, and metrics through shared Operations services;
- narrow read-only lookup and compatibility consumer ports;
- B2F05 resolution of mapping reference/version before journal-governance creation.

No mapping is seeded or activated by the migration. The documented legacy `PAYMENT-*` accounts remain candidates requiring lifecycle approval. Repository inspection found no verified canonical A5 receivable asset account; the B2F07 AR mapping prerequisite remains `NOT VERIFIED / REQUIRES REVIEW` and no A5 account was created.

B2F07 remains Accounts Receivable, B2F08 remains Accounts Payable, and B2F09 remains Revenue Recognition/Tax/Cost/Commercial Financial Effects. This prerequisite implements none of those tasks.

## 2. Repository evidence and verified A5 baseline

B2F03 reviewed:

- `src/ledger/ledger-account.entity.ts`
- `src/ledger/ledger.enums.ts`
- `src/ledger/ledger.types.ts`
- `src/ledger/ledger.service.ts`
- `src/ledger/ledger.controller.ts`
- `src/migrations/1785753600000-CreateWalletAndLedger.ts`
- `src/migrations/1785753600002-CreatePaymentCapabilities.ts`
- `src/wallet/wallet.service.ts`
- `src/payment/settlement-account.service.ts`
- `src/payment/payment.enums.ts`
- `src/reconciliation/reconciliation.service.ts`
- `docs/A3-WALLET-LEDGER-MAPPING-CONTRACT.md`
- `docs/ADR/ADR-0004-Wallet-and-Ledger.md`
- B1 fee/billing/revenue-recognition/commercial-analytics contracts and types
- A6 settlement/suspense contracts and runtime artifacts

Verified A5 facts:

1. `ledger_accounts.id` is a UUID primary key and is the canonical account identifier.
2. `ledger_accounts.code` is globally unique, but it is descriptive/lookup metadata, not a B2 account identity.
3. A5 account types are exactly `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, and `EXPENSE`.
4. A5 normal balances are exactly `DEBIT` and `CREDIT`; A5 requires assets/expenses to be debit-normal and liabilities/equity/revenue to be credit-normal.
5. A5 stores currency, accounting unit, `allowNegativeBalance`, and `isActive`.
6. A5 has no parent account, hierarchy path, Finance statement group, operating/non-operating field, contra field, legal-entity field, book field, period field, cost center, tax class, merchant class, or reporting dimension.
7. `LedgerService` creates, reads, lists, and balances accounts. No general A5 update/deactivate/delete command was verified.
8. A5 balances are derived from immutable ledger lines; no mutable balance field exists on `ledger_accounts`.
9. Current reconciliation groups accounts by A5 type/currency/accounting unit and uses A5 normal balance.
10. Wallet provisioning creates UUID/code-based customer-funds liability accounts and links them through `wallet_accounts.ledger_account_id`.

Any capability not listed above is not inferred.

## 3. Relationship to A5

### 3.1 Canonical identity

A5 owns and remains authoritative for:

- `ledgerAccountId`;
- account code/name;
- account type and normal balance;
- currency and accounting unit;
- active and negative-balance flags;
- account creation and account-row lifecycle;
- journal/line references;
- posting, balances, value, invariants, and reversal.

A B2 Finance classification or mapping is metadata about an A5 account. It cannot be used as a posting target. A future Finance posting request must resolve its approved classification mapping to the current canonical A5 UUID and then submit that UUID through the A5 posting boundary.

### 3.2 No second chart or numbering authority

B2 Finance does not assign a competing ledger account number. It uses stable classification keys such as `finance.asset.settlement` for Finance semantics and retains the A5 UUID/code separately.

A Finance classification key:

- is not an A5 account ID;
- is not an A5 account code;
- cannot receive a journal line;
- has no balance;
- cannot be treated as proof that an A5 account exists;
- cannot activate/deactivate an A5 account;
- cannot override A5 account type, normal balance, currency, accounting unit, or negative-balance controls.

### 3.3 No current hierarchy in A5

No A5 parent/child account relationship was found. The hierarchy in this contract is a Finance classification/reporting hierarchy only. It must not be represented as an A5 account hierarchy unless A5 separately approves a future compatible extension.

**Status:** A5 account hierarchy is `NOT VERIFIED / REQUIRES REVIEW` and is not required for v1 mapping.

## 4. Finance classification hierarchy

The v1 hierarchy has five levels:

```text
Finance Book
  -> Financial Statement Section
    -> A5-Compatible Account Class
      -> Finance Account Group
        -> Finance Account Role
          -> A5 Account Mapping (one A5 UUID per mapping record)
```

Example:

```text
finance.book.ng.primary
  -> BALANCE_SHEET
    -> ASSET
      -> CURRENT_ASSET
        -> SETTLEMENT_ASSET
          -> A5 ledgerAccountId 00000000-0000-4000-8000-000000000201
```

Only the final mapping points to an A5 account. Higher levels are aggregation/classification nodes and never posting targets.

## 5. Financial-statement sections

B2F03 freezes two statement sections:

- `BALANCE_SHEET` — assets, liabilities, and equity at an accounting cutoff.
- `PROFIT_AND_LOSS` — revenue and expense/cost activity for a period.

This grouping prepares accounting metadata for later B2F12 outputs. It does not generate a balance sheet, P&L, report, or statement. B6 remains Reporting Platform; B7 remains Statement Platform.

## 6. Account classes and A5 type compatibility

Finance account classes exactly mirror existing A5 account types:

| Finance class | Required A5 `accountType` | Standard normal balance | Statement section |
| ------------- | ------------------------- | ----------------------- | ----------------- |
| `ASSET`       | `ASSET`                   | `DEBIT`                 | `BALANCE_SHEET`   |
| `LIABILITY`   | `LIABILITY`               | `CREDIT`                | `BALANCE_SHEET`   |
| `EQUITY`      | `EQUITY`                  | `CREDIT`                | `BALANCE_SHEET`   |
| `REVENUE`     | `REVENUE`                 | `CREDIT`                | `PROFIT_AND_LOSS` |
| `EXPENSE`     | `EXPENSE`                 | `DEBIT`                 | `PROFIT_AND_LOSS` |

A mapping whose Finance class differs from the A5 type is incompatible and must fail closed. B2 cannot reclassify the canonical A5 type through metadata.

## 7. Finance account groups

The v1 classification vocabulary defines these groups:

| Class       | Finance account group   | Operating classification | Mapping readiness                                     |
| ----------- | ----------------------- | ------------------------ | ----------------------------------------------------- |
| `ASSET`     | `CURRENT_ASSET`         | `NOT_APPLICABLE`         | Existing settlement candidates verified               |
| `ASSET`     | `NON_CURRENT_ASSET`     | `NOT_APPLICABLE`         | No concrete A5 account verified                       |
| `LIABILITY` | `CURRENT_LIABILITY`     | `NOT_APPLICABLE`         | Customer-funds and suspense candidates verified       |
| `LIABILITY` | `NON_CURRENT_LIABILITY` | `NOT_APPLICABLE`         | No concrete A5 account verified                       |
| `EQUITY`    | `CONTRIBUTED_EQUITY`    | `NOT_APPLICABLE`         | No concrete A5 account verified                       |
| `EQUITY`    | `RETAINED_EARNINGS`     | `NOT_APPLICABLE`         | No concrete A5 account verified                       |
| `EQUITY`    | `CURRENT_PERIOD_RESULT` | `NOT_APPLICABLE`         | No concrete A5 account verified                       |
| `REVENUE`   | `OPERATING_REVENUE`     | `OPERATING`              | No concrete A5 account verified                       |
| `REVENUE`   | `NON_OPERATING_REVENUE` | `NON_OPERATING`          | No concrete A5 account verified                       |
| `EXPENSE`   | `COST_OF_REVENUE`       | `OPERATING`              | No concrete A5 account verified                       |
| `EXPENSE`   | `OPERATING_EXPENSE`     | `OPERATING`              | No concrete A5 account verified                       |
| `EXPENSE`   | `NON_OPERATING_EXPENSE` | `NON_OPERATING`          | No concrete A5 account verified                       |
| `EXPENSE`   | `TAX_EXPENSE`           | `NON_OPERATING`          | Policy treatment requires review; no account verified |

Group definitions do not manufacture A5 accounts. “No concrete account verified” means the classification may be referenced in policy design, but it cannot be `ACTIVE` for posting until an existing or separately approved A5 account is mapped.

## 8. Finance account-role model

A Finance account role is the lowest classification node. `FinanceAccountRoleV1` must contain:

- contract/book identity and version;
- `classificationKey` and version;
- statement section;
- Finance class and group;
- role code/label/description;
- standard normal balance;
- operating classification;
- customer-funds treatment;
- settlement/suspense treatment;
- contra status/reference;
- required currency/accounting unit;
- required A5 flags where applicable;
- effective dates/status;
- definition hash;
- classification/retention metadata.

It contains no A5 balance and does not become an A5 account.

## 9. Normal-balance semantics

For ordinary mappings:

- asset and expense classifications require A5 `DEBIT` normal balance;
- liability, equity, and revenue classifications require A5 `CREDIT` normal balance.

The sign of a financial-statement presentation amount must derive from the A5 account's normal-balance semantics and immutable lines. Finance classification must not invert value silently.

Any mapping with a type/normal-balance mismatch is `INCOMPATIBLE`, regardless of classification label or account code.

## 10. Operating versus non-operating classification

The v1 vocabulary is:

- `OPERATING` — arises from ordinary approved business operations.
- `NON_OPERATING` — outside ordinary operating revenue/expense classification.
- `NOT_APPLICABLE` — balance-sheet classification where operating split is not assigned by v1.

Only revenue/expense roles may be `OPERATING` or `NON_OPERATING`. Balance-sheet classes use `NOT_APPLICABLE`.

Whether interest, fair-value, exceptional, regulatory, and Treasury items require additional presentation classes is `NOT VERIFIED / REQUIRES REVIEW` and outside the first scope.

## 11. Customer-funds treatment

### 11.1 Classification

Customer wallet funds are classified as:

```text
classificationKey:       finance.liability.customer-funds
statementSection:        BALANCE_SHEET
financeClass:            LIABILITY
accountGroup:            CURRENT_LIABILITY
normalBalance:           CREDIT
operatingClassification: NOT_APPLICABLE
currency:                NGN
accountingUnit:          CUSTOMER_FUNDS
allowNegativeBalance:    false
customerFundsTreatment:  CUSTOMER_FUNDS_LIABILITY
```

This follows ADR-0004 and the wallet/A3 binding contracts. Customer funds are liabilities of the platform and are not revenue, equity, cash, or an expense.

### 11.2 Mapping rule

A customer-funds mapping requires:

- canonical A5 UUID;
- A5 type `LIABILITY` and normal balance `CREDIT`;
- `NGN` and `CUSTOMER_FUNDS`;
- active account;
- `allowNegativeBalance = false`;
- verified `wallet_accounts.ledger_account_id` or A3 binding relationship;
- no conflicting active Finance mapping.

A `WALLET-*` code pattern alone is insufficient. Finance must not infer customer ownership or role from text. Wallet/A3 relationships are canonical evidence.

### 11.3 Aggregation

Many customer wallet A5 accounts may map to the single `finance.liability.customer-funds` classification. Each A5 account retains its UUID and balance. The classification provides aggregation metadata only.

Customer-level statements remain outside B2F03 and B7 remains the broad Statement Platform.

## 12. Settlement and suspense classification

### 12.1 Settlement asset

```text
classificationKey:       finance.asset.settlement
statementSection:        BALANCE_SHEET
financeClass:            ASSET
accountGroup:            CURRENT_ASSET
normalBalance:           DEBIT
operatingClassification: NOT_APPLICABLE
settlementTreatment:     SETTLEMENT_ASSET
```

This role may classify A5 settlement assets used by deposit, withdrawal, and A6 external settlement flows. It does not declare external settlement finality; A6 owns settlement evidence.

### 12.2 Settlement clearing

```text
classificationKey:       finance.asset.settlement-clearing
statementSection:        BALANCE_SHEET
financeClass:            ASSET
accountGroup:            CURRENT_ASSET
normalBalance:           DEBIT
operatingClassification: NOT_APPLICABLE
settlementTreatment:     SETTLEMENT_CLEARING
```

A seeded A5 clearing account exists, but no current runtime use was verified in the inspected source. Its accounting purpose, expected clearing frequency, aging, and zero-balance control are `NOT VERIFIED / REQUIRES REVIEW` before an active mapping.

### 12.3 Settlement suspense

```text
classificationKey:       finance.liability.settlement-suspense
statementSection:        BALANCE_SHEET
financeClass:            LIABILITY
accountGroup:            CURRENT_LIABILITY
normalBalance:           CREDIT
operatingClassification: NOT_APPLICABLE
settlementTreatment:     SETTLEMENT_SUSPENSE
```

The seeded system-suspense account allows a negative balance. Its long-term economic classification, expected sign, aging, clearing rules, and whether it should remain a liability are `NOT VERIFIED / REQUIRES REVIEW`.

An A6 `external_suspense_entries` row is source/exception evidence. It is not automatically the same thing as an A5 suspense-account balance or Finance mapping. B2 must correlate them explicitly and must not clear A6 source evidence.

## 13. Revenue classification

The v1 role vocabulary includes:

| Classification key                | Group                   | B1 source candidate                                                     | A5 mapping status |
| --------------------------------- | ----------------------- | ----------------------------------------------------------------------- | ----------------- |
| `finance.revenue.fee`             | `OPERATING_REVENUE`     | B1 `FEE` decision                                                       | `UNMAPPED`        |
| `finance.revenue.commission`      | `OPERATING_REVENUE`     | B1 `COMMISSION` decision where Finance treatment is revenue             | `UNMAPPED`        |
| `finance.revenue.revenue-share`   | `OPERATING_REVENUE`     | B1 `REVENUE_SHARING` decision where Finance treatment is earned revenue | `UNMAPPED`        |
| `finance.revenue.other-operating` | `OPERATING_REVENUE`     | No first-scope source verified                                          | `UNMAPPED`        |
| `finance.revenue.non-operating`   | `NON_OPERATING_REVENUE` | No first-scope source verified                                          | `UNMAPPED`        |

No concrete A5 revenue account was verified. These roles cannot become active posting classifications until B2F09 establishes treatment and B2F03 runtime maps approved A5 accounts.

A B1 decision kind does not determine the debit/credit accounts by itself. Commission or revenue-sharing may represent revenue, expense, or payable depending on approved commercial context. Automatic role selection from the kind alone is prohibited.

## 14. Expense and cost classification

The v1 role vocabulary includes:

| Classification key                 | Group                                    | B1 source candidate                          | A5 mapping status |
| ---------------------------------- | ---------------------------------------- | -------------------------------------------- | ----------------- |
| `finance.expense.commission`       | `COST_OF_REVENUE`                        | Commission payable/expense treatment         | `UNMAPPED`        |
| `finance.expense.revenue-share`    | `COST_OF_REVENUE`                        | Revenue-share payable/expense treatment      | `UNMAPPED`        |
| `finance.expense.direct-cost`      | `COST_OF_REVENUE`                        | B1 `DIRECT_COST`                             | `UNMAPPED`        |
| `finance.expense.indirect-cost`    | `OPERATING_EXPENSE`                      | B1 `INDIRECT_COST`                           | `UNMAPPED`        |
| `finance.expense.acquisition-cost` | `OPERATING_EXPENSE`                      | B1 `ACQUISITION_COST`                        | `UNMAPPED`        |
| `finance.expense.operational-cost` | `OPERATING_EXPENSE`                      | B1 `OPERATIONAL_COST`                        | `UNMAPPED`        |
| `finance.expense.allocated-cost`   | Determined by approved allocation target | B1 `ALLOCATED_COST`                          | `UNMAPPED`        |
| `finance.expense.tax`              | `TAX_EXPENSE`                            | B1 tax decision only where tax is an expense | `UNMAPPED`        |
| `finance.expense.non-operating`    | `NON_OPERATING_EXPENSE`                  | No first-scope source verified               | `UNMAPPED`        |

No concrete A5 expense account was verified. B1 determines commercial cost/tax inputs; B2F09 determines Finance treatment. This contract does not calculate or allocate cost.

## 15. Asset classification

The first asset roles are:

- `finance.asset.settlement`
- `finance.asset.settlement-clearing`

Additional asset roles such as cash/bank, receivable, prepaid expense, tax receivable, fixed asset, intangible asset, investment, and Treasury asset are not active in v1.

- Receivables belong to later B2F07.
- Treasury assets belong to B3.
- Investment belongs to later E4.
- Foreign-currency assets require E1 and a Finance extension.

No role is mapped without a verified A5 account.

## 16. Liability classification

The first liability roles are:

- `finance.liability.customer-funds`
- `finance.liability.settlement-suspense`

Reserved but unmapped future Finance roles include:

- `finance.liability.commission-payable`
- `finance.liability.revenue-share-payable`
- `finance.liability.tax-payable`
- `finance.liability.accounts-payable`

These reserved roles do not implement AP, tax accounting, or posting. B2F08/B2F09 must establish source/treatment before activation.

## 17. Equity classification

A5 supports `EQUITY`, but no concrete A5 equity account was verified. B2F03 defines classification groups for contributed equity, retained earnings, and current-period result so later closed-period outputs can classify equity without inventing accounts now.

All equity classifications are `UNMAPPED`. Legal-entity capital structure, retained-earnings close mechanics, and current-period-result transfer are `NOT VERIFIED / REQUIRES REVIEW`.

B2F03 does not implement year-end close or equity posting.

## 18. Contra-account semantics

A contra classification would present against another classification and normally uses the opposite normal balance of its A5 class. It would require:

- `isContra = true`;
- `contraToClassificationKey`;
- same statement section and compatible class context;
- opposite normal-balance semantics;
- separate canonical A5 account ID;
- no netting that hides underlying A5 balances.

Current `LedgerService.createAccount()` enforces debit-normal assets/expenses and credit-normal liabilities/equity/revenue. Therefore ordinary contra accounts with opposite normal balance are not supported by the current A5 creation contract.

**Decision:** v1 defines contra semantics for compatibility analysis but prohibits `ACTIVE` contra mappings. Contra runtime is `NOT VERIFIED / REQUIRES REVIEW` and requires a separately approved A5-compatible design. B2 must not simulate contra behavior by negating balances or misclassifying an A5 type.

## 19. A5 account mapping model

### 19.1 Definition

`FinanceA5AccountMappingV1` is an immutable, effective-dated Finance metadata record that binds one Finance account role to one canonical A5 account UUID within one book.

It must carry:

- contract name/version;
- mapping reference/key/version;
- book key/version;
- classification key/version;
- A5 ledger account UUID;
- observed A5 code/name/type/normal balance/currency/accounting unit/flags as verification evidence;
- mapping purpose `PRIMARY`;
- status and effective interval;
- source/definition/mapping hashes;
- approval reference and actor identities;
- request/correlation/causation IDs;
- classification/retention/legal-hold metadata.

Observed A5 metadata is a verification snapshot, not a copied authority. The canonical values remain in A5 and must be rechecked before use.

### 19.2 Runtime persistence

`FinanceA5AccountMappingV1` is persisted as `b2f_finance_account_mappings` by migration `1785753600050`. Persistence records Finance metadata and an observed A5 snapshot/hash for compatibility checks; A5 remains authoritative and is re-read before activation and consumer verification. No A5 values or balances are copied.

## 20. Mapping identity and version

### 20.1 Identity

The mapping key is deterministically scoped as:

```text
finance.account-map.<bookKey>.<classificationKey>.<a5LedgerAccountId>
```

Because UUID punctuation is unsuitable for some key consumers, runtime may hash the composite for storage/reference, but the semantic identity remains the exact tuple:

```text
bookKey + bookVersion + classificationKey + classificationVersion + a5LedgerAccountId
```

The future opaque record reference prefix is `b2f-account-map-`.

### 20.2 Version

`mappingVersion` is a positive integer beginning at 1. A changed classification, account ID, book, compatibility assertion, or effective interval creates a new immutable mapping version; it never edits historical meaning in place.

Mapping version is distinct from book, classification, A5 account, policy, period, and contract versions.

## 21. Effective dates

Every mapping has:

- `effectiveFrom` — required UTC instant;
- `effectiveTo` — null or greater than `effectiveFrom`;
- `approvedAt` — required before `ACTIVE`;
- `retiredAt` — required when `RETIRED`.

Rules:

1. Active intervals for the same A5 account/book/purpose cannot overlap.
2. Historical journals resolve the mapping effective at their Finance accounting date or approved mapping policy, never merely the newest mapping.
3. A mapping change is prospective unless an approved correction/versioning decision explicitly adds a historical presentation restatement; A5 history remains unchanged.
4. Retiring a mapping does not retire/deactivate the A5 account.
5. A5 account drift causes mapping incompatibility/suspension; B2 does not mutate A5 to restore compatibility.

## 22. Mapping status

The status vocabulary is:

- `DRAFT` — proposed mapping, not usable.
- `PENDING_APPROVAL` — compatibility verified, maker-checker decision pending.
- `ACTIVE` — effective and usable for Finance treatment resolution.
- `SUSPENDED` — temporarily unusable due to drift, incident, or control decision.
- `REJECTED` — proposal declined; preserved for audit.
- `RETIRED` — no longer usable prospectively; historical use remains valid.

Allowed transitions:

```text
DRAFT -> PENDING_APPROVAL -> ACTIVE -> SUSPENDED -> ACTIVE
   |             |             |          |
   +-> REJECTED  +-> REJECTED  +----------+-> RETIRED
DRAFT -> RETIRED
```

A mapping cannot become `ACTIVE` while its A5 account is inactive, incompatible, missing, or ambiguously mapped.

## 23. Cardinality rules

### 23.1 Allowed

- One Finance classification may map to many distinct A5 accounts. Example: many customer wallet liabilities aggregate under `finance.liability.customer-funds`.
- One mapping record maps exactly one Finance classification to exactly one A5 account.
- Many A5 accounts may therefore converge on one Finance classification for aggregation.

### 23.2 Prohibited

- One A5 account cannot have more than one overlapping `ACTIVE` `PRIMARY` Finance classification in the same book.
- One mapping record cannot target multiple A5 accounts.
- A percentage/split mapping from one A5 account to multiple classes is prohibited in v1.
- A many-to-many mapping is prohibited.
- A mapping cannot use account code/name/prefix instead of canonical A5 UUID.
- A classification group cannot be used directly as a posting target.

### 23.3 Future overlays

Tax, regulatory, management, consolidation, and alternative reporting overlays are not part of the primary mapping. Their potential need is `NOT VERIFIED / REQUIRES REVIEW` and cannot be represented by duplicate active primary mappings.

## 24. Prohibited ambiguous mappings

A mapping is ambiguous and must fail closed when:

- A5 account ID is missing or not a UUID;
- code/name lookup yields multiple candidates;
- only `WALLET-*` or `PAYMENT-*` text is provided without UUID and authoritative relationship;
- A5 type or normal balance conflicts with classification;
- currency is not `NGN`;
- accounting unit is not `CUSTOMER_FUNDS`;
- A5 account is inactive;
- negative-balance policy conflicts with role requirements;
- another overlapping primary mapping exists;
- source relationship is missing for a customer-funds account;
- classification is a group rather than role;
- contra mapping is requested under v1;
- requested effective interval overlaps;
- book/legal-entity scope differs;
- the classification decision depends solely on a B1 decision kind without B2F09 treatment;
- A6 suspense evidence is treated as proof of a suspense ledger account;
- observed A5 metadata hash has drifted.

Ambiguity must not be resolved by choosing the first account, manufacturing an account, renaming an account, or changing A5 flags.

## 25. Unmapped-account handling

Every A5 account in the bounded book scope should eventually be classified or explicitly excepted. Until an approved effective `ACTIVE` mapping exists:

- existing accounts continue under A5 authority;
- absence of a B2 mapping does not invalidate A5 history;
- an unmapped account cannot be selected by a future B2 Finance posting request;
- reconciliation reports `UNMAPPED_A5_ACCOUNT` with account UUID and minimal metadata;
- Finance/Architecture assigns an owner, reason, materiality, and deadline;
- no automatic classification based on name/code is permitted;
- official B2 financial-statement output must disclose or block on material unmapped balances according to B2F10/B2F12 policy.

Zero-balance and inactive accounts still require review because they may have historical activity.

## 26. Legacy `PAYMENT-*` account handling

Migration `1785753600002-CreatePaymentCapabilities.ts` seeds:

| A5 UUID                                | A5 code                           | A5 facts                                                         | Candidate Finance classification        | B2F03 status                                      |
| -------------------------------------- | --------------------------------- | ---------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------- |
| `00000000-0000-4000-8000-000000000201` | `PAYMENT-SETTLEMENT_ASSET-NGN`    | Asset, debit, NGN, customer funds, non-negative, active          | `finance.asset.settlement`              | `CANDIDATE_VERIFIED`; runtime mapping not created |
| `00000000-0000-4000-8000-000000000202` | `PAYMENT-SETTLEMENT_CLEARING-NGN` | Asset, debit, NGN, customer funds, non-negative, active          | `finance.asset.settlement-clearing`     | `PENDING_USAGE_REVIEW`                            |
| `00000000-0000-4000-8000-000000000203` | `PAYMENT-SYSTEM_SUSPENSE-NGN`     | Liability, credit, NGN, customer funds, negative allowed, active | `finance.liability.settlement-suspense` | `PENDING_CONTROL_REVIEW`                          |

These are evidence-based candidate mappings, not active B2 mapping records.

Rules:

1. Preserve A5 UUIDs/codes and migration history.
2. Do not create replacement “Finance” accounts merely to obtain a new numbering convention.
3. `SettlementAccountService` may continue resolving current codes; B2 does not replace it in this task.
4. Clearing account use/aging/zero-balance controls require Finance/Operations review.
5. System-suspense negative-balance permission and economic presentation require Finance/Ledger/Reconciliation approval.
6. A6 settlement/suspense source evidence remains A6-owned.
7. Any future remap is effective-dated and cannot rewrite prior A5 journals.

## 27. B1-to-Finance classification handoff

### 27.1 Source ownership

B1 remains authoritative for:

- `FEE`, `COMMISSION`, and `REVENUE_SHARING` commercial decisions;
- billing records, invoices, and commercial statements;
- revenue-recognition, tax/VAT, and cost-accounting decisions;
- profitability, analytics, and commercial-reconciliation decisions.

B2 Finance consumes B1 references/versions/hashes. It does not copy B1 decisioning into classification logic.

### 27.2 Treatment before mapping

A B1 source must pass a future B2F09 accounting-treatment decision before account roles are selected. Examples:

- a fee may become earned revenue, receivable, cash/settlement effect, deferred revenue, or no Finance posting depending on approved treatment;
- a commission may become revenue, expense, payable, or no posting;
- revenue share may become revenue, expense/payable, or no posting;
- tax may become tax payable, tax receivable, tax expense, or pass-through treatment;
- cost may map to cost of revenue, operating expense, asset capitalization, or no posting.

B2F03 provides role vocabulary only. It does not choose the treatment or calculate an amount.

### 27.3 No B1 finality substitution

B1 states such as `RECOGNIZED`, `DECLARED`, `ALLOCATED`, invoice `ISSUED`, or statement `CLOSED` are not A5 posting proof and do not activate a mapping.

## 28. A6 settlement and suspense handoff

A6 provides canonical external operation, settlement, suspense, reversal, and reconciliation references. B2 Finance uses those references to choose an already approved role/mapping only after future accounting treatment.

Required correlations include:

- A6 customer ledger account ID -> `finance.liability.customer-funds` candidate;
- A6 settlement asset ledger account ID -> `finance.asset.settlement` candidate;
- A6 settlement/reversal journal IDs -> A5 journal verification;
- A6 suspense entry -> Finance exception classification, not automatic A5 suspense-account mapping;
- A6 reconciliation discrepancy -> B2F10 finance break, not source mutation.

B2 must not create an external settlement, clear A6 suspense, call a partner, or override A6 evidence.

## 29. Reconciliation implications

Future mapping reconciliation must independently compare:

- all in-scope A5 accounts to active/exception mappings;
- mapping snapshot to current A5 UUID/code/type/normal balance/currency/unit/flags/status;
- customer-funds mappings to wallet/A3 ownership links;
- settlement mappings to A6/payment role evidence;
- mapping effective interval to Finance accounting date/period;
- A5 journal account IDs to mappings effective for the Finance treatment;
- B1 source/treatment role to mapped A5 accounts;
- duplicate, overlapping, stale, inactive, missing, and ambiguous mappings;
- legacy account usage and balances.

The discrepancy vocabulary must include:

- `UNMAPPED_A5_ACCOUNT`
- `DUPLICATE_PRIMARY_MAPPING`
- `MAPPING_TYPE_MISMATCH`
- `MAPPING_NORMAL_BALANCE_MISMATCH`
- `MAPPING_CURRENCY_MISMATCH`
- `MAPPING_ACCOUNTING_UNIT_MISMATCH`
- `MAPPING_A5_ACCOUNT_INACTIVE`
- `MAPPING_NEGATIVE_POLICY_MISMATCH`
- `MAPPING_EFFECTIVE_DATE_MISMATCH`
- `MAPPING_OBSERVED_METADATA_DRIFT`
- `MAPPING_CUSTOMER_OWNERSHIP_MISSING`
- `MAPPING_SETTLEMENT_EVIDENCE_MISSING`
- `MAPPING_CONTRA_UNSUPPORTED`
- `MAPPING_SOURCE_TREATMENT_MISSING`
- `MAPPING_QUERY_UNAVAILABLE`

Reconciliation is read-only against A5/B1/A6/A7 and cannot fix a discrepancy by updating those sources.

Existing `ReconciliationService` remains A5/independent evidence. B2F03 does not modify its queries or claim period-aware Finance reconciliation.

## 30. Idempotency requirements

The reserved future scope is:

```text
b2.finance.account-mapping.idempotency.v1
```

No idempotency record is created in B2F03.

The canonical request hash for mapping proposal/transition must include:

- contract/book/classification identities and versions;
- A5 account UUID;
- observed A5 metadata and snapshot hash;
- mapping purpose/status transition;
- effective interval;
- role requirements;
- approval action fingerprint/reference where applicable;
- request/correlation/causation identity according to policy.

Generated mapping reference, database ID, created/updated times, replay flag, and audit/outbox IDs are excluded.

Same scope/key/hash replays the original durable decision; same scope/key with another hash conflicts; in-progress fails closed. Retention duration is `NOT VERIFIED / REQUIRES REVIEW`; immutable mapping/audit history is not deleted with an operational idempotency record.

## 31. Audit requirements

Future runtime must reuse shared `AuditService`. Required actions include:

- `FINANCE_CLASSIFICATION_DEFINED`
- `FINANCE_CLASSIFICATION_VERSION_APPROVED`
- `FINANCE_ACCOUNT_MAPPING_PROPOSED`
- `FINANCE_ACCOUNT_MAPPING_APPROVAL_REQUESTED`
- `FINANCE_ACCOUNT_MAPPING_APPROVED`
- `FINANCE_ACCOUNT_MAPPING_REJECTED`
- `FINANCE_ACCOUNT_MAPPING_ACTIVATED`
- `FINANCE_ACCOUNT_MAPPING_SUSPENDED`
- `FINANCE_ACCOUNT_MAPPING_REACTIVATED`
- `FINANCE_ACCOUNT_MAPPING_RETIRED`
- `FINANCE_ACCOUNT_MAPPING_DRIFT_DETECTED`
- `FINANCE_ACCOUNT_MAPPING_REPLAYED`
- `FINANCE_ACCOUNT_MAPPING_REPLAY_CONFLICT`

Audit evidence includes exact book/classification/mapping versions, A5 UUID, observed metadata hash, prior/new state, effective interval, actor, approval, reason, request/correlation/causation IDs, and event time. Sensitive source payloads and customer data are excluded.

Audit evidence is not an A5 account, mapping source, authorization, or posting proof.

## 32. Maker-checker expectations

The following require a requester and a different approver:

- approve a classification version;
- activate a mapping;
- reactivate a suspended mapping;
- retire an active mapping with historical activity;
- approve an exception for negative-balance policy;
- approve a legacy account classification;
- accept a material unmapped/ambiguous account exception.

Approval is bound to exact book/classification/mapping version, A5 UUID, observed metadata hash, effective interval, and action fingerprint. Self-approval is prohibited. A2 enforces authorization/assurance; future B9 administers access. B2F06 defines the full role/materiality matrix.

No approval permits B2 to alter A5.

## 33. Deterministic hashing and versioning

### 33.1 Classification hash

`classificationDefinitionHash` is SHA-256 over canonical ordered semantic fields:

- contract/book/classification identity/version;
- section/class/group/role;
- normal balance;
- operating/customer-funds/settlement/contra semantics;
- currency/unit and A5 compatibility requirements;
- effective interval;
- status-independent definition material.

### 33.2 Mapping hash

`mappingDefinitionHash` is SHA-256 over:

- contract/book/classification identities/versions;
- A5 UUID;
- observed A5 metadata snapshot hash;
- mapping purpose;
- effective interval;
- required compatibility assertions.

Identical inputs produce identical hashes and compatibility outcomes. Runtime current time must be an explicit evaluation input. A new definition creates a new version; it does not overwrite a hash.

## 34. Compatibility rules and failure codes

### 34.1 Compatibility

A mapping is `COMPATIBLE` only when:

- contract/book/classification versions are supported/effective;
- book is active and legal-entity scope matches;
- A5 account exists and UUID is canonical;
- A5 account is active;
- type and normal balance match classification;
- currency is `NGN` and accounting unit `CUSTOMER_FUNDS`;
- negative-balance setting meets role policy or has approved exception;
- source ownership evidence exists where required;
- no overlapping active primary mapping exists;
- effective interval is valid;
- role is not unsupported contra;
- approval is present for activation.

Other outcomes are `INCOMPATIBLE`, `REQUIRES_APPROVAL`, `UNMAPPED`, `AMBIGUOUS`, `NOT_EFFECTIVE`, `SUSPENDED`, or `REJECTED`.

### 34.2 Failure codes

- `B2F_CHART_INVALID_COMMAND`
- `B2F_CHART_INCOMPATIBLE_CONTRACT`
- `B2F_CHART_BOOK_MISMATCH`
- `B2F_CHART_CLASSIFICATION_NOT_FOUND`
- `B2F_CHART_CLASSIFICATION_VERSION_MISMATCH`
- `B2F_CHART_CLASSIFICATION_NOT_EFFECTIVE`
- `B2F_CHART_A5_ACCOUNT_NOT_FOUND`
- `B2F_CHART_A5_ACCOUNT_INACTIVE`
- `B2F_CHART_A5_TYPE_MISMATCH`
- `B2F_CHART_A5_NORMAL_BALANCE_MISMATCH`
- `B2F_CHART_CURRENCY_MISMATCH`
- `B2F_CHART_ACCOUNTING_UNIT_MISMATCH`
- `B2F_CHART_NEGATIVE_BALANCE_POLICY_MISMATCH`
- `B2F_CHART_DUPLICATE_PRIMARY_MAPPING`
- `B2F_CHART_AMBIGUOUS_MAPPING`
- `B2F_CHART_EFFECTIVE_INTERVAL_OVERLAP`
- `B2F_CHART_SOURCE_EVIDENCE_MISSING`
- `B2F_CHART_SOURCE_TREATMENT_MISSING`
- `B2F_CHART_CUSTOMER_OWNERSHIP_MISSING`
- `B2F_CHART_SETTLEMENT_EVIDENCE_MISSING`
- `B2F_CHART_CONTRA_UNSUPPORTED`
- `B2F_CHART_MAPPING_DRIFTED`
- `B2F_CHART_APPROVAL_REQUIRED`
- `B2F_CHART_SELF_APPROVAL_FORBIDDEN`
- `B2F_CHART_REPLAY_CONFLICT`
- `B2F_CHART_IN_PROGRESS`
- `B2F_CHART_QUERY_UNAVAILABLE`
- `B2F_CHART_PROHIBITED`

No failure falls back to code/name matching or creates an account.

## 35. Retention and data classification

- Classification definitions: `CONFIDENTIAL`, retention `FINANCE_POLICY_HISTORY`.
- Mapping definitions/history: `CONFIDENTIAL`, retention `FINANCE_ACCOUNT_MAPPING_HISTORY`.
- Approval/audit evidence: `CONFIDENTIAL` or `RESTRICTED` where security details require, retention `FINANCE_AUDIT_EVIDENCE`.
- Reconciliation discrepancies: `CONFIDENTIAL`, elevated according to source content.
- Customer/account references: minimum necessary; no broad customer profile or source payload copy.

Exact retention durations are `NOT VERIFIED / REQUIRES REVIEW` by Finance, Tax, Legal, Compliance, Privacy, and Audit. Legal hold overrides disposal. Ordinary retirement never deletes mapping history required to interpret historical A5 journals.

## 36. Failure, disable, and rollback expectations

- Missing A5 account/mapping/source/approval/query fails closed for future B2 Finance admission.
- Mapping transaction failure leaves the prior active mapping authoritative.
- Suspending/retiring a mapping stops new Finance use but does not disable the A5 account or change prior journals.
- A5 metadata drift suspends Finance use pending review; B2 never repairs A5 automatically.
- Rollback of a mapping version means a new approved version/transition, not destructive edit.
- Posted financial correction remains A5 reversal/compensating-entry authority.
- No classification change restates historical financial statements automatically; restatement policy belongs to B2F10/B2F12 and requires approval.

## 37. Explicit non-goals

B2F03 does not implement or authorize:

- any entity, table, migration, repository, service, controller, route, API, scheduler, worker, configuration, or frontend;
- creation, update, deactivation, deletion, renumbering, or copying of A5 accounts;
- a second chart of accounts, ledger, journal, line, posting engine, balance, or value authority;
- automatic seeding or activation of Finance mapping records;
- direct posting by classification key;
- A5 hierarchy changes;
- contra-account runtime;
- B1 fee/commission/revenue-share/billing/recognition/tax/cost/profitability/reconciliation calculation;
- A6 settlement/suspense mutation;
- A7 product mutation;
- AR/AP, tax calculation, allocation execution, close, financial statement generation, or regulatory reporting;
- multi-book, multi-entity, consolidation, intercompany, FX, multi-currency, Treasury, lending, cards, investments, insurance, or international remittance;
- Merchant Platform, Reporting Platform, Statement Platform, Configuration Platform, IAM administration, Developer Integration, Observability Platform, public API, or frontend behavior;
- historical B2T11/B2T12.

## 38. Future implementation handoff

- B2F04 uses mapping identity in period governance but does not own mapping.
- B2F05 resolves approved mappings to A5 UUIDs before Finance-directed posting.
- B2F06 supplies mapping approval/materiality/segregation rules.
- B2F07/B2F08 add receivable/payable classifications only after approved source models.
- B2F09 determines B1/A6/A7 accounting treatment before selecting roles.
- B2F10 independently reconciles mappings and unmapped/ambiguous/drifted accounts.
- B2F12 aggregates A5 facts by effective Finance classification for official accounting datasets.
- B6/B7 consume outputs later; classifications do not make B2 a reporting/statement platform.

B2F04 must not begin automatically.

## 39. Verification record

- [x] Actual A5 account model, identifiers, types, normal balances, flags, creation authority, balance derivation, and reconciliation queries reviewed.
- [x] No A5 account hierarchy or Finance classification fields were inferred.
- [x] Finance hierarchy/class/group/role semantics are distinct from A5 account identity.
- [x] A5 classes/types/normal-balance compatibility is explicit.
- [x] Financial-statement and operating/non-operating grouping is defined without generating statements.
- [x] Customer funds remain non-negative current liabilities.
- [x] Settlement asset, clearing, and suspense candidate classifications are documented.
- [x] Revenue, expense/cost, asset, liability, and equity classification vocabularies are bounded.
- [x] Contra semantics are documented and prohibited from active v1 mapping because A5 support is not verified.
- [x] Mapping identity/version/effective dates/status/cardinality/ambiguity/unmapped handling are defined.
- [x] Legacy `PAYMENT-*` accounts are preserved and classified only as candidates.
- [x] B1 and A6 handoffs preserve source ownership.
- [x] Reconciliation, idempotency, audit, maker-checker, deterministic hash, compatibility, failure, retention, and rollback expectations are defined.
- [x] No A5 or B1 authority is duplicated.
- [x] Durable mapping runtime, migration, lifecycle, A5 verification, controls, idempotency, audit/outbox/metrics, and read-only consumer port are implemented.
- [x] B2F05 now resolves authoritative mapping records instead of trusting mapping-reference shape alone.
- [x] No A5 account, balance, journal, line, or posting authority is created or modified.
- [x] No mapping is automatically activated; AR and legacy candidate mappings remain review-gated.

### B2F03 result

> **Finance classification and durable A5 mapping runtime implemented — no mappings auto-activated; AR, legacy, contra, equity, revenue, expense, clearing, and suspense activation reviews remain required.**
