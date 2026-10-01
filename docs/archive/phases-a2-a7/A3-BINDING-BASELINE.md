# A3T01 — Binding Baseline and Customer-to-Account Identity Map

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T01 — Binding Baseline and Customer-to-Account Identity Map
- **Type:** Documentation and implementation baseline
- **Status:** Baseline prepared; accountable-owner approval is pending
- **Review snapshot:** `6bfe923662c2ab09224d8efc76bd263fad56a0de` (the repository commit before this A3T01 document)
- **Application changes in this task:** None
- **Database/data changes in this task:** None

## 1. Purpose and boundary

This document records the current source, schema, identifier, lifecycle, currency, accounting-unit, and reconciliation baseline required before implementing customer-to-financial-account binding. It is an inventory and gap register, not a binding design or an approval of a future schema.

A3T01 distinguishes three concepts that are currently separate:

1. **Customer identity:** `Customer.id` in the `customer` domain.
2. **Customer-wallet metadata:** `CustomerWallet` and its ownership/provisioning records in `customer-wallet`.
3. **Financial identity and value:** `WalletAccount` in `wallet`, backed by `LedgerAccount`, journals, and lines in `ledger`.

The current repository has no explicit `CustomerWallet`-to-`WalletAccount` or `CustomerWallet`-to-`LedgerAccount` binding record. A missing cross-domain binding is therefore an expected pre-A3 state, not evidence that a financial account can be inferred from a customer reference, alias, currency, or display value.

This baseline does not select the A3 binding owner, cardinality, lifecycle contract, schema, migration, provisioning command, read model, reconciliation implementation, or repair workflow. Those decisions and implementations remain in A3T02-A3T09 as defined by [`A3-IMPLEMENTATION-PLAN.md`](A3-IMPLEMENTATION-PLAN.md).

## 2. Evidence reviewed

The inventory was derived from committed repository artifacts rather than inferred runtime data.

### Architecture and ownership inputs

- [`ROADMAP.md`](ROADMAP.md) and [`ARCHITECTURE-PHASE-PLAN.md`](ARCHITECTURE-PHASE-PLAN.md) for the A3 objective and dependencies.
- [`PHASES.md`](PHASES.md) and [`IMPLEMENTATION-ORDER.md`](IMPLEMENTATION-ORDER.md) for the A3 exit boundary.
- [`CANONICAL-OWNERSHIP-MATRIX.md`](CANONICAL-OWNERSHIP-MATRIX.md) for current source ownership.
- [`MODULE-SCHEMA-API-INVENTORY.md`](MODULE-SCHEMA-API-INVENTORY.md), [`ARCHITECTURE-INVENTORY.md`](ARCHITECTURE-INVENTORY.md), and [`PLATFORM-CUSTOMER-INVENTORY.md`](PLATFORM-CUSTOMER-INVENTORY.md) for module, table, route, and migration inventory.
- [`IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md`](IDENTIFIER-PRIVACY-RETENTION-CONTROLS.md) for canonical identifiers, references, retention, and disclosure boundaries.
- [`CUSTOMER-ADJACENT-OVERLAP-REVIEW.md`](CUSTOMER-ADJACENT-OVERLAP-REVIEW.md) and [`P1.4-CUSTOMER-WALLET-PROVISIONING.md`](P1.4-CUSTOMER-WALLET-PROVISIONING.md) for the intentional separation of customer-wallet metadata from financial wallets.

### Governing ADR inputs

- [`ADR-0002-Money-Representation.md`](ADR/ADR-0002-Money-Representation.md): integer minor units and explicit currency.
- [`ADR-0004-Wallet-and-Ledger.md`](ADR/ADR-0004-Wallet-and-Ledger.md): ledger-backed liability wallets and immutable financial value.
- [`ADR-0005-Independent-Reconciliation.md`](ADR/ADR-0005-Independent-Reconciliation.md): independent, read-only finance verification.
- [`ADR-0012-Customer-Foundation.md`](ADR/ADR-0012-Customer-Foundation.md): canonical customer UUID and financial separation.
- [`ADR-0015-Customer-Wallet-Provisioning.md`](ADR/ADR-0015-Customer-Wallet-Provisioning.md): metadata-only customer-wallet provisioning.
- [`ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md`](ADR/ADR-0021-Customer-Domain-Canonical-Model-and-Ownership-Rules.md): one authoritative owner and prohibited shared writes.
- [`ADR-0023-Customer-Identifier-and-Reference-Conventions.md`](ADR/ADR-0023-Customer-Identifier-and-Reference-Conventions.md): canonical IDs, references, scoped idempotency, and correlation.
- [`ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md`](ADR/ADR-0024-Customer-Data-Classification-Retention-and-Privacy.md): protection and retention input for customer/financial mappings.

### Source, entity, and migration inputs

- Customer identity: [`src/customer/customer.entity.ts`](../src/customer/customer.entity.ts).
- Customer-wallet metadata and ownership: [`src/customer-wallet/customer-wallet.entity.ts`](../src/customer-wallet/customer-wallet.entity.ts), [`src/customer-wallet/wallet-ownership.entity.ts`](../src/customer-wallet/wallet-ownership.entity.ts), [`src/customer-wallet/wallet-alias.entity.ts`](../src/customer-wallet/wallet-alias.entity.ts), [`src/customer-wallet/wallet-provisioning-history.entity.ts`](../src/customer-wallet/wallet-provisioning-history.entity.ts), and [`src/customer-wallet/customer-wallet.service.ts`](../src/customer-wallet/customer-wallet.service.ts).
- Financial wallet: [`src/wallet/wallet-account.entity.ts`](../src/wallet/wallet-account.entity.ts), [`src/wallet/wallet.service.ts`](../src/wallet/wallet.service.ts), and [`src/wallet/wallet.controller.ts`](../src/wallet/wallet.controller.ts).
- Ledger accounts and posted value: [`src/ledger/ledger-account.entity.ts`](../src/ledger/ledger-account.entity.ts), [`src/ledger/ledger-journal.entity.ts`](../src/ledger/ledger-journal.entity.ts), [`src/ledger/ledger-line.entity.ts`](../src/ledger/ledger-line.entity.ts), and [`src/ledger/ledger.service.ts`](../src/ledger/ledger.service.ts).
- Reconciliation: [`src/reconciliation/reconciliation.service.ts`](../src/reconciliation/reconciliation.service.ts), [`src/reconciliation/reconciliation.types.ts`](../src/reconciliation/reconciliation.types.ts), and [`src/reconciliation/reconciliation.controller.ts`](../src/reconciliation/reconciliation.controller.ts).
- Relevant schema history: [`src/migrations/1785753600000-CreateWalletAndLedger.ts`](../src/migrations/1785753600000-CreateWalletAndLedger.ts), [`src/migrations/1785753600001-CreateTransfers.ts`](../src/migrations/1785753600001-CreateTransfers.ts), [`src/migrations/1785753600002-CreatePaymentCapabilities.ts`](../src/migrations/1785753600002-CreatePaymentCapabilities.ts), [`src/migrations/1785753600003-CreateExpandedFinancialProducts.ts`](../src/migrations/1785753600003-CreateExpandedFinancialProducts.ts), [`src/migrations/1785753600008-CreateCustomerFoundation.ts`](../src/migrations/1785753600008-CreateCustomerFoundation.ts), and [`src/migrations/1785753600011-CreateCustomerWalletProvisioning.ts`](../src/migrations/1785753600011-CreateCustomerWalletProvisioning.ts).

The branch also contains A2 migrations `1785753600018` through `1785753600020`. The committed migration files, rather than the older expected-head sentence in the module inventory, are the source for the current migration-head observation: the branch currently ends at `1785753600020-CreatePrivilegedActionApprovals.ts`.

## 3. Current ownership and authority baseline

| Concept                                         | Current authoritative owner     | Current record or field                                     | Current authority boundary                                                                                                                                     |
| ----------------------------------------------- | ------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer identity                               | `customer`                      | `customers.id` / `Customer.id`                              | Canonical customer UUID. Customer-owned modules use it as their parent identity.                                                                               |
| Customer display/API reference                  | `customer`                      | `customers.reference` / `Customer.reference`                | Normalized, unique lookup/display value. It is not a customer UUID, financial account ID, credential, or authorization proof.                                  |
| Customer-wallet provisioning metadata           | `customer-wallet`               | `customer_wallets` / `CustomerWallet`                       | Owns wallet type, currency, provisioning status, timestamps, soft deletion, and optimistic version. It is not a financial account and does not hold a balance. |
| Customer-wallet ownership evidence              | `customer-wallet`               | `wallet_ownerships` / `WalletOwnership`                     | Immutable metadata record containing wallet and customer UUIDs. It has no financial authority and no transfer workflow.                                        |
| Wallet aliases and provisioning history         | `customer-wallet`               | `wallet_aliases`, `wallet_provisioning_histories`           | Metadata and history only. An alias or history ID cannot identify or authorize a financial account.                                                            |
| Financial wallet facade                         | `wallet`                        | `wallet_accounts` / `WalletAccount`                         | Owns the wallet record and its unique ledger-account reference. Balance reads are delegated to the ledger.                                                     |
| Financial account and value                     | `ledger`                        | `ledger_accounts`, `ledger_journals`, `ledger_lines`        | Ledger owns account state, posted journals/lines, and ledger-derived balances. Posted journals and lines are immutable.                                        |
| Financial lifecycle records                     | Their owning financial module   | `transfers`, `deposits`, `withdrawals`, and related records | These records reference financial wallet UUIDs and/or journals. They do not establish customer identity.                                                       |
| Audit, idempotency, and reconciliation evidence | `operations` / `reconciliation` | Shared operational records and read-only reports            | These are control/evidence authorities, not customer or financial-account authorities.                                                                         |

The current ownership answer for every relationship in scope is therefore explicit: customer identity belongs to `customer`; customer-wallet metadata belongs to `customer-wallet`; financial wallet identity belongs to `wallet`; financial account/value belongs to `ledger`; and no current module owns the missing cross-domain binding.

## 4. Customer-to-account identity map

The following map separates canonical IDs, metadata IDs, financial IDs, references, and operation identifiers. Values in the `Compatibility value` column are not interchangeable.

| Record/value                                            | Storage and type                                                       | Owner                                                                         | Current relationship or constraint                                                                                                       | A3 identity treatment                                                                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Customer.id`                                           | `customers.id`, UUID primary key                                       | `customer`                                                                    | Referenced by Customer Foundation foreign keys, including `customer_wallets.customer_id`                                                 | Canonical customer identity. The binding must retain this UUID as the customer side of the relationship.                                                                                              |
| `Customer.reference`                                    | `customers.reference`, `varchar(160)`                                  | `customer`                                                                    | Unique customer namespace; normalized by the customer domain                                                                             | Lookup/display reference only. It must not be rewritten into a financial record or treated as the account identity.                                                                                   |
| `CustomerWallet.id`                                     | `customer_wallets.id`, UUID primary key                                | `customer-wallet`                                                             | Metadata record; `customer_id` has a foreign key to `customers.id`                                                                       | Customer-wallet metadata identity. It is not `WalletAccount.id` or `LedgerAccount.id`.                                                                                                                |
| `CustomerWallet.customerId`                             | `customer_wallets.customer_id`, UUID foreign key                       | `customer-wallet` with `customer` as identity authority                       | Direct foreign key to `customers.id`; service validates UUID                                                                             | Canonical customer link for metadata. It is a safe customer identity link, not a financial-account link.                                                                                              |
| `WalletOwnership.id`                                    | `wallet_ownerships.id`, UUID primary key                               | `customer-wallet`                                                             | One active ownership row per wallet through a partial unique index                                                                       | Ownership evidence ID only. It cannot substitute for a future binding record.                                                                                                                         |
| `WalletOwnership.walletId`                              | `wallet_ownerships.wallet_id`, UUID foreign key                        | `customer-wallet`                                                             | Foreign key to `customer_wallets.id`; active wallet uniqueness is enforced                                                               | Customer-wallet metadata reference. The current schema does not enforce that its `customer_id` equals the wallet row's `customer_id`; the baseline query must detect that mismatch.                   |
| `WalletOwnership.customerId`                            | `wallet_ownerships.customer_id`, UUID foreign key                      | `customer-wallet` with `customer` as identity authority                       | Separate foreign key to `customers.id`; no composite relationship to `CustomerWallet`                                                    | Customer UUID evidence. It must be compared with `CustomerWallet.customerId`, not assumed to be consistent solely because both are valid UUIDs.                                                       |
| `WalletAlias.alias`                                     | `wallet_aliases.alias`, normalized `varchar(160)`                      | `customer-wallet`                                                             | Globally unique among non-deleted aliases                                                                                                | Display/lookup identifier. Never use it as a customer, wallet-account, ledger-account, or binding key.                                                                                                |
| `WalletProvisioningHistory.walletId`                    | `wallet_provisioning_histories.wallet_id`, UUID foreign key            | `customer-wallet`                                                             | Append-only history of metadata actions                                                                                                  | History relationship only. It is evidence of metadata changes, not evidence of a financial account being provisioned.                                                                                 |
| `WalletAccount.id`                                      | `wallet_accounts.id`, UUID primary key                                 | `wallet`                                                                      | Financial wallet UUID; financial lifecycle records reference it                                                                          | Canonical financial-wallet identity. A future binding must reference it explicitly if that is the approved subject.                                                                                   |
| `WalletAccount.customerId`                              | `wallet_accounts.customer_id`, non-null `varchar(160)`                 | `wallet` compatibility field; target customer identity is owned by `customer` | No foreign key to `customers`; only non-empty and length constraints; unique with wallet currency inside the `wallet_accounts` namespace | Legacy/opaque compatibility value. It may be a canonical UUID-shaped value, customer reference, or another opaque value. Its string form is not proof of identity and must not be silently rewritten. |
| `WalletAccount.ledgerAccountId`                         | `wallet_accounts.ledger_account_id`, UUID foreign key and unique index | `wallet` referencing `ledger`                                                 | Each wallet row references at most one ledger account and each ledger account is referenced by at most one wallet row                    | Canonical wallet-to-ledger relationship currently present in the financial domain. It is not a customer binding.                                                                                      |
| `LedgerAccount.id`                                      | `ledger_accounts.id`, UUID primary key                                 | `ledger`                                                                      | Referenced by `wallet_accounts.ledger_account_id` and `ledger_lines.ledger_account_id`                                                   | Canonical financial-account identity. It must never be inferred from a customer reference or wallet alias.                                                                                            |
| `LedgerAccount.code`                                    | `ledger_accounts.code`, unique `varchar(100)`                          | `ledger`                                                                      | Ledger account namespace; wallet creation generates a `WALLET-<uuid>` code                                                               | Ledger/account code, not customer identity. It is restricted financial control data and is not a replacement for the UUID.                                                                            |
| `LedgerJournal.id` / `LedgerLine.id`                    | UUID primary keys                                                      | `ledger`                                                                      | Lines point to journal and ledger-account UUIDs; no customer-wallet columns                                                              | Immutable financial posting identity. A binding operation must not edit or copy journal/line value.                                                                                                   |
| `creation_idempotency_key` and journal idempotency keys | Opaque command values                                                  | `wallet` / `ledger` command paths, with Operations primitives available       | Used to replay a creation or journal outcome; they are not permanent resource IDs                                                        | Operation correlation only. A3 must not use an idempotency key as a customer, wallet, or ledger identity.                                                                                             |

### Identity map summary

```text
Customer.id (canonical customer UUID)
    |
    +--> customer_wallets.customer_id (explicit metadata FK)
    |       |
    |       +--> wallet_ownerships.wallet_id / customer_id (metadata evidence)
    |       +--> wallet_aliases.wallet_id (metadata lookup only)
    |       +--> wallet_provisioning_histories.wallet_id (metadata history only)
    |
    +--> [no current CustomerWallet -> WalletAccount relationship]

wallet_accounts.id (financial wallet UUID)
    |
    +--> wallet_accounts.ledger_account_id (unique FK)
            |
            +--> ledger_accounts.id (financial account UUID)
                    |
                    +--> ledger_lines.ledger_account_id

wallet_accounts.customer_id (opaque compatibility value)
    |
    +--> [no FK or namespace discriminator; candidate matching requires review]
```

The only current customer-to-wallet relationship in this map is the UUID foreign key from `customer_wallets` to `customers`. The only current wallet-to-ledger relationship is the unique foreign key from `wallet_accounts` to `ledger_accounts`. The cross-domain edge between those two subgraphs does not exist yet.

## 5. Current schema and execution inventory

### 5.1 Customer-wallet metadata path

`CustomerWalletService.createWallet`:

- validates the route customer ID as a UUID;
- requires the customer to exist and pass the existing onboarding/eligibility gates;
- normalizes the explicit three-letter currency;
- creates `CustomerWallet` and one `WalletOwnership` row in the same transaction;
- records audit and provisioning-history facts; and
- does not import or call `WalletModule`, `WalletService`, `LedgerModule`, `LedgerService`, or `ReconciliationModule`.

The metadata API is rooted at `/customers/:id/wallets`. Its views contain the customer-wallet UUID, customer UUID, type, currency, metadata lifecycle status, and version/timestamps. They do not contain a financial wallet UUID, ledger-account UUID, or balance.

The P1.4 status state machine is:

```text
PENDING -> ACTIVE -> SUSPENDED -> ACTIVE
    |         |          |
    v         v          v
  CLOSED    CLOSED     CLOSED
```

`CLOSED` is terminal for the customer-wallet metadata record. This is a metadata lifecycle rule; it is not currently linked to a `WalletAccount` or `LedgerAccount` lifecycle.

### 5.2 Financial wallet path

`WalletService.createWallet` is rooted at `POST /wallets`. It:

- trims but does not UUID-validate or customer-lookup `customerId`;
- normalizes the currency;
- accepts an opaque creation idempotency key;
- rejects an existing `(customerId, currency)` wallet in the current opaque namespace;
- creates a compatible ledger liability account and a `WalletAccount` in one transaction; and
- returns a wallet view whose balance is read from ledger lines through `LedgerService`.

The financial wallet path therefore has a working wallet-to-ledger provisioning relationship, but it does not prove that its `customerId` is a `Customer.id`, a `Customer.reference`, or even a current customer record. The existing local uniqueness rule prevents duplicate opaque `(customerId, currency)` pairs; it does not prevent duplicate customer-to-financial mappings across different opaque values.

Financial consumers use financial wallet UUIDs, not customer-wallet metadata IDs:

- transfers use `source_wallet_id` and `destination_wallet_id` foreign keys to `wallet_accounts.id`;
- deposits and withdrawals use `wallet_id` foreign keys to `wallet_accounts.id`;
- ledger lines use `ledger_account_id` foreign keys to `ledger_accounts.id`; and
- payment references identify payment lifecycle records, not customers or ledger accounts.

### 5.2.1 Adjacent legacy customer-reference namespaces

The legacy `beneficiary` module has a separate `beneficiaries.customer_id` `varchar(160)` field with no foreign key to `customers`. It is an opaque customer-reference namespace in [`src/beneficiary/beneficiary.entity.ts`](../src/beneficiary/beneficiary.entity.ts) and migration `1785753600003-CreateExpandedFinancialProducts.ts`. It is not a wallet/account binding and is outside A3's account-mapping subject. Its values must not be used to resolve `WalletAccount.customerId`, and A3 must not rewrite that legacy table.

The Customer Foundation `customer-beneficiary` module is different: `customer_beneficiaries.customer_id` is a UUID foreign key to `customers.id`. It remains customer-recipient metadata and is not a financial-account relationship. The two beneficiary namespaces must remain distinct during any future customer-reference census.

### 5.3 Ledger path

`LedgerService` owns ledger-account creation, balance calculation, journal posting, journal retrieval, and reversal. `LedgerAccount` has no customer ID or wallet ID. The ledger relationship to a financial wallet is established only by `wallet_accounts.ledger_account_id`.

The migration also protects the financial boundary with database controls:

- wallet rows must reference a non-negative `LIABILITY`/`CREDIT` ledger account;
- wallet and ledger-account currencies must match;
- the wallet's ledger account must use accounting unit `CUSTOMER_FUNDS`;
- posted journal/line relationships and currency/accounting-unit consistency are checked; and
- posted journals and lines reject update and delete mutations.

These controls do not create a customer binding and must not be bypassed by future A3 work.

## 6. Currency, accounting-unit, and financial-state baseline

### 6.1 Dimension inventory

| Layer                          | Currency                                         | Accounting unit                                     | Current enforcement                                          | Binding implication for later review                                                                                                        |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CustomerWallet`               | `currency` is a three-letter uppercase code      | No field                                            | Entity/migration check plus service normalization            | A customer-wallet record cannot currently express an accounting unit; A3T02/A3T03 must not invent one from a display value.                 |
| `WalletAccount`                | `currency` is a three-letter uppercase code      | No field                                            | Entity/migration check plus service normalization            | The financial wallet's unit is obtained from its referenced ledger account, not from `WalletAccount`.                                       |
| `LedgerAccount`                | `currency` is a three-letter uppercase code      | `accounting_unit`, default `CUSTOMER_FUNDS`         | Entity/migration checks and wallet-account trigger           | The ledger account is the current financial dimension authority. A candidate customer binding must preserve its explicit currency and unit. |
| `LedgerJournal` / `LedgerLine` | Explicit currency on each record                 | Explicit accounting unit on each record             | Migration constraints/triggers and ledger service validation | Binding must not copy, recalculate, or mutate posted financial dimensions.                                                                  |
| Wallet balance                 | Derived from ledger lines as integer minor units | Inherited from the ledger account/journal dimension | `LedgerService` aggregation and reconciliation               | Customer-wallet metadata has no balance column and cannot become a balance source.                                                          |

### 6.2 Existing compatibility rule

The current `wallet_accounts` trigger requires the referenced ledger account to be:

- present;
- `LIABILITY` with `CREDIT` normal balance;
- the same currency as the wallet;
- in accounting unit `CUSTOMER_FUNDS`; and
- non-negative (`allow_negative_balance = FALSE`).

The current reconciliation report independently checks wallet/ledger-account compatibility, currency consistency, and accounting-unit consistency. No equivalent current check compares `CustomerWallet.currency` with a financial wallet because there is no approved cross-domain relationship to inspect.

### 6.3 Lifecycle comparison baseline

The current lifecycle vocabularies are independent:

| Record           | Current states                             | Current control                                                        |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| `CustomerWallet` | `PENDING`, `ACTIVE`, `SUSPENDED`, `CLOSED` | Explicit service state machine; `CLOSED` terminal; metadata-only.      |
| `WalletAccount`  | `ACTIVE`, `SUSPENDED`, `CLOSED`            | Financial wallet status constraint; no customer-wallet lifecycle link. |
| `LedgerAccount`  | `is_active` boolean                        | Ledger account state; no customer or customer-wallet lifecycle link.   |

The following are baseline classifications, not future lifecycle decisions:

- A customer-wallet metadata row without a financial wallet is expected before A3 binding and is not, by itself, a financial orphan.
- A financial wallet whose opaque customer value cannot be classified against a current customer is an unresolved compatibility reference.
- A metadata row marked `ACTIVE` and a financial wallet marked `CLOSED` (or an active ledger account paired with a closed financial wallet) are lifecycle discrepancy candidates once a customer-to-account candidate has been reviewed.
- A `CLOSED` customer-wallet metadata row cannot be assumed to close, reopen, or mutate a financial account under the current P1.4 contract.
- No current record can establish whether a customer is allowed one financial account per currency, one account per metadata wallet, or multiple accounts by wallet type. That cardinality decision is intentionally deferred to A3T02.

## 7. Existing reconciliation and control paths

`ReconciliationService` uses direct SQL inside a `REPEATABLE READ` transaction marked `READ ONLY`. It does not call wallet, ledger, transfer, or customer-wallet write services. The current report includes these relevant checks:

- `wallet_balances_ledger_derived`: wallet balances are calculated from ledger lines and are not stored in wallet metadata;
- `wallet_liability_account_ownership`: each financial wallet has a compatible liability account;
- `journal_balance_integrity`: journal line count and debit/credit/total equality;
- `orphan_ledger_entries`: ledger lines reference existing journals;
- `journal_line_account_integrity`: ledger lines reference existing ledger accounts;
- `completed_payment_journal_integrity`: completed financial lifecycles reference journals;
- `currency_consistency`: wallet, journal, line, account, transfer, deposit, and withdrawal dimensions agree; and
- `accounting_unit_consistency`: journal, line, and wallet/ledger-account accounting-unit assertions agree.

The finance verification surface also provides trial balance, balance-conservation, journal-integrity, account-activity, and account-type totals. The internal routes are read-only control surfaces:

- `GET /internal/reconciliation/report`
- `GET /internal/reconciliation/trial-balance`
- `GET /internal/reconciliation/finance`
- `GET /internal/reconciliation/accounts/:accountId/activity`

### Reconciliation coverage gap

The existing report does **not** currently query:

- `customers` against `customer_wallets` for customer-wallet ownership;
- `customer_wallets` against `wallet_ownerships` for ownership-row consistency;
- `customer_wallets` against `wallet_accounts` for an approved binding;
- opaque `wallet_accounts.customer_id` classification; or
- customer-wallet lifecycle state against financial-wallet or ledger-account lifecycle state.

This is a control-coverage gap for later A3 work, not a reason to make the current report mutate source records. Any future binding reconciliation must remain an independent, read-only control and must not call a binding repair command from a report query.

## 8. Read-only duplicate, orphan, and compatibility query design

The following query designs use only current tables. They are review and census queries, not migrations, services, or binding execution. They were not run as part of this documentation-only task; no runtime row counts or customer values are asserted in this document. Query output containing raw customer references or financial IDs must stay in a restricted finance/customer-operations evidence store and must not be copied into general logs or this document.

### 8.1 Customer-wallet and ownership exceptions

This query detects missing/soft-deleted customer parents, missing active ownership, and a mismatch between the two separately stored customer UUIDs. A valid UUID in each column does not prove that the ownership rows refer to the same customer.

```sql
SELECT cw.id AS customer_wallet_id,
       cw.customer_id,
       cw.status AS customer_wallet_status,
       c.deleted_at IS NOT NULL AS customer_soft_deleted,
       wo.id IS NULL AS missing_active_ownership,
       wo.customer_id IS DISTINCT FROM cw.customer_id AS ownership_customer_mismatch,
       EXISTS (
         SELECT 1
           FROM wallet_ownerships deleted_wo
          WHERE deleted_wo.wallet_id = cw.id
            AND deleted_wo.deleted_at IS NOT NULL
       ) AS has_deleted_ownership_history
  FROM customer_wallets cw
  LEFT JOIN customers c ON c.id = cw.customer_id
  LEFT JOIN wallet_ownerships wo
    ON wo.wallet_id = cw.id
   AND wo.deleted_at IS NULL
 WHERE cw.deleted_at IS NULL
   AND (
        c.id IS NULL
        OR c.deleted_at IS NOT NULL
        OR wo.id IS NULL
        OR wo.customer_id IS DISTINCT FROM cw.customer_id
   );
```

Expected interpretation:

- a missing customer is a referential exception even though the current foreign key should prevent a hard-delete orphan;
- a soft-deleted customer or ownership row requires lifecycle review;
- a missing active ownership row is an incomplete metadata relationship; and
- an ownership customer mismatch is a data-integrity exception, not a candidate for automatic repair in A3T01.

### 8.2 Classify opaque financial-wallet customer values

This query identifies whether a `wallet_accounts.customer_id` value is an exact/case-normalized candidate for a canonical customer UUID, a customer reference, an unmatched UUID-shaped value, or another opaque value. It intentionally preserves the original value for restricted review and does not update it.

```sql
SELECT wa.id AS wallet_account_id,
       wa.customer_id AS compatibility_value,
       wa.currency,
       uuid_match.customer_id AS uuid_customer_id,
       reference_match.customer_id AS reference_customer_id,
       CASE
         WHEN uuid_match.customer_id IS NOT NULL
              AND reference_match.customer_id IS NOT NULL THEN 'AMBIGUOUS'
         WHEN uuid_match.customer_id IS NOT NULL THEN 'CANONICAL_UUID_CANDIDATE'
         WHEN reference_match.customer_id IS NOT NULL THEN 'CUSTOMER_REFERENCE_CANDIDATE'
         WHEN wa.customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN 'UUID_SHAPED_UNMATCHED'
         ELSE 'OPAQUE_UNMATCHED'
       END AS compatibility_class
  FROM wallet_accounts wa
  LEFT JOIN LATERAL (
    SELECT c.id::text AS customer_id
      FROM customers c
     WHERE lower(wa.customer_id) = c.id::text
     LIMIT 1
  ) uuid_match ON TRUE
  LEFT JOIN LATERAL (
    SELECT c.id::text AS customer_id
      FROM customers c
     WHERE lower(wa.customer_id) = c.reference
     LIMIT 1
  ) reference_match ON TRUE;
```

Required handling:

- `CANONICAL_UUID_CANDIDATE` and `CUSTOMER_REFERENCE_CANDIDATE` are evidence classifications only; neither permits a silent rewrite or automatic binding.
- `AMBIGUOUS`, `UUID_SHAPED_UNMATCHED`, and `OPAQUE_UNMATCHED` values require controlled exception handling.
- A case-normalized reference match must retain the original stored value and its source history.
- Raw compatibility values must not be used as authorization evidence or financial identity.

### 8.3 Financial-wallet to ledger-account compatibility

This query inventories the current wallet-to-ledger edge and exposes all dimensions required before any customer binding candidate is considered.

```sql
SELECT wa.id AS wallet_account_id,
       wa.customer_id AS compatibility_value,
       wa.currency AS wallet_currency,
       wa.status AS wallet_status,
       wa.ledger_account_id,
       la.account_type,
       la.normal_balance,
       la.currency AS ledger_currency,
       la.accounting_unit,
       la.allow_negative_balance,
       la.is_active,
       CASE
         WHEN la.id IS NULL THEN 'MISSING_LEDGER_ACCOUNT'
         WHEN la.account_type <> 'LIABILITY' THEN 'INCOMPATIBLE_ACCOUNT_TYPE'
         WHEN la.normal_balance <> 'CREDIT' THEN 'INCOMPATIBLE_NORMAL_BALANCE'
         WHEN la.currency <> wa.currency THEN 'CURRENCY_MISMATCH'
         WHEN la.accounting_unit <> 'CUSTOMER_FUNDS' THEN 'ACCOUNTING_UNIT_MISMATCH'
         WHEN la.allow_negative_balance THEN 'NEGATIVE_BALANCE_ALLOWED'
         WHEN NOT la.is_active THEN 'INACTIVE_LEDGER_ACCOUNT'
         ELSE 'COMPATIBLE_CURRENT_WALLET_EDGE'
       END AS wallet_ledger_class
  FROM wallet_accounts wa
  LEFT JOIN ledger_accounts la ON la.id = wa.ledger_account_id;
```

The database trigger and existing reconciliation already protect several of these assertions on normal write paths. The query is still needed for an independent baseline and for identifying data that may predate or bypass an expected path. It does not establish a customer relationship.

### 8.4 Candidate cardinality and duplicate review

The following query creates a **review-only** candidate set from exact/case-normalized UUID or customer-reference matches. The match is not authoritative. It reports multiple customer-wallet metadata candidates and multiple financial-wallet candidates for the same canonical customer/currency dimension without deciding whether the final A3 model permits that cardinality.

```sql
WITH customer_wallet_counts AS (
  SELECT cw.customer_id,
         cw.currency,
         COUNT(*) AS customer_wallet_count,
         COUNT(*) FILTER (WHERE cw.type = 'PRIMARY') AS primary_wallet_count
    FROM customer_wallets cw
   WHERE cw.deleted_at IS NULL
   GROUP BY cw.customer_id, cw.currency
),
financial_candidates AS (
  SELECT DISTINCT wa.id AS wallet_account_id,
                  wa.currency,
                  c.id AS customer_id
    FROM wallet_accounts wa
    JOIN customers c
      ON lower(wa.customer_id) = c.id::text
      OR lower(wa.customer_id) = c.reference
),
financial_wallet_counts AS (
  SELECT fc.customer_id,
         fc.currency,
         COUNT(DISTINCT fc.wallet_account_id) AS financial_wallet_count
    FROM financial_candidates fc
   GROUP BY fc.customer_id, fc.currency
)
SELECT COALESCE(cwc.customer_id, fwc.customer_id) AS candidate_customer_id,
       COALESCE(cwc.currency, fwc.currency) AS currency,
       COALESCE(cwc.customer_wallet_count, 0) AS customer_wallet_count,
       COALESCE(cwc.primary_wallet_count, 0) AS primary_wallet_count,
       COALESCE(fwc.financial_wallet_count, 0) AS financial_wallet_count,
       CASE
         WHEN COALESCE(cwc.customer_wallet_count, 0) > 1
              OR COALESCE(fwc.financial_wallet_count, 0) > 1
           THEN 'CARDINALITY_REVIEW_REQUIRED'
         ELSE 'NO_MULTIPLE_CANDIDATE_DETECTED'
       END AS candidate_class
  FROM customer_wallet_counts cwc
  FULL OUTER JOIN financial_wallet_counts fwc
    ON fwc.customer_id = cwc.customer_id
   AND fwc.currency = cwc.currency
 WHERE COALESCE(cwc.customer_wallet_count, 0) > 1
    OR COALESCE(fwc.financial_wallet_count, 0) > 1;
```

The query deliberately labels multiple metadata rows as a cardinality review rather than an automatic duplicate: `CustomerWallet` supports wallet types beyond `PRIMARY`, and A3T02 must decide the approved binding cardinality. The existing unique `(wallet_accounts.customer_id, currency)` constraint only operates on the opaque stored value and cannot establish canonical-customer uniqueness.

### 8.5 Current candidate dimension exceptions

After a candidate customer match has been manually reviewed, the following read-only comparison identifies customer-wallet/financial-wallet currency and lifecycle differences. It is intentionally limited to canonical-UUID-shaped candidate values; customer-reference candidates must first be classified by 8.2.

```sql
SELECT cw.id AS customer_wallet_id,
       cw.customer_id,
       cw.currency AS customer_wallet_currency,
       cw.status AS customer_wallet_status,
       wa.id AS wallet_account_id,
       wa.currency AS wallet_currency,
       wa.status AS wallet_status,
       la.id AS ledger_account_id,
       la.currency AS ledger_currency,
       la.accounting_unit,
       la.is_active AS ledger_account_active
  FROM customer_wallets cw
  JOIN wallet_accounts wa
    ON lower(wa.customer_id) = cw.customer_id::text
  LEFT JOIN ledger_accounts la ON la.id = wa.ledger_account_id
 WHERE cw.deleted_at IS NULL
   AND (
        cw.currency <> wa.currency
        OR la.id IS NULL
        OR la.currency <> wa.currency
        OR la.accounting_unit <> 'CUSTOMER_FUNDS'
        OR (cw.status = 'CLOSED' AND wa.status <> 'CLOSED')
        OR (wa.status = 'CLOSED' AND cw.status <> 'CLOSED')
        OR (wa.status = 'ACTIVE' AND la.is_active = FALSE)
   );
```

This is a discrepancy candidate report, not a lifecycle policy. It must not close, reopen, suspend, or reassign any record.

## 9. Gap and exception register

The register records current gaps and risks without implementing their remedies.

| ID        | Current evidence                                                                                                                                               | Gap or risk                                                                                                           | Classification                   | Required owner/input                                        | Status at A3T01                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `A3-G001` | No table, entity, service, or API links `CustomerWallet.id` to `WalletAccount.id` or `LedgerAccount.id`.                                                       | There is no authoritative customer-to-financial-account identity map.                                                 | Blocking A3 binding              | A3T02; Customer Engineering, Wallet, Ledger, Finance        | Open; no binding exists before this task.                                       |
| `A3-G002` | `wallet_accounts.customer_id` is `varchar(160)` with no customer foreign key or namespace discriminator; `WalletService` accepts any non-empty value.          | Existing financial-wallet customer values cannot safely be treated as canonical customer UUIDs.                       | Legacy/opaque compatibility risk | Customer Engineering and Wallet; A3T02                      | Open; preserve values and classify before any mapping.                          |
| `A3-G003` | Customer-wallet metadata has a UUID customer link; financial wallets have an opaque customer value; no cross-domain edge exists.                               | A customer reference, wallet alias, or UUID-shaped string could be mistaken for financial identity.                   | Identity-boundary risk           | Customer Engineering, Wallet, Ledger                        | Open; no inference permitted.                                                   |
| `A3-G004` | `CustomerWallet` has currency but no accounting unit; `WalletAccount` has currency but no accounting unit; `LedgerAccount` owns the explicit unit.             | Currency/accounting-unit compatibility cannot be established from customer metadata alone.                            | Financial-dimension risk         | Wallet, Ledger, Finance; A3T03                              | Open; ledger dimensions remain authoritative.                                   |
| `A3-G005` | Current uniqueness is primary-wallet-per-customer for metadata and opaque-customer-plus-currency for financial wallets.                                        | Duplicate canonical-customer candidates and approved binding cardinality are not constrained across domains.          | Cardinality/concurrency risk     | Customer Engineering, Wallet, Ledger, Reconciliation; A3T02 | Open; query design supplied, no deduplication performed.                        |
| `A3-G006` | `wallet_ownerships` separately foreign-keys `wallet_id` and `customer_id`; the database does not enforce their pair matches `customer_wallets.customer_id`.    | Ownership metadata can be internally inconsistent even when both UUIDs exist.                                         | Metadata integrity risk          | Customer Engineering, Reconciliation; A3T07                 | Open; read-only exception query supplied.                                       |
| `A3-G007` | Customer-wallet metadata creation creates no financial wallet; financial-wallet creation can create a wallet for an opaque value without checking `customers`. | Missing, orphaned, or one-sided records cannot be classified by current write paths.                                  | Lifecycle/orphan risk            | Customer Engineering, Wallet, Reconciliation                | Open; pre-A3 unbound metadata is expected and must be distinguished from drift. |
| `A3-G008` | Wallet and ledger reconciliation checks exist, but current reconciliation does not query customer-wallet tables or opaque customer-value classes.              | Binding drift, customer ownership mismatch, and customer-to-account gaps are outside current reconciliation coverage. | Control-coverage gap             | Reconciliation and Finance; A3T07                           | Open; no reconciliation implementation in A3T01.                                |
| `A3-G009` | `CustomerWallet` and `WalletAccount` have independent lifecycle states; `LedgerAccount` has `is_active`.                                                       | Active, suspended, or closed states may not agree across metadata, financial wallet, and ledger account.              | Lifecycle decision input         | Customer Engineering, Wallet, Ledger, Finance; A3T02        | Open; no lifecycle authority selected here.                                     |
| `A3-G010` | The current local wallet creation key and ledger journal keys identify command attempts/outcomes, not customer or account resources.                           | A future binding could accidentally use an idempotency key as an identity or omit a scoped replay contract.           | Operational identity risk        | Operations, Wallet, Ledger; A3T03/A3T05                     | Open; no binding command created.                                               |
| `A3-G011` | `MODULE-SCHEMA-API-INVENTORY.md` still describes an older expected migration head, while committed branch files include A2 migrations through `1785753600020`. | A3 migration planning must use the actual branch migration head and reconcile stale inventory prose.                  | Documentation/evidence risk      | Architecture and Operations; A3T04/A3T09                    | Open; no existing inventory document modified in A3T01.                         |

### Expected versus exceptional absence

The following distinctions are required during future data census and reconciliation:

- **Expected before A3:** a non-deleted `CustomerWallet` has no financial mapping because P1.4 intentionally stops at metadata provisioning.
- **Exception:** a customer-wallet record is missing its customer, has no active ownership, or has ownership for a different customer.
- **Exception:** a `WalletAccount.customerId` value cannot be classified or is ambiguous against the canonical customer namespace.
- **Exception:** a reviewed customer/account candidate has incompatible currency, ledger account, accounting unit, or lifecycle dimensions.
- **Not automatically an exception:** a ledger account is not referenced by a `WalletAccount`; system, settlement, and chart-of-accounts accounts may be intentionally unreferenced by customer wallets. Its role must be classified by Ledger/Finance before it is called orphaned.

## 10. A3T02 ownership-decision input

A3T01 supplies the following facts to the next task without pre-empting its decisions:

1. `Customer.id` is the only canonical customer identity in scope.
2. `CustomerWallet` is customer-wallet metadata owned by `customer-wallet`; its currency and lifecycle do not establish a financial account.
3. `WalletAccount.id` is the canonical financial-wallet UUID owned by `wallet`; `WalletAccount.ledgerAccountId` is its existing unique financial edge.
4. `LedgerAccount.id`, journals, lines, and ledger-derived balances remain ledger-owned financial truth.
5. `WalletAccount.customerId` is a compatibility value requiring classification; it must not be silently cast, rewritten, or used as proof of ownership.
6. Currency and accounting-unit comparisons must use explicit stored dimensions, with the ledger remaining authoritative for financial dimensions.
7. A future binding must be explicit and independently reconcilable; it must not copy balances or mutate posted financial records.
8. The final binding cardinality, authoritative binding writer, lifecycle state machine, idempotency scope, and repair owner remain A3T02-A3T08 decisions.

## 11. Validation and approval record

### A3T01 validation completed

- [x] Source/entity scan covers `Customer`, `CustomerWallet`, `WalletOwnership`, `WalletAccount`, `LedgerAccount`, journals, lines, related financial wallet consumers, and reconciliation.
- [x] Migration scan identifies the wallet/ledger, financial-consumer, customer-foundation, customer-wallet, and current A2 migration boundaries.
- [x] Canonical customer UUID, customer reference, customer-wallet UUID, financial-wallet UUID, ledger-account UUID/code, and operation identifiers are distinguished.
- [x] Current owners are declared for customer identity, customer-wallet metadata, financial wallet, ledger account/value, operations evidence, and reconciliation control.
- [x] Legacy/opaque `WalletAccount.customerId` values and the adjacent legacy `beneficiaries.customerId` varchar namespace are identified without rewriting either record.
- [x] Currency and accounting-unit controls, missing metadata dimensions, and existing wallet/ledger constraints are enumerated.
- [x] Duplicate, candidate-cardinality, ownership-mismatch, orphan/compatibility, lifecycle, and reconciliation-coverage query designs are documented.
- [x] The current reconciliation path is confirmed to be direct, read-only, and independent of binding write services.

### Evidence limitations

- The committed source and schema inventory was reviewed; no runtime database census was run by A3T01.
- Therefore this document contains no asserted row counts, customer values, wallet IDs, ledger IDs, duplicate counts, orphan counts, or approval signatures.
- The SQL in Section 8 is the controlled read-only design for the data census and owner review required before later A3 implementation tasks.

### A3T01 exit status

The baseline artifact is ready for review by Customer Engineering, Wallet, Ledger, Finance, and Reconciliation owners. Their approval, and the resulting ownership decision input for A3T02, are not claimed by this commit and remain pending.

## 12. Explicitly out of scope

A3T01 does not:

- create a binding entity, table, foreign key, index, or migration;
- migrate, normalize, rewrite, or delete any customer, wallet, account, or financial record;
- create or provision a financial account or wallet;
- create a binding service, command, controller, route, API, DTO, or read model;
- change customer-wallet, financial-wallet, ledger-account, journal, line, or balance state;
- repair duplicates, orphans, ownership mismatches, or lifecycle discrepancies;
- add customer-wallet checks to runtime reconciliation;
- implement authentication, authorization, A4 policy, A5 money movement, A6 providers, or settlement; or
- modify any application source, entity, migration, test, or existing architecture document.

The only file created for this task is this documentation baseline.
