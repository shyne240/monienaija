import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1FeeEngineRepository } from '../src/policy/b1-fee-engine.repository';
import { B1FeeEngineService } from '../src/policy/b1-fee-engine.service';
import {
  B1_FEE_ENGINE_CONTRACT_NAME,
  B1_FEE_ENGINE_CONTRACT_VERSION,
  B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE,
  B1_FEE_ENGINE_OUTBOX_EVENT_TYPE,
  B1_FEE_ENGINE_REFERENCE_PREFIX,
  B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_FEE_ENGINE_SCOPE_CURRENCY,
  B1_FEE_ENGINE_SCOPE_DIRECTION,
  B1_FEE_ENGINE_SCOPE_KEY,
  B1_FEE_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_FEE_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-fee-engine.constants';
import type { B1CommercialDecisionRequestV1 } from '../src/policy/b1-fee-engine.types';

const buildRequest = (
  overrides: Partial<B1CommercialDecisionRequestV1> = {},
): B1CommercialDecisionRequestV1 => ({
  contractName: B1_FEE_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  decisionKind: 'FEE',
  decisionRequestId: 'b1-fee-engine-svc-req-1',
  decisionRequestVersion: 1,
  scopeKey: B1_FEE_ENGINE_SCOPE_KEY,
  scopeVersion: B1_FEE_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_FEE_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  baseAmountMinor: '200000',
  baseCurrency: B1_FEE_ENGINE_SCOPE_CURRENCY,
  customerId: 'b1-fee-engine-svc-customer-1',
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantId: 'b1-fee-engine-svc-merchant-1',
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerId: 'b1-fee-engine-svc-partner-1',
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.fee',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.fee.v1.plan.standard',
  planVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  packageKey: 'commercial.virtual-account.inbound-funding.package.fee.commission.v1',
  packageVersion: 1,
  bundleKey: 'commercial.virtual-account.inbound-funding.bundle.fee.commission.v1',
  bundleVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.fee.v1',
  productEntitlementVersion: 1,
  idempotencyKey: 'b'.repeat(64),
  requestContext: {
    requestId: 'b1-fee-engine-svc-req',
    correlationId: 'b1-fee-engine-svc-corr',
    traceId: 'b1-fee-engine-svc-trace',
  },
  causationId: 'b1-fee-engine-svc-causation',
  ...overrides,
});

describe('B1 fee engine service (B1T04)', () => {
  let repository: B1FeeEngineRepository;
  let service: B1FeeEngineService;

  beforeEach(() => {
    const idempotencyServiceMock = {
      reserve: jest.fn(() => {
        return Promise.resolve({ kind: 'NEW', record: { id: 'reservation-id' } });
      }),
      complete: jest.fn(),
      fail: jest.fn(),
    };
    const metricsServiceMock = {
      increment: jest.fn(() => {
        return Promise.resolve();
      }),
    };
    const dataSourceMock = {
      manager: {
        getRepository: () => ({}),
      },
    };
    repository = new B1FeeEngineRepository(
      dataSourceMock as never,
      {} as never,
      {} as never,
      new B1CommercialCatalogService({
        getFirstScopeRegistration: () => {
          throw new Error('not used');
        },
      } as never),
      {} as never,
      {} as never,
      idempotencyServiceMock as never,
      metricsServiceMock as never,
    );
    service = new B1FeeEngineService(repository);
  });

  it('exposes the B1 fee engine contract name and version', () => {
    expect(service.getContractName()).toBe(B1_FEE_ENGINE_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(B1_FEE_ENGINE_CONTRACT_VERSION);
  });

  it('exposes the B1 fee engine first commercial scope identity', () => {
    expect(service.getScopeKey()).toBe(B1_FEE_ENGINE_SCOPE_KEY);
    expect(service.getScopeVersion()).toBe(B1_FEE_ENGINE_SCOPE_VERSION);
    expect(service.getScopeCurrency()).toBe(B1_FEE_ENGINE_SCOPE_CURRENCY);
    expect(service.getScopeAccountingUnit()).toBe(B1_FEE_ENGINE_SCOPE_ACCOUNTING_UNIT);
    expect(service.getScopeDirection()).toBe(B1_FEE_ENGINE_SCOPE_DIRECTION);
    expect(service.getScopeProductDependency()).toBe(B1_FEE_ENGINE_SCOPE_PRODUCT_DEPENDENCY);
    expect(service.getScopeProductDependencyVersion()).toBe(1);
    expect(service.getScopePartnerDependency()).toBe(B1_FEE_ENGINE_SCOPE_PARTNER_DEPENDENCY);
  });

  it('exposes the B1 fee engine audit, outbox, idempotency, and reference prefix', () => {
    expect(service.getAuditActor()).toBe('b1-fee-engine');
    expect(service.getAuditEntityType()).toBe('B1_COMMERCIAL_DECISION');
    expect(service.getOutboxEventType()).toBe(B1_FEE_ENGINE_OUTBOX_EVENT_TYPE);
    expect(service.getInternalIdempotencyScope()).toBe(B1_FEE_ENGINE_INTERNAL_IDEMPOTENCY_SCOPE);
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getReferencePrefix()).toBe(B1_FEE_ENGINE_REFERENCE_PREFIX);
  });

  it('exposes the B1 fee engine vocabulary accessors', () => {
    expect(service.getDecisionKinds().length).toBe(3);
    expect(service.getDecisionOutcomes().length).toBe(4);
    expect(service.getAdmittedOutcome()).toBe('COMMERCIAL_DECISION_ADMITTED');
    expect(service.getRuleKinds().length).toBeGreaterThan(20);
    expect(service.getRuleOutcomes().length).toBe(4);
    expect(service.getRoundingPolicies().length).toBe(3);
    expect(service.getRetentionDays()).toBe(365);
    expect(service.getLookupKinds().length).toBe(15);
    expect(service.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(service.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(service.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(service.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(service.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(service.getDataControlClassifications().length).toBe(5);
    expect(service.getFailureCodes().length).toBe(17);
    expect(service.getMetrics().length).toBeGreaterThan(10);
  });

  it('exposes the B1 fee engine consumer ports', () => {
    const ports = service.getConsumerPorts();
    expect(typeof ports.evaluate).toBe('function');
    expect(typeof ports.replaySafeEvaluate).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('runs a B1 fee engine evaluate', () => {
    const record = service.evaluate(buildRequest());
    expect(record.decisionOutcome).toBe('COMMERCIAL_DECISION_ADMITTED');
  });

  it('runs a B1 fee engine compatibility check', () => {
    const compatibility = service.compatibilityCheck(buildRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('runs a B1 fee engine replay-safe evaluate', async () => {
    const result = await service.replaySafeEvaluate(buildRequest());
    expect(result.record.decisionOutcome).toBe('COMMERCIAL_DECISION_ADMITTED');
  });

  it('returns the B1 fee engine versioning contract', () => {
    const versioning = service.getVersioningContract();
    expect(versioning.contractName).toBe(B1_FEE_ENGINE_CONTRACT_NAME);
    expect(versioning.decisionVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_FEE_ENGINE_SCOPE_KEY);
    expect(versioning.scopeVersion).toBe(B1_FEE_ENGINE_SCOPE_VERSION);
  });
});
