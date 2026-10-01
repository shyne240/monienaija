# B1T02 — B1 Commercial Catalog and Commercial-Boundary Contract

- **Phase:** B1 — Commercial Platform
- **Task:** B1T02 — B1 Commercial Catalog and Plan-Boundary Contract
- **Status:** Documentation and contract design prepared for review; no B1 runtime catalog, commercial-boundary, pricing, fee, commission, revenue-sharing, billing, invoicing, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue-recognition, tax / VAT, cost-accounting, profitability, analytics, feature flag, approval, or reconciliation implementation introduced
- **Contract:** `CommercialCatalogContractV1` / `CommercialBoundaryContractV1` / `CommercialRegistrationV1` / `CommercialCapabilityRegistrationV1` / `CommercialPlanRegistrationV1` / `CommercialPackageRegistrationV1` / `CommercialBundleRegistrationV1` / `CommercialRequestV1` / `CommercialResultV1` / `CommercialStateV1` / `CommercialDependencyDeclarationV1` / `CommercialCompatibilityRuleV1` / `CommercialConsumerContractV1` / `CommercialVersionNegotiationRuleV1` / `CommercialReplayRuleV1`
- **Catalog version:** `B1-COMMERCIAL-CATALOG` v1
- **Selected first commercial scope (frozen registration):** `commercial.virtual-account.inbound-funding` v1 / `commercial.virtual-account.inbound-funding.fee` and `commercial.virtual-account.inbound-funding.commission` (revenue sharing) / inbound funding to provider-backed virtual account / `NGN` / `CUSTOMER_FUNDS` / under the existing A7 first product `VIRTUAL_ACCOUNT` v1 / under the existing A6 partner `NIBSS_NIP` planning rail
- **Application, database, API, migration, entity, service, controller, module, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, product, financial-runtime, public-channel, and B2 changes:** None

This document defines the stable B1 commercial catalog and the commercial-boundary contract that keep commercial-specific behavior outside Customer, `CustomerPreference`, A2, A3, A4, A5, A6, A7, Wallet, Ledger, and Operations authorities. It is a contract design artifact, not a TypeScript class, NestJS module, entity, migration, repository, service, controller, API, route, scheduler, billing engine, invoice engine, statement-generation engine, campaign engine, promotion engine, coupon engine, referral engine, cashback engine, loyalty engine, revenue-recognition engine, tax / VAT engine, cost-accounting engine, profitability engine, commercial-analytics engine, commercial-reconciliation engine, feature flag surface, commercial approval surface, commercial audit surface, commercial idempotency surface, commercial data-classification surface, commercial release gate, or runtime activation.

## 1. Contract boundary

### 1.1 Purpose

The B1 commercial catalog and commercial-boundary contract are an anti-corruption and isolation boundary between canonical authorities and one approved commercial scope:

```text
A2-protected internal commercial-decision owner
  -> A4 policy result and A3 binding recheck (read-only consumers)
  -> B1 commercial catalog (lookup commercial registration, compatibility, plan, package, bundle)
  -> CommercialBoundaryContractV1 (normalized commercial-decision request/result/error/audit)
  -> A6T10 / A1 data classification, retention, legal-hold, disclosure (read-only consumers)
  -> shared Operations audit / idempotency / outbox / metrics / diagnostics (read-only consumers)
  <- commercial-neutral normalized result / evidence / error / discrepancy
```

The catalog and boundary translate commercial-specific vocabulary (commercial reference, plan reference, tier reference, entitlement reference, feature flag reference, dynamic limit reference, package reference, bundle reference, fee reference, commission reference, revenue-sharing reference, billing reference, invoice reference, statement reference, campaign reference, promotion reference, coupon reference, referral reference, cashback reference, loyalty reference, revenue-recognition reference, tax / VAT reference, cost-accounting reference, profitability reference, analytics reference) into provider-neutral, partner-neutral, product-neutral, customer-neutral, and ledger-neutral values. They do not decide whether a commercial result is an internal financial outcome, an A2 authorization, an A3 binding, an A4 policy decision, an A5 Ledger record, an A6T08 settlement / suspense / compensating entry, an A6T09 external reconciliation mutation, an A7 product command, an A7 product operation, an A7 product financial effect, an A7 product reconciliation mutation, an A7 product data-minimization mutation, an Operations audit / idempotency / outbox mutation, or a `CustomerPreference` mutation.

### 1.2 Normative language

- **MUST** means a required contract invariant.
- **MUST NOT** means a prohibited state, dependency, or interpretation.
- **SHOULD** means the default behavior unless a later approved commercial contract documents a safer alternative.
- **MAY** means an optional field or later commercial-extension point that cannot weaken an invariant.
- **Catalog version** means a frozen `B1-COMMERCIAL-CATALOG` v1 entry whose commercial-scope identity, capabilities, dependency declaration, plan reference, package reference, bundle reference, compatibility rules, prohibited adjacent commercial scopes, and consumer contracts are described by this contract.
- **A1-A7 authority** means the existing A1 canonical ownership, identifier, privacy, retention, and cross-cutting contracts; the A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts; the A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts; the A4 capability / action policy, limits, obligations, evidence snapshot, expiry / re-evaluation, and currentness contracts; the A5 customer-aware command / correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns; the A6 partner-adapter boundary, partner capability / version, callback, provider idempotency, settlement, suspense, external reconciliation, and external-rail data minimization; the A7 product catalog, product-boundary contract, product customer-binding map, product command, product notification delivery, product lifecycle, product financial effect, product reconciliation, and product data-minimization; the A6T10 data-classification matrix; the A6T09 external reconciliation; the A7T09 product reconciliation; the A7T08 product financial effect; the A7T06 product notification delivery; and the shared Operations audit / idempotency / outbox / metrics / diagnostics services.
- **`CustomerPreference`** means the existing `CustomerPreference` and `NotificationPreference` types (the only customer intent authority); B1 never invents a second customer intent, consent, preference, or notification authority.
- **Later B1 task** means work assigned to B1T03–B1T11 and not implemented here. B1T02 defines the B1 commercial catalog and the B1 commercial-boundary contract only; it does not implement the B1 commercial catalog runtime, the B1 commercial-boundary runtime, the B1 commercial-decision engine, the B1 fee / commission / revenue-sharing engine, the B1 billing / invoice / statement engine, the B1 campaign / promotion / coupon engine, the B1 referral / cashback / loyalty engine, the B1 revenue-recognition / tax / VAT / cost-accounting engine, the B1 commercial-analytics / profitability / commercial-reconciliation engine, the B1 commercial data classification / commercial idempotency / commercial audit / commercial approvals / feature flag surface, or the B1 commercial release gate.

### 1.3 Catalog and boundary port shape

The logical commercial catalog and commercial-boundary ports are equivalent to:

```text
CommercialCatalogContractV1
  getRegistration(commercialScopeKey: CommercialScopeKeyV1)
    -> CommercialRegistrationV1 | null

  listRegistrations()
    -> readonly CommercialRegistrationV1[]

  assertCompatible(
    commercialScopeKey: CommercialScopeKeyV1,
    capabilityKey: CommercialCapabilityKeyV1,
    action: CommercialActionV1,
    currency: CommercialCurrencyV1,
    accountingUnit: CommercialAccountingUnitV1,
    partnerDependency: CommercialPartnerDependencyV1 | null,
    productDependency: CommercialProductDependencyV1 | null
  )
    -> CommercialCapabilityRegistrationV1

  getPlan(planKey: CommercialPlanKeyV1, planVersion: CommercialPlanVersionV1)
    -> CommercialPlanRegistrationV1 | null

  getPackage(packageKey: CommercialPackageKeyV1, packageVersion: CommercialPackageVersionV1)
    -> CommercialPackageRegistrationV1 | null

  getBundle(bundleKey: CommercialBundleKeyV1, bundleVersion: CommercialBundleVersionV1)
    -> CommercialBundleRegistrationV1 | null

CommercialBoundaryContractV1
  execute(request: CommercialRequestV1)
    -> CommercialResultV1

  getCapabilities(query: CommercialCapabilityQueryV1)
    -> CommercialCapabilityResultV1

  assertCompatible(
    commercialScopeKey: CommercialScopeKeyV1,
    capabilityKey: CommercialCapabilityKeyV1
  )
    -> CommercialCapabilityRegistrationV1
```

The catalog port is provider-neutral, partner-neutral, product-neutral, customer-neutral, and ledger-neutral. The boundary port is a contract design that a later runtime implementation will implement behind the existing A1-A7 authorities for commercial decisions that depend on them. Domain modules MUST consume the B1 commercial catalog and the B1 commercial-boundary contract rather than reaching into `fee`, `quote`, `limit`, `customer-preference`, `customer-beneficiary`, `transfer`, `payment`, `settlement-account`, `ledger`, `partner`, `reconciliation`, the A7 product layer, or any other canonical module directly.

### 1.4 Catalog version and selection rule

The catalog version is:

```text
catalogName:     "B1-COMMERCIAL-CATALOG"
catalogVersion:  1
```

Every commercial registration, capability registration, plan registration, package registration, bundle registration, dependency declaration, compatibility rule, lifecycle state, and consumer contract in this document is part of `B1-COMMERCIAL-CATALOG` v1. A later catalog version (v2) may add optional fields, capability metadata, a second frozen commercial scope, or commercial-extension points; it MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope. The first commercial scope is recorded as a single frozen registration in §4.

### 1.5 Selected first commercial scope (frozen registration summary)

The selected first commercial scope, established in [`docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) §4 and reasserted by this contract, is:

```text
commercialScopeKey:      commercial.virtual-account.inbound-funding
commercialScopeVersion:  1
direction:               inbound funding to provider-backed virtual account
capabilityKey:           commercial.virtual-account.inbound-funding.fee
                         commercial.virtual-account.inbound-funding.commission
action:                  compute (read-only consumer boundary)
currency:                NGN
accountingUnit:          CUSTOMER_FUNDS
partner dependency:      NIBSS_NIP (selected A6 partner; planning rail)
product dependency:      VIRTUAL_ACCOUNT v1 (selected A7 first product)
internal commercial-decision owner: B1 commercial engine (B1T04 fee / commission / revenue-sharing engine)
```

The first commercial scope is bounded to four envelopes (per the B1 plan §4.2):

- **Bounded commercial-decision envelope** (B1T04 fee / commission / revenue-sharing engine output; B1T03 pricing / plan / subscription / customer-tier / merchant-tier / partner-tier / product-entitlement / product-package / bundle catalog; B1T10 feature flag surface).
- **Bounded commercial-financial-effect envelope** (B1T05 billing / invoice / statement-generation engine output; B1T08 revenue-recognition / tax / VAT / cost-accounting engine output).
- **Bounded commercial-incentive envelope** (B1T06 campaign / promotion / coupon engine output; B1T07 referral / cashback / loyalty engine output).
- **Bounded commercial-analytics envelope** (B1T09 commercial analytics / profitability / commercial-reconciliation engine output).

B1T02 defines the B1 commercial catalog and the B1 commercial-boundary contract only; it does not implement any commercial-decision engine, commercial-financial-effect engine, commercial-incentive engine, or commercial-analytics engine.

## 2. Canonical commercial identity

### 2.1 Commercial identity types

The B1 commercial catalog and commercial-boundary contract are explicit about the canonical commercial identity types. The following types are frozen at v1:

```text
CommercialScopeKeyV1              // e.g. "commercial.virtual-account.inbound-funding"
CommercialScopeVersionV1          // e.g. 1
CommercialCapabilityKeyV1         // e.g. "commercial.virtual-account.inbound-funding.fee"
CommercialActionV1                // e.g. "compute"
CommercialCurrencyV1              // e.g. "NGN"
CommercialAccountingUnitV1       // e.g. "CUSTOMER_FUNDS"
CommercialDirectionV1             // e.g. "inbound"
CommercialPartnerDependencyV1     // e.g. "NIBSS_NIP"
CommercialProductDependencyV1     // e.g. "VIRTUAL_ACCOUNT"
CommercialPlanKeyV1               // e.g. "plan.commercial.virtual-account.inbound-funding"
CommercialPlanVersionV1           // e.g. 1
CommercialPackageKeyV1            // e.g. "package.commercial.virtual-account.inbound-funding"
CommercialPackageVersionV1        // e.g. 1
CommercialBundleKeyV1             // e.g. "bundle.commercial.virtual-account.inbound-funding"
CommercialBundleVersionV1         // e.g. 1
CommercialTierKeyV1               // e.g. "tier.customer.commercial.virtual-account.inbound-funding"
CommercialTierVersionV1           // e.g. 1
CommercialEntitlementKeyV1        // e.g. "entitlement.commercial.virtual-account.inbound-funding"
CommercialEntitlementVersionV1    // e.g. 1
CommercialFeatureFlagKeyV1        // e.g. "feature-flag.commercial.virtual-account.inbound-funding"
CommercialFeatureFlagVersionV1    // e.g. 1
CommercialDynamicLimitKeyV1       // e.g. "limit.commercial.virtual-account.inbound-funding"
CommercialDynamicLimitVersionV1   // e.g. 1
```

The B1 commercial catalog and commercial-boundary contract MUST NOT use any of the following as a commercial identity, a canonical identity, or a financial identity:

- `Customer.id` (the A1 / A3 customer identity);
- internal command ID, A5 transfer / deposit / withdrawal ID, A5 journal ID;
- A6 external-operation ID, A6 provider idempotency key, A6 provider transaction / reference ID, A6 callback event ID, A6T08 settlement ID, A6T08 suspense ID, A6T09 external reconciliation reference;
- A7 product command ID, A7 product operation ID, A7T08 product financial-effect reference, A7T09 product reconciliation reference, A7T10 product data-minimization reference;
- A2 authorization context ID, A3 binding ID, A4 policy decision ID, A7T06 notification dispatch ID;
- Operations audit event ID, idempotency record ID, outbox event ID, metrics event ID, diagnostics event ID;
- any WalletAccount ID, LedgerAccount ID, line ID, balance ID, or settlement-account ID.

The B1 commercial catalog and commercial-boundary contract do not invent a second canonical identity in any of the above domains. The B1 commercial catalog and commercial-boundary contract are the only commercial-decision identity source; A1-A7 remain the only canonical identity authorities in their respective domains.

### 2.2 Commercial-decision identity

The B1 commercial-decision identity is the canonical identity for any B1 commercial decision emitted through the B1 commercial catalog and commercial-boundary contract. The B1 commercial-decision identity is:

```text
commercialDecisionId:        <uuid v4>
commercialDecisionScopeKey:  <CommercialScopeKeyV1>
commercialDecisionScopeVer:  <CommercialScopeVersionV1>
commercialDecisionCapKey:    <CommercialCapabilityKeyV1>
commercialDecisionAct:       <CommercialActionV1>
commercialDecisionCur:       <CommercialCurrencyV1>
commercialDecisionAcc:       <CommercialAccountingUnitV1>
commercialDecisionPart:      <CommercialPartnerDependencyV1 | null>
commercialDecisionProd:      <CommercialProductDependencyV1 | null>
commercialDecisionCausId:    <RequestContext.causationId>
commercialDecisionCorrId:    <RequestContext.correlationId>
commercialDecisionReqId:     <RequestContext.requestId>
commercialDecisionIssAt:     <ISO-8601 timestamp>
commercialDecisionExpAt:     <ISO-8601 timestamp> (issuedAt + 86400s)
commercialDecisionPlanRef:   <CommercialPlanKeyV1> | null
commercialDecisionPkgRef:    <CommercialPackageKeyV1> | null
commercialDecisionBunRef:    <CommercialBundleKeyV1> | null
commercialDecisionTierRef:   <CommercialTierKeyV1> | null
commercialDecisionEntRef:    <CommercialEntitlementKeyV1> | null
```

The B1 commercial-decision identity is a separate identifier from the A1-A7 canonical identity authorities. The B1 commercial-decision identity is never used as a Customer, Wallet, Ledger, A2 authorization, A3 binding, A4 policy decision, A5 journal, A6 partner, A6 settlement, A6 suspense, A6 reconciliation, A7 product, A7 product operation, A7 product financial effect, A7 product reconciliation, A7 product data-minimization, Operations audit, Operations idempotency, Operations outbox, or `CustomerPreference` identity. The B1 commercial-decision identity is only used to correlate B1 commercial decisions within the B1 commercial catalog and commercial-boundary contract; the correlation is emitted through the B1 commercial-decision result envelope (see §10).

### 2.3 Commercial result envelope

The B1 commercial result envelope is the canonical envelope for any B1 commercial result emitted through the B1 commercial catalog and commercial-boundary contract. The B1 commercial result envelope is:

```text
CommercialResultV1
  contractName:    "B1-COMMERCIAL-CATALOG" | "B1-COMMERCIAL-BOUNDARY"
  contractVersion: 1
  commercialDecisionId:        <B1 commercial-decision identity>
  commercialScopeKey:           <CommercialScopeKeyV1>
  commercialScopeVersion:       <CommercialScopeVersionV1>
  commercialCapabilityKey:      <CommercialCapabilityKeyV1>
  commercialCapabilityVersion:  <CommercialCapabilityVersionV1>
  commercialCapabilityAction:   <CommercialActionV1>
  commercialCapabilityStatus:   "OK" | "INCOMPATIBLE" | "MALFORMED" | "WRONG_VERSION" | "UNAVAILABLE" | "PROHIBITED"
  commercialCapabilityResult:   readonly Record<CommercialResultFieldKeyV1, CommercialResultFieldValueV1>
  commercialCapabilityMaskedFields: readonly CommercialResultFieldKeyV1[]
  commercialCapabilityMask:     readonly Record<CommercialResultFieldKeyV1, CommercialResultFieldValueV1>
  commercialCapabilityAudit:    CommercialConsumerAuditContextV1
  commercialCapabilityIssAt:    <ISO-8601 timestamp>
  commercialCapabilityExpAt:    <ISO-8601 timestamp>
  commercialCapabilityCorrId:   <RequestContext.correlationId>
  commercialCapabilityReqId:    <RequestContext.requestId>
  commercialCapabilityCausId:   <RequestContext.causationId>
```

The B1 commercial result envelope is a contract design. The B1 commercial result envelope is not a financial value, an A2 authorization, an A3 binding, an A4 policy decision, an A5 Ledger record, an A6T08 settlement / suspense / compensating entry, an A6T09 external reconciliation mutation, an A7 product command, an A7 product operation, an A7 product financial effect, an A7 product reconciliation mutation, an A7 product data-minimization mutation, an Operations audit / idempotency / outbox mutation, or a `CustomerPreference` mutation. The B1 commercial result envelope is a read-only consumer of A1-A7 and the shared Operations services; the B1 commercial result envelope is never a source authority in any A1-A7 domain.

### 2.4 Commercial failure envelope

The B1 commercial failure envelope is the canonical envelope for any B1 commercial failure emitted through the B1 commercial catalog and commercial-boundary contract. The B1 commercial failure envelope is:

```text
CommercialFailureV1
  contractName:    "B1-COMMERCIAL-CATALOG" | "B1-COMMERCIAL-BOUNDARY"
  contractVersion: 1
  commercialDecisionId:        <B1 commercial-decision identity> | null
  commercialScopeKey:           <CommercialScopeKeyV1> | null
  commercialScopeVersion:       <CommercialScopeVersionV1> | null
  commercialCapabilityKey:      <CommercialCapabilityKeyV1> | null
  commercialCapabilityVersion:  <CommercialCapabilityVersionV1> | null
  commercialCapabilityAction:   <CommercialActionV1> | null
  code:                         <CommercialFailureCodeV1>
  message:                      <string>
  commercialCapabilityIssAt:    <ISO-8601 timestamp>
  commercialCapabilityCorrId:   <RequestContext.correlationId>
  commercialCapabilityReqId:    <RequestContext.requestId>
  commercialCapabilityCausId:   <RequestContext.causationId>
```

The B1 commercial failure code vocabulary is:

```text
B1_COMMERCIAL_CATALOG_QUERY_UNAVAILABLE
B1_COMMERCIAL_CATALOG_INCOMPATIBLE
B1_COMMERCIAL_CATALOG_MALFORMED
B1_COMMERCIAL_CATALOG_WRONG_VERSION
B1_COMMERCIAL_CATALOG_PROHIBITED
B1_COMMERCIAL_CATALOG_UNSUPPORTED_CAPABILITY
B1_COMMERCIAL_CATALOG_MISSING_PLAN
B1_COMMERCIAL_CATALOG_MISSING_PACKAGE
B1_COMMERCIAL_CATALOG_MISSING_BUNDLE
B1_COMMERCIAL_CATALOG_MISSING_TIER
B1_COMMERCIAL_CATALOG_MISSING_ENTITLEMENT
B1_COMMERCIAL_CATALOG_INVALID_COMMAND
```

The B1 commercial failure envelope is a contract design. The B1 commercial failure envelope is not a financial value, an A2 authorization, an A3 binding, an A4 policy decision, an A5 Ledger record, an A6 partner, an A6T08 settlement / suspense / compensating entry, an A6T09 external reconciliation mutation, an A7 product, an Operations audit / idempotency / outbox mutation, or a `CustomerPreference` mutation. The B1 commercial failure envelope is a read-only consumer of A1-A7 and the shared Operations services; the B1 commercial failure envelope is never a source authority in any A1-A7 domain.

## 3. Commercial registration

### 3.1 Commercial registration types

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial registration types. The following types are frozen at v1:

```text
CommercialRegistrationV1
  commercialScopeKey:           <CommercialScopeKeyV1>
  commercialScopeVersion:       <CommercialScopeVersionV1>
  direction:                     <CommercialDirectionV1>
  currency:                      <CommercialCurrencyV1>
  accountingUnit:               <CommercialAccountingUnitV1>
  partnerDependency:             <CommercialPartnerDependencyV1> | null
  productDependency:             <CommercialProductDependencyV1> | null
  internalCommercialDecisionOwner: <B1 commercial engine>
  capabilities:                  readonly CommercialCapabilityRegistrationV1[]
  stateVocabulary:               readonly CommercialStateV1[]
  prohibitedAdjacentCommercialScopes: readonly CommercialScopeKeyV1[]
  prohibitedDependencies:        readonly CommercialProhibitedDependencyV1[]
  compatibilityRules:            readonly CommercialCompatibilityRuleV1[]
  consumerContracts:              readonly CommercialConsumerContractV1[]
  versionNegotiationRules:        readonly CommercialVersionNegotiationRuleV1[]
  replayRules:                    readonly CommercialReplayRuleV1[]
  effectiveFrom:                 <ISO-8601 timestamp> | null
  effectiveTo:                   <ISO-8601 timestamp> | null
  classificationLevel:           <A6T10 data handling level> | null
  retentionDays:                 <number> | null
  dataControlClassification:     readonly CommercialDataControlClassificationV1[]
  commercialCapabilityPlans:      readonly CommercialPlanKeyV1[]
  commercialCapabilityPackages:   readonly CommercialPackageKeyV1[]
  commercialCapabilityBundles:    readonly CommercialBundleKeyV1[]
```

### 3.2 Commercial capability registration

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial capability registration types. The following types are frozen at v1:

```text
CommercialCapabilityRegistrationV1
  commercialScopeKey:           <CommercialScopeKeyV1>
  commercialScopeVersion:       <CommercialScopeVersionV1>
  capabilityKey:                <CommercialCapabilityKeyV1>
  capabilityVersion:            <CommercialCapabilityVersionV1>
  action:                       <CommercialActionV1>
  capabilityClassificationLevel: <A6T10 data handling level> | null
  capabilityStateVocabulary:    readonly CommercialStateV1[]
  capabilityInputFields:         readonly CommercialInputFieldKeyV1[]
  capabilityOutputFields:        readonly CommercialOutputFieldKeyV1[]
  capabilityVersionNegotiationRules: readonly CommercialVersionNegotiationRuleV1[]
  capabilityReplayRules:         readonly CommercialReplayRuleV1[]
  capabilityCompatibilityRules:  readonly CommercialCompatibilityRuleV1[]
  capabilityConsumerContracts:   readonly CommercialConsumerContractV1[]
  capabilityEffectiveFrom:       <ISO-8601 timestamp> | null
  capabilityEffectiveTo:         <ISO-8601 timestamp> | null
  capabilityRetentionDays:       <number> | null
```

### 3.3 Commercial plan registration

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial plan registration types. The following types are frozen at v1:

```text
CommercialPlanRegistrationV1
  commercialPlanKey:            <CommercialPlanKeyV1>
  commercialPlanVersion:        <CommercialPlanVersionV1>
  commercialScopeKey:           <CommercialScopeKeyV1>
  commercialScopeVersion:       <CommercialScopeVersionV1>
  planTierEligibility:           readonly CommercialTierKeyV1[]
  planProductEligibility:        readonly CommercialProductDependencyV1[]
  planPartnerEligibility:        readonly CommercialPartnerDependencyV1>[]
  planEntitlements:              readonly CommercialEntitlementKeyV1[]
  planFeatureFlags:              readonly CommercialFeatureFlagKeyV1[]
  planDynamicLimits:             readonly CommercialDynamicLimitKeyV1[]
  planCapabilities:              readonly CommercialCapabilityKeyV1[]
  planEffectiveFrom:             <ISO-8601 timestamp> | null
  planEffectiveTo:               <ISO-8601 timestamp> | null
  planClassificationLevel:       <A6T10 data handling level> | null
  planRetentionDays:             <number> | null
```

The B1T03 task will define the actual B1 commercial plans (B1T02 is documentation-only and does not implement any B1 commercial plan). The B1 commercial catalog and commercial-boundary contract do not predefine any B1 commercial plan; the B1T03 task will define, freeze, and catalog the B1 commercial plans.

### 3.4 Commercial package registration

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial package registration types. The following types are frozen at v1:

```text
CommercialPackageRegistrationV1
  commercialPackageKey:         <CommercialPackageKeyV1>
  commercialPackageVersion:     <CommercialPackageVersionV1>
  commercialScopeKey:           <CommercialScopeKeyV1>
  commercialScopeVersion:       <CommercialScopeVersionV1>
  packageComposition:            readonly CommercialPackageCompositionEntryV1[]
  packageCapabilities:           readonly CommercialCapabilityKeyV1[]
  packageEntitlements:           readonly CommercialEntitlementKeyV1[]
  packageFeatureFlags:           readonly CommercialFeatureFlagKeyV1[]
  packageDynamicLimits:          readonly CommercialDynamicLimitKeyV1[]
  packageEffectiveFrom:           <ISO-8601 timestamp> | null
  packageEffectiveTo:             <ISO-8601 timestamp> | null
  packageClassificationLevel:    <A6T10 data handling level> | null
  packageRetentionDays:          <number> | null
```

The B1T03 task will define the actual B1 commercial packages (B1T02 is documentation-only and does not implement any B1 commercial package). The B1 commercial catalog and commercial-boundary contract do not predefine any B1 commercial package; the B1T03 task will define, freeze, and catalog the B1 commercial packages.

### 3.5 Commercial bundle registration

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial bundle registration types. The following types are frozen at v1:

```text
CommercialBundleRegistrationV1
  commercialBundleKey:          <CommercialBundleKeyV1>
  commercialBundleVersion:      <CommercialBundleVersionV1>
  commercialScopeKey:           <CommercialScopeKeyV1>
  commercialScopeVersion:       <CommercialScopeVersionV1>
  bundleComposition:             readonly CommercialBundleCompositionEntryV1[]
  bundleCapabilities:            readonly CommercialCapabilityKeyV1[]
  bundleEntitlements:            readonly CommercialEntitlementKeyV1[]
  bundleFeatureFlags:            readonly CommercialFeatureFlagKeyV1[]
  bundleDynamicLimits:           readonly CommercialDynamicLimitKeyV1[]
  bundleEffectiveFrom:            <ISO-8601 timestamp> | null
  bundleEffectiveTo:              <ISO-8601 timestamp> | null
  bundleClassificationLevel:     <A6T10 data handling level> | null
  bundleRetentionDays:           <number> | null
```

The B1T03 task will define the actual B1 commercial bundles (B1T02 is documentation-only and does not implement any B1 commercial bundle). The B1 commercial catalog and commercial-boundary contract do not predefine any B1 commercial bundle; the B1T03 task will define, freeze, and catalog the B1 commercial bundles.

## 4. First commercial scope registration

### 4.1 First commercial scope (frozen registration)

The selected first commercial scope, established in [`docs/B1-COMMERCIAL-PLATFORM-BASELINE.md`](B1-COMMERCIAL-PLATFORM-BASELINE.md) §4 and reasserted by this contract, is recorded as a single frozen registration in `B1-COMMERCIAL-CATALOG` v1:

```text
commercialScopeKey:           "commercial.virtual-account.inbound-funding"
commercialScopeVersion:       1
direction:                     "inbound"
currency:                      "NGN"
accountingUnit:               "CUSTOMER_FUNDS"
partnerDependency:             "NIBSS_NIP" (selected A6 partner; planning rail)
productDependency:             "VIRTUAL_ACCOUNT" v1 (selected A7 first product)
internalCommercialDecisionOwner: "B1 commercial engine" (B1T04 fee / commission / revenue-sharing engine)
stateVocabulary:               [
                                 "COMMERCIAL_DECISION_PENDING",
                                 "COMMERCIAL_DECISION_ADMITTED",
                                 "COMMERCIAL_DECISION_SUPPRESSED",
                                 "COMMERCIAL_DECISION_FAILED",
                                 "COMMERCIAL_DECISION_REPLAYED",
                                 "COMMERCIAL_DECISION_DISABLED"
                               ]
prohibitedAdjacentCommercialScopes: [
                                 "commercial.virtual-account.outbound-settlement" (out of scope; requires separate B1 cycle)
                               ]
prohibitedDependencies:        [
                                 "B1 pricing engine" (B1T03 / B1T04 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 fee engine" (B1T04 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 commission engine" (B1T04 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 revenue-sharing engine" (B1T04 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 billing engine" (B1T05 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 invoice engine" (B1T05 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 statement-generation engine" (B1T05 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 campaign engine" (B1T06 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 promotion engine" (B1T06 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 coupon engine" (B1T06 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 referral engine" (B1T07 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 cashback engine" (B1T07 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 loyalty engine" (B1T07 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 revenue-recognition engine" (B1T08 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 tax / VAT engine" (B1T08 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 cost-accounting engine" (B1T08 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 commercial-analytics engine" (B1T09 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 profitability engine" (B1T09 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 commercial-reconciliation engine" (B1T09 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 commercial data classification" (B1T10 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 commercial idempotency" (B1T10 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 commercial audit" (B1T10 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 commercial approvals" (B1T10 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 feature flag surface" (B1T10 read-only consumer boundary; B1T02 is documentation-only)
                                 "B1 commercial release gate" (B1T11 read-only consumer boundary; B1T02 is documentation-only)
                                 "B2 customer-activation rollout" (out of scope; future phase)
                                 "B2 public-channel implementation" (out of scope; future phase)
                                 "B2 marketing-consent onboarding" (out of scope; future phase)
                                 "B2 cross-region or cross-currency rollout" (out of scope; future phase)
                                 "B2 partner onboarding beyond the already-approved A6 partner" (out of scope; future phase)
                                 "B2 broad customer activation" (out of scope; future phase)
                                 "A8 scale / extraction" (out of scope; future phase)
                               ]
compatibilityRules:            [
                                 "currency must equal NGN"
                                 "accounting unit must equal CUSTOMER_FUNDS"
                                 "partner dependency must equal NIBSS_NIP"
                                 "product dependency must equal VIRTUAL_ACCOUNT v1"
                                 "capability must be one of the registered capabilities"
                                 "currency / accounting unit / partner dependency / product dependency combination must be in the B1T03 catalog"
                                 "effective-from / effective-to must be in the B1T03 catalog"
                                 "customer tier / merchant tier / partner tier / entitlement / feature flag / dynamic limit must be in the B1T03 catalog"
                               ]
consumerContracts:              [
                                 "A1 read-only consumer contract" (per §10.1)
                                 "A2 read-only consumer contract" (per §10.2)
                                 "A3 read-only consumer contract" (per §10.3)
                                 "A4 read-only consumer contract" (per §10.4)
                                 "A5 read-only consumer contract" (per §10.5)
                                 "A6 read-only consumer contract" (per §10.6)
                                 "A7 read-only consumer contract" (per §10.7)
                                 "A6T10 read-only consumer contract" (per §10.8)
                                 "A6T09 read-only consumer contract" (per §10.9)
                                 "A7T09 read-only consumer contract" (per §10.10)
                                 "A7T08 read-only consumer contract" (per §10.11)
                                 "A7T06 read-only consumer contract" (per §10.12)
                                 "Operations read-only consumer contract" (per §10.13)
                               ]
versionNegotiationRules:        [
                                 "If the requested commercialScopeVersion is greater than the catalog's commercialScopeVersion, the boundary MUST respond with B1_COMMERCIAL_CATALOG_WRONG_VERSION"
                                 "If the requested commercialScopeVersion is less than the catalog's commercialScopeVersion, the boundary MUST respond with B1_COMMERCIAL_CATALOG_WRONG_VERSION"
                                 "If the requested commercialScopeVersion equals the catalog's commercialScopeVersion, the boundary MUST respond with the current registration"
                                 "If the requested commercialCapabilityVersion is greater than the catalog's commercialCapabilityVersion, the boundary MUST respond with B1_COMMERCIAL_CATALOG_WRONG_VERSION"
                                 "If the requested commercialCapabilityVersion is less than the catalog's commercialCapabilityVersion, the boundary MUST respond with B1_COMMERCIAL_CATALOG_WRONG_VERSION"
                                 "If the requested commercialCapabilityVersion equals the catalog's commercialCapabilityVersion, the boundary MUST respond with the current registration"
                                 "If the requested commercialPlanVersion, commercialPackageVersion, commercialBundleVersion, commercialTierVersion, commercialEntitlementVersion, commercialFeatureFlagVersion, or commercialDynamicLimitVersion does not match the catalog's frozen version, the boundary MUST respond with B1_COMMERCIAL_CATALOG_WRONG_VERSION"
                                 "Cross-catalog negotiation (e.g. commercialScopeVersion v1 against commercialScopeVersion v2) is out of scope; the boundary MUST respond with B1_COMMERCIAL_CATALOG_WRONG_VERSION"
                               ]
replayRules:                    [
                                 "Commercial-decision replay is allowed only within the commercial-decision replay window (issuedAt + 86400s)"
                                 "Commercial-decision replay is supported only for the same commercialDecisionId, the same commercialScopeKey, the same commercialScopeVersion, the same commercialCapabilityKey, the same commercialCapabilityVersion, the same commercialAction, the same currency, the same accountingUnit, the same partnerDependency, the same productDependency, the same requestContext.correlationId, and the same requestContext.requestId"
                                 "Commercial-decision replay is not supported across different commercialDecisionId, different commercialScopeKey, different commercialScopeVersion, different commercialCapabilityKey, different commercialCapabilityVersion, different commercialAction, different currency, different accountingUnit, different partnerDependency, different productDependency, different requestContext.correlationId, or different requestContext.requestId; the boundary MUST respond with B1_COMMERCIAL_CATALOG_MALFORMED"
                                 "Commercial-decision replay is idempotent under the shared Operations IdempotencyService (read-only consumer boundary)"
                                 "Commercial-decision replay is replay-safe under the shared Operations AuditService (read-only consumer boundary)"
                                 "Commercial-decision replay never re-emits a commercial-decision result that has expired (issuedAt + 86400s); the boundary MUST respond with B1_COMMERCIAL_CATALOG_QUERY_UNAVAILABLE"
                               ]
classificationLevel:           "INTERNAL" (per A6T10 / B1T10 data handling level vocabulary)
retentionDays:                  365 (per A6T10 / B1T10 default retention)
dataControlClassification:     [
                                 "B1 commercial-decision is data-classified as INTERNAL by default"
                                 "B1 commercial-decision may be data-classified as CONFIDENTIAL or RESTRICTED by a later B1T10 commercial data classification override"
                                 "B1 commercial-decision is never data-classified as HIGHLY_RESTRICTED; HIGHLY_RESTRICTED is reserved for A6T10 / B1T10 partner-only fields"
                                 "B1 commercial-decision is never data-classified as PUBLIC; PUBLIC is reserved for A1 canonical identity fields"
                               ]
commercialCapabilityPlans:      [] (B1T03 task will populate)
commercialCapabilityPackages:   [] (B1T03 task will populate)
commercialCapabilityBundles:    [] (B1T03 task will populate)
```

The first commercial scope `commercial.virtual-account.inbound-funding` v1 is the only ACTIVE entry in `B1-COMMERCIAL-CATALOG` v1. No second commercial scope is admitted by B1T02; any second commercial scope requires a separate B1 cycle (per the B1 plan §4.4 and the B1T01 baseline §4.4).

### 4.2 First commercial scope capability registration

The first commercial scope has two frozen capabilities, recorded in `B1-COMMERCIAL-CATALOG` v1:

```text
capability-1:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  capabilityKey:                "commercial.virtual-account.inbound-funding.fee"
  capabilityVersion:            1
  action:                       "compute"
  capabilityClassificationLevel: "INTERNAL" (per A6T10 / B1T10 data handling level vocabulary)
  capabilityStateVocabulary:     [
                                   "COMMERCIAL_DECISION_PENDING",
                                   "COMMERCIAL_DECISION_ADMITTED",
                                   "COMMERCIAL_DECISION_SUPPRESSED",
                                   "COMMERCIAL_DECISION_FAILED",
                                   "COMMERCIAL_DECISION_REPLAYED",
                                   "COMMERCIAL_DECISION_DISABLED"
                                 ]
  capabilityInputFields:         [
                                   "commercialScopeKey",
                                   "commercialScopeVersion",
                                   "capabilityKey",
                                   "capabilityVersion",
                                   "action",
                                   "currency",
                                   "accountingUnit",
                                   "partnerDependency",
                                   "productDependency",
                                   "customerId",
                                   "walletAccountId",
                                   "amountMinor",
                                   "requestContext",
                                   "causationId"
                                 ]
  capabilityOutputFields:        [
                                   "commercialDecisionId",
                                   "commercialScopeKey",
                                   "commercialScopeVersion",
                                   "commercialCapabilityKey",
                                   "commercialCapabilityVersion",
                                   "commercialCapabilityAction",
                                   "commercialCapabilityStatus",
                                   "commercialCapabilityResult",
                                   "commercialCapabilityMaskedFields",
                                   "commercialCapabilityMask",
                                   "commercialCapabilityAudit",
                                   "commercialCapabilityIssAt",
                                   "commercialCapabilityExpAt",
                                   "commercialCapabilityCorrId",
                                   "commercialCapabilityReqId",
                                   "commercialCapabilityCausId"
                                 ]
  capabilityVersionNegotiationRules: per §3.2 commercial capability registration
  capabilityReplayRules:         per §3.2 commercial capability registration
  capabilityCompatibilityRules:  per §3.2 commercial capability registration
  capabilityConsumerContracts:   per §3.2 commercial capability registration
  capabilityEffectiveFrom:       "2026-08-09T00:00:00.000Z" (frozen; aligned with the B1 plan commit)
  capabilityEffectiveTo:         null (no planned deprecation)
  capabilityRetentionDays:       365 (per A6T10 / B1T10 default retention)

capability-2:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  capabilityKey:                "commercial.virtual-account.inbound-funding.commission"
  capabilityVersion:            1
  action:                       "compute"
  capabilityClassificationLevel: "INTERNAL" (per A6T10 / B1T10 data handling level vocabulary)
  capabilityStateVocabulary:     [
                                   "COMMERCIAL_DECISION_PENDING",
                                   "COMMERCIAL_DECISION_ADMITTED",
                                   "COMMERCIAL_DECISION_SUPPRESSED",
                                   "COMMERCIAL_DECISION_FAILED",
                                   "COMMERCIAL_DECISION_REPLAYED",
                                   "COMMERCIAL_DECISION_DISABLED"
                                 ]
  capabilityInputFields:         (same as capability-1; per B1T04 commission engine)
  capabilityOutputFields:        (same as capability-1; per B1T04 commission engine)
  capabilityVersionNegotiationRules: per §3.2 commercial capability registration
  capabilityReplayRules:         per §3.2 commercial capability registration
  capabilityCompatibilityRules:  per §3.2 commercial capability registration
  capabilityConsumerContracts:   per §3.2 commercial capability registration
  capabilityEffectiveFrom:       "2026-08-09T00:00:00.000Z" (frozen; aligned with the B1 plan commit)
  capabilityEffectiveTo:         null (no planned deprecation)
  capabilityRetentionDays:       365 (per A6T10 / B1T10 default retention)
```

The B1T04 task will implement the actual B1 fee engine, commission engine, and revenue-sharing engine (B1T02 is documentation-only and does not implement any B1 engine). The B1 commercial catalog and commercial-boundary contract record the capability registration; the B1T04 task will implement the runtime that consumes the capability registration through the B1 commercial catalog and commercial-boundary contract.

### 4.3 First commercial scope prohibited adjacent commercial scopes

The first commercial scope `commercial.virtual-account.inbound-funding` v1 is bounded; the following adjacent commercial scopes are explicitly prohibited for the first commercial scope and require a separate B1 cycle (reasserted from the B1T01 baseline §4.4):

- `commercial.virtual-account.outbound-settlement` — out of scope for the first commercial scope; requires a separate B1 cycle plus a separate B1 ADR.
- Any commercial scope under a future A7 product (e.g., savings, lending, bills, airtime, QR / merchant, agent-assisted, card, bulk / payroll, FX) — out of scope for the first commercial scope; requires a separate A7 cycle plus a separate B1 cycle.
- Any commercial scope under a second commercial partner (other than the already-approved A6 partner `NIBSS_NIP` planning rail) — out of scope for the first commercial scope; requires a separate A6 cycle plus a separate B1 cycle.
- Any commercial scope under a second currency (e.g., `KES`, `GHS`, `ZAR`, `USD`, `EUR`, `GBP`) — out of scope for the first commercial scope; requires a separate A1 cycle plus a separate B1 cycle.
- Any commercial scope under a second accounting unit (e.g., `MERCHANT_FUNDS`, `PLATFORM_FUNDS`, `ESCROW_FUNDS`) — out of scope for the first commercial scope; requires a separate A5 cycle plus a separate B1 cycle.
- Any commercial scope under a public commercial surface, a public commercial API, a mobile commercial channel, a web commercial channel, a marketing-consent surface, a customer-cohort expansion, a merchant-cohort expansion, or a partner-cohort expansion — out of scope for the first commercial scope; requires a separate B2 cycle.
- Any commercial scope under a cross-region rollout or a cross-currency rollout — out of scope for the first commercial scope; requires a separate B2 cycle.
- Any commercial scope under a second commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate — out of scope for the first commercial scope; requires a separate B1 cycle plus a separate B1T11 release-gate review.

## 5. Commercial capability registration (B1T03 handoff)

B1T02 records the B1 commercial capability registration contract; B1T03 will define the actual B1 commercial plans, packages, and bundles, the actual B1 commercial customer tiers, merchant tiers, partner tiers, product entitlements, feature flags, and dynamic limits, and the actual B1 commercial pricing rules. B1T02 is documentation-only and does not predefine any B1 commercial plan, B1 commercial package, B1 commercial bundle, B1 commercial customer tier, B1 commercial merchant tier, B1 commercial partner tier, B1 commercial product entitlement, B1 commercial feature flag, B1 commercial dynamic limit, B1 commercial subscription plan, B1 commercial pricing rule, B1 commercial fee rule, B1 commercial commission rule, B1 commercial revenue-sharing rule, B1 commercial billing cycle, B1 commercial invoice format, B1 commercial statement format, B1 commercial campaign, B1 commercial promotion, B1 commercial coupon, B1 commercial referral, B1 commercial cashback, B1 commercial loyalty, B1 commercial revenue-recognition standard, B1 commercial tax / VAT scheme, B1 commercial cost-accounting methodology, B1 commercial profitability model, B1 commercial analytics report, B1 commercial approval, B1 commercial audit policy, B1 commercial idempotency scheme, B1 commercial reconciliation model, B1 commercial data-classification rule, B1 commercial retention rule, B1 commercial legal-hold rule, B1 commercial secret classification, B1 commercial disclosure audience maximum, B1 commercial support-trace classification, B1 commercial release gate, or B1 commercial release-gate evidence package.

The B1 commercial catalog and commercial-boundary contract record the B1T03 handoff as follows:

- B1T03 will define the B1 commercial pricing catalog (per §3.1 and §3.2 commercial registration contract).
- B1T03 will define the B1 commercial plan catalog (per §3.3 commercial plan registration).
- B1T03 will define the B1 commercial subscription plan catalog (per §3.3 commercial plan registration).
- B1T03 will define the B1 commercial customer tier catalog (per §3.3 commercial plan registration).
- B1T03 will define the B1 commercial merchant tier catalog (per §3.3 commercial plan registration).
- B1T03 will define the B1 commercial partner tier catalog (per §3.3 commercial plan registration).
- B1T03 will define the B1 commercial product entitlement catalog (per §3.3 commercial plan registration).
- B1T03 will define the B1 commercial product packaging catalog (per §3.4 commercial package registration).
- B1T03 will define the B1 commercial bundle catalog (per §3.5 commercial bundle registration).
- B1T03 will populate the `commercialCapabilityPlans`, `commercialCapabilityPackages`, and `commercialCapabilityBundles` arrays of the first commercial scope registration.
- B1T03 will populate the B1 commercial catalog and commercial-boundary contract with the B1 commercial plans, packages, bundles, customer tiers, merchant tiers, partner tiers, product entitlements, feature flags, dynamic limits, and subscription plans.
- B1T03 will populate the B1 commercial catalog and commercial-boundary contract with the B1 commercial pricing rules.
- B1T03 will document the B1 commercial catalog and commercial-boundary contract B1T03 evidence package.

B1T02 does not implement the B1T03 handoff; B1T03 is out of scope for B1T02.

## 6. Commercial dependency declaration

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial dependency declaration types. The following types are frozen at v1:

```text
CommercialDependencyDeclarationV1
  commercialScopeKey:           <CommercialScopeKeyV1>
  commercialScopeVersion:       <CommercialScopeVersionV1>
  dependencyType:                <CommercialDependencyTypeV1>
  dependencyKey:                 <string>
  dependencyVersion:             <string>
  dependencyClassificationLevel:  <A6T10 data handling level> | null
  dependencyRetentionDays:       <number> | null
  dependencyEffectiveFrom:       <ISO-8601 timestamp> | null
  dependencyEffectiveTo:         <ISO-8601 timestamp> | null
```

The commercial dependency types are:

```text
A1_CANONICAL_OWNERSHIP
A1_DATA_CLASSIFICATION
A1_RETENTION
A1_LEGAL_HOLD
A1_PRIVACY
A2_AUDIENCE
A2_AUTHORIZATION
A2_PROTECTED_INGRESS
A2_SECURITY_EVENT
A2_PRIVILEGED_ACTION
A2_STEP_UP_APPROVAL
A3_BINDING
A3_BINDING_RECHECK
A3_BINDING_OWNERSHIP
A4_POLICY
A4_POLICY_CURRENTNESS
A4_POLICY_RE_EVALUATION
A4_POLICY_LIMITS
A4_POLICY_OBLIGATIONS
A5_LEDGER
A5_INTERNAL_LIFECYCLE
A5_OUTBOX
A5_RECONCILIATION
A5_RECOVERY
A6_PARTNER_ADAPTER
A6_PARTNER_CALLBACK
A6T05_EXTERNAL_OPERATION
A6T05_PROVIDER_IDEMPOTENCY
A6T08_SETTLEMENT
A6T08_SUSPENSE
A6T08_COMPENSATING
A6T09_EXTERNAL_RECONCILIATION
A6T10_DATA_CLASSIFICATION_REGISTRY
A6T10_DATA_MINIMIZATION
A6T10_DISCLOSURE_PROJECTION
A6T10_SUPPORT_TRACE_PROJECTION
A6T10_PARTNER_PAYLOAD_VALIDATION
A7_PRODUCT_CATALOG
A7_PRODUCT_BOUNDARY
A7_PRODUCT_CUSTOMER_BINDING
A7_PRODUCT_COMMAND
A7_PRODUCT_NOTIFICATION_DELIVERY
A7_PRODUCT_LIFECYCLE
A7_PRODUCT_FINANCIAL_EFFECT
A7_PRODUCT_RECONCILIATION
A7_PRODUCT_DATA_MINIMIZATION
CUSTOMER_PREFERENCE
OPERATIONS_AUDIT
OPERATIONS_IDEMPOTENCY
OPERATIONS_OUTBOX
OPERATIONS_METRICS
OPERATIONS_DIAGNOSTICS
```

The first commercial scope `commercial.virtual-account.inbound-funding` v1 records the following commercial dependency declaration in `B1-COMMERCIAL-CATALOG` v1:

```text
dependency-1:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                A1_DATA_CLASSIFICATION
  dependencyKey:                 "A6T10-ExternalDataClassificationRegistry"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-2:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                A6T10_DATA_MINIMIZATION
  dependencyKey:                 "A6T10-ExternalDataMinimizationService"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-3:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                A7_PRODUCT_COMMAND
  dependencyKey:                 "A7T05-ProductCommandService"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-4:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                A7_PRODUCT_FINANCIAL_EFFECT
  dependencyKey:                 "A7T08-ProductFinancialEffectService"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-5:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                A5_LEDGER
  dependencyKey:                 "A5-LedgerService"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-6:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                A4_POLICY
  dependencyKey:                 "A4-CapabilityPolicyEvaluationService"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-7:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                A3_BINDING
  dependencyKey:                 "A3-CustomerFinancialAccountBindingService"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-8:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                CUSTOMER_PREFERENCE
  dependencyKey:                 "CustomerPreference"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-9:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                A6_PARTNER_ADAPTER
  dependencyKey:                 "NIBSS_NIP"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null

dependency-10:
  commercialScopeKey:           "commercial.virtual-account.inbound-funding"
  commercialScopeVersion:       1
  dependencyType:                OPERATIONS_AUDIT
  dependencyKey:                 "Operations-AuditService"
  dependencyVersion:             "1"
  dependencyClassificationLevel:  "INTERNAL"
  dependencyRetentionDays:        365
  dependencyEffectiveFrom:        "2026-08-09T00:00:00.000Z"
  dependencyEffectiveTo:          null
```

The first commercial scope records ten explicit dependencies. The B1 commercial catalog and commercial-boundary contract do not record any other dependency; any additional dependency requires a separate B1 cycle plus a separate B1 ADR. The B1 commercial catalog and commercial-boundary contract do not invent a second canonical identity in any A1-A7 domain.

## 7. Commercial compatibility rules

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial compatibility rules. The following types are frozen at v1:

```text
CommercialCompatibilityRuleV1
  ruleId:                        <CommercialCompatibilityRuleIdV1>
  ruleDescription:                <string>
  ruleSource:                     <CommercialCompatibilityRuleSourceV1>
  ruleInput:                      readonly CommercialCompatibilityRuleInputV1[]
  ruleOutput:                     <CommercialCompatibilityRuleOutputV1>
  ruleEffectiveFrom:              <ISO-8601 timestamp> | null
  ruleEffectiveTo:                <ISO-8601 timestamp> | null
```

The first commercial scope `commercial.virtual-account.inbound-funding` v1 records the following commercial compatibility rules in `B1-COMMERCIAL-CATALOG` v1:

```text
rule-1:
  ruleId:                        "B1_COMPAT_RULE_CURRENCY_NGN"
  ruleDescription:                "Currency must equal NGN"
  ruleSource:                     "B1T02-B1-COMMERCIAL-CATALOG-CONTRACT"
  ruleInput:                      [
                                   "commercialScopeKey",
                                   "currency"
                                 ]
  ruleOutput:                     "compatible" | "incompatible"
  ruleEffectiveFrom:              "2026-08-09T00:00:00.000Z"
  ruleEffectiveTo:                null

rule-2:
  ruleId:                        "B1_COMPAT_RULE_ACCOUNTING_UNIT_CUSTOMER_FUNDS"
  ruleDescription:                "Accounting unit must equal CUSTOMER_FUNDS"
  ruleSource:                     "B1T02-B1-COMMERCIAL-CATALOG-CONTRACT"
  ruleInput:                      [
                                   "commercialScopeKey",
                                   "accountingUnit"
                                 ]
  ruleOutput:                     "compatible" | "incompatible"
  ruleEffectiveFrom:              "2026-08-09T00:00:00.000Z"
  ruleEffectiveTo:                null

rule-3:
  ruleId:                        "B1_COMPAT_RULE_PARTNER_NIBSS_NIP"
  ruleDescription:                "Partner dependency must equal NIBSS_NIP"
  ruleSource:                     "B1T02-B1-COMMERCIAL-CATALOG-CONTRACT"
  ruleInput:                      [
                                   "commercialScopeKey",
                                   "partnerDependency"
                                 ]
  ruleOutput:                     "compatible" | "incompatible"
  ruleEffectiveFrom:              "2026-08-09T00:00:00.000Z"
  ruleEffectiveTo:                null

rule-4:
  ruleId:                        "B1_COMPAT_RULE_PRODUCT_VIRTUAL_ACCOUNT_V1"
  ruleDescription:                "Product dependency must equal VIRTUAL_ACCOUNT v1"
  ruleSource:                     "B1T02-B1-COMMERCIAL-CATALOG-CONTRACT"
  ruleInput:                      [
                                   "commercialScopeKey",
                                   "productDependency"
                                 ]
  ruleOutput:                     "compatible" | "incompatible"
  ruleEffectiveFrom:              "2026-08-09T00:00:00.000Z"
  ruleEffectiveTo:                null

rule-5:
  ruleId:                        "B1_COMPAT_RULE_CAPABILITY_REGISTERED"
  ruleDescription:                "Capability must be one of the registered capabilities"
  ruleSource:                     "B1T02-B1-COMMERCIAL-CATALOG-CONTRACT"
  ruleInput:                      [
                                   "commercialScopeKey",
                                   "capabilityKey"
                                 ]
  ruleOutput:                     "compatible" | "incompatible"
  ruleEffectiveFrom:              "2026-08-09T00:00:00.000Z"
  ruleEffectiveTo:                null

rule-6:
  ruleId:                        "B1_COMPAT_RULE_CURRENCY_ACCOUNTING_UNIT_PARTNER_PRODUCT_COMBINATION"
  ruleDescription:                "Currency / accounting unit / partner dependency / product dependency combination must be in the B1T03 catalog"
  ruleSource:                     "B1T02-B1-COMMERCIAL-CATALOG-CONTRACT"
  ruleInput:                      [
                                   "commercialScopeKey",
                                   "currency",
                                   "accountingUnit",
                                   "partnerDependency",
                                   "productDependency"
                                 ]
  ruleOutput:                     "compatible" | "incompatible"
  ruleEffectiveFrom:              "2026-08-09T00:00:00.000Z"
  ruleEffectiveTo:                null

rule-7:
  ruleId:                        "B1_COMPAT_RULE_EFFECTIVE_FROM_TO"
  ruleDescription:                "Effective-from / effective-to must be in the B1T03 catalog"
  ruleSource:                     "B1T02-B1-COMMERCIAL-CATALOG-CONTRACT"
  ruleInput:                      [
                                   "commercialScopeKey",
                                   "effectiveFrom",
                                   "effectiveTo"
                                 ]
  ruleOutput:                     "compatible" | "incompatible"
  ruleEffectiveFrom:              "2026-08-09T00:00:00.000Z"
  ruleEffectiveTo:                null

rule-8:
  ruleId:                        "B1_COMPAT_RULE_TIER_ENTITLEMENT_FEATURE_FLAG_DYNAMIC_LIMIT"
  ruleDescription:                "Customer tier / merchant tier / partner tier / entitlement / feature flag / dynamic limit must be in the B1T03 catalog"
  ruleSource:                     "B1T02-B1-COMMERCIAL-CATALOG-CONTRACT"
  ruleInput:                      [
                                   "commercialScopeKey",
                                   "tierKey",
                                   "entitlementKey",
                                   "featureFlagKey",
                                   "dynamicLimitKey"
                                 ]
  ruleOutput:                     "compatible" | "incompatible"
  ruleEffectiveFrom:              "2026-08-09T00:00:00.000Z"
  ruleEffectiveTo:                null
```

The first commercial scope records eight explicit compatibility rules. The B1 commercial catalog and commercial-boundary contract do not record any other compatibility rule; any additional compatibility rule requires a separate B1 cycle plus a separate B1 ADR.

## 8. Commercial ownership boundaries

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial ownership boundaries. The following ownership boundaries are frozen at v1:

| Authority | Owner | B1 commercial catalog and commercial-boundary contract consumption boundary | B1 does not introduce |
| --- | --- | --- | --- |
| A1 canonical ownership, identifier, privacy, retention, legal-hold, cross-cutting | A1 owner | B1 is a read-only consumer of A1 through the B1T10 commercial data classification, commercial data minimization, commercial consent validation, commercial disclosure projection, commercial retention classification, commercial legal-hold, commercial secret classification, commercial support-trace projection, and commercial payload validation surfaces (read-only consumer boundary; A1A6T10 / A1 / B1T10) | B1 does not introduce a second canonical-ownership, identifier, privacy, retention, legal-hold, or cross-cutting authority |
| A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, security-event | A2 owner | B1 is a read-only consumer of A2; B1 commercial approvals reuse the A2 privileged-action and step-up approval surface (read-only consumer boundary; per §10.2) | B1 does not introduce a second authenticated-principal, audience, authorization, privileged-action, protected-ingress, or security-event authority |
| A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, repair/reconciliation | A3 owner | B1 is a read-only consumer of A3; B1 supplies commercial-decision data to A3, not the other way around (read-only consumer boundary; per §10.3) | B1 does not introduce a second Customer-to-Financial-Account binding, ownership, account-lifecycle, currency, accounting-unit, or repair/reconciliation authority |
| A4 capability / action policy, limits, obligations, evidence snapshot, expiry / re-evaluation, currentness | A4 owner | B1 is a read-only consumer of A4; B1 supplies commercial-decision data to A4, not the other way around; A4 remains the only policy authority (read-only consumer boundary; per §10.4) | B1 does not introduce a second capability / action policy, limit, obligation, evidence-snapshot, expiry / re-evaluation, or currentness authority |
| A5 customer-aware command / correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, independent-reconciliation | A5 owner | B1 is a read-only consumer of A5; B1 supplies commercial-decision data to A5, not the other way around; A5 Ledger is the only financial value authority (read-only consumer boundary; per §10.5) | B1 does not introduce a second customer-aware command, correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, or independent-reconciliation authority |
| A6 partner-adapter, partner capability / version, callback, provider idempotency, settlement, suspense, external reconciliation, external-rail data minimization | A6 owner | B1 is a read-only consumer of A6 through the existing A7 product layer; B1 supplies commercial-decision data to A6 through the A6 partner boundary, not the other way around (read-only consumer boundary; per §10.6) | B1 does not introduce a second partner-adapter, partner capability / version, callback, provider-idempotency, settlement, suspense, external-reconciliation, or external-rail data-minimization authority |
| A7 product catalog / product-boundary / product customer-binding / product command / product notification / product lifecycle / product financial effect / product reconciliation / product data-minimization | A7 owner | B1 is a read-only consumer of A7 through the existing A7 read-only consumer boundaries; B1 supplies commercial-decision data to A7, not the other way around (read-only consumer boundary; per §10.7) | B1 does not introduce a second product catalog, product-boundary, product customer-binding, product command, product notification, product lifecycle, product financial effect, product reconciliation, or product data-minimization authority |
| `CustomerPreference` (including `NotificationPreference`) customer intent | A1 / A2 / A7 owner | B1 is a read-only consumer of `CustomerPreference`; B1 never redefines the intent; B1 never dispatches a notification directly (read-only consumer boundary; per §10.8) | B1 does not introduce a second customer intent, consent, preference, or notification authority |
| A6T10 `ExternalDataClassificationRegistry`, `ExternalDataMinimizationService`, `ExternalDataControlAuditContext` | A6T10 owner | B1 is a read-only consumer of A6T10 (read-only consumer boundary; per §10.8) | B1 does not introduce a second data classification, data minimization, data-control audit, consent, disclosure, retention, legal-hold, secret, support-trace, or partner-payload validation authority |
| A6T09 `ExternalReconciliationService` | A6T09 owner | B1 is a read-only consumer of A6T09 (read-only consumer boundary; per §10.9) | B1 does not introduce a second external-reconciliation authority |
| A7T09 `A7ProductReconciliationService` | A7T09 owner | B1 is a read-only consumer of A7T09 (read-only consumer boundary; per §10.10) | B1 does not introduce a second product-reconciliation authority |
| A7T08 `A7ProductFinancialEffectService` | A7T08 owner | B1 is a read-only consumer of A7T08 (read-only consumer boundary; per §10.11) | B1 does not introduce a second product-financial-effect authority |
| A7T06 `A7ProductNotificationDeliveryService` | A7T06 owner | B1 is a read-only consumer of A7T06 (read-only consumer boundary; per §10.12) | B1 does not introduce a second product-notification-delivery authority |
| Shared Operations `AuditService` | Operations owner | B1 is a read-only consumer of the shared Operations `AuditService` (read-only consumer boundary; per §10.13) | B1 does not introduce a second audit authority |
| Shared Operations `IdempotencyService` | Operations owner | B1 is a read-only consumer of the shared Operations `IdempotencyService` (read-only consumer boundary; per §10.13) | B1 does not introduce a second idempotency authority |
| Shared Operations `OutboxService` | Operations owner | B1 is a read-only consumer of the shared Operations `OutboxService` (read-only consumer boundary; per §10.13) | B1 does not introduce a second outbox authority |
| Shared Operations `MetricsService` | Operations owner | B1 is a read-only consumer of the shared Operations `MetricsService` (read-only consumer boundary; per §10.13) | B1 does not introduce a second metrics authority |
| Shared Operations `DiagnosticsService` | Operations owner | B1 is a read-only consumer of the shared Operations `DiagnosticsService` (read-only consumer boundary; per §10.13) | B1 does not introduce a second diagnostics authority |
| Wallet, Reconciliation, Support | Wallet / Reconciliation / Support owner | B1 is a read-only consumer of Wallet, Reconciliation, and Support | B1 does not introduce a second wallet, reconciliation, or support authority |
| Finance, Tax, Security, Privacy, Legal, Risk, Compliance | Finance / Tax / Security / Privacy / Legal / Risk / Compliance owner | B1 is a read-only consumer of Finance, Tax, Security, Privacy, Legal, Risk, Compliance | B1 does not introduce a second finance, tax, security, privacy, legal, risk, or compliance authority |
| B1 commercial catalog and commercial-boundary contract | B1 commercial owner | B1 is the only B1 commercial catalog and commercial-boundary authority; B1T02 is the contract design; B1T03-B1T11 will define the B1 commercial surface | B1 does not introduce a second B1 commercial catalog or commercial-boundary authority before B1T11 commercial release gate is approved |

The B1 commercial catalog and commercial-boundary contract do not introduce a second canonical identity, a second audit authority, a second idempotency authority, a second outbox authority, a second metrics authority, a second diagnostics authority, a second customer-binding authority, a second policy authority, a second authorization authority, a second notification authority, a second settlement authority, a second suspense authority, a second compensating-entry authority, a second reconciliation authority, a second classification authority, a second retention authority, a second legal-hold authority, a second secret authority, a second disclosure authority, a second support-trace authority, a second partner-payload-validation authority, a second Ledger authority, a second Wallet authority, a second product authority, a second partner authority, a second `CustomerPreference` authority, or a second commercial authority in any of the above domains.

## 9. Commercial data safety and evidence minimization

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial data safety and evidence minimization. The following rules are frozen at v1:

- The B1 commercial catalog and commercial-boundary contract MUST NOT include raw credentials (PAN, account secrets, PINs, OTPs, callback signatures, private keys, customer PIN / OTP, device fingerprint raw, risk narrative raw, compliance case raw, or equivalent) in B1 commercial-decision, B1 commercial-financial-effect, B1 commercial-billing, B1 commercial-invoice, B1 commercial-statement, B1 commercial-campaign, B1 commercial-promotion, B1 commercial-coupon, B1 commercial-referral, B1 commercial-cashback, B1 commercial-loyalty, B1 commercial-revenue-recognition, B1 commercial-tax, B1 commercial-cost-accounting, B1 commercial-profitability, B1 commercial-analytics, B1 commercial-reconciliation, B1 commercial-disclosure, B1 commercial-support-trace, B1 commercial-audit, B1 commercial-idempotency, B1 commercial-outbox, B1 commercial-metrics, B1 commercial-diagnostics, B1 commercial-plan, B1 commercial-package, B1 commercial-bundle, B1 commercial-tier, B1 commercial-entitlement, B1 commercial-feature-flag, B1 commercial-dynamic-limit, B1 commercial-subscription-plan, B1 commercial-classification, B1 commercial-retention, B1 commercial-legal-hold, B1 commercial-secret, B1 commercial-approval, B1 commercial-release-gate, or any other B1 commercial payload.
- The B1 commercial catalog and commercial-boundary contract MUST mask or redact B1 commercial-decision output fields that contain a secret classification (per A6T10 / B1T10 secret classification vocabulary) or a HIGHLY_RESTRICTED data handling level (per A6T10 / B1T10 data handling level vocabulary) before the B1 commercial-decision result is emitted to a consumer that is not a SECURITY consumer.
- The B1 commercial catalog and commercial-boundary contract MUST emit the B1 commercial-decision audit context (per §10.13 Operations consumer contracts) through the shared Operations `AuditService` (read-only consumer boundary); the B1 commercial catalog and commercial-boundary contract MUST NOT introduce a second audit authority.
- The B1 commercial catalog and commercial-boundary contract MUST emit the B1 commercial-decision idempotency context (per §10.13 Operations consumer contracts) through the shared Operations `IdempotencyService` (read-only consumer boundary); the B1 commercial catalog and commercial-boundary contract MUST NOT introduce a second idempotency authority.
- The B1 commercial catalog and commercial-boundary contract MUST emit the B1 commercial-decision outbox context (per §10.13 Operations consumer contracts) through the shared Operations `OutboxService` (read-only consumer boundary); the B1 commercial catalog and commercial-boundary contract MUST NOT introduce a second outbox authority.
- The B1 commercial catalog and commercial-boundary contract MUST emit the B1 commercial-decision metrics context (per §10.13 Operations consumer contracts) through the shared Operations `MetricsService` (read-only consumer boundary); the B1 commercial catalog and commercial-boundary contract MUST NOT introduce a second metrics authority.
- The B1 commercial catalog and commercial-boundary contract MUST emit the B1 commercial-decision diagnostics context (per §10.13 Operations consumer contracts) through the shared Operations `DiagnosticsService` (read-only consumer boundary); the B1 commercial catalog and commercial-boundary contract MUST NOT introduce a second diagnostics authority.
- The B1 commercial catalog and commercial-boundary contract MUST fail closed on any prohibited edge, second commercial scope, second commercial partner, second authority, or unapproved capability. The fail-closed behavior is documented in §13.
- The B1 commercial catalog and commercial-boundary contract MUST preserve A1-A7 authority separation. The B1 commercial catalog and commercial-boundary contract MUST NOT mutate any A1-A7 source record.

## 10. Consumer contracts

The B1 commercial catalog and commercial-boundary contract are explicit about the consumer contracts that govern how the catalog and boundary interact with the shared A1-A7 authorities. The following consumer contracts are frozen at v1.

### 10.1 A1 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A1 canonical ownership, identifier, privacy, retention, and cross-cutting contracts. The A1 read-only consumer contract is:

```text
A1ReadOnlyConsumerContractV1
  getCanonicalOwnership(commercialScopeKey)
    -> A1 canonical ownership view | null
  getIdentifierConvention(commercialScopeKey, identifierKind)
    -> A1 identifier convention view | null
  getPrivacyConvention(commercialScopeKey, privacyKind)
    -> A1 privacy convention view | null
  getRetentionConvention(commercialScopeKey, retentionKind)
    -> A1 retention convention view | null
```

The A1 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A1 read-only consumer contract runtime in B1T02. The A1 read-only consumer contract runtime is inherited from the existing A1 canonical ownership, identifier, privacy, retention, and cross-cutting contracts.

### 10.2 A2 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts. The A2 read-only consumer contract is:

```text
A2ReadOnlyConsumerContractV1
  getAuthenticatedPrincipal(requestContext)
    -> A2 authenticated principal view | null
  getAudience(requestContext, audience)
    -> A2 audience view | null
  getAuthorizationDecision(requestContext, capability, action)
    -> A2 authorization decision view | null
  getProtectedIngress(requestContext, route)
    -> A2 protected-ingress view | null
  getSecurityEvent(requestContext, eventKind)
    -> A2 security-event view | null
  getPrivilegedAction(requestContext, action)
    -> A2 privileged-action view | null
  getStepUpApproval(requestContext, action)
    -> A2 step-up-approval view | null
```

The A2 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A2 read-only consumer contract runtime in B1T02. The A2 read-only consumer contract runtime is inherited from the existing A2 authenticated principal, audience, authorization, privileged-action, protected-ingress, and security-event contracts.

### 10.3 A3 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts. The A3 read-only consumer contract is:

```text
A3ReadOnlyConsumerContractV1
  getBinding(customerId, productDependency, currency, accountingUnit)
    -> A3 binding view | null
  getBindingRecheck(customerId, productDependency, currency, accountingUnit)
    -> A3 binding recheck view | null
  getBindingOwnership(customerId, productDependency, currency, accountingUnit)
    -> A3 binding ownership view | null
  getAccountLifecycle(customerId, productDependency, currency, accountingUnit)
    -> A3 account-lifecycle view | null
```

The A3 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A3 read-only consumer contract runtime in B1T02. The A3 read-only consumer contract runtime is inherited from the existing A3 canonical Customer-to-Financial-Account binding, ownership, account lifecycle, currency, accounting-unit, and repair/reconciliation contracts.

### 10.4 A4 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A4 capability / action policy, limits, obligations, evidence snapshot, expiry / re-evaluation, and currentness contracts. The A4 read-only consumer contract is:

```text
A4ReadOnlyConsumerContractV1
  getPolicyDecision(requestContext, capability, action)
    -> A4 policy decision view | null
  getPolicyCurrentness(policyDecisionId)
    -> A4 policy currentness view | null
  getPolicyReEvaluation(policyDecisionId)
    -> A4 policy re-evaluation view | null
  getPolicyLimits(policyDecisionId)
    -> A4 policy limits view | null
  getPolicyObligations(policyDecisionId)
    -> A4 policy obligations view | null
```

The A4 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A4 read-only consumer contract runtime in B1T02. The A4 read-only consumer contract runtime is inherited from the existing A4 capability / action policy, limits, obligations, evidence snapshot, expiry / re-evaluation, and currentness contracts.

### 10.5 A5 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A5 customer-aware command / correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns. The A5 read-only consumer contract is:

```text
A5ReadOnlyConsumerContractV1
  getLedgerAccount(customerId, currency, accountingUnit)
    -> A5 ledger account view | null
  getLedgerJournal(journalId)
    -> A5 ledger journal view | null
  getLedgerBalance(journalId)
    -> A5 ledger balance view | null
  getInternalLifecycle(customerId, currency, accountingUnit)
    -> A5 internal lifecycle view | null
  getOutbox(aggregateType, aggregateId)
    -> A5 outbox view | null
  getReconciliation(reconciliationId)
    -> A5 reconciliation view | null
  getRecovery(recoveryId)
    -> A5 recovery view | null
```

The A5 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A5 read-only consumer contract runtime in B1T02. The A5 read-only consumer contract runtime is inherited from the existing A5 customer-aware command / correlation, lifecycle, Ledger, Operations, outbox, unknown-outcome, pilot-disable, and independent-reconciliation patterns.

### 10.6 A6 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A6 partner-adapter, partner capability / version, callback, provider idempotency, settlement, suspense, external reconciliation, and external-rail data minimization contracts. The A6 read-only consumer contract is:

```text
A6ReadOnlyConsumerContractV1
  getPartnerAdapter(partnerDependency, capabilityKey)
    -> A6 partner adapter view | null
  getPartnerCapability(partnerDependency, capabilityKey)
    -> A6 partner capability view | null
  getCallback(callbackId)
    -> A6 callback view | null
  getProviderIdempotency(providerIdempotencyScope, providerIdempotencyKey)
    -> A6 provider idempotency view | null
  getSettlement(settlementId)
    -> A6 settlement view | null
  getSuspense(suspenseId)
    -> A6 suspense view | null
  getExternalReconciliation(externalReconciliationId)
    -> A6 external reconciliation view | null
  getExternalDataMinimization(fieldName)
    -> A6 external data minimization view | null
```

The A6 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A6 read-only consumer contract runtime in B1T02. The A6 read-only consumer contract runtime is inherited from the existing A6 partner-adapter, partner capability / version, callback, provider idempotency, settlement, suspense, external reconciliation, and external-rail data minimization contracts.

### 10.7 A7 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A7 product catalog, product-boundary, product customer-binding, product command, product notification, product lifecycle, product financial effect, product reconciliation, and product data-minimization contracts. The A7 read-only consumer contract is:

```text
A7ReadOnlyConsumerContractV1
  getProductRegistration(productKey, productVersion)
    -> A7 product registration view | null
  getProductBoundary(productKey, productVersion, capabilityKey)
    -> A7 product boundary view | null
  getProductCustomerBinding(productKey, productVersion, customerId)
    -> A7 product customer binding view | null
  getProductCommand(productKey, productVersion, commandId)
    -> A7 product command view | null
  getProductNotification(productKey, productVersion, notificationId)
    -> A7 product notification view | null
  getProductLifecycle(productKey, productVersion, lifecycleId)
    -> A7 product lifecycle view | null
  getProductFinancialEffect(productKey, productVersion, effectId)
    -> A7 product financial effect view | null
  getProductReconciliation(productKey, productVersion, reconciliationId)
    -> A7 product reconciliation view | null
  getProductDataMinimization(productKey, productVersion, fieldName)
    -> A7 product data minimization view | null
```

The A7 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A7 read-only consumer contract runtime in B1T02. The A7 read-only consumer contract runtime is inherited from the existing A7 product catalog, product-boundary, product customer-binding, product command, product notification, product lifecycle, product financial effect, product reconciliation, and product data-minimization contracts.

### 10.8 `CustomerPreference` and A6T10 read-only consumer contracts

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of `CustomerPreference` (the only customer intent authority) and the A6T10 `ExternalDataClassificationRegistry`, `ExternalDataMinimizationService`, and `ExternalDataControlAuditContext` (the only A6T10 data-control authorities). The `CustomerPreference` and A6T10 read-only consumer contracts are:

```text
CustomerPreferenceReadOnlyConsumerContractV1
  getNotificationPreference(customerId, scope, version)
    -> CustomerPreference notification view | null
  getPreferenceHistory(customerId, scope, version)
    -> CustomerPreference preference history view | null

A6T10ReadOnlyConsumerContractV1
  getDataClassification(fieldName)
    -> A6T10 data classification view | null
  getDataMinimization(fieldName, audience)
    -> A6T10 data minimization view | null
  getConsent(customerId, purpose, jurisdiction)
    -> A6T10 consent view | null
  getDisclosureProjection(externalOperationId, audience)
    -> A6T10 disclosure projection view | null
  getRetention(dataset)
    -> A6T10 retention view | null
  getLegalHold(scope, referenceId)
    -> A6T10 legal-hold view | null
  getSecretClassification(category, reference)
    -> A6T10 secret classification view | null
  getSupportTraceProjection(externalOperationId, audience)
    -> A6T10 support-trace projection view | null
  getPartnerPayloadValidation(partnerKey, capabilityKey, payload)
    -> A6T10 partner-payload validation view | null
```

The `CustomerPreference` and A6T10 read-only consumer contracts are a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the `CustomerPreference` and A6T10 read-only consumer contracts runtime in B1T02. The `CustomerPreference` and A6T10 read-only consumer contracts runtime is inherited from the existing `CustomerPreference` and A6T10 data-control authorities.

### 10.9 A6T09 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A6T09 `ExternalReconciliationService` (the only external reconciliation authority). The A6T09 read-only consumer contract is:

```text
A6T09ReadOnlyConsumerContractV1
  getExternalReconciliationSnapshot(externalOperationId, generatedAt)
    -> A6T09 external reconciliation snapshot view | null
  getExternalReconciliationDiscrepancy(externalReconciliationId, discrepancyCode)
    -> A6T09 external reconciliation discrepancy view | null
```

The A6T09 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A6T09 read-only consumer contract runtime in B1T02. The A6T09 read-only consumer contract runtime is inherited from the existing A6T09 `ExternalReconciliationService`.

### 10.10 A7T09 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A7T09 `A7ProductReconciliationService` (the only product reconciliation authority). The A7T09 read-only consumer contract is:

```text
A7T09ReadOnlyConsumerContractV1
  getProductReconciliationReport(productOperationReference)
    -> A7T09 product reconciliation report view | null
  getProductSupportTrace(productOperationReference)
    -> A7T09 product support trace view | null
  getProductCertificationEvidence(productOperationReference, certificationCase)
    -> A7T09 product certification evidence view | null
```

The A7T09 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A7T09 read-only consumer contract runtime in B1T02. The A7T09 read-only consumer contract runtime is inherited from the existing A7T09 `A7ProductReconciliationService`.

### 10.11 A7T08 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A7T08 `A7ProductFinancialEffectService` (the only product financial effect authority). The A7T08 read-only consumer contract is:

```text
A7T08ReadOnlyConsumerContractV1
  getProductFinancialEffect(productOperationReference)
    -> A7T08 product financial effect view | null
  getProductFinancialEffectState(productOperationReference)
    -> A7T08 product financial effect state view | null
```

The A7T08 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A7T08 read-only consumer contract runtime in B1T02. The A7T08 read-only consumer contract runtime is inherited from the existing A7T08 `A7ProductFinancialEffectService`.

### 10.12 A7T06 read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the A7T06 `A7ProductNotificationDeliveryService` (the only product notification delivery authority). The A7T06 read-only consumer contract is:

```text
A7T06ReadOnlyConsumerContractV1
  getProductNotificationDispatch(productOperationReference)
    -> A7T06 product notification dispatch view | null
  getProductNotificationChannel(productOperationReference, channel)
    -> A7T06 product notification channel view | null
  getProductNotificationAudience(productOperationReference, audience)
    -> A7T06 product notification audience view | null
```

The A7T06 read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the A7T06 read-only consumer contract runtime in B1T02. The A7T06 read-only consumer contract runtime is inherited from the existing A7T06 `A7ProductNotificationDeliveryService`.

### 10.13 Operations read-only consumer contract

The B1 commercial catalog and commercial-boundary contract are a read-only consumer of the shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, and `DiagnosticsService` (the only audit, idempotency, outbox, metrics, and diagnostics authorities). The Operations read-only consumer contract is:

```text
OperationsReadOnlyConsumerContractV1
  getAuditEvent(auditEventId)
    -> Operations audit event view | null
  getIdempotencyRecord(scope, key)
    -> Operations idempotency record view | null
  getOutboxEvent(outboxEventId)
    -> Operations outbox event view | null
  getMetric(metricKey, metricTimestamp)
    -> Operations metric view | null
  getDiagnostic(diagnosticId)
    -> Operations diagnostic view | null
```

The Operations read-only consumer contract is a contract design; the B1 commercial catalog and commercial-boundary contract do not implement the Operations read-only consumer contract runtime in B1T02. The Operations read-only consumer contract runtime is inherited from the existing shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, and `DiagnosticsService`.

## 11. Version negotiation rules

The B1 commercial catalog and commercial-boundary contract are explicit about the version negotiation rules. The following rules are frozen at v1:

- The B1 commercial catalog and commercial-boundary contract version is `B1-COMMERCIAL-CATALOG` v1 / `B1-COMMERCIAL-BOUNDARY` v1.
- If the requested commercialScopeVersion is greater than the catalog's commercialScopeVersion, the boundary MUST respond with `B1_COMMERCIAL_CATALOG_WRONG_VERSION`.
- If the requested commercialScopeVersion is less than the catalog's commercialScopeVersion, the boundary MUST respond with `B1_COMMERCIAL_CATALOG_WRONG_VERSION`.
- If the requested commercialScopeVersion equals the catalog's commercialScopeVersion, the boundary MUST respond with the current registration.
- If the requested commercialCapabilityVersion is greater than the catalog's commercialCapabilityVersion, the boundary MUST respond with `B1_COMMERCIAL_CATALOG_WRONG_VERSION`.
- If the requested commercialCapabilityVersion is less than the catalog's commercialCapabilityVersion, the boundary MUST respond with `B1_COMMERCIAL_CATALOG_WRONG_VERSION`.
- If the requested commercialCapabilityVersion equals the catalog's commercialCapabilityVersion, the boundary MUST respond with the current registration.
- If the requested commercialPlanVersion, commercialPackageVersion, commercialBundleVersion, commercialTierVersion, commercialEntitlementVersion, commercialFeatureFlagVersion, or commercialDynamicLimitVersion does not match the catalog's frozen version, the boundary MUST respond with `B1_COMMERCIAL_CATALOG_WRONG_VERSION`.
- Cross-catalog negotiation (e.g., commercialScopeVersion v1 against commercialScopeVersion v2) is out of scope; the boundary MUST respond with `B1_COMMERCIAL_CATALOG_WRONG_VERSION`.
- The B1 commercial catalog and commercial-boundary contract do not predefine any B1 commercial plan, B1 commercial package, B1 commercial bundle, B1 commercial tier, B1 commercial entitlement, B1 commercial feature flag, or B1 commercial dynamic limit; the B1T03 task will define the B1 commercial catalog and commercial-boundary contract plan / package / bundle / tier / entitlement / feature flag / dynamic limit surfaces.
- A later catalog version (v2) may add optional fields, capability metadata, a second frozen commercial scope, or commercial-extension points; it MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

## 12. Replay expectations

The B1 commercial catalog and commercial-boundary contract are explicit about the replay expectations. The following rules are frozen at v1:

- Commercial-decision replay is allowed only within the commercial-decision replay window (`issuedAt + 86400s`).
- Commercial-decision replay is supported only for the same commercialDecisionId, the same commercialScopeKey, the same commercialScopeVersion, the same commercialCapabilityKey, the same commercialCapabilityVersion, the same commercialAction, the same currency, the same accountingUnit, the same partnerDependency, the same productDependency, the same requestContext.correlationId, and the same requestContext.requestId.
- Commercial-decision replay is NOT supported across different commercialDecisionId, different commercialScopeKey, different commercialScopeVersion, different commercialCapabilityKey, different commercialCapabilityVersion, different commercialAction, different currency, different accountingUnit, different partnerDependency, different productDependency, different requestContext.correlationId, or different requestContext.requestId; the boundary MUST respond with `B1_COMMERCIAL_CATALOG_MALFORMED`.
- Commercial-decision replay is idempotent under the shared Operations `IdempotencyService` (read-only consumer boundary; per §10.13).
- Commercial-decision replay is replay-safe under the shared Operations `AuditService` (read-only consumer boundary; per §10.13).
- Commercial-decision replay never re-emits a commercial-decision result that has expired (`issuedAt + 86400s`); the boundary MUST respond with `B1_COMMERCIAL_CATALOG_QUERY_UNAVAILABLE`.
- Commercial-decision replay is consistent with the existing A1-A7 replay rules (A1-A7 replay rules are inherited by the B1 commercial catalog and commercial-boundary contract; B1 does not invent a new replay rule).

## 13. Fail-closed behavior

The B1 commercial catalog and commercial-boundary contract are explicit about the fail-closed behavior. The following rules are frozen at v1:

- Unsupported commercial capabilities, malformed commercial responses, wrong commercial plan versions, and unavailable commercial flows fail closed or enter a declared recovery state.
- The B1 commercial catalog and commercial-boundary contract MUST respond with one of the B1_COMMERCIAL_CATALOG failure codes (§2.4) on any prohibited edge, second commercial scope, second commercial partner, second authority, or unapproved capability.
- The B1 commercial catalog and commercial-boundary contract MUST NOT silently re-broadcast, silently re-broadcast with masking, or silently fall through to a different commercial scope.
- The B1 commercial catalog and commercial-boundary contract MUST NOT silently rewrite a commercial-decision result.
- The B1 commercial catalog and commercial-boundary contract MUST NOT silently rewrite a commercial-decision failure.
- The B1 commercial catalog and commercial-boundary contract MUST NOT silently swap a commercial-decision result for a commercial-decision failure.
- The B1 commercial catalog and commercial-boundary contract MUST NOT silently swap a commercial-decision failure for a commercial-decision result.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_QUERY_UNAVAILABLE` failure on any internal exception, integration boundary failure, or upstream authority unavailability.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_MALFORMED` failure on any malformed request, malformed response, or upstream authority malformed response.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_WRONG_VERSION` failure on any version negotiation failure.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_INCOMPATIBLE` failure on any compatibility rule failure.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_PROHIBITED` failure on any prohibited edge.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_UNSUPPORTED_CAPABILITY` failure on any unsupported capability.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_MISSING_PLAN` failure on any missing plan reference.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_MISSING_PACKAGE` failure on any missing package reference.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_MISSING_BUNDLE` failure on any missing bundle reference.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_MISSING_TIER` failure on any missing tier reference.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_MISSING_ENTITLEMENT` failure on any missing entitlement reference.
- The B1 commercial catalog and commercial-boundary contract MUST emit a `B1_COMMERCIAL_CATALOG_INVALID_COMMAND` failure on any invalid command.

## 14. Prohibited dependencies

The B1 commercial catalog and commercial-boundary contract are explicit about the prohibited dependencies. The following dependencies are prohibited at v1 (the B1 plan §11 records the full B1 prohibited edges; the B1T02 baseline records the B1T02-relevant prohibited dependencies):

- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second pricing engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second fee engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second commission engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second revenue-sharing engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second billing engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second invoice engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second statement-generation engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second campaign engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second promotion engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second coupon engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second referral engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second cashback engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second loyalty engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second revenue-recognition engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second tax / VAT engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second cost-accounting engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second commercial-analytics engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second profitability engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second commercial-reconciliation engine.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second commercial data classification.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second commercial idempotency.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second commercial audit.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second commercial approvals.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second feature flag surface.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second commercial release gate.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second B2 customer-activation rollout.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second B2 public-channel implementation.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second B2 marketing-consent onboarding.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second B2 cross-region or cross-currency rollout.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second B2 partner onboarding beyond the already-approved A6 partner.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second B2 broad customer activation.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second A8 scale / extraction.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second public commercial API.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second public commercial channel.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second mobile commercial channel.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second web commercial channel.
- The B1 commercial catalog and commercial-boundary contract MUST NOT depend on a second marketing-consent surface.

The B1 commercial catalog and commercial-boundary contract do not introduce a second canonical identity, a second audit authority, a second idempotency authority, a second outbox authority, a second metrics authority, a second diagnostics authority, a second customer-binding authority, a second policy authority, a second authorization authority, a second notification authority, a second settlement authority, a second suspense authority, a second compensating-entry authority, a second reconciliation authority, a second classification authority, a second retention authority, a second legal-hold authority, a second secret authority, a second disclosure authority, a second support-trace authority, a second partner-payload-validation authority, a second Ledger authority, a second Wallet authority, a second product authority, a second partner authority, a second `CustomerPreference` authority, or a second commercial authority in any of the above domains.

## 15. Integration boundaries

The B1 commercial catalog and commercial-boundary contract are explicit about the integration boundaries. The following integration boundaries are frozen at v1:

- The B1 commercial catalog and commercial-boundary contract integrate with A1 through the A1 read-only consumer contract (per §10.1).
- The B1 commercial catalog and commercial-boundary contract integrate with A2 through the A2 read-only consumer contract (per §10.2).
- The B1 commercial catalog and commercial-boundary contract integrate with A3 through the A3 read-only consumer contract (per §10.3).
- The B1 commercial catalog and commercial-boundary contract integrate with A4 through the A4 read-only consumer contract (per §10.4).
- The B1 commercial catalog and commercial-boundary contract integrate with A5 through the A5 read-only consumer contract (per §10.5).
- The B1 commercial catalog and commercial-boundary contract integrate with A6 through the A6 read-only consumer contract (per §10.6).
- The B1 commercial catalog and commercial-boundary contract integrate with A7 through the A7 read-only consumer contract (per §10.7).
- The B1 commercial catalog and commercial-boundary contract integrate with `CustomerPreference` and A6T10 through the `CustomerPreference` and A6T10 read-only consumer contracts (per §10.8).
- The B1 commercial catalog and commercial-boundary contract integrate with A6T09 through the A6T09 read-only consumer contract (per §10.9).
- The B1 commercial catalog and commercial-boundary contract integrate with A7T09 through the A7T09 read-only consumer contract (per §10.10).
- The B1 commercial catalog and commercial-boundary contract integrate with A7T08 through the A7T08 read-only consumer contract (per §10.11).
- The B1 commercial catalog and commercial-boundary contract integrate with A7T06 through the A7T06 read-only consumer contract (per §10.12).
- The B1 commercial catalog and commercial-boundary contract integrate with the shared Operations services through the Operations read-only consumer contract (per §10.13).
- The B1 commercial catalog and commercial-boundary contract do not integrate with a second pricing engine, a second fee engine, a second commission engine, a second revenue-sharing engine, a second billing engine, a second invoice engine, a second statement-generation engine, a second campaign engine, a second promotion engine, a second coupon engine, a second referral engine, a second cashback engine, a second loyalty engine, a second revenue-recognition engine, a second tax / VAT engine, a second cost-accounting engine, a second commercial-analytics engine, a second profitability engine, a second commercial-reconciliation engine, a second commercial data classification, a second commercial idempotency, a second commercial audit, a second commercial approvals, a second feature flag surface, a second commercial release gate, a second B2 customer-activation rollout, a second B2 public-channel implementation, a second B2 marketing-consent onboarding, a second B2 cross-region or cross-currency rollout, a second B2 partner onboarding beyond the already-approved A6 partner, a second B2 broad customer activation, a second A8 scale / extraction, a second public commercial API, a second public commercial channel, a second mobile commercial channel, a second web commercial channel, or a second marketing-consent surface.

## 16. Compatibility with future commercial scopes

The B1 commercial catalog and commercial-boundary contract are explicit about the compatibility with future commercial scopes. The following rules are frozen at v1:

- A later B1 cycle may add a second frozen commercial scope (e.g., `commercial.virtual-account.outbound-settlement`) under the existing A7 first product `VIRTUAL_ACCOUNT` v1; the second commercial scope is subject to a separate B1 cycle plus a separate B1 ADR plus a separate `B1-COMMERCIAL-CATALOG` v1 registration; the B1 commercial catalog and commercial-boundary contract do not predefine the second commercial scope.
- A later B1 cycle may add a commercial scope under a future A7 product (e.g., savings, lending, bills, airtime, QR / merchant, agent-assisted, card, bulk / payroll, FX); the future A7 product is subject to a separate A7 cycle plus a separate A7 ADR plus a separate B1 cycle; the B1 commercial catalog and commercial-boundary contract do not predefine any future A7 product commercial scope.
- A later B1 cycle may add a commercial scope under a second commercial partner (other than the already-approved A6 partner `NIBSS_NIP` planning rail); the second commercial partner is subject to a separate A6 cycle plus a separate A6 ADR plus a separate B1 cycle; the B1 commercial catalog and commercial-boundary contract do not predefine any second commercial partner commercial scope.
- A later B1 cycle may add a commercial scope under a second currency (e.g., `KES`, `GHS`, `ZAR`, `USD`, `EUR`, `GBP`); the second currency is subject to a separate A1 cycle plus a separate A1 ADR plus a separate B1 cycle; the B1 commercial catalog and commercial-boundary contract do not predefine any second currency commercial scope.
- A later B1 cycle may add a commercial scope under a second accounting unit (e.g., `MERCHANT_FUNDS`, `PLATFORM_FUNDS`, `ESCROW_FUNDS`); the second accounting unit is subject to a separate A5 cycle plus a separate A5 ADR plus a separate B1 cycle; the B1 commercial catalog and commercial-boundary contract do not predefine any second accounting unit commercial scope.
- A later B1 cycle may add a public commercial surface, a public commercial API, a mobile commercial channel, a web commercial channel, a marketing-consent surface, a customer-cohort expansion, a merchant-cohort expansion, or a partner-cohort expansion; the public commercial surface is subject to a separate B2 cycle; the B1 commercial catalog and commercial-boundary contract do not predefine any public commercial surface, public commercial API, mobile commercial channel, web commercial channel, marketing-consent surface, customer-cohort expansion, merchant-cohort expansion, or partner-cohort expansion.
- A later B1 cycle may add a cross-region rollout or a cross-currency rollout; the cross-region rollout or cross-currency rollout is subject to a separate B2 cycle; the B1 commercial catalog and commercial-boundary contract do not predefine any cross-region rollout or cross-currency rollout.
- A later B1 cycle may add a second commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate; the second commercial authority is subject to a separate B1 cycle plus a separate B1 ADR; the B1 commercial catalog and commercial-boundary contract do not predefine any second commercial authority.
- A later B1 catalog version (v2) may add optional fields, capability metadata, a second frozen commercial scope, or commercial-extension points; a later B1 catalog version (v2) MUST NOT weaken v1 invariants or silently re-broaden the v1 first commercial scope.

## 17. Commercial sandbox / fixture contract and commercial-independent catalog tests

The B1 commercial catalog and commercial-boundary contract are explicit about the commercial sandbox / fixture contract and the commercial-independent catalog tests. The following rules are frozen at v1:

- The B1 commercial catalog and commercial-boundary contract are deterministic; the B1 commercial catalog and commercial-boundary contract use deterministic fixtures for all commercial catalog tests; the B1 commercial catalog and commercial-boundary contract do not require a live partner, a live product, a live A1-A7 authority, a live `CustomerPreference`, a live shared Operations service, or a live B1 commercial engine to prove the commercial catalog contract.
- The B1 commercial catalog and commercial-boundary contract are idempotent; the B1 commercial catalog and commercial-boundary contract use the shared Operations `IdempotencyService` (read-only consumer boundary; per §10.13) for all commercial catalog tests; the B1 commercial catalog and commercial-boundary contract do not introduce a second idempotency authority.
- The B1 commercial catalog and commercial-boundary contract are replay-safe; the B1 commercial catalog and commercial-boundary contract use the shared Operations `AuditService` (read-only consumer boundary; per §10.13) for all commercial catalog tests; the B1 commercial catalog and commercial-boundary contract do not introduce a second audit authority.
- The B1 commercial catalog and commercial-boundary contract are commercial-independent of any B1 commercial-decision engine, B1 commercial-financial-effect engine, B1 commercial-incentive engine, or B1 commercial-analytics engine; the B1 commercial catalog and commercial-boundary contract do not depend on a B1 commercial-decision engine, B1 commercial-financial-effect engine, B1 commercial-incentive engine, or B1 commercial-analytics engine to prove the commercial catalog contract.
- The B1 commercial catalog and commercial-boundary contract MUST NOT post a journal, mutate a balance, repair a binding, change A4 policy / source records, or dispatch a notification.

## 18. Handoff to later B1 tasks

The B1 commercial catalog and commercial-boundary contract define the handoff to later B1 tasks as follows:

- B1T03 will define the actual B1 commercial plans, packages, bundles, customer tiers, merchant tiers, partner tiers, product entitlements, feature flags, dynamic limits, and subscription plans (per §5).
- B1T04 will implement the B1 fee engine, commission engine, and revenue-sharing engine (per the B1 plan §8 B1T04).
- B1T05 will implement the B1 billing engine, invoice engine, and statement-generation engine (per the B1 plan §8 B1T05).
- B1T06 will implement the B1 campaign, promotion, and coupon engine (per the B1 plan §8 B1T06).
- B1T07 will implement the B1 referral, cashback, and loyalty engine (per the B1 plan §8 B1T07).
- B1T08 will implement the B1 revenue-recognition, tax / VAT, and cost-accounting engine (per the B1 plan §8 B1T08).
- B1T09 will implement the B1 commercial analytics, profitability, and commercial reconciliation (per the B1 plan §8 B1T09).
- B1T10 will implement the B1 commercial data classification, commercial idempotency, commercial audit, commercial approvals, and feature flag surface (per the B1 plan §8 B1T10).
- B1T11 will validate the complete B1 commercial-platform foundation, prepare the commercial release gate, and prepare the B2 handoff (per the B1 plan §8 B1T11).

The B1 commercial catalog and commercial-boundary contract are the entry point for B1T03-B1T11. B1T02 does not authorize B1T03-B1T11 to begin runtime work; B1T03-B1T11 must still author their own B1 ADR, must still pass their own acceptance criteria, and must still be approved by the B1 release-gate review.

## 19. Verification record

- [x] The B1 commercial catalog and commercial-boundary contract are defined as `CommercialCatalogContractV1` and `CommercialBoundaryContractV1` at `B1-COMMERCIAL-CATALOG` v1 / `B1-COMMERCIAL-BOUNDARY` v1.
- [x] The first commercial scope is frozen at `commercial.virtual-account.inbound-funding` v1 with explicit `commercialScopeKey`, `commercialScopeVersion`, `direction`, `currency`, `accountingUnit`, `partnerDependency`, `productDependency`, `internalCommercialDecisionOwner`, `capabilities`, `stateVocabulary`, `prohibitedAdjacentCommercialScopes`, `prohibitedDependencies`, `compatibilityRules`, `consumerContracts`, `versionNegotiationRules`, `replayRules`, `classificationLevel`, `retentionDays`, `dataControlClassification`, `commercialCapabilityPlans`, `commercialCapabilityPackages`, and `commercialCapabilityBundles` recorded.
- [x] The commercial identity vocabulary is defined as `CommercialScopeKeyV1`, `CommercialScopeVersionV1`, `CommercialCapabilityKeyV1`, `CommercialActionV1`, `CommercialCurrencyV1`, `CommercialAccountingUnitV1`, `CommercialDirectionV1`, `CommercialPartnerDependencyV1`, `CommercialProductDependencyV1`, `CommercialPlanKeyV1`, `CommercialPlanVersionV1`, `CommercialPackageKeyV1`, `CommercialPackageVersionV1`, `CommercialBundleKeyV1`, `CommercialBundleVersionV1`, `CommercialTierKeyV1`, `CommercialTierVersionV1`, `CommercialEntitlementKeyV1`, `CommercialEntitlementVersionV1`, `CommercialFeatureFlagKeyV1`, `CommercialFeatureFlagVersionV1`, `CommercialDynamicLimitKeyV1`, `CommercialDynamicLimitVersionV1`.
- [x] Commercial catalog versioning is defined as `B1-COMMERCIAL-CATALOG` v1 with explicit `versionNegotiationRules` recorded.
- [x] Commercial capability registration is defined as `CommercialCapabilityRegistrationV1` with explicit `capabilityKey`, `capabilityVersion`, `action`, `capabilityClassificationLevel`, `capabilityStateVocabulary`, `capabilityInputFields`, `capabilityOutputFields`, `capabilityVersionNegotiationRules`, `capabilityReplayRules`, `capabilityCompatibilityRules`, `capabilityConsumerContracts`, `capabilityEffectiveFrom`, `capabilityEffectiveTo`, `capabilityRetentionDays`.
- [x] Commercial plan registration is defined as `CommercialPlanRegistrationV1` with explicit `commercialPlanKey`, `commercialPlanVersion`, `planTierEligibility`, `planProductEligibility`, `planPartnerEligibility`, `planEntitlements`, `planFeatureFlags`, `planDynamicLimits`, `planCapabilities`, `planEffectiveFrom`, `planEffectiveTo`, `planClassificationLevel`, `planRetentionDays`.
- [x] Commercial package registration is defined as `CommercialPackageRegistrationV1` with explicit `commercialPackageKey`, `commercialPackageVersion`, `packageComposition`, `packageCapabilities`, `packageEntitlements`, `packageFeatureFlags`, `packageDynamicLimits`, `packageEffectiveFrom`, `packageEffectiveTo`, `packageClassificationLevel`, `packageRetentionDays`.
- [x] Commercial bundle registration is defined as `CommercialBundleRegistrationV1` with explicit `commercialBundleKey`, `commercialBundleVersion`, `bundleComposition`, `bundleCapabilities`, `bundleEntitlements`, `bundleFeatureFlags`, `bundleDynamicLimits`, `bundleEffectiveFrom`, `bundleEffectiveTo`, `bundleClassificationLevel`, `bundleRetentionDays`.
- [x] Commercial dependency declarations are recorded as ten explicit dependencies (A1, A6T10, A7T05, A7T08, A5, A4, A3, `CustomerPreference`, A6 partner, Operations) with explicit `dependencyType`, `dependencyKey`, `dependencyVersion`, `dependencyClassificationLevel`, `dependencyRetentionDays`, `dependencyEffectiveFrom`, `dependencyEffectiveTo`.
- [x] Compatibility rules are recorded as eight explicit compatibility rules (currency, accounting unit, partner dependency, product dependency, capability, currency / accounting unit / partner dependency / product dependency combination, effective-from / effective-to, customer tier / merchant tier / partner tier / entitlement / feature flag / dynamic limit).
- [x] Ownership boundaries are recorded as 24 explicit authority rows (A1, A2, A3, A4, A5, A6, A7, `CustomerPreference`, A6T10, A6T09, A7T09, A7T08, A7T06, shared Operations services, Wallet, Reconciliation, Support, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, B1 commercial).
- [x] Consumer contracts are recorded for A1, A2, A3, A4, A5, A6, A7, `CustomerPreference` and A6T10, A6T09, A7T09, A7T08, A7T06, and shared Operations services.
- [x] Operations consumer contracts are recorded for the shared Operations `AuditService`, `IdempotencyService`, `OutboxService`, `MetricsService`, and `DiagnosticsService`.
- [x] Version negotiation rules are recorded as eight explicit rules (commercialScopeVersion, commercialCapabilityVersion, commercialPlanVersion, commercialPackageVersion, commercialBundleVersion, commercialTierVersion, commercialEntitlementVersion, commercialFeatureFlagVersion, commercialDynamicLimitVersion, cross-catalog negotiation).
- [x] Fail-closed behavior is recorded as 14 explicit rules (unsupported capability, malformed request/response, wrong version, prohibited edge, second scope, second partner, second authority, unapproved capability, missing plan/package/bundle/tier/entitlement, invalid command, query unavailable).
- [x] Prohibited dependencies are recorded as 40+ explicit prohibited dependencies (B1T03-B1T11 engines, B2 surfaces, A8 surfaces, public channels, marketing-consent surface, etc.).
- [x] Integration boundaries are recorded as 13 explicit integration boundaries (A1, A2, A3, A4, A5, A6, A7, `CustomerPreference` and A6T10, A6T09, A7T09, A7T08, A7T06, shared Operations).
- [x] Replay expectations are recorded as six explicit replay rules (replay window, replay match, replay no-match, replay idempotency, replay audit, replay expiry).
- [x] Compatibility with future commercial scopes is recorded as eight explicit compatibility rules (second commercial scope under existing A7 first product, commercial scope under future A7 product, commercial scope under second commercial partner, commercial scope under second currency, commercial scope under second accounting unit, public commercial surface, cross-region rollout, second commercial authority).
- [x] No application source, entity, migration, service, controller, API, route, scheduler, billing, invoicing, pricing, fee, commission, revenue, campaign, promotion, coupon, referral, cashback, loyalty, tax, cost-accounting, profitability, analytics, audit, idempotency, reconciliation, classification, retention, feature flag, approval, or runtime activation is created by B1T02.
- [x] B1T02 does not begin B1T03 or any later B1 task.
- [x] B1T02 does not begin B2 customer-activation rollout, B2 public-channel implementation, B2 marketing-consent onboarding, B2 cross-region or cross-currency rollout, B2 partner onboarding beyond the already-approved A6 partner, or B2 broad customer activation.
- [x] B1T02 does not begin A8 scale / extraction, A8 service topology change, A8 regional expansion, A8 partner expansion, A8 product expansion, A8 capacity expansion, A8 customer cohort expansion, A8 public API, A8 mobile / web channel, A8 marketing consent, A8 broad customer activation, A8 production rollout, or A8 notification channel implementation.
- [x] The required ADR (ADR-0061 — Commercial Plan Boundary) is authored and recorded in this B1T02 commit.

### Evidence limitations

- This contract design is documentation-only. B1T02 does not implement the B1 commercial catalog runtime, the B1 commercial-boundary runtime, the B1 commercial-decision engine, the B1 fee / commission / revenue-sharing engine, the B1 billing / invoice / statement engine, the B1 campaign / promotion / coupon engine, the B1 referral / cashback / loyalty engine, the B1 revenue-recognition / tax / VAT / cost-accounting engine, the B1 commercial-analytics / profitability / commercial-reconciliation engine, the B1 commercial data classification / commercial idempotency / commercial audit / commercial approvals / feature flag surface, or the B1 commercial release gate.
- This contract design does not call a partner, query live provider systems, inspect live customer / bank data, certify NIBSS, or verify settlement availability.
- The A6 partner is **not** connected or certified; A6 phase result is `NOT APPROVED / CONDITIONAL`. The first commercial scope's inbound funding flow depends on the A6 partner, which remains in this state.
- The A7 first product is `Prepared, not approved, not certified, not activated, not handed off to A8`. The first commercial scope depends on the A7 first product, which remains in this state.
- B1T02 does not claim that A1, A2, A3, A4, A5, A6, A7, Finance, Tax, Security, Privacy, Legal, Risk, Compliance, Operations, Reconciliation, Support, Product, Commercial, or partner owners have approved the first commercial scope or any B1 surface.
- B1T02 does not predefine any B1 commercial plan, B1 commercial package, B1 commercial bundle, B1 commercial customer tier, B1 commercial merchant tier, B1 commercial partner tier, B1 commercial product entitlement, B1 commercial feature flag, B1 commercial dynamic limit, B1 commercial subscription plan, B1 commercial pricing rule, B1 commercial fee rule, B1 commercial commission rule, B1 commercial revenue-sharing rule, B1 commercial billing cycle, B1 commercial invoice format, B1 commercial statement format, B1 commercial campaign, B1 commercial promotion, B1 commercial coupon, B1 commercial referral, B1 commercial cashback, B1 commercial loyalty, B1 commercial revenue-recognition standard, B1 commercial tax / VAT scheme, B1 commercial cost-accounting methodology, B1 commercial profitability model, B1 commercial analytics report, B1 commercial approval, B1 commercial audit policy, B1 commercial idempotency scheme, B1 commercial reconciliation model, B1 commercial data-classification rule, B1 commercial retention rule, B1 commercial legal-hold rule, B1 commercial secret classification, B1 commercial disclosure audience maximum, B1 commercial support-trace classification, B1 commercial release gate, or B1 commercial release-gate evidence package.
- B1T02 records the bounded first commercial scope `commercial.virtual-account.inbound-funding` v1 as a contract design; B1T02 does not authorize any B1 commercial operation, pricing, fee, commission, billing, invoicing, statement, campaign, promotion, coupon, referral, cashback, loyalty, revenue recognition, tax / VAT, cost accounting, profitability, analytics, customer tier, merchant tier, partner tier, product entitlement, feature flag, dynamic limit, subscription plan, product package, bundle, commercial approval, commercial audit, commercial idempotency, commercial reconciliation, commercial data classification, commercial retention, commercial legal-hold, commercial secret, commercial disclosure, or commercial release gate.
- B1T03-B1T11 must define, implement, test, and gate the B1 commercial catalog, the B1 plan-boundary contract, the B1 pricing / plan / subscription / tier / entitlement / package / bundle catalog, the B1 fee / commission / revenue-sharing engine, the B1 billing / invoice / statement engine, the B1 campaign / promotion / coupon engine, the B1 referral / cashback / loyalty engine, the B1 revenue-recognition / tax / cost-accounting engine, the B1 commercial-analytics / profitability / commercial-reconciliation engine, the B1 commercial data classification / commercial idempotency / commercial audit / commercial approvals / feature flag surface, and the B1 commercial release gate before any B1 commercial operation is considered.

## 20. Authoring note

B1T02 is a contract design artifact. B1T02 does not implement the B1 commercial catalog runtime, the B1 commercial-boundary runtime, the B1 commercial-decision engine, the B1 fee / commission / revenue-sharing engine, the B1 billing / invoice / statement engine, the B1 campaign / promotion / coupon engine, the B1 referral / cashback / loyalty engine, the B1 revenue-recognition / tax / VAT / cost-accounting engine, the B1 commercial-analytics / profitability / commercial-reconciliation engine, the B1 commercial data classification / commercial idempotency / commercial audit / commercial approvals / feature flag surface, or the B1 commercial release gate. B1T02 defines the `CommercialCatalogContractV1` and the `CommercialBoundaryContractV1` and freezes the first commercial scope `commercial.virtual-account.inbound-funding` v1. B1T02 does not authorize B1T03 or any later B1 task to begin runtime work.
