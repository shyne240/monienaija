# A7 Product Data Classification, Minimization, Consent, Retention, Secret, and Disclosure Contract

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T10 — Product Data Minimization, Consent, Classification, Retention, Secret, and Disclosure Controls
- **Status:** Implemented (architecture-bound, read-only with respect to A6T10)
- **Type:** Documentation, privacy, security, and runtime data-boundary implementation
- **ADR inputs:** ADR-0024, ADR-0052, and the proposed A7 range
- **Source planning documents:** [`docs/A7-IMPLEMENTATION-PLAN.md`](A7-IMPLEMENTATION-PLAN.md) §8 A7T10; [`docs/A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md`](A6-EXTERNAL-DATA-MINIMIZATION-AND-CONSENT-CONTRACT.md); [`docs/ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md`](ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md)

This document is the A7 product data classification, minimization, consent, retention, secret, and disclosure contract. It creates no application source beyond the A7 product data minimization service, types, constants, repository, and module; no entity, migration, controller, API, route, scheduler, notification dispatcher, public channel, product, financial behavior, or runtime activation is created by this contract.

## 1. Official task title

**A7T10 — Product Data Minimization, Consent, Classification, Retention, Secret, and Disclosure Controls**

The A7 product data minimization service is the single A7-side read-only data-control, classification, consent, retention, legal-hold, secret, disclosure, support-trace, and partner-payload contract. The A7 product data minimization service composes the existing A1 / A2 / A4 / A6T10 / `CustomerPreference` authorities (reused as-is, without modification) under the A7 product data minimization envelope and produces the A7 product data minimization report, the A7 product disclosure projection, the A7 product support-trace projection, and the A7 partner-payload validation result for the first selected product (`VIRTUAL_ACCOUNT` v1).

## 2. Reference and identity contracts

### 2.1 Reference prefixes

The A7 product data minimization reference namespaces (frozen):

```text
a7-product-data-minimization     (canonical contract reference)
a7-product-disclosure            (product disclosure projection reference)
a7-product-support-trace         (product support-trace projection reference)
a7-product-consent               (product consent assertion reference)
a7-product-legal-hold            (product legal-hold reference)
a7-product-retention             (product retention classification reference)
a7-product-secret                (product secret classification reference)
```

### 2.2 Contract identity

The A7 product data minimization contract is the runtime read-only data-control contract for the A7 first product. The contract name and version are frozen:

```text
A7-PRODUCT-DATA-MINIMIZATION v1
```

The A7 product data minimization contract reuses the A6T10 data classification registry (the only A6T10 data classification authority), the A6T10 consent authority (the only A6T10 consent authority), the A6T10 retention classification (the only A6T10 retention authority), the A6T10 legal-hold (the only A6T10 legal-hold authority), the A6T10 secret classification (the only A6T10 secret authority), the A6T10 disclosure projection (the only A6T10 disclosure authority), the A6T10 support-trace projection (the only A6T10 support-trace authority), the A6T10 partner-payload validation (the only A6T10 partner-payload validation authority), and the shared A1 `CustomerPreference.notifications` (the only customer intent authority).

### 2.3 Contract reference

The A7 product data minimization contract reference document is:

```text
docs/A7-PRODUCT-DATA-CLASSIFICATION-MATRIX.md
```

## 3. Objectives

1. Provide an A7 product data classification extension that registers the A7 first product's data fields in the A6T10 `ExternalDataClassificationRegistry` (the only data classification authority). The A7 product data minimization contract does NOT introduce a second data classification authority.
2. Provide an A7 product data minimization contract that consumes the A6T10 `ExternalDataMinimizationService` (the only A6T10 data minimization authority) read-only through the A6T10 consumer boundary. The A7 product data minimization contract does NOT introduce a second data minimization authority.
3. Provide an A7 product consent validation contract that consumes the A6T10 consent record (the only A6T10 consent authority) read-only through the A6T10 consumer boundary. The A7 product consent validation contract is distinct from the A2 authorization context, the A4 product-policy decision, and the A1 `CustomerPreference.notifications` intent. The A7 product data minimization contract does NOT introduce a second consent authority.
4. Provide an A7 product disclosure projection contract that consumes the A6T10 disclosure projection (the only A6T10 disclosure authority) read-only through the A6T10 consumer boundary. The A7 product disclosure projection never serves as a financial source of truth, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.
5. Provide an A7 product retention classification contract that registers the A7 first product's datasets in the A6T10 retention classification (the only A6T10 retention authority). The A7 product data minimization contract does NOT introduce a second retention authority.
6. Provide an A7 product legal-hold integration contract that consumes the A6T10 legal-hold (the only A6T10 legal-hold authority) read-only through the A6T10 consumer boundary. The A7 product data minimization contract does NOT introduce a second legal-hold authority.
7. Provide an A7 product secret handling contract that registers the A7 first product's secret categories in the A6T10 secret classification (the only A6T10 secret authority). The A7 product data minimization contract does NOT introduce a second secret authority.
8. Provide an A7 product support-trace data minimization contract that consumes the A6T10 support-trace projection (the only A6T10 support-trace authority) read-only through the A6T10 consumer boundary. The A7 product support-trace projection never serves as a financial source of truth, an A2 authorization, an A3 binding repair, an A4 policy decision, or a Ledger record.
9. Provide an A7 product payload validation contract that consumes the A6T10 partner-payload validation (the only A6T10 partner-payload validation authority) read-only through the A6T10 consumer boundary.
10. Provide an A7 product audit integration contract that consumes the shared Operations `AuditService` (the only A1 audit authority) read-only through the A1 consumer boundary. The A7 product data minimization contract does NOT introduce a second audit authority.
11. Provide an A7 product replay-safe behavior contract that consumes the shared Operations `IdempotencyService` (the only A1 idempotency authority) read-only through the A1 consumer boundary. The A7 product data minimization contract does NOT introduce a second idempotency authority.

## 4. Vocabulary

### 4.1 Product data handling level vocabulary (reused from A6T10)

The A7 product data minimization contract reuses the A6T10 data handling level vocabulary. The A6T10 data handling level vocabulary is the only A6T10 data handling level vocabulary. The A7 product data minimization contract does NOT introduce a new data handling level vocabulary:

```text
PUBLIC
INTERNAL
CONFIDENTIAL
RESTRICTED
HIGHLY_RESTRICTED
```

### 4.2 Product disclosure audience vocabulary (reused from A6T10)

The A7 product data minimization contract reuses the A6T10 disclosure audience vocabulary. The A6T10 disclosure audience vocabulary is the only A6T10 disclosure audience vocabulary. The A7 product data minimization contract does NOT introduce a new disclosure audience vocabulary:

```text
SUPPORT
OPERATIONS
RECONCILIATION
FINANCE
COMPLIANCE
LEGAL
SECURITY
A6_TEN_INTERNAL
```

### 4.3 Product consent purpose vocabulary

The A7 product consent purpose vocabulary is a frozen A7-side vocabulary that extends (but does NOT replace) the A6T10 consent purpose vocabulary. The A7 product consent purpose is the product-catalog product-purpose:

```text
PRODUCT_VIRTUAL_ACCOUNT_INBOUND_FUNDING
```

### 4.4 Product retention dataset vocabulary

The A7 product retention dataset vocabulary is a frozen A7-side vocabulary that names the A7 first product's data retention datasets. The A7 product retention datasets are registered with the A6T10 retention classification:

```text
A7_PRODUCT_OPERATION
A7_PRODUCT_COMMAND
A7_PRODUCT_LIFECYCLE
A7_PRODUCT_FINANCIAL_EFFECT
A7_PRODUCT_CUSTOMER_BINDING
A7_PRODUCT_NOTIFICATION_DELIVERY
A7_PRODUCT_DISCLOSURE
A7_PRODUCT_SUPPORT_TRACE
A7_PRODUCT_RECONCILIATION
```

### 4.5 Product legal-hold scope vocabulary

The A7 product legal-hold scope vocabulary is a frozen A7-side vocabulary that names the A7 first product's legal-hold scopes. The A7 product legal-hold scopes are registered with the A6T10 legal-hold authority:

```text
A7_PRODUCT_OPERATION
A7_PRODUCT_COMMAND
A7_PRODUCT_LIFECYCLE
A7_PRODUCT_FINANCIAL_EFFECT
A7_PRODUCT_CUSTOMER_BINDING
A7_PRODUCT_NOTIFICATION_DELIVERY
A7_PRODUCT_DISCLOSURE
A7_PRODUCT_SUPPORT_TRACE
A7_PRODUCT_RECONCILIATION
```

### 4.6 Product secret category vocabulary (reused from A6T10)

The A7 product data minimization contract reuses the A6T10 secret category vocabulary. The A6T10 secret category vocabulary is the only A6T10 secret category vocabulary. The A7 product data minimization contract does NOT introduce a new secret category vocabulary:

```text
PARTNER_CLIENT_AUTHENTICATION
PARTNER_REQUEST_SIGNING_KEY
CALLBACK_SECRET
CALLBACK_SIGNATURE
PRIVATE_KEY
CUSTOMER_PIN
CUSTOMER_OTP
DEVICE_FINGERPRINT_RAW
RISK_NARRATIVE_RAW
COMPLIANCE_CASE_RAW
```

### 4.7 Product data-minimization failure vocabulary

The A7 product data-minimization failure vocabulary is a frozen A7-side vocabulary that names the A7 product data-minimization failure reasons. The A7 product data-minimization failure vocabulary extends (but does NOT replace) the A6T10 data-minimization rejection vocabulary:

```text
A7_PRODUCT_DATA_MINIMIZATION_CLASSIFICATION_NOT_REGISTERED
A7_PRODUCT_DATA_MINIMIZATION_CONSENT_EXPIRED
A7_PRODUCT_DATA_MINIMIZATION_CONSENT_REVOKED
A7_PRODUCT_DATA_MINIMIZATION_CONSENT_PURPOSE_MISMATCH
A7_PRODUCT_DATA_MINIMIZATION_CONSENT_JURISDICTION_MISMATCH
A7_PRODUCT_DATA_MINIMIZATION_CONSENT_MISSING
A7_PRODUCT_DATA_MINIMIZATION_RETENTION_HOLD_ACTIVE
A7_PRODUCT_DATA_MINIMIZATION_RETENTION_BELOW_FLOOR
A7_PRODUCT_DATA_MINIMIZATION_HOLD_AUTHORITY_MISSING
A7_PRODUCT_DATA_MINIMIZATION_HOLD_NOT_FOUND
A7_PRODUCT_DATA_MINIMIZATION_SECRET_IN_RAW_PAYLOAD
A7_PRODUCT_DATA_MINIMIZATION_SECRET_IN_SUPPORT_TRACE
A7_PRODUCT_DATA_MINIMIZATION_DISCLOSURE_AUDIENCE_TOO_LOW
A7_PRODUCT_DATA_MINIMIZATION_DISCLOSURE_FIELD_NOT_REGISTERED
A7_PRODUCT_DATA_MINIMIZATION_DISCLOSURE_REJECTED_HIGHLY_RESTRICTED
A7_PRODUCT_DATA_MINIMIZATION_DISCLOSURE_BEYOND_LEGAL_HOLD
A7_PRODUCT_DATA_MINIMIZATION_PARTNER_PAYLOAD_REJECTED
A7_PRODUCT_DATA_MINIMIZATION_PARTNER_PAYLOAD_MISSING_FIELD
A7_PRODUCT_DATA_MINIMIZATION_INVALID_COMMAND
A7_PRODUCT_DATA_MINIMIZATION_QUERY_UNAVAILABLE
```

## 5. Authorities and dependencies

The A7 product data minimization contract reuses (without modification):

- A1 canonical ownership, identifier, privacy, retention, legal-hold, and cross-cutting contracts.
- A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts.
- A4 capability/action policy, limits, obligations, evidence snapshot, expiry, re-evaluation, and currentness contracts.
- A6T10 data classification, consent, retention, legal-hold, secret, disclosure, support-trace, and partner-payload validation authorities (reused from A6T10).
- A7 product catalog (A7T02), A7 product-policy profile (A7T03), A7T04 product customer-binding map, A7T05 product command/operation identity, A7T07 product lifecycle, A7T06 product notification delivery, A7T08 product financial effect, and A7T09 product reconciliation.
- `CustomerPreference` (including `NotificationPreference`) as the customer intent authority.
- Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, `DiagnosticsService`, request context, readiness, retention, and shutdown primitives.

The A7 product data minimization contract does NOT introduce a second data classification, consent, retention, legal-hold, secret, disclosure, support-trace, partner-payload validation, audit, idempotency, outbox, metrics, or diagnostics authority. The A6T10 data classification registry, the A6T10 `ExternalDataMinimizationService`, the A6T10 consent authority, the A6T10 retention classification, the A6T10 legal-hold authority, the A6T10 secret classification, and the A6T10 disclosure projection remain the only authorities in their respective domains.

## 6. Architecture and boundaries

The A7 product data minimization service MUST preserve the following boundaries:

1. The A7 product data minimization service is a read-only consumer of the A6T10 `ExternalDataMinimizationService`. The A7 product data minimization service does NOT mutate the A6T10 data classification registry, the A6T10 consent record, the A6T10 retention classification, the A6T10 legal-hold record, the A6T10 secret classification, the A6T10 disclosure projection, the A6T10 support-trace projection, the A6T10 partner-payload validation, the shared Operations `AuditService`, the shared Operations `IdempotencyService`, the shared Operations `OutboxService`, the shared Operations `MetricsService`, or the shared Operations `DiagnosticsService`.
2. The A7 product data minimization service registers A7 product fields in the A6T10 data classification registry only through the A6T10 `register()` consumer boundary (the A6T10 data classification registry is loaded as part of the A6T10 module boot, and the A7 product data minimization service accepts the A6T10 registry as a constructor-injected dependency). The A7 product data minimization service does NOT introduce a second data classification registry.
3. The A7 product data minimization service runs in a REPEATABLE READ, read-only TypeORM transaction. The A7 product data minimization service does NOT take any write locks, does NOT mutate any source record, does NOT post any journal, does NOT issue any settlement, does NOT issue any suspense, does NOT issue any compensating entry, does NOT dispatch any notification, does NOT call any partner, and does NOT mutate any A7 product lifecycle state.
4. The A7 product data minimization service never serves as a financial source of truth. The A5 `LedgerService` is the only financial value authority. The A6T08 `ExternalSettlementService` is the only settlement / suspense / compensating authority. The A2 `AuthorizationService` is the only A2 authorization authority. The A3 `CustomerFinancialAccountBindingService` is the only A3 binding authority. The A4 product-policy service is the only A4 product-policy authority. The A7 product catalog is the only A7 product catalog authority. The A7T04 product customer-binding service is the only A7T04 product customer-binding authority. The A7T05 product command service is the only A7T05 product command/operation authority. The A7T07 product lifecycle service is the only A7T07 product lifecycle authority. The A7T08 product financial effect service is the only A7T08 product financial effect authority. The A7T09 product reconciliation service is the only A7T09 product reconciliation authority. The A6T10 `ExternalDataMinimizationService` is the only A6T10 data minimization authority.
5. The A7 product data minimization service never auto-repairs, auto-clears, or auto-issues any data-control event. The A7 product data minimization service always reports the failure and assigns the failure to the canonical A6T10 owner.
6. The A7 product data minimization service never stores raw credentials, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, or unnecessary customer identity documents in the A7 product records, A7 product notification payloads, or A7 product observability.

## 7. Acceptance criteria

- The first product receives only approved fields for the selected capability, purpose, jurisdiction, and lifecycle state.
- Consent or mandate evidence is explicit, current, purpose-bound, revocable where applicable, and distinct from A2 authorization, A4 policy eligibility, and `CustomerPreference` intent.
- Raw credentials, PAN/account secrets, PINs, OTPs, callback signatures, private keys, raw risk/compliance notes, and unnecessary identity documents are excluded from general product records, notification payloads, and observability.
- Product payloads and external references are classified and retained according to the A6T10 / A7T10 matrix; ordinary cleanup cannot delete held evidence.
- Support, Operations, Reconciliation, and notification views use minimum necessary fields and approved audience controls.
- A product data-sharing, consent, or preference failure fails closed or enters a declared manual-review state; it never defaults to product transmission or notification dispatch.
- A7 does not create a new customer identity, consent, preference, product, compliance, risk, authorization, or notification authority.
- The A7 product data minimization service runs in a REPEATABLE READ, read-only TypeORM transaction.
- The A7 product data minimization service never mutates any A6T10 source record.
- The A7 product data minimization service is the single A7-side read-only product data minimization, classification, consent, retention, legal-hold, secret, disclosure, support-trace, and partner-payload validation authority.

## 8. Explicitly out of scope

- Auto-repair, auto-clearing, or auto-issuing of any A6T10 data-control event.
- Legal approval itself, customer portal/mobile disclosure screens, marketing consent.
- General data-platform redesign.
- A7T11 release-gate, A8 scale/extraction.
- Any notification delivery implementation (A7T06 owns delivery).
- A7T08 product financial effect mutation, A7T07 product lifecycle mutation, A7T05 product command mutation, A7T04 product customer-binding mutation, A7T09 product reconciliation mutation.
- A3 binding repair, A4 policy mutation, A2 authorization grant, A5 Ledger posting, A6T08 settlement / suspense / compensating entry creation, A6T09 external reconciliation mutation, A6T10 data classification registry mutation outside the read-only consumer boundary.
- A6 partner callback processing, A7T06 notification dispatch, A6T10 disclosure projection mutation.
- Operations audit, idempotency, outbox, metrics, or diagnostics mutation.

## 9. Verification record

- [x] Contract name and version are frozen.
- [x] Reference prefixes are frozen.
- [x] Product data handling level vocabulary is reused from A6T10.
- [x] Product disclosure audience vocabulary is reused from A6T10.
- [x] Product consent purpose vocabulary is registered with A6T10.
- [x] Product retention dataset vocabulary is registered with A6T10.
- [x] Product legal-hold scope vocabulary is registered with A6T10.
- [x] Product secret category vocabulary is reused from A6T10.
- [x] Product data-minimization failure vocabulary is documented.
- [x] No A6T10 source-record mutation is performed.
- [x] No financial execution is performed.
- [x] No Ledger posting is performed.
- [x] No settlement is performed.
- [x] No callback processing is performed.
- [x] No notification dispatch is performed.
- [x] No lifecycle mutation is performed.
- [x] No auto-repair is performed.
- [x] A6T10 data classification registry is reused as-is.
- [x] A6T10 `ExternalDataMinimizationService` is reused as-is.
- [x] A6T10 consent authority is reused as-is.
- [x] A6T10 retention classification is reused as-is.
- [x] A6T10 legal-hold authority is reused as-is.
- [x] A6T10 secret classification is reused as-is.
- [x] A6T10 disclosure projection is reused as-is.
- [x] A6T10 support-trace projection is reused as-is.
- [x] A6T10 partner-payload validation is reused as-is.
- [x] A2 authorization authority is reused as-is.
- [x] A3 binding authority is reused as-is.
- [x] A4 product-policy authority is reused as-is.
- [x] A7T04 product customer-binding authority is reused as-is.
- [x] A7T05 product command authority is reused as-is.
- [x] A7T07 product lifecycle authority is reused as-is.
- [x] A7T08 product financial effect authority is reused as-is.
- [x] A7T09 product reconciliation authority is reused as-is.
- [x] `CustomerPreference` intent authority is reused as-is.
- [x] Operations audit, idempotency, outbox, metrics, and diagnostics authorities are reused as-is.
