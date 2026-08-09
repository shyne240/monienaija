/**
 * B1T03 — B1 commercial catalog, plan catalog, subscription plan,
 * customer tier, merchant tier, partner tier, product entitlement,
 * product packaging / bundle catalog, and read-only consumer
 * boundary types.
 *
 * The B1 commercial catalog contract is the runtime catalog
 * implementation for the B1 first commercial scope
 * (`commercial.virtual-account.inbound-funding` v1) established in
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` (B1T02) and
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` (B1T01). The B1
 * commercial catalog contract freezes the B1 first commercial
 * catalog, the B1 first plan catalog, the B1 first subscription
 * plan registration, the B1 first customer tier, the B1 first
 * merchant tier, the B1 first partner tier, the B1 first product
 * entitlement catalog, the B1 first commercial package catalog,
 * the B1 first commercial bundle catalog, the catalog versioning
 * contract, the compatibility validation contract, the replay-safe
 * catalog lookup contract, and the read-only consumer boundary
 * surface for later B1 tasks (B1T04 fee / commission / revenue-
 * sharing engine; B1T05 billing / invoice / statement engine;
 * B1T06 campaign / promotion / coupon engine; B1T07 referral /
 * cashback / loyalty engine; B1T08 revenue-recognition / tax /
 * cost-accounting engine; B1T09 commercial analytics /
 * profitability / commercial reconciliation engine; B1T10
 * commercial data classification / commercial idempotency /
 * commercial audit / commercial approval / feature flag surface;
 * B1T11 commercial release gate).
 *
 * The B1 commercial catalog contract extends the B1T02 commercial
 * catalog and commercial-boundary contract (without modification or
 * duplication) by populating the `commercialCapabilityPlans`,
 * `commercialCapabilityPackages`, and `commercialCapabilityBundles`
 * arrays of the first commercial scope registration, by defining
 * the actual B1 commercial plans, packages, bundles, customer
 * tiers, merchant tiers, partner tiers, product entitlements,
 * feature flags, dynamic limits, and subscription plans, by
 * recording the B1 catalog versioning, compatibility validation,
 * replay-safe catalog lookup, and read-only consumer boundary
 * surface, and by persisting the B1 catalog registrations in the
 * B1 commercial catalog schema introduced in this task.
 *
 * The B1 commercial catalog contract is a read-only contract
 * against the existing A1 canonical identity, A2 authorization, A3
 * customer-to-financial-account binding, A4 policy decision, A5
 * Ledger, A6 partner-adapter, A6T05 external-operation, A6T08
 * settlement, A6T09 external reconciliation, A6T10 data
 * classification, A7 product catalog, A7 product-policy profile,
 * A7T04 product customer-binding, A7T05 product command, A7T06
 * product notification, A7T07 product lifecycle, A7T08 product
 * financial effect, A7T09 product reconciliation, A7T10 product
 * data minimization, `CustomerPreference`, Wallet, Operations,
 * Outbox, Idempotency, Metrics, Diagnostics, Reconciliation, and
 * `CustomerPreference` authorities. The B1 commercial catalog
 * contract does NOT calculate prices, fees, commissions, revenue
 * sharing, invoices, statements, billing, promotions, cashback,
 * loyalty, tax, cost-accounting, profitability, or financial
 * effects. The B1 commercial catalog contract does NOT post to
 * Ledger, mutate balances, repair bindings, change A4 policy /
 * source records, or dispatch notifications.
 *
 * No new A1 canonical identity, A2 authorization, A3 binding, A4
 * policy decision, A5 transfer / deposit / withdrawal, A6 partner-
 * adapter, A6T05 external-operation, A6T06 callback, A6T08
 * settlement / suspense / compensating-entry, A6T09 external
 * reconciliation, A6T10 data classification / consent / retention
 * / legal-hold / secret / disclosure / support-trace / partner-
 * payload validation, A7 product catalog, A7 product-policy
 * profile, A7T04 product customer-binding, A7T05 product
 * command/operation, A7T06 product notification delivery, A7T07
 * product lifecycle, A7T08 product financial effect, A7T09 product
 * reconciliation, A7T10 product data minimization, Wallet, Ledger,
 * Operations, Outbox, Idempotency, Metrics, Diagnostics,
 * Reconciliation, or `CustomerPreference` authority is introduced
 * by B1T03. The B1 commercial catalog contract reuses the A1
 * canonical identity, A2 authorization, A3 binding, A4 policy
 * decision, A6 partner-adapter, A6T10 data classification, A7
 * product catalog, A7 product-policy profile, and the shared
 * Operations audit, idempotency, outbox, and metrics services
 * through the existing read-only consumer boundaries.
 */

import type { RequestContext } from '../production/request-context';

/**
 * The B1 commercial catalog scope key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1 and re-asserted by
 * `docs/B1-COMMERCIAL-PLATFORM-BASELINE.md` §4.4).
 */
export type B1CommercialScopeKey = 'commercial.virtual-account.inbound-funding';

/**
 * The B1 commercial catalog scope version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export type B1CommercialScopeVersion = 1;

/**
 * The B1 commercial capability key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.2).
 */
export type B1CommercialCapabilityKey =
  | 'commercial.virtual-account.inbound-funding.fee'
  | 'commercial.virtual-account.inbound-funding.commission';

/**
 * The B1 commercial capability version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.2).
 */
export type B1CommercialCapabilityVersion = 1;

/**
 * The B1 commercial currency (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export type B1CommercialCurrency = 'NGN';

/**
 * The B1 commercial accounting unit (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export type B1CommercialAccountingUnit = 'CUSTOMER_FUNDS';

/**
 * The B1 commercial partner dependency key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1; the A6 partner
 * `NIBSS_NIP` planning rail is the only B1 commercial partner
 * dependency for the first commercial scope).
 */
export type B1CommercialPartnerDependencyKey = 'NIBSS_NIP';

/**
 * The B1 commercial product dependency key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1; the A7 first
 * product `VIRTUAL_ACCOUNT` v1 is the only B1 commercial product
 * dependency for the first commercial scope).
 */
export type B1CommercialProductDependencyKey = 'VIRTUAL_ACCOUNT';

/**
 * The B1 commercial product dependency version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export type B1CommercialProductDependencyVersion = 1;

/**
 * The B1 commercial plan key (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 first plan
 * catalog is the only B1 commercial plan catalog; the B1 first
 * commercial plan is the canonical B1 commercial plan for the
 * first commercial scope.
 */
export type B1CommercialPlanKey =
  | 'commercial.virtual-account.inbound-funding.fee.v1.plan.standard'
  | 'commercial.virtual-account.inbound-funding.commission.v1.plan.standard';

/**
 * The B1 commercial plan version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3).
 */
export type B1CommercialPlanVersion = 1;

/**
 * The B1 commercial customer tier key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 first
 * customer tier catalog is the only B1 commercial customer tier
 * catalog; the B1 first customer tier is the canonical B1
 * commercial customer tier for the first commercial scope.
 */
export type B1CommercialCustomerTierKey = 'commercial.customer.tier.standard.v1';

/**
 * The B1 commercial customer tier version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3).
 */
export type B1CommercialCustomerTierVersion = 1;

/**
 * The B1 commercial merchant tier key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 first
 * merchant tier catalog is the only B1 commercial merchant tier
 * catalog; the B1 first merchant tier is the canonical B1
 * commercial merchant tier for the first commercial scope.
 */
export type B1CommercialMerchantTierKey = 'commercial.merchant.tier.standard.v1';

/**
 * The B1 commercial merchant tier version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3).
 */
export type B1CommercialMerchantTierVersion = 1;

/**
 * The B1 commercial partner tier key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 first
 * partner tier catalog is the only B1 commercial partner tier
 * catalog; the B1 first partner tier is the canonical B1
 * commercial partner tier for the first commercial scope.
 */
export type B1CommercialPartnerTierKey = 'commercial.partner.tier.standard.v1';

/**
 * The B1 commercial partner tier version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3).
 */
export type B1CommercialPartnerTierVersion = 1;

/**
 * The B1 commercial product entitlement key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 first product
 * entitlement catalog is the only B1 commercial product
 * entitlement catalog; the B1 first product entitlement is the
 * canonical B1 commercial product entitlement for the first
 * commercial scope.
 */
export type B1CommercialProductEntitlementKey =
  | 'commercial.virtual-account.inbound-funding.entitlement.fee.v1'
  | 'commercial.virtual-account.inbound-funding.entitlement.commission.v1';

/**
 * The B1 commercial product entitlement version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3).
 */
export type B1CommercialProductEntitlementVersion = 1;

/**
 * The B1 commercial package key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 first
 * commercial package catalog is the only B1 commercial package
 * catalog; the B1 first commercial package is the canonical B1
 * commercial package for the first commercial scope.
 */
export type B1CommercialPackageKey =
  'commercial.virtual-account.inbound-funding.package.fee.commission.v1';

/**
 * The B1 commercial package version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.4).
 */
export type B1CommercialPackageVersion = 1;

/**
 * The B1 commercial bundle key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 first
 * commercial bundle catalog is the only B1 commercial bundle
 * catalog; the B1 first commercial bundle is the canonical B1
 * commercial bundle for the first commercial scope.
 */
export type B1CommercialBundleKey =
  'commercial.virtual-account.inbound-funding.bundle.fee.commission.v1';

/**
 * The B1 commercial bundle version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.5).
 */
export type B1CommercialBundleVersion = 1;

/**
 * The B1 commercial subscription plan key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 first
 * subscription plan is the canonical B1 commercial subscription
 * plan for the first commercial scope.
 */
export type B1CommercialSubscriptionPlanKey =
  'commercial.virtual-account.inbound-funding.subscription.standard.v1';

/**
 * The B1 commercial subscription plan version (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3).
 */
export type B1CommercialSubscriptionPlanVersion = 1;

/**
 * The B1 commercial state vocabulary (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §4.1).
 */
export type B1CommercialState =
  | 'COMMERCIAL_DECISION_PENDING'
  | 'COMMERCIAL_DECISION_ADMITTED'
  | 'COMMERCIAL_DECISION_SUPPRESSED'
  | 'COMMERCIAL_DECISION_FAILED'
  | 'COMMERCIAL_DECISION_REPLAYED'
  | 'COMMERCIAL_DECISION_DISABLED';

/**
 * The B1 commercial direction vocabulary (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.1).
 */
export type B1CommercialDirection = 'inbound';

/**
 * The B1 commercial plan classification (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3).
 */
export type B1CommercialPlanClassificationLevel =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED'
  | 'HIGHLY_RESTRICTED';

/**
 * The B1 commercial plan type (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export type B1CommercialPlanType = 'FEE' | 'COMMISSION' | 'REVENUE_SHARING';

/**
 * The B1 commercial billing cycle (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export type B1CommercialBillingCycle = 'PER_TRANSACTION' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

/**
 * The B1 commercial subscription state (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export type B1CommercialSubscriptionState =
  | 'SUBSCRIPTION_PENDING'
  | 'SUBSCRIPTION_ACTIVE'
  | 'SUBSCRIPTION_RENEWAL_DUE'
  | 'SUBSCRIPTION_CANCELLED'
  | 'SUBSCRIPTION_ENDED';

/**
 * The B1 commercial feature flag key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export type B1CommercialFeatureFlagKey =
  | 'commercial.virtual-account.inbound-funding.fee.enabled'
  | 'commercial.virtual-account.inbound-funding.commission.enabled';

/**
 * The B1 commercial feature flag state (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export type B1CommercialFeatureFlagState = 'ENABLED' | 'DISABLED';

/**
 * The B1 commercial dynamic limit key (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export type B1CommercialDynamicLimitKey =
  | 'commercial.virtual-account.inbound-funding.fee.dynamic-limit.daily'
  | 'commercial.virtual-account.inbound-funding.commission.dynamic-limit.daily';

/**
 * The B1 commercial dynamic limit unit (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03).
 */
export type B1CommercialDynamicLimitUnit = 'MINOR' | 'COUNT' | 'PERCENT';

/**
 * The B1 commercial plan registration (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.3). The B1 commercial
 * plan registration is the canonical B1 commercial plan entry in
 * the B1 first plan catalog.
 */
export interface B1CommercialPlanRegistrationV1 {
  readonly planKey: B1CommercialPlanKey;
  readonly planVersion: B1CommercialPlanVersion;
  readonly planType: B1CommercialPlanType;
  readonly planScopeKey: B1CommercialScopeKey;
  readonly planScopeVersion: B1CommercialScopeVersion;
  readonly planCapabilityKey: B1CommercialCapabilityKey;
  readonly planCapabilityVersion: B1CommercialCapabilityVersion;
  readonly planCurrency: B1CommercialCurrency;
  readonly planAccountingUnit: B1CommercialAccountingUnit;
  readonly planCustomerTierEligibility: readonly B1CommercialCustomerTierKey[];
  readonly planMerchantTierEligibility: readonly B1CommercialMerchantTierKey[];
  readonly planPartnerTierEligibility: readonly B1CommercialPartnerTierKey[];
  readonly planProductEligibility: readonly {
    readonly productKey: B1CommercialProductDependencyKey;
    readonly productVersion: B1CommercialProductDependencyVersion;
  }[];
  readonly planPartnerEligibility: readonly B1CommercialPartnerDependencyKey[];
  readonly planCapabilities: readonly B1CommercialCapabilityKey[];
  readonly planEntitlements: readonly B1CommercialProductEntitlementKey[];
  readonly planFeatureFlags: readonly B1CommercialFeatureFlagKey[];
  readonly planDynamicLimits: readonly B1CommercialDynamicLimitKey[];
  readonly planBillingCycle: B1CommercialBillingCycle;
  readonly planEffectiveFrom: string | null;
  readonly planEffectiveTo: string | null;
  readonly planClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly planRetentionDays: number;
}

/**
 * The B1 commercial customer tier registration (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * customer tier registration is the canonical B1 commercial
 * customer tier entry in the B1 first customer tier catalog.
 */
export interface B1CommercialCustomerTierRegistrationV1 {
  readonly tierKey: B1CommercialCustomerTierKey;
  readonly tierVersion: B1CommercialCustomerTierVersion;
  readonly tierScopeKey: B1CommercialScopeKey;
  readonly tierScopeVersion: B1CommercialScopeVersion;
  readonly tierClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly tierFeatureFlags: readonly B1CommercialFeatureFlagKey[];
  readonly tierDynamicLimits: readonly B1CommercialDynamicLimitKey[];
  readonly tierEffectiveFrom: string | null;
  readonly tierEffectiveTo: string | null;
  readonly tierRetentionDays: number;
}

/**
 * The B1 commercial merchant tier registration (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * merchant tier registration is the canonical B1 commercial
 * merchant tier entry in the B1 first merchant tier catalog.
 */
export interface B1CommercialMerchantTierRegistrationV1 {
  readonly tierKey: B1CommercialMerchantTierKey;
  readonly tierVersion: B1CommercialMerchantTierVersion;
  readonly tierScopeKey: B1CommercialScopeKey;
  readonly tierScopeVersion: B1CommercialScopeVersion;
  readonly tierClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly tierFeatureFlags: readonly B1CommercialFeatureFlagKey[];
  readonly tierDynamicLimits: readonly B1CommercialDynamicLimitKey[];
  readonly tierEffectiveFrom: string | null;
  readonly tierEffectiveTo: string | null;
  readonly tierRetentionDays: number;
}

/**
 * The B1 commercial partner tier registration (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * partner tier registration is the canonical B1 commercial partner
 * tier entry in the B1 first partner tier catalog.
 */
export interface B1CommercialPartnerTierRegistrationV1 {
  readonly tierKey: B1CommercialPartnerTierKey;
  readonly tierVersion: B1CommercialPartnerTierVersion;
  readonly tierScopeKey: B1CommercialScopeKey;
  readonly tierScopeVersion: B1CommercialScopeVersion;
  readonly tierClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly tierFeatureFlags: readonly B1CommercialFeatureFlagKey[];
  readonly tierDynamicLimits: readonly B1CommercialDynamicLimitKey[];
  readonly tierEffectiveFrom: string | null;
  readonly tierEffectiveTo: string | null;
  readonly tierRetentionDays: number;
}

/**
 * The B1 commercial product entitlement registration (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * product entitlement registration is the canonical B1 commercial
 * product entitlement entry in the B1 first product entitlement
 * catalog.
 */
export interface B1CommercialProductEntitlementRegistrationV1 {
  readonly entitlementKey: B1CommercialProductEntitlementKey;
  readonly entitlementVersion: B1CommercialProductEntitlementVersion;
  readonly entitlementScopeKey: B1CommercialScopeKey;
  readonly entitlementScopeVersion: B1CommercialScopeVersion;
  readonly entitlementProductKey: B1CommercialProductDependencyKey;
  readonly entitlementProductVersion: B1CommercialProductDependencyVersion;
  readonly entitlementPlanKey: B1CommercialPlanKey;
  readonly entitlementPlanVersion: B1CommercialPlanVersion;
  readonly entitlementCapabilityKey: B1CommercialCapabilityKey;
  readonly entitlementCustomerTierKey: B1CommercialCustomerTierKey;
  readonly entitlementMerchantTierKey: B1CommercialMerchantTierKey;
  readonly entitlementPartnerTierKey: B1CommercialPartnerTierKey;
  readonly entitlementClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly entitlementEffectiveFrom: string | null;
  readonly entitlementEffectiveTo: string | null;
  readonly entitlementRetentionDays: number;
}

/**
 * The B1 commercial package registration (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.4). The B1 commercial
 * package registration is the canonical B1 commercial package
 * entry in the B1 first commercial package catalog.
 */
export interface B1CommercialPackageRegistrationV1 {
  readonly packageKey: B1CommercialPackageKey;
  readonly packageVersion: B1CommercialPackageVersion;
  readonly packageScopeKey: B1CommercialScopeKey;
  readonly packageScopeVersion: B1CommercialScopeVersion;
  readonly packageComposition: readonly {
    readonly planKey: B1CommercialPlanKey;
    readonly planVersion: B1CommercialPlanVersion;
  }[];
  readonly packageCapabilities: readonly B1CommercialCapabilityKey[];
  readonly packageEntitlements: readonly B1CommercialProductEntitlementKey[];
  readonly packageFeatureFlags: readonly B1CommercialFeatureFlagKey[];
  readonly packageDynamicLimits: readonly B1CommercialDynamicLimitKey[];
  readonly packageEffectiveFrom: string | null;
  readonly packageEffectiveTo: string | null;
  readonly packageClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly packageRetentionDays: number;
}

/**
 * The B1 commercial bundle registration (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.5). The B1 commercial
 * bundle registration is the canonical B1 commercial bundle entry
 * in the B1 first commercial bundle catalog.
 */
export interface B1CommercialBundleRegistrationV1 {
  readonly bundleKey: B1CommercialBundleKey;
  readonly bundleVersion: B1CommercialBundleVersion;
  readonly bundleScopeKey: B1CommercialScopeKey;
  readonly bundleScopeVersion: B1CommercialScopeVersion;
  readonly bundleComposition: readonly {
    readonly packageKey: B1CommercialPackageKey;
    readonly packageVersion: B1CommercialPackageVersion;
  }[];
  readonly bundleCapabilities: readonly B1CommercialCapabilityKey[];
  readonly bundleEntitlements: readonly B1CommercialProductEntitlementKey[];
  readonly bundleFeatureFlags: readonly B1CommercialFeatureFlagKey[];
  readonly bundleDynamicLimits: readonly B1CommercialDynamicLimitKey[];
  readonly bundleEffectiveFrom: string | null;
  readonly bundleEffectiveTo: string | null;
  readonly bundleClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly bundleRetentionDays: number;
}

/**
 * The B1 commercial subscription plan registration (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * subscription plan registration is the canonical B1 commercial
 * subscription plan entry in the B1 first subscription plan
 * catalog.
 */
export interface B1CommercialSubscriptionPlanRegistrationV1 {
  readonly subscriptionKey: B1CommercialSubscriptionPlanKey;
  readonly subscriptionVersion: B1CommercialSubscriptionPlanVersion;
  readonly subscriptionScopeKey: B1CommercialScopeKey;
  readonly subscriptionScopeVersion: B1CommercialScopeVersion;
  readonly subscriptionPlanKey: B1CommercialPlanKey;
  readonly subscriptionPlanVersion: B1CommercialPlanVersion;
  readonly subscriptionBillingCycle: B1CommercialBillingCycle;
  readonly subscriptionBillingCurrency: B1CommercialCurrency;
  readonly subscriptionBillingAccountingUnit: B1CommercialAccountingUnit;
  readonly subscriptionCustomerTierKey: B1CommercialCustomerTierKey;
  readonly subscriptionMerchantTierKey: B1CommercialMerchantTierKey;
  readonly subscriptionPartnerTierKey: B1CommercialPartnerTierKey;
  readonly subscriptionClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly subscriptionRetentionDays: number;
}

/**
 * The B1 commercial feature flag registration (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * feature flag registration is the canonical B1 commercial
 * feature flag entry in the B1 first feature flag catalog.
 */
export interface B1CommercialFeatureFlagRegistrationV1 {
  readonly featureFlagKey: B1CommercialFeatureFlagKey;
  readonly featureFlagScopeKey: B1CommercialScopeKey;
  readonly featureFlagScopeVersion: B1CommercialScopeVersion;
  readonly featureFlagState: B1CommercialFeatureFlagState;
  readonly featureFlagClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly featureFlagRetentionDays: number;
}

/**
 * The B1 commercial dynamic limit registration (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * dynamic limit registration is the canonical B1 commercial
 * dynamic limit entry in the B1 first dynamic limit catalog.
 */
export interface B1CommercialDynamicLimitRegistrationV1 {
  readonly dynamicLimitKey: B1CommercialDynamicLimitKey;
  readonly dynamicLimitScopeKey: B1CommercialScopeKey;
  readonly dynamicLimitScopeVersion: B1CommercialScopeVersion;
  readonly dynamicLimitUnit: B1CommercialDynamicLimitUnit;
  readonly dynamicLimitValue: string;
  readonly dynamicLimitCurrency: B1CommercialCurrency;
  readonly dynamicLimitAccountingUnit: B1CommercialAccountingUnit;
  readonly dynamicLimitClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly dynamicLimitRetentionDays: number;
}

/**
 * The B1 commercial pricing catalog entry (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * pricing catalog entry is the canonical B1 commercial pricing
 * entry in the B1 first pricing catalog. The B1 commercial pricing
 * catalog is configuration only; the B1 commercial pricing
 * catalog does NOT calculate prices.
 */
export interface B1CommercialPricingCatalogEntryV1 {
  readonly pricingKey: string;
  readonly pricingVersion: 1;
  readonly pricingScopeKey: B1CommercialScopeKey;
  readonly pricingScopeVersion: B1CommercialScopeVersion;
  readonly pricingCapabilityKey: B1CommercialCapabilityKey;
  readonly pricingCurrency: B1CommercialCurrency;
  readonly pricingAccountingUnit: B1CommercialAccountingUnit;
  readonly pricingPlanKey: B1CommercialPlanKey;
  readonly pricingPlanVersion: B1CommercialPlanVersion;
  readonly pricingEffectiveFrom: string | null;
  readonly pricingEffectiveTo: string | null;
  readonly pricingClassificationLevel: B1CommercialPlanClassificationLevel;
  readonly pricingRetentionDays: number;
}

/**
 * The B1 commercial catalog registration (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §3.1 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * catalog registration is the canonical B1 commercial catalog
 * entry in the B1 first commercial catalog. The B1 commercial
 * catalog registration includes the first commercial scope
 * identity, the catalog version, the scope state vocabulary, the
 * compatibility rule identifiers, the consumer contract
 * identifiers, the version negotiation rule identifiers, the
 * replay rule identifiers, the plan reference, the package
 * reference, the bundle reference, the feature flag reference, and
 * the dynamic limit reference.
 */
export interface B1CommercialCatalogRegistrationV1 {
  readonly catalogKey: string;
  readonly catalogVersion: 1;
  readonly scopeKey: B1CommercialScopeKey;
  readonly scopeVersion: B1CommercialScopeVersion;
  readonly direction: B1CommercialDirection;
  readonly currency: B1CommercialCurrency;
  readonly accountingUnit: B1CommercialAccountingUnit;
  readonly partnerDependency: B1CommercialPartnerDependencyKey;
  readonly productDependency: {
    readonly productKey: B1CommercialProductDependencyKey;
    readonly productVersion: B1CommercialProductDependencyVersion;
  };
  readonly stateVocabulary: readonly B1CommercialState[];
  readonly plans: readonly B1CommercialPlanRegistrationV1[];
  readonly customerTiers: readonly B1CommercialCustomerTierRegistrationV1[];
  readonly merchantTiers: readonly B1CommercialMerchantTierRegistrationV1[];
  readonly partnerTiers: readonly B1CommercialPartnerTierRegistrationV1[];
  readonly productEntitlements: readonly B1CommercialProductEntitlementRegistrationV1[];
  readonly packages: readonly B1CommercialPackageRegistrationV1[];
  readonly bundles: readonly B1CommercialBundleRegistrationV1[];
  readonly subscriptionPlans: readonly B1CommercialSubscriptionPlanRegistrationV1[];
  readonly featureFlags: readonly B1CommercialFeatureFlagRegistrationV1[];
  readonly dynamicLimits: readonly B1CommercialDynamicLimitRegistrationV1[];
  readonly pricingCatalog: readonly B1CommercialPricingCatalogEntryV1[];
  readonly compatibilityRuleIds: readonly string[];
  readonly consumerContractIds: readonly string[];
  readonly versionNegotiationRuleIds: readonly string[];
  readonly replayRuleIds: readonly string[];
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly classificationLevel: B1CommercialPlanClassificationLevel;
  readonly retentionDays: number;
}

/**
 * The B1 commercial catalog persistence record (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * catalog persistence record is the durable TypeORM record for
 * each B1 commercial catalog entry. The B1 commercial catalog
 * persistence record carries the canonical B1 commercial catalog
 * registration as a JSONB payload and the B1 commercial catalog
 * version, scope key, scope version, plan key, plan version,
 * customer tier key, merchant tier key, partner tier key,
 * entitlement key, package key, bundle key, subscription key,
 * feature flag key, dynamic limit key, pricing key, and effective
 * from / effective to as a relational column.
 */
export interface B1CommercialCatalogPersistenceRecordV1 {
  readonly catalogId: string;
  readonly catalogKey: string;
  readonly catalogVersion: 1;
  readonly scopeKey: B1CommercialScopeKey;
  readonly scopeVersion: B1CommercialScopeVersion;
  readonly registration: B1CommercialCatalogRegistrationV1;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

/**
 * The B1 commercial catalog lookup command (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * catalog lookup command is the canonical read-only consumer
 * boundary command for later B1 tasks (B1T04, B1T05, B1T06,
 * B1T07, B1T08, B1T09, B1T10, B1T11). The B1 commercial catalog
 * lookup command is a read-only command; the B1 commercial catalog
 * does NOT mutate any A1-A7 source record.
 */
export interface B1CommercialCatalogLookupCommandV1 {
  readonly contractName: 'B1-COMMERCIAL-CATALOG';
  readonly contractVersion: 1;
  readonly scopeKey: B1CommercialScopeKey;
  readonly scopeVersion: B1CommercialScopeVersion;
  readonly lookupKind:
    | 'CATALOG'
    | 'PLAN'
    | 'CUSTOMER_TIER'
    | 'MERCHANT_TIER'
    | 'PARTNER_TIER'
    | 'PRODUCT_ENTITLEMENT'
    | 'PACKAGE'
    | 'BUNDLE'
    | 'SUBSCRIPTION_PLAN'
    | 'FEATURE_FLAG'
    | 'DYNAMIC_LIMIT'
    | 'PRICING_CATALOG'
    | 'CAPABILITY_PLANS'
    | 'CAPABILITY_PACKAGES'
    | 'CAPABILITY_BUNDLES';
  readonly lookupKey: string;
  readonly lookupVersion: 1;
  readonly expectedCurrency: B1CommercialCurrency;
  readonly expectedAccountingUnit: B1CommercialAccountingUnit;
  readonly requestContext: RequestContext;
  readonly causationId: string | null;
}

/**
 * The B1 commercial catalog lookup result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * catalog lookup result is the canonical read-only consumer
 * boundary result for later B1 tasks (B1T04, B1T05, B1T06, B1T07,
 * B1T08, B1T09, B1T10, B1T11). The B1 commercial catalog lookup
 * result is a read-only result; the B1 commercial catalog does NOT
 * emit a financial effect.
 */
export type B1CommercialCatalogLookupResultV1 =
  | {
      readonly valid: true;
      readonly scopeKey: B1CommercialScopeKey;
      readonly scopeVersion: B1CommercialScopeVersion;
      readonly lookupKind: B1CommercialCatalogLookupCommandV1['lookupKind'];
      readonly plan: B1CommercialPlanRegistrationV1 | null;
      readonly customerTier: B1CommercialCustomerTierRegistrationV1 | null;
      readonly merchantTier: B1CommercialMerchantTierRegistrationV1 | null;
      readonly partnerTier: B1CommercialPartnerTierRegistrationV1 | null;
      readonly productEntitlement: B1CommercialProductEntitlementRegistrationV1 | null;
      readonly packageRegistration: B1CommercialPackageRegistrationV1 | null;
      readonly bundleRegistration: B1CommercialBundleRegistrationV1 | null;
      readonly subscriptionPlan: B1CommercialSubscriptionPlanRegistrationV1 | null;
      readonly featureFlag: B1CommercialFeatureFlagRegistrationV1 | null;
      readonly dynamicLimit: B1CommercialDynamicLimitRegistrationV1 | null;
      readonly pricingEntries: readonly B1CommercialPricingCatalogEntryV1[];
      readonly capabilityPlans: readonly B1CommercialPlanRegistrationV1[];
      readonly capabilityPackages: readonly B1CommercialPackageRegistrationV1[];
      readonly capabilityBundles: readonly B1CommercialBundleRegistrationV1[];
      readonly correlationId: string;
      readonly requestId: string;
      readonly createdAt: string;
    }
  | {
      readonly valid: false;
      readonly code: B1CommercialCatalogFailureCodeV1;
      readonly message: string;
      readonly correlationId: string;
      readonly requestId: string;
      readonly createdAt: string;
    };

/**
 * The B1 commercial catalog failure code vocabulary (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03 and re-asserted by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §6).
 */
export type B1CommercialCatalogFailureCodeV1 =
  | 'B1_COMMERCIAL_CATALOG_QUERY_UNAVAILABLE'
  | 'B1_COMMERCIAL_CATALOG_INCOMPATIBLE'
  | 'B1_COMMERCIAL_CATALOG_MALFORMED'
  | 'B1_COMMERCIAL_CATALOG_WRONG_VERSION'
  | 'B1_COMMERCIAL_CATALOG_PROHIBITED'
  | 'B1_COMMERCIAL_CATALOG_UNSUPPORTED_CAPABILITY'
  | 'B1_COMMERCIAL_CATALOG_MISSING_PLAN'
  | 'B1_COMMERCIAL_CATALOG_MISSING_PACKAGE'
  | 'B1_COMMERCIAL_CATALOG_MISSING_BUNDLE'
  | 'B1_COMMERCIAL_CATALOG_MISSING_TIER'
  | 'B1_COMMERCIAL_CATALOG_MISSING_ENTITLEMENT'
  | 'B1_COMMERCIAL_CATALOG_INVALID_COMMAND';

/**
 * The B1 commercial catalog replay-safe lookup result (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03 and re-asserted by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §6). The B1 commercial
 * catalog replay-safe lookup result carries the canonical B1
 * commercial catalog lookup result alongside the replay metadata
 * (replayed flag, conflict flag, conflict reason, idempotency key,
 * and request hash). The B1 commercial catalog replay-safe lookup
 * is replay-safe per the B1 commercial replay rule (window
 * 86_400s, exact-match required, idempotent, audit-traced, expires
 * after window, A1-A7 inherited).
 */
export interface B1CommercialCatalogReplaySafeResultV1 {
  readonly result: B1CommercialCatalogLookupResultV1;
  readonly replayed: boolean;
  readonly conflict: boolean;
  readonly conflictReason: string | null;
  readonly idempotencyScope: 'b1.commercial-catalog.idempotency.v1';
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly generatedAt: string;
  readonly correlationId: string;
}

/**
 * The B1 commercial catalog compatibility check result (frozen by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §5.2 and re-asserted by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * catalog compatibility check result is the canonical B1
 * commercial catalog compatibility result. The B1 commercial
 * catalog compatibility check verifies that the B1 commercial
 * catalog version is supported, that the B1 commercial scope key
 * is supported, that the B1 commercial capability is supported,
 * that the B1 commercial currency is supported, that the B1
 * commercial accounting unit is supported, that the B1 commercial
 * product dependency is supported, and that the B1 commercial
 * partner dependency is supported.
 */
export type B1CommercialCatalogCompatibilityResultV1 =
  | { readonly compatible: true; readonly reasons: readonly string[] }
  | {
      readonly compatible: false;
      readonly code: B1CommercialCatalogFailureCodeV1;
      readonly reasons: readonly string[];
    };

/**
 * The B1 commercial catalog versioning contract (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03 and re-asserted by
 * `docs/B1-COMMERCIAL-CATALOG-CONTRACT.md` §5.1). The B1
 * commercial catalog versioning contract records the B1
 * commercial catalog version, the B1 commercial catalog identity,
 * the B1 commercial catalog effective-from, the B1 commercial
 * catalog effective-to, the B1 commercial catalog superseded-by
 * reference, the B1 commercial catalog supersedes reference, and
 * the B1 commercial catalog migration hint. The B1 commercial
 * catalog versioning contract is read-only; the B1 commercial
 * catalog does NOT publish a new B1 commercial catalog version.
 */
export interface B1CommercialCatalogVersioningContractV1 {
  readonly catalogKey: string;
  readonly catalogVersion: 1;
  readonly scopeKey: B1CommercialScopeKey;
  readonly scopeVersion: B1CommercialScopeVersion;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly supersededByCatalogKey: string | null;
  readonly supersedesCatalogKey: string | null;
  readonly migrationHint: string | null;
}

/**
 * The B1 commercial catalog read-only consumer ports (frozen by
 * `docs/B1-IMPLEMENTATION-PLAN.md` §8 B1T03). The B1 commercial
 * catalog read-only consumer ports are the canonical read-only
 * consumer boundary surface for later B1 tasks (B1T04, B1T05,
 * B1T06, B1T07, B1T08, B1T09, B1T10, B1T11).
 */
export interface B1CommercialCatalogConsumerPortsV1 {
  /**
   * B1 commercial catalog lookup. Returns the canonical B1
   * commercial catalog lookup result for the supplied B1
   * commercial catalog lookup command. The lookup is read-only;
   * the B1 commercial catalog does NOT mutate any A1-A7 source
   * record.
   */
  readonly lookup: (
    command: B1CommercialCatalogLookupCommandV1,
  ) => Promise<B1CommercialCatalogLookupResultV1>;

  /**
   * B1 commercial catalog replay-safe lookup. Returns the
   * canonical B1 commercial catalog replay-safe lookup result for
   * the supplied B1 commercial catalog lookup command. The
   * replay-safe lookup is read-only; the B1 commercial catalog
   * does NOT mutate any A1-A7 source record.
   */
  readonly replaySafeLookup: (
    command: B1CommercialCatalogLookupCommandV1,
  ) => Promise<B1CommercialCatalogReplaySafeResultV1>;

  /**
   * B1 commercial catalog compatibility check. Returns the
   * canonical B1 commercial catalog compatibility result for the
   * supplied B1 commercial catalog lookup command. The
   * compatibility check is read-only; the B1 commercial catalog
   * does NOT mutate any A1-A7 source record.
   */
  readonly compatibilityCheck: (
    command: B1CommercialCatalogLookupCommandV1,
  ) => Promise<B1CommercialCatalogCompatibilityResultV1>;
}
