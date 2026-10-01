# A6T01 — External Partner and Settlement Baseline and Capability Selection

- **Phase:** A6 — External Partners & Settlement
- **Task:** A6T01 — External Partner and Settlement Baseline and Capability Selection
- **Status:** Baseline prepared for A6T02; no A6 runtime implementation introduced
- **Classification:** Documentation-only A6 implementation baseline
- **Review snapshot:** `7786ce3ffb2770ed17dafd73e726d7f55ee80e6a`
- **Selected capability:** NGN external customer-wallet settlement to a Nigerian bank account through an isolated NIBSS/NIP partner adapter
- **Application, database, API, migration, controller, route, scheduler, provider, credential, settlement, and financial-runtime changes in this task:** None

## 1. Purpose and boundary

A6T01 establishes the current repository baseline for the first bounded external-partner capability. It inventories the existing financial, customer, funding-instrument, beneficiary, bank-directory, authorization, policy, account-binding, Operations, outbox, and reconciliation boundaries before any bank, NIBSS, provider, callback, settlement, or suspense implementation begins.

The baseline selects one planning capability:

```text
capability: external.wallet.withdrawal.settlement
direction: internal customer-funds wallet -> external Nigerian bank account
rail: NIBSS/NIP bank-transfer settlement through an isolated A6 adapter
initial currency: NGN
internal lifecycle input: existing Withdrawal/payment/Ledger boundaries
external target input: verified customer-owned bank-account beneficiary or approved equivalent
```

This is a bounded implementation-planning selection. It is not partner certification, credential authorization, legal or regulatory approval, production activation, live settlement, or permission to expose an existing route.

The selection is deliberately limited to one external direction and one currency. A6 does not simultaneously implement external deposits, virtual-account funding, mobile-money funding, multiple NIBSS products, multiple banks, cross-currency movement, FX, fees, cards, QR, or a general provider platform.

A6T02-A6T11 must define and implement the approved adapter, external-operation, callback, reference, idempotency, lifecycle, settlement, suspense, reconciliation, privacy, and release boundaries before this capability could be considered for a controlled release.

## 2. Selected capability and rationale

### 2.1 Selected external flow

The selected A6 planning flow is:

```text
A2-protected internal withdrawal command
  -> A4 external-capability policy decision
  -> A3 internal Customer-to-Financial-Account recheck
  -> existing customer-owned bank-account target/beneficiary validation
  -> A6 NIBSS/NIP adapter request
  -> authenticated provider acknowledgement/callback/status/report
  -> external-operation lifecycle and recovery
  -> verified settlement outcome
  -> Ledger-owned customer debit and approved settlement/suspense credit
  -> independent external reconciliation
```

The internal customer wallet and LedgerAccount are explicit internal identities. A bank code, destination account number, beneficiary reference, NIBSS reference, provider transaction ID, callback ID, or payment reference is an external or lookup value and cannot replace `Customer.id`, `WalletAccount.id`, `LedgerAccount.id`, the internal withdrawal ID, or the Ledger journal ID.

### 2.2 Repository-supported rationale

The repository contains the following relevant compatibility inputs:

- `bank.Bank` stores a local bank directory, `bankCode`, `bankName`, `nipSupported`, and bank status, but it is not a NIBSS adapter or external connectivity authority.
- `customer-beneficiary.CustomerBeneficiary` supports a `BANK_ACCOUNT` target, destination identifiers, destination institution metadata, verification, ownership, status, and versioning, but it is not an external settlement record.
- `customer-funding-instrument.CustomerFundingInstrument` supports bank-account and related metadata types, ownership, verification state, status, version, and history, but it does not store or authorize raw provider credentials.
- `WithdrawalService` already models an internal withdrawal lifecycle and posts through `LedgerService` against an internally configured settlement asset account, but it does not call a bank, NIBSS, or external provider.
- `SettlementAccountService` already resolves Ledger settlement-account roles, including `SETTLEMENT_ASSET`, `SETTLEMENT_CLEARING`, and `SYSTEM_SUSPENSE`, but it does not represent external settlement finality or provider evidence.
- A5 provides customer-aware command, authorization/policy/binding gates, lifecycle, idempotency, outbox, recovery, pilot disable, and independent reconciliation patterns that A6 must consume rather than replace.

The selected flow therefore exercises the repository's existing withdrawal, bank-directory, customer-beneficiary, funding-instrument, payment-reference, settlement-account, Wallet, Ledger, Operations, and Reconciliation boundaries without claiming that any of them already provide external-rail behavior.

### 2.3 Selection constraints

The selected flow is constrained to:

- `NGN` only for the initial A6 planning boundary.
- One NIBSS/NIP adapter boundary; no direct calls from `WithdrawalService`, `LedgerService`, Customer modules, or reconciliation code.
- One external bank-account settlement direction.
- One explicit, verified, customer-owned external target per operation.
- One existing internal customer WalletAccount/LedgerAccount source resolved through A3 binding.
- Positive integer minor-unit amounts and explicit `CUSTOMER_FUNDS` accounting-unit handling.
- An external-operation identity distinct from the internal withdrawal ID, payment reference, provider reference, and Ledger journal ID.
- Provider acknowledgement, callback, status-query, or settlement-report evidence treated as untrusted until the A6 contract validates it.
- Pending, unknown, suspense, manual-review, and reconciliation outcomes where provider finality or matching is unavailable.

Any change to direction, currency, partner, provider product, funding method, customer cohort, or financial effect is outside this baseline selection and requires a separate A6 capability decision.

## 3. Current repository baseline

### 3.1 External and adjacent surfaces

| Surface                            | Current repository artifact                                                                                                                                                             | Current behavior                                                                                                                              | A6T01 classification                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Bank directory                     | [`src/bank/bank.entity.ts`](../src/bank/bank.entity.ts), `BankService`, `BankController`                                                                                                | Stores local bank code/name/status and `nipSupported`; exposes metadata CRUD.                                                                 | Local directory metadata only; not NIBSS connectivity, bank authentication, provider capability, or settlement truth.                |
| Customer beneficiary               | [`src/customer-beneficiary/customer-beneficiary.entity.ts`](../src/customer-beneficiary/customer-beneficiary.entity.ts), `CustomerBeneficiaryService`                                   | Stores customer-owned beneficiary metadata, bank-account destination identifiers, destination institution, verification, status, and version. | Preferred customer-owned external-target metadata input; not a provider operation or external account-ownership proof by itself.     |
| Legacy beneficiary                 | [`src/beneficiary/beneficiary.entity.ts`](../src/beneficiary/beneficiary.entity.ts), `BeneficiaryService`                                                                               | Stores legacy beneficiary metadata through a separate module and route surface.                                                               | Compatibility/overlap input; A6 must not silently choose it over `customer-beneficiary` as the external-target authority.            |
| Customer funding instrument        | [`src/customer-funding-instrument/customer-funding-instrument.entity.ts`](../src/customer-funding-instrument/customer-funding-instrument.entity.ts), `CustomerFundingInstrumentService` | Stores instrument type/reference, customer ownership, status, verification state, version, and history.                                       | Metadata and verification input only; no raw credential, token, provider settlement, or external idempotency authority.              |
| Existing withdrawal                | [`src/withdrawal/withdrawal.service.ts`](../src/withdrawal/withdrawal.service.ts), `Withdrawal` entity/module                                                                           | Creates a pending withdrawal, processes it, and completes it by posting a customer debit and internal settlement-asset credit through Ledger. | Financial compatibility input; no external provider request, callback, provider reference, suspense lifecycle, or external finality. |
| Existing deposit                   | [`src/deposit/deposit.service.ts`](../src/deposit/deposit.service.ts), `Deposit` entity/module                                                                                          | Creates and completes an internal deposit against an internally configured settlement asset account.                                          | Compatibility input; no external funding evidence or provider reconciliation.                                                        |
| Virtual account                    | `src/virtual-account/`                                                                                                                                                                  | Stores local virtual-account assignment metadata and lookup/deactivation behavior.                                                            | Metadata-only compatibility input; no external account issuance or provider settlement.                                              |
| Payment references                 | [`src/payment/payment-reference.service.ts`](../src/payment/payment-reference.service.ts), `PaymentReference`                                                                           | Generates internal payment references for financial lifecycle records.                                                                        | Internal support/reference authority; never a provider reference or proof of settlement.                                             |
| Settlement accounts                | [`src/payment/settlement-account.service.ts`](../src/payment/settlement-account.service.ts)                                                                                             | Looks up active Ledger accounts by currency and settlement role.                                                                              | Ledger-side account lookup only; not an external settlement-state authority.                                                         |
| External provider/callback adapter | No current adapter, callback processor, provider client, provider operation record, or provider report reader                                                                           | No bank/NIBSS/provider call exists in the repository.                                                                                         | A6 implementation gap assigned to A6T02 onward; not introduced by A6T01.                                                             |

### 3.2 Existing financial lifecycle compatibility

The current `WithdrawalService` has useful internal financial behavior:

- positive integer minor-unit amount validation;
- explicit currency validation;
- WalletAccount status and currency checks;
- serializable transaction retries for known PostgreSQL serialization/deadlock errors;
- idempotency-key/request-hash replay and changed-payload rejection;
- `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`, and `CANCELLED` lifecycle behavior;
- Ledger posting through `LedgerService.postJournalInTransaction`;
- deterministic withdrawal-to-journal correlation;
- Operations audit, outbox, and metrics hooks; and
- internal settlement-asset account lookup through `SettlementAccountService`.

It does **not** establish the A6 external boundary. In particular, it currently has no:

- A2/A4/A3 customer-aware external settlement gate;
- external-operation identity or partner/provider identity;
- NIBSS/bank/provider adapter;
- provider request idempotency or provider reference mapping;
- authenticated callback or status-report ingestion;
- provider outage/circuit-breaker/ambiguous-outcome state;
- external settlement confirmation or statement reconciliation;
- suspense/manual-review lifecycle for unmatched provider value; or
- provider-specific data-sharing, consent, credential, or callback-secret boundary.

Existing `Transfer`, `Deposit`, and `Withdrawal` rows remain internal financial lifecycle records. A6 must not reinterpret them as external-operation records without an approved later A6 state/correlation contract.

### 3.3 Wallet and Ledger boundary

| Concept                      | Current artifact/owner                                                                           | Current authority      | A6 use                                                                                                           | Prohibited A6 interpretation                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Customer identity            | `customer.Customer.id`                                                                           | Customer module        | Carry canonical customer identity into the external-operation correlation chain.                                 | Provider/customer reference or beneficiary reference becomes canonical identity.             |
| Customer wallet metadata     | `customer-wallet`                                                                                | Customer-wallet module | Read through A3-approved ownership/binding evidence.                                                             | CustomerWallet selects a LedgerAccount or stores external funds.                             |
| Financial wallet facade      | [`src/wallet/wallet-account.entity.ts`](../src/wallet/wallet-account.entity.ts), `WalletService` | Wallet module          | Use explicit WalletAccount identity/status/currency.                                                             | WalletAccount becomes a provider account, settlement account, or independent balance source. |
| Customer-to-account binding  | A3 binding services/entities                                                                     | A3                     | Recheck Customer -> CustomerWallet -> WalletAccount -> LedgerAccount for the withdrawal source.                  | A6 repairs, reassigns, or infers an internal binding from external data.                     |
| Financial accounts           | `ledger.LedgerAccount`                                                                           | Ledger                 | Resolve the internal customer-funds source and approved settlement/suspense accounts through Ledger-owned rules. | Bank account, NIBSS account, provider reference, or payment reference is a LedgerAccount.    |
| Journals and lines           | `LedgerJournal`, `LedgerLine`, `LedgerService`                                                   | Ledger                 | Post at most one verified, balanced settlement effect through Ledger.                                            | A6 writes balances, journals, or lines directly.                                             |
| Settlement/suspense accounts | Existing `SettlementAccountService` and `SettlementAccountRole`                                  | Ledger/Finance         | Consume only after approved A6 settlement dimensions and evidence exist.                                         | Existing role enum alone proves an external settlement account or finality.                  |
| Financial correction         | `LedgerService.reverseJournal` and Ledger/Finance boundary                                       | Ledger/Finance         | Use a new compensating entry if approved for a later exception.                                                  | Edit posted history or use reconciliation to clear an external mismatch.                     |

The Ledger remains the sole authority for internal customer-funds value, settlement value, suspense value, journals, lines, balances, and compensating entries. A6 must preserve integer minor units, explicit currency, explicit accounting unit, balanced double-entry, deterministic locking, and journal immutability.

### 3.4 A2 runtime identity and access boundary

| Surface                     | Current artifact                                                                | A6 dependency                                                                                                                    | A6 prohibited use                                                                           |
| --------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Principal and authorization | `src/authorization/authorization.types.ts`, `AuthorizationService`              | Authorize the initiating internal withdrawal/settlement command for the exact customer, capability, target, and operation scope. | A4 `ALLOW`, provider authentication, or beneficiary verification replaces A2 authorization. |
| Runtime access              | `RuntimeAccessGuard`, `AuthorizationGuard`, route policy registry               | Protect any future internal external-command, callback, support, or control path.                                                | Existing route registration is treated as public or partner-authenticated exposure.         |
| Privileged actions          | `PrivilegedActionApprovalService` and approval types                            | Protect partner configuration, emergency access, suspense actions, manual recovery, and exception controls where required.       | A6 issues its own privileged approvals or bypasses separation of duties.                    |
| Security/privacy inputs     | `docs/A2-A6-PRIVACY-INPUTS.md`, `docs/A2-SECURITY-DATA-PROTECTION-CHECKLIST.md` | Apply principal, audience, secret, signature, callback, support, and sensitive-data handling rules.                              | Provider credentials, callback secrets, or raw financial data enter broad A2/A6 outputs.    |

Existing `/withdrawals`, `/banks`, `/customers/.../beneficiaries`, `/customers/.../funding-instruments`, `/internal`, and `/internal/reconciliation` routes are implementation surfaces only. A6T01 changes none of them and does not authorize any route for customer, provider, or production use.

### 3.5 A3 customer-to-financial-account boundary

| Surface                | Current artifact                                                               | A6 role                                                                                              | Prohibited A6 write                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Binding record         | `src/wallet/customer-financial-account-binding.entity.ts` and binding services | Establish the explicit internal source account for the external settlement command.                  | Create, repair, reassign, activate, suspend, or close a binding during external execution. |
| Read model             | `src/wallet/customer-financial-account-read.service.ts`                        | Supply read-only account status, dimensions, and control warnings.                                   | Treat external target metadata as a replacement for the internal binding.                  |
| Binding reconciliation | `src/reconciliation/reconciliation.service.ts` and A3 reconciliation types     | Block or hold external settlement when customer/account ownership or control evidence is unresolved. | A callback/report repairs a source binding.                                                |
| Binding repair         | `src/wallet/customer-financial-account-binding-repair.service.ts`              | Remains an A3 privileged recovery path outside the A6 command.                                       | A6 invokes repair to make an external command pass.                                        |

A3 state values such as `PENDING`, `SUSPENDED`, `REPAIR_REQUIRED`, `CLOSED`, `MISSING_BINDING`, `STALE_BINDING`, and `LEDGER_UNAVAILABLE` remain truthful non-active evidence. An external bank account or provider target does not prove ownership of the internal customer WalletAccount or LedgerAccount.

### 3.6 A4 capability and policy boundary

| Surface                     | Current artifact                                                                   | A6 role                                                                                                    | Prohibited A6 interpretation                                                    |
| --------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Policy evaluator            | `src/policy/capability-policy.service.ts`                                          | Supply the current external withdrawal/settlement capability decision when A6 defines the action contract. | A6 creates a second risk/eligibility/restriction/limit evaluator.               |
| Evidence coordinator        | `src/policy/capability-policy-evidence.coordinator.ts` and source readers          | Provide minimized, versioned, current evidence through A4.                                                 | Raw compliance, risk, credential, or provider payload becomes policy authority. |
| Policy profile/persistence  | `src/policy/capability-policy.profiles.ts`, policy entities/repositories/migration | Bind an A6 command to policy/profile/version/expiry/review/obligation references.                          | A6 mutates A4 policy or source records to permit settlement.                    |
| Policy recovery/explanation | A4 recovery and explanation services                                               | Represent stale, expired, pending, denied, suspended, or unavailable decisions safely.                     | Provider acknowledgement is treated as an A4 `ALLOW`.                           |

The selected external capability must receive a future A4 policy mapping. A6T01 does not create or change that policy mapping and does not treat the existing `wallet.transfer/create` policy as external settlement authorization.

### 3.7 A5 internal command and recovery boundary

| Surface                         | Current artifact                                                                                        | A6 relevance                                                                                                   | Boundary preserved                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Customer-aware internal command | `src/transfer/internal-transfer-gate.service.ts`, command types, `docs/A5-TRANSFER-COMMAND-CONTRACT.md` | Supplies identity, A2/A4/A3 separation, amount/currency, request hash, and correlation patterns.               | External provider IDs remain distinct from A5 command identity.                           |
| Transfer lifecycle              | `src/transfer/transfer-lifecycle.service.ts`, lifecycle types, migration `1785753600023`                | Supplies pending/processing/recovery/unknown/completed/failed/cancelled design patterns.                       | A6 does not mutate completed A5 history to explain provider outcomes.                     |
| Ledger post/recovery            | A5 Ledger integration and recovery behavior                                                             | Supplies transaction, lock, journal-correlation, bounded retry, timeout, and unknown-outcome patterns.         | External uncertainty enters A6 pending/recovery/reconciliation, never optimistic success. |
| Transactional outbox            | `src/transfer/transfer-events.ts`, `OutboxService`, migration `1785753600024`                           | Supplies minimal internal intent/fact and event-key patterns for later A6 operations.                          | An outbox fact is not a provider acknowledgement or Ledger truth.                         |
| Pilot controls                  | `src/pilot/pilot-control.service.ts`, migration `1785753600025`                                         | Supplies disable/stop-condition/rollback-safe admission patterns for any later controlled external capability. | A6 cannot broaden or rewrite the A5 internal pilot cohort.                                |

A5 is an internal customer-to-customer transfer boundary. It contains no external bank/NIBSS/provider implementation. A6T01 records this as a compatibility and handoff boundary, not an implementation gap to change in A5.

### 3.8 Operations, Outbox, Diagnostics, and Reconciliation boundary

| Surface                 | Current artifact                                                                                         | A6 role                                                                                                                                                   | Prohibited A6 behavior                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Audit                   | [`src/operations/audit.service.ts`](../src/operations/audit.service.ts), `AuditEvent`                    | Record adapter admission, external operation, callback, settlement, exception, recovery, and support facts through Operations.                            | Direct audit-table writers or raw provider/secret payloads.                      |
| Idempotency             | [`src/operations/idempotency.service.ts`](../src/operations/idempotency.service.ts), `IdempotencyRecord` | Own internal command/operation deduplication and replay/conflict evidence; provider idempotency remains a distinct partner contract.                      | Module-local map/table or provider key treated as internal identity.             |
| Outbox                  | [`src/operations/outbox.service.ts`](../src/operations/outbox.service.ts), `OutboxEvent`                 | Persist minimal internal intent/facts transactionally where approved; later A6 delivery is a separate boundary.                                           | Outbox row treated as settled value or direct provider truth.                    |
| Metrics                 | `src/operations/metrics.service.ts`                                                                      | Observe adapter failures, provider latency/outage, callback replay, unknown outcomes, settlement exceptions, suspense aging, and reconciliation failures. | Metrics authorize, settle, or repair an operation.                               |
| Diagnostics/readiness   | `src/operations/diagnostics.service.ts`, `src/production/production-readiness.service.ts`                | Surface availability and safe operational signals without becoming a settlement writer.                                                                   | Readiness or diagnostics clear a pending provider or reconciliation discrepancy. |
| Internal reconciliation | `src/reconciliation/reconciliation.service.ts`, `src/reconciliation/transfer-reconciliation.service.ts`  | Extend later for provider/external-operation/settlement/suspense comparison; remain read-only.                                                            | Provider callback or reconciliation report repairs source records.               |

There is no current provider-report reader, external-operation reconciliation report, callback replay report, or A6-specific suspense reconciliation path. These are assigned to A6T06-A6T09 and are not implemented by A6T01.

### 3.9 Schema, migration, and route baseline

- The repository uses PostgreSQL and TypeORM with migration-controlled schema changes and `synchronize=false`.
- The A5 branch includes migration additions through `1785753600025-CreatePilotControls.ts`.
- No A6 external-operation, provider-reference, callback-receipt, settlement-attempt, suspense-case, provider-report, or partner-credential table is present.
- Existing `deposits`, `withdrawals`, `transfers`, `payment_references`, `ledger_*`, `outbox_events`, and customer metadata tables retain their current owners.
- Existing financial routes and internal routes are registered compatibility surfaces; no route is an A6-approved external or callback exposure.
- No A6 provider client, HTTP adapter, SDK, webhook receiver, status poller, statement reader, circuit breaker, partner credential configuration, or settlement workflow exists.

## 4. A6 capability selection

### 4.1 In scope for the selected A6 planning boundary

- One NGN external customer-wallet withdrawal/settlement capability.
- One NIBSS/NIP partner adapter boundary, with any participating bank directory metadata consumed as an input rather than a connection authority.
- One explicit customer-owned bank-account target represented by the approved `customer-beneficiary` or later A6 target contract.
- One explicit internal Customer UUID and A3 WalletAccount/LedgerAccount source chain.
- Existing Withdrawal/payment/Ledger lifecycle compatibility mapping, without silently reusing internal completion as external settlement proof.
- A future external-operation ID, provider-operation/reference mapping, callback/report correlation, settlement/suspense state, and independent reconciliation contract assigned to later A6 tasks.
- NGN positive integer minor units and explicit `CUSTOMER_FUNDS` accounting-unit behavior.
- A2 authorization, A4 external-capability policy, A3 binding/control checks, Operations audit/idempotency/outbox/metrics/diagnostics, and independent Reconciliation.
- Provider sandbox/certification fixtures and deterministic failure scenarios in later A6 tasks.

This selection is a planning decision only. No provider endpoint, credential, target account, customer, cohort, route, or live operation is activated by A6T01.

### 4.2 Explicitly excluded from the selected boundary

- External deposit/funding into wallets, virtual-account activation, or inbound bank transfer collection.
- Mobile-money, cash-agent, card, QR, direct-debit, wallet-to-wallet, or other external rails.
- Any second provider, second NIBSS product, multi-provider routing, fallback provider, or provider marketplace.
- Cross-currency movement, FX, rate lookup, rounding, fees, commissions, taxes, or pricing.
- Customer-facing withdrawal activation, public APIs, mobile/web channels, notification delivery, or general rollout.
- Raw bank-account credentials, card secrets, PINs, OTPs, callback secrets, signing keys, certificates, or provider tokens in the repository.
- Provider callback, statement, settlement, suspense, reconciliation, or exception runtime implementation in A6T01.
- Changes to Customer, CustomerWallet, customer funding-instrument/beneficiary ownership, A3 bindings, A4 policy/source data, A5 transfer history, Wallet balances, Ledger journals/lines, audit, idempotency, outbox, or reconciliation records.
- Automated AML, sanctions, fraud, PEP, transaction-monitoring, or risk-scoring behavior.
- A7 product expansion, notification/background-job infrastructure, public API/partner platform, or A8 extraction.

## 5. Authority and ownership matrix

| Concept                              | Authoritative owner                                        | Current repository evidence                                           | A6 use                                                                                                            | Prohibited A6 write or interpretation                                                             |
| ------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Canonical internal customer identity | `customer` / `Customer.id`                                 | `src/customer/`, A1 ownership/identifier controls                     | Correlate the internal withdrawal/settlement subject.                                                             | Provider, bank, beneficiary, funding-instrument, payment, or callback reference becomes identity. |
| Customer wallet metadata             | `customer-wallet`                                          | `src/customer-wallet/` entities/services                              | Read only through A3-approved binding/ownership evidence.                                                         | Store external balance, provider identity, or settlement truth.                                   |
| Funding-instrument metadata          | `customer-funding-instrument`                              | `src/customer-funding-instrument/`                                    | Validate approved instrument type/status/verification/ownership for later A6 use.                                 | Store raw credentials or mutate ownership/status to make settlement pass.                         |
| Customer beneficiary metadata        | `customer-beneficiary`                                     | `src/customer-beneficiary/`                                           | Candidate verified bank-account target input; final A6 target contract remains later work.                        | Treat destination identifier or reference as bank ownership proof or Ledger identity.             |
| Legacy beneficiary metadata          | `beneficiary`                                              | `src/beneficiary/`                                                    | Compatibility input requiring explicit disposition.                                                               | Silently merge or select legacy data as the A6 authority.                                         |
| Bank directory                       | `bank`                                                     | `src/bank/`                                                           | Validate local directory metadata such as bank code/status/NIP support where later contract permits.              | Use local bank row as provider connectivity, account ownership, or settlement proof.              |
| Internal WalletAccount               | `wallet`                                                   | `src/wallet/`                                                         | Explicit internal financial-wallet facade and A3 mapping input.                                                   | Maintain a second balance or select a wallet from external data.                                  |
| Internal financial accounts/value    | `ledger`                                                   | `src/ledger/`, `LedgerService`                                        | Post verified settlement only through Ledger.                                                                     | Direct balance/journal/line writes or provider response as financial truth.                       |
| Internal withdrawal lifecycle        | `withdrawal` / payment lifecycle                           | `src/withdrawal/`, `src/payment/`                                     | Compatibility lifecycle and payment-reference input.                                                              | Treat current `COMPLETED` as external settlement finality without A6 evidence.                    |
| Internal transfer lifecycle          | `transfer` / A5                                            | `src/transfer/`, A5 documents                                         | Preserve internal transfer boundaries and correlation patterns.                                                   | Call a provider from A5 internal transfer or rewrite A5 history.                                  |
| A2 access                            | `authorization`                                            | `src/authorization/`                                                  | Authorize exact external command, callback/support/control audience, and privileged exception actions.            | A4 allow, provider signature, or beneficiary verification substitutes for A2.                     |
| A3 binding/account control           | A3 `wallet` binding capability                             | binding entity/services/read/reconciliation                           | Verify internal customer/account ownership and dimensions.                                                        | Repair, reassign, or infer an internal account from provider data.                                |
| A4 capability policy                 | `policy`                                                   | `src/policy/`                                                         | Provide current external capability/action decision, limits, obligations, expiry, and evidence references.        | Duplicate precedence or mutate source policy/evidence.                                            |
| External partner connectivity        | Future A6 adapter boundary                                 | No current provider adapter; selected planning rail is NIBSS/NIP      | Own transport, provider capability, request/response, status, and partner-specific normalization after A6T02/T03. | Let Customer, Wallet, Ledger, A5, or Reconciliation call a provider directly.                     |
| External operation identity          | Future A6 external-operation boundary                      | No current external-operation record                                  | Correlate one logical provider-facing operation with internal command/lifecycle.                                  | Use provider reference, payment reference, or journal ID as a substitute.                         |
| Callback authenticity and receipt    | Future A6 callback boundary under A2                       | No callback processor or route                                        | Validate authenticated provider events and replay/deduplication state.                                            | Accept unauthenticated callbacks or write financial state directly.                               |
| Settlement and suspense              | Ledger/Finance through A6 contract                         | `SettlementAccountService`, Ledger settlement roles, no external flow | Own approved settlement/suspense mapping and exception states through Ledger.                                     | Create a second settlement ledger, auto-clear suspense, or edit history.                          |
| Audit                                | Operations                                                 | `AuditService`, `AuditEvent`                                          | Record safe external-operation, provider, callback, settlement, and recovery facts.                               | Direct table writes or sensitive raw payloads.                                                    |
| Idempotency                          | Operations plus distinct partner contract                  | `IdempotencyService`, `IdempotencyRecord`                             | Internal operation replay/conflict plus provider-scoped idempotency.                                              | Use a local A6 store or conflate provider and internal keys.                                      |
| Outbox                               | Operations                                                 | `OutboxService`, `OutboxEvent`                                        | Persist minimal internal intent/fact where later A6 contract requires it.                                         | Treat outbox as provider acknowledgement, settlement, or Ledger truth.                            |
| Reconciliation                       | Reconciliation/Finance                                     | `ReconciliationService`, `TransferReconciliationService`              | Independently verify provider/internal operation/settlement/journal/suspense consistency later.                   | Repair source rows or authorize settlement from a report.                                         |
| Recovery and support                 | Operations, A2, Ledger/Finance, Reconciliation by boundary | diagnostics, readiness, audit, lifecycle, reconciliation patterns     | Route unknown, timeout, outage, callback, settlement, suspense, and support evidence to owners.                   | Clear ambiguity through dashboards, readiness, or support views.                                  |

## 6. A6 dependency, risk, certification, and rollback register

The following gaps are A6 implementation inputs. They are not implemented by A6T01.

| ID      | Current baseline finding                                                                                                                                           | A6 impact                                                                                  | Future task             | Required next action                                                                                            | Stop/rollback behavior                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A6-G001 | No bank/NIBSS/provider adapter or external partner boundary exists.                                                                                                | Provider behavior could leak into financial modules or be called without isolation.        | A6T02/A6T03             | Define and implement the adapter, partner capability, transport, and credential boundary.                       | Keep external admission and calls disabled.                                  |
| A6-G002 | Existing bank module is local metadata only, even where `nipSupported` is recorded.                                                                                | Bank-directory data could be mistaken for NIBSS connectivity or provider certification.    | A6T01-A6T03             | Define partner/rail capability, bank mapping, and certification assumptions separately.                         | Do not call a bank/NIBSS endpoint from the bank module.                      |
| A6-G003 | Existing WithdrawalService completes against an internal settlement asset account and has no external-operation state.                                             | Internal completion could be misreported as external settlement finality.                  | A6T05/A6T07/A6T08       | Define external operation, provider reference, verified outcome, settlement, suspense, and unknown states.      | Preserve withdrawal ambiguity; no external retry or customer finality claim. |
| A6-G004 | CustomerFundingInstrument and CustomerBeneficiary contain metadata/verification fields but no approved provider mapping or consent/mandate boundary for this flow. | An unverified or stale target could receive an external request.                           | A6T04/A6T10             | Define ownership, verification, purpose, consent, target mapping, and minimal adapter payload.                  | Reject or hold before adapter submission.                                    |
| A6-G005 | Legacy `beneficiary` and preferred `customer-beneficiary` modules overlap.                                                                                         | A6 could use an ambiguous destination authority.                                           | A6T01/A6T04             | Record the selected target owner and compatibility disposition before external use.                             | No external target selection while ownership is ambiguous.                   |
| A6-G006 | No provider request idempotency, external-operation identity, provider-reference mapping, or callback event identity exists.                                       | Duplicate submissions and callbacks could create duplicate settlement effects.             | A6T05/A6T06             | Define distinct internal/provider scopes, normalized hashes, reference uniqueness, and replay handling.         | Keep operation pending/blocked; never retry with a new financial identity.   |
| A6-G007 | No authenticated callback, provider status-query, statement/report reader, or external reconciliation path exists.                                                 | Provider acceptance, failure, and finality cannot be independently verified.               | A6T06/A6T09             | Define authenticity, status/report evidence, reconciliation queries, and discrepancy ownership.                 | No settled financial effect; hold in recovery/suspense/manual review.        |
| A6-G008 | Ledger settlement roles include `SYSTEM_SUSPENSE`, but no A6 external settlement/suspense lifecycle is defined.                                                    | Unmatched value could be credited, debited, or cleared without approved ownership.         | A6T08                   | Define Finance/Ledger account dimensions, suspense aging, manual review, release, and compensating-entry rules. | Do not create or clear suspense value outside Ledger/Finance boundary.       |
| A6-G009 | Operations has audit/idempotency/outbox/metrics/diagnostics primitives but no provider-specific operation or callback facts.                                       | External evidence could be untraceable or stored in a local authority.                     | A6T05-A6T09             | Extend shared primitives through approved contracts without local stores or sensitive payloads.                 | Fail closed or retain a controlled pending state.                            |
| A6-G010 | Existing internal routes are registered, but no A6 callback or external command exposure has an A2 policy.                                                         | A route could be mistaken for approved customer/partner access.                            | A6T06/A6T11             | Define protected internal ingress and route/data-exposure evidence under A2.                                    | Keep routes unapproved and external admission disabled.                      |
| A6-G011 | No selected partner certification fixture, sandbox contract, outage drill, or rollback evidence exists.                                                            | Adapter correctness and provider failure behavior are unproven.                            | A6T02/A6T03/A6T09/A6T11 | Build deterministic partner fixtures and certify the selected contract before release consideration.            | Do not activate the partner or accept live external outcomes.                |
| A6-G012 | A1/A2/A6 privacy inputs require field-level external-processing, consent, retention, and legal-hold decisions; no A6 provider data map exists.                     | Sensitive or unnecessary customer/funding/financial data could cross the partner boundary. | A6T01/A6T10             | Define minimum data map, purpose, consent/mandate, retention, access, and incident controls.                    | Block transmission when sharing/consent evidence is unavailable.             |
| A6-G013 | No A6 operation currently links internal customer/account/journal identities to provider references.                                                               | Support and reconciliation could rely on non-canonical provider IDs.                       | A6T05/A6T09             | Define immutable internal/external correlation and safe support trace.                                          | Preserve evidence; do not infer identity from external references.           |
| A6-G014 | Existing A5 internal transfer explicitly excludes external providers and settlement.                                                                               | Adding a provider to A5 would violate phase boundaries and change the pilot risk profile.  | A6T01/A6T02             | Keep A5 internal; introduce an explicit A6 external-operation boundary.                                         | Reject or route external requests outside the A5 internal path.              |

## 7. Certification assumptions

A6T01 records the following assumptions for later implementation planning. They are not claims that certification, approval, or live access exists:

### 7.1 Partner and rail assumptions

- The selected planning rail is NIBSS/NIP for one NGN outbound bank-account settlement flow.
- A later A6 task must obtain an authoritative partner interface/version, request schema, response schema, error vocabulary, provider idempotency behavior, status-query behavior, callback/report behavior, rate limits, outage behavior, and certification/sandbox procedure.
- A bank-directory row with `nipSupported = true` is only local metadata and is not a provider-capability or bank-participation assertion until the selected A6 adapter contract validates it.
- A6 must not assume every bank record, provider reference, callback type, or NIBSS service supports the selected operation.
- Provider certification must use deterministic fixtures or an approved sandbox before any production-like release consideration.

### 7.2 Identity and mapping assumptions

- The initiating internal subject remains `Customer.id`.
- The source financial account is reached through an explicit A3 binding and WalletAccount/LedgerAccount chain.
- The external destination is represented by an approved, customer-owned, verified bank-account target; its display name, destination identifier, bank code, beneficiary reference, or provider reference is not canonical internal identity.
- The internal withdrawal ID, payment reference, A6 external-operation ID, provider idempotency key, provider transaction/reference ID, callback event ID, settlement ID, journal ID, outbox ID, and reconciliation discrepancy ID remain separate values.
- Provider-to-internal mapping is explicit, immutable for the operation, partner-scoped, and repairable only through a controlled A6/A3/Ledger/Finance boundary as applicable.

### 7.3 Financial and settlement assumptions

- All amounts remain positive integer minor units with explicit NGN currency and explicit accounting unit.
- A provider acknowledgement is not a settlement entry.
- A verified provider outcome still requires internal Ledger account, balance, journal, line, currency, accounting-unit, and idempotency validation.
- Unmatched, delayed, disputed, partially verified, or ambiguous provider outcomes enter pending, unknown, suspense, manual-review, or reconciliation states.
- Ledger/Finance owns settlement and suspense account dimensions, posting, reversals, and compensating entries.
- No A6 record, callback, report, or suspense row becomes a second financial source of truth.

### 7.4 Security, privacy, and operational assumptions

- Provider credentials, certificates, signing keys, callback secrets, and tokens are supplied only through an approved secret/configuration boundary and never stored in the repository.
- Provider payloads contain only approved minimum fields and are redacted/classified in logs, audit, outbox, diagnostics, and support views.
- A2 protects internal command, callback, support, configuration, and recovery access; provider authentication does not replace A2 authorization.
- Operations owns audit, idempotency, outbox, metrics, diagnostics, readiness, retention, and request context.
- Reconciliation is independent and read-only; it cannot repair or authorize settlement.
- A provider outage, callback replay, status-query failure, or ambiguous response stops or holds new external activity rather than causing blind retry or optimistic success.

## 8. Stop conditions

A6 implementation and any later controlled external evaluation must stop when:

- The selected partner, rail, direction, currency, capability, or provider interface is not explicit and versioned.
- A2 authorization, protected ingress, service audience, privileged approval, or security context is missing, denied, stale, or mis-scoped.
- A4 policy is missing, expired, pending review, denied, suspended, superseded, integrity-mismatched, or unavailable.
- A3 internal binding/account ownership, WalletAccount, LedgerAccount, currency, accounting-unit, or control state is missing, stale, repair-required, closed, suspended, incompatible, or unresolved by reconciliation.
- The external target or funding instrument is not explicitly owned, verified, current, purpose-compatible, consented, or mapped to the selected partner.
- Provider credentials, signing/authentication, callback authenticity, environment, endpoint, schema, or key-rotation evidence cannot be established safely.
- Internal or provider idempotency, request hash, external-operation identity, provider reference, or correlation evidence is missing or conflicting.
- A provider response/callback/report cannot be authenticated, mapped, verified, or independently reconciled.
- A timeout, outage, callback replay, status-query failure, or ambiguous result cannot be placed in a durable pending/recovery/manual-review/reconciliation state.
- Settlement/suspense account configuration, Ledger invariants, currency/accounting-unit checks, or financial correction ownership is unavailable.
- Audit, outbox, idempotency, metrics, diagnostics, readiness, retention, or support evidence cannot be persisted or safely exposed.
- Reconciliation reports a missing, duplicate, orphan, amount/currency/account mismatch, unresolved suspense, stale provider report, or unexplained external outcome.
- A proposed change would edit posted Ledger history, completed A5 history, Customer/A3 source records, or provider evidence to make a flow pass.
- A proposed change introduces a second partner, second direction, FX, fees, notifications, public APIs, product expansion, or A7/A8 work.

The safe response is to deny or hold new external operations, preserve the available evidence, disable/circuit-break the selected capability, and escalate to the owning boundary. It is never to weaken a gate, infer an identity, retry an ambiguous outcome with a new key, or edit source history.

## 9. Rollback and disable assumptions

A6T01 does not implement a rollback mechanism. It records the required boundary for later A6 tasks:

| Condition                                    | Safe control                                                                                                      | History rule                                                                                                       | Recovery owner/boundary                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Partner capability disabled or not certified | Keep the selected A6 capability unavailable; do not submit outbound requests.                                     | Preserve all existing A5, Ledger, Operations, and customer metadata history.                                       | Operations/A2/Product or release owner under approved control.     |
| Provider outage, timeout, or circuit open    | Stop new submissions or hold them in a durable external-operation pending/recovery state.                         | Do not mark a provider operation failed or settled without evidence.                                               | Operations/A6 adapter owner with Reconciliation/Ledger escalation. |
| Callback authenticity/replay failure         | Reject or quarantine the callback and preserve safe receipt metadata.                                             | Do not advance operation or financial state from the invalid callback.                                             | A2 Security and A6 callback boundary.                              |
| Provider reference or statement mismatch     | Hold settlement and create a controlled reconciliation discrepancy.                                               | Do not mutate journal, balance, customer, beneficiary, or provider source history.                                 | Reconciliation/Finance/Ledger with A6 partner owner.               |
| Unmatched external value                     | Use approved Ledger suspense/manual-review path only after A6T08 defines it.                                      | Do not auto-clear, credit, debit, or rewrite posted value.                                                         | Finance/Ledger and named exception owner.                          |
| Code/configuration rollback                  | Disable new external admission and verify compatibility with any later A6 schema/lifecycle state before rollback. | Preserve immutable operation, callback, provider, settlement, journal, audit, outbox, and reconciliation evidence. | Release/Operations with A6 owner.                                  |
| A5 internal pilot rollback                   | Use existing A5 disable/kill-switch boundary.                                                                     | Never use external rollback to rewrite completed A5 internal history.                                              | A5 Operations/Ledger/Reconciliation owners.                        |

A6 rollback is admission and external-operation control, not deletion or editing of financial history. Any approved financial correction remains a Ledger/Finance compensating-entry decision.

## 10. Prohibited capability and compatibility register

### 10.1 Prohibited capability edges

- External deposits, wallet funding, virtual-account activation, mobile money, cash agents, cards, QR, direct debit, payroll, savings, credit, or any product not selected by A6T01.
- Cross-currency settlement, FX, rates, fees, commissions, taxes, pricing, or hidden second financial effects.
- Multiple providers, provider failover routing, partner marketplace behavior, or broad adapter generalization beyond the selected capability.
- Customer-facing activation, public APIs, mobile/web channels, notifications, background jobs, or general customer messaging.
- Automated AML, sanctions, fraud, PEP, transaction monitoring, screening, or risk scoring.
- Provider-driven customer/account creation, binding repair, account reassignment, or policy/source mutation.

### 10.2 Compatibility classification

| Existing surface                                        | Compatibility treatment for selected A6 capability                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WithdrawalService` and `Withdrawal`                    | Internal withdrawal lifecycle and Ledger compatibility input. It is not external-operation state and must not be treated as provider-settled without A6 evidence. |
| `DepositService` and `Deposit`                          | Internal settlement lifecycle compatibility input only. It is not an external funding or callback boundary.                                                       |
| `TransferService` and A5 transfer lifecycle             | Internal customer-to-customer flow and A5 authority. It remains provider-free and must not be modified for A6T01.                                                 |
| `WalletService`/`WalletAccount`                         | Ledger-backed wallet facade and explicit account input. No external balance or provider account authority.                                                        |
| `LedgerService`/Ledger tables                           | Sole financial authority. Later settlement/suspense behavior must use it and preserve immutability.                                                               |
| `SettlementAccountService`                              | Existing Ledger settlement-account lookup compatibility input. It does not establish provider settlement finality or suspense workflow.                           |
| `BankService`/`Bank`                                    | Local bank-directory compatibility input. No provider transport or NIBSS truth.                                                                                   |
| `CustomerFundingInstrumentService`                      | Customer-owned metadata/verification compatibility input. No raw provider credential or external-operation authority.                                             |
| `CustomerBeneficiaryService`                            | Preferred customer-owned external-target metadata candidate, subject to A6T04. No provider ownership/finality authority.                                          |
| Legacy `BeneficiaryService`                             | Compatibility overlap requiring explicit future A6 disposition. No silent use as external-target authority.                                                       |
| `PaymentReferenceService`                               | Internal payment-reference authority. Payment references remain distinct from provider references and Ledger journals.                                            |
| A2 authorization/route services                         | Runtime access authority. Existing route presence is not A6 exposure.                                                                                             |
| A3 binding/read/reconciliation services                 | Internal customer/account authority. A6 cannot infer or repair bindings.                                                                                          |
| A4 policy/recovery services                             | Policy authority. Existing internal-transfer policy is not an external-settlement policy.                                                                         |
| Operations audit/idempotency/outbox/metrics/diagnostics | Shared operational authorities. No A6-local substitutes.                                                                                                          |
| Existing Reconciliation services                        | Independent internal financial control. A6 later adds external evidence without making reconciliation a writer.                                                   |

## 11. A6 implementation dependency order

A6T01 assigns the following later implementation responsibilities without starting them:

| Later task | Baseline dependency from A6T01                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A6T02      | The selected NIBSS/NIP capability requires an adapter contract, normalized provider fields, response trust rules, and fixture boundary.            |
| A6T03      | The selected capability requires isolated bank/NIBSS transport, environment configuration, credential/signing references, and safe error handling. |
| A6T04      | The outbound bank target requires a verified customer-owned target/funding-instrument mapping and explicit internal account chain.                 |
| A6T05      | The provider boundary requires distinct external-operation identity, provider idempotency, references, request hashes, and correlation.            |
| A6T06      | The selected rail requires callback/status/report authenticity, replay protection, reference validation, and safe receipt behavior.                |
| A6T07      | External side effects require durable lifecycle, bounded retry, timeout, circuit-breaker, status verification, and unknown-outcome recovery.       |
| A6T08      | Verified external outcomes require Ledger settlement, suspense, exception ownership, and compensating-entry boundaries.                            |
| A6T09      | Provider and internal financial evidence require independent external reconciliation, certification fixtures, and support trace.                   |
| A6T10      | Provider data exchange requires field minimization, consent/mandate, retention, legal-hold, secret, and disclosure controls.                       |
| A6T11      | A6 needs complete selected-flow integration, certification, rollback, disable, route, support, and A7-handoff evidence before phase exit.          |

No later task may use A6T01 as evidence that an external provider is connected, certified, active, or financially reliable.

## 12. A6T01 validation record

- [x] Existing Wallet, Ledger, Transfer, Withdrawal, Deposit, Payment, Bank, Beneficiary, Funding-Instrument, Virtual-Account, Operations, Outbox, A2, A3, A4, and Reconciliation boundaries were reviewed.
- [x] One bounded external capability was selected: NGN NIBSS/NIP outbound customer-wallet settlement to a verified Nigerian bank-account target.
- [x] Existing internal financial behavior was classified as compatibility input rather than silently declared an external partner boundary.
- [x] Authoritative ownership is recorded for Customer identity, Wallet, Ledger, A2, A3, A4, partner connectivity, external operations, callbacks, settlement, suspense, reconciliation, audit, idempotency, outbox, and recovery.
- [x] External partner, provider-reference, callback, settlement, suspense, reconciliation, certification, privacy, and consent gaps are assigned to later A6 tasks.
- [x] Certification assumptions, stop conditions, rollback/disable assumptions, prohibited edges, risks, dependencies, and compatibility boundaries are documented.
- [x] A6 scope is explicitly separated from A5 internal transfer behavior and from A7/A8 work.
- [x] No application source, entity, migration, service, controller, API, route, scheduler, provider integration, credential, settlement behavior, financial behavior, or runtime activation was changed.

### Evidence limitations

- This baseline reviews committed source, migrations, architecture inventories, and completed A1-A5 planning/handoff artifacts; it does not call a partner, query live provider systems, inspect live customer/bank data, certify NIBSS, or verify settlement availability.
- The NIBSS/NIP selection is a bounded planning assumption based on the repository's bank-directory `nipSupported` metadata and the A6 architecture boundary; it is not evidence of a NIBSS contract, bank participation, endpoint, credential, certification, or production readiness.
- Existing Withdrawal/Deposit settlement behavior is internal Ledger behavior only. It does not prove external settlement, callback authenticity, provider reliability, suspense ownership, or external reconciliation.
- A6T02-A6T11 must define, implement, test, and gate the external capability before any external operation or financial settlement is considered.
