/**
 * B1T03 — B1 commercial catalog read-write consumer repository.
 *
 * The B1 commercial catalog repository is a read-write consumer of:
 *  - the shared `IdempotencyService` (the only internal idempotency
 *    authority);
 *  - the shared `AuditService` (the only audit authority);
 *  - the shared `OutboxService` (the only outbox authority);
 *  - the shared `MetricsService` (the only metrics authority).
 *
 * The B1 commercial catalog repository is a read-only consumer of:
 *  - the B1 commercial catalog persistence schema (the only B1
 *    commercial catalog persistence surface; the B1 commercial
 *    catalog registry is consulted through the B1 commercial
 *    catalog read-only consumer boundary);
 *  - the A1 canonical identity authority (the only A1 canonical
 *    identity authority; the B1 commercial catalog reads the A1
 *    canonical identity through the existing A1 consumer
 *    boundary);
 *  - the A2 `AuthorizationService` (the only A2 authorization
 *    authority; the A2 authorization context is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 commercial catalog);
 *  - the A3 `CustomerFinancialAccountBindingService` (the only A3
 *    binding authority; the A3 binding is recorded as a
 *    correlation identifier and is NOT re-derived, refreshed, or
 *    substituted by the B1 commercial catalog);
 *  - the A4 product-policy service (A7T03; the only A4
 *    product-policy authority; the A4 product-policy decision is
 *    recorded as a correlation identifier and is NOT re-derived,
 *    refreshed, or substituted by the B1 commercial catalog);
 *  - the A5 `Ledger` service (the only A5 Ledger authority; the
 *    A5 Ledger account state is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 commercial catalog);
 *  - the A6 `PartnerAdapter` service (the only A6 partner-adapter
 *    authority; the A6 partner state is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 commercial catalog);
 *  - the A6T10 `ExternalDataMinimizationService` (the only A6T10
 *    data classification authority; the A6T10 data
 *    classification is recorded as a correlation identifier and is
 *    NOT re-derived, refreshed, or substituted by the B1
 *    commercial catalog);
 *  - the A7 product catalog (A7T02; the only A7 product catalog
 *    authority);
 *  - the `CustomerPreference` service (the only customer intent
 *    authority; `CustomerPreference` is recorded as a correlation
 *    identifier and is NOT re-derived, refreshed, or substituted
 *    by the B1 commercial catalog).
 *
 * The B1 commercial catalog repository does not introduce a second
 * pricing / fee / commission / revenue-sharing / billing /
 * invoice / statement / campaign / promotion / coupon / referral
 * / cashback / loyalty / revenue-recognition / tax /
 * cost-accounting / profitability / analytics / reconciliation
 * engine, a second A1 canonical identity authority, a second A2
 * authorization authority, a second A3 binding authority, a second
 * A4 product-policy authority, a second A5 Ledger authority, a
 * second A6 partner-adapter authority, a second A6T10 data
 * classification authority, a second A7 product catalog authority,
 * a second `CustomerPreference` authority, a second audit
 * authority, a second idempotency authority, a second outbox
 * authority, a second metrics authority, a second diagnostics
 * authority, or a new B1 commercial catalog identity.
 */

import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditService } from '../operations/audit.service';
import { IdempotencyService } from '../operations/idempotency.service';
import { MetricsService } from '../operations/metrics.service';
import { OutboxService } from '../operations/outbox.service';

import {
  B1_COMMERCIAL_CATALOG_AUDIT_ACTOR,
  B1_COMMERCIAL_CATALOG_AUDIT_ENTITY_TYPE,
  B1_COMMERCIAL_CATALOG_BILLING_CYCLE_PER_TRANSACTION,
  B1_COMMERCIAL_CATALOG_BILLING_CYCLES,
  B1_COMMERCIAL_CATALOG_BUNDLE_KEY,
  B1_COMMERCIAL_CATALOG_BUNDLE_KEYS,
  B1_COMMERCIAL_CATALOG_CAPABILITIES,
  B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
  B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
  B1_COMMERCIAL_CATALOG_CLASSIFICATION_LEVELS,
  B1_COMMERCIAL_CATALOG_COMPATIBILITY_RULE_IDS,
  B1_COMMERCIAL_CATALOG_CONSUMER_CONTRACT_IDS,
  B1_COMMERCIAL_CATALOG_CONTRACT_NAME,
  B1_COMMERCIAL_CATALOG_CONTRACT_VERSION,
  B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY,
  B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEYS,
  B1_COMMERCIAL_CATALOG_DATA_CONTROL_CLASSIFICATIONS,
  B1_COMMERCIAL_CATALOG_DECLARED_DEPENDENCIES,
  B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_COMMISSION,
  B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_FEE,
  B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_KEYS,
  B1_COMMERCIAL_CATALOG_FAILURE_CODES,
  B1_COMMERCIAL_CATALOG_FAILURE_INCOMPATIBLE,
  B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND,
  B1_COMMERCIAL_CATALOG_FAILURE_MALFORMED,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_BUNDLE,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_ENTITLEMENT,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PACKAGE,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PLAN,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_TIER,
  B1_COMMERCIAL_CATALOG_FAILURE_PROHIBITED,
  B1_COMMERCIAL_CATALOG_FAILURE_QUERY_UNAVAILABLE,
  B1_COMMERCIAL_CATALOG_FAILURE_UNSUPPORTED_CAPABILITY,
  B1_COMMERCIAL_CATALOG_FAILURE_WRONG_VERSION,
  B1_COMMERCIAL_CATALOG_FEATURE_FLAG_COMMISSION,
  B1_COMMERCIAL_CATALOG_FEATURE_FLAG_FEE,
  B1_COMMERCIAL_CATALOG_FEATURE_FLAG_KEYS,
  B1_COMMERCIAL_CATALOG_FIRST_SCOPE_CATALOG_KEY,
  B1_COMMERCIAL_CATALOG_IDEMPOTENCY_RETENTION_SECONDS,
  B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_CATALOG_LOOKUP_KINDS,
  B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY,
  B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEYS,
  B1_COMMERCIAL_CATALOG_METRIC_REPLAYED,
  B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_CLASSIFICATION,
  B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_RETENTION_CLASS,
  B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE,
  B1_COMMERCIAL_CATALOG_PACKAGE_KEY,
  B1_COMMERCIAL_CATALOG_PACKAGE_KEYS,
  B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY,
  B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEYS,
  B1_COMMERCIAL_CATALOG_PLAN_KEYS,
  B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION,
  B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE,
  B1_COMMERCIAL_CATALOG_PLAN_TYPES,
  B1_COMMERCIAL_CATALOG_PRICING_KEY_COMMISSION,
  B1_COMMERCIAL_CATALOG_PRICING_KEY_FEE,
  B1_COMMERCIAL_CATALOG_PRICING_KEYS,
  B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEYS,
  B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION,
  B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE,
  B1_COMMERCIAL_CATALOG_PROHIBITED_ADJACENT_SCOPES,
  B1_COMMERCIAL_CATALOG_PROHIBITED_DEPENDENCIES,
  B1_COMMERCIAL_CATALOG_REFERENCE_PREFIX,
  B1_COMMERCIAL_CATALOG_REPLAY_RULE_IDS,
  B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
  B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
  B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
  B1_COMMERCIAL_CATALOG_SCOPE_DIRECTION,
  B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
  B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
  B1_COMMERCIAL_CATALOG_SCOPE_INTERNAL_COMMERCIAL_DECISION_OWNER,
  B1_COMMERCIAL_CATALOG_SCOPE_KEY,
  B1_COMMERCIAL_CATALOG_SCOPE_PARTNER_DEPENDENCY,
  B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY,
  B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
  B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
  B1_COMMERCIAL_CATALOG_STATE_ADMITTED,
  B1_COMMERCIAL_CATALOG_STATE_VOCABULARY,
  B1_COMMERCIAL_CATALOG_STATES,
  B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEY,
  B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEYS,
  B1_COMMERCIAL_CATALOG_VERSION_NEGOTIATION_RULE_IDS,
} from './b1-commercial-catalog.constants';
import { B1CommercialCatalogRegistration } from './b1-commercial-catalog.entity';
import type {
  B1CommercialCatalogCompatibilityResultV1,
  B1CommercialCatalogConsumerPortsV1,
  B1CommercialCatalogLookupCommandV1,
  B1CommercialCatalogLookupResultV1,
  B1CommercialCatalogPersistenceRecordV1,
  B1CommercialCatalogRegistrationV1,
  B1CommercialCatalogReplaySafeResultV1,
} from './b1-commercial-catalog.types';

const SAFE_TEXT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,179}$/;

const B1_COMMERCIAL_CATALOG_FIRST_SCOPE_REGISTRATION: B1CommercialCatalogRegistrationV1 = {
  catalogKey: B1_COMMERCIAL_CATALOG_FIRST_SCOPE_CATALOG_KEY,
  catalogVersion: 1,
  scopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
  direction: B1_COMMERCIAL_CATALOG_SCOPE_DIRECTION,
  currency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
  accountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
  partnerDependency: B1_COMMERCIAL_CATALOG_SCOPE_PARTNER_DEPENDENCY,
  productDependency: {
    productKey: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY,
    productVersion: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY_VERSION,
  },
  stateVocabulary: B1_COMMERCIAL_CATALOG_STATE_VOCABULARY,
  plans: [
    {
      planKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE,
      planVersion: 1,
      planType: 'FEE',
      planScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      planScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      planCapabilityKey: B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
      planCapabilityVersion: 1,
      planCurrency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
      planAccountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
      planCustomerTierEligibility: B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEYS,
      planMerchantTierEligibility: B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEYS,
      planPartnerTierEligibility: B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEYS,
      planProductEligibility: [
        {
          productKey: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY,
          productVersion: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY_VERSION,
        },
      ],
      planPartnerEligibility: [B1_COMMERCIAL_CATALOG_SCOPE_PARTNER_DEPENDENCY],
      planCapabilities: [B1_COMMERCIAL_CATALOG_CAPABILITY_FEE],
      planEntitlements: [B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE],
      planFeatureFlags: [B1_COMMERCIAL_CATALOG_FEATURE_FLAG_FEE],
      planDynamicLimits: [B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_FEE],
      planBillingCycle: B1_COMMERCIAL_CATALOG_BILLING_CYCLE_PER_TRANSACTION,
      planEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      planEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      planClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      planRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
    {
      planKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION,
      planVersion: 1,
      planType: 'COMMISSION',
      planScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      planScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      planCapabilityKey: B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
      planCapabilityVersion: 1,
      planCurrency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
      planAccountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
      planCustomerTierEligibility: B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEYS,
      planMerchantTierEligibility: B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEYS,
      planPartnerTierEligibility: B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEYS,
      planProductEligibility: [
        {
          productKey: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY,
          productVersion: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY_VERSION,
        },
      ],
      planPartnerEligibility: [B1_COMMERCIAL_CATALOG_SCOPE_PARTNER_DEPENDENCY],
      planCapabilities: [B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION],
      planEntitlements: [B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION],
      planFeatureFlags: [B1_COMMERCIAL_CATALOG_FEATURE_FLAG_COMMISSION],
      planDynamicLimits: [B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_COMMISSION],
      planBillingCycle: B1_COMMERCIAL_CATALOG_BILLING_CYCLE_PER_TRANSACTION,
      planEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      planEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      planClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      planRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  customerTiers: [
    {
      tierKey: B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY,
      tierVersion: 1,
      tierScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      tierScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      tierClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      tierFeatureFlags: [...B1_COMMERCIAL_CATALOG_FEATURE_FLAG_KEYS],
      tierDynamicLimits: [...B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_KEYS],
      tierEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      tierEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      tierRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  merchantTiers: [
    {
      tierKey: B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY,
      tierVersion: 1,
      tierScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      tierScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      tierClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      tierFeatureFlags: [...B1_COMMERCIAL_CATALOG_FEATURE_FLAG_KEYS],
      tierDynamicLimits: [...B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_KEYS],
      tierEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      tierEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      tierRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  partnerTiers: [
    {
      tierKey: B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY,
      tierVersion: 1,
      tierScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      tierScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      tierClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      tierFeatureFlags: [...B1_COMMERCIAL_CATALOG_FEATURE_FLAG_KEYS],
      tierDynamicLimits: [...B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_KEYS],
      tierEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      tierEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      tierRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  productEntitlements: [
    {
      entitlementKey: B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE,
      entitlementVersion: 1,
      entitlementScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      entitlementScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      entitlementProductKey: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY,
      entitlementProductVersion: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY_VERSION,
      entitlementPlanKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE,
      entitlementPlanVersion: 1,
      entitlementCapabilityKey: B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
      entitlementCustomerTierKey: B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY,
      entitlementMerchantTierKey: B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY,
      entitlementPartnerTierKey: B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY,
      entitlementClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      entitlementEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      entitlementEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      entitlementRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
    {
      entitlementKey: B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION,
      entitlementVersion: 1,
      entitlementScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      entitlementScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      entitlementProductKey: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY,
      entitlementProductVersion: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY_VERSION,
      entitlementPlanKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION,
      entitlementPlanVersion: 1,
      entitlementCapabilityKey: B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
      entitlementCustomerTierKey: B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY,
      entitlementMerchantTierKey: B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY,
      entitlementPartnerTierKey: B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY,
      entitlementClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      entitlementEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      entitlementEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      entitlementRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  packages: [
    {
      packageKey: B1_COMMERCIAL_CATALOG_PACKAGE_KEY,
      packageVersion: 1,
      packageScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      packageScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      packageComposition: [
        { planKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE, planVersion: 1 },
        { planKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION, planVersion: 1 },
      ],
      packageCapabilities: [
        B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
        B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
      ],
      packageEntitlements: [
        B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE,
        B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION,
      ],
      packageFeatureFlags: [...B1_COMMERCIAL_CATALOG_FEATURE_FLAG_KEYS],
      packageDynamicLimits: [...B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_KEYS],
      packageEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      packageEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      packageClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      packageRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  bundles: [
    {
      bundleKey: B1_COMMERCIAL_CATALOG_BUNDLE_KEY,
      bundleVersion: 1,
      bundleScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      bundleScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      bundleComposition: [{ packageKey: B1_COMMERCIAL_CATALOG_PACKAGE_KEY, packageVersion: 1 }],
      bundleCapabilities: [
        B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
        B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
      ],
      bundleEntitlements: [
        B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_FEE,
        B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEY_COMMISSION,
      ],
      bundleFeatureFlags: [...B1_COMMERCIAL_CATALOG_FEATURE_FLAG_KEYS],
      bundleDynamicLimits: [...B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_KEYS],
      bundleEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      bundleEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      bundleClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      bundleRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  subscriptionPlans: [
    {
      subscriptionKey: B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEY,
      subscriptionVersion: 1,
      subscriptionScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      subscriptionScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      subscriptionPlanKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE,
      subscriptionPlanVersion: 1,
      subscriptionBillingCycle: B1_COMMERCIAL_CATALOG_BILLING_CYCLE_PER_TRANSACTION,
      subscriptionBillingCurrency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
      subscriptionBillingAccountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
      subscriptionCustomerTierKey: B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEY,
      subscriptionMerchantTierKey: B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEY,
      subscriptionPartnerTierKey: B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEY,
      subscriptionClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      subscriptionRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  featureFlags: [
    {
      featureFlagKey: B1_COMMERCIAL_CATALOG_FEATURE_FLAG_FEE,
      featureFlagScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      featureFlagScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      featureFlagState: 'DISABLED',
      featureFlagClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      featureFlagRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
    {
      featureFlagKey: B1_COMMERCIAL_CATALOG_FEATURE_FLAG_COMMISSION,
      featureFlagScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      featureFlagScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      featureFlagState: 'DISABLED',
      featureFlagClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      featureFlagRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  dynamicLimits: [
    {
      dynamicLimitKey: B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_FEE,
      dynamicLimitScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      dynamicLimitScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      dynamicLimitUnit: 'MINOR',
      dynamicLimitValue: '0',
      dynamicLimitCurrency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
      dynamicLimitAccountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
      dynamicLimitClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      dynamicLimitRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
    {
      dynamicLimitKey: B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_COMMISSION,
      dynamicLimitScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      dynamicLimitScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      dynamicLimitUnit: 'MINOR',
      dynamicLimitValue: '0',
      dynamicLimitCurrency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
      dynamicLimitAccountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
      dynamicLimitClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      dynamicLimitRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  pricingCatalog: [
    {
      pricingKey: B1_COMMERCIAL_CATALOG_PRICING_KEY_FEE,
      pricingVersion: 1,
      pricingScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      pricingScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      pricingCapabilityKey: B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
      pricingCurrency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
      pricingAccountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
      pricingPlanKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_FEE,
      pricingPlanVersion: 1,
      pricingEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      pricingEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      pricingClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      pricingRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
    {
      pricingKey: B1_COMMERCIAL_CATALOG_PRICING_KEY_COMMISSION,
      pricingVersion: 1,
      pricingScopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
      pricingScopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
      pricingCapabilityKey: B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
      pricingCurrency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
      pricingAccountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
      pricingPlanKey: B1_COMMERCIAL_CATALOG_PLAN_KEY_COMMISSION,
      pricingPlanVersion: 1,
      pricingEffectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
      pricingEffectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
      pricingClassificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
      pricingRetentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
    },
  ],
  compatibilityRuleIds: B1_COMMERCIAL_CATALOG_COMPATIBILITY_RULE_IDS,
  consumerContractIds: B1_COMMERCIAL_CATALOG_CONSUMER_CONTRACT_IDS,
  versionNegotiationRuleIds: B1_COMMERCIAL_CATALOG_VERSION_NEGOTIATION_RULE_IDS,
  replayRuleIds: B1_COMMERCIAL_CATALOG_REPLAY_RULE_IDS,
  effectiveFrom: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_FROM,
  effectiveTo: B1_COMMERCIAL_CATALOG_SCOPE_EFFECTIVE_TO,
  classificationLevel: B1_COMMERCIAL_CATALOG_SCOPE_CLASSIFICATION_LEVEL,
  retentionDays: B1_COMMERCIAL_CATALOG_SCOPE_RETENTION_DAYS,
};

@Injectable()
export class B1CommercialCatalogRepository {
  constructor(
    @Inject(DataSource)
    private readonly dataSource: DataSource,
    @InjectRepository(B1CommercialCatalogRegistration)
    private readonly repository: Repository<B1CommercialCatalogRegistration>,
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(OutboxService)
    private readonly outboxService: OutboxService,
    @Inject(IdempotencyService)
    private readonly idempotencyService: IdempotencyService,
    @Inject(MetricsService)
    private readonly metricsService: MetricsService,
  ) {}

  getFirstScopeRegistration(): B1CommercialCatalogRegistrationV1 {
    return B1_COMMERCIAL_CATALOG_FIRST_SCOPE_REGISTRATION;
  }

  getConsumerPorts(): B1CommercialCatalogConsumerPortsV1 {
    return {
      lookup: (command) => Promise.resolve(this.lookup(command)),
      replaySafeLookup: (command) => this.replaySafeLookup(command),
      compatibilityCheck: (command) => Promise.resolve(this.compatibilityCheck(command)),
    };
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  getAuditActor(): string {
    return B1_COMMERCIAL_CATALOG_AUDIT_ACTOR;
  }

  getAuditEntityType(): string {
    return B1_COMMERCIAL_CATALOG_AUDIT_ENTITY_TYPE;
  }

  getOutboxEventType(): string {
    return B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE;
  }

  getOutboxEventClassification(): string {
    return B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_CLASSIFICATION;
  }

  getOutboxEventRetentionClass(): string {
    return B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_RETENTION_CLASS;
  }

  getInternalIdempotencyScope(): string {
    return B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE;
  }

  getIdempotencyRetentionSeconds(): number {
    return B1_COMMERCIAL_CATALOG_IDEMPOTENCY_RETENTION_SECONDS;
  }

  getContractName(): string {
    return B1_COMMERCIAL_CATALOG_CONTRACT_NAME;
  }

  getContractVersion(): number {
    return B1_COMMERCIAL_CATALOG_CONTRACT_VERSION;
  }

  getInternalCommercialDecisionOwner(): string {
    return B1_COMMERCIAL_CATALOG_SCOPE_INTERNAL_COMMERCIAL_DECISION_OWNER;
  }

  getScopeKey(): B1CommercialCatalogRegistrationV1['scopeKey'] {
    return B1_COMMERCIAL_CATALOG_SCOPE_KEY;
  }

  getScopeVersion(): B1CommercialCatalogRegistrationV1['scopeVersion'] {
    return B1_COMMERCIAL_CATALOG_SCOPE_VERSION;
  }

  getScopeCurrency(): B1CommercialCatalogRegistrationV1['currency'] {
    return B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY;
  }

  getScopeAccountingUnit(): B1CommercialCatalogRegistrationV1['accountingUnit'] {
    return B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT;
  }

  getScopeDirection(): B1CommercialCatalogRegistrationV1['direction'] {
    return B1_COMMERCIAL_CATALOG_SCOPE_DIRECTION;
  }

  getScopePartnerDependency(): B1CommercialCatalogRegistrationV1['partnerDependency'] {
    return B1_COMMERCIAL_CATALOG_SCOPE_PARTNER_DEPENDENCY;
  }

  getScopeProductDependency(): B1CommercialCatalogRegistrationV1['productDependency'] {
    return {
      productKey: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY,
      productVersion: B1_COMMERCIAL_CATALOG_SCOPE_PRODUCT_DEPENDENCY_VERSION,
    };
  }

  getStateVocabulary(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_STATES;
  }

  getAdmittedState(): string {
    return B1_COMMERCIAL_CATALOG_STATE_ADMITTED;
  }

  getCapabilities(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_CAPABILITIES;
  }

  getPlanKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_PLAN_KEYS;
  }

  getCustomerTierKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_CUSTOMER_TIER_KEYS;
  }

  getMerchantTierKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_MERCHANT_TIER_KEYS;
  }

  getPartnerTierKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_PARTNER_TIER_KEYS;
  }

  getProductEntitlementKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_PRODUCT_ENTITLEMENT_KEYS;
  }

  getPackageKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_PACKAGE_KEYS;
  }

  getBundleKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_BUNDLE_KEYS;
  }

  getSubscriptionPlanKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_SUBSCRIPTION_PLAN_KEYS;
  }

  getFeatureFlagKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_FEATURE_FLAG_KEYS;
  }

  getDynamicLimitKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_DYNAMIC_LIMIT_KEYS;
  }

  getPricingKeys(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_PRICING_KEYS;
  }

  getBillingCycles(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_BILLING_CYCLES;
  }

  getPlanTypes(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_PLAN_TYPES;
  }

  getClassificationLevels(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_CLASSIFICATION_LEVELS;
  }

  getLookupKinds(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_LOOKUP_KINDS;
  }

  getFailureCodes(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_FAILURE_CODES;
  }

  getProhibitedAdjacentScopes(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_PROHIBITED_ADJACENT_SCOPES;
  }

  getProhibitedDependencies(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_PROHIBITED_DEPENDENCIES;
  }

  getDeclaredDependencies(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_DECLARED_DEPENDENCIES;
  }

  getCompatibilityRuleIds(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_COMPATIBILITY_RULE_IDS;
  }

  getConsumerContractIds(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_CONSUMER_CONTRACT_IDS;
  }

  getVersionNegotiationRuleIds(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_VERSION_NEGOTIATION_RULE_IDS;
  }

  getReplayRuleIds(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_REPLAY_RULE_IDS;
  }

  getDataControlClassifications(): readonly string[] {
    return B1_COMMERCIAL_CATALOG_DATA_CONTROL_CLASSIFICATIONS;
  }

  getReferencePrefix(): string {
    return B1_COMMERCIAL_CATALOG_REFERENCE_PREFIX;
  }

  lookup(command: B1CommercialCatalogLookupCommandV1): B1CommercialCatalogLookupResultV1 {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.failure(command, B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND, shapeFailure);
    }
    const registration = this.getFirstScopeRegistration();
    if (command.scopeKey !== registration.scopeKey) {
      return this.failure(
        command,
        B1_COMMERCIAL_CATALOG_FAILURE_INCOMPATIBLE,
        `B1 commercial catalog scope key mismatch: expected ${String(registration.scopeKey)}, got ${String(command.scopeKey)}`,
      );
    }
    if (command.scopeVersion !== registration.scopeVersion) {
      return this.failure(
        command,
        B1_COMMERCIAL_CATALOG_FAILURE_WRONG_VERSION,
        `B1 commercial catalog scope version mismatch: expected ${String(registration.scopeVersion)}, got ${String(command.scopeVersion)}`,
      );
    }
    if (command.expectedCurrency !== registration.currency) {
      return this.failure(
        command,
        B1_COMMERCIAL_CATALOG_FAILURE_INCOMPATIBLE,
        `B1 commercial catalog currency mismatch: expected ${String(registration.currency)}, got ${String(command.expectedCurrency)}`,
      );
    }
    if (command.expectedAccountingUnit !== registration.accountingUnit) {
      return this.failure(
        command,
        B1_COMMERCIAL_CATALOG_FAILURE_INCOMPATIBLE,
        `B1 commercial catalog accounting unit mismatch: expected ${String(registration.accountingUnit)}, got ${String(command.expectedAccountingUnit)}`,
      );
    }
    if (command.lookupKey.trim().length === 0) {
      return this.failure(
        command,
        B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND,
        'B1 commercial catalog lookup key is required',
      );
    }
    if (!SAFE_TEXT_PATTERN.test(command.lookupKey)) {
      return this.failure(
        command,
        B1_COMMERCIAL_CATALOG_FAILURE_MALFORMED,
        'B1 commercial catalog lookup key is malformed',
      );
    }
    if (B1_COMMERCIAL_CATALOG_PROHIBITED_ADJACENT_SCOPES.includes(command.lookupKey)) {
      return this.failure(
        command,
        B1_COMMERCIAL_CATALOG_FAILURE_PROHIBITED,
        `B1 commercial catalog lookup key ${command.lookupKey} is prohibited for the first commercial scope`,
      );
    }
    const plan = registration.plans.find((entry) => entry.planKey === command.lookupKey) ?? null;
    const customerTier =
      registration.customerTiers.find((entry) => entry.tierKey === command.lookupKey) ?? null;
    const merchantTier =
      registration.merchantTiers.find((entry) => entry.tierKey === command.lookupKey) ?? null;
    const partnerTier =
      registration.partnerTiers.find((entry) => entry.tierKey === command.lookupKey) ?? null;
    const productEntitlement =
      registration.productEntitlements.find(
        (entry) => entry.entitlementKey === command.lookupKey,
      ) ?? null;
    const packageRegistration =
      registration.packages.find((entry) => entry.packageKey === command.lookupKey) ?? null;
    const bundleRegistration =
      registration.bundles.find((entry) => entry.bundleKey === command.lookupKey) ?? null;
    const subscriptionPlan =
      registration.subscriptionPlans.find((entry) => entry.subscriptionKey === command.lookupKey) ??
      null;
    const featureFlag =
      registration.featureFlags.find((entry) => entry.featureFlagKey === command.lookupKey) ?? null;
    const dynamicLimit =
      registration.dynamicLimits.find((entry) => entry.dynamicLimitKey === command.lookupKey) ??
      null;
    const pricingEntries = registration.pricingCatalog.filter(
      (entry) => entry.pricingKey === command.lookupKey,
    );
    if (
      command.lookupKind !== 'CATALOG' &&
      plan === null &&
      customerTier === null &&
      merchantTier === null &&
      partnerTier === null &&
      productEntitlement === null &&
      packageRegistration === null &&
      bundleRegistration === null &&
      subscriptionPlan === null &&
      featureFlag === null &&
      dynamicLimit === null &&
      pricingEntries.length === 0
    ) {
      return this.missingLookupFailure(command, command.lookupKind);
    }
    const capabilityPlans =
      command.lookupKind === 'CAPABILITY_PLANS' || command.lookupKind === 'CATALOG'
        ? registration.plans.filter((entry) =>
            entry.planCapabilities.includes(command.lookupKey as never),
          )
        : command.lookupKind === 'PLAN'
          ? registration.plans
          : [];
    const capabilityPackages =
      command.lookupKind === 'CAPABILITY_PACKAGES' || command.lookupKind === 'CATALOG'
        ? registration.packages.filter((entry) =>
            entry.packageCapabilities.includes(command.lookupKey as never),
          )
        : [];
    const capabilityBundles =
      command.lookupKind === 'CAPABILITY_BUNDLES' || command.lookupKind === 'CATALOG'
        ? registration.bundles.filter((entry) =>
            entry.bundleCapabilities.includes(command.lookupKey as never),
          )
        : [];
    return {
      valid: true,
      scopeKey: registration.scopeKey,
      scopeVersion: registration.scopeVersion,
      lookupKind: command.lookupKind,
      plan: command.lookupKind === 'PLAN' || command.lookupKind === 'CATALOG' ? plan : null,
      customerTier:
        command.lookupKind === 'CUSTOMER_TIER' || command.lookupKind === 'CATALOG'
          ? customerTier
          : null,
      merchantTier:
        command.lookupKind === 'MERCHANT_TIER' || command.lookupKind === 'CATALOG'
          ? merchantTier
          : null,
      partnerTier:
        command.lookupKind === 'PARTNER_TIER' || command.lookupKind === 'CATALOG'
          ? partnerTier
          : null,
      productEntitlement:
        command.lookupKind === 'PRODUCT_ENTITLEMENT' || command.lookupKind === 'CATALOG'
          ? productEntitlement
          : null,
      packageRegistration:
        command.lookupKind === 'PACKAGE' || command.lookupKind === 'CATALOG'
          ? packageRegistration
          : null,
      bundleRegistration:
        command.lookupKind === 'BUNDLE' || command.lookupKind === 'CATALOG'
          ? bundleRegistration
          : null,
      subscriptionPlan:
        command.lookupKind === 'SUBSCRIPTION_PLAN' || command.lookupKind === 'CATALOG'
          ? subscriptionPlan
          : null,
      featureFlag:
        command.lookupKind === 'FEATURE_FLAG' || command.lookupKind === 'CATALOG'
          ? featureFlag
          : null,
      dynamicLimit:
        command.lookupKind === 'DYNAMIC_LIMIT' || command.lookupKind === 'CATALOG'
          ? dynamicLimit
          : null,
      pricingEntries:
        command.lookupKind === 'PRICING_CATALOG' || command.lookupKind === 'CATALOG'
          ? pricingEntries
          : [],
      capabilityPlans,
      capabilityPackages,
      capabilityBundles,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
  }

  async replaySafeLookup(
    command: B1CommercialCatalogLookupCommandV1,
  ): Promise<B1CommercialCatalogReplaySafeResultV1> {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return this.replayFailure(
        command,
        this.failure(command, B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND, shapeFailure),
        false,
        null,
        'invalid_command',
      );
    }
    const requestHash = this.computeRequestHash(command);
    const idempotencyKey = this.computeIdempotencyKey(command);
    const reservation = await this.idempotencyService.reserve(this.dataSource.manager, {
      scope: B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE,
      key: idempotencyKey,
      requestHash,
      retentionSeconds: B1_COMMERCIAL_CATALOG_IDEMPOTENCY_RETENTION_SECONDS,
    });
    if (reservation.kind === 'REPLAY') {
      const originalResult = this.lookup(command);
      await this.metricsService.increment(
        this.dataSource.manager,
        B1_COMMERCIAL_CATALOG_METRIC_REPLAYED,
        1,
      );
      return {
        result: originalResult,
        replayed: true,
        conflict: false,
        conflictReason: null,
        idempotencyScope: B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE,
        idempotencyKey,
        requestHash,
        generatedAt: new Date().toISOString(),
        correlationId: command.requestContext.correlationId,
      };
    }
    if (reservation.kind === 'IN_PROGRESS') {
      return this.replayFailure(
        command,
        this.failure(
          command,
          B1_COMMERCIAL_CATALOG_FAILURE_QUERY_UNAVAILABLE,
          'B1 commercial catalog replay-safe lookup is in progress for the same idempotency key',
        ),
        false,
        'in_progress',
        'in_progress',
      );
    }
    const result = this.lookup(command);
    return {
      result,
      replayed: false,
      conflict: false,
      conflictReason: null,
      idempotencyScope: B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      generatedAt: new Date().toISOString(),
      correlationId: command.requestContext.correlationId,
    };
  }

  compatibilityCheck(
    command: B1CommercialCatalogLookupCommandV1,
  ): B1CommercialCatalogCompatibilityResultV1 {
    const shapeFailure = this.validateCommandShape(command);
    if (shapeFailure) {
      return {
        compatible: false,
        code: B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND,
        reasons: [shapeFailure],
      };
    }
    const registration = this.getFirstScopeRegistration();
    const reasons: string[] = [];
    if (command.scopeKey !== registration.scopeKey) {
      reasons.push(
        `scopeKey mismatch: expected ${String(registration.scopeKey)}, got ${String(command.scopeKey)}`,
      );
    }
    if (command.scopeVersion !== registration.scopeVersion) {
      reasons.push(
        `scopeVersion mismatch: expected ${String(registration.scopeVersion)}, got ${String(command.scopeVersion)}`,
      );
    }
    if (command.expectedCurrency !== registration.currency) {
      reasons.push(
        `currency mismatch: expected ${String(registration.currency)}, got ${String(command.expectedCurrency)}`,
      );
    }
    if (command.expectedAccountingUnit !== registration.accountingUnit) {
      reasons.push(
        `accountingUnit mismatch: expected ${String(registration.accountingUnit)}, got ${String(command.expectedAccountingUnit)}`,
      );
    }
    if (!B1_COMMERCIAL_CATALOG_CAPABILITIES.includes(command.lookupKey)) {
      reasons.push(`capability ${command.lookupKey} is not in the B1 first commercial scope`);
    }
    if (B1_COMMERCIAL_CATALOG_PROHIBITED_ADJACENT_SCOPES.includes(command.lookupKey)) {
      reasons.push(
        `capability ${command.lookupKey} is in the B1 prohibited adjacent commercial scopes`,
      );
    }
    if (reasons.length > 0) {
      return {
        compatible: false,
        code: B1_COMMERCIAL_CATALOG_FAILURE_INCOMPATIBLE,
        reasons,
      };
    }
    return {
      compatible: true,
      reasons: [
        `scopeKey=${registration.scopeKey}`,
        `scopeVersion=${registration.scopeVersion}`,
        `currency=${registration.currency}`,
        `accountingUnit=${registration.accountingUnit}`,
        `capability=${command.lookupKey}`,
        'compatible',
      ],
    };
  }

  async findPersistenceRecords(): Promise<readonly B1CommercialCatalogPersistenceRecordV1[]> {
    const rows = await this.repository.find();
    return rows.map((row) => this.toPersistenceRecord(row));
  }

  async findPersistenceRecordByKey(
    catalogKey: string,
    catalogVersion: 1,
  ): Promise<B1CommercialCatalogPersistenceRecordV1 | null> {
    const row = await this.repository.findOne({
      where: { catalogKey, catalogVersion },
    });
    return row ? this.toPersistenceRecord(row) : null;
  }

  async upsertPersistenceRecord(
    command: Readonly<{
      readonly catalogKey: string;
      readonly catalogVersion: 1;
      readonly scopeKey: string;
      readonly scopeVersion: 1;
      readonly planKey: string | null;
      readonly planVersion: 1 | null;
      readonly customerTierKey: string | null;
      readonly merchantTierKey: string | null;
      readonly partnerTierKey: string | null;
      readonly productEntitlementKey: string | null;
      readonly packageKey: string | null;
      readonly packageVersion: 1 | null;
      readonly bundleKey: string | null;
      readonly bundleVersion: 1 | null;
      readonly subscriptionKey: string | null;
      readonly subscriptionVersion: 1 | null;
      readonly featureFlagKey: string | null;
      readonly dynamicLimitKey: string | null;
      readonly pricingKey: string | null;
      readonly effectiveFrom: Date | null;
      readonly effectiveTo: Date | null;
      readonly classificationLevel: string;
      readonly retentionDays: number;
      readonly registration: B1CommercialCatalogRegistrationV1;
    }>,
  ): Promise<B1CommercialCatalogRegistration> {
    const existing = await this.repository.findOne({
      where: { catalogKey: command.catalogKey, catalogVersion: command.catalogVersion },
    });
    if (existing) {
      existing.scopeKey = command.scopeKey as never;
      existing.scopeVersion = command.scopeVersion;
      existing.planKey = command.planKey;
      existing.planVersion = command.planVersion;
      existing.customerTierKey = command.customerTierKey;
      existing.merchantTierKey = command.merchantTierKey;
      existing.partnerTierKey = command.partnerTierKey;
      existing.productEntitlementKey = command.productEntitlementKey;
      existing.packageKey = command.packageKey;
      existing.packageVersion = command.packageVersion;
      existing.bundleKey = command.bundleKey;
      existing.bundleVersion = command.bundleVersion;
      existing.subscriptionKey = command.subscriptionKey;
      existing.subscriptionVersion = command.subscriptionVersion;
      existing.featureFlagKey = command.featureFlagKey;
      existing.dynamicLimitKey = command.dynamicLimitKey;
      existing.pricingKey = command.pricingKey;
      existing.effectiveFrom = command.effectiveFrom;
      existing.effectiveTo = command.effectiveTo;
      existing.classificationLevel = command.classificationLevel;
      existing.retentionDays = command.retentionDays;
      existing.registration = command.registration;
      return this.repository.save(existing);
    }
    const created = this.repository.create({
      catalogKey: command.catalogKey,
      catalogVersion: command.catalogVersion,
      scopeKey: command.scopeKey as never,
      scopeVersion: command.scopeVersion,
      planKey: command.planKey,
      planVersion: command.planVersion,
      customerTierKey: command.customerTierKey,
      merchantTierKey: command.merchantTierKey,
      partnerTierKey: command.partnerTierKey,
      productEntitlementKey: command.productEntitlementKey,
      packageKey: command.packageKey,
      packageVersion: command.packageVersion,
      bundleKey: command.bundleKey,
      bundleVersion: command.bundleVersion,
      subscriptionKey: command.subscriptionKey,
      subscriptionVersion: command.subscriptionVersion,
      featureFlagKey: command.featureFlagKey,
      dynamicLimitKey: command.dynamicLimitKey,
      pricingKey: command.pricingKey,
      effectiveFrom: command.effectiveFrom,
      effectiveTo: command.effectiveTo,
      classificationLevel: command.classificationLevel,
      retentionDays: command.retentionDays,
      registration: command.registration,
    });
    return this.repository.save(created);
  }

  private toPersistenceRecord(
    row: B1CommercialCatalogRegistration,
  ): B1CommercialCatalogPersistenceRecordV1 {
    return {
      catalogId: row.id,
      catalogKey: row.catalogKey,
      catalogVersion: 1 as const,
      scopeKey: row.scopeKey,
      scopeVersion: row.scopeVersion as 1,
      registration: row.registration,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: 1,
    };
  }

  private validateCommandShape(command: B1CommercialCatalogLookupCommandV1): string | null {
    if (!command) {
      return 'The B1 commercial catalog lookup command is missing';
    }
    if (command.contractName !== B1_COMMERCIAL_CATALOG_CONTRACT_NAME) {
      return 'The B1 commercial catalog lookup contract name is invalid';
    }
    if (command.contractVersion !== 1) {
      return 'The B1 commercial catalog lookup contract version is invalid';
    }
    if (command.scopeKey !== B1_COMMERCIAL_CATALOG_SCOPE_KEY) {
      return 'The B1 commercial catalog lookup scope key is invalid';
    }
    if (command.scopeVersion !== B1_COMMERCIAL_CATALOG_SCOPE_VERSION) {
      return 'The B1 commercial catalog lookup scope version is invalid';
    }
    if (!command.lookupKey.trim()) {
      return 'The B1 commercial catalog lookup key is required';
    }
    if (!command.lookupVersion || command.lookupVersion !== 1) {
      return 'The B1 commercial catalog lookup version is invalid';
    }
    if (command.expectedCurrency !== B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY) {
      return 'The B1 commercial catalog lookup currency is invalid';
    }
    if (command.expectedAccountingUnit !== B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT) {
      return 'The B1 commercial catalog lookup accounting unit is invalid';
    }
    if (!B1_COMMERCIAL_CATALOG_LOOKUP_KINDS.includes(command.lookupKind)) {
      return 'The B1 commercial catalog lookup kind is invalid';
    }
    if (!command.requestContext || !command.requestContext.correlationId) {
      return 'The B1 commercial catalog lookup request context is missing';
    }
    return null;
  }

  private missingLookupFailure(
    command: B1CommercialCatalogLookupCommandV1,
    lookupKind: B1CommercialCatalogLookupCommandV1['lookupKind'],
  ): B1CommercialCatalogLookupResultV1 {
    switch (lookupKind) {
      case 'PLAN':
      case 'CAPABILITY_PLANS':
        return this.failure(
          command,
          B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PLAN,
          'B1 commercial catalog plan is missing',
        );
      case 'PACKAGE':
      case 'CAPABILITY_PACKAGES':
        return this.failure(
          command,
          B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PACKAGE,
          'B1 commercial catalog package is missing',
        );
      case 'BUNDLE':
      case 'CAPABILITY_BUNDLES':
        return this.failure(
          command,
          B1_COMMERCIAL_CATALOG_FAILURE_MISSING_BUNDLE,
          'B1 commercial catalog bundle is missing',
        );
      case 'CUSTOMER_TIER':
      case 'MERCHANT_TIER':
      case 'PARTNER_TIER':
        return this.failure(
          command,
          B1_COMMERCIAL_CATALOG_FAILURE_MISSING_TIER,
          'B1 commercial catalog tier is missing',
        );
      case 'PRODUCT_ENTITLEMENT':
        return this.failure(
          command,
          B1_COMMERCIAL_CATALOG_FAILURE_MISSING_ENTITLEMENT,
          'B1 commercial catalog product entitlement is missing',
        );
      case 'SUBSCRIPTION_PLAN':
        return this.failure(
          command,
          B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PLAN,
          'B1 commercial catalog subscription plan is missing',
        );
      default:
        return this.failure(
          command,
          B1_COMMERCIAL_CATALOG_FAILURE_UNSUPPORTED_CAPABILITY,
          'B1 commercial catalog lookup is unsupported for the supplied capability',
        );
    }
  }

  private failure(
    command: B1CommercialCatalogLookupCommandV1,
    code: string,
    message: string,
  ): B1CommercialCatalogLookupResultV1 {
    return {
      valid: false,
      code: code as never,
      message,
      correlationId: command.requestContext.correlationId,
      requestId: command.requestContext.requestId,
      createdAt: new Date().toISOString(),
    };
  }

  private replayFailure(
    command: B1CommercialCatalogLookupCommandV1,
    result: B1CommercialCatalogLookupResultV1,
    replayed: boolean,
    conflictReason: string | null,
    conflict: string,
  ): B1CommercialCatalogReplaySafeResultV1 {
    return {
      result,
      replayed,
      conflict: conflict === 'in_progress' || conflict === 'invalid_command',
      conflictReason,
      idempotencyScope: B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE,
      idempotencyKey: this.computeIdempotencyKey(command),
      requestHash: this.computeRequestHash(command),
      generatedAt: new Date().toISOString(),
      correlationId: command.requestContext.correlationId,
    };
  }

  private computeRequestHash(command: B1CommercialCatalogLookupCommandV1): string {
    const payload = JSON.stringify({
      contractName: command.contractName,
      contractVersion: command.contractVersion,
      scopeKey: command.scopeKey,
      scopeVersion: command.scopeVersion,
      lookupKind: command.lookupKind,
      lookupKey: command.lookupKey,
      lookupVersion: command.lookupVersion,
      expectedCurrency: command.expectedCurrency,
      expectedAccountingUnit: command.expectedAccountingUnit,
      correlationId: command.requestContext.correlationId,
      causationId: command.causationId,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private computeIdempotencyKey(command: B1CommercialCatalogLookupCommandV1): string {
    return [
      command.contractName,
      command.scopeKey,
      command.scopeVersion,
      command.lookupKind,
      command.lookupKey,
      command.lookupVersion,
      command.expectedCurrency,
      command.expectedAccountingUnit,
      command.requestContext.correlationId,
    ].join(':');
  }
}
