import { B1CommercialAnalyticsEngineRepository } from '../src/policy/b1-commercial-analytics-engine.repository';
import {
  B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INCOMPATIBLE,
  B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND,
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

const SHA256_RE = /^[a-f0-9]{64}$/;

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-commercial-analytics-engine-req',
  correlationId: 'b1-commercial-analytics-engine-corr',
  traceId: 'b1-commercial-analytics-engine-trace',
});

const buildCommercialAnalyticsRequest = (
  overrides: Partial<B1CommercialAnalyticsRequestV1> = {},
): B1CommercialAnalyticsRequestV1 => ({
  contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  commercialAnalyticsRequestId: 'b1-commercial-analytics-engine-commercial-analytics-req-1',
  commercialAnalyticsRequestVersion: 1,
  scopeKey: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-commercial-analytics-engine-customer-1',
  merchantId: 'b1-commercial-analytics-engine-merchant-1',
  partnerId: 'b1-commercial-analytics-engine-partner-1',
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
  causationId: 'b1-commercial-analytics-engine-causation',
  ...overrides,
});

const buildProfitabilityRequest = (
  overrides: Partial<B1ProfitabilityRequestV1> = {},
): B1ProfitabilityRequestV1 => ({
  contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  profitabilityRequestId: 'b1-commercial-analytics-engine-profitability-req-1',
  profitabilityRequestVersion: 1,
  scopeKey: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-commercial-analytics-engine-customer-1',
  merchantId: 'b1-commercial-analytics-engine-merchant-1',
  partnerId: 'b1-commercial-analytics-engine-partner-1',
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
  causationId: 'b1-commercial-analytics-engine-profitability-causation',
  ...overrides,
});

const buildCommercialReconciliationRequest = (
  overrides: Partial<B1CommercialReconciliationRequestV1> = {},
): B1CommercialReconciliationRequestV1 => ({
  contractName: B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  commercialReconciliationRequestId:
    'b1-commercial-analytics-engine-commercial-reconciliation-req-1',
  commercialReconciliationRequestVersion: 1,
  scopeKey: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-commercial-analytics-engine-customer-1',
  merchantId: 'b1-commercial-analytics-engine-merchant-1',
  partnerId: 'b1-commercial-analytics-engine-partner-1',
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
  causationId: 'b1-commercial-analytics-engine-commercial-reconciliation-causation',
  ...overrides,
});

describe('B1 commercial-analytics engine repository (B1T09)', () => {
  let repository: B1CommercialAnalyticsEngineRepository;

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
  });

  it('exposes the B1 commercial-analytics engine contract name and version', () => {
    expect(repository.getContractName()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME);
    expect(repository.getContractVersion()).toBe(1);
  });

  it('exposes the B1 commercial-analytics engine first commercial scope identity', () => {
    expect(repository.getScopeKey()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY);
    expect(repository.getScopeVersion()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_VERSION);
    expect(repository.getScopeCurrency()).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_CURRENCY);
    expect(repository.getScopeAccountingUnit()).toBe(
      B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_ACCOUNTING_UNIT,
    );
    expect(repository.getScopeDirection()).toBe('inbound');
    expect(repository.getScopeProductDependency()).toBe('VIRTUAL_ACCOUNT');
    expect(repository.getScopePartnerDependency()).toBe('NIBSS_NIP');
  });

  it('exposes the B1 commercial-analytics engine period identity', () => {
    expect(repository.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.commercial-analytics-period.per-flow.v1',
    );
  });

  it('exposes the B1 commercial-analytics engine audit, outbox, idempotency, and reference prefix', () => {
    expect(repository.getAuditActor()).toBe('b1-commercial-analytics-engine');
    expect(repository.getAuditEntityType()).toBe('B1_COMMERCIAL_ANALYTICS_DECISION');
    expect(repository.getOutboxEventType()).toBe('B1CommercialAnalyticsDecisionDecided');
    expect(repository.getCommercialAnalyticsIdempotencyScope()).toBe(
      B1_COMMERCIAL_ANALYTICS_ENGINE_COMMERCIAL_ANALYTICS_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(repository.getReferencePrefix()).toBe('b1-commercial-analytics-decision');
  });

  it('exposes the B1 commercial-analytics engine vocabulary accessors', () => {
    expect(repository.getCommercialAnalyticsStates().length).toBe(5);
    expect(repository.getProfitabilityStates().length).toBe(5);
    expect(repository.getCommercialReconciliationStates().length).toBe(6);
    expect(repository.getDecisionKinds().length).toBe(3);
    expect(repository.getDecisionOutcomes().length).toBe(5);
    expect(repository.getDocumentKinds().length).toBe(23);
    expect(repository.getRuleKinds().length).toBeGreaterThan(50);
    expect(repository.getRuleOutcomes().length).toBe(4);
    expect(repository.getKpis().length).toBe(20);
    expect(repository.getTrends().length).toBe(5);
    expect(repository.getDiscrepancySeverities().length).toBe(5);
    expect(repository.getDiscrepancyOwners().length).toBe(10);
    expect(repository.getDiscrepancyRecoveryStates().length).toBe(8);
    expect(repository.getDiscrepancyCategories().length).toBe(16);
    expect(repository.getProfitabilityDimensions().length).toBe(8);
    expect(repository.getClassificationLevels().length).toBeGreaterThan(0);
    expect(repository.getDataControlClassifications().length).toBeGreaterThan(0);
    expect(repository.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(repository.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(repository.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(repository.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(repository.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(repository.getFailureCodes().length).toBe(26);
    expect(repository.getMetrics().length).toBeGreaterThan(20);
    expect(repository.getRetentionDays()).toBe(365);
  });

  it('generates a B1 commercial-analytics decision for a valid request', () => {
    const record = repository.generateCommercialAnalyticsDecision(
      buildCommercialAnalyticsRequest(),
    );
    expect(record.commercialAnalyticsDecisionState).toBe('ACTIVE');
    expect(record.commercialAnalyticsDecisionOutcome).toBe('COMPLETED');
    expect(SHA256_RE.test(record.commercialAnalyticsDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialAnalyticsDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialAnalyticsRequestHash)).toBe(true);
    expect(record.commercialAnalyticsEligible).toBe(true);
    expect(record.commercialAnalyticsApplicable).toBe(true);
    expect(record.eligibilitySummary.length).toBe(9);
  });

  it('produces deterministic B1 commercial-analytics decisions for identical inputs', () => {
    const request = buildCommercialAnalyticsRequest();
    const a = repository.generateCommercialAnalyticsDecision(request);
    const b = repository.generateCommercialAnalyticsDecision(request);
    expect(a.commercialAnalyticsDecisionHash).toBe(b.commercialAnalyticsDecisionHash);
    expect(a.commercialAnalyticsDecisionReplayHash).toBe(b.commercialAnalyticsDecisionReplayHash);
    expect(a.commercialAnalyticsRequestHash).toBe(b.commercialAnalyticsRequestHash);
  });

  it('returns a failure commercial-analytics decision for an invalid contract name', () => {
    const record = repository.generateCommercialAnalyticsDecision(
      buildCommercialAnalyticsRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure commercial-analytics decision for an invalid scope key', () => {
    const record = repository.generateCommercialAnalyticsDecision(
      buildCommercialAnalyticsRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure commercial-analytics decision for an invalid product key', () => {
    const record = repository.generateCommercialAnalyticsDecision(
      buildCommercialAnalyticsRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure commercial-analytics decision for an invalid idempotency key', () => {
    const record = repository.generateCommercialAnalyticsDecision(
      buildCommercialAnalyticsRequest({ idempotencyKey: 'invalid' }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 profitability decision for a valid request', () => {
    const record = repository.generateProfitabilityDecision(buildProfitabilityRequest());
    expect(record.profitabilityDecisionState).toBe('ACTIVE');
    expect(record.profitabilityDecisionOutcome).toBe('COMPLETED');
    expect(SHA256_RE.test(record.profitabilityDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.profitabilityDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.profitabilityRequestHash)).toBe(true);
    expect(record.profitabilityEligible).toBe(true);
    expect(record.profitabilityApplicable).toBe(true);
    expect(record.grossProfitAmount).toBe('60000');
    expect(record.netProfitAmount).toBe('60000');
  });

  it('produces deterministic B1 profitability decisions for identical inputs', () => {
    const request = buildProfitabilityRequest();
    const a = repository.generateProfitabilityDecision(request);
    const b = repository.generateProfitabilityDecision(request);
    expect(a.profitabilityDecisionHash).toBe(b.profitabilityDecisionHash);
    expect(a.profitabilityDecisionReplayHash).toBe(b.profitabilityDecisionReplayHash);
    expect(a.profitabilityRequestHash).toBe(b.profitabilityRequestHash);
  });

  it('returns a failure profitability decision for an invalid profitability request', () => {
    const record = repository.generateProfitabilityDecision(
      buildProfitabilityRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 commercial-reconciliation decision for a valid request', () => {
    const record = repository.generateCommercialReconciliationDecision(
      buildCommercialReconciliationRequest(),
    );
    expect(record.commercialReconciliationDecisionState).toBe('RECONCILED');
    expect(record.commercialReconciliationDecisionOutcome).toBe('RECONCILED');
    expect(SHA256_RE.test(record.commercialReconciliationDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialReconciliationDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialReconciliationRequestHash)).toBe(true);
    expect(record.commercialReconciliationEligible).toBe(true);
    expect(record.commercialReconciliationApplicable).toBe(true);
    expect(record.commercialReconciliationDiscrepancyCount).toBe(0);
  });

  it('produces deterministic B1 commercial-reconciliation decisions for identical inputs', () => {
    const request = buildCommercialReconciliationRequest();
    const a = repository.generateCommercialReconciliationDecision(request);
    const b = repository.generateCommercialReconciliationDecision(request);
    expect(a.commercialReconciliationDecisionHash).toBe(b.commercialReconciliationDecisionHash);
    expect(a.commercialReconciliationDecisionReplayHash).toBe(
      b.commercialReconciliationDecisionReplayHash,
    );
    expect(a.commercialReconciliationRequestHash).toBe(b.commercialReconciliationRequestHash);
  });

  it('returns a failure commercial-reconciliation decision for an invalid request', () => {
    const record = repository.generateCommercialReconciliationDecision(
      buildCommercialReconciliationRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('runs a B1 commercial-analytics engine compatibility check', () => {
    const compatibility = repository.compatibilityCheck(buildCommercialAnalyticsRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('returns a compatibility mismatch for an invalid scope key', () => {
    const compatibility = repository.compatibilityCheck(
      buildCommercialAnalyticsRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(compatibility.compatible).toBe(false);
    if (!compatibility.compatible) {
      expect(compatibility.code).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_FAILURE_INCOMPATIBLE);
    }
  });

  it('returns a compatibility mismatch for an invalid product key', () => {
    const compatibility = repository.compatibilityCheck(
      buildCommercialAnalyticsRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns the B1 commercial-analytics engine versioning contract', () => {
    const versioning = repository.getVersioningContract();
    expect(versioning.contractName).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_COMMERCIAL_ANALYTICS_ENGINE_SCOPE_KEY);
  });

  it('exposes the B1 commercial-analytics engine consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const evaluated = await ports.generateCommercialAnalyticsDecision(
      buildCommercialAnalyticsRequest(),
    );
    expect(evaluated.commercialAnalyticsDecisionState).toBe('ACTIVE');
  });

  it('runs a replay-safe generate commercial-analytics decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCommercialAnalyticsDecision(
      buildCommercialAnalyticsRequest(),
    );
    expect(result.record.commercialAnalyticsDecisionState).toBe('ACTIVE');
    expect(SHA256_RE.test(result.commercialAnalyticsRequestHash)).toBe(true);
    expect(SHA256_RE.test(result.commercialAnalyticsDecisionHash)).toBe(true);
    expect(SHA256_RE.test(result.commercialAnalyticsDecisionReplayHash)).toBe(true);
  });

  it('runs a replay-safe generate profitability decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateProfitabilityDecision(buildProfitabilityRequest());
    expect(result.record.profitabilityDecisionState).toBe('ACTIVE');
  });

  it('runs a replay-safe generate commercial-reconciliation decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCommercialReconciliationDecision(
      buildCommercialReconciliationRequest(),
    );
    expect(result.record.commercialReconciliationDecisionState).toBe('RECONCILED');
  });

  it('runs a compatibility check via consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.compatibilityCheck(buildCommercialAnalyticsRequest());
    expect(result.compatible).toBe(true);
  });
});
