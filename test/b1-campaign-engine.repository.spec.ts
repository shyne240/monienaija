import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1CampaignEngineRepository } from '../src/policy/b1-campaign-engine.repository';
import {
  B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  B1_CAMPAIGN_ENGINE_CONTRACT_VERSION,
  B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_FAILURE_INCOMPATIBLE,
  B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND,
  B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
  B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-campaign-engine.constants';
import type {
  B1CampaignRequestV1,
  B1CouponRequestV1,
  B1PromotionRequestV1,
} from '../src/policy/b1-campaign-engine.types';
import type { RequestContext } from '../src/production/request-context';

const SHA256_RE = /^[a-f0-9]{64}$/;

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-campaign-engine-req',
  correlationId: 'b1-campaign-engine-corr',
  traceId: 'b1-campaign-engine-trace',
});

const buildCampaignRequest = (
  overrides: Partial<B1CampaignRequestV1> = {},
): B1CampaignRequestV1 => ({
  contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  campaignRequestId: 'b1-campaign-engine-campaign-req-1',
  campaignRequestVersion: 1,
  scopeKey: B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  scopeVersion: B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-campaign-engine-customer-1',
  merchantId: 'b1-campaign-engine-merchant-1',
  partnerId: 'b1-campaign-engine-partner-1',
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
  causationId: 'b1-campaign-engine-causation',
  ...overrides,
});

const buildPromotionRequest = (
  overrides: Partial<B1PromotionRequestV1> = {},
): B1PromotionRequestV1 => ({
  contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  promotionRequestId: 'b1-campaign-engine-promotion-req-1',
  promotionRequestVersion: 1,
  scopeKey: B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  scopeVersion: B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-campaign-engine-customer-1',
  merchantId: 'b1-campaign-engine-merchant-1',
  partnerId: 'b1-campaign-engine-partner-1',
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
  causationId: 'b1-campaign-engine-promotion-causation',
  ...overrides,
});

const buildCouponRequest = (overrides: Partial<B1CouponRequestV1> = {}): B1CouponRequestV1 => ({
  contractName: B1_CAMPAIGN_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  couponRequestId: 'b1-campaign-engine-coupon-req-1',
  couponRequestVersion: 1,
  scopeKey: B1_CAMPAIGN_ENGINE_SCOPE_KEY,
  scopeVersion: B1_CAMPAIGN_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-campaign-engine-customer-1',
  merchantId: 'b1-campaign-engine-merchant-1',
  partnerId: 'b1-campaign-engine-partner-1',
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
  causationId: 'b1-campaign-engine-coupon-causation',
  ...overrides,
});

describe('B1 campaign engine repository (B1T06)', () => {
  let repository: B1CampaignEngineRepository;

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
  });

  it('exposes the B1 campaign engine contract name and version', () => {
    expect(repository.getContractName()).toBe(B1_CAMPAIGN_ENGINE_CONTRACT_NAME);
    expect(repository.getContractVersion()).toBe(B1_CAMPAIGN_ENGINE_CONTRACT_VERSION);
  });

  it('exposes the B1 campaign engine first commercial scope identity', () => {
    expect(repository.getScopeKey()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_KEY);
    expect(repository.getScopeVersion()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_VERSION);
    expect(repository.getScopeCurrency()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_CURRENCY);
    expect(repository.getScopeAccountingUnit()).toBe(B1_CAMPAIGN_ENGINE_SCOPE_ACCOUNTING_UNIT);
    expect(repository.getScopeDirection()).toBe('inbound');
    expect(repository.getScopeProductDependency()).toBe('VIRTUAL_ACCOUNT');
    expect(repository.getScopePartnerDependency()).toBe('NIBSS_NIP');
  });

  it('exposes the B1 campaign engine period identity', () => {
    expect(repository.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.campaign-period.per-flow.v1',
    );
  });

  it('exposes the B1 campaign engine audit, outbox, idempotency, and reference prefix', () => {
    expect(repository.getAuditActor()).toBe('b1-campaign-engine');
    expect(repository.getAuditEntityType()).toBe('B1_CAMPAIGN_DECISION');
    expect(repository.getOutboxEventType()).toBe('B1CampaignDecisionDecided');
    expect(repository.getCampaignIdempotencyScope()).toBe(
      B1_CAMPAIGN_ENGINE_CAMPAIGN_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getPromotionIdempotencyScope()).toBe(
      B1_CAMPAIGN_ENGINE_PROMOTION_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getCouponIdempotencyScope()).toBe(
      B1_CAMPAIGN_ENGINE_COUPON_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(repository.getReferencePrefix()).toBe('b1-campaign-decision');
  });

  it('exposes the B1 campaign engine vocabulary accessors', () => {
    expect(repository.getCampaignStates().length).toBe(5);
    expect(repository.getPromotionStates().length).toBe(4);
    expect(repository.getCouponStates().length).toBe(5);
    expect(repository.getDecisionKinds().length).toBe(3);
    expect(repository.getDecisionOutcomes().length).toBe(4);
    expect(repository.getDocumentKinds().length).toBe(9);
    expect(repository.getRuleKinds().length).toBeGreaterThan(30);
    expect(repository.getRuleOutcomes().length).toBe(4);
    expect(repository.getPriorities().length).toBe(4);
    expect(repository.getStackingRules().length).toBe(3);
    expect(repository.getEligibilities().length).toBe(7);
    expect(repository.getClassificationLevels().length).toBe(5);
    expect(repository.getDataControlClassifications().length).toBe(5);
    expect(repository.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(repository.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(repository.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(repository.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(repository.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(repository.getFailureCodes().length).toBe(22);
    expect(repository.getMetrics().length).toBeGreaterThan(20);
    expect(repository.getRetentionDays()).toBe(365);
  });

  it('generates a B1 campaign decision for a valid request', () => {
    const record = repository.generateCampaignDecision(buildCampaignRequest());
    expect(record.campaignDecisionState).toBe('ACTIVE');
    expect(record.campaignDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.campaignDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.campaignDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.campaignRequestHash)).toBe(true);
    expect(record.campaignEligible).toBe(true);
    expect(record.campaignApplicable).toBe(true);
    expect(record.eligibilitySummary.length).toBe(7);
  });

  it('produces deterministic B1 campaign decisions for identical inputs', () => {
    const request = buildCampaignRequest();
    const a = repository.generateCampaignDecision(request);
    const b = repository.generateCampaignDecision(request);
    expect(a.campaignDecisionHash).toBe(b.campaignDecisionHash);
    expect(a.campaignDecisionReplayHash).toBe(b.campaignDecisionReplayHash);
    expect(a.campaignRequestHash).toBe(b.campaignRequestHash);
  });

  it('returns a failure campaign decision for an invalid contract name', () => {
    const record = repository.generateCampaignDecision(
      buildCampaignRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure campaign decision for an invalid scope key', () => {
    const record = repository.generateCampaignDecision(
      buildCampaignRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(record.failure?.code).toBe(B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure campaign decision for an invalid product key', () => {
    const record = repository.generateCampaignDecision(
      buildCampaignRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(record.failure?.code).toBe(B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure campaign decision for an invalid idempotency key', () => {
    const record = repository.generateCampaignDecision(
      buildCampaignRequest({ idempotencyKey: 'invalid' }),
    );
    expect(record.failure?.code).toBe(B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 promotion decision for a valid request', () => {
    const record = repository.generatePromotionDecision(buildPromotionRequest());
    expect(record.promotionDecisionState).toBe('ACTIVE');
    expect(record.promotionDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.promotionDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.promotionDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.promotionRequestHash)).toBe(true);
    expect(record.promotionEligible).toBe(true);
    expect(record.promotionApplicable).toBe(true);
  });

  it('produces deterministic B1 promotion decisions for identical inputs', () => {
    const request = buildPromotionRequest();
    const a = repository.generatePromotionDecision(request);
    const b = repository.generatePromotionDecision(request);
    expect(a.promotionDecisionHash).toBe(b.promotionDecisionHash);
    expect(a.promotionDecisionReplayHash).toBe(b.promotionDecisionReplayHash);
    expect(a.promotionRequestHash).toBe(b.promotionRequestHash);
  });

  it('returns a failure promotion decision for an invalid promotion request', () => {
    const record = repository.generatePromotionDecision(
      buildPromotionRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 coupon decision for a valid request', () => {
    const record = repository.generateCouponDecision(buildCouponRequest());
    expect(record.couponDecisionState).toBe('ACTIVE');
    expect(record.couponDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.couponDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.couponDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.couponRequestHash)).toBe(true);
    expect(record.couponEligible).toBe(true);
    expect(record.couponApplicable).toBe(true);
  });

  it('produces deterministic B1 coupon decisions for identical inputs', () => {
    const request = buildCouponRequest();
    const a = repository.generateCouponDecision(request);
    const b = repository.generateCouponDecision(request);
    expect(a.couponDecisionHash).toBe(b.couponDecisionHash);
    expect(a.couponDecisionReplayHash).toBe(b.couponDecisionReplayHash);
    expect(a.couponRequestHash).toBe(b.couponRequestHash);
  });

  it('returns a failure coupon decision for an invalid coupon request', () => {
    const record = repository.generateCouponDecision(
      buildCouponRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_CAMPAIGN_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('runs a B1 campaign engine compatibility check', () => {
    const compatibility = repository.compatibilityCheck(buildCampaignRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('returns a compatibility mismatch for an invalid scope key', () => {
    const compatibility = repository.compatibilityCheck(
      buildCampaignRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(compatibility.compatible).toBe(false);
    if (!compatibility.compatible) {
      expect(compatibility.code).toBe(B1_CAMPAIGN_ENGINE_FAILURE_INCOMPATIBLE);
    }
  });

  it('returns a compatibility mismatch for an invalid product key', () => {
    const compatibility = repository.compatibilityCheck(
      buildCampaignRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns the B1 campaign engine versioning contract', () => {
    const versioning = repository.getVersioningContract();
    expect(versioning.contractName).toBe(B1_CAMPAIGN_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_CAMPAIGN_ENGINE_SCOPE_KEY);
  });

  it('exposes the B1 campaign engine consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const evaluated = await ports.generateCampaignDecision(buildCampaignRequest());
    expect(evaluated.campaignDecisionState).toBe('ACTIVE');
  });

  it('runs a replay-safe generate campaign decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCampaignDecision(buildCampaignRequest());
    expect(result.record.campaignDecisionState).toBe('ACTIVE');
    expect(SHA256_RE.test(result.campaignRequestHash)).toBe(true);
    expect(SHA256_RE.test(result.campaignDecisionHash)).toBe(true);
    expect(SHA256_RE.test(result.campaignDecisionReplayHash)).toBe(true);
  });

  it('runs a replay-safe generate promotion decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGeneratePromotionDecision(buildPromotionRequest());
    expect(result.record.promotionDecisionState).toBe('ACTIVE');
  });

  it('runs a replay-safe generate coupon decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCouponDecision(buildCouponRequest());
    expect(result.record.couponDecisionState).toBe('ACTIVE');
  });

  it('runs a compatibility check via consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.compatibilityCheck(buildCampaignRequest());
    expect(result.compatible).toBe(true);
  });
});
