import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1RevenueRecognitionEngineRepository } from '../src/policy/b1-revenue-recognition-engine.repository';
import { B1RevenueRecognitionEngineService } from '../src/policy/b1-revenue-recognition-engine.service';
import {
  B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
  B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE,
  B1_REVENUE_RECOGNITION_ENGINE_REFERENCE_PREFIX,
  B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_DIRECTION,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
} from '../src/policy/b1-revenue-recognition-engine.constants';
import type {
  B1CostAccountingRequestV1,
  B1RevenueRecognitionRequestV1,
  B1TaxVatRequestV1,
} from '../src/policy/b1-revenue-recognition-engine.types';
import type { RequestContext } from '../src/production/request-context';

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-revenue-recognition-engine-svc-req',
  correlationId: 'b1-revenue-recognition-engine-svc-corr',
  traceId: 'b1-revenue-recognition-engine-svc-trace',
});

const buildRevenueRecognitionRequest = (): B1RevenueRecognitionRequestV1 => ({
  contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  revenueRecognitionRequestId: 'b1-revenue-recognition-engine-svc-revenue-recognition-req-1',
  revenueRecognitionRequestVersion: 1,
  scopeKey: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  accountingBasis: 'ACCRUAL_BASIS',
  customerId: 'b1-revenue-recognition-engine-svc-customer-1',
  merchantId: 'b1-revenue-recognition-engine-svc-merchant-1',
  partnerId: 'b1-revenue-recognition-engine-svc-partner-1',
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
  causationId: 'b1-revenue-recognition-engine-svc-causation',
});

const buildTaxVatRequest = (): B1TaxVatRequestV1 => ({
  contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  taxVatRequestId: 'b1-revenue-recognition-engine-svc-tax-vat-req-1',
  taxVatRequestVersion: 1,
  scopeKey: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  accountingBasis: 'ACCRUAL_BASIS',
  customerId: 'b1-revenue-recognition-engine-svc-customer-1',
  merchantId: 'b1-revenue-recognition-engine-svc-merchant-1',
  partnerId: 'b1-revenue-recognition-engine-svc-partner-1',
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
  causationId: 'b1-revenue-recognition-engine-svc-tax-vat-causation',
});

const buildCostAccountingRequest = (): B1CostAccountingRequestV1 => ({
  contractName: B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  costAccountingRequestId: 'b1-revenue-recognition-engine-svc-cost-accounting-req-1',
  costAccountingRequestVersion: 1,
  scopeKey: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
  accountingBasis: 'ACCRUAL_BASIS',
  customerId: 'b1-revenue-recognition-engine-svc-customer-1',
  merchantId: 'b1-revenue-recognition-engine-svc-merchant-1',
  partnerId: 'b1-revenue-recognition-engine-svc-partner-1',
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
  causationId: 'b1-revenue-recognition-engine-svc-cost-accounting-causation',
});

describe('B1 revenue-recognition engine service (B1T08)', () => {
  let repository: B1RevenueRecognitionEngineRepository;
  let service: B1RevenueRecognitionEngineService;

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
    service = new B1RevenueRecognitionEngineService(repository);
  });

  it('exposes the B1 revenue-recognition engine contract name and version', () => {
    expect(service.getContractName()).toBe(B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(1);
  });

  it('exposes the B1 revenue-recognition engine first commercial scope identity', () => {
    expect(service.getScopeKey()).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY);
    expect(service.getScopeVersion()).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_VERSION);
    expect(service.getScopeCurrency()).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_CURRENCY);
    expect(service.getScopeAccountingUnit()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_SCOPE_ACCOUNTING_UNIT,
    );
    expect(service.getScopeDirection()).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_DIRECTION);
    expect(service.getScopeProductDependency()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
    );
    expect(service.getScopePartnerDependency()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_SCOPE_PARTNER_DEPENDENCY,
    );
  });

  it('exposes the B1 revenue-recognition engine period identity', () => {
    expect(service.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.revenue-recognition-period.per-flow.v1',
    );
  });

  it('exposes the B1 revenue-recognition engine audit, outbox, idempotency, and reference prefix', () => {
    expect(service.getAuditActor()).toBe('b1-revenue-recognition-engine');
    expect(service.getAuditEntityType()).toBe('B1_REVENUE_RECOGNITION_DECISION');
    expect(service.getOutboxEventType()).toBe(B1_REVENUE_RECOGNITION_ENGINE_OUTBOX_EVENT_TYPE);
    expect(service.getRevenueRecognitionIdempotencyScope()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_REVENUE_RECOGNITION_IDEMPOTENCY_SCOPE,
    );
    expect(service.getTaxVatIdempotencyScope()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_TAX_VAT_IDEMPOTENCY_SCOPE,
    );
    expect(service.getCostAccountingIdempotencyScope()).toBe(
      B1_REVENUE_RECOGNITION_ENGINE_COST_ACCOUNTING_IDEMPOTENCY_SCOPE,
    );
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getReferencePrefix()).toBe(B1_REVENUE_RECOGNITION_ENGINE_REFERENCE_PREFIX);
  });

  it('exposes the B1 revenue-recognition engine vocabulary accessors', () => {
    expect(service.getRevenueRecognitionStates().length).toBe(6);
    expect(service.getTaxVatStates().length).toBe(7);
    expect(service.getCostAccountingStates().length).toBe(7);
    expect(service.getDecisionKinds().length).toBe(3);
    expect(service.getDecisionOutcomes().length).toBe(4);
    expect(service.getDocumentKinds().length).toBe(22);
    expect(service.getRuleKinds().length).toBeGreaterThan(50);
    expect(service.getRuleOutcomes().length).toBe(4);
    expect(service.getAccountingBases().length).toBe(4);
    expect(service.getRecognitionMethods().length).toBe(6);
    expect(service.getTaxCategories().length).toBe(8);
    expect(service.getTaxJurisdictions().length).toBe(6);
    expect(service.getCostCategories().length).toBe(8);
    expect(service.getCostAllocationMethods().length).toBe(6);
    expect(service.getClassificationLevels().length).toBe(5);
    expect(service.getDataControlClassifications().length).toBe(5);
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

  it('exposes the B1 revenue-recognition engine consumer ports', () => {
    const ports = service.getConsumerPorts();
    expect(typeof ports.generateRevenueRecognitionDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateRevenueRecognitionDecision).toBe('function');
    expect(typeof ports.generateTaxVatDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateTaxVatDecision).toBe('function');
    expect(typeof ports.generateCostAccountingDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCostAccountingDecision).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('runs a B1 revenue-recognition decision generate', () => {
    const record = service.generateRevenueRecognitionDecision(buildRevenueRecognitionRequest());
    expect(record.revenueRecognitionDecisionState).toBe('RECOGNIZED');
  });

  it('runs a B1 tax / VAT decision generate', () => {
    const record = service.generateTaxVatDecision(buildTaxVatRequest());
    expect(record.taxVatDecisionState).toBe('ASSESSED');
  });

  it('runs a B1 cost-accounting decision generate', () => {
    const record = service.generateCostAccountingDecision(buildCostAccountingRequest());
    expect(record.costAccountingDecisionState).toBe('ALLOCATED');
  });

  it('runs a B1 revenue-recognition engine compatibility check', () => {
    const compatibility = service.compatibilityCheck(buildRevenueRecognitionRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('runs a B1 revenue-recognition decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateRevenueRecognitionDecision(
      buildRevenueRecognitionRequest(),
    );
    expect(result.record.revenueRecognitionDecisionState).toBe('RECOGNIZED');
  });

  it('runs a B1 tax / VAT decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateTaxVatDecision(buildTaxVatRequest());
    expect(result.record.taxVatDecisionState).toBe('ASSESSED');
  });

  it('runs a B1 cost-accounting decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateCostAccountingDecision(
      buildCostAccountingRequest(),
    );
    expect(result.record.costAccountingDecisionState).toBe('ALLOCATED');
  });

  it('returns the B1 revenue-recognition engine versioning contract', () => {
    const versioning = service.getVersioningContract();
    expect(versioning.contractName).toBe(B1_REVENUE_RECOGNITION_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_REVENUE_RECOGNITION_ENGINE_SCOPE_KEY);
  });
});
