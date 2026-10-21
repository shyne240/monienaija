# A3 Integration and Evidence Matrix

- **Phase:** A3 — Customer-to-Financial Account Binding
- **Task:** A3T09 — A3 Integration, Reconciliation, and Release Gate
- **Status:** Evidence package prepared; phase approval pending
- **Classification:** Documentation-only release evidence
- **Application, schema, migration, and runtime changes in this task:** None

## 1. Purpose and evidence boundary

This matrix traces A3T01-A3T08 across the canonical Customer identity, customer-wallet metadata, financial wallet, ledger, Operations, A2 access, read-model, reconciliation, and recovery boundaries. It records committed repository evidence, automated validation, remaining approval conditions, and prohibited edges.

A3T09 does not add a new implementation. It does not create an entity, migration, service, controller, API, reconciliation query, repair workflow, financial command, or monetary behavior.

A3 remains a truthful binding boundary only when:

- `Customer.id` is the customer identity;
- `CustomerWallet` remains metadata and provisioning evidence;
- `WalletAccount` remains the financial wallet facade;
- Ledger remains the authority for accounts, journals, lines, and balances;
- Operations owns audit and idempotency evidence;
- A2 supplies authorization and privileged context; and
- Reconciliation and repair remain separate from ordinary binding reads and commands.

## 2. Task-to-evidence matrix

| Task                                     | Committed implementation/evidence                                                                                                                                                                                                                                                                                                            | Boundary verified                                                                                                                                                                                    | Automated evidence                                                                                                                            | Current status / release condition                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A3T01 — Baseline and identity map        | [`A3-BINDING-BASELINE.md`](A3-BINDING-BASELINE.md)                                                                                                                                                                                                                                                                                           | Canonical Customer UUID, CustomerWallet UUID, WalletAccount UUID, LedgerAccount UUID, opaque references, currency, accounting unit, lifecycle, and current reconciliation coverage are distinguished | Source/entity/migration scan and documented duplicate/orphan query designs in the baseline                                                    | Prepared; runtime census and owner approval are not recorded                                                 |
| A3T02 — Ownership and lifecycle contract | [`ADR-0031-Customer-to-Financial-Account-Identity-Binding.md`](ADR/ADR-0031-Customer-to-Financial-Account-Identity-Binding.md), [`ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md`](ADR/ADR-0033-Financial-Account-Ownership-and-Lifecycle-Authority.md), [`A3-BINDING-OWNERSHIP-MATRIX.md`](A3-BINDING-OWNERSHIP-MATRIX.md) | `wallet` owns the binding association; `customer`, `customer-wallet`, `wallet`, `ledger`, Operations, A2, and Reconciliation retain separate authorities                                             | Matrix/ADR consistency review and source ownership review                                                                                     | Proposed decision input; accountable-owner approval is pending                                               |
| A3T03 — Wallet/Ledger mapping contract   | [`ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md`](ADR/ADR-0032-Wallet-Provisioning-to-Ledger-Account-Mapping.md), [`A3-WALLET-LEDGER-MAPPING-CONTRACT.md`](A3-WALLET-LEDGER-MAPPING-CONTRACT.md)                                                                                                                                 | `PROVISION_NEW` and `BIND_EXISTING`, canonical identity, currency, `CUSTOMER_FUNDS`, account type, idempotency, concurrency, and failure outcomes are explicit                                       | Contract review and mapping scenario review                                                                                                   | Proposed contract input; formal approval is pending                                                          |
| A3T04 — Binding persistence              | `src/wallet/customer-financial-account-binding.entity.ts`, `src/migrations/1785753600021-CreateCustomerFinancialAccountBindings.ts`, [`test/customer-financial-account-binding.persistence.spec.ts`](../test/customer-financial-account-binding.persistence.spec.ts)                                                                         | Foreign keys, composite source relationships, active Customer-plus-currency uniqueness, lifecycle checks, source-version checks, and wallet/ledger compatibility trigger are defined                 | Migration up/down recording test, entity metadata checks, no-financial-copy scan                                                              | Implemented and automated-tested; live PostgreSQL apply/revert evidence is not available in this environment |
| A3T05 — Binding execution                | `src/wallet/customer-financial-account-binding.service.ts`, `src/wallet/customer-financial-account-binding.types.ts`, `src/wallet/wallet.service.ts`, [`test/customer-financial-account-binding.service.spec.ts`](../test/customer-financial-account-binding.service.spec.ts)                                                                | A2 authorization, Operations idempotency, audit, serializable transaction, source preconditions, explicit target selection, and no journal/balance mutation                                          | New provisioning, existing target, replay, changed-payload, authorization, opaque-target, and concurrency tests                               | Implemented and automated-tested; no approved HTTP exposure is present                                       |
| A3T06 — Read model                       | `src/wallet/customer-financial-account-read.service.ts`, `src/wallet/customer-financial-account-read.types.ts`, [`test/customer-financial-account-read.service.spec.ts`](../test/customer-financial-account-read.service.spec.ts)                                                                                                            | Read path uses binding/source checks and Ledger-derived balance; metadata never stores balance                                                                                                       | Customer self-access, support scope, missing/stale/non-active, Ledger failure, and no-fabricated-balance tests                                | Implemented and automated-tested; service-only exposure pending an approved route                            |
| A3T07 — Reconciliation and drift         | `src/reconciliation/customer-financial-account-reconciliation.types.ts`, `src/reconciliation/reconciliation.service.ts`, [`test/customer-financial-account-reconciliation.spec.ts`](../test/customer-financial-account-reconciliation.spec.ts), [`test/reconciliation.service.spec.ts`](../test/reconciliation.service.spec.ts)              | Direct read-only SQL detects duplicate, orphaned, missing, unbound, stale, ownership, lifecycle, currency, unit, and Ledger-account drift                                                            | Consistent census, injected drift, read-only query, and existing reconciliation-gate tests                                                    | Implemented and automated-tested; no repair is performed by the report                                       |
| A3T08 — Repair and recovery              | `src/wallet/customer-financial-account-binding-repair.service.ts`, repair types/enums, [`test/customer-financial-account-binding-repair.service.spec.ts`](../test/customer-financial-account-binding-repair.service.spec.ts)                                                                                                                 | Repair requires A2 authorization, privileged approval, reconciliation evidence, idempotency, audit, transaction boundary, and only binding metadata changes                                          | Authorization denial, approval denial, resolve-to-pending, close, stale source, replay, changed payload, and unavailable-reconciliation tests | Implemented and automated-tested; no financial correction or reassignment is available                       |

## 3. End-to-end integration trace

### 3.1 Identity-to-account trace

```text
Customer.id
   |
   +--> CustomerWallet.customerId / CustomerWallet.id
   |        |
   |        +--> CustomerFinancialAccountBinding.customerWalletId
   |
   +--> CustomerFinancialAccountBinding.customerId
             |
             +--> WalletAccount.id
             |       |
             |       +--> WalletAccount.ledgerAccountId
             |
             +--> LedgerAccount.id
                     |
                     +--> Ledger-derived balance from immutable LedgerLine records
```

The binding record is the sole explicit association. No customer reference, wallet alias, opaque `WalletAccount.customerId`, payment reference, provider ID, or balance snapshot is used as a substitute.

### 3.2 Command/read/control trace

| Trace                        | Required behavior                                                                                                       | Evidence                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Authorized binding execution | A2 decision before mutation; source versions and dimensions checked; Operations idempotency and audit recorded          | A3T05 service and runtime tests        |
| Ledger-derived customer read | A2 decision before restricted read; active binding/source compatibility checked; balance fetched through LedgerService  | A3T06 service and read-model tests     |
| Binding reconciliation       | Direct SQL in `REPEATABLE READ`/`READ ONLY`; discrepancies carry owner, severity, recovery state; no write service call | A3T07 service and reconciliation tests |
| Binding repair               | A2 decision plus privileged approval; A3T07 result consumed; only binding state/version/evidence metadata changes       | A3T08 service and repair tests         |

## 4. Integration scenario matrix

| Scenario                                                                         | Expected result                                                         | Automated evidence                                            | Financial side-effect requirement                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Active Customer + active CustomerWallet + compatible WalletAccount/LedgerAccount | Binding can be active; read model returns Ledger-derived balance        | A3T05/A3T06 tests                                             | No journal or balance mutation by A3 binding/read path               |
| Identical binding retry                                                          | Original binding result is replayed                                     | A3T05 replay test                                             | No duplicate WalletAccount, LedgerAccount, binding, journal, or line |
| Same idempotency key with changed payload                                        | Conflict                                                                | A3T05 changed-payload test                                    | No mutation                                                          |
| Concurrent same customer/currency binding                                        | One mapping wins; duplicate attempt fails                               | A3T05 concurrency test; A3T04 uniqueness schema               | No duplicate financial account or mapping                            |
| Missing active binding                                                           | Read model returns `MISSING_BINDING` and no account/balance             | A3T06 missing-binding test; A3T07 missing-binding discrepancy | No fabricated account or balance                                     |
| Stale source version/lifecycle/dimension                                         | Read model returns `STALE_BINDING`; reconciliation reports drift        | A3T06 stale test; A3T07 drift test                            | No automatic source repair                                           |
| Duplicate/orphaned binding                                                       | Reconciliation reports error with owner and A3T08 handoff               | A3T07 drift test                                              | No row mutation to clear report                                      |
| Privileged repair approval denied                                                | Repair is rejected                                                      | A3T08 approval test                                           | No source or financial mutation                                      |
| Repair to `PENDING`                                                              | Binding metadata moves from `REPAIR_REQUIRED` to `PENDING` only         | A3T08 repair test                                             | No account, journal, line, or balance mutation                       |
| Terminal close of repair state                                                   | Binding metadata moves to `CLOSED` with audit/approval                  | A3T08 close test                                              | No financial correction or reassignment                              |
| Ledger unavailable during read                                                   | `LEDGER_UNAVAILABLE`; balance is null                                   | A3T06 Ledger failure test                                     | No fabricated balance                                                |
| Reconciliation query unavailable                                                 | Repair is blocked; report exposes controlled query-unavailable evidence | A3T08 reconciliation-evidence test                            | No repair or financial mutation                                      |

## 5. Cross-cutting contract verification

| Contract                   | A3 use                                                                                                | Evidence/status                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A2 authorization           | Customer self-read, support read, binding execution, and repair authorization                         | Existing A2 services/tests plus A3 runtime tests; formal A2 approval remains pending |
| Privileged approval        | Required for A3T08 repair actions and separation of duties                                            | Existing privileged approval service/tests plus A3T08 tests                          |
| Operations audit           | Binding mutations, replay/rejection evidence, and repair transitions                                  | Existing AuditService plus A3T05/A3T08 tests                                         |
| Operations idempotency     | Binding and repair command scopes, request hashes, replay, changed-payload conflicts                  | Existing IdempotencyService plus A3T05/A3T08 tests                                   |
| Ledger authority           | Account state and balances only from Ledger; no A3 journal write                                      | LedgerService, migration constraints, A3 side-effect tests                           |
| Independent Reconciliation | Binding/source drift is queried independently of write services                                       | A3T07 report and tests                                                               |
| Privacy/minimization       | No credentials, raw compatibility values, balances in metadata, or unnecessary source payloads copied | A3 contracts and A3 read/repair audit payloads                                       |

## 6. Integration gate result

- **Implementation integration:** Prepared and automated-tested.
- **Read-only control integration:** Prepared and automated-tested.
- **Migration integration:** Entity/migration metadata and rollback recording tested; live database apply/revert not executed because no PostgreSQL service is available in the environment.
- **HTTP route integration:** No new A3 binding/read/repair controller or route is present. Existing internal route protection remains the A2 responsibility.
- **A4/A5 activation:** Blocked until A3 approval, A2 approval, unresolved ADR/registry issues, and live operational evidence are closed.

This matrix is evidence for A3T09 review. It is not an approval signature.
