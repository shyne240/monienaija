import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1RevenueRecognitionEngineRepository } from '../src/policy/b1-revenue-recognition-engine.repository';
import {
  B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
  B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INCOMPATIBLE,
  B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND,
  B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
} from '../src/policy/b1-revenue-recognition-engine.constants';
import type {
  B1CostAccountingRequestV1,
  B1RevenueRecognitionRequestV1,
  B1TaxVatRequestV1,
} from '../src/policy/b1-revenue-recognition-engine.types';
import type { RequestContext } from '../src/production/request-context';

const SHA256_RE = /^[a-f0-9]{64}$/;

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-revenue-recognition-engine-req',
  correlationId: 'b1-revenue-recognition-engine-corr',
  traceId: 'b1-revenue-recognition-engine-trace',
});

const buildRevenueRecognitionRequest = (
  overrides: Partial<B1RevenueRecognitionRequestV1> = {},
): B1RevenueRecognitionRequestV1 => ({
  contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  revenueRecognitionRequestId: 'b1-revenue-recognition-engine-revenue-recognition-req-1',
  revenueRecognitionRequestVersion: 1,
  scopeKey: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  accountingBasis: 'ACCRUAL_BASIS',
  customerId: 'b1-revenue-recognition-engine-customer-1',
  merchantId: 'b1-revenue-recognition-engine-merchant-1',
  partnerId: 'b1-revenue-recognition-engine-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.revenue-recognition',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.revenue-recognition.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey:
    'commercial.virtual-account.inbound-funding.entitlement.revenue-recognition.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.revenue-recognition-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  recognitionPolicyReference: 'commercial.revenue-recognition.policy.v1.standard',
  recognitionPolicyVersion: 1,
  recognitionScheduleReference: 'commercial.revenue-recognition.schedule.v1.standard',
  recognitionScheduleVersion: 1,
  recognitionMethod: 'POINT_IN_TIME',
  recognitionEventReference: 'commercial.revenue-recognition.event.v1.standard',
  recognitionEventVersion: 1,
  deferredRevenueAmount: '100000',
  recognizedRevenueAmount: '100000',
  revenueRecognitionStartAt: '2024-01-01T00:00:00.000Z',
  revenueRecognitionEndAt: '2024-12-31T23:59:59.999Z',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
  promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
  couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
  referralDecisionReference: 'b1-referral-decision:v1:referral:1',
  cashbackDecisionReference: 'b1-referral-decision:v1:cashback:1',
  loyaltyDecisionReference: 'b1-referral-decision:v1:loyalty:1',
  idempotencyKey: 'b'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-revenue-recognition-engine-causation',
  ...overrides,
});

const buildTaxVatRequest = (overrides: Partial<B1TaxVatRequestV1> = {}): B1TaxVatRequestV1 => ({
  contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  taxVatRequestId: 'b1-revenue-recognition-engine-tax-vat-req-1',
  taxVatRequestVersion: 1,
  scopeKey: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  accountingBasis: 'ACCRUAL_BASIS',
  customerId: 'b1-revenue-recognition-engine-customer-1',
  merchantId: 'b1-revenue-recognition-engine-merchant-1',
  partnerId: 'b1-revenue-recognition-engine-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.tax-vat',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.tax-vat.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.tax-vat.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.revenue-recognition-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  taxJurisdiction: 'NIGERIA_FEDERAL',
  taxCategory: 'VAT',
  taxExemptionStatus: 'NOT_EXEMPT',
  taxExemptionReference: 'commercial.tax.exemption.v1.standard',
  taxExemptionVersion: 1,
  taxBaseAmount: '100000',
  taxRate: '750',
  taxVatPolicyReference: 'commercial.tax-vat.policy.v1.standard',
  taxVatPolicyVersion: 1,
  taxEvidenceReference: 'commercial.tax.evidence.v1.standard',
  taxEvidenceVersion: 1,
  taxVatStartAt: '2024-01-01T00:00:00.000Z',
  taxVatEndAt: '2024-12-31T23:59:59.999Z',
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
  idempotencyKey: 'c'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-revenue-recognition-engine-tax-vat-causation',
  ...overrides,
});

const buildCostAccountingRequest = (
  overrides: Partial<B1CostAccountingRequestV1> = {},
): B1CostAccountingRequestV1 => ({
  contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  costAccountingRequestId: 'b1-revenue-recognition-engine-cost-accounting-req-1',
  costAccountingRequestVersion: 1,
  scopeKey: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  accountingBasis: 'ACCRUAL_BASIS',
  customerId: 'b1-revenue-recognition-engine-customer-1',
  merchantId: 'b1-revenue-recognition-engine-merchant-1',
  partnerId: 'b1-revenue-recognition-engine-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.cost-accounting',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.cost-accounting.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey:
    'commercial.virtual-account.inbound-funding.entitlement.cost-accounting.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.revenue-recognition-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  costCategory: 'DIRECT_COST',
  costAllocationMethod: 'DIRECT_ALLOCATION',
  directCostAmount: '10000',
  indirectCostAmount: '5000',
  acquisitionCostAmount: '3000',
  operationalCostAmount: '2000',
  allocatedCostAmount: '1000',
  costAccountingPolicyReference: 'commercial.cost-accounting.policy.v1.standard',
  costAccountingPolicyVersion: 1,
  costAccountingStartAt: '2024-01-01T00:00:00.000Z',
  costAccountingEndAt: '2024-12-31T23:59:59.999Z',
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
  idempotencyKey: 'd'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-revenue-recognition-engine-cost-accounting-causation',
  ...overrides,
});

describe('B1 revenue-recognition engine repository (B1T08)', () => {
  let repository: B1RevenueRecognitionEngineRepository;

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
    repository = new B1RevenueRecognitionEngineRepository(
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
      idempotencyServiceMock as never,
      metricsServiceMock as never,
    );
  });

  it('exposes the B1 revenue-recognition engine contract name and version', () => {
    expect(repository.getContractName()).toBe(B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME);
    expect(repository.getContractVersion()).toBe(1);
  });

  it('exposes the B1 revenue-recognition engine first commercial scope identity', () => {
    expect(repository.getScopeKey()).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY);
    expect(repository.getScopeVersion()).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION);
    expect(repository.getScopeCurrency()).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY);
    expect(repository.getScopeAccountingUnit()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
    );
    expect(repository.getScopeDirection()).toBe('inbound');
    expect(repository.getScopeProductDependency()).toBe('VIRTUAL_ACCOUNT');
    expect(repository.getScopePartnerDependency()).toBe('NIBSS_NIP');
  });

  it('exposes the B1 revenue-recognition engine period identity', () => {
    expect(repository.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.revenue-recognition-period.per-flow.v1',
    );
  });

  it('exposes the B1 revenue-recognition engine audit, outbox, idempotency, and reference prefix', () => {
    expect(repository.getAuditActor()).toBe('b1-revenue-recognition-engine');
    expect(repository.getAuditEntityType()).toBe('B1_REVENUE_RECOGNITION_DECISION');
    expect(repository.getOutboxEventType()).toBe('B1RevenueRecognitionDecisionDecided');
    expect(repository.getRevenueRecognitionIdempotencyScope()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getTaxVatIdempotencyScope()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getCostAccountingIdempotencyScope()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(repository.getReferencePrefix()).toBe('b1-revenue-recognition-decision');
  });

  it('exposes the B1 revenue-recognition engine vocabulary accessors', () => {
    expect(repository.getRevenueRecognitionStates().length).toBe(6);
    expect(repository.getTaxVatStates().length).toBe(7);
    expect(repository.getCostAccountingStates().length).toBe(7);
    expect(repository.getDecisionKinds().length).toBe(3);
    expect(repository.getDecisionOutcomes().length).toBe(4);
    expect(repository.getDocumentKinds().length).toBe(22);
    expect(repository.getRuleKinds().length).toBeGreaterThan(50);
    expect(repository.getRuleOutcomes().length).toBe(4);
    expect(repository.getAccountingBases().length).toBe(4);
    expect(repository.getRecognitionMethods().length).toBe(6);
    expect(repository.getTaxCategories().length).toBe(8);
    expect(repository.getTaxJurisdictions().length).toBe(6);
    expect(repository.getCostCategories().length).toBe(8);
    expect(repository.getCostAllocationMethods().length).toBe(6);
    expect(repository.getClassificationLevels().length).toBe(5);
    expect(repository.getDataControlClassifications().length).toBe(5);
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

  it('generates a B1 revenue-recognition decision for a valid request', () => {
    const record = repository.generateRevenueRecognitionDecision(buildRevenueRecognitionRequest());
    expect(record.revenueRecognitionDecisionState).toBe('RECOGNIZED');
    expect(record.revenueRecognitionDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.revenueRecognitionDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.revenueRecognitionDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.revenueRecognitionRequestHash)).toBe(true);
    expect(record.revenueRecognitionEligible).toBe(true);
    expect(record.revenueRecognitionApplicable).toBe(true);
    expect(record.eligibilitySummary.length).toBe(9);
    expect(record.recognitionTrace.recognitionSteps.length).toBeGreaterThan(0);
  });

  it('produces deterministic B1 revenue-recognition decisions for identical inputs', () => {
    const request = buildRevenueRecognitionRequest();
    const a = repository.generateRevenueRecognitionDecision(request);
    const b = repository.generateRevenueRecognitionDecision(request);
    expect(a.revenueRecognitionDecisionHash).toBe(b.revenueRecognitionDecisionHash);
    expect(a.revenueRecognitionDecisionReplayHash).toBe(b.revenueRecognitionDecisionReplayHash);
    expect(a.revenueRecognitionRequestHash).toBe(b.revenueRecognitionRequestHash);
  });

  it('returns a failure revenue-recognition decision for an invalid contract name', () => {
    const record = repository.generateRevenueRecognitionDecision(
      buildRevenueRecognitionRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure revenue-recognition decision for an invalid scope key', () => {
    const record = repository.generateRevenueRecognitionDecision(
      buildRevenueRecognitionRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(record.failure?.code).toBe(B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure revenue-recognition decision for an invalid product key', () => {
    const record = repository.generateRevenueRecognitionDecision(
      buildRevenueRecognitionRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(record.failure?.code).toBe(B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure revenue-recognition decision for an invalid idempotency key', () => {
    const record = repository.generateRevenueRecognitionDecision(
      buildRevenueRecognitionRequest({ idempotencyKey: 'invalid' }),
    );
    expect(record.failure?.code).toBe(B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 tax / VAT decision for a valid request', () => {
    const record = repository.generateTaxVatDecision(buildTaxVatRequest());
    expect(record.taxVatDecisionState).toBe('ASSESSED');
    expect(record.taxVatDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.taxVatDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.taxVatDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.taxVatRequestHash)).toBe(true);
    expect(record.taxVatEligible).toBe(true);
    expect(record.taxVatApplicable).toBe(true);
    expect(record.taxAmount).toBe('750000');
  });

  it('produces deterministic B1 tax / VAT decisions for identical inputs', () => {
    const request = buildTaxVatRequest();
    const a = repository.generateTaxVatDecision(request);
    const b = repository.generateTaxVatDecision(request);
    expect(a.taxVatDecisionHash).toBe(b.taxVatDecisionHash);
    expect(a.taxVatDecisionReplayHash).toBe(b.taxVatDecisionReplayHash);
    expect(a.taxVatRequestHash).toBe(b.taxVatRequestHash);
  });

  it('returns a failure tax / VAT decision for an invalid tax / VAT request', () => {
    const record = repository.generateTaxVatDecision(
      buildTaxVatRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 cost-accounting decision for a valid request', () => {
    const record = repository.generateCostAccountingDecision(buildCostAccountingRequest());
    expect(record.costAccountingDecisionState).toBe('ALLOCATED');
    expect(record.costAccountingDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.costAccountingDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.costAccountingDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.costAccountingRequestHash)).toBe(true);
    expect(record.costAccountingEligible).toBe(true);
    expect(record.costAccountingApplicable).toBe(true);
    expect(record.totalCostAmount).toBe('21000');
  });

  it('produces deterministic B1 cost-accounting decisions for identical inputs', () => {
    const request = buildCostAccountingRequest();
    const a = repository.generateCostAccountingDecision(request);
    const b = repository.generateCostAccountingDecision(request);
    expect(a.costAccountingDecisionHash).toBe(b.costAccountingDecisionHash);
    expect(a.costAccountingDecisionReplayHash).toBe(b.costAccountingDecisionReplayHash);
    expect(a.costAccountingRequestHash).toBe(b.costAccountingRequestHash);
  });

  it('returns a failure cost-accounting decision for an invalid cost-accounting request', () => {
    const record = repository.generateCostAccountingDecision(
      buildCostAccountingRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('runs a B1 revenue-recognition engine compatibility check', () => {
    const compatibility = repository.compatibilityCheck(buildRevenueRecognitionRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('returns a compatibility mismatch for an invalid scope key', () => {
    const compatibility = repository.compatibilityCheck(
      buildRevenueRecognitionRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(compatibility.compatible).toBe(false);
    if (!compatibility.compatible) {
      expect(compatibility.code).toBe(B1_REVENUE_RECOGNITION_ENGINE_FAILURE_INCOMPATIBLE);
    }
  });

  it('returns a compatibility mismatch for an invalid product key', () => {
    const compatibility = repository.compatibilityCheck(
      buildRevenueRecognitionRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns the B1 revenue-recognition engine versioning contract', () => {
    const versioning = repository.getVersioningContract();
    expect(versioning.contractName).toBe(B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY);
  });

  it('exposes the B1 revenue-recognition engine consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const evaluated = await ports.generateRevenueRecognitionDecision(
      buildRevenueRecognitionRequest(),
    );
    expect(evaluated.revenueRecognitionDecisionState).toBe('RECOGNIZED');
  });

  it('runs a replay-safe generate revenue-recognition decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateRevenueRecognitionDecision(
      buildRevenueRecognitionRequest(),
    );
    expect(result.record.revenueRecognitionDecisionState).toBe('RECOGNIZED');
    expect(SHA256_RE.test(result.revenueRecognitionRequestHash)).toBe(true);
    expect(SHA256_RE.test(result.revenueRecognitionDecisionHash)).toBe(true);
    expect(SHA256_RE.test(result.revenueRecognitionDecisionReplayHash)).toBe(true);
  });

  it('runs a replay-safe generate tax / VAT decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateTaxVatDecision(buildTaxVatRequest());
    expect(result.record.taxVatDecisionState).toBe('ASSESSED');
  });

  it('runs a replay-safe generate cost-accounting decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCostAccountingDecision(
      buildCostAccountingRequest(),
    );
    expect(result.record.costAccountingDecisionState).toBe('ALLOCATED');
  });

  it('runs a compatibility check via consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.compatibilityCheck(buildRevenueRecognitionRequest());
    expect(result.compatible).toBe(true);
  });
});
