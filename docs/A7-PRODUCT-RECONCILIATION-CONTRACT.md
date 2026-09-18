# A7 Product Reconciliation, Certification, and Support Trace Contract

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T09 — Independent Product Reconciliation, Certification, and Support Trace
- **Status:** Implemented (architecture-bound, read-only)
- **Type:** Runtime control, reconciliation, and support implementation
- **ADR inputs:** ADR-0005, ADR-0008, ADR-0050, ADR-0053, and the proposed A7 range
- **Source planning documents:** [`docs/A7-IMPLEMENTATION-PLAN.md`](A7-IMPLEMENTATION-PLAN.md) §8 A7T09; [`docs/A6-EXTERNAL-RECONCILIATION-CONTRACT.md`](A6-EXTERNAL-RECONCILIATION-CONTRACT.md); [`docs/ADR/ADR-0053-Independent-External-Reconciliation.md`](ADR/ADR-0053-Independent-External-Reconciliation.md)

This document is the A7 product reconciliation contract. It creates no application source beyond the read-only A7 product reconciliation service, types, constants, repository, and module; no entity, migration, controller, API, route, scheduler, notification dispatcher, public channel, product, financial behavior, or runtime activation is created by this contract.

## 1. Official task title

**A7T09 — Independent Product Reconciliation, Certification, and Support Trace**

The A7 product reconciliation service is the single A7-side read-only reconciliation, certification, and support-trace authority. The A7 product reconciliation service composes the existing A2 / A3 / A4 / A5 / A6 / A7 / Operations authorities (reused as-is, without modification) under the A7 product reconciliation envelope and produces discrepancy reports, classified support traces, and certification evidence for the first selected product (`VIRTUAL_ACCOUNT` v1).

## 2. Reference and identity contracts

### 2.1 Reference prefixes

The A7 product reconciliation reference namespaces (frozen):

```text
a7-product-reconciliation          (canonical reconciliation reference)
a7-product-reconciliation-batch   (batch reconciliation reference)
a7-product-support-trace          (support trace reference)
a7-product-certification          (certification fingerprint reference)
a7-product-reconciliation-handoff (handoff envelope reference)
```

### 2.2 Contract identity

The A7 product reconciliation contract is the runtime read-only reconciliation, certification, and support-trace contract for the A7 first product. The contract name and version are frozen:

```text
A7-PRODUCT-RECONCILIATION v1
```

The A7 product reconciliation contract does NOT generate or maintain a separate A7 product reconciliation product identity, product capability identity, or product state identity; the A7 product reconciliation contract reuses the A7 product catalog (A7T02), the A7 product-policy profile (A7T03), the A7T04 product customer-binding map, the A7T05 product command/operation identity, the A7T07 product lifecycle, the A6T05 external-operation identity, the A6T08 settlement / suspense / compensating-entry identity, the A5 Ledger journal identity, and the shared Operations audit / idempotency / outbox / metrics identities.

### 2.3 Contract reference

The A7 product reconciliation contract reference document is:

```text
docs/A7-PRODUCT-RECONCILIATION-CONTRACT.md
```

## 3. Objectives

1. Provide an independent read-only product reconciliation authority that compares product commands, A6 partner responses, callbacks, statements/reports, product operations, settlement / suspense, Ledger journals, audit, outbox, and internal lifecycle evidence without repairing source records.
2. Provide a deterministic discrepancy classification vocabulary for missing/duplicate/mismatched product operations, callback replay, orphan product operations, missing/duplicate settlement, amount/currency mismatch, stale reports, suspense aging, partner outage, and unresolved unknown outcomes.
3. Provide a classified support trace containing canonical internal IDs, partner/provider references, product operation, callback, settlement, journal, suspense, audit, outbox, and reconciliation references.
4. Provide product certification evidence for the first selected product across happy path, rejection, duplicate, callback replay, delayed report, outage, timeout, settlement mismatch, suspense, and rollback cases.
5. Preserve the A6T09 external reconciliation, A5 Ledger, A6T08 settlement, A4 product-policy, A2 authorization, A3 binding, A7T05 product command, A7T07 product lifecycle, A7T04 product customer-binding, and the shared Operations audit / idempotency / outbox / metrics authorities as-is. The A7 product reconciliation contract does NOT introduce a second reconciliation engine, a second Ledger authority, a second settlement authority, a second suspense authority, a second compensating-entry authority, a second financial-invariants engine, a second audit authority, a second idempotency authority, a second outbox authority, a second metrics authority, a second diagnostics authority, a second customer-binding authority, a second policy authority, a second authorization authority, a second notification authority, a new product identity, or a new product financial identity.

## 4. Reconciliation, certification, and support-trace vocabulary

### 4.1 Reconciliation check vocabulary

The A7 product reconciliation check vocabulary is a read-only product reconciliation vocabulary. The vocabulary extends, but does NOT replace, the A6T09 external reconciliation discrepancy vocabulary. The A6T09 external reconciliation authority remains the only external reconciliation authority. The A7 product reconciliation vocabulary is a product-side correlation vocabulary that the A7 product reconciliation service records alongside the A6T09 external reconciliation discrepancies inside the A7 product reconciliation report payload.

```text
PRODUCT_OPERATION_PRESENT
PRODUCT_OPERATION_KEY_CONSISTENT
PRODUCT_OPERATION_CAPABILITY_CONSISTENT
PRODUCT_OPERATION_AMOUNT_CONSISTENT
PRODUCT_OPERATION_CURRENCY_CONSISTENT
PRODUCT_OPERATION_ACCOUNTING_UNIT_CONSISTENT
PRODUCT_OPERATION_STATE_CONSISTENT
PRODUCT_LIFECYCLE_VERIFIED
PRODUCT_COMMAND_PRESENT
PRODUCT_COMMAND_AMOUNT_CONSISTENT
PRODUCT_COMMAND_CURRENCY_CONSISTENT
PRODUCT_COMMAND_ACCOUNTING_UNIT_CONSISTENT
PRODUCT_COMMAND_BINDING_CONSISTENT
PRODUCT_CUSTOMER_BINDING_PRESENT
PRODUCT_CUSTOMER_BINDING_ACTIVE
PRODUCT_CUSTOMER_BINDING_AMOUNT_CONSISTENT
PRODUCT_CUSTOMER_BINDING_CURRENCY_CONSISTENT
PRODUCT_CUSTOMER_BINDING_ACCOUNTING_UNIT_CONSISTENT
A2_AUTHORIZATION_PRESENT
A2_AUTHORIZATION_NOT_EXPIRED
A4_PRODUCT_POLICY_DECISION_PRESENT
A4_PRODUCT_POLICY_DECISION_NOT_EXPIRED
A4_PRODUCT_POLICY_DECISION_EXECUTABLE
A5_LEDGER_JOURNAL_CORRELATION_CONSISTENT
A5_LEDGER_JOURNAL_BALANCE_CONSISTENT
A5_LEDGER_REVERSAL_CONSISTENT
A6_EXTERNAL_OPERATION_PRESENT
A6_EXTERNAL_OPERATION_PARTNER_CONSISTENT
A6_EXTERNAL_OPERATION_CAPABILITY_CONSISTENT
A6_EXTERNAL_OPERATION_LIFECYCLE_VERIFIED
A6_CALLBACK_RECEIPT_PRESENT
A6_CALLBACK_RECEIPT_AUTHENTIC
A6_CALLBACK_RECEIPT_UNIQUE
A6_CALLBACK_RECEIPT_AMOUNT_CONSISTENT
A6_CALLBACK_RECEIPT_CURRENCY_CONSISTENT
A6_SETTLEMENT_PRESENT
A6_SETTLEMENT_AMOUNT_CONSISTENT
A6_SETTLEMENT_CURRENCY_CONSISTENT
A6_SETTLEMENT_ACCOUNTING_UNIT_CONSISTENT
A6_SUSPENSE_PRESENT
A6_SUSPENSE_AMOUNT_CONSISTENT
A6_SUSPENSE_CURRENCY_CONSISTENT
A6_SUSPENSE_ACCOUNTING_UNIT_CONSISTENT
A6_SUSPENSE_AGING_CONSISTENT
A6_PROVIDER_REFERENCE_PRESENT
A6_PROVIDER_REFERENCE_UNIQUE
A6_PARTNER_OUTAGE_NONE
A6_REPORT_AVAILABLE
NOTIFICATION_DISPATCH_FACT_PRESENT
NOTIFICATION_DISPATCH_AUDIENCE_CONSISTENT
NOTIFICATION_DISPATCH_DELIVERY_LIFECYCLE_CONSISTENT
NOTIFICATION_DISPATCH_REDACTION_CONSISTENT
OPERATIONS_AUDIT_FACT_PRESENT
OPERATIONS_AUDIT_CORRELATION_CONSISTENT
OPERATIONS_IDEMPOTENCY_RECORD_PRESENT
OPERATIONS_IDEMPOTENCY_HASH_CONSISTENT
OPERATIONS_OUTBOX_FACT_PRESENT
OPERATIONS_OUTBOX_CORRELATION_CONSISTENT
OPERATIONS_DIAGNOSTICS_FACT_PRESENT
```

### 4.2 Discrepancy classification vocabulary

The A7 product reconciliation discrepancy classification is a deterministic, severity-classified vocabulary. Each discrepancy carries an owner, a recovery state, and a message. The A7 product reconciliation discrepancy classification vocabulary extends, but does NOT replace, the A6T09 external reconciliation discrepancy vocabulary. The A7 product reconciliation discrepancy classification vocabulary is recorded alongside the A6T09 external reconciliation discrepancy classification inside the A7 product reconciliation report payload.

```text
A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_OPERATION
A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_LIFECYCLE
A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_COMMAND
A7_PRODUCT_RECONCILIATION_MISSING_PRODUCT_CUSTOMER_BINDING
A7_PRODUCT_RECONCILIATION_MISSING_A2_AUTHORIZATION
A7_PRODUCT_RECONCILIATION_MISSING_A4_PRODUCT_POLICY_DECISION
A7_PRODUCT_RECONCILIATION_MISSING_A5_LEDGER_JOURNAL
A7_PRODUCT_RECONCILIATION_MISSING_A6_EXTERNAL_OPERATION
A7_PRODUCT_RECONCILIATION_MISSING_A6_CALLBACK_RECEIPT
A7_PRODUCT_RECONCILIATION_MISSING_A6_SETTLEMENT
A7_PRODUCT_RECONCILIATION_MISSING_A6_SUSPENSE
A7_PRODUCT_RECONCILIATION_MISSING_A6_PROVIDER_REFERENCE
A7_PRODUCT_RECONCILIATION_MISSING_NOTIFICATION_DISPATCH_FACT
A7_PRODUCT_RECONCILIATION_MISSING_OPERATIONS_AUDIT_FACT
A7_PRODUCT_RECONCILIATION_MISSING_OPERATIONS_IDEMPOTENCY_RECORD
A7_PRODUCT_RECONCILIATION_MISSING_OPERATIONS_OUTBOX_FACT
A7_PRODUCT_RECONCILIATION_MISSING_OPERATIONS_DIAGNOSTICS_FACT
A7_PRODUCT_RECONCILIATION_MISSING_A6_REPORT
A7_PRODUCT_RECONCILIATION_DUPLICATE_PRODUCT_OPERATION
A7_PRODUCT_RECONCILIATION_DUPLICATE_PRODUCT_COMMAND
A7_PRODUCT_RECONCILIATION_DUPLICATE_A6_CALLBACK_RECEIPT
A7_PRODUCT_RECONCILIATION_DUPLICATE_A6_SETTLEMENT
A7_PRODUCT_RECONCILIATION_DUPLICATE_A6_PROVIDER_REFERENCE
A7_PRODUCT_RECONCILIATION_DUPLICATE_NOTIFICATION_DISPATCH_FACT
A7_PRODUCT_RECONCILIATION_DUPLICATE_OPERATIONS_AUDIT_FACT
A7_PRODUCT_RECONCILIATION_DUPLICATE_OPERATIONS_OUTBOX_FACT
A7_PRODUCT_RECONCILIATION_ORPHAN_PRODUCT_OPERATION
A7_PRODUCT_RECONCILIATION_ORPHAN_A6_SETTLEMENT
A7_PRODUCT_RECONCILIATION_ORPHAN_A6_SUSPENSE
A7_PRODUCT_RECONCILIATION_ORPHAN_A6_CALLBACK_RECEIPT
A7_PRODUCT_RECONCILIATION_ORPHAN_NOTIFICATION_DISPATCH_FACT
A7_PRODUCT_RECONCILIATION_AMOUNT_MISMATCH
A7_PRODUCT_RECONCILIATION_CURRENCY_MISMATCH
A7_PRODUCT_RECONCILIATION_ACCOUNTING_UNIT_MISMATCH
A7_PRODUCT_RECONCILIATION_BINDING_MISMATCH
A7_PRODUCT_RECONCILIATION_CAPABILITY_MISMATCH
A7_PRODUCT_RECONCILIATION_PARTNER_KEY_MISMATCH
A7_PRODUCT_RECONCILIATION_LIFECYCLE_NOT_VERIFIED
A7_PRODUCT_RECONCILIATION_LIFECYCLE_FAILED
A7_PRODUCT_RECONCILIATION_LIFECYCLE_CANCELLED
A7_PRODUCT_RECONCILIATION_LIFECYCLE_TERMINAL
A7_PRODUCT_RECONCILIATION_A2_AUTHORIZATION_EXPIRED
A7_PRODUCT_RECONCILIATION_A4_PRODUCT_POLICY_DECISION_EXPIRED
A7_PRODUCT_RECONCILIATION_A4_PRODUCT_POLICY_DECISION_NOT_EXECUTABLE
A7_PRODUCT_RECONCILIATION_A5_LEDGER_JOURNAL_BALANCE_MISMATCH
A7_PRODUCT_RECONCILIATION_A5_LEDGER_JOURNAL_CORRELATION_MISMATCH
A7_PRODUCT_RECONCILIATION_A5_LEDGER_REVERSAL_ORPHAN
A7_PRODUCT_RECONCILIATION_A5_LEDGER_REVERSAL_DUPLICATE
A7_PRODUCT_RECONCILIATION_A6_CALLBACK_RECEIPT_AMOUNT_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_CALLBACK_RECEIPT_CURRENCY_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_CALLBACK_RECEIPT_REFERENCE_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_CALLBACK_REPLAY
A7_PRODUCT_RECONCILIATION_A6_CALLBACK_AUTHENTICITY_REJECTED
A7_PRODUCT_RECONCILIATION_A6_SETTLEMENT_AMOUNT_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_SETTLEMENT_CURRENCY_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_SETTLEMENT_ACCOUNTING_UNIT_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_SETTLEMENT_NOT_POSTED
A7_PRODUCT_RECONCILIATION_A6_SUSPENSE_AMOUNT_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_SUSPENSE_CURRENCY_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_SUSPENSE_ACCOUNTING_UNIT_MISMATCH
A7_PRODUCT_RECONCILIATION_A6_SUSPENSE_AGED
A7_PRODUCT_RECONCILIATION_A6_PARTNER_OUTAGE
A7_PRODUCT_RECONCILIATION_A6_REPORT_STALE
A7_PRODUCT_RECONCILIATION_A6_REPORT_UNAVAILABLE
A7_PRODUCT_RECONCILIATION_NOTIFICATION_DISPATCH_AUDIENCE_MISMATCH
A7_PRODUCT_RECONCILIATION_NOTIFICATION_DISPATCH_REDACTION_FAILED
A7_PRODUCT_RECONCILIATION_NOTIFICATION_DISPATCH_DELIVERY_LIFECYCLE_BROKEN
A7_PRODUCT_RECONCILIATION_IDEMPOTENCY_HASH_MISMATCH
A7_PRODUCT_RECONCILIATION_OUTBOX_PAYLOAD_MISMATCH
A7_PRODUCT_RECONCILIATION_QUERY_UNAVAILABLE
```

### 4.3 Severity vocabulary

The A7 product reconciliation severity vocabulary is a frozen product-side vocabulary. Each discrepancy carries exactly one severity:

```text
WARNING  - controlled drift; product financial effect is preserved
ERROR    - mismatch that requires manual review
```

### 4.4 Owner vocabulary

The A7 product reconciliation owner vocabulary is a frozen product-side vocabulary. Each discrepancy carries exactly one owner. The A7 product reconciliation owner vocabulary is a product-side classification vocabulary that assigns the discrepancy to the canonical authority that owns the underlying control:

```text
RECONCILIATION
FINANCE
SECURITY
PARTNER_OWNER
WALLET
OPERATIONS
NOTIFICATION
LIFECYCLE
```

### 4.5 Recovery state vocabulary

The A7 product reconciliation recovery state vocabulary is a frozen product-side vocabulary. Each discrepancy carries exactly one recovery state:

```text
NO_AUTOMATIC_REPAIR     - the discrepancy is reported; no automatic repair is performed
MANUAL_REVIEW_REQUIRED  - the discrepancy requires manual review by the owner
```

The A7 product reconciliation service never repairs source records.

### 4.6 Discrepancy severity mapping

The A7 product reconciliation service maps each A7 product reconciliation discrepancy to a deterministic severity:

```text
A2 authorization, A4 product-policy decision, A5 ledger journal, A6 settlement, A6 suspense, callback authenticity, callback replay, idempotency hash, outbox payload, lifecycle terminal  -> ERROR
amount, currency, accounting unit, binding, capability, partner key, customer/account, notification redaction  -> ERROR
duplicate, orphan, missing record, stale report, unavailable report, partner outage, suspense aging, lifecycle not verified  -> WARNING or ERROR per the discrepancy code
```

### 4.7 Certification evidence vocabulary

The A7 product reconciliation certification evidence is a frozen product-side vocabulary that names the certification case:

```text
CERT_HAPPY_PATH
CERT_REJECTION
CERT_DUPLICATE
CERT_CALLBACK_REPLAY
CERT_DELAYED_REPORT
CERT_OUTAGE
CERT_TIMEOUT
CERT_SETTLEMENT_MISMATCH
CERT_SUSPENSE
CERT_ROLLBACK
```

The A7 product reconciliation certification evidence is recorded alongside the A6 partner certification evidence inside the A7 product certification report payload. The A6 partner certification authority remains the only A6 partner certification authority.

### 4.8 Support-trace sensitivity vocabulary

The A7 product reconciliation support-trace sensitivity vocabulary is a frozen product-side vocabulary that classifies the A7 product reconciliation support trace fields for the A1 data classification, retention, legal-hold, and support-access controls:

```text
PUBLIC         - non-sensitive A7 product reconciliation identifiers
INTERNAL       - canonical internal A7 product reconciliation references
CONFIDENTIAL   - canonical internal customer / account / amount reconciliation references
RESTRICTED     - canonical internal risk / compliance / unreplayed provider references
```

The A7 product reconciliation support-trace sensitivity vocabulary is a product-side classification vocabulary. The A1 data classification authority remains the only data classification authority. The A7 product reconciliation service does NOT introduce a new data classification authority.

## 5. Authorities and dependencies

The A7 product reconciliation contract reuses (without modification):

- A1 canonical ownership, identifier, privacy, retention, and cross-cutting contracts.
- A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts.
- A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts.
- A4 capability/action policy, limits, obligations, evidence snapshot, expiry, re-evaluation, and currentness contracts.
- A5 customer-aware command/correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns.
- A6 partner-adapter boundary, capability/version, callback, provider idempotency, settlement, suspense, external reconciliation, and external-rail data minimization.
- A7 product catalog (A7T02), A7 product-policy profile (A7T03), A7T04 product customer-binding map, A7T05 product command/operation identity, A7T07 product lifecycle, A7T06 product notification delivery, and A7T08 product financial effect.
- Operations AuditService, IdempotencyService, OutboxService, MetricsService, DiagnosticsService, request context, readiness, retention, and shutdown primitives.
- Independent Reconciliation and Finance verification patterns.

The A7 product reconciliation contract does NOT introduce a second reconciliation engine, a second Ledger authority, a second settlement authority, a second suspense authority, a second compensating-entry authority, a second financial-invariants engine, a second audit authority, a second idempotency authority, a second outbox authority, a second metrics authority, a second diagnostics authority, a second customer-binding authority, a second policy authority, a second authorization authority, a second notification authority, a new product identity, or a new product financial identity.

## 6. Architecture and boundaries

The A7 product reconciliation service MUST preserve the following boundaries:

1. The A7 product reconciliation service is the single A7-side read-only product reconciliation, certification, and support-trace authority. The A7 product reconciliation service does NOT mutate Customer, `CustomerPreference`, A3 binding, Wallet, Ledger, A5 transfer/deposit/withdrawal, A6 partner, A6T05 external-operation, A6T08 settlement, A6T08 suspense, A6T08 compensating-entry, A7 product catalog, A7 product-policy, A7T04 product customer-binding, A7T05 product command, A7T06 product notification delivery, A7T07 product lifecycle, A7T08 product financial effect, Operations audit, Operations idempotency, Operations outbox, Operations metrics, or Operations diagnostics records to make a report pass.
2. The A7 product reconciliation service is independent from the A6T09 external reconciliation authority. The A7 product reconciliation service queries the A6T09 external reconciliation discrepancy classification as a read-only consumer; the A7 product reconciliation service does NOT issue, refresh, or substitute the A6T09 external reconciliation report.
3. The A7 product reconciliation service runs in a REPEATABLE READ, read-only TypeORM transaction. The A7 product reconciliation service does NOT take any write locks, does NOT mutate any source record, does NOT post any journal, does NOT issue any settlement, does NOT issue any suspense, does NOT issue any compensating entry, does NOT dispatch any notification, does NOT call any partner, and does NOT mutate any A7 product lifecycle state.
4. The A7 product reconciliation service records the A7 product reconciliation report, support trace, and certification evidence through the shared Operations `AuditService` (read-only) and `DiagnosticsService` (read-only). The A7 product reconciliation service does NOT introduce a parallel audit authority, a parallel diagnostics authority, a parallel idempotency authority, a parallel outbox authority, or a parallel metrics authority.
5. The A7 product reconciliation service never auto-repairs a discrepancy. The A7 product reconciliation service always reports the discrepancy and assigns the discrepancy to the canonical owner. The A7 product reconciliation service never auto-clears suspense, never auto-posts a journal, and never auto-issues a settlement.
6. The A7 product reconciliation service never serves as a financial source of truth. The A5 `LedgerService` is the only financial value authority. The A6T08 `ExternalSettlementService` is the only settlement / suspense / compensating authority. The A2 `AuthorizationService` is the only A2 authorization authority. The A3 `CustomerFinancialAccountBindingService` is the only A3 binding authority. The A4 product-policy service is the only A4 product-policy authority. The A7 product catalog is the only A7 product catalog authority. The A7T04 product customer-binding service is the only A7T04 product customer-binding authority. The A7T05 product command service is the only A7T05 product command/operation authority. The A7T07 product lifecycle service is the only A7T07 product lifecycle authority. The A7T08 product financial effect service is the only A7T08 product financial effect authority. The A6T09 external reconciliation service is the only A6T09 external reconciliation authority.

## 7. Product certification contract

The A7 product reconciliation certification evidence is a frozen product-side vocabulary. The A7 product reconciliation certification evidence identifies the exact product, contract, and version, and is separate from production activation evidence. The A7 product reconciliation certification evidence records the A7 product reconciliation report, the A7 product reconciliation support trace, the A6T09 external reconciliation discrepancy classification (read-only), and the A1 data classification retention and legal-hold classification for each evidence field.

The A7 product reconciliation certification evidence is recorded inside the A7 product reconciliation report payload and is emitted only through the A7 product reconciliation read-only consumer boundary. The A7 product reconciliation certification evidence is not a public, customer-facing, or partner-facing evidence.

## 8. Acceptance criteria

- Reconciliation queries source tables and approved provider/report evidence independently of product command write methods, A6 partner write methods, and settlement write methods.
- A provider report or callback without a valid product operation, or an internal product settlement without valid provider evidence, is reported as a controlled discrepancy.
- Customer/account ownership, partner/capability mapping, product state, amount, currency, accounting-unit, status, reference, and journal mismatches are explicit.
- Duplicate, delayed, out-of-order, missing, or replayed product facts cannot create a second financial effect or be silently discarded.
- Reconciliation never updates Customer, preferences, A3 bindings, Wallet, Ledger, product, audit, outbox, policy, or source partner records to make a report pass.
- Support can trace the product operation without exposing secrets, raw callback signatures, full funding credentials, unrestricted risk/compliance data, or unnecessary customer data.
- Product certification evidence identifies the exact product/contract/version and is separate from production activation evidence.
- The A7 product reconciliation service runs in a REPEATABLE READ, read-only TypeORM transaction.
- The A7 product reconciliation service never repairs source records.

## 9. Explicitly out of scope

- Automatic source repair.
- Automatic suspense clearing.
- Provider-side correction.
- External dispute resolution.
- Production certification sign-off.
- Customer-facing reporting channels.
- Any A7T10 or A7T11 implementation.
- A7T08 product financial effect mutation.
- A7T07 product lifecycle mutation.
- A7T05 product command mutation.
- A7T04 product customer-binding mutation.
- A3 binding repair.
- A4 policy mutation.
- A2 authorization grant.
- A5 Ledger posting.
- A6T08 settlement, suspense, or compensating entry creation.
- A6 partner callback processing.
- A7T06 notification dispatch.
- Operations audit, idempotency, outbox, metrics, or diagnostics mutation.

## 10. Verification record

- [x] Contract name and version are frozen.
- [x] Reference prefixes are frozen.
- [x] Reconciliation check vocabulary is documented.
- [x] Discrepancy classification vocabulary is documented.
- [x] Severity, owner, and recovery-state vocabularies are documented.
- [x] Certification evidence vocabulary is documented.
- [x] Support-trace sensitivity vocabulary is documented.
- [x] No source-record mutation is performed.
- [x] No financial execution is performed.
- [x] No Ledger posting is performed.
- [x] No settlement is performed.
- [x] No callback processing is performed.
- [x] No notification dispatch is performed.
- [x] No lifecycle mutation is performed.
- [x] No auto-repair is performed.
- [x] A6T09 external reconciliation authority is reused as-is.
- [x] A5 Ledger authority is reused as-is.
- [x] A6T08 settlement / suspense / compensating authority is reused as-is.
- [x] A2 authorization authority is reused as-is.
- [x] A3 binding authority is reused as-is.
- [x] A4 product-policy authority is reused as-is.
- [x] A7T05 product command authority is reused as-is.
- [x] A7T07 product lifecycle authority is reused as-is.
- [x] A7T08 product financial effect authority is reused as-is.
- [x] Operations audit, idempotency, outbox, metrics, and diagnostics authorities are reused as-is.
