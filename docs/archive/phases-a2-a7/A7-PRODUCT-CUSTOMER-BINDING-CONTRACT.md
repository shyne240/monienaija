# A7T04 — A7 Product Customer-Binding, Ownership, and Internal Account Mapping

- **Phase:** A7 — Product Expansion Infrastructure
- **Task:** A7T04 — Product Customer-Binding, Ownership, and Internal Account Mapping
- **Status:** A7 product customer-binding consumer contract designed; A3 binding-read consumer designed; virtual-account identifier ownership evidence, A6 partner dependency, partner reference handling, and explicit internal/external account mapping defined; no A7 runtime product customer-binding implementation introduced beyond the A3 / virtual-account / A6 partner consumer contract
- **Contract:** `A7ProductCustomerBindingContractV1` / `A7ProductCustomerBindingMapV1` / `A7ProductCustomerBindingVerificationFailureV1` / `A7ProductCustomerBindingHandoffTokenV1` / `A7ProductCustomerBindingSourceEvidenceV1`
- **Mapping version:** `A7-PRODUCT-CUSTOMER-BINDING` v1
- **Selected A7 first product (frozen registration):** `VIRTUAL_ACCOUNT` v1 (per [A7T01](A7-PRODUCT-EXPANSION-BASELINE.md) and [A7T02](A7-PRODUCT-CATALOG-CONTRACT.md))
- **Upstream authorities consumed (not replaced):** A2 authorization, A3 customer-to-financial-account binding, A4 product-policy profile (A7T03), A5 internal lifecycle, A6 partner-adapter boundary, existing `virtual-account` module (compatibility input), existing `customer-funding-instrument` and `customer-beneficiary` modules (compatibility input), existing `bank` module (compatibility input), `CustomerPreference` (intent authority)
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, and A8 changes:** None (A7T04 is a documentation and consumer-boundary artifact; the A3 `customer_financial_account_bindings` table is read without mutation; the existing `virtual_accounts` table is read as compatibility evidence; the A6 `external_operations`, `external_callback_receipts`, and `external_settlements` tables are referenced as partner-evidence compatibility input; no new table, no new column, no new index, no new trigger, no new entity, no new migration)

This document defines the A7 product customer-binding, ownership, and explicit internal/external account mapping contract that the A7 first product (`VIRTUAL_ACCOUNT` v1) consumes. It defers internal account selection to A3. It defers partner reference handling to A6. It does not infer an internal account from a virtual-account identifier, a partner reference, a preference value, or product data. It does not create a second customer-binding system, a second policy evaluator, a second authorization system, a second settlement authority, or a second reconciliation engine.

## 1. Contract boundary

### 1.1 Purpose

The A7 product customer-binding contract is a consumer-boundary between the A7 first product and the A3 customer-binding authority. The A7 product customer-binding service reads the A3 internal account binding tuple, the existing `virtual-account` identifier ownership evidence, the A6 partner reference, and the A6 partner identity; it does not mutate any of them.

```text
A2 authorization context (A2 principal, audience, scopes, customer access)
  + A4 product-policy decision reference (A7T03)
  + A7 product catalog registration (A7T02: productKey, capabilityKey, action, currency, accountingUnit, targetType)
  + A7 product command identity (A7T05; deferred; this contract requires the command identity and A4 reference as inputs)
  + A7 product state (A7T02 product-state vocabulary)
  -> A7ProductCustomerBindingService
       -> A7ProductCustomerBindingMapV1
            Customer.id
            CustomerWallet.id
            CustomerFinancialAccountBinding.id
            WalletAccount.id
            LedgerAccount.id
            VirtualAccount.id
            VirtualAccount.{provider, accountNumber, accountName, bankCode}
            VirtualAccount.reference
            VirtualAccount.status
            VirtualAccount.assignedAt
            A6PartnerIdentity.{partnerKey, capabilityKey, operationType}
            A6PartnerReference.{referenceType, value, namespace, observedAt, source}
       -> A7ProductCustomerBindingHandoffTokenV1
            a7ProductCustomerBindingMapReference
            a6PartnerReference
            a6PartnerIdentity
            currency, accountingUnit
            policyDecisionReference
            a2AuthorizationContextReference
```

The A7 product customer-binding map is a read-only consumer-boundary artifact. It is consumed by A7T05 (product command identity), A7T07 (product lifecycle), A7T08 (product financial effect), and A7T09 (product reconciliation). It is not a new authority, a new binding, a new partner contract, a new policy decision, a new financial effect, or a new notification.

### 1.2 Normative language

- **MUST** means a required contract invariant.
- **MUST NOT** means a prohibited state, dependency, or interpretation.
- **SHOULD** means the default behavior unless a later approved product contract documents a safer alternative.
- **MAY** means an optional field or later product-extension point that cannot weaken an invariant.
- **A3 binding** means the A3 `CustomerFinancialAccountBinding` record that links `Customer.id` → `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`. A3 is the only customer-binding authority.
- **A6 partner reference** means a provider-side identifier produced by the existing A6 partner boundary (A6T05 `ProviderReferenceV1`). The A6 partner boundary is the only partner-reference authority.
- **Virtual-account identifier** means the existing `VirtualAccount` row produced by the existing `virtual-account` module. The existing module is a compatibility input; A7T04 reads it but does not re-implement it.
- **A2 authorization** means the A2 `AuthorizationDecision` produced by the existing A2 `AuthorizationService`. A2 is the only authorization authority.
- **A4 product-policy decision** means the A4 `PolicyDecisionResult` produced by the A7T03 A4 product-policy service. A4 is the only policy authority.
- **A7 product catalog** means the A7T02 product catalog registration. The A7 product catalog is the only A7 product boundary.

### 1.3 Contract port shape

The logical A7 product customer-binding port is equivalent to:

```text
A7ProductCustomerBindingContractV1
  resolveProductCustomerBinding(
    command: A7ProductCustomerBindingCommandV1
  )
    -> A7ProductCustomerBindingResultV1

  issueHandoffToken(
    map: A7ProductCustomerBindingMapV1
  )
    -> A7ProductCustomerBindingHandoffTokenV1

  getVerifiedProductCustomerBindingMap(
    customerId: UUID,
    virtualAccountId: UUID | null,
    partnerKey: A6PartnerKey,
    partnerReference: A6PartnerReference | null
  )
    -> A7ProductCustomerBindingMapV1 | null
```

The A7 product customer-binding port is read-only with respect to A3, the existing `virtual-account` module, the A6 partner boundary, the A2 authorization authority, the A4 product-policy authority, and the A7 product catalog.

### 1.4 Mapping version and selection rule

The mapping version is:

```text
mappingName:     "A7-PRODUCT-CUSTOMER-BINDING"
mappingVersion:  1
```

Every product customer-binding map, ownership evidence, partner reference, handoff token, and verification failure in this document is part of `A7-PRODUCT-CUSTOMER-BINDING` v1. A later mapping version (v2) may add optional fields, optional evidence sources, or a second frozen product customer-binding shape; it MUST NOT weaken v1 invariants or silently re-broaden the v1 first-product customer-binding contract. The first product's product customer-binding map is recorded as a single frozen shape in [§4](#4-first-product-customer-binding-map).

### 1.5 Selected first-product customer-binding map (frozen summary)

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
internalBinding:      A3 (CustomerFinancialAccountBinding)
partnerReference:     A6 (ExternalOperation / ExternalSettlement / ExternalCallbackReceipt)
virtualAccount:       existing module (compatibility input; provider, accountNumber, accountName, bankCode)
fundingTarget:        existing customer-funding-instrument or customer-beneficiary (compatibility input)
```

## 2. Canonical identity and mapping rules

### 2.1 Identity vocabulary

```text
CustomerIdV1                                 UUID (canonical internal customer identity)
CustomerWalletIdV1                           UUID (canonical internal customer-wallet identity)
CustomerFinancialAccountBindingIdV1          UUID (A3 binding record id)
WalletAccountIdV1                            UUID (canonical internal financial-wallet facade id)
LedgerAccountIdV1                            UUID (canonical internal Ledger account id)
VirtualAccountIdV1                           UUID (existing module; A7 reads it as evidence)
A6PartnerKeyV1                                A6 partner identifier (NIBSS_NIP)
A6PartnerCapabilityKeyV1                      A6 partner capability key
A6PartnerOperationTypeV1                      A6 partner operation type
A6PartnerReferenceTypeV1                      A6 provider reference type
A6PartnerReferenceValueV1                     A6 provider reference value
A2AuthorizationContextReferenceV1             A2 authorization context reference
A4ProductPolicyDecisionReferenceV1           A4 product-policy decision reference
A7ProductCommandIdV1                          A7 product command id (defined in A7T05)
A7ProductOperationIdV1                        A7 product operation id (defined in A7T05)
```

The canonical internal customer identity is `Customer.id`. The A3 binding tuple is the only source of `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`. The A7 product customer-binding service never chooses an internal account from a virtual-account identifier, a partner reference, a preference value, or product data.

### 2.2 Canonical identity rules

- `Customer.id` MUST be the only canonical internal customer identity. A virtual-account identifier, a bank code, a bank account number, a partner reference, a provider reference, a payment reference, a funding-instrument identifier, a beneficiary identifier, a notification identifier, or a product command id MUST NOT become or substitute for `Customer.id`.
- The A3 `CustomerFinancialAccountBinding` record is the only source of `CustomerWallet.id`, `WalletAccount.id`, and `LedgerAccount.id`. The A7 product customer-binding service MUST read these ids from the A3 binding record and MUST NOT derive them from any other source.
- The existing `VirtualAccount` row is a compatibility evidence record. The A7 product customer-binding service MUST read `VirtualAccount.{id, provider, accountNumber, accountName, bankCode, reference, status, assignedAt, deactivatedAt}` from the existing module and MUST NOT mutate the existing module to make a product customer-binding pass.
- The A6 partner identity (`NIBSS_NIP`) and the A6 partner reference are A6 boundary inputs. The A7 product customer-binding service MUST read them from the A6 partner boundary and MUST NOT mutate the A6 partner boundary to make a product customer-binding pass.
- The A2 `AuthorizationDecision` is the only authorization authority. The A7 product customer-binding service MUST record the A2 authorization-context reference and MUST NOT issue, refresh, mutate, or substitute it.
- The A4 `PolicyDecisionResult.decisionReference` is the only policy authority. The A7 product customer-binding service MUST record the A4 product-policy decision reference and MUST NOT evaluate, mutate, or substitute it.

### 2.3 Identity separation matrix

| Identity                                                  | Owner                                                | A7T04 read relationship                                                                                | A7T04 MUST NOT do                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `Customer.id`                                              | Customer module                                       | Correlation only; never internal account source                                                          | Treat customer reference as virtual-account, partner reference, or product key      |
| `CustomerWallet.id`                                        | Customer-wallet module                                | Read from A3 binding record; never infer                                                                  | Treat customer-wallet id as virtual-account or partner reference                   |
| `CustomerFinancialAccountBinding.id`                       | A3                                                    | The only source of internal account tuple                                                                  | Repair, reassign, activate, or close an A3 binding to make a binding map pass      |
| `WalletAccount.id`                                         | Wallet module                                         | Read from A3 binding record                                                                              | Treat wallet id as virtual-account or partner reference                            |
| `LedgerAccount.id`                                         | Ledger module                                         | Read from A3 binding record                                                                              | Treat ledger id as virtual-account or partner reference                            |
| A4 `PolicyDecisionResult.decisionReference`                | A4                                                    | Read the A7T03 A4 product-policy decision reference                                                      | Evaluate or mutate A4 policy/source evidence                                       |
| A2 `AuthorizationDecision.principalId` / `action`          | A2                                                    | Read the A2 authorization context reference                                                              | Authorize, issue, refresh, or substitute A2 authorization                            |
| A6 `ProviderReferenceV1`                                    | A6 partner-adapter boundary                            | Read the partner reference (operation, callback, settlement, statement, idempotency)                       | Issue, refresh, or substitute an A6 partner reference                                |
| `VirtualAccount.{id, provider, accountNumber, accountName, bankCode, reference, status, assignedAt, deactivatedAt}` | existing `virtual-account` module (compatibility input) | Read as ownership evidence; never internal account source                                                  | Mutate, deactivate, or substitute the existing `VirtualAccount` row                |
| `CustomerFundingInstrument` / `CustomerBeneficiary`         | A6T04 consumer (compatibility input)                    | Read as the A6T04 funding-target evidence; the A7 product customer-binding service MUST NOT infer an internal account from them | Mutate ownership, verification, or status to make a product customer-binding pass  |
| `Bank`                                                     | existing `bank` module (compatibility input)              | Read as the A6T04 funding-target evidence; the A7 product customer-binding service MUST NOT infer an internal account from them | Mutate or substitute the bank directory                                            |
| `payment_reference`                                         | `payment` module (compatibility input)                    | Read as cross-domain correlation evidence (the existing `VirtualAccount.reference` is a payment reference) | Treat payment reference as internal account source                                  |

## 3. Product customer-binding command

### 3.1 Command envelope

```text
A7ProductCustomerBindingCommandV1 {
  contractName: "A7-PRODUCT-CUSTOMER-BINDING"
  contractVersion: 1

  productKey: A7ProductKey                            (frozen; reused from A7 product catalog)
  productVersion: A7ProductVersion                   (frozen; reused from A7 product catalog)
  capabilityKey: A7ProductCapabilityKey               (frozen; reused from A7 product catalog)
  action: A7ProductAction                            (frozen; reused from A7 product catalog)
  productState: A7ProductState                       (reused from A7 product-state vocabulary)

  customerId: UUID                                    (canonical Customer.id)
  customerWalletId: UUID | null                       (canonical CustomerWallet.id; MUST be supplied by the consumer from the A3 binding recheck)
  bindingId: UUID | null                             (A3 CustomerFinancialAccountBinding.id; MUST be supplied by the consumer from the A3 binding recheck)
  bindingVersion: number | null                      (A3 binding version; consumed at A3 recheck)

  virtualAccount: {
    virtualAccountId: UUID | null                    (existing module; A7 reads it as compatibility evidence)
    provider: string                                  (e.g., "NIBSS_NIP")
    accountNumber: string                             (e.g., "0123456789")
    accountName: string                              (e.g., "MONIENAIJA/ACME LIMITED")
    bankCode: string                                  (e.g., "999")
    expectedReference: string | null                 (existing module's `VirtualAccount.reference`; A7 reads it as compatibility evidence)
    expectedAssignedAt: string | null                (existing module's `VirtualAccount.assignedAt`; A7 reads it as compatibility evidence)
  }

  a6PartnerIdentity: {
    partnerKey: A6PartnerKey                          (e.g., "NIBSS_NIP")
    capabilityKey: A6PartnerCapabilityKey            (e.g., "external.wallet.withdrawal.settlement")
    operationType: A6PartnerOperationType            (e.g., "OUTBOUND_BANK_SETTLEMENT")
  }

  a6PartnerReference: A6PartnerReference | null      (A6 ProviderReferenceV1; the A6 boundary supplies it; A7 MUST NOT synthesize it)

  a4ProductPolicyDecisionReference: string           (A4 PolicyDecisionResult.decisionReference; A7T03 supplies it)

  a2AuthorizationContextReference: string            (A2 AuthorizationDecision; A2 supplies it; A7 MUST NOT synthesize it)

  requestContext: RequestContext
  principal: AuthorizationPrincipal
  idempotencyKey: string
}
```

The A7 product customer-binding service accepts the command, validates the A2 authorization context reference, validates the A4 product-policy decision reference, validates the A7 product catalog registration, validates the A6 partner identity and the A6 partner reference, reads the existing `VirtualAccount` row, reads the A3 binding record, builds the `A7ProductCustomerBindingMapV1`, and returns it. The A7 product customer-binding service does not write any record.

### 3.2 Command rules

- A command MUST declare exactly one `productKey`, `productVersion`, `capabilityKey`, `action`, and `productState`.
- A command MUST declare a `customerId`, a `customerWalletId`, a `bindingId`, and a `bindingVersion`. The A7 product customer-binding service MUST NOT derive these ids from a virtual-account identifier, a partner reference, a preference value, or product data.
- A command MUST declare a `virtualAccount.{virtualAccountId, provider, accountNumber, accountName, bankCode}`. The A7 product customer-binding service MUST verify that the `VirtualAccount` row exists, is ACTIVE, is owned by the A3-bound `CustomerWallet.id`, and is consistent with the declared `provider`, `accountNumber`, `accountName`, and `bankCode`. A mismatch MUST fail closed.
- A command MUST declare the A6 partner identity and the A6 partner reference. The A6 partner reference is optional only if the A6 partner has not yet acknowledged a product operation. The A7 product customer-binding service MUST NOT invent a partner reference.
- A command MUST declare the A4 product-policy decision reference. The A4 reference MUST be a non-empty, syntactically valid `A4PolicyDecisionResult.decisionReference`. The A7 product customer-binding service MUST NOT re-evaluate the A4 product-policy decision.
- A command MUST declare the A2 authorization context reference. The A2 reference MUST be a non-empty, syntactically valid `A2AuthorizationContextReference`. The A7 product customer-binding service MUST NOT re-authorize the command.
- A command MUST declare a non-empty `idempotencyKey` and a valid `requestContext`. The A7 product customer-binding service does not write an idempotency record; it consumes the A4 product-policy idempotency, the A6 partner idempotency, and the A2 authorization context for the underlying command.

## 4. First product customer-binding map

### 4.1 Map envelope

```text
A7ProductCustomerBindingMapV1 {
  mapReference: string
  mapContractName: "A7-PRODUCT-CUSTOMER-BINDING"
  mapContractVersion: 1
  productKey: A7ProductKey
  productVersion: A7ProductVersion
  capabilityKey: A7ProductCapabilityKey
  action: A7ProductAction
  productState: A7ProductState

  customer: {
    customerId: UUID
    customerWalletId: UUID
    customerVersion: number
    customerWalletVersion: number
  }

  a3Binding: {
    bindingId: UUID
    bindingVersion: number
    bindingState: "ACTIVE"
    currency: "NGN"
    accountingUnit: "CUSTOMER_FUNDS"
  }

  internalAccount: {
    walletAccountId: UUID
    ledgerAccountId: UUID
    walletStatus: "ACTIVE"
    ledgerIsActive: true
    ledgerAccountType: "LIABILITY"
    ledgerNormalBalance: "CREDIT"
    ledgerAllowNegativeBalance: false
    currency: "NGN"
    accountingUnit: "CUSTOMER_FUNDS"
  }

  virtualAccount: {
    virtualAccountId: UUID
    provider: string
    accountNumber: string
    accountName: string
    bankCode: string
    reference: string
    status: "ACTIVE"
    assignedAt: string
    deactivatedAt: null
    ownerCustomerWalletId: UUID
    ownerCustomerId: UUID
  }

  a6PartnerIdentity: {
    partnerKey: A6PartnerKey
    capabilityKey: A6PartnerCapabilityKey
    operationType: A6PartnerOperationType
    environment: "sandbox" | "production"
  }

  a6PartnerReference: A6PartnerReference | null
  a6ExternalOperationId: string | null
  a6CallbackReceiptId: string | null
  a6SettlementId: string | null

  a4ProductPolicyDecisionReference: string
  a2AuthorizationContextReference: string

  ownership: {
    virtualAccountOwnerMatchesBinding: true
    fundingTargetOwnerMatchesBinding: true
    bankDirectorySupported: true
    consentCurrent: true
    mandateCurrent: true
    purposeCompatible: true
    currencyCompatible: true
    limitCompatible: true
  }

  createdAt: string
  requestContext: RequestContext
}
```

A map is a single, frozen, A7T04 product-customer-binding artifact. The A7 product customer-binding service does not mutate the map after construction. The map is consumed by A7T05 (product command identity), A7T07 (product lifecycle), A7T08 (product financial effect), and A7T09 (product reconciliation).

### 4.2 First-product customer-binding map (frozen)

The first product's customer-binding map is bound to the A7T02 frozen first-product registration:

```text
A7ProductCustomerBindingMapV1 (VIRTUAL_ACCOUNT v1, virtual-account.assign) {
  productKey:           "VIRTUAL_ACCOUNT"
  productVersion:       1
  capabilityKey:        "virtual-account.assign"
  action:               "assign"
  productState:         "ASSIGN_REQUESTED" | "ASSIGN_PENDING" | "ASSIGN_ACTIVE" | "ASSIGN_SUSPENDED" | "ASSIGN_FAILED" | "ASSIGN_CLOSED"

  customer: {
    customerId:           <canonical Customer.id from A3 binding record>
    customerWalletId:     <canonical CustomerWallet.id from A3 binding record>
    customerVersion:      <A3 binding.sourceCustomerVersion>
    customerWalletVersion:<A3 binding.sourceCustomerWalletVersion>
  }
  a3Binding: {
    bindingId:            <A3 binding.id>
    bindingVersion:       <A3 binding.version>
    bindingState:         "ACTIVE"
    currency:             "NGN"
    accountingUnit:       "CUSTOMER_FUNDS"
  }
  internalAccount: {
    walletAccountId:      <A3 binding.walletAccountId>
    ledgerAccountId:      <A3 binding.ledgerAccountId>
    walletStatus:         "ACTIVE"
    ledgerIsActive:       true
    ledgerAccountType:    "LIABILITY"
    ledgerNormalBalance:  "CREDIT"
    ledgerAllowNegativeBalance: false
    currency:             "NGN"
    accountingUnit:       "CUSTOMER_FUNDS"
  }
  virtualAccount: {
    virtualAccountId:     <existing VirtualAccount.id>
    provider:             "NIBSS_NIP"
    accountNumber:        <existing VirtualAccount.accountNumber>
    accountName:          <existing VirtualAccount.accountName>
    bankCode:             <existing VirtualAccount.bankCode>
    reference:            <existing VirtualAccount.reference>
    status:               "ACTIVE"
    assignedAt:           <existing VirtualAccount.assignedAt>
    deactivatedAt:        null
    ownerCustomerWalletId:<existing VirtualAccount.walletId == A3 binding.customerWalletId>
    ownerCustomerId:      <A3 binding.customerId>
  }
  a6PartnerIdentity: {
    partnerKey:           "NIBSS_NIP"
    capabilityKey:        "external.wallet.withdrawal.settlement"
    operationType:        "OUTBOUND_BANK_SETTLEMENT"
    environment:          "sandbox" | "production"
  }
  a6PartnerReference:    <A6 ProviderReferenceV1> | null
  a4ProductPolicyDecisionReference: <A4 PolicyDecisionResult.decisionReference>
  a2AuthorizationContextReference:  <A2 AuthorizationDecision.evaluatedAt derived reference>
  ownership: {
    virtualAccountOwnerMatchesBinding: true
    fundingTargetOwnerMatchesBinding: true
    bankDirectorySupported:            true
    consentCurrent:                    true
    mandateCurrent:                    true
    purposeCompatible:                 true
    currencyCompatible:                true
    limitCompatible:                    true
  }
  createdAt:             <RFC3339 UTC timestamp at A7T04 map construction>
}
```

The first product's `virtual-account.inbound-funding` capability uses the same map shape; the `productState` field carries the `FUNDING_*` lifecycle state from the A7T02 product-state vocabulary. The A7 product customer-binding service does not change the A3 binding tuple when the lifecycle state changes; the A3 binding tuple is the only source of internal account identity.

## 5. Verification, ownership, status, expiry, consent/mandate, currency, limit, and product-purpose checks

### 5.1 Verification check

The A7 product customer-binding service verifies that the A3 binding record is ACTIVE and that the `customerVersion` and `customerWalletVersion` recorded on the A3 binding match the current `Customer.version` and `CustomerWallet.version`. A `STALE_BINDING` or `BINDING_NOT_ACTIVE` outcome from the A3 recheck MUST fail closed.

### 5.2 Ownership check

The A7 product customer-binding service verifies that the existing `VirtualAccount.walletId` is equal to the A3-bound `CustomerWallet.id`. A mismatch MUST fail closed with `VIRTUAL_ACCOUNT_OWNER_MISMATCH`. The A7 product customer-binding service MUST NOT reassign the existing `VirtualAccount.walletId` to make the check pass.

### 5.3 Status check

The A7 product customer-binding service verifies that the existing `VirtualAccount.status` is `ACTIVE`. A `DEACTIVATED` or missing `VirtualAccount` row MUST fail closed with `VIRTUAL_ACCOUNT_INACTIVE` or `VIRTUAL_ACCOUNT_MISSING`.

### 5.4 Expiry check

The A7 product customer-binding service verifies that the A4 product-policy decision has not expired (`A4 PolicyDecisionResult.expiresAt > now`) and that the A2 authorization context is current. An expired A4 decision or A2 context MUST fail closed with `A4_POLICY_DECISION_EXPIRED` or `A2_AUTHORIZATION_STALE`. The A7 product customer-binding service does not refresh either authority.

### 5.5 Consent/mandate check

The A7 product customer-binding service verifies that the A6T04 consumer contract's `ExternalFundingTargetConsentAssertion` is present (the A6T04 consumer contract is the existing read-only A6 boundary input). A missing, expired, or invalid consent MUST fail closed with `CONSENT_INVALID`. The A7 product customer-binding service MUST NOT mutate the consent.

### 5.6 Currency check

The A7 product customer-binding service verifies that the A3 binding `currency` equals the A4 product-policy decision's currency equals the A6T04 funding-target currency equals `NGN`. A mismatch MUST fail closed with `CURRENCY_MISMATCH`. The A7 product customer-binding service MUST NOT convert, revalue, or substitute the currency.

### 5.7 Limit check

The A7 product customer-binding service verifies that the A4 product-policy decision's `ALLOW_WITH_LIMITS.maxAmountMinor` (when present) is greater than or equal to the A7 product command's `amountMinor`. An under-limit decision MUST fail closed with `POLICY_LIMIT_INSUFFICIENT`. The A7 product customer-binding service does not re-evaluate the limit.

### 5.8 Product-purpose check

The A7 product customer-binding service verifies that the A7 product command's `purpose` (e.g., `OUTBOUND_BANK_SETTLEMENT`) is compatible with the A6 partner capability's `operationType`. A purpose mismatch MUST fail closed with `PRODUCT_PURPOSE_MISMATCH`. The A7 product customer-binding service MUST NOT extend the partner capability.

### 5.9 Missing, stale, revoked, blocked, expired, mismatched, or unavailable behavior

| Evidence state                                                   | Verification result (failure code)                              | Map outcome           |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | --------------------- |
| A3 binding missing / not ACTIVE                                    | `A3_BINDING_MISSING` / `A3_BINDING_NOT_ACTIVE`                  | Deny (fail closed)     |
| A3 `customerVersion` / `customerWalletVersion` stale                | `A3_STALE_BINDING`                                              | Deny (fail closed)     |
| A3 `currency` ≠ A4 decision currency                                | `CURRENCY_MISMATCH`                                              | Deny (fail closed)     |
| A3 `currency` ≠ A6T04 funding-target currency                       | `CURRENCY_MISMATCH`                                              | Deny (fail closed)     |
| A3 `accountingUnit` ≠ `CUSTOMER_FUNDS`                              | `ACCOUNTING_UNIT_MISMATCH`                                       | Deny (fail closed)     |
| `VirtualAccount` row missing                                       | `VIRTUAL_ACCOUNT_MISSING`                                       | Deny (fail closed)     |
| `VirtualAccount.status` ≠ `ACTIVE`                                  | `VIRTUAL_ACCOUNT_INACTIVE`                                       | Deny (fail closed)     |
| `VirtualAccount.walletId` ≠ A3 binding `customerWalletId`           | `VIRTUAL_ACCOUNT_OWNER_MISMATCH`                                 | Deny (fail closed)     |
| `VirtualAccount.provider` ≠ declared `provider`                      | `VIRTUAL_ACCOUNT_PROVIDER_MISMATCH`                              | Deny (fail closed)     |
| `VirtualAccount.accountNumber` ≠ declared `accountNumber`             | `VIRTUAL_ACCOUNT_NUMBER_MISMATCH`                                | Deny (fail closed)     |
| `VirtualAccount.bankCode` not in active NIP-supported bank directory | `BANK_NOT_SUPPORTED`                                              | Deny (fail closed)     |
| A4 product-policy decision missing / expired                        | `A4_POLICY_DECISION_MISSING` / `A4_POLICY_DECISION_EXPIRED`     | Deny (fail closed)     |
| A4 product-policy decision pending review / denied / suspended      | `A4_POLICY_DECISION_NOT_EXECUTABLE`                              | Deny (fail closed)     |
| A2 authorization context missing / stale                            | `A2_AUTHORIZATION_MISSING` / `A2_AUTHORIZATION_STALE`            | Deny (fail closed)     |
| A6 partner reference missing / not authenticated                    | `A6_PARTNER_REFERENCE_MISSING`                                   | Deny (fail closed)     |
| A6 partner reference replay / not fresh                             | `A6_PARTNER_REFERENCE_REPLAYED` / `A6_PARTNER_REFERENCE_STALE`   | Deny (fail closed)     |
| A6T04 consent missing / expired / mismatched                        | `CONSENT_INVALID`                                                | Deny (fail closed)     |
| A6T04 funding-target purpose mismatch                               | `PRODUCT_PURPOSE_MISMATCH`                                        | Deny (fail closed)     |
| A4 product-policy limit insufficient for amount                     | `POLICY_LIMIT_INSUFFICIENT`                                       | Deny (fail closed)     |
| A6 partner connection disabled / not configured                     | `A6_PARTNER_CONNECTION_UNAVAILABLE`                              | Deny (fail closed)     |
| A6T04 funding-target evidence unavailable                          | `A6T04_TARGET_SOURCE_UNAVAILABLE`                                 | Deny (fail closed)     |
| Operations audit / idempotency / outbox unavailable                 | `OPERATIONS_EVIDENCE_UNAVAILABLE`                                 | Deny (fail closed)     |

A controlled denial, pending, manual-review, or unknown outcome is the only safe response. The A7 product customer-binding service MUST NOT retry an ambiguous outcome, edit an A3 binding, deactivate or reassign a `VirtualAccount`, or substitute a partner reference to make a check pass.

## 6. Tokenized or reference-only handoff from the product to the A6 partner boundary

### 6.1 Handoff token envelope

```text
A7ProductCustomerBindingHandoffTokenV1 {
  contractName: "A7-PRODUCT-CUSTOMER-BINDING"
  contractVersion: 1

  mapReference: string
  productKey: A7ProductKey
  capabilityKey: A7ProductCapabilityKey
  action: A7ProductAction
  productState: A7ProductState

  customerId: UUID
  customerWalletId: UUID
  bindingId: UUID
  bindingVersion: number
  walletAccountId: UUID
  ledgerAccountId: UUID
  currency: "NGN"
  accountingUnit: "CUSTOMER_FUNDS"

  virtualAccountReference: string                    (existing VirtualAccount.reference; safe cross-domain value)
  virtualAccountIdentifierHash: string                (SHA-256 of provider|accountNumber|accountName|bankCode)
  virtualAccountProvider: string                    ("NIBSS_NIP")
  virtualAccountBankCode: string                     (e.g., "999")
  virtualAccountAssignedAt: string                  (RFC3339 UTC)

  a6PartnerIdentity: {
    partnerKey: A6PartnerKey
    capabilityKey: A6PartnerCapabilityKey
    operationType: A6PartnerOperationType
    environment: "sandbox" | "production"
  }

  a6PartnerReference: A6PartnerReference | null

  a4ProductPolicyDecisionReference: string
  a2AuthorizationContextReference: string

  issuedAt: string
  expiresAt: string
  correlationId: string
  requestId: string
}
```

The A7 product customer-binding service issues the handoff token only after the map is verified. The handoff token is reference-only: it carries the `VirtualAccount.reference` (which is a safe cross-domain `payment_reference` produced by the existing `payment-reference` service), the A6 partner identity, the A6 partner reference, the A4 product-policy decision reference, the A2 authorization context reference, and the A3 binding tuple. The handoff token MUST NOT carry raw credentials, signatures, private keys, full risk/compliance content, PAN/account secrets, PINs, OTPs, or unrestricted customer data.

### 6.2 Handoff rules

- The A7 product customer-binding service MUST issue a handoff token only for a verified map. An unverified map MUST NOT produce a handoff token.
- The A7 product customer-binding service MUST pass the handoff token to the A6 partner boundary, not to the A3 binding service, the A2 authorization service, the A4 product-policy service, or any other module.
- The A7 product customer-binding service MUST NOT pass the handoff token to a public, customer, partner, or support surface. The handoff token is an internal product control surface only.
- The A7 product customer-binding service MUST NOT extend, refresh, or reissue the A6 partner reference, the A4 product-policy decision reference, or the A2 authorization context reference inside the handoff token. The handoff token carries them as references.
- The A7 product customer-binding service MUST expire the handoff token after a bounded, support-traceable interval (the A7T07 lifecycle reuses the A6T07 bounded retry interval). The handoff token is single-use: a second use of the handoff token is a replay.
- The A7 product customer-binding service MUST audit the handoff token issuance through the A2-protected internal control surface, the A2 `AuditService` (or the A4 `TypeOrmPolicyAuditAdapter`), the A4 idempotency, the A4 outbox, and the A6 partner outbox. The handoff token is not financial truth, A2 authorization, A3 binding, A4 policy, or customer intent.

## 7. Explicit internal/external account mapping matrix

| Canonical internal identity       | Source                              | A7T04 read path                                                          | A7T04 MUST NOT do                                                  |
| --------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `Customer.id`                      | `customer` module                     | Correlation only; supplied by consumer; verified against A3 binding record   | Derive from virtual-account, partner reference, or product data      |
| `CustomerWallet.id`                | `customer-wallet` module              | Supplied by consumer; verified against A3 binding record                    | Derive from virtual-account, partner reference, or product data      |
| `CustomerFinancialAccountBinding.id` | A3 `customer_financial_account_bindings` table | Supplied by consumer; verified through A3 `validateActiveBinding`           | Repair, reassign, activate, or close an A3 binding                  |
| `WalletAccount.id`                 | A3 binding record                     | Read from A3 binding record (`binding.walletAccountId`)                     | Derive from any other source                                        |
| `LedgerAccount.id`                 | A3 binding record                     | Read from A3 binding record (`binding.ledgerAccountId`)                     | Derive from any other source                                        |
| `VirtualAccount.{id, provider, accountNumber, accountName, bankCode, reference, status, assignedAt, deactivatedAt}` | existing `virtual_accounts` table (compatibility input) | Read as ownership evidence                                          | Mutate, deactivate, or reassign the existing `VirtualAccount` row  |
| `CustomerFundingInstrument` / `CustomerBeneficiary` | existing modules (compatibility input) | Read through the A6T04 funding-target consumer                              | Mutate ownership, verification, or status                            |
| `Bank`                              | existing `bank` module (compatibility input) | Read through the A6T04 funding-target consumer                              | Mutate or substitute the bank directory                              |
| `payment_reference`                  | `payment` module (compatibility input) | Read as cross-domain correlation evidence                                   | Treat payment reference as internal account source                  |
| A4 `PolicyDecisionResult.decisionReference` | A4 `policy_decision_records` table (A7T03) | Supplied by consumer; read for correlation                                   | Evaluate, mutate, or refresh A4 source evidence                      |
| A2 `AuthorizationDecision.evaluatedAt` derived reference | A2 protected routes / A2 `AuthorizationService` | Supplied by consumer; read for correlation                                   | Issue, refresh, or substitute A2 authorization                       |
| A6 `ProviderReferenceV1.{value, namespace, observedAt, source}` | A6 partner boundary (A6T05/A6T06/A6T08) | Supplied by consumer; read for correlation                                  | Issue, refresh, or substitute the partner reference                  |
| A6 `ExternalOperation` / `ExternalCallbackReceipt` / `ExternalSettlement` ids | A6 partner boundary tables | Supplied by consumer; read for correlation                                  | Mutate, refresh, or substitute the A6 boundary evidence             |

The A7 product customer-binding service is a read-only consumer of the canonical internal identity chain. It does not mutate any row in the canonical chain. It does not create a new chain. It does not store the map durably; the map is a single read-only, deterministic, in-memory artifact.

## 8. Missing, stale, revoked, blocked, expired, mismatched, or unavailable behavior

The A7 product customer-binding service treats every missing, stale, revoked, blocked, expired, mismatched, or unavailable evidence as a controlled denial, pending, or manual-review outcome. The A7 product customer-binding service MUST NOT:

- retry an ambiguous outcome with a new key, a new partner reference, a new product command identity, or a new internal account;
- deactivate or reassign the existing `VirtualAccount` to make a check pass;
- edit the A3 binding to make a check pass;
- issue a new A2 authorization context to make a check pass;
- mutate the A4 product-policy decision to make a check pass;
- mutate the A6 partner boundary to make a check pass;
- mutate `CustomerPreference` to make a check pass;
- treat a controlled denial as a product success;
- treat a missing partner reference as product success;
- treat an expired consent as product success;
- treat an expired A4 product-policy decision as product success;
- treat a stale A3 binding as product success;
- create a new customer intent, consent, preference, product, policy, binding, partner, settlement, or notification authority.

The A7 product customer-binding service propagates the controlled denial, pending, or manual-review outcome to the A7 product command (A7T05), the A7 product lifecycle (A7T07), the A7 product financial effect (A7T08), and the A7 product reconciliation (A7T09).

## 9. Tokenized or reference-only handoff rules (re-asserted)

- Raw PAN, account passwords, CVV, PIN, OTP, token secret, signing key, or equivalent credential material MUST NOT be stored or copied into a general A7 command/event payload, the handoff token, the audit metadata, the outbox payload, the diagnostic payload, the support trace, the notification payload, or any other A7 surface.
- The A6 partner reference, the A4 product-policy decision reference, the A2 authorization context reference, and the A3 binding tuple are reference-only. The handoff token carries them as references, not as raw values.
- The handoff token is a single-use, bounded-validity, A2-protected internal control surface. The A7 product customer-binding service does not expose the handoff token through a public, customer, partner, or support surface.
- The handoff token is recorded through the A2 `AuditService` (or the A4 `TypeOrmPolicyAuditAdapter`), the A4 idempotency, the A4 outbox, and the A6 partner outbox. The handoff token is not financial truth, A2 authorization, A3 binding, A4 policy, or customer intent.

## 10. A3 binding records are not mutated

The A7 product customer-binding service is a read-only consumer of the A3 binding records. The A3 binding service is the only A3 binding authority. The A7 product customer-binding service does not:

- create a new A3 binding to make a product customer-binding pass;
- update the A3 binding `state`, `currency`, `accountingUnit`, `sourceCustomerVersion`, `sourceCustomerWalletVersion`, or `version` to make a product customer-binding pass;
- close or suspend the A3 binding to make a product customer-binding pass;
- reactivate a closed or suspended A3 binding to make a product customer-binding pass;
- create a parallel binding record, table, or column to make a product customer-binding pass;
- treat the A3 binding as a product state, a partner reference, or a customer intent;
- reuse the A3 binding tuple for a non-A3 purpose.

The A3 binding service (`CustomerFinancialAccountBindingService`) remains the only A3 binding authority. The A7 product customer-binding service consumes the A3 binding tuple through the A3 `validateActiveBinding` consumer boundary. The A3 binding service does not consume the A7 product customer-binding map. The boundary is one-directional: A7 reads A3; A3 does not read A7.

## 11. Tests and validation

The A7 product customer-binding consumer contract is tested by:

- product customer-binding, ownership, stale-version, privacy, and no-source-mutation tests;
- A3 binding recheck tests that verify the A7 product customer-binding service fails closed for missing, stale, not-active, currency-mismatched, accounting-unit-mismatched, or dimension-mismatched A3 bindings;
- virtual-account ownership tests that verify the A7 product customer-binding service fails closed for missing, deactivated, wallet-mismatched, provider-mismatched, account-number-mismatched, account-name-mismatched, or bank-directory-unsupported `VirtualAccount` rows;
- A4 product-policy decision tests that verify the A7 product customer-binding service fails closed for missing, expired, pending-review, denied, or suspended A4 product-policy decisions;
- A2 authorization context tests that verify the A7 product customer-binding service fails closed for missing, stale, denied, or customer-scope-mismatched A2 authorization contexts;
- A6 partner reference tests that verify the A7 product customer-binding service fails closed for missing, replayed, or partner-disabled A6 partner references;
- A6T04 consumer contract tests that verify the A7 product customer-binding service fails closed for missing, expired, purpose-mismatched, or unsupported A6T04 funding-target evidence;
- handoff token tests that verify the A7 product customer-binding service issues a handoff token only for a verified map, that the handoff token is single-use and bounded-validity, and that the handoff token does not carry raw credentials, signatures, or unrestricted customer data;
- no-source-mutation tests that verify the A7 product customer-binding service does not write to A3, the existing `VirtualAccount`, the A6 partner boundary, the A4 product-policy, the A2 authorization, the A7 product catalog, or any other source record.

## 12. Prohibited edges

The A7 product customer-binding service MUST NOT:

- treat a virtual-account identifier, a bank code, a bank account number, a partner reference, a provider reference, a payment reference, a funding-instrument identifier, a beneficiary identifier, a notification identifier, a preference value, or a product command id as `Customer.id`, `CustomerWallet.id`, `WalletAccount.id`, or `LedgerAccount.id`;
- repair, reassign, activate, close, or suspend an A3 binding to make a product customer-binding pass;
- deactivate, reassign, activate, or close an existing `VirtualAccount` row to make a product customer-binding pass;
- issue, refresh, or substitute an A2 authorization context to make a product customer-binding pass;
- evaluate, mutate, or refresh an A4 product-policy decision to make a product customer-binding pass;
- issue, refresh, or substitute an A6 partner reference to make a product customer-binding pass;
- mutate the A6 partner boundary to make a product customer-binding pass;
- mutate `CustomerPreference` to make a product customer-binding pass;
- create a second customer-binding system, a second policy engine, a second authorization system, a second settlement authority, a second reconciliation engine, or a new product command id;
- introduce a public, customer, partner, or support surface for the product customer-binding;
- store raw credentials, raw callback signatures, full risk/compliance content, unrestricted customer data, or PAN/account secrets in the handoff token or the audit metadata;
- treat a controlled denial, pending, or manual-review outcome as a product success;
- retry an ambiguous outcome with a new key, a new partner reference, a new product command identity, or a new internal account;
- bypass the A2 authorization, the A4 product-policy, the A6 partner boundary, the A3 binding recheck, the A6T04 funding-target evidence, or the handoff token issuance.

## 13. Versioning rules

- The mapping version `A7-PRODUCT-CUSTOMER-BINDING` v1 defines this contract. A patch revision may clarify documentation; a minor revision may add optional fields, optional evidence sources, or a second frozen product customer-binding shape; a major revision is required for any change to required fields, identity semantics, currency/accounting semantics, ownership-check semantics, handoff-token semantics, or the first product's customer-binding map.
- Every A7 product customer-binding map identifies the mapping version and the mapping name that produced it. Historical evidence remains interpretable under the version that produced it.
- A retired mapping version MUST NOT be reactivated. A successor mapping MUST be a new mapping version with a new ADR.
- The A7 product customer-binding service does not introduce a parallel A3 binding, a parallel virtual-account module, a parallel A4 product-policy, a parallel A2 authorization context, a parallel A6 partner boundary, or a parallel A7 product catalog.

## 14. A7T04 verification record

- [x] A7 product customer-binding consumer contract defined as a read-only consumer of the A3 binding, the existing `VirtualAccount` evidence, the A6 partner boundary, the A2 authorization context, the A4 product-policy decision, and the A7 product catalog.
- [x] A3 binding recheck is the only source of `Customer.id` → `CustomerWallet.id` → `WalletAccount.id` → `LedgerAccount.id`.
- [x] A7 product customer-binding service does not infer an internal account from a virtual-account identifier, a bank code, a bank account number, a partner reference, a provider reference, a payment reference, a funding-instrument identifier, a beneficiary identifier, a notification identifier, a preference value, or a product command id.
- [x] A7 product customer-binding service does not mutate A3 binding records, the existing `VirtualAccount` rows, the A6 partner boundary, the A4 product-policy decision, the A2 authorization context, the A7 product catalog, or `CustomerPreference` to make a product customer-binding pass.
- [x] Tokenized or reference-only handoff token carries only the A6 partner reference, the A4 product-policy decision reference, the A2 authorization context reference, and the A3 binding tuple, never raw credentials, signatures, or unrestricted customer data.
- [x] A7 product customer-binding service fails closed for missing, stale, revoked, blocked, expired, mismatched, or unavailable evidence, with a deterministic controlled-denial, pending, or manual-review outcome.
- [x] A3 binding service remains the only A3 binding authority; the A7 product customer-binding service is a one-directional consumer of the A3 binding tuple.
- [x] A2 authorization, A3 binding, A4 product-policy, A5 internal lifecycle, A6 partner, Wallet, Ledger, Operations, and Reconciliation authorities remain separate.
- [x] No A7 runtime customer-binding service, entity, migration, repository, controller, API, route, scheduler, test, product, notification, public surface, fee, commission, settlement, reconciliation, or A8 work is introduced by A7T04.
- [x] The contract does not post a journal, mutate a balance, repair a binding, change A4 policy/source records, or dispatch a notification.

## 15. A7T04 handoff to later A7 tasks

This contract is consumed later as follows:

- **A7T05:** consumes the A7 product customer-binding map to bind the durable A7 product command identity and the durable A7 product operation identity to the A3 binding tuple, the A4 product-policy decision reference, the A2 authorization context reference, and the A6 partner reference.
- **A7T06:** does not consume the A7 product customer-binding map; A7T06 reads `CustomerPreference.notifications` only.
- **A7T07:** consumes the A7 product customer-binding map to evaluate the A7 product lifecycle transitions and to trigger A4 re-evaluation when the A6 partner reference or the A3 binding recheck changes.
- **A7T08:** consumes the A7 product customer-binding map to post the verified A7 product financial effect through the A6T08 settlement, suspense, and compensating-entry contracts.
- **A7T09:** consumes the A7 product customer-binding map to reconcile the A7 product operation, the A6 partner reference, the A4 product-policy decision reference, the A2 authorization context reference, and the A3 binding tuple.
- **A7T10:** consumes the A7 product customer-binding map fields for the A6T10 / A7T10 data-classification matrix.
- **A7T11:** records the A7 product customer-binding evidence in the A7 release-gate package.

No later task may weaken the A3 binding recheck, the A4 product-policy, the A2 authorization context, the A6 partner boundary, the A7 product catalog, or the handoff token.

## 16. Authoring note

The A7 plan reserves the proposed A7 ADR range `ADR-0054` through `ADR-0060`. ADR-0054 records the A7T02 product-catalog freeze. The next A7 ADR (ADR-0055 or later) is reserved for the A7T03 product-policy profile freeze. A7T04 does not introduce a new ADR; the A7T04 product customer-binding contract is a read-only consumer-boundary artifact. A7T11 will record the ADR-0055-or-later authoring evidence as part of the A7 release-gate package. A7T04 introduces no new runtime code, entity, migration, repository, service, controller, API, route, scheduler, notification dispatcher, public surface, fee, commission, settlement, reconciliation, or A8 work.
