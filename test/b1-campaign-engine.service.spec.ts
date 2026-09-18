import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1CampaignEngineRepository } from '../src/policy/b1-campaign-engine.repository';
import { B1CampaignEngineService } from '../src/policy/b1-campaign-engine.service';
import {
  B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
  B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE,
  B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_REFERENCE_PREFIX,
  B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  B1_CAMPAIGN_ENGINE_SCOPE_DIRECTION,
  B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  B1_CAMPAIGN_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-campaign-engine.constants';
import type {
  B1CampaignRequestV1,
  B1CouponRequestV1,
  B1PromotionRequestV1,
} from '../src/policy/b1-campaign-engine.types';
import type { RequestContext } from '../src/production/request-context';

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-campaign-engine-svc-req',
  correlationId: 'b1-campaign-engine-svc-corr',
  traceId: 'b1-campaign-engine-svc-trace',
});

const buildCampaignRequest = (): B1CampaignRequestV1 => ({
  contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  campaignRequestId: 'b1-campaign-engine-svc-campaign-req-1',
  campaignRequestVersion: 1,
  scopeKey: B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  scopeVersion: B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-campaign-engine-svc-customer-1',
  merchantId: 'b1-campaign-engine-svc-merchant-1',
  partnerId: 'b1-campaign-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.campaign',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.campaign.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.campaign.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.campaign-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  campaignKey: 'commercial.virtual-account.inbound-funding.campaign.v1.campaign.welcome',
  campaignVersion: 1,
  campaignStartAt: '2024-01-01T00:00:00.000Z',
  campaignEndAt: '2024-12-31T23:59:59.999Z',
  usageLimitPerCustomer: 1,
  usageLimitPerCampaign: 1000,
  campaignStackableRequest: true,
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  idempotencyKey: 'b'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-campaign-engine-svc-causation',
});

const buildPromotionRequest = (): B1PromotionRequestV1 => ({
  contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  promotionRequestId: 'b1-campaign-engine-svc-promotion-req-1',
  promotionRequestVersion: 1,
  scopeKey: B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  scopeVersion: B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-campaign-engine-svc-customer-1',
  merchantId: 'b1-campaign-engine-svc-merchant-1',
  partnerId: 'b1-campaign-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.promotion',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.campaign.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.campaign.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.campaign-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  promotionKey: 'commercial.virtual-account.inbound-funding.campaign.v1.promotion.welcome',
  promotionVersion: 1,
  promotionStartAt: '2024-01-01T00:00:00.000Z',
  promotionEndAt: '2024-12-31T23:59:59.999Z',
  usageLimitPerCustomer: 1,
  usageLimitPerPromotion: 1000,
  promotionStackableRequest: true,
  campaignDecisionReference: 'b1-campaign-decision:v1:1',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  idempotencyKey: 'c'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-campaign-engine-svc-promotion-causation',
});

const buildCouponRequest = (): B1CouponRequestV1 => ({
  contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  couponRequestId: 'b1-campaign-engine-svc-coupon-req-1',
  couponRequestVersion: 1,
  scopeKey: B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  scopeVersion: B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-campaign-engine-svc-customer-1',
  merchantId: 'b1-campaign-engine-svc-merchant-1',
  partnerId: 'b1-campaign-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.coupon',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.campaign.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.campaign.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.campaign-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  couponCode: 'WELCOME2024',
  couponKey: 'commercial.virtual-account.inbound-funding.campaign.v1.coupon.welcome',
  couponVersion: 1,
  couponStartAt: '2024-01-01T00:00:00.000Z',
  couponEndAt: '2024-12-31T23:59:59.999Z',
  usageLimitPerCustomer: 1,
  usageLimitPerCoupon: 500,
  couponStackableRequest: false,
  promotionDecisionReference: 'b1-promotion-decision:v1:1',
  campaignDecisionReference: 'b1-campaign-decision:v1:1',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  idempotencyKey: 'd'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-campaign-engine-svc-coupon-causation',
});

describe('B1 campaign engine service (B1T06)', () => {
  let repository: B1CampaignEngineRepository;
  let service: B1CampaignEngineService;

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
    repository = new B1CampaignEngineRepository(
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
      {} as never,
      {} as never,
      idempotencyServiceMock as never,
      metricsServiceMock as never,
    );
    service = new B1CampaignEngineService(repository);
  });

  it('exposes the B1 campaign engine contract name and version', () => {
    expect(service.getContractName()).toBe(B1_CAMPAIGN_ENGINE_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(B1_CAMPAIGN_ENGINE_CONTRACT_VERSION);
  });

  it('exposes the B1 campaign engine first commercial scope identity', () => {
    expect(service.getScopeKey()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_KEY);
    expect(service.getScopeVersion()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_VERSION);
    expect(service.getScopeCurrency()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY);
    expect(service.getScopeAccountingUnit()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT);
    expect(service.getScopeDirection()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_DIRECTION);
    expect(service.getScopeProductDependency()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_PRODUCT_DEPENDENCY);
    expect(service.getScopePartnerDependency()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_PARTNER_DEPENDENCY);
  });

  it('exposes the B1 campaign engine period identity', () => {
    expect(service.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.campaign-period.per-flow.v1',
    );
  });

  it('exposes the B1 campaign engine audit, outbox, idempotency, and reference prefix', () => {
    expect(service.getAuditActor()).toBe('b1-campaign-engine');
    expect(service.getAuditEntityType()).toBe('B1_CAMPAIGN_DECISION');
    expect(service.getOutboxEventType()).toBe(B1_CAMPAIGN_ENGINE_OUTBOX_EVENT_TYPE);
    expect(service.getCampaignIdempotencyScope()).toBe(
      B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
    );
    expect(service.getPromotionIdempotencyScope()).toBe(
      B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
    );
    expect(service.getCouponIdempotencyScope()).toBe(B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE);
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getReferencePrefix()).toBe(B1_CAMPAIGN_ENGINE_REFERENCE_PREFIX);
  });

  it('exposes the B1 campaign engine vocabulary accessors', () => {
    expect(service.getCampaignStates().length).toBe(5);
    expect(service.getPromotionStates().length).toBe(4);
    expect(service.getCouponStates().length).toBe(5);
    expect(service.getDecisionKinds().length).toBe(3);
    expect(service.getDecisionOutcomes().length).toBe(4);
    expect(service.getDocumentKinds().length).toBe(9);
    expect(service.getRuleKinds().length).toBeGreaterThan(30);
    expect(service.getRuleOutcomes().length).toBe(4);
    expect(service.getPriorities().length).toBe(4);
    expect(service.getStackingRules().length).toBe(3);
    expect(service.getEligibilities().length).toBe(7);
    expect(service.getClassificationLevels().length).toBe(5);
    expect(service.getDataControlClassifications().length).toBe(5);
    expect(service.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(service.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(service.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(service.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(service.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(service.getFailureCodes().length).toBe(22);
    expect(service.getMetrics().length).toBeGreaterThan(20);
    expect(service.getRetentionDays()).toBe(365);
  });

  it('exposes the B1 campaign engine consumer ports', () => {
    const ports = service.getConsumerPorts();
    expect(typeof ports.generateCampaignDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCampaignDecision).toBe('function');
    expect(typeof ports.generatePromotionDecision).toBe('function');
    expect(typeof ports.replaySafeGeneratePromotionDecision).toBe('function');
    expect(typeof ports.generateCouponDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCouponDecision).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('runs a B1 campaign decision generate', () => {
    const record = service.generateCampaignDecision(buildCampaignRequest());
    expect(record.campaignDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 promotion decision generate', () => {
    const record = service.generatePromotionDecision(buildPromotionRequest());
    expect(record.promotionDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 coupon decision generate', () => {
    const record = service.generateCouponDecision(buildCouponRequest());
    expect(record.couponDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 campaign engine compatibility check', () => {
    const compatibility = service.compatibilityCheck(buildCampaignRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('runs a B1 campaign decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateCampaignDecision(buildCampaignRequest());
    expect(result.record.campaignDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 promotion decision replay-safe generate', async () => {
    const result = await service.replaySafeGeneratePromotionDecision(buildPromotionRequest());
    expect(result.record.promotionDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 coupon decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateCouponDecision(buildCouponRequest());
    expect(result.record.couponDecisionState).toBe('ACTIVE');
  });

  it('returns the B1 campaign engine versioning contract', () => {
    const versioning = service.getVersioningContract();
    expect(versioning.contractName).toBe(B1_CAMPAIGN_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_CAMPAIGN_ENGINE_SCOPE_KEY);
  });
});
