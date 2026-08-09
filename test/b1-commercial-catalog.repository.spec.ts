import { B1CommercialCatalogRepository } from '../src/policy/b1-commercial-catalog.repository';
import {
  B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION,
  B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
  B1_COMMERCIAL_CATALOG_CONTRACT_NAME,
  B1_COMMERCIAL_CATALOG_CONTRACT_VERSION,
  B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND,
  B1_COMMERCIAL_CATALOG_FAILURE_MALFORMED,
  B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PLAN,
  B1_COMMERCIAL_CATALOG_FAILURE_PROHIBITED,
  B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
  B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
  B1_COMMERCIAL_CATALOG_SCOPE_KEY,
  B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
} from '../src/policy/b1-commercial-catalog.constants';
import type { B1CommercialCatalogLookupCommandV1 } from '../src/policy/b1-commercial-catalog.types';
import type { RequestContext } from '../src/production/request-context';

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-commercial-catalog-req',
  correlationId: 'b1-commercial-catalog-corr',
  traceId: 'b1-commercial-catalog-trace',
});

const buildLookupCommand = (
  overrides: Partial<B1CommercialCatalogLookupCommandV1> = {},
): B1CommercialCatalogLookupCommandV1 => ({
  contractName: B1_COMMERCIAL_CATALOG_CONTRACT_NAME,
  contractVersion: 1,
  scopeKey: B1_COMMERCIAL_CATALOG_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_CATALOG_SCOPE_VERSION,
  lookupKind: 'CATALOG',
  lookupKey: B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
  lookupVersion: 1,
  expectedCurrency: B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT,
  requestContext: buildRequestContext(),
  causationId: null,
  ...overrides,
});

describe('B1 commercial catalog repository (B1T03)', () => {
  let repository: B1CommercialCatalogRepository;

  beforeEach(() => {
    repository = new B1CommercialCatalogRepository(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('exposes the canonical B1 commercial catalog contract name and version', () => {
    expect(repository.getContractName()).toBe(B1_COMMERCIAL_CATALOG_CONTRACT_NAME);
    expect(repository.getContractVersion()).toBe(B1_COMMERCIAL_CATALOG_CONTRACT_VERSION);
  });

  it('exposes the first commercial scope registration as a single frozen registration', () => {
    const registration = repository.getFirstScopeRegistration();
    expect(registration.scopeKey).toBe(B1_COMMERCIAL_CATALOG_SCOPE_KEY);
    expect(registration.scopeVersion).toBe(B1_COMMERCIAL_CATALOG_SCOPE_VERSION);
    expect(registration.currency).toBe(B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY);
    expect(registration.accountingUnit).toBe(B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT);
    expect(registration.partnerDependency).toBe('NIBSS_NIP');
    expect(registration.productDependency.productKey).toBe('VIRTUAL_ACCOUNT');
    expect(registration.productDependency.productVersion).toBe(1);
    expect(registration.plans).toHaveLength(2);
    expect(registration.customerTiers).toHaveLength(1);
    expect(registration.merchantTiers).toHaveLength(1);
    expect(registration.partnerTiers).toHaveLength(1);
    expect(registration.productEntitlements).toHaveLength(2);
    expect(registration.packages).toHaveLength(1);
    expect(registration.bundles).toHaveLength(1);
    expect(registration.subscriptionPlans).toHaveLength(1);
    expect(registration.featureFlags).toHaveLength(2);
    expect(registration.dynamicLimits).toHaveLength(2);
    expect(registration.pricingCatalog).toHaveLength(2);
  });

  it('returns the first commercial scope vocabulary surfaces', () => {
    expect(repository.getStateVocabulary()).toContain('COMMERCIAL_DECISION_ADMITTED');
    expect(repository.getAdmittedState()).toBe('COMMERCIAL_DECISION_ADMITTED');
    expect(repository.getCapabilities()).toContain(B1_COMMERCIAL_CATALOG_CAPABILITY_FEE);
    expect(repository.getCapabilities()).toContain(B1_COMMERCIAL_CATALOG_CAPABILITY_COMMISSION);
    expect(repository.getInternalIdempotencyScope()).toBe(
      B1_COMMERCIAL_CATALOG_INTERNAL_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getIdempotencyRetentionSeconds()).toBe(86_400);
  });

  it('returns the B1 commercial catalog list surfaces', () => {
    expect(repository.getPlanKeys()).toHaveLength(2);
    expect(repository.getCustomerTierKeys()).toHaveLength(1);
    expect(repository.getMerchantTierKeys()).toHaveLength(1);
    expect(repository.getPartnerTierKeys()).toHaveLength(1);
    expect(repository.getProductEntitlementKeys()).toHaveLength(2);
    expect(repository.getPackageKeys()).toHaveLength(1);
    expect(repository.getBundleKeys()).toHaveLength(1);
    expect(repository.getSubscriptionPlanKeys()).toHaveLength(1);
    expect(repository.getFeatureFlagKeys()).toHaveLength(2);
    expect(repository.getDynamicLimitKeys()).toHaveLength(2);
    expect(repository.getPricingKeys()).toHaveLength(2);
    expect(repository.getFailureCodes().length).toBeGreaterThan(0);
    expect(repository.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(repository.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(repository.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(repository.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(repository.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(repository.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(repository.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(repository.getClassificationLevels().length).toBe(5);
    expect(repository.getDataControlClassifications().length).toBe(5);
    expect(repository.getLookupKinds().length).toBe(15);
    expect(repository.getBillingCycles().length).toBe(1);
    expect(repository.getPlanTypes().length).toBe(2);
    expect(repository.getReferencePrefix()).toBe('b1-commercial-catalog');
  });

  it('returns the B1 commercial catalog audit and outbox identity', () => {
    expect(repository.getAuditActor()).toBe('b1-commercial-catalog');
    expect(repository.getAuditEntityType()).toBe('B1_COMMERCIAL_CATALOG');
    expect(repository.getOutboxEventType()).toBe('B1CommercialCatalogRegistered');
  });

  it('returns the B1 commercial catalog scope identity, currency, accounting unit, and dependency', () => {
    expect(repository.getScopeKey()).toBe(B1_COMMERCIAL_CATALOG_SCOPE_KEY);
    expect(repository.getScopeVersion()).toBe(B1_COMMERCIAL_CATALOG_SCOPE_VERSION);
    expect(repository.getScopeCurrency()).toBe(B1_COMMERCIAL_CATALOG_SCOPE_CURRENCY);
    expect(repository.getScopeAccountingUnit()).toBe(B1_COMMERCIAL_CATALOG_SCOPE_ACCOUNTING_UNIT);
    expect(repository.getScopeDirection()).toBe('inbound');
    expect(repository.getScopePartnerDependency()).toBe('NIBSS_NIP');
    expect(repository.getScopeProductDependency()).toEqual({
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
    });
  });

  it('looks up a B1 commercial catalog entry by key', () => {
    const result = repository.lookup(buildLookupCommand());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.scopeKey).toBe(B1_COMMERCIAL_CATALOG_SCOPE_KEY);
      expect(result.scopeVersion).toBe(B1_COMMERCIAL_CATALOG_SCOPE_VERSION);
      expect(result.lookupKind).toBe('CATALOG');
      expect(result.capabilityPlans.length).toBe(1);
      expect(result.capabilityPackages.length).toBe(1);
      expect(result.capabilityBundles.length).toBe(1);
    }
  });

  it('rejects a lookup with an invalid contract name', () => {
    const result = repository.lookup(
      buildLookupCommand({ contractName: 'B1-OTHER-CATALOG' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects a lookup with an invalid scope key', () => {
    const result = repository.lookup(buildLookupCommand({ scopeKey: 'commercial.fx' as never }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects a lookup with a wrong scope version', () => {
    const result = repository.lookup(buildLookupCommand({ scopeVersion: 2 as never }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects a lookup with a wrong currency', () => {
    const result = repository.lookup(buildLookupCommand({ expectedCurrency: 'USD' as never }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects a lookup with a wrong accounting unit', () => {
    const result = repository.lookup(
      buildLookupCommand({ expectedAccountingUnit: 'MERCHANT_FUNDS' as never }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(B1_COMMERCIAL_CATALOG_FAILURE_INVALID_COMMAND);
    }
  });

  it('rejects a lookup with a malformed lookup key', () => {
    const result = repository.lookup(buildLookupCommand({ lookupKey: '$%^&*' }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(B1_COMMERCIAL_CATALOG_FAILURE_MALFORMED);
    }
  });

  it('rejects a lookup with a prohibited adjacent scope', () => {
    const result = repository.lookup(
      buildLookupCommand({ lookupKey: 'commercial.virtual-account.outbound-settlement' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(B1_COMMERCIAL_CATALOG_FAILURE_PROHIBITED);
    }
  });

  it('returns a missing-plan failure for an unknown plan key', () => {
    const result = repository.lookup(
      buildLookupCommand({ lookupKind: 'PLAN', lookupKey: 'commercial.unknown.plan.v1' }),
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe(B1_COMMERCIAL_CATALOG_FAILURE_MISSING_PLAN);
    }
  });

  it('returns the B1 commercial catalog compatibility check', () => {
    const compatibility = repository.compatibilityCheck(buildLookupCommand());
    expect(compatibility.compatible).toBe(true);
  });

  it('returns a compatibility mismatch for the wrong scope key', () => {
    const compatibility = repository.compatibilityCheck(
      buildLookupCommand({ scopeKey: 'commercial.fx' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns a compatibility mismatch for the wrong scope version', () => {
    const compatibility = repository.compatibilityCheck(
      buildLookupCommand({ scopeVersion: 2 as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns a compatibility mismatch for a prohibited adjacent scope', () => {
    const compatibility = repository.compatibilityCheck(
      buildLookupCommand({ lookupKey: 'commercial.virtual-account.outbound-settlement' }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns a compatibility mismatch for an unsupported capability', () => {
    const compatibility = repository.compatibilityCheck(
      buildLookupCommand({ lookupKey: 'commercial.unknown-capability' }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns a compatibility failure for an invalid command shape', () => {
    const compatibility = repository.compatibilityCheck(
      buildLookupCommand({ contractName: 'B1-OTHER-CATALOG' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns the B1 commercial catalog consumer ports', () => {
    const ports = repository.getConsumerPorts();
    expect(typeof ports.lookup).toBe('function');
    expect(typeof ports.replaySafeLookup).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('returns the B1 commercial catalog internal commercial decision owner', () => {
    expect(repository.getInternalCommercialDecisionOwner()).toBe('B1_COMMERCIAL_ENGINE');
  });
});
