import { B1CommercialAnalyticsEngineRepository } from '../src/policy/b1-commercial-analytics-engine.repository';
import { B1CommercialAnalyticsEngineService } from '../src/policy/b1-commercial-analytics-engine.service';
import {
  B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_REFERENCE_PREFIX,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
  B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-commercial-analytics-engine.constants';
import type {
  B1CommercialAnalyticsRequestV1,
  B1CommercialReconciliationRequestV1,
  B1ProfitabilityRequestV1,
} from '../src/policy/b1-commercial-analytics-engine.types';
import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import type { RequestContext } from '../src/production/request-context';

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-commercial-analytics-engine-svc-req',
  correlationId: 'b1-commercial-analytics-engine-svc-corr',
  traceId: 'b1-commercial-analytics-engine-svc-trace',
});

const buildCommercialAnalyticsRequest = (): B1CommercialAnalyticsRequestV1 => ({
  contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  commercialAnalyticsRequestId: 'b1-commercial-analytics-engine-svc-commercial-analytics-req-1',
  commercialAnalyticsRequestVersion: 1,
  scopeKey: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-commercial-analytics-engine-svc-customer-1',
  merchantId: 'b1-commercial-analytics-engine-svc-merchant-1',
  partnerId: 'b1-commercial-analytics-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-analytics',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.commercial-analytics.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey:
    'commercial.virtual-account.inbound-funding.entitlement.commercial-analytics.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.commercial-analytics-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  commercialKpi: 'GMV',
  commercialAnalyticsStartAt: '2024-01-01T00:00:00.000Z',
  commercialAnalyticsEndAt: '2024-12-31T23:59:59.999Z',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
  promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
  couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
  referralDecisionReference: 'b1-referral-decision:v1:referral:1',
  cashbackDecisionReference: 'b1-referral-decision:v1:cashback:1',
  loyaltyDecisionReference: 'b1-referral-decision:v1:loyalty:1',
  revenueRecognitionDecisionReference: 'b1-revenue-recognition-decision:v1:revenue-recognition:1',
  taxVatDecisionReference: 'b1-revenue-recognition-decision:v1:tax-vat:1',
  costAccountingDecisionReference: 'b1-revenue-recognition-decision:v1:cost-accounting:1',
  idempotencyKey: 'b'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-commercial-analytics-engine-svc-causation',
});

const buildProfitabilityRequest = (): B1ProfitabilityRequestV1 => ({
  contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  profitabilityRequestId: 'b1-commercial-analytics-engine-svc-profitability-req-1',
  profitabilityRequestVersion: 1,
  scopeKey: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-commercial-analytics-engine-svc-customer-1',
  merchantId: 'b1-commercial-analytics-engine-svc-merchant-1',
  partnerId: 'b1-commercial-analytics-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.profitability',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.profitability.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.profitability.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.commercial-analytics-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  profitabilityDimension: 'PRODUCT',
  revenueAttributionAmount: '100000',
  costAttributionAmount: '40000',
  profitabilityStartAt: '2024-01-01T00:00:00.000Z',
  profitabilityEndAt: '2024-12-31T23:59:59.999Z',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
  promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
  couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
  referralDecisionReference: 'b1-referral-decision:v1:referral:1',
  cashbackDecisionReference: 'b1-referral-decision:v1:cashback:1',
  loyaltyDecisionReference: 'b1-referral-decision:v1:loyalty:1',
  revenueRecognitionDecisionReference: 'b1-revenue-recognition-decision:v1:revenue-recognition:1',
  taxVatDecisionReference: 'b1-revenue-recognition-decision:v1:tax-vat:1',
  costAccountingDecisionReference: 'b1-revenue-recognition-decision:v1:cost-accounting:1',
  idempotencyKey: 'c'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-commercial-analytics-engine-svc-profitability-causation',
});

const buildCommercialReconciliationRequest = (): B1CommercialReconciliationRequestV1 => ({
  contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  commercialReconciliationRequestId:
    'b1-commercial-analytics-engine-svc-commercial-reconciliation-req-1',
  commercialReconciliationRequestVersion: 1,
  scopeKey: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-commercial-analytics-engine-svc-customer-1',
  merchantId: 'b1-commercial-analytics-engine-svc-merchant-1',
  partnerId: 'b1-commercial-analytics-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-reconciliation',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.commercial-reconciliation.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey:
    'commercial.virtual-account.inbound-funding.entitlement.commercial-reconciliation.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.commercial-analytics-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  reconciliationWindowStartAt: '2024-01-01T00:00:00.000Z',
  reconciliationWindowEndAt: '2024-01-01T00:00:00.001Z',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
  promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
  couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
  referralDecisionReference: 'b1-referral-decision:v1:referral:1',
  cashbackDecisionReference: 'b1-referral-decision:v1:cashback:1',
  loyaltyDecisionReference: 'b1-referral-decision:v1:loyalty:1',
  revenueRecognitionDecisionReference: 'b1-revenue-recognition-decision:v1:revenue-recognition:1',
  taxVatDecisionReference: 'b1-revenue-recognition-decision:v1:tax-vat:1',
  costAccountingDecisionReference: 'b1-revenue-recognition-decision:v1:cost-accounting:1',
  idempotencyKey: 'd'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-commercial-analytics-engine-svc-commercial-reconciliation-causation',
});

describe('B1 commercial-analytics engine service (B1T09)', () => {
  let repository: B1CommercialAnalyticsEngineRepository;
  let service: B1CommercialAnalyticsEngineService;

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
    repository = new B1CommercialAnalyticsEngineRepository(
      dataSourceMock as never,
      {} as never,
      new B1CommercialCatalogService({
        getFirstScopeRegistration: () => {
          throw new Error('not used');
        },
      } as never),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      idempotencyServiceMock as never,
      metricsServiceMock as never,
    );
    service = new B1CommercialAnalyticsEngineService(repository);
  });

  it('exposes the B1 commercial-analytics engine contract name and version', () => {
    expect(service.getContractName()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(1);
  });

  it('exposes the B1 commercial-analytics engine first commercial scope identity', () => {
    expect(service.getScopeKey()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY);
    expect(service.getScopeVersion()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION);
    expect(service.getScopeCurrency()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY);
    expect(service.getScopeAccountingUnit()).toBe(
      B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
    );
  });

  it('exposes the B1 commercial-analytics engine period identity', () => {
    expect(service.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.commercial-analytics-period.per-flow.v1',
    );
  });

  it('exposes the B1 commercial-analytics engine audit, outbox, idempotency, and reference prefix', () => {
    expect(service.getAuditActor()).toBe('b1-commercial-analytics-engine');
    expect(service.getAuditEntityType()).toBe('B1_COMMERCIAL_ANALYTICS_DECISION');
    expect(service.getOutboxEventType()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_OUTBOX_EVENT_TYPE);
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getReferencePrefix()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_REFERENCE_PREFIX);
  });

  it('exposes the B1 commercial-analytics engine vocabulary accessors', () => {
    expect(service.getCommercialAnalyticsStates().length).toBe(5);
    expect(service.getProfitabilityStates().length).toBe(5);
    expect(service.getCommercialReconciliationStates().length).toBe(6);
    expect(service.getDecisionKinds().length).toBe(3);
    expect(service.getDecisionOutcomes().length).toBe(5);
    expect(service.getDocumentKinds().length).toBe(23);
    expect(service.getRuleKinds().length).toBeGreaterThan(50);
    expect(service.getRuleOutcomes().length).toBe(4);
    expect(service.getKpis().length).toBe(20);
    expect(service.getTrends().length).toBe(5);
    expect(service.getDiscrepancySeverities().length).toBe(5);
    expect(service.getDiscrepancyOwners().length).toBe(10);
    expect(service.getDiscrepancyRecoveryStates().length).toBe(8);
    expect(service.getDiscrepancyCategories().length).toBe(16);
    expect(service.getProfitabilityDimensions().length).toBe(8);
    expect(service.getClassificationLevels().length).toBeGreaterThan(0);
    expect(service.getDataControlClassifications().length).toBeGreaterThan(0);
    expect(service.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(service.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(service.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(service.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(service.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(service.getFailureCodes().length).toBe(26);
    expect(service.getMetrics().length).toBeGreaterThan(20);
    expect(service.getRetentionDays()).toBe(365);
  });

  it('exposes the B1 commercial-analytics engine consumer ports', () => {
    const ports = service.getConsumerPorts();
    expect(typeof ports.generateCommercialAnalyticsDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCommercialAnalyticsDecision).toBe('function');
    expect(typeof ports.generateProfitabilityDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateProfitabilityDecision).toBe('function');
    expect(typeof ports.generateCommercialReconciliationDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCommercialReconciliationDecision).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('runs a B1 commercial-analytics decision generate', () => {
    const record = service.generateCommercialAnalyticsDecision(buildCommercialAnalyticsRequest());
    expect(record.commercialAnalyticsDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 profitability decision generate', () => {
    const record = service.generateProfitabilityDecision(buildProfitabilityRequest());
    expect(record.profitabilityDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 commercial-reconciliation decision generate', () => {
    const record = service.generateCommercialReconciliationDecision(
      buildCommercialReconciliationRequest(),
    );
    expect(record.commercialReconciliationDecisionState).toBe('RECONCILED');
  });

  it('runs a B1 commercial-analytics engine compatibility check', () => {
    const compatibility = service.compatibilityCheck(buildCommercialAnalyticsRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('runs a B1 commercial-analytics decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateCommercialAnalyticsDecision(
      buildCommercialAnalyticsRequest(),
    );
    expect(result.record.commercialAnalyticsDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 profitability decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateProfitabilityDecision(
      buildProfitabilityRequest(),
    );
    expect(result.record.profitabilityDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 commercial-reconciliation decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateCommercialReconciliationDecision(
      buildCommercialReconciliationRequest(),
    );
    expect(result.record.commercialReconciliationDecisionState).toBe('RECONCILED');
  });

  it('returns the B1 commercial-analytics engine versioning contract', () => {
    const versioning = service.getVersioningContract();
    expect(versioning.contractName).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY);
  });
});
