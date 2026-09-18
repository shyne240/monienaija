# ADR-0054 — Virtual Account Product Boundary

- **ADR ID:** ADR-0054
- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T02 — A7 Product Catalog and Product-Boundary Contract
- **Status:** Proposed A7 implementation decision; A7T02 contract design only, no A7 runtime catalog or product-boundary implementation
- **Date:** 2026-08-08
- **Scope:** A7 product catalog, product-boundary contract, first product frozen registration, A6 partner dependency declaration, compatibility rules, prohibited-dependency list, consumer contracts, versioning rules, and the catalog freeze for the A7T02 design
- **Authoritative boundary:** `ProductCatalogContractV1` (`A7-PRODUCT-CATALOG` v1) per [`docs/A7-PRODUCT-CATALOG-CONTRACT.md`](../A7-PRODUCT-CATALOG-CONTRACT.md)
- **Selected first product (frozen registration):** `VIRTUAL_ACCOUNT` v1 / `virtual-account.assign` and `virtual-account.inbound-funding` (lifecycle) / inbound / `NGN` / `CUSTOMER_FUNDS` / `BANK_ACCOUNT` / under the existing A6 `NIBSS_NIP` partner boundary (planning rail)
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, notification, product, financial-runtime, and A8 changes:** None

This ADR is the decision record for the A7T02 product-catalog and product-boundary contract. It records the catalog freeze, the first product's frozen registration, the A6 partner dependency declaration, the compatibility rules, the prohibited-dependency list, and the consumer contracts that govern how the A7 product catalog interacts with the shared A1–A6 authorities. It introduces no new runtime code, entity, migration, service, controller, API, route, scheduler, notification dispatcher, public surface, fee, commission, settlement, reconciliation, or A8 work.

## 1. Context

A7T01 established the first bounded A7 product (`VIRTUAL_ACCOUNT` v1, inbound, `NGN`, `CUSTOMER_FUNDS`, `BANK_ACCOUNT`, under the existing A6 `NIBSS_NIP` partner boundary) and recorded the A6 release-gate evidence, the A6 handoff entry conditions, the A7 product-adjacent gap register, and the A7 product-exclusion list. A7T01 is documentation-only and does not implement the A7 product catalog or the A7 product boundary.

A7T02 must define the A7 product catalog, the shared product-boundary contract, the product-extension points, the first product's frozen registration, the catalog's compatibility rules, and the consumer contracts that govern how the catalog interacts with the shared A1–A6 authorities. A7T02 must keep product-specific behavior outside Customer, A2, A3, A4, A5, A6, Wallet, Ledger, and Operations authorities.

The repository does not currently have an A7 product catalog, an A7 product-boundary contract, or an A7 product module. The A6 partner-adapter, callback, settlement, suspense, reconciliation, and data-minimization contracts are committed in A6T02–A6T11 and remain the A6 authority boundary.

## 2. Problem statement

A7 must add new financial products one at a time under the common A2 authorization, A3 binding, A4 policy, A5 internal lifecycle, A6 partner, Wallet, Ledger, Operations, and Reconciliation contracts. Without a shared product catalog and product-boundary contract, product-specific behavior would have to be implemented in each product module, and product-specific modules would have to reach into `virtual-account`, `payment`, `wallet`, `ledger`, `partner`, or other canonical modules to discover what they may do. That pattern would silently re-broaden A6, re-introduce competing source authorities, and make A7 release-gate evidence impossible to evaluate.

The A7 product catalog and product-boundary contract must therefore:

- provide one explicit product catalog and product-boundary contract that prevent product-specific behavior from becoming a source authority in Customer, Wallet, Ledger, A2, A3, A4, A5, A6, Operations, or Reconciliation;
- record the first product (`VIRTUAL_ACCOUNT` v1) as a single frozen registration with explicit dependency declaration, compatibility rules, prohibited adjacent products, and consumer contracts;
- declare the A6 partner dependency as a single, recorded boundary that reuses the A6 partner-adapter, callback, lifecycle, settlement, reconciliation, and data-minimization contracts without introducing a new partner, callback, settlement account, suspense account, reconciliation writer, or privacy authority;
- fail closed on any prohibited edge, second product, second partner, second authority, or unapproved capability;
- preserve A2 authorization, A3 binding, A4 policy, A5 internal lifecycle, A6 partner, Wallet, Ledger, Operations, and Reconciliation as separate authorities; and
- be deterministic, idempotent, sandbox/fixture-testable, and A8-exclusion-aware.

## 3. Decision

A7T02 freezes `A7-PRODUCT-CATALOG` v1 with the following decisions:

### 3.1 Product catalog and product-boundary contracts

- A7 introduces `ProductCatalogContractV1` and `ProductBoundaryContractV1` as the shared product catalog and product-boundary interface designs.
- `ProductCatalogContractV1` exposes `getRegistration`, `listRegistrations`, and `assertCompatible`. The catalog is read-only, deterministic, and idempotent.
- `ProductBoundaryContractV1` exposes `execute(request)` and `getCapabilities(query)`. The boundary is a contract design; A7T02 does not implement it.
- Domain modules consume the catalog and the boundary rather than reaching into `virtual-account`, `payment`, `wallet`, `ledger`, `partner`, or any other canonical module directly.

### 3.2 First product frozen registration

- The first product is `VIRTUAL_ACCOUNT` v1, the only ACTIVE entry in `A7-PRODUCT-CATALOG` v1.
- `VIRTUAL_ACCOUNT` v1 has two capabilities: `virtual-account.assign` and `virtual-account.inbound-funding`.
- `VIRTUAL_ACCOUNT` v1 is inbound only, `NGN` only, `CUSTOMER_FUNDS` only, `BANK_ACCOUNT` only, under the A6 `NIBSS_NIP` partner boundary (planning rail).
- `VIRTUAL_ACCOUNT` v1 has a closed product-state vocabulary (`ASSIGN_*` and `FUNDING_*` states) and a closed set of prohibitions (outbound settlement, virtual-account-to-virtual-account transfer, fees beyond the A6 partner contract, pricing, interest, lending, FX, second product, second partner, second product direction, QR/merchant, bills/airtime, agent/assisted, card, bulk/payroll, savings, credit, public surface, A8).

### 3.3 A6 partner dependency declaration

- `VIRTUAL_ACCOUNT` v1 depends on the A6 partner-adapter boundary (per ADR-0047) for transport, request signing, response authenticity, and capability mapping.
- `VIRTUAL_ACCOUNT` v1 depends on the A6T03 isolation/credential boundary (per ADR-0048) for the partner connection, environment separation, and reference-only credentials.
- `VIRTUAL_ACCOUNT` v1 depends on the A6T05 external operation identity (per ADR-0049) for the durable external-operation record, provider idempotency, and reference uniqueness.
- `VIRTUAL_ACCOUNT` v1 depends on the A6T06 callback boundary (per ADR-0049) for callback authenticity, replay protection, freshness, partner scope, dedupe, and idempotent processing.
- `VIRTUAL_ACCOUNT` v1 depends on the A6T07 lifecycle for the product lifecycle vocabulary, retry, circuit-breaker, and unknown-outcome recovery.
- `VIRTUAL_ACCOUNT` v1 depends on the A6T08 settlement boundary (per ADR-0050) for settlement, suspense, compensating entries, and immutable Ledger history.
- `VIRTUAL_ACCOUNT` v1 depends on the A6T09 reconciliation boundary (per ADR-0053) for independent read-only reconciliation and classified support trace.
- `VIRTUAL_ACCOUNT` v1 depends on the A6T10 data-classification matrix (per ADR-0052) for field-level classification, consent/mandate, retention, legal hold, secret, and disclosure controls.
- `VIRTUAL_ACCOUNT` v1 does not introduce a new partner, a new callback, a new settlement account, a new suspense account, a new reconciliation writer, or a new privacy authority.

### 3.4 Product-state vocabulary

- The first product's state vocabulary is the union of two capability-level lifecycle state sets: `ASSIGN_*` (request, pending, active, suspended, failed, closed) and `FUNDING_*` (requested, pending verification, settled, unknown, suspended, failed, closed).
- A product state is a product-lifecycle state. It is not a financial command, an A2 authorization, an A3 binding, an A4 policy decision, a Ledger journal, a customer intent, or a customer notification.
- A product state is not evidence of settlement. `FUNDING_SETTLED` requires the A6T08 / A7T08 settlement evidence to post the financial effect. A `FUNDING_SETTLED` product state without the A6T08 / A7T08 settlement evidence is invalid.
- A product state is not evidence of authorization. `ASSIGN_ACTIVE` requires the A2 authorization boundary. An `ASSIGN_ACTIVE` product state without A2 authorization is invalid.

### 3.5 Compatibility rules

- The first product's compatibility rules are FAIL_CLOSED on any prohibited edge: direction, currency, accounting unit, target type, A6 partner capability, A6 partner operation type, notification surface, public surface, and prohibited adjacent edges.
- A consumer that asks the catalog for an incompatible configuration receives a deterministic non-success result; the catalog MUST NOT silently allow a prohibited configuration.

### 3.6 Consumer contracts

- The catalog publishes a consumer contract for every authority that consumes the first product: A2 internal command owner, A3 binding read, A4 policy profile, A6 partner adapter, A5 lifecycle, A6T05 external operation, A6T06 callback, A6T07 lifecycle, A6T08 settlement, A6T09 reconciliation, A6T10 data minimization, product request context, support trace, and Operations (audit, idempotency, outbox, metrics, diagnostics).
- A consumer contract declares `reads`, `writes`, `reusesSharedAuthority`, and `mustNotDo`.
- A consumer contract MUST NOT introduce a new authority, a new partner, a new settlement account, a new suspense account, a new reconciliation writer, a new privacy authority, a new policy evaluator, a new preference store, a new funding-instrument store, a new beneficiary store, a new transfer lifecycle, or a new notification intent record.
- A consumer contract MUST NOT authorize, settle, bind, dispatch, or repair. The consumer reads from the catalog and from the shared authority; it does not own a new authority.

### 3.7 Prohibited dependencies and second-authority prohibitions

- The first product's registration declares prohibited dependencies on any new partner, any new policy evaluator, any new binding authority, any new wallet or ledger authority, any new settlement authority, any new suspense authority, any new reconciliation writer, any new privacy authority, any new customer intent/consent/preference/notification authority, any new audit/idempotency/outbox/metrics/diagnostics store, any new public/customer/partner/support surface, any new product/partner/capability/currency/accounting unit/direction beyond the catalog's frozen registration, and A8 Scale & Selective Extraction.
- The catalog rejects a consumer contract that depends on a prohibited authority.

### 3.8 Versioning and catalog freeze

- The catalog version is `A7-PRODUCT-CATALOG` v1. A patch revision may clarify documentation; a minor revision may add optional fields, optional capability metadata, optional consumer contracts, or a second frozen product; a major revision is required for any change to required fields, identity semantics, currency/accounting semantics, product-state vocabulary, compatibility-rule enforcement, prohibited-dependency list, or the first product's registration.
- A `DRAFT` entry MUST NOT be returned to A7 runtime consumers; it exists only for catalog evolution. A `RETIRED` entry MUST NOT be reactivated; a successor entry MUST be a new catalog entry under a new product version.
- The first product's registration is frozen at the A7T02 commit. A7T02 does not implement the catalog persistence. A7T11 records the implementation evidence.

## 4. Rationale

### 4.1 Why one explicit catalog and boundary

A single catalog and boundary make the product-external boundary auditable. A7T02 freezes the catalog and the boundary as a contract design; later A7 tasks consume the contract through the catalog and the consumer contracts. A second catalog, a second boundary, or a second product module that bypasses the catalog would re-introduce the same anti-pattern that A6T02 (the A6 partner-adapter contract) was designed to prevent.

### 4.2 Why one frozen first product

A7 §3.1 constrains the first product to a single bounded shape (`virtual-account.assign` and `virtual-account.inbound-funding` under the A6 partner boundary). A7T01 selected `VIRTUAL_ACCOUNT` v1 from the candidate matrix; A7T02 freezes that selection. A second product, a second partner, a second product direction, a new currency, or any other product expansion requires a new capability decision, a new ADR, and a new catalog version.

### 4.3 Why reuse the A6 partner boundary

`VIRTUAL_ACCOUNT` v1 depends on the A6 partner-adapter, A6T03 isolation/credential, A6T05 external operation, A6T06 callback, A6T07 lifecycle, A6T08 settlement, A6T09 reconciliation, and A6T10 data-minimization contracts. Reusing the A6 boundary preserves the A6 release-gate evidence, the A6 prohibition set, and the A6 partner-disabled-by-default contract. A7T02 does not introduce a new partner, a new callback, a new settlement account, a new suspense account, a new reconciliation writer, or a new privacy authority.

### 4.4 Why closed product-state vocabulary

A closed product-state vocabulary allows the catalog to support reconciliation, support trace, and audit through stable state references. An open vocabulary would allow product states to drift across catalog versions and would make A7T09 reconciliation ambiguous. The first product's state vocabulary is the union of two capability-level lifecycle state sets; a new state requires a new catalog version and a new ADR.

### 4.5 Why FAIL_CLOSED compatibility rules

A FAIL_CLOSED compatibility rule guarantees that a prohibited configuration cannot silently pass the catalog. The A7 release-gate evidence depends on the catalog's ability to fail closed on any prohibited edge. A relaxed compatibility rule is a new ADR; the catalog MUST NOT relax a rule without a new ADR.

### 4.6 Why consumer contracts

A consumer contract makes the A7 product catalog's interaction with the shared authorities explicit. A consumer contract declares `reads`, `writes`, `reusesSharedAuthority`, and `mustNotDo`. The catalog uses the consumer contract to reject a consumer that depends on a prohibited authority, a new authority, or a prohibited action.

### 4.7 Why prohibited dependencies

Prohibited dependencies are the catalog's authoritative source for the first product's prohibited edges. A later A7 task that wishes to relax a prohibition must propose a new ADR; the catalog MUST NOT relax a prohibition without a new ADR. The prohibitions cover all A7 §5 non-goals and all A6 handoff prohibited skip edges.

### 4.8 Why versioning and catalog freeze

Catalog versioning and freeze protect historical evidence. Every catalog lookup result identifies the catalog version and the catalog name that produced it; historical evidence remains interpretable under the version that produced it. A `DRAFT` entry exists only for catalog evolution; a `RETIRED` entry cannot be reactivated. The first product's registration is frozen at the A7T02 commit; A7T02 does not implement the catalog persistence.

## 5. Consequences

### 5.1 Positive

- A7 has one explicit product catalog and product-boundary contract that keep product-specific behavior outside canonical authorities.
- The first product `VIRTUAL_ACCOUNT` v1 is the only ACTIVE entry in `A7-PRODUCT-CATALOG` v1; the catalog cannot silently activate a second product.
- A6 partner, A6T05 external operation, A6T06 callback, A6T07 lifecycle, A6T08 settlement, A6T09 reconciliation, and A6T10 data-minimization contracts are reused; A7T02 does not introduce a new partner, callback, settlement account, suspense account, reconciliation writer, or privacy authority.
- A2 authorization, A3 binding, A4 policy, A5 internal lifecycle, Wallet, Ledger, Operations, and Reconciliation remain separate authorities; the catalog publishes a consumer contract for each.
- Compatibility rules are FAIL_CLOSED on any prohibited edge; the catalog cannot silently allow a prohibited configuration.
- The catalog is deterministic, idempotent, and sandbox/fixture-testable; the first product's registration is frozen at the A7T02 commit.
- A `DRAFT` entry exists only for catalog evolution; a `RETIRED` entry cannot be reactivated; a successor entry must be a new catalog entry under a new product version.

### 5.2 Trade-offs and later-task ownership

- A7T03 must extend A4 with a product-specific profile for `VIRTUAL_ACCOUNT` v1 capabilities; it MUST NOT create a second policy evaluator; it MUST reuse the A4 decision vocabulary and persistence.
- A7T04 must define the product customer-binding consumer for `VIRTUAL_ACCOUNT` v1; it MUST defer internal account selection to A3; it MUST NOT infer an A3 binding from product data.
- A7T05 must define the durable product command and product operation identity for `VIRTUAL_ACCOUNT` v1; it MUST remain distinct from A6T05 external-operation identity and from A5 internal command identity; it MUST use Operations-backed idempotency with a separate product scope.
- A7T06 must establish the A7 notification dispatcher that reads from `CustomerPreference.notifications`; it MUST NOT create a parallel customer intent/consent/notification authority.
- A7T07 must define the product lifecycle states reusing the A6T07 vocabulary; it MUST NOT create a parallel lifecycle authority.
- A7T08 must integrate the verified product financial effect with the A6T08 settlement, suspense, compensating entries, and Finance/Ledger-approved chart dimensions for `VIRTUAL_ACCOUNT` v1.
- A7T09 must build on the A6T09 read-only reconciliation engine to include the `VIRTUAL_ACCOUNT` v1 product operation, A6 partner reference, A6T08 settlement evidence, and A7T05 product command evidence.
- A7T10 must extend the A6T10 data-classification matrix with the `VIRTUAL_ACCOUNT` v1 product data fields.
- A7T11 must record the A7 release gate, rollback, disable, and A8 handoff evidence; it MUST NOT begin A8.

## 6. Architecture overview

```text
A2-protected internal command owner
   |
   v
A4 current product policy profile (A7T03)
   |
   v
A3 internal account / customer-binding recheck (A7T04)
   Customer.id -> CustomerWallet -> A3 binding -> WalletAccount -> LedgerAccount
   -> A7 product customer-binding map (virtual-account identifier, A6 partner identity, provider-side reference)
   |
   v
A7 product catalog lookup (A7T02)
   ProductRegistrationV1, ProductCapabilityRegistrationV1,
   ProductCompatibilityRuleV1, ProductDependenciesV1, ProductMetadataV1,
   ProductConsumerContractV1
   |
   v
A7 product command (A7T05)
   ProductCommandId, ProductOperationId, A4 product policy reference,
   A3 binding reference, A6 partner dependency, amount/currency/accounting unit,
   product idempotency + provider idempotency + correlation/causation
   |
   v
A7 product boundary (A7T02) — ProductBoundaryContractV1
   normalized product request/result/error/audit
   |
   v
A6 partner adapter and isolated transport (reused from A6T02 / A6T03)
   approved A6 partner/capability/version
   authenticated request + provider reference/acknowledgement
   |
   v
A6T07 lifecycle (reused) + A7 product lifecycle (A7T07) reusing A6 vocabulary
   ASSIGN_REQUESTED -> ASSIGN_PENDING -> ASSIGN_ACTIVE -> ASSIGN_CLOSED
   FUNDING_REQUESTED -> FUNDING_PENDING_VERIFICATION -> FUNDING_SETTLED / UNKNOWN / SUSPENDED / FAILED
   |
   v
A6T06 callback authenticity, replay, and freshness (reused from A6T06)
   callback event identity + provider reference + replay state
   |
   v
A7 product financial effect (A7T08) + A6T08 settlement (reused)
   verified product decision
   Ledger-owned journal/lines
   suspense or controlled exception where finality/matching is unresolved
   |
   v
A7 notification dispatcher (A7T06) under CustomerPreference.notifications
   delivery intent (outbox) -> delivery fact (audit) -> deduplication (idempotency)
   sensitive-payload redaction (A6T10 / A7T10)
   |
   v
Operations and independent control evidence
   audit + idempotency + transactional outbox
   A6 partner/internal references + A7 product operation + A7 notification + support trace
   A7 independent product reconciliation (A7T09) + discrepancy owner
   |
   v
A7 release control
   product disable + A6 circuit-breaker + rollback
   internal financial history preserved
```

The A7 product catalog is a read-only lookup. It is consumed by every later A7 task; it does not own a new authority, does not post a journal, does not mutate a balance, does not repair a binding, does not evaluate policy, does not authorize, does not dispatch a notification, does not write a customer intent, and does not begin A8.

## 7. Product isolation boundary

A7T02 establishes one explicit isolation boundary between the A7 product catalog and the shared A1–A6 authorities. The boundary is `ProductCatalogContractV1` and `ProductBoundaryContractV1`. The catalog is consumed by A2 internal command owner, A3 binding read, A4 policy profile, A5 lifecycle, A6 partner adapter, A6T05 external operation, A6T06 callback, A6T07 lifecycle, A6T08 settlement, A6T09 reconciliation, A6T10 data minimization, Operations (audit, idempotency, outbox, metrics, diagnostics), and the product request context. No domain module imports the catalog directly; domain modules consume the catalog through NestJS provider injection under the A2 audience authorization.

## 8. A6 partner dependency (recorded)

`VIRTUAL_ACCOUNT` v1 declares a single `A6PartnerDependencyV1`:

```text
partnerKey:                 "NIBSS_NIP"
a6PartnerCapabilityKey:     "external.wallet.withdrawal.settlement"
a6PartnerOperationType:     "OUTBOUND_BANK_SETTLEMENT"
reusesA6Connection:         true
reusesA6Callback:           true
reusesA6Lifecycle:          true
reusesA6Settlement:         true
reusesA6Reconciliation:     true
reusesA6DataMinimization:   true
introducesNewPartner:       false
introducesNewCallback:      false
introducesNewSettlementAccount: false
introducesNewSuspenseAccount:   false
introducesNewReconciliationWriter: false
introducesNewPrivacyAuthority:    false
```

The A6 partner is disabled-by-default; the A6 phase result is `NOT APPROVED / CONDITIONAL`; the A6 handoff entry conditions are pending. The first product's inbound funding flow depends on the A6 partner boundary remaining in this state.

## 9. Capability registration

The first product has two capabilities. Each capability declares its `lifecycle`, `compatibility`, and A6 partner mapping:

```text
ProductCapabilityRegistrationV1 (virtual-account.assign) {
  capabilityKey:             "virtual-account.assign"
  action:                    "assign"
  productApiVersion:         "v1"

  lifecycle:
    - "ASSIGN_REQUESTED"
    - "ASSIGN_PENDING"
    - "ASSIGN_ACTIVE"
    - "ASSIGN_SUSPENDED"
    - "ASSIGN_FAILED"
    - "ASSIGN_CLOSED"

  compatibility: {
    direction: "inbound"
    currency: "NGN"
    accountingUnit: "CUSTOMER_FUNDS"
    targetType: "BANK_ACCOUNT"
  }

  dependsOnPartnerCapability: true
  a6PartnerCapabilityKey:     "external.wallet.withdrawal.settlement"
  a6PartnerOperationType:     "OUTBOUND_BANK_SETTLEMENT"
}

ProductCapabilityRegistrationV1 (virtual-account.inbound-funding) {
  capabilityKey:             "virtual-account.inbound-funding"
  action:                    "lifecycle"
  productApiVersion:         "v1"

  lifecycle:
    - "FUNDING_REQUESTED"
    - "FUNDING_PENDING_VERIFICATION"
    - "FUNDING_SETTLED"
    - "FUNDING_UNKNOWN"
    - "FUNDING_SUSPENDED"
    - "FUNDING_FAILED"
    - "FUNDING_CLOSED"

  compatibility: {
    direction: "inbound"
    currency: "NGN"
    accountingUnit: "CUSTOMER_FUNDS"
    targetType: "BANK_ACCOUNT"
  }

  dependsOnPartnerCapability: true
  a6PartnerCapabilityKey:     "external.wallet.withdrawal.settlement"
  a6PartnerOperationType:     "OUTBOUND_BANK_SETTLEMENT"
}
```

The first product's capability `lifecycle` states are product-state-vocabulary entries; the A6T07 lifecycle vocabulary is reused for transport and partner state but the product states are the catalog's authoritative product-state vocabulary.

## 10. Dependency declaration

`VIRTUAL_ACCOUNT` v1 declares `ProductDependenciesV1` with the following entries:

```text
ProductDependenciesV1 (VIRTUAL_ACCOUNT v1) {
  requiresA2Authorization:       true
  requiresA3Binding:             true
  requiresA4PolicyProfile:       true
  requiresA5Lifecycle:           false
  requiresA6Partner:             { partnerKey: "NIBSS_NIP", ... }   // see [§8](#8-a6-partner-dependency-recorded)
  requiresCustomerPreference:   true
  requiresWallet:                true
  requiresLedger:                true
  requiresOperations:            { usesSharedAuditService: true, usesSharedIdempotencyService: true,
                                  usesSharedOutboxService: true, usesSharedMetricsService: true,
                                  usesSharedDiagnosticsService: true, usesSharedRequestContext: true,
                                  introducesLocalAuditStore: false, ... }
  requiresReconciliation:       true
  requiresA6T06Callback:         true
  requiresA6T07Lifecycle:        true
  requiresA6T08Settlement:       true
  requiresA6T09Reconciliation:   true
  requiresA6T10DataMinimization: true
  prohibits: [
    PROHIBIT_NOTIFICATION_DISPATCHER_REPLACING_PREFERENCE_AUTHORITY
    PROHIBIT_SECOND_POLICY_EVALUATOR
    PROHIBIT_BINDING_REPAIR
    PROHIBIT_LEDGER_WRITE_OUTSIDE_LEDGER
    PROHIBIT_RECONCILIATION_WRITER
    PROHIBIT_PARALLEL_PRIVACY_AUTHORITY
    PROHIBIT_SECOND_PARTNER
    PROHIBIT_SECOND_PRODUCT
    PROHIBIT_PRICING_FEES_COMMISSIONS
    PROHIBIT_PUBLIC_SURFACE
    PROHIBIT_NOTIFICATION_BECOMING_FINANCIAL_COMMAND
    PROHIBIT_A8_SCOPE
  ]
  prohibitedDependencies: [
    PROHIBIT_DEPENDENCY_ON_NON_A6_PARTNER
    PROHIBIT_DEPENDENCY_ON_NEW_PRIVACY_AUTHORITY
    PROHIBIT_DEPENDENCY_ON_NEW_RECONCILIATION_WRITER
    PROHIBIT_DEPENDENCY_ON_NEW_SETTLEMENT_AUTHORITY
  ]
}
```

The catalog uses the prohibitions to fail closed when a consumer asks for an incompatible product configuration. The catalog MUST NOT allow a prohibited configuration.

## 11. Compatibility rules

The first product's compatibility rules are FAIL_CLOSED on any prohibited edge:

```text
RULE_DIRECTION_INBOUND_ONLY                direction = "inbound"               FAIL_CLOSED
RULE_CURRENCY_NGN_ONLY                     currency = "NGN"                    FAIL_CLOSED
RULE_ACCOUNTING_UNIT_CUSTOMER_FUNDS       accountingUnit = "CUSTOMER_FUNDS"   FAIL_CLOSED
RULE_TARGET_TYPE_BANK_ACCOUNT              targetType = "BANK_ACCOUNT"         FAIL_CLOSED
RULE_A6_PARTNER_CAPABILITY_MAPPING         a6PartnerCapabilityKey = "external.wallet.withdrawal.settlement"   FAIL_CLOSED
RULE_A6_PARTNER_OPERATION_TYPE            a6PartnerOperationType = "OUTBOUND_BANK_SETTLEMENT"   FAIL_CLOSED
RULE_NOTIFICATION_SURFACE_PREFERENCE      notificationSurface = "CustomerPreference.notifications"  FAIL_CLOSED
RULE_PUBLIC_SURFACE_NONE                  publicSupportSurface = "none"       FAIL_CLOSED
RULE_PROHIBITED_EDGE_OUTBOUND              outbound settlement                 FAIL_CLOSED
RULE_PROHIBITED_EDGE_FEES                  fees beyond A6 partner contract     FAIL_CLOSED
RULE_PROHIBITED_EDGE_PRICING               pricing, interest, lending, FX     FAIL_CLOSED
RULE_PROHIBITED_EDGE_PRODUCTS              QR/merchant, bills/airtime, ...    FAIL_CLOSED
RULE_ACCOUNTING_DIMENSION_CUSTOMER_FUNDS   accountingDimension = "CUSTOMER_FUNDS"  FAIL_CLOSED
```

A compatibility rule with `enforcement = "FAIL_CLOSED"` MUST cause the catalog to return a non-success compatibility result when the rule does not hold. A relaxed compatibility rule is a new ADR; the catalog MUST NOT relax a rule without a new ADR.

## 12. Consumer contracts

The catalog publishes a consumer contract for every authority that consumes the first product. The complete list of consumer contracts is committed in [`docs/A7-PRODUCT-CATALOG-CONTRACT.md`](../A7-PRODUCT-CATALOG-CONTRACT.md) §10.2 and includes:

- `CONSUMER_A2_INTERNAL_COMMAND_OWNER`
- `CONSUMER_A3_BINDING_READ`
- `CONSUMER_A4_POLICY_PROFILE`
- `CONSUMER_A6_PARTNER_ADAPTER`
- `CONSUMER_A5_LIFECYCLE` (the first product does not introduce a new A5 lifecycle; the consumer contract is `writes: []`)
- `CONSUMER_A6T05_EXTERNAL_OPERATION`
- `CONSUMER_A6T06_CALLBACK`
- `CONSUMER_A6T07_LIFECYCLE`
- `CONSUMER_A6T08_SETTLEMENT`
- `CONSUMER_A6T09_RECONCILIATION`
- `CONSUMER_A6T10_DATA_MINIMIZATION`
- `CONSUMER_PRODUCT_REQUEST_CONTEXT`
- `CONSUMER_SUPPORT_TRACE`
- `CONSUMER_OPERATIONS_AUDIT`
- `CONSUMER_OPERATIONS_IDEMPOTENCY`
- `CONSUMER_OPERATIONS_OUTBOX`
- `CONSUMER_OPERATIONS_METRICS`
- `CONSUMER_OPERATIONS_DIAGNOSTICS`

A consumer contract declares `reads`, `writes`, `reusesSharedAuthority`, and `mustNotDo`. The catalog uses the consumer contract to reject a consumer that depends on a prohibited authority, a new authority, or a prohibited action.

## 13. Product-state vocabulary

The first product's state vocabulary is the union of two capability-level lifecycle state sets:

```text
ASSIGN_REQUESTED
ASSIGN_PENDING
ASSIGN_ACTIVE
ASSIGN_SUSPENDED
ASSIGN_FAILED
ASSIGN_CLOSED

FUNDING_REQUESTED
FUNDING_PENDING_VERIFICATION
FUNDING_SETTLED
FUNDING_UNKNOWN
FUNDING_SUSPENDED
FUNDING_FAILED
FUNDING_CLOSED
```

A product state is a product-lifecycle state. It is not a financial command, an A2 authorization, an A3 binding, an A4 policy decision, a Ledger journal, a customer intent, or a customer notification. A product state is not evidence of settlement (`FUNDING_SETTLED` requires the A6T08 / A7T08 settlement evidence to post the financial effect). A product state is not evidence of authorization (`ASSIGN_ACTIVE` requires the A2 authorization boundary).

## 14. Ownership boundaries

| Concern                                            | Owner                                                                       | Catalog responsibility                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Canonical customer identity                         | Customer module                                                              | Correlation only; never product identity                                                               |
| Customer wallet metadata                            | Customer-wallet module                                                       | Compatibility input; never product identity                                                            |
| Funding-instrument and beneficiary                  | customer-funding-instrument, customer-beneficiary                            | Approved metadata input; map to A6T04 consumer; do not invent a new mapping rule                       |
| `virtual-account` module (existing)                  | `virtual-account` module                                                     | Compatibility input; A7 catalog is the A7 product boundary                                                |
| Customer preferences / `NotificationPreference`     | customer-preference                                                          | Customer intent authority; A7T06 delivers; A7T02 does not redefine intent                              |
| A2 access                                            | A2                                                                            | Recheck exact principal/customer/action scope                                                          |
| A3 binding                                           | A3                                                                            | Validate customer/wallet binding; never select internal account from product data                       |
| A4 policy                                            | A4                                                                            | Consume current decision; A7T03 extends with a product-specific profile                              |
| A5 internal transfer                                  | A5                                                                            | Compatibility input; the first product does not introduce a new A5 lifecycle                          |
| A6 partner connectivity                              | A6 partner-adapter boundary                                                   | Reuse; A7T02 records the dependency; A7 does not duplicate A6                                            |
| A6 external operation identity                       | A6T05                                                                          | Distinct from product command/operation identity                                                         |
| A6 callback authenticity/receipt                     | A6T06                                                                          | Reuse; the first product does not create a new callback route                                            |
| A6 lifecycle                                          | A6T07                                                                          | Reuse; the first product's lifecycle vocabulary is a product-state vocabulary                            |
| Settlement and suspense                              | A6T08 / Ledger / Finance                                                       | Reuse; the first product does not introduce a new settlement authority                                  |
| Independent external reconciliation                  | A6T09                                                                          | Reuse; the first product's reconciliation is read-only                                                     |
| Data minimization, consent, retention, secret, disclosure | A6T10                                                                          | Reuse; the first product does not introduce a parallel privacy authority                               |
| Operations audit / idempotency / outbox / metrics / diagnostics | Operations                                                            | Reuse; the first product does not introduce a local store                                                 |
| A7 product catalog and product-boundary contract    | A7 (this ADR)                                                                 | A7 owns the catalog and the boundary                                                                   |
| A7 product command identity                          | A7T05                                                                          | Distinct from A6T05 external-operation ID and from A5 internal command ID                              |
| A7 product customer-binding                           | A7T04                                                                          | Defers internal account selection to A3                                                                  |
| A7 product lifecycle                                  | A7T07                                                                          | Reuses A6T07 vocabulary; A7T02 freezes the product-state vocabulary                                     |
| A7 product financial effect                           | A7T08                                                                          | Reuses A6T08 settlement                                                                                |
| A7 product reconciliation                             | A7T09                                                                          | Reuses A6T09 reconciliation                                                                             |
| A7 product data minimization                          | A7T10                                                                          | Reuses A6T10 data-classification matrix                                                                 |
| A7 notification dispatcher                            | A7T06                                                                          | Reads from CustomerPreference.notifications                                                            |
| A7 release gate and A8 handoff                       | A7T11                                                                          | Records evidence; A7T02 does not begin A8                                                              |

## 15. Explicit non-goals

This ADR and A7T02 do not:

- activate the first product, call a partner for a new product flow, create a second product, create a new partner, expose a public surface, dispatch a notification, or begin a notification dispatcher implementation;
- introduce an A7 runtime catalog, product module, entity, migration, repository, service, controller, API, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, or A8 work;
- introduce a new partner, a new callback, a new settlement account, a new suspense account, a new reconciliation writer, a new privacy authority, a new policy evaluator, a new preference store, a new funding-instrument store, a new beneficiary store, a new transfer lifecycle, or a new notification intent record;
- mutate Customer, CustomerWallet, customer funding-instrument/beneficiary ownership, A3 binding, A4 policy/source, A5 transfer history, Wallet, Ledger, Operations, Outbox, Reconciliation, or `CustomerPreference` records;
- treat a virtual-account identifier, a bank code, a bank account number, a partner reference, a provider reference, a payment reference, a funding-instrument identifier, a beneficiary identifier, or a notification identifier as a canonical product identity;
- claim A2, A3, A4, A5, A6, Finance, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, or partner owner approval;
- claim A6 release-gate approval, live migration execution, partner certification, or production activation; and
- begin A8 Scale & Selective Extraction.

## 16. Security assumptions

- The catalog and the boundary do not store or return raw credentials, raw callback signatures, raw provider payloads, raw risk/compliance content, or unnecessary customer data.
- A consumer that needs raw evidence reads it from the appropriate shared authority (A6T05, A6T06, A6T08, A6T09, A6T10). The catalog does not proxy raw evidence.
- The catalog is consumed only through NestJS provider injection under the A2 audience authorization. The catalog does not expose a public, customer, partner, or support surface.
- A consumer that wishes to log, trace, or surface catalog evidence MUST honor the data-minimization and classification rules in A6T10 / A7T10. The catalog does not relax these rules.

## 17. Capability registration

The first product's capabilities are recorded in [§9](#9-capability-registration). Each capability declares its `lifecycle`, `compatibility`, and A6 partner mapping. A new capability requires a new catalog version and a new ADR.

## 18. Compatibility assessment

The first product's compatibility rules are recorded in [§11](#11-compatibility-rules). The rules are FAIL_CLOSED on any prohibited edge. A consumer that asks the catalog for an incompatible configuration receives a deterministic non-success result; the catalog MUST NOT silently allow a prohibited configuration.

## 19. Future extension constraints

Future A7, A8, or product work that touches the A7 product catalog or the A7 product-boundary contract must preserve the following constraints:

- The A7 product catalog and product-boundary contract are owned by A7 (this ADR). A new product, a new partner, a new capability, a new currency, a new accounting unit, a new direction, a new state, a new compatibility rule, a new prohibition, a new consumer contract, or a new metadata field requires a new catalog version and a new ADR.
- A `DRAFT` entry exists only for catalog evolution; a `RETIRED` entry cannot be reactivated; a successor entry must be a new catalog entry under a new product version.
- A second product, a second partner, a second product direction, a new currency, a new accounting unit, a new product-state vocabulary, or any other A7 §5 non-goal requires a separate reviewed capability decision and a future ADR in a separate A7-product cycle; that cycle is out of scope for this ADR.
- A consumer that depends on a prohibited authority, a new authority, or a prohibited action MUST be rejected by the catalog.
- A relaxed compatibility rule is a new ADR; the catalog MUST NOT relax a rule without a new ADR.
- A relaxed prohibition is a new ADR; the catalog MUST NOT relax a prohibition without a new ADR.
- A7 release-gate evidence (per A7T11) is required before any A7 runtime, product, partner, callback, settlement, notification, public surface, or release work.
- A8 remains outside A7.

## 20. Implementation evidence

- [`docs/A7-PRODUCT-CATALOG-CONTRACT.md`](../A7-PRODUCT-CATALOG-CONTRACT.md) — the full A7 product catalog and product-boundary contract, including the first product's frozen registration, the A6 partner dependency declaration, the compatibility rules, the consumer contracts, the prohibited dependencies, the versioning rules, the integration boundaries, and the A7T02 verification record.
- [`docs/A7-IMPLEMENTATION-PLAN.md`](../A7-IMPLEMENTATION-PLAN.md) §3, §4, §5, §6, §7, §8 (A7T02), §11 — the A7 plan that defines the product catalog and product-boundary task, the product financial-effect boundary, the A7 prohibited edges, the A7 governing architectural boundaries, the A7 dependencies, and the A7T02 deliverable list.
- [`docs/A7-PRODUCT-EXPANSION-BASELINE.md`](../A7-PRODUCT-EXPANSION-BASELINE.md) — the A7T01 baseline that selects `VIRTUAL_ACCOUNT` v1, records the A6 release-gate evidence, and establishes the A6 handoff entry conditions.
- [`docs/A6-A7-HANDOFF-PACKAGE.md`](../A6-A7-HANDOFF-PACKAGE.md) — the A6-to-A7 handoff package that records the permitted A7 handoff, the prohibited A7 skip edges, and the A7 entry conditions.
- [`docs/A6-INTEGRATION-MATRIX.md`](../A6-INTEGRATION-MATRIX.md) — the A6 integration matrix that records the A6 implementation evidence, the A6 task-to-evidence matrix, and the A6 release-gate state.
- [`docs/A6-IMPLEMENTATION-PLAN.md`](../A6-IMPLEMENTATION-PLAN.md) — the A6 plan that defines the A6 partner-adapter, A6T03 isolation/credential, A6T05 external operation, A6T06 callback, A6T07 lifecycle, A6T08 settlement, A6T09 reconciliation, and A6T10 data-minimization contracts that A7 reuses.
- [`docs/ADR/ADR-0047-External-Partner-Adapter-Boundary.md`](ADR-0047-External-Partner-Adapter-Boundary.md) — the A6 partner-adapter boundary.
- [`docs/ADR/ADR-0048-NIBSS-and-Bank-Integration-Isolation.md`](ADR-0048-NIBSS-and-Bank-Integration-Isolation.md) — the A6T03 isolation/credential boundary.
- [`docs/ADR/ADR-0049-External-Callback-and-Reference-Idempotency.md`](ADR-0049-External-Callback-and-Reference-Idempotency.md) — the A6T05 external operation identity and the A6T06 callback boundary.
- [`docs/ADR/ADR-0050-Settlement-Suspense-and-Exception-Ownership.md`](ADR-0050-Settlement-Suspense-and-Exception-Ownership.md) — the A6T08 settlement, suspense, and compensating-entry boundary.
- [`docs/ADR/ADR-0051-External-Funding-Instrument-Use.md`](ADR-0051-External-Funding-Instrument-Use.md) — the A6T04 funding-instrument consumer boundary.
- [`docs/ADR/ADR-0052-External-Rail-Data-Minimization-and-Consent.md`](ADR-0052-External-Rail-Data-Minimization-and-Consent.md) — the A6T10 data-classification matrix.
- [`docs/ADR/ADR-0053-Independent-External-Reconciliation.md`](ADR-0053-Independent-External-Reconciliation.md) — the A6T09 reconciliation boundary.

## 21. A6T02 verification record

- [x] `ProductCatalogContractV1` and `ProductBoundaryContractV1` are defined as product-neutral, partner-neutral, customer-neutral interface designs.
- [x] The first product `VIRTUAL_ACCOUNT` v1 is the only ACTIVE entry in `A7-PRODUCT-CATALOG` v1.
- [x] Selected product key, direction, currency, accounting unit, target type, internal command owner, partner dependency, data fields, and prohibited adjacent products are explicit.
- [x] Canonical internal IDs, partner references, provider references, and product identifiers remain distinct and namespace-scoped.
- [x] A6 partner dependency is recorded as a single `A6PartnerDependencyV1` and reuses the A6 partner-adapter, callback, lifecycle, settlement, reconciliation, and data-minimization contracts.
- [x] Product-state vocabulary is closed and bounded.
- [x] Compatibility rules are FAIL_CLOSED on any prohibited edge.
- [x] Consumer contracts declare `reads`, `writes`, `reusesSharedAuthority`, and `mustNotDo`.
- [x] Prohibited dependencies, second-authority prohibitions, and prohibited edges are explicit.
- [x] Catalog versioning and compatibility rules are explicit.
- [x] Sandbox/fixture contract is deterministic and idempotent.
- [x] Domain modules consume the catalog and the consumer contracts rather than reaching into `virtual-account`, `payment`, `wallet`, `ledger`, or `partner` directly.
- [x] The contract does not post a journal, mutate a balance, repair a binding, change A4 policy/source records, or dispatch a notification.
- [x] No A7 runtime catalog, product module, entity, migration, repository, service, controller, API, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, or A8 work is introduced by A6T02.
- [ ] A7T03+ implementation remains intentionally incomplete until A7T03, A7T04, A7T05, A7T06, A7T07, A7T08, A7T09, A7T10, and A7T11 each pass their own acceptance criteria.
