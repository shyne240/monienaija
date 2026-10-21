# A7T02 — A7 Product Catalog and Product-Boundary Contract

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T02 — A7 Product Catalog and Product-Boundary Contract
- **Status:** Documentation and contract design prepared for review; no A7 runtime catalog or product-boundary implementation introduced
- **Contract:** `ProductCatalogContractV1` / `ProductBoundaryContractV1` / `ProductRegistrationV1` / `ProductCapabilityRegistrationV1` / `ProductRequestV1` / `ProductResultV1` / `ProductStateV1`
- **Catalog version:** `A7-PRODUCT-CATALOG` v1
- **Selected first product (frozen registration):** `VIRTUAL_ACCOUNT` / `virtual-account.assign` and `virtual-account.inbound-funding` (lifecycle) / inbound / `NGN` / `CUSTOMER_FUNDS` / under the existing A6 `NIBSS_NIP` partner boundary (planning rail)
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, notification, product, financial-runtime, and A8 changes:** None

This document defines the stable A7 product catalog and the product-boundary contract that keep product-specific behavior outside Customer, A2, A3, A4, A5, A6, Wallet, Ledger, and Operations authorities. It is a contract design artifact, not a TypeScript class, NestJS module, entity, migration, repository, service, controller, API, route, scheduler, product implementation, notification dispatcher, pricing/fee/commission logic, settlement logic, reconciliation logic, or runtime activation.

## 1. Contract boundary

### 1.1 Purpose

The A7 product catalog and product-boundary contract are an anti-corruption and isolation boundary between canonical authorities and one approved product capability:

```text
A2-protected internal command owner
  -> A4 policy result and A3 account/target evidence
  -> A7 product catalog (lookup product registration and compatibility)
  -> ProductBoundaryContractV1 (normalized product request/result/error/audit)
  -> A6 partner-adapter boundary (where the product depends on the A6 partner)
  <- product-neutral normalized result/evidence/error
```

The catalog and boundary translate product-specific vocabulary into provider-neutral, partner-neutral, customer-neutral values. They do not decide whether a product result is an internal financial outcome, an A2 authorization, an A3 binding, an A4 policy decision, or a customer intent.

### 1.2 Normative language

- **MUST** means a required contract invariant.
- **MUST NOT** means a prohibited state, dependency, or interpretation.
- **SHOULD** means the default behavior unless a later approved product contract documents a safer alternative.
- **MAY** means an optional field or later product-extension point that cannot weaken an invariant.
- **Catalog version** means a frozen `A7-PRODUCT-CATALOG` v1 entry whose identity, capabilities, dependency declaration, and lifecycle are described by this contract.
- **A6 partner boundary** means the existing A6 partner-adapter, callback, settlement, suspense, reconciliation, and data-minimization contracts (per ADR-0047, ADR-0048, ADR-0049, ADR-0050, ADR-0051, ADR-0052, ADR-0053). The first product depends on this boundary; it does not replace it.
- **Later A7 task** means work assigned to A7T03–A7T11 and not implemented here. A7T02 defines the catalog and the boundary only; it does not implement the A7 product module, the A7 product command, the A7 notification dispatcher, the A7 product lifecycle, the A7 product financial effect, the A7 product reconciliation, or the A7 product data classification.

### 1.3 Catalog and boundary port shape

The logical product catalog and boundary ports are equivalent to:

```text
ProductCatalogContractV1
  getRegistration(productKey: ProductKeyV1)
    -> ProductRegistrationV1 | null

  listRegistrations()
    -> readonly ProductRegistrationV1[]

  assertCompatible(
    productKey: ProductKeyV1,
    capabilityKey: ProductCapabilityKeyV1,
    action: ProductActionV1,
    currency: CurrencyV1,
    targetType: ProductTargetTypeV1 | null
  )
    -> ProductCapabilityRegistrationV1

ProductBoundaryContractV1
  execute(request: ProductRequestV1)
    -> ProductResultV1

  getCapabilities(query: ProductCapabilityQueryV1)
    -> ProductCapabilityResultV1
```

The catalog port is provider-neutral, partner-neutral, and customer-neutral. The boundary port is a contract design that a later runtime implementation will implement behind the existing A6 partner boundary for products that depend on it. Domain modules MUST consume the catalog and the boundary rather than reaching into `virtual-account`, `payment`, `wallet`, `ledger`, `partner`, or any other module directly.

### 1.4 Catalog version and selection rule

The catalog version is:

```text
catalogName:     "A7-PRODUCT-CATALOG"
catalogVersion:  1
```

Every product registration, capability registration, dependency declaration, lifecycle state, and consumer contract in this document is part of `A7-PRODUCT-CATALOG` v1. A later catalog version (v2) may add optional fields, capability metadata, or a second frozen product; it MUST NOT weaken v1 invariants or silently re-broaden the v1 first product. The first product is recorded as a single frozen registration in [§4](#4-first-product-registration).

### 1.5 Selected first product (frozen registration summary)

The selected first product, established in [A7T01](A7-PRODUCT-EXPANSION-BASELINE.md) and reasserted by this contract, is:

```text
productKey:           VIRTUAL_ACCOUNT
productVersion:       1
capabilityKey:        virtual-account.assign
                       virtual-account.inbound-funding
direction:            inbound
currency:             NGN
accountingUnit:       CUSTOMER_FUNDS
targetType:           BANK_ACCOUNT
partnerDependency:    NIBSS_NIP (A6 partner; planning rail; disabled-by-default)
internalCommandOwner: A7 product command boundary (A7T05)
adoptsA6Lifecycle:    true
adoptsA6Settlement:   true
adoptsA6Reconciliation: true
adoptsA6DataMinimization: true
notificationSurface:  CustomerPreference.notifications (A7T06 delivers)
publicSupportSurface: deferred to A7T10
prohibitedAdjacent:   outbound settlement, virtual-account-to-virtual-account transfer,
                       fees beyond A6 partner contract, pricing, interest, lending,
                       QR/merchant, bills/airtime, agent/assisted, card, bulk/payroll,
                       savings, credit
```

## 2. Canonical product identity

### 2.1 Identity vocabulary

```text
ProductKeyV1                 (e.g., "VIRTUAL_ACCOUNT")
ProductVersionV1             positive integer (e.g., 1)
ProductCapabilityKeyV1       (e.g., "virtual-account.assign")
ProductActionV1              (e.g., "assign", "lifecycle")
ProductDirectionV1           "inbound" | "outbound" | "internal"
CurrencyV1                   uppercase three-letter currency code (e.g., "NGN")
AccountingUnitV1             (e.g., "CUSTOMER_FUNDS")
ProductTargetTypeV1          "BANK_ACCOUNT" | "WALLET" | "CARD" | "CUSTOMER" | "EXTERNAL_TARGET"
ProductStateV1               bounded vocabulary; see [§7](#7-product-state-vocabulary)
```

The product key is a frozen identifier registered in the catalog. The product version is the frozen version of the registration; a contract-version bump creates a new registration entry rather than mutating the old one. The capability key is the product-internal capability identifier and is distinct from any A6 partner capability key. The action is the product-internal action verb and is distinct from any A5 internal lifecycle action verb.

### 2.2 Canonical product identity rules

- `ProductKeyV1` MUST be a single, frozen, registry-level identifier per product. A second product MUST NOT silently reuse an existing product key.
- `ProductVersionV1` MUST be a positive integer. A version bump MUST create a new catalog entry with a new contract version rather than mutating the old entry.
- `ProductCapabilityKeyV1` MUST be a single, frozen, product-internal capability identifier. The catalog MUST record the mapping from `ProductCapabilityKeyV1` to the A6 partner capability key (where applicable).
- `ProductActionV1` MUST be a single, frozen, product-internal action verb. The catalog MUST record the mapping from `ProductActionV1` to any A5 internal action verb or to the A6 partner operation type (where applicable).
- `CurrencyV1` MUST be uppercase three letters and MUST be the only currency accepted by the first product. The first product is `NGN` only.
- `AccountingUnitV1` MUST be `CUSTOMER_FUNDS` for the first product. A change requires a new catalog version and a new ADR.
- `ProductTargetTypeV1` MUST be the product-internal target type. The first product is `BANK_ACCOUNT` only.
- The product identifier is NOT a canonical internal customer identity, a canonical internal wallet identity, a canonical internal ledger identity, an A4 policy identifier, an A2 principal, an A3 binding identifier, an A6 external operation identifier, an A6 callback event identifier, an A6 journal identifier, an A6 outbox identifier, a `CustomerPreference` identifier, or a `Customer.id`. The product identifier is a product namespace value.
- A virtual-account identifier, a bank code, a bank account number, a partner reference, a provider reference, a payment reference, a funding-instrument identifier, a beneficiary identifier, or a notification identifier is NOT a canonical product identity. These values are inputs to product commands and product evidence, not substitutes for the catalog product key.

### 2.3 Identity separation matrix

| Identity                                     | Owner                                           | Catalog relationship                                                          | Catalog must not do                                          |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `Customer.id`                                 | Customer module                                 | Correlation only; never product identity                                       | Treat customer reference as product key                       |
| `CustomerWallet.id`                           | Customer-wallet module                          | Compatibility input; never product identity                                    | Treat customer-wallet ID as product key                       |
| `WalletAccount.id`                            | Wallet module                                   | Internal financial-wallet facade; never product identity                        | Treat wallet ID as product key                                |
| `LedgerAccount.id`                             | Ledger module                                   | Sole financial authority; never product identity                                 | Treat ledger ID as product key                                |
| A3 binding identifier                          | A3                                              | Customer-to-account binding; never product identity                              | Repair or infer binding from product data                     |
| A4 policy/profile identifier                   | A4                                              | Policy authority; never product identity                                         | Evaluate policy from product data                             |
| A5 internal command/transfer identifier         | A5                                              | Internal lifecycle; never product identity                                       | Treat A5 command as product command                            |
| A6 partner identifier (e.g., `NIBSS_NIP`)      | A6 partner-adapter boundary                     | Partner dependency; recorded as `partnerDependency` in registration               | Replace catalog partner key with A6 partner key               |
| A6T05 external-operation identifier             | A6T05                                           | Distinct from product command/operation identity                                  | Use A6T05 external-operation ID as product command ID         |
| A6T05 provider reference                       | A6T05                                           | Evidence type only; never product identity                                       | Use provider reference as product key                          |
| A6T06 callback event identifier                 | A6T06                                           | Evidence type only; never product identity                                       | Use callback event ID as product key                          |
| `ProductKeyV1`                                | A7 product catalog (this contract)              | The only canonical product identity for A7                                      | Replace with any other identifier                              |
| `ProductCommandId` (defined in A7T05)         | A7 product command boundary                     | Distinct from A6T05 external-operation ID and from A5 internal command ID         | Substitute for A6T05 or A5 identity                           |
| `ProductOperationId` (defined in A7T05)        | A7 product operation boundary                   | Distinct from A6T05 external-operation ID and from A5 internal lifecycle record    | Substitute for A6T05 or A5 identity                           |
| `VirtualAccount.id` (existing module)          | `virtual-account` module                        | Compatibility input; never product identity                                       | Treat virtual-account ID as product command ID               |
| `CustomerPreference.id` and `NotificationPreference` | `customer-preference` module                | Customer intent authority; never product identity                                 | Use preference ID as product key                              |
| `payment_reference` (existing module)           | `payment` module                                | Cross-domain lookup value; never product identity                                 | Use payment reference as product key                           |

## 3. Product registration

### 3.1 Registration envelope

```text
ProductRegistrationV1 {
  catalogName: "A7-PRODUCT-CATALOG"
  catalogVersion: 1

  productKey: ProductKeyV1
  productVersion: ProductVersionV1
  productTitle: bounded human-readable title
  productDescription: bounded human-readable description

  direction: ProductDirectionV1
  currency: CurrencyV1
  accountingUnit: AccountingUnitV1
  targetType: ProductTargetTypeV1

  internalCommandOwner: bounded product command owner reference (A7T05)

  capabilities: readonly ProductCapabilityRegistrationV1[]

  dependencies: ProductDependenciesV1

  metadata: ProductMetadataV1

  compatibilityRules: readonly ProductCompatibilityRuleV1[]

  productStateVocabulary: readonly ProductStateV1[]

  createdAt: RFC3339 UTC timestamp
  effectiveFrom: RFC3339 UTC timestamp
  effectiveUntil: RFC3339 UTC timestamp | null
  status: "ACTIVE" | "RETIRED" | "DRAFT"
}
```

A registration is a single, frozen, catalog-level object. The first product's registration is the only ACTIVE entry in `A7-PRODUCT-CATALOG` v1; the catalog MAY contain DRAFT entries for catalog evolution but MUST NOT silently activate them.

### 3.2 Registration rules

- A registration MUST declare exactly one `productKey`, `productVersion`, `direction`, `currency`, `accountingUnit`, and `targetType`.
- A registration MUST declare at least one `ProductCapabilityRegistrationV1`.
- A registration MUST declare its `internalCommandOwner` (A7T05). A registration without an internal command owner MUST be rejected.
- A registration MUST declare its `dependencies` (see [§6](#6-dependency-declaration)). A registration with a missing required dependency MUST be rejected.
- A registration MUST declare its `metadata` (see [§9](#9-product-metadata)).
- A registration MUST declare its `compatibilityRules` (see [§8](#8-compatibility-rules)).
- A registration MUST declare its `productStateVocabulary` (see [§7](#7-product-state-vocabulary)).
- `effectiveUntil` MUST be `null` for ACTIVE registrations and a valid RFC3339 UTC timestamp for RETIRED registrations.
- A RETIRED registration MUST NOT be reactivated. A successor registration MUST be a new catalog entry under a new product version.
- A DRAFT registration MUST NOT be returned to A7 runtime consumers; it exists only for catalog evolution.

### 3.3 First-product registration (frozen)

The first product's registration is the only ACTIVE entry in `A7-PRODUCT-CATALOG` v1 and is committed by this contract:

```text
ProductRegistrationV1 (VIRTUAL_ACCOUNT v1, ACTIVE) {
  catalogName: "A7-PRODUCT-CATALOG"
  catalogVersion: 1

  productKey: "VIRTUAL_ACCOUNT"
  productVersion: 1
  productTitle: "Provider-backed virtual account (inbound funding)"
  productDescription:
    "One bounded virtual account product under the existing A6 NIBSS_NIP partner
     boundary. Supports assignment and inbound funding lifecycle only. Does not
     support outbound settlement, fees beyond the A6 partner contract, pricing,
     interest, lending, virtual-account-to-virtual-account transfer, or any
     other product expansion."

  direction: "inbound"
  currency: "NGN"
  accountingUnit: "CUSTOMER_FUNDS"
  targetType: "BANK_ACCOUNT"

  internalCommandOwner: "A7 product command boundary (A7T05)"

  capabilities:
    - ProductCapabilityRegistrationV1 {
        capabilityKey: "virtual-account.assign"
        action: "assign"
        productApiVersion: "v1"
        lifecycle: ["ASSIGN_REQUESTED", "ASSIGN_PENDING", "ASSIGN_ACTIVE",
                    "ASSIGN_SUSPENDED", "ASSIGN_FAILED", "ASSIGN_CLOSED"]
      }
    - ProductCapabilityRegistrationV1 {
        capabilityKey: "virtual-account.inbound-funding"
        action: "lifecycle"
        productApiVersion: "v1"
        lifecycle: ["FUNDING_REQUESTED", "FUNDING_PENDING_VERIFICATION",
                    "FUNDING_SETTLED", "FUNDING_UNKNOWN", "FUNDING_SUSPENDED",
                    "FUNDING_FAILED", "FUNDING_CLOSED"]
      }

  dependencies:
    ProductDependenciesV1 { ... }    // see [§6](#6-dependency-declaration)

  metadata: ProductMetadataV1 { ... } // see [§9](#9-product-metadata)

  compatibilityRules: [...]           // see [§8](#8-compatibility-rules)

  productStateVocabulary: [...]       // see [§7](#7-product-state-vocabulary)

  createdAt: "<baseline commit timestamp>"
  effectiveFrom: "<baseline commit timestamp>"
  effectiveUntil: null
  status: "ACTIVE"
}
```

A7T02 commits this registration as a documented contract. A7T02 does not implement the catalog, the boundary, or the registration persistence. A7T11 will record the implementation evidence.

## 4. First product registration

### 4.1 Identity and capability summary

```text
productKey:          "VIRTUAL_ACCOUNT"
capabilityKeys:      ["virtual-account.assign", "virtual-account.inbound-funding"]
direction:           "inbound"
currency:            "NGN"
accountingUnit:      "CUSTOMER_FUNDS"
targetType:          "BANK_ACCOUNT"
```

### 4.2 A6 partner dependency (recorded)

The first product depends on the existing A6 partner boundary for:

- partner transport (A6T03 / ADR-0048);
- partner request signing/authentication and response authenticity (A6T03);
- external operation identity and provider idempotency (A6T05 / ADR-0049);
- callback authenticity, replay protection, and freshness (A6T06 / ADR-0049);
- product lifecycle states reusing the A6 lifecycle vocabulary (A6T07);
- product settlement, suspense, and compensating entries (A6T08 / ADR-0050);
- independent product reconciliation (A6T09 / ADR-0053);
- data minimization, consent, classification, retention, secret, and disclosure (A6T10 / ADR-0052).

The catalog records this dependency as a single declared `partnerDependency = "NIBSS_NIP"` with `partnerCapabilityKey = "external.wallet.withdrawal.settlement"` and `partnerOperationType = "OUTBOUND_BANK_SETTLEMENT"`. The A7 product catalog does not introduce a new partner, a new credential, a new signing key, a new callback route, a new settlement account, a new suspense entry, a new reconciliation writer, or a new privacy authority. The first product reuses the A6 boundary through its consumer contract (see [§10](#10-consumer-contracts)).

### 4.3 A6 partner capability mapping (recorded)

The first product's product capabilities map to the A6 partner capability as follows:

```text
ProductCapabilityKey        A6 Partner Capability Key
--------------------------  -------------------------------------------
virtual-account.assign       external.wallet.withdrawal.settlement (planning)
virtual-account.inbound-funding
                            external.wallet.withdrawal.settlement (planning)

ProductAction                A6 Partner Operation Type
---------------------------- -----------------------------------------
assign                       OUTBOUND_BANK_SETTLEMENT (planning)
lifecycle                     OUTBOUND_BANK_SETTLEMENT (planning)
```

The mapping is a contract reference, not a live provider call. A7T02 records the mapping; the A6 partner connection remains disabled-by-default and the A6 phase result is `NOT APPROVED / CONDITIONAL`. The first product is therefore not active, not connected, not certified, and not eligible for production activation. A7T03–A7T11 must each pass their own acceptance criteria before any product operation is considered.

### 4.4 Product metadata (first product)

The first product's metadata is the minimum required by the catalog:

```text
ProductMetadataV1 (VIRTUAL_ACCOUNT v1) {
  title:                "Provider-backed virtual account (inbound funding)"
  description:          (see [§4.1](#41-identity-and-capability-summary) and [§4.2](#42-a6-partner-dependency-recorded))
  prohibitedAdjacent:
    - "outbound settlement from internal wallet to bank account"
    - "virtual-account-to-virtual-account transfer"
    - "virtual-account-to-wallet transfer"
    - "fees beyond the A6 partner contract"
    - "pricing, interest, lending, savings, credit, FX"
    - "QR/merchant, bills/airtime, agent/assisted, card, bulk/payroll"
    - "second product, second partner, second product direction"
  dataFields:
    - "virtualAccountIdentifier (provider, accountNumber, accountName, bankCode)"
    - "customerId (canonical Customer.id)"
    - "walletId (canonical WalletAccount.id)"
    - "amount (positive integer minor units)"
    - "currency = NGN"
    - "accountingUnit = CUSTOMER_FUNDS"
    - "a4ProductPolicyReference (safe A4 reference)"
    - "a6ExternalOperationReference (safe A6T05 reference)"
    - "callbackReceiptReference (safe A6T06 reference)"
  notificationSurface: "CustomerPreference.notifications (A7T06 delivers)"
  publicSupportSurface: "deferred to A7T10"
  a2Audience: "internal product control surface (no public/customer/partner surface)"
  a7AdoptionReview: "A6 phase result NOT APPROVED / CONDITIONAL; A6 handoff entry conditions pending"
}
```

A7T02 records the metadata. A later A7 task may add additional fields under a new catalog version; A7T02 does not.

## 5. Capability registration

### 5.1 Capability registration envelope

```text
ProductCapabilityRegistrationV1 {
  capabilityKey: ProductCapabilityKeyV1
  action: ProductActionV1
  productApiVersion: string

  lifecycle: readonly ProductStateV1[]

  compatibility: ProductCapabilityCompatibilityV1
  direction: ProductDirectionV1
  currency: CurrencyV1
  accountingUnit: AccountingUnitV1
  targetType: ProductTargetTypeV1 | null

  dependsOnPartnerCapability: boolean
  a6PartnerCapabilityKey: string | null
  a6PartnerOperationType: string | null
}
```

A capability registration is a single, frozen entry. The first product has two capabilities: `virtual-account.assign` and `virtual-account.inbound-funding`. Each capability declares its own `lifecycle`, `compatibility`, and A6 partner mapping.

### 5.2 Capability rules

- A capability MUST declare exactly one `capabilityKey`, `action`, `productApiVersion`, `direction`, `currency`, `accountingUnit`, and `targetType`.
- A capability MUST declare at least one `lifecycle` state from the catalog's product state vocabulary.
- A capability MUST declare its `compatibility` (see [§8](#8-compatibility-rules)).
- A capability MUST declare whether it depends on the A6 partner boundary. The first product's capabilities both depend on the A6 partner boundary.
- A capability that depends on the A6 partner boundary MUST declare its `a6PartnerCapabilityKey` and `a6PartnerOperationType`. A capability that does not depend on the A6 partner boundary MUST declare both fields as `null`.
- A capability MUST NOT silently route to a different A6 partner capability or operation type.

### 5.3 First product capability registration

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

The first product's capability `lifecycle` states are product-state-vocabulary entries; the A6T07 lifecycle vocabulary is reused for transport and partner state but the product states are the catalog's authoritative product-state vocabulary. A7T02 commits both.

## 6. Dependency declaration

### 6.1 Dependency envelope

```text
ProductDependenciesV1 {
  requiresA2Authorization: boolean
  requiresA3Binding: boolean
  requiresA4PolicyProfile: boolean
  requiresA5Lifecycle: boolean
  requiresA6Partner: A6PartnerDependencyV1 | null
  requiresCustomerPreference: boolean
  requiresWallet: boolean
  requiresLedger: boolean
  requiresOperations: A7OperationsDependencyV1
  requiresReconciliation: boolean
  requiresA6T06Callback: boolean
  requiresA6T07Lifecycle: boolean
  requiresA6T08Settlement: boolean
  requiresA6T09Reconciliation: boolean
  requiresA6T10DataMinimization: boolean
  prohibits: readonly ProductProhibitionV1[]
  prohibitedDependencies: readonly ProductProhibitionV1[]
}

A6PartnerDependencyV1 {
  partnerKey: "NIBSS_NIP"
  a6PartnerCapabilityKey: "external.wallet.withdrawal.settlement"
  a6PartnerOperationType: "OUTBOUND_BANK_SETTLEMENT"
  reusesA6Connection: true
  reusesA6Callback: true
  reusesA6Lifecycle: true
  reusesA6Settlement: true
  reusesA6Reconciliation: true
  reusesA6DataMinimization: true
  introducesNewPartner: false
  introducesNewCallback: false
  introducesNewSettlementAccount: false
  introducesNewSuspenseAccount: false
  introducesNewReconciliationWriter: false
  introducesNewPrivacyAuthority: false
}

A7OperationsDependencyV1 {
  usesSharedAuditService: boolean
  usesSharedIdempotencyService: boolean
  usesSharedOutboxService: boolean
  usesSharedMetricsService: boolean
  usesSharedDiagnosticsService: boolean
  usesSharedRequestContext: boolean
  introducesLocalAuditStore: false
  introducesLocalIdempotencyStore: false
  introducesLocalOutboxStore: false
}

ProductProhibitionV1 {
  prohibitionKey: string
  rationale: string
  authorityReference: bounded authority reference
}
```

A registration declares its dependencies as a single, frozen `ProductDependenciesV1`. The catalog evaluates dependencies at lookup time and at any consumer admission boundary. A registration whose dependencies are not satisfied MUST NOT be returned as ACTIVE to consumers.

### 6.2 First product dependencies

```text
ProductDependenciesV1 (VIRTUAL_ACCOUNT v1) {
  requiresA2Authorization:       true
  requiresA3Binding:             true
  requiresA4PolicyProfile:       true
  requiresA5Lifecycle:           false       (the first product does not introduce a new A5 lifecycle)
  requiresA6Partner: {
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
  }
  requiresCustomerPreference:   true         (notification delivery reads from
                                              CustomerPreference.notifications)
  requiresWallet:                true
  requiresLedger:                true
  requiresOperations: {
    usesSharedAuditService:      true
    usesSharedIdempotencyService: true
    usesSharedOutboxService:      true
    usesSharedMetricsService:    true
    usesSharedDiagnosticsService: true
    usesSharedRequestContext:     true
    introducesLocalAuditStore:    false
    introducesLocalIdempotencyStore: false
    introducesLocalOutboxStore:   false
  }
  requiresReconciliation:       true
  requiresA6T06Callback:         true
  requiresA6T07Lifecycle:        true
  requiresA6T08Settlement:       true
  requiresA6T09Reconciliation:   true
  requiresA6T10DataMinimization: true
  prohibits: [
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_NOTIFICATION_DISPATCHER_REPLACING_PREFERENCE_AUTHORITY",
                           rationale: "CustomerPreference.notifications remains the only customer intent authority" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_SECOND_POLICY_EVALUATOR",
                           rationale: "A4 is the only policy authority; product profiles extend, not replace" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_BINDING_REPAIR",
                           rationale: "A3 is the only customer-to-account binding authority" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_LEDGER_WRITE_OUTSIDE_LEDGER",
                           rationale: "Ledger is the only financial authority" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_RECONCILIATION_WRITER",
                           rationale: "Reconciliation is read-only with respect to all source records" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_PARALLEL_PRIVACY_AUTHORITY",
                           rationale: "A6T10 / A7T10 data controls are the only privacy authority" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_SECOND_PARTNER",
                           rationale: "A7 does not introduce a second partner beyond the A6 partner boundary" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_SECOND_PRODUCT",
                           rationale: "A7T01 selected exactly one bounded first product" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_PRICING_FEES_COMMISSIONS",
                           rationale: "A7 §5 non-goals" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_PUBLIC_SURFACE",
                           rationale: "A2 route/data exposure controls are required for any public surface" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_NOTIFICATION_BECOMING_FINANCIAL_COMMAND",
                           rationale: "Notifications are not A2 authorization, A3 binding, A4 policy, or Ledger truth" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_A8_SCOPE",
                           rationale: "A8 Scale & Selective Extraction is outside A7" }
  ]
  prohibitedDependencies: [
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_DEPENDENCY_ON_NON_A6_PARTNER",
                           rationale: "The first product reuses the A6 partner boundary only" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_DEPENDENCY_ON_NEW_PRIVACY_AUTHORITY",
                           rationale: "A7T10 is the only A7 privacy authority" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_DEPENDENCY_ON_NEW_RECONCILIATION_WRITER",
                           rationale: "A7T09 is the only A7 reconciliation authority" },
    ProductProhibitionV1 { prohibitionKey: "PROHIBIT_DEPENDENCY_ON_NEW_SETTLEMENT_AUTHORITY",
                           rationale: "A6T08 / A7T08 is the only settlement authority" }
  ]
}
```

The catalog evaluates `prohibits` and `prohibitedDependencies` at every lookup. A consumer that asks the catalog for the first product MUST be told that the first product is incompatible with any declared prohibition; the catalog MUST NOT silently allow a prohibited configuration.

### 6.3 Dependency declaration rules

- A registration MUST declare `requiresA6Partner` as either a non-null `A6PartnerDependencyV1` or `null`. A registration that requires the A6 partner boundary MUST declare a non-null `A6PartnerDependencyV1`.
- A registration MUST declare whether it requires `CustomerPreference` (notification delivery). A registration that requires notification MUST declare `requiresCustomerPreference: true`.
- A registration MUST NOT introduce a new partner, a new callback, a new settlement account, a new suspense account, a new reconciliation writer, a new privacy authority, a new policy evaluator, a new preference store, a new funding-instrument store, a new beneficiary store, a new transfer lifecycle, or a new notification intent record.
- A registration MUST declare its prohibitions. The catalog uses the prohibitions to fail closed when a consumer asks for an incompatible product configuration.
- A registration's prohibitions are the authoritative source for the first product's prohibited edges. A7T02 records the prohibitions; later A7 tasks reference them rather than re-declaring the prohibited edges.

## 7. Product-state vocabulary

### 7.1 Product-state envelope

```text
ProductStateV1 = bounded string from the catalog's product-state vocabulary
```

A product state is a single, frozen, catalog-level vocabulary entry. The first product's state vocabulary is the union of the two capabilities' lifecycle states. The catalog uses the vocabulary to describe every transition guard and to support reconciliation, support trace, and audit.

### 7.2 First product state vocabulary

The first product's state vocabulary is the union of the two capabilities' lifecycle states:

```text
ASSIGN_REQUESTED              the product command has been admitted and a
                              virtual-account assignment is requested
ASSIGN_PENDING                the virtual-account assignment is awaiting
                              A6 partner response (request may have been
                              sent or may be unknown)
ASSIGN_ACTIVE                 the virtual-account assignment is active
                              against the A6 partner boundary
ASSIGN_SUSPENDED              the virtual-account assignment is
                              suspended; new product admission is denied
                              but the assignment record is preserved
ASSIGN_FAILED                 the virtual-account assignment failed
                              deterministically
ASSIGN_CLOSED                 the virtual-account assignment is closed

FUNDING_REQUESTED             an inbound product command has been
                              admitted and a product operation has
                              been created
FUNDING_PENDING_VERIFICATION  the inbound product operation is awaiting
                              A6 partner response, callback, status,
                              statement, or reconciliation evidence
FUNDING_SETTLED               the inbound product operation is
                              verified through the A6 boundary and
                              posted through A6T08 / A7T08
FUNDING_UNKNOWN                the inbound product operation cannot
                              establish external finality or matching;
                              it enters a controlled A6 reconciliation
                              state
FUNDING_SUSPENDED             the inbound product operation is
                              suspended in a controlled A6 suspense or
                              manual-review state
FUNDING_FAILED                 the inbound product operation failed
                              deterministically
FUNDING_CLOSED                the inbound product operation is closed
```

The first product's state vocabulary is closed. A new product state requires a new catalog version and a new ADR.

### 7.3 Product-state vocabulary rules

- A product state MUST be a single, frozen, catalog-level vocabulary entry.
- A product state MUST be one of: `*_REQUESTED`, `*_PENDING*`, `*_ACTIVE`, `*_SETTLED`, `*_UNKNOWN`, `*_SUSPENDED`, `*_FAILED`, `*_CLOSED`. A state that implies settled value MUST be `*_SETTLED`; a state that implies an active product surface MUST be `*_ACTIVE`; a state that implies a closed or failed outcome MUST be `*_CLOSED` or `*_FAILED`; a state that implies a pending or unknown outcome MUST be `*_PENDING*` or `*_UNKNOWN`.
- A product state MUST NOT be a financial command, an A2 authorization, an A3 binding, an A4 policy decision, a Ledger journal, a journal line, a customer intent, or a customer notification. A product state is a product-lifecycle state.
- A product state MUST NOT be used as evidence of settlement. `FUNDING_SETTLED` is a product-state assertion that requires the A6T08 / A7T08 settlement boundary to post the financial effect. A `FUNDING_SETTLED` product state without the A6T08 / A7T08 settlement evidence is invalid.
- A product state MUST NOT be used as evidence of authorization. `ASSIGN_ACTIVE` is a product-state assertion that requires the A2 authorization boundary. An `ASSIGN_ACTIVE` product state without A2 authorization is invalid.

## 8. Compatibility rules

### 8.1 Compatibility rule envelope

```text
ProductCompatibilityRuleV1 {
  ruleKey: string
  ruleType:
    DIRECTION
    CURRENCY
    ACCOUNTING_UNIT
    TARGET_TYPE
    A6_PARTNER_CAPABILITY
    A6_PARTNER_OPERATION_TYPE
    NOTIFICATION_SURFACE
    PUBLIC_SURFACE
    PROHIBITED_EDGE
    ACCOUNTING_DIMENSION
  expected: bounded expected value
  rationale: bounded human-readable rationale
  enforcement: "FAIL_CLOSED" | "REQUIRE_RECONFIRMATION" | "INFORMATIONAL"
}

ProductCapabilityCompatibilityV1 {
  direction: ProductDirectionV1
  currency: CurrencyV1
  accountingUnit: AccountingUnitV1
  targetType: ProductTargetTypeV1
  accountingDimension: "CUSTOMER_FUNDS"
}
```

A compatibility rule is a single, frozen, catalog-level entry. The catalog evaluates every rule at lookup time. A rule with `enforcement = "FAIL_CLOSED"` MUST cause the catalog to return a non-success compatibility result when the rule does not hold.

### 8.2 First product compatibility rules

The first product's compatibility rules are:

```text
ProductCompatibilityRuleV1 (RULE_DIRECTION)              {
  ruleKey:     "RULE_DIRECTION_INBOUND_ONLY"
  ruleType:    "DIRECTION"
  expected:    "inbound"
  rationale:   "The first product is inbound funding only"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_CURRENCY)              {
  ruleKey:     "RULE_CURRENCY_NGN_ONLY"
  ruleType:    "CURRENCY"
  expected:    "NGN"
  rationale:   "The first product accepts NGN only"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_ACCOUNTING_UNIT)      {
  ruleKey:     "RULE_ACCOUNTING_UNIT_CUSTOMER_FUNDS"
  ruleType:    "ACCOUNTING_UNIT"
  expected:    "CUSTOMER_FUNDS"
  rationale:   "The first product moves customer funds only"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_TARGET_TYPE)          {
  ruleKey:     "RULE_TARGET_TYPE_BANK_ACCOUNT"
  ruleType:    "TARGET_TYPE"
  expected:    "BANK_ACCOUNT"
  rationale:   "The first product targets an external bank account only"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_A6_PARTNER_CAPABILITY) {
  ruleKey:     "RULE_A6_PARTNER_CAPABILITY_MAPPING"
  ruleType:    "A6_PARTNER_CAPABILITY"
  expected:    "external.wallet.withdrawal.settlement"
  rationale:   "The first product depends on the A6 partner boundary only"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_A6_PARTNER_OP_TYPE)    {
  ruleKey:     "RULE_A6_PARTNER_OPERATION_TYPE"
  ruleType:    "A6_PARTNER_OPERATION_TYPE"
  expected:    "OUTBOUND_BANK_SETTLEMENT"
  rationale:   "The first product maps to the A6 partner operation type only"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_NOTIFICATION_SURFACE) {
  ruleKey:     "RULE_NOTIFICATION_SURFACE_PREFERENCE"
  ruleType:    "NOTIFICATION_SURFACE"
  expected:    "CustomerPreference.notifications (A7T06 delivers)"
  rationale:   "Notification delivery must read from the customer intent authority"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_PUBLIC_SURFACE)        {
  ruleKey:     "RULE_PUBLIC_SURFACE_NONE"
  ruleType:    "PUBLIC_SURFACE"
  expected:    "none"
  rationale:   "No public/customer/partner surface is introduced by A7T02"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_PROHIBITED_OUTBOUND)  {
  ruleKey:     "RULE_PROHIBITED_EDGE_OUTBOUND"
  ruleType:    "PROHIBITED_EDGE"
  expected:    "outbound settlement from internal wallet to bank account"
  rationale:   "Outbound settlement is a separate A6 partner capability, not part of A7T01"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_PROHIBITED_FEES)      {
  ruleKey:     "RULE_PROHIBITED_EDGE_FEES"
  ruleType:    "PROHIBITED_EDGE"
  expected:    "fees beyond the A6 partner contract"
  rationale:   "A7 §5 non-goals"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_PROHIBITED_PRICING)   {
  ruleKey:     "RULE_PROHIBITED_EDGE_PRICING"
  ruleType:    "PROHIBITED_EDGE"
  expected:    "pricing, interest, lending, savings, credit, FX"
  rationale:   "A7 §5 non-goals"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_PROHIBITED_PRODUCTS)  {
  ruleKey:     "RULE_PROHIBITED_EDGE_PRODUCTS"
  ruleType:    "PROHIBITED_EDGE"
  expected:    "QR/merchant, bills/airtime, agent/assisted, card, bulk/payroll"
  rationale:   "A7 §5 non-goals and A7T01 prohibited adjacent products"
  enforcement: "FAIL_CLOSED"
}

ProductCompatibilityRuleV1 (RULE_ACCOUNTING_DIMENSION) {
  ruleKey:     "RULE_ACCOUNTING_DIMENSION_CUSTOMER_FUNDS"
  ruleType:    "ACCOUNTING_DIMENSION"
  expected:    "CUSTOMER_FUNDS"
  rationale:   "The first product moves customer funds only"
  enforcement: "FAIL_CLOSED"
}
```

### 8.3 Compatibility rule rules

- A rule with `enforcement = "FAIL_CLOSED"` MUST cause the catalog to return a non-success compatibility result when the rule does not hold.
- A rule with `enforcement = "REQUIRE_RECONFIRMATION"` MUST require an explicit owner re-confirmation when the rule does not hold. The A7 phase remains `NOT APPROVED` until the re-confirmation is recorded.
- A rule with `enforcement = "INFORMATIONAL"` is observational and MUST NOT cause the catalog to reject a lookup.
- A rule MUST be a single, frozen, catalog-level entry. A new rule requires a new catalog version and a new ADR.
- A rule MUST NOT authorize, settle, bind, post, dispatch, or repair. The catalog returns the rule's `enforcement` decision; the consumer enforces it.

## 9. Product metadata

### 9.1 Metadata envelope

```text
ProductMetadataV1 {
  title: string
  description: string
  prohibitedAdjacent: readonly string[]
  dataFields: readonly string[]
  notificationSurface: string
  publicSupportSurface: string
  a2Audience: string
  a7AdoptionReview: string
  compatibilitySummary: string
  reviewSnapshot: string
  freeze: ProductFreezeV1
}

ProductFreezeV1 {
  frozenAt: RFC3339 UTC timestamp
  frozenBy: bounded commit reference
  frozenADR: bounded ADR reference (e.g., "ADR-0054")
  nextPlannedChange: "none" | bounded reference to a future A7 task
}
```

A product metadata is a single, frozen, catalog-level entry. The first product's metadata is committed by A7T02; later A7 tasks MUST NOT mutate the frozen fields.

### 9.2 First product metadata (recorded)

The first product's metadata is the minimum required by the catalog and is committed by A7T02:

```text
ProductMetadataV1 (VIRTUAL_ACCOUNT v1) {
  title:                "Provider-backed virtual account (inbound funding)"
  description:          "One bounded virtual account product under the existing
                         A6 NIBSS_NIP partner boundary. Supports assignment and
                         inbound funding lifecycle only."
  prohibitedAdjacent: [
    "outbound settlement from internal wallet to bank account",
    "virtual-account-to-virtual-account transfer",
    "virtual-account-to-wallet transfer",
    "fees beyond the A6 partner contract",
    "pricing, interest, lending, savings, credit, FX",
    "QR/merchant, bills/airtime, agent/assisted, card, bulk/payroll",
    "second product, second partner, second product direction"
  ]
  dataFields: [
    "virtualAccountIdentifier (provider, accountNumber, accountName, bankCode)",
    "customerId (canonical Customer.id)",
    "walletId (canonical WalletAccount.id)",
    "amount (positive integer minor units)",
    "currency = NGN",
    "accountingUnit = CUSTOMER_FUNDS",
    "a4ProductPolicyReference (safe A4 reference)",
    "a6ExternalOperationReference (safe A6T05 reference)",
    "callbackReceiptReference (safe A6T06 reference)"
  ]
  notificationSurface:    "CustomerPreference.notifications (A7T06 delivers)"
  publicSupportSurface:   "deferred to A7T10"
  a2Audience:              "internal product control surface (no public/customer/partner surface)"
  a7AdoptionReview:        "A6 phase result NOT APPROVED / CONDITIONAL; A6 handoff entry conditions pending"
  compatibilitySummary:    "Direction=inbound, Currency=NGN, AccountingUnit=CUSTOMER_FUNDS, TargetType=BANK_ACCOUNT, A6PartnerCapability=external.wallet.withdrawal.settlement, A6PartnerOperationType=OUTBOUND_BANK_SETTLEMENT, NotificationSurface=CustomerPreference.notifications, PublicSurface=none; compatibility rules FAIL_CLOSED on any prohibited edge"
  reviewSnapshot:          "<A7T02 commit hash>"
  freeze: {
    frozenAt:          "<A7T02 commit timestamp>"
    frozenBy:          "A7T02 catalog freeze"
    frozenADR:         "ADR-0054 (proposed; reserved in A7 plan)"
    nextPlannedChange: "A7T03 extends A4 with a product-specific profile; A7T04 defines product customer-binding; A7T05 defines product command identity; A7T06 establishes notification delivery; A7T07 reuses A6 lifecycle; A7T08 reuses A6 settlement; A7T09 reuses A6 reconciliation; A7T10 extends A6T10 data controls; A7T11 records the A7 release gate and A8 handoff"
  }
}
```

A7T02 commits the metadata. A7T02 does not implement the metadata persistence. A7T11 will record the implementation evidence.

## 10. Consumer contracts

### 10.1 Consumer contract envelope

```text
ProductConsumerContractV1 {
  consumerKey: bounded consumer identifier
  consumerType:
    A2_INTERNAL_COMMAND_OWNER
    A3_BINDING_READ
    A4_POLICY_PROFILE
    A5_LIFECYCLE
    A6_PARTNER_ADAPTER
    A6T05_EXTERNAL_OPERATION
    A6T06_CALLBACK
    A6T07_LIFECYCLE
    A6T08_SETTLEMENT
    A6T09_RECONCILIATION
    A6T10_DATA_MINIMIZATION
    OPERATIONS_AUDIT
    OPERATIONS_IDEMPOTENCY
    OPERATIONS_OUTBOX
    OPERATIONS_METRICS
    OPERATIONS_DIAGNOSTICS
    PRODUCT_REQUEST_CONTEXT
    SUPPORT_TRACE
  reads: readonly string[]
  writes: readonly string[]
  reusesSharedAuthority: readonly string[]
  mustNotDo: readonly string[]
}
```

A consumer contract is a single, frozen, catalog-level entry. The catalog publishes a consumer contract for every authority that consumes the first product. A later A7 task that introduces a new consumer MUST publish a new consumer contract under the same catalog version.

### 10.2 First product consumer contracts

```text
ProductConsumerContractV1 (CONSUMER_A2_INTERNAL_COMMAND_OWNER) {
  consumerKey: "A2_INTERNAL_COMMAND_OWNER"
  consumerType: "A2_INTERNAL_COMMAND_OWNER"
  reads: ["product registration", "product capability registration",
          "product compatibility rules", "product metadata"]
  writes: ["product admission denial record (audit only; no command creation)"]
  reusesSharedAuthority: ["A2 audience/authorization/privileged-action",
                           "A2 secret boundary", "A2 protected routes"]
  mustNotDo: ["select an internal account from product data",
              "issue authorization for product effect",
              "create a new product command or product operation identity",
              "expose a public, customer, partner, or support surface"]
}

ProductConsumerContractV1 (CONSUMER_A3_BINDING_READ) {
  consumerKey: "A3_BINDING_READ"
  consumerType: "A3_BINDING_READ"
  reads: ["product registration", "product capability registration",
          "product compatibility rules", "A3 binding read contract"]
  writes: ["read-only binding recheck record (audit only)"]
  reusesSharedAuthority: ["A3 binding/read/reconciliation", "A3 read states",
                           "WalletAccount, LedgerAccount"]
  mustNotDo: ["infer or repair an A3 binding from product data",
              "select an internal account from product data",
              "create or modify a binding"]
}

ProductConsumerContractV1 (CONSUMER_A4_POLICY_PROFILE) {
  consumerKey: "A4_POLICY_PROFILE"
  consumerType: "A4_POLICY_PROFILE"
  reads: ["product registration", "product capability registration",
          "product compatibility rules", "A4 policy contract"]
  writes: ["read-only policy profile record (audit only)"]
  reusesSharedAuthority: ["A4 capability/policy/profile/limit/decision",
                           "A4 decision vocabulary",
                           "A4 evidence/snapshot/persistence/recovery"]
  mustNotDo: ["evaluate policy from product data",
              "create a second policy evaluator",
              "mutate A4 source records",
              "treat policy decision as authorization, binding, or Ledger truth"]
}

ProductConsumerContractV1 (CONSUMER_A6_PARTNER_ADAPTER) {
  consumerKey: "A6_PARTNER_ADAPTER"
  consumerType: "A6_PARTNER_ADAPTER"
  reads: ["product registration", "product capability registration",
          "product compatibility rules", "A6 partner-adapter contract",
          "A6T03 isolation/credential/signing", "A6T05 external operation",
          "A6T06 callback", "A6T07 lifecycle", "A6T08 settlement",
          "A6T09 reconciliation", "A6T10 data minimization"]
  writes: ["product-safe admission record (A6T05 external operation evidence)"]
  reusesSharedAuthority: ["A6 partner-adapter boundary",
                           "A6T03 / A6T05 / A6T06 / A6T07 / A6T08 / A6T09 / A6T10"]
  mustNotDo: ["call a partner from a non-A6 boundary",
              "introduce a new partner, callback, settlement account, suspense account, reconciliation writer, or privacy authority",
              "select an internal account from product data",
              "treat a product event as settled value"]
}

ProductConsumerContractV1 (CONSUMER_PRODUCT_REQUEST_CONTEXT) {
  consumerKey: "PRODUCT_REQUEST_CONTEXT"
  consumerType: "PRODUCT_REQUEST_CONTEXT"
  reads: ["product registration", "product capability registration",
          "product compatibility rules", "request context"]
  writes: ["product command/operation identity (A7T05)",
           "product correlation/causation context",
           "Operations audit / idempotency / outbox evidence"]
  reusesSharedAuthority: ["Operations audit, idempotency, outbox, request context",
                           "A2 audience/authorization context",
                           "A4 evidence correlation",
                           "A6 correlation context"]
  mustNotDo: ["create a second customer intent, consent, or preference record",
              "create a second notification intent authority",
              "select an internal account from product data",
              "dispatch a notification from this contract (A7T06 owns delivery)"]
}

ProductConsumerContractV1 (CONSUMER_SUPPORT_TRACE) {
  consumerKey: "SUPPORT_TRACE"
  consumerType: "SUPPORT_TRACE"
  reads: ["product registration", "product command/operation identity",
          "product correlation/causation context", "A4 product policy reference",
          "A6 partner reference", "A6T06 callback receipt reference",
          "A6T08 settlement reference", "A6T09 reconciliation reference",
          "Operations audit / outbox evidence"]
  writes: ["classified support-trace record (audit only)"]
  reusesSharedAuthority: ["A2 audience/authorization",
                           "A6T10 data minimization/consent/classification",
                           "A6T09 reconciliation classification",
                           "Operations audit"]
  mustNotDo: ["expose raw credentials, raw callback signatures, full funding credentials, unrestricted risk/compliance data, or unnecessary customer data",
              "expose product data outside the classified support-trace audience",
              "create a new customer identity, consent, preference, or notification record",
              "repair source records or authorize settlement from a trace"]
}

ProductConsumerContractV1 (CONSUMER_OPERATIONS_AUDIT) {
  consumerKey: "OPERATIONS_AUDIT"
  consumerType: "OPERATIONS_AUDIT"
  reads: ["product registration", "product command/operation identity",
          "A4 product policy reference", "A6 partner reference",
          "A6T05 external operation evidence", "A6T08 settlement evidence",
          "A6T09 reconciliation evidence"]
  writes: ["Operations audit record (A7 product audit entity type)"]
  reusesSharedAuthority: ["Operations audit service", "A2 audience/authorization"]
  mustNotDo: ["create a local audit store",
              "expose unrestricted data in audit values",
              "treat an outbox fact as financial truth"]
}

ProductConsumerContractV1 (CONSUMER_OPERATIONS_IDEMPOTENCY) {
  consumerKey: "OPERATIONS_IDEMPOTENCY"
  consumerType: "OPERATIONS_IDEMPOTENCY"
  reads: ["product registration", "product command/operation identity",
          "A6T05 external operation identity",
          "A6 provider idempotency scope/key"]
  writes: ["Operations idempotency record (product scope)"]
  reusesSharedAuthority: ["Operations idempotency service",
                           "A6T05 internal/provider idempotency separation"]
  mustNotDo: ["create a local idempotency store",
              "reuse A6T05 provider idempotency key as a product command key",
              "reuse an A5 internal command key as a product command key"]
}

ProductConsumerContractV1 (CONSUMER_OPERATIONS_OUTBOX) {
  consumerKey: "OPERATIONS_OUTBOX"
  consumerType: "OPERATIONS_OUTBOX"
  reads: ["product registration", "product command/operation identity",
          "A6T05 external operation evidence",
          "A6T08 settlement evidence",
          "A7T06 notification delivery intent (deferred)"]
  writes: ["Operations outbox record (product event type)"]
  reusesSharedAuthority: ["Operations outbox service", "A5 transactional outbox",
                           "A6T05 outbox integration"]
  mustNotDo: ["create a local outbox store",
              "treat an outbox fact as financial truth, customer intent, or delivery confirmation",
              "expose a public/customer/partner surface from the outbox"]
}

ProductConsumerContractV1 (CONSUMER_OPERATIONS_METRICS) {
  consumerKey: "OPERATIONS_METRICS"
  consumerType: "OPERATIONS_METRICS"
  reads: ["product registration", "product command/operation identity",
          "A4 product policy reference", "A6 partner reference",
          "A6T08 settlement evidence", "A6T09 reconciliation evidence"]
  writes: ["Operations metrics record (read-only projection)"]
  reusesSharedAuthority: ["Operations metrics service"]
  mustNotDo: ["create a local metrics store",
              "use metrics to authorize, settle, bind, or repair",
              "expose unrestricted data in metrics"]
}

ProductConsumerContractV1 (CONSUMER_OPERATIONS_DIAGNOSTICS) {
  consumerKey: "OPERATIONS_DIAGNOSTICS"
  consumerType: "OPERATIONS_DIAGNOSTICS"
  reads: ["product registration", "product command/operation identity",
          "A4 product policy reference", "A6 partner reference",
          "A6T08 settlement evidence", "A6T09 reconciliation evidence"]
  writes: ["Operations diagnostics record (read-only projection)"]
  reusesSharedAuthority: ["Operations diagnostics service", "production-readiness service"]
  mustNotDo: ["create a local diagnostics store",
              "use diagnostics to authorize, settle, bind, or repair",
              "expose unrestricted data in diagnostics",
              "degrade financial writes on telemetry loss"]
}

ProductConsumerContractV1 (CONSUMER_A5_LIFECYCLE) {
  consumerKey: "A5_LIFECYCLE"
  consumerType: "A5_LIFECYCLE"
  reads: ["product registration", "product compatibility rules"]
  writes: []   // the first product does not introduce a new A5 lifecycle
  reusesSharedAuthority: ["A5 transfer lifecycle", "A5 customer-aware command",
                           "A5 idempotency/outbox/recovery/reconciliation"]
  mustNotDo: ["call a partner from the A5 lifecycle",
              "rewrite A5 history for product correction",
              "create a second A5 lifecycle"]
}

ProductConsumerContractV1 (CONSUMER_A6T05_EXTERNAL_OPERATION) {
  consumerKey: "A6T05_EXTERNAL_OPERATION"
  consumerType: "A6T05_EXTERNAL_OPERATION"
  reads: ["product registration", "product compatibility rules",
          "A6T05 external operation contract"]
  writes: ["A6T05 external operation record (product-safe evidence)"]
  reusesSharedAuthority: ["A6T05 external operation identity",
                           "A6T05 internal/provider idempotency separation",
                           "A6T05 reference uniqueness"]
  mustNotDo: ["use A6T05 external-operation identity as a product command identity",
              "use A6T05 provider reference as a product key",
              "create a parallel external operation authority"]
}

ProductConsumerContractV1 (CONSUMER_A6T06_CALLBACK) {
  consumerKey: "A6T06_CALLBACK"
  consumerType: "A6T06_CALLBACK"
  reads: ["product registration", "product compatibility rules",
          "A6T06 callback authenticity/replay/freshness contract"]
  writes: ["A6T06 callback receipt (product-safe evidence)"]
  reusesSharedAuthority: ["A6T06 callback authentication, replay, freshness",
                           "A6T06 idempotent processing",
                           "A2 protected internal callback route"]
  mustNotDo: ["create a new callback route",
              "accept unauthenticated, stale, replayed, malformed, wrong-partner, or wrong-environment callbacks",
              "write financial state directly from the callback",
              "use A6T06 callback event ID as a product command ID"]
}

ProductConsumerContractV1 (CONSUMER_A6T07_LIFECYCLE) {
  consumerKey: "A6T07_LIFECYCLE"
  consumerType: "A6T07_LIFECYCLE"
  reads: ["product registration", "product state vocabulary",
          "A6T07 lifecycle vocabulary"]
  writes: ["product lifecycle transition (product state vocabulary)"]
  reusesSharedAuthority: ["A6T07 lifecycle", "A6T07 retry/circuit-breaker/unknown recovery"]
  mustNotDo: ["create a second lifecycle authority",
              "introduce a parallel retry/circuit-breaker",
              "clear a partner reference, journal reference, settlement reference, or recovery reference",
              "use A6T07 lifecycle transitions to authorize or settle"]
}

ProductConsumerContractV1 (CONSUMER_A6T08_SETTLEMENT) {
  consumerKey: "A6T08_SETTLEMENT"
  consumerType: "A6T08_SETTLEMENT"
  reads: ["product registration", "product state vocabulary",
          "A6T08 settlement contract"]
  writes: ["A6T08 settlement record (Ledger-owned journal/line)"]
  reusesSharedAuthority: ["A6T08 settlement", "A6T08 suspense", "A6T08 compensating entries",
                           "Ledger", "SettlementAccountService", "Finance/Ledger"]
  mustNotDo: ["create a second settlement authority",
              "create a second settlement or suspense account",
              "auto-clear suspense",
              "treat a partner acknowledgement as settled value",
              "mutate posted journals, lines, balances, or completed A5/A6 history"]
}

ProductConsumerContractV1 (CONSUMER_A6T09_RECONCILIATION) {
  consumerKey: "A6T09_RECONCILIATION"
  consumerType: "A6T09_RECONCILIATION"
  reads: ["product registration", "product state vocabulary",
          "A6T09 reconciliation contract"]
  writes: ["A6T09 reconciliation discrepancy record (read-only)"]
  reusesSharedAuthority: ["A6T09 independent reconciliation",
                           "A6T09 classified support trace",
                           "Reconciliation/Finance"]
  mustNotDo: ["create a new reconciliation writer",
              "repair source records or authorize settlement from a report",
              "expose unrestricted data in reconciliation output"]
}

ProductConsumerContractV1 (CONSUMER_A6T10_DATA_MINIMIZATION) {
  consumerKey: "A6T10_DATA_MINIMIZATION"
  consumerType: "A6T10_DATA_MINIMIZATION"
  reads: ["product registration", "product data fields",
          "A6T10 data classification matrix"]
  writes: ["A6T10 / A7T10 data control audit record"]
  reusesSharedAuthority: ["A6T10 data classification matrix",
                           "A6T10 consent / mandate / retention / legal hold / secret",
                           "A6T10 disclosure audience maximums",
                           "A1 privacy/retention"]
  mustNotDo: ["create a parallel privacy authority",
              "transmit raw credentials, raw callback signatures, full funding credentials, unrestricted risk/compliance data, or unnecessary customer data",
              "expose a public surface without A2 audience authorization",
              "default to external transmission on data-sharing or consent failure"]
}
```

### 10.3 Consumer contract rules

- A consumer contract MUST declare the authority it reuses. A consumer that does not reuse an authority MUST declare the new authority and MUST be rejected by the catalog when the new authority is a prohibited second authority.
- A consumer contract MUST declare its `mustNotDo`. A consumer that attempts a `mustNotDo` action MUST be rejected by the catalog (or by the runtime that consumes the catalog).
- A consumer contract MUST NOT introduce a new authority, a new partner, a new settlement account, a new suspense account, a new reconciliation writer, a new privacy authority, a new policy evaluator, a new preference store, a new funding-instrument store, a new beneficiary store, a new transfer lifecycle, or a new notification intent record.
- A consumer contract MUST NOT authorize, settle, bind, dispatch, or repair. The consumer reads from the catalog and from the shared authority; it does not own a new authority.
- A consumer contract MUST be a single, frozen, catalog-level entry. A new consumer contract requires a new catalog version and a new ADR.

## 11. Integration boundaries

### 11.1 Integration boundary diagram

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
   ProductCompatibilityRuleV1, ProductDependenciesV1, ProductMetadataV1
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

### 11.2 Integration boundary rules

- The product catalog is a read-only lookup. The catalog MUST NOT post, mutate, settle, bind, dispatch, or repair.
- The product boundary is a contract design. A7T02 does not implement the boundary. A later A7 task may implement the boundary behind the catalog and the A6 partner boundary.
- The product consumer contracts reuse shared authorities. A consumer contract that introduces a new authority MUST be rejected by the catalog.
- A consumer MUST consume the catalog and the consumer contract before admitting a product command. A consumer that does not consume the catalog MUST be treated as incompatible.

## 12. Product sandbox/fixture contract and product-independent catalog tests

### 12.1 Sandbox/fixture contract

The product catalog MUST be testable without any live partner, callback, settlement, reconciliation, notification, or A2 surface. A7T11 will record the catalog tests in `docs/A7-INTEGRATION-MATRIX.md`. The sandbox/fixture contract is:

- `ProductCatalogContractV1.getRegistration(productKey)` MUST return a deterministic frozen `ProductRegistrationV1` for a registered product and `null` for an unregistered product, with no side effects.
- `ProductCatalogContractV1.listRegistrations()` MUST return a deterministic list of frozen registrations, with no side effects.
- `ProductCatalogContractV1.assertCompatible(productKey, capabilityKey, action, currency, targetType)` MUST return a frozen `ProductCapabilityRegistrationV1` for a compatible configuration and MUST throw a deterministic non-success result for an incompatible configuration, with no side effects.
- The catalog MUST be deterministic and idempotent. The catalog MUST NOT call a partner, dispatch a notification, post a journal, or write a source record.
- The catalog's fixtures MUST be versioned with the catalog. A7T11 records the fixtures and the catalog tests in the A7 integration matrix.

### 12.2 Product-independent catalog tests

The catalog tests are product-independent: the catalog does not know about the first product's evidence, partner reference, callback, settlement, suspense, reconciliation, or notification details. The catalog only knows about the registration, capability, dependency, compatibility rule, metadata, and consumer contract. A7T11 records the catalog tests in the A7 integration matrix.

## 13. Prohibited dependencies

A registration MUST NOT depend on:

- a new partner beyond the A6 partner boundary (the first product depends on `NIBSS_NIP` only);
- a new policy evaluator beyond A4;
- a new binding authority beyond A3;
- a new wallet or ledger authority beyond Wallet and Ledger;
- a new settlement authority beyond A6T08 / A7T08;
- a new suspense authority beyond A6T08 / A7T08;
- a new reconciliation writer beyond A6T09 / A7T09;
- a new privacy authority beyond A6T10 / A7T10;
- a new customer intent, consent, preference, or notification authority beyond `CustomerPreference` and A7T06;
- a new audit, idempotency, outbox, metrics, or diagnostics store beyond Operations;
- a new public, customer, partner, or support surface beyond the A2 audience authorization;
- a new product, partner, capability, currency, accounting unit, or direction beyond the catalog's frozen registration;
- A8 Scale & Selective Extraction.

A consumer MUST NOT depend on a prohibited authority. The catalog rejects a consumer contract that depends on a prohibited authority.

## 14. Versioning rules

### 14.1 Catalog version

- `catalogVersion = 1` defines this registration, capability, dependency, compatibility, metadata, and consumer contract vocabulary.
- A patch revision may clarify documentation without changing field meaning.
- A minor revision may add optional fields, optional capability metadata, optional consumer contracts, or a second frozen product; it MUST NOT change the meaning of existing fields, the first product's registration, the first product's compatibility rules, or the first product's prohibitions.
- A major revision is required for any change to required fields, identity semantics, currency/accounting semantics, product-state vocabulary, compatibility-rule enforcement, prohibited-dependency list, or the first product's registration.
- Every catalog lookup result identifies the catalog version and the catalog name that produced it. Historical evidence remains interpretable under the version that produced it.
- A `DRAFT` entry MUST NOT be returned to A7 runtime consumers; it exists only for catalog evolution.
- A `RETIRED` entry MUST NOT be reactivated. A successor entry MUST be a new catalog entry under a new product version.

### 14.2 Compatibility rules

- A consumer that depends on a field, identity, or compatibility rule introduced in a newer catalog version MUST be rejected under the older catalog version.
- A consumer that depends on a deprecated field MUST be migrated to the new field or to a documented alternative before the deprecated field is removed.
- A compatibility rule with `enforcement = "FAIL_CLOSED"` MUST continue to fail closed across catalog versions. A rule that previously failed closed MUST NOT be relaxed without a new ADR.

## 15. Data safety and evidence minimization

- The catalog does not store or return raw credentials, raw callback signatures, raw provider payloads, raw risk/compliance content, or unnecessary customer data.
- The catalog returns safe references (`ProductKeyV1`, `ProductCommandId`, `ProductOperationId`, `A4ProductPolicyReference`, `A6ExternalOperationReference`, `A6CallbackReceiptReference`, `A6SettlementReference`, `A6ReconciliationReference`, `A6DataControlReference`) rather than raw evidence.
- A consumer that needs raw evidence reads it from the appropriate shared authority (A6T05, A6T06, A6T08, A6T09, A6T10, A7T10). The catalog does not proxy raw evidence.
- A consumer MUST NOT log, trace, or surface raw evidence outside the classified audience for the consumer.

## 16. Contract scenarios

### 16.1 Catalog lookup for a registered product

```text
request: getRegistration(productKey = "VIRTUAL_ACCOUNT")
result:
  registration: ProductRegistrationV1 (VIRTUAL_ACCOUNT v1, ACTIVE)
  side effects: none
  classification: SAFE (no credentials, no partner, no settlement)
```

### 16.2 Compatibility check for a compatible capability

```text
request: assertCompatible(
  productKey = "VIRTUAL_ACCOUNT",
  capabilityKey = "virtual-account.assign",
  action = "assign",
  currency = "NGN",
  targetType = "BANK_ACCOUNT")
result:
  capability: ProductCapabilityRegistrationV1 (virtual-account.assign)
  compatibilityRules: all FAIL_CLOSED rules pass
  side effects: none
```

### 16.3 Compatibility check for an incompatible configuration

```text
request: assertCompatible(
  productKey = "VIRTUAL_ACCOUNT",
  capabilityKey = "virtual-account.assign",
  action = "assign",
  currency = "USD",
  targetType = "BANK_ACCOUNT")
result:
  capability: not found
  failedRules: [RULE_CURRENCY_NGN_ONLY]
  side effects: none
```

### 16.4 Catalog lookup for a prohibited configuration

```text
request: listRegistrations()
consumer: CONSUMER_A5_LIFECYCLE (does not declare a new lifecycle authority)
result:
  registrations: [VIRTUAL_ACCOUNT v1]
  prohibitions: [
    PROHIBIT_SECOND_PRODUCT,
    PROHIBIT_SECOND_PARTNER,
    PROHIBIT_PRICING_FEES_COMMISSIONS,
    PROHIBIT_PUBLIC_SURFACE,
    PROHIBIT_A8_SCOPE
  ]
  side effects: none
```

The catalog returns the prohibitions so the consumer can verify its own configuration against the catalog's authoritative prohibition list.

## 17. Handoff to later A7 tasks

This contract is consumed later as follows:

- **A7T03:** extends the A4 capability/policy machinery with a product-specific profile for `VIRTUAL_ACCOUNT` v1 capabilities; it MUST NOT create a second policy evaluator; it MUST reuse the A4 decision vocabulary and persistence.
- **A7T04:** defines the product customer-binding consumer for `VIRTUAL_ACCOUNT` v1; it MUST defer internal account selection to A3; it MUST NOT infer an A3 binding from product data.
- **A7T05:** defines the durable product command and product operation identity for `VIRTUAL_ACCOUNT` v1; it MUST remain distinct from A6T05 external-operation identity and from A5 internal command identity; it MUST use Operations-backed idempotency with a separate product scope.
- **A7T06:** establishes the A7 notification dispatcher that reads from `CustomerPreference.notifications`; it MUST NOT create a parallel customer intent/consent/notification authority; it MUST NOT dispatch a notification without the customer intent.
- **A7T07:** defines the product lifecycle states reusing the A6T07 vocabulary; it MUST NOT create a parallel lifecycle authority; it MUST NOT clear a partner reference, journal reference, settlement reference, or recovery reference.
- **A7T08:** integrates the verified product financial effect with the A6T08 settlement, suspense, compensating entries, and Finance/Ledger-approved chart dimensions for `VIRTUAL_ACCOUNT` v1; it MUST NOT introduce a new settlement authority, a new settlement account, a new suspense account, or a new financial correction authority.
- **A7T09:** builds on the A6T09 read-only reconciliation engine to include the `VIRTUAL_ACCOUNT` v1 product operation, A6 partner reference, A6T08 settlement evidence, and A7T05 product command evidence; it MUST NOT introduce a new reconciliation writer.
- **A7T10:** extends the A6T10 data-classification matrix with the `VIRTUAL_ACCOUNT` v1 product data fields; it MUST NOT create a parallel privacy authority; it MUST reuse the A6T10 / A7T10 consent, retention, legal hold, secret, and disclosure controls.
- **A7T11:** records the A7 release gate, rollback, disable, and A8 handoff evidence; it MUST NOT begin A8.

No later task may weaken the catalog's product identity, product-state vocabulary, dependency declaration, compatibility rule, prohibited-dependency, or consumer-contract boundaries defined here.

## 18. Verification record

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
- [x] No A7 runtime catalog, product module, entity, migration, repository, service, controller, API, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, or A8 work is introduced by A7T02.
- [ ] A7T03+ implementation remains intentionally incomplete until A7T03, A7T04, A7T05, A7T06, A7T07, A7T08, A7T09, A7T10, and A7T11 each pass their own acceptance criteria.

## 19. Authoring note

The A7 plan reserves the proposed A7 ADR range `ADR-0054` through `ADR-0060`. The first A7 ADR is `ADR-0054 — Virtual Account Product Boundary`, which records the catalog decision, the first product's frozen registration, the first product's A6 partner dependency, the first product's compatibility rules, the first product's prohibited edges, and the consumer-contract boundary between the A7 product catalog and the shared authorities. `ADR-0054` is committed as the decision record for the A7T02 catalog freeze; the ADR body mirrors this contract and does not introduce any new runtime code.
