import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1ReferralEngineRepository } from '../src/policy/b1-referral-engine.repository';
import { B1ReferralEngineService } from '../src/policy/b1-referral-engine.service';
import {
  B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_CONTRACT_NAME,
  B1_REFERRAL_ENGINE_CONTRACT_VERSION,
  B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE,
  B1_REFERRAL_ENGINE_REFERENCE_PREFIX,
  B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  B1_REFERRAL_ENGINE_SCOPE_DIRECTION,
  B1_REFERRAL_ENGINE_SCOPE_KEY,
  B1_REFERRAL_ENGINE_SCOPE_PARTNER_DEPENDENCY,
  B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY,
  B1_REFERRAL_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-referral-engine.constants';
import type {
  B1CashbackRequestV1,
  B1LoyaltyEarningRequestV1,
  B1ReferralRequestV1,
} from '../src/policy/b1-referral-engine.types';
import type { RequestContext } from '../src/production/request-context';

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-referral-engine-svc-req',
  correlationId: 'b1-referral-engine-svc-corr',
  traceId: 'b1-referral-engine-svc-trace',
});

const buildReferralRequest = (): B1ReferralRequestV1 => ({
  contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  referralRequestId: 'b1-referral-engine-svc-referral-req-1',
  referralRequestVersion: 1,
  scopeKey: B1_REFERRAL_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REFERRAL_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-referral-engine-svc-customer-1',
  merchantId: 'b1-referral-engine-svc-merchant-1',
  partnerId: 'b1-referral-engine-svc-partner-1',
  refereeCustomerId: 'b1-referral-engine-svc-referee-1',
  sponsorCustomerId: 'b1-referral-engine-svc-sponsor-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.referral',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.referral.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.referral.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.referral-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  referralCampaignKey: 'commercial.virtual-account.inbound-funding.referral.v1.campaign.welcome',
  referralCampaignVersion: 1,
  referralProgramKey: 'commercial.virtual-account.inbound-funding.referral.v1.program.standard',
  referralProgramVersion: 1,
  referralKey: 'commercial.virtual-account.inbound-funding.referral.v1.referral.welcome',
  referralVersion: 1,
  referralStartAt: '2024-01-01T00:00:00.000Z',
  referralEndAt: '2024-12-31T23:59:59.999Z',
  relationshipType: 'SPONSOR',
  hierarchyPath: ['root'],
  hierarchyDepth: 1,
  qualificationStatus: 'QUALIFIED',
  referralUsageLimitPerReferrer: 5,
  referralUsageLimitPerCampaign: 1000,
  campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
  promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
  couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  idempotencyKey: 'b'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-referral-engine-svc-causation',
});

const buildCashbackRequest = (): B1CashbackRequestV1 => ({
  contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  cashbackRequestId: 'b1-referral-engine-svc-cashback-req-1',
  cashbackRequestVersion: 1,
  scopeKey: B1_REFERRAL_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REFERRAL_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-referral-engine-svc-customer-1',
  merchantId: 'b1-referral-engine-svc-merchant-1',
  partnerId: 'b1-referral-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.cashback',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.cashback.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.cashback.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.referral-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  cashbackCampaignKey: 'commercial.virtual-account.inbound-funding.cashback.v1.campaign.welcome',
  cashbackCampaignVersion: 1,
  cashbackKey: 'commercial.virtual-account.inbound-funding.cashback.v1.cashback.welcome',
  cashbackVersion: 1,
  cashbackStartAt: '2024-01-01T00:00:00.000Z',
  cashbackEndAt: '2024-12-31T23:59:59.999Z',
  cashbackCalculationBasis: 'PERCENTAGE_OF_BILLING',
  cashbackCalculationRate: '500',
  cashbackCalculationBase: '10000',
  usageLimitPerCustomer: 1,
  usageLimitPerCampaign: 1000,
  campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
  promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
  couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  idempotencyKey: 'c'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-referral-engine-svc-cashback-causation',
});

const buildLoyaltyRequest = (): B1LoyaltyEarningRequestV1 => ({
  contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  loyaltyRequestId: 'b1-referral-engine-svc-loyalty-req-1',
  loyaltyRequestVersion: 1,
  scopeKey: B1_REFERRAL_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REFERRAL_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-referral-engine-svc-customer-1',
  merchantId: 'b1-referral-engine-svc-merchant-1',
  partnerId: 'b1-referral-engine-svc-partner-1',
  productKey: 'VIRTUAL_ACCOUNT',
  productVersion: 1,
  capabilityKey: 'commercial.virtual-account.inbound-funding.loyalty',
  capabilityVersion: 1,
  planKey: 'commercial.virtual-account.inbound-funding.loyalty.v1.plan.standard',
  planVersion: 1,
  customerTierKey: 'commercial.customer.tier.standard.v1',
  customerTierVersion: 1,
  merchantTierKey: 'commercial.merchant.tier.standard.v1',
  merchantTierVersion: 1,
  partnerTierKey: 'commercial.partner.tier.standard.v1',
  partnerTierVersion: 1,
  productEntitlementKey: 'commercial.virtual-account.inbound-funding.entitlement.loyalty.v1',
  productEntitlementVersion: 1,
  subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
  subscriptionVersion: 1,
  periodKey: 'commercial.virtual-account.inbound-funding.referral-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
  loyaltyProgramKey: 'commercial.virtual-account.inbound-funding.loyalty.v1.program.standard',
  loyaltyProgramVersion: 1,
  loyaltyTierKey: 'commercial.virtual-account.inbound-funding.loyalty.v1.tier.bronze',
  loyaltyTierVersion: 1,
  loyaltyPointPolicyKey: 'commercial.virtual-account.inbound-funding.loyalty.v1.policy.standard',
  loyaltyPointPolicyVersion: 1,
  loyaltyEarningSource: 'BILLING',
  loyaltyEarningBase: '10000',
  loyaltyEarningRate: '100',
  usageLimitPerCustomer: 1,
  usageLimitPerProgram: 1000,
  campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
  promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
  couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
  commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
  commercialDecisionIdempotencyKey: 'a'.repeat(64),
  billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
  idempotencyKey: 'd'.repeat(64),
  requestContext: buildRequestContext(),
  causationId: 'b1-referral-engine-svc-loyalty-causation',
});

describe('B1 referral engine service (B1T07)', () => {
  let repository: B1ReferralEngineRepository;
  let service: B1ReferralEngineService;

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
    repository = new B1ReferralEngineRepository(
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
      {} as never,
      idempotencyServiceMock as never,
      metricsServiceMock as never,
    );
    service = new B1ReferralEngineService(repository);
  });

  it('exposes the B1 referral engine contract name and version', () => {
    expect(service.getContractName()).toBe(B1_REFERRAL_ENGINE_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(B1_REFERRAL_ENGINE_CONTRACT_VERSION);
  });

  it('exposes the B1 referral engine first commercial scope identity', () => {
    expect(service.getScopeKey()).toBe(B1_REFERRAL_ENGINE_SCOPE_KEY);
    expect(service.getScopeVersion()).toBe(B1_REFERRAL_ENGINE_SCOPE_VERSION);
    expect(service.getScopeCurrency()).toBe(B1_REFERRAL_ENGINE_SCOPE_CURRENCY);
    expect(service.getScopeAccountingUnit()).toBe(B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT);
    expect(service.getScopeDirection()).toBe(B1_REFERRAL_ENGINE_SCOPE_DIRECTION);
    expect(service.getScopeProductDependency()).toBe(B1_REFERRAL_ENGINE_SCOPE_PRODUCT_DEPENDENCY);
    expect(service.getScopePartnerDependency()).toBe(B1_REFERRAL_ENGINE_SCOPE_PARTNER_DEPENDENCY);
  });

  it('exposes the B1 referral engine period identity', () => {
    expect(service.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.referral-period.per-flow.v1',
    );
  });

  it('exposes the B1 referral engine audit, outbox, idempotency, and reference prefix', () => {
    expect(service.getAuditActor()).toBe('b1-referral-engine');
    expect(service.getAuditEntityType()).toBe('B1_REFERRAL_DECISION');
    expect(service.getOutboxEventType()).toBe(B1_REFERRAL_ENGINE_OUTBOX_EVENT_TYPE);
    expect(service.getReferralIdempotencyScope()).toBe(
      B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
    );
    expect(service.getCashbackIdempotencyScope()).toBe(
      B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
    );
    expect(service.getLoyaltyIdempotencyScope()).toBe(B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE);
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getReferencePrefix()).toBe(B1_REFERRAL_ENGINE_REFERENCE_PREFIX);
  });

  it('exposes the B1 referral engine vocabulary accessors', () => {
    expect(service.getReferralStates().length).toBe(5);
    expect(service.getCashbackStates().length).toBe(5);
    expect(service.getLoyaltyStates().length).toBe(5);
    expect(service.getDecisionKinds().length).toBe(3);
    expect(service.getDecisionOutcomes().length).toBe(4);
    expect(service.getDocumentKinds().length).toBe(15);
    expect(service.getRuleKinds().length).toBeGreaterThan(50);
    expect(service.getRuleOutcomes().length).toBe(4);
    expect(service.getRelationshipTypes().length).toBe(7);
    expect(service.getQualificationStatuses().length).toBe(5);
    expect(service.getLoyaltyTierStatuses().length).toBe(6);
    expect(service.getLoyaltyEarningSources().length).toBe(8);
    expect(service.getCashbackCalculationBases().length).toBe(5);
    expect(service.getClassificationLevels().length).toBe(5);
    expect(service.getDataControlClassifications().length).toBe(5);
    expect(service.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(service.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(service.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(service.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(service.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(service.getFailureCodes().length).toBe(32);
    expect(service.getMetrics().length).toBeGreaterThan(20);
    expect(service.getRetentionDays()).toBe(365);
  });

  it('exposes the B1 referral engine consumer ports', () => {
    const ports = service.getConsumerPorts();
    expect(typeof ports.generateReferralRewardDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateReferralRewardDecision).toBe('function');
    expect(typeof ports.generateCashbackCalculationDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCashbackCalculationDecision).toBe('function');
    expect(typeof ports.generateLoyaltyEarningDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateLoyaltyEarningDecision).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('runs a B1 referral reward decision generate', () => {
    const record = service.generateReferralRewardDecision(buildReferralRequest());
    expect(record.referralRewardDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 cashback calculation decision generate', () => {
    const record = service.generateCashbackCalculationDecision(buildCashbackRequest());
    expect(record.cashbackDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 loyalty earning decision generate', () => {
    const record = service.generateLoyaltyEarningDecision(buildLoyaltyRequest());
    expect(record.loyaltyEarningDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 referral engine compatibility check', () => {
    const compatibility = service.compatibilityCheck(buildReferralRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('runs a B1 referral reward decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateReferralRewardDecision(buildReferralRequest());
    expect(result.record.referralRewardDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 cashback calculation decision replay-safe generate', async () => {
    const result =
      await service.replaySafeGenerateCashbackCalculationDecision(buildCashbackRequest());
    expect(result.record.cashbackDecisionState).toBe('ACTIVE');
  });

  it('runs a B1 loyalty earning decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateLoyaltyEarningDecision(buildLoyaltyRequest());
    expect(result.record.loyaltyEarningDecisionState).toBe('ACTIVE');
  });

  it('returns the B1 referral engine versioning contract', () => {
    const versioning = service.getVersioningContract();
    expect(versioning.contractName).toBe(B1_REFERRAL_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_REFERRAL_ENGINE_SCOPE_KEY);
  });
});
