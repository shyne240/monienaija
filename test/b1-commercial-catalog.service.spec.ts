import { B1CommercialCatalogRepository } from '../src/policy/b1-commercial-catalog.repository';
import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import {
  B1_COMMERCIAL_CATALOG_CAPABILITY_FEE,
  B1_COMMERCIAL_CATALOG_CONTRACT_NAME,
  B1_COMMERCIAL_CATALOG_CONTRACT_VERSION,
  B1_COMMERCIAL_CATALOG_FIRST_SCOPE_CATALOG_KEY,
  B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE,
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
  expectedCurrency: 'NGN',
  expectedAccountingUnit: 'CUSTOMER_FUNDS',
  requestContext: buildRequestContext(),
  causationId: null,
  ...overrides,
});

describe('B1 commercial catalog service (B1T03)', () => {
  let repository: B1CommercialCatalogRepository;
  let service: B1CommercialCatalogService;

  beforeEach(() => {
    repository = new B1CommercialCatalogRepository(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    service = new B1CommercialCatalogService(repository);
  });

  it('exposes the B1 commercial catalog contract name and version', () => {
    expect(service.getContractName()).toBe(B1_COMMERCIAL_CATALOG_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(B1_COMMERCIAL_CATALOG_CONTRACT_VERSION);
  });

  it('exposes the first commercial scope registration', () => {
    const registration = service.getFirstScopeRegistration();
    expect(registration.catalogKey).toBe(B1_COMMERCIAL_CATALOG_FIRST_SCOPE_CATALOG_KEY);
    expect(registration.scopeKey).toBe(B1_COMMERCIAL_CATALOG_SCOPE_KEY);
  });

  it('exposes the consumer ports', () => {
    const ports = service.getConsumerPorts();
    expect(typeof ports.lookup).toBe('function');
    expect(typeof ports.replaySafeLookup).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('runs a lookup', () => {
    const result = service.lookup(buildLookupCommand());
    expect(result.valid).toBe(true);
  });

  it('runs a compatibility check', () => {
    const compatibility = service.compatibilityCheck(buildLookupCommand());
    expect(compatibility.compatible).toBe(true);
  });

  it('exposes the versioning contract', () => {
    const versioning = service.getVersioningContract();
    expect(versioning.catalogVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_COMMERCIAL_CATALOG_SCOPE_KEY);
    expect(versioning.scopeVersion).toBe(B1_COMMERCIAL_CATALOG_SCOPE_VERSION);
    expect(versioning.supersededByCatalogKey).toBeNull();
    expect(versioning.supersedesCatalogKey).toBeNull();
  });

  it('exposes the B1 commercial catalog audit and outbox identity', () => {
    expect(service.getAuditActor()).toBe('b1-commercial-catalog');
    expect(service.getAuditEntityType()).toBe('B1_COMMERCIAL_CATALOG');
    expect(service.getOutboxEventType()).toBe(B1_COMMERCIAL_CATALOG_OUTBOX_EVENT_TYPE);
  });

  it('exposes the B1 commercial catalog list surfaces', () => {
    expect(service.listStates().length).toBeGreaterThan(0);
    expect(service.listCapabilities().length).toBe(2);
    expect(service.listPlanKeys().length).toBe(2);
    expect(service.listCustomerTierKeys().length).toBe(1);
    expect(service.listMerchantTierKeys().length).toBe(1);
    expect(service.listPartnerTierKeys().length).toBe(1);
    expect(service.listProductEntitlementKeys().length).toBe(2);
    expect(service.listPackageKeys().length).toBe(1);
    expect(service.listBundleKeys().length).toBe(1);
    expect(service.listSubscriptionPlanKeys().length).toBe(1);
    expect(service.listFeatureFlagKeys().length).toBe(2);
    expect(service.listDynamicLimitKeys().length).toBe(2);
    expect(service.listPricingKeys().length).toBe(2);
    expect(service.listBillingCycles().length).toBe(1);
    expect(service.listPlanTypes().length).toBe(2);
    expect(service.listClassificationLevels().length).toBe(5);
    expect(service.listLookupKinds().length).toBe(15);
    expect(service.listFailureCodes().length).toBe(12);
    expect(service.listProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(service.listProhibitedDependencies().length).toBeGreaterThan(0);
    expect(service.listDeclaredDependencies().length).toBeGreaterThan(0);
    expect(service.listCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(service.listConsumerContractIds().length).toBeGreaterThan(0);
    expect(service.listVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(service.listReplayRuleIds().length).toBeGreaterThan(0);
    expect(service.listDataControlClassifications().length).toBe(5);
    expect(service.getReferencePrefix()).toBe('b1-commercial-catalog');
  });
});
