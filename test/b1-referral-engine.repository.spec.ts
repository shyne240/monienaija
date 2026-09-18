import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1ReferralEngineRepository } from '../src/policy/b1-referral-engine.repository';
import {
  B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_CONTRACT_NAME,
  B1_REFERRAL_ENGINE_CONTRACT_VERSION,
  B1_REFERRAL_ENGINE_FAILURE_INCOMPATIBLE,
  B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND,
  B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
  B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  B1_REFERRAL_ENGINE_SCOPE_KEY,
  B1_REFERRAL_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-referral-engine.constants';
import type {
  B1CashbackRequestV1,
  B1LoyaltyEarningRequestV1,
  B1ReferralRequestV1,
} from '../src/policy/b1-referral-engine.types';
import type { RequestContext } from '../src/production/request-context';

const SHA256_RE = /^[a-f0-9]{64}$/;

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-referral-engine-req',
  correlationId: 'b1-referral-engine-corr',
  traceId: 'b1-referral-engine-trace',
});

const buildReferralRequest = (
  overrides: Partial<B1ReferralRequestV1> = {},
): B1ReferralRequestV1 => ({
  contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  referralRequestId: 'b1-referral-engine-referral-req-1',
  referralRequestVersion: 1,
  scopeKey: B1_REFERRAL_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REFERRAL_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-referral-engine-customer-1',
  merchantId: 'b1-referral-engine-merchant-1',
  partnerId: 'b1-referral-engine-partner-1',
  refereeCustomerId: 'b1-referral-engine-referee-1',
  sponsorCustomerId: 'b1-referral-engine-sponsor-1',
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
  hierarchyPath: ['root', 'level-1'],
  hierarchyDepth: 2,
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
  causationId: 'b1-referral-engine-causation',
  ...overrides,
});

const buildCashbackRequest = (
  overrides: Partial<B1CashbackRequestV1> = {},
): B1CashbackRequestV1 => ({
  contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  cashbackRequestId: 'b1-referral-engine-cashback-req-1',
  cashbackRequestVersion: 1,
  scopeKey: B1_REFERRAL_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REFERRAL_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-referral-engine-customer-1',
  merchantId: 'b1-referral-engine-merchant-1',
  partnerId: 'b1-referral-engine-partner-1',
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
  causationId: 'b1-referral-engine-cashback-causation',
  ...overrides,
});

const buildLoyaltyRequest = (
  overrides: Partial<B1LoyaltyEarningRequestV1> = {},
): B1LoyaltyEarningRequestV1 => ({
  contractName: B1_REFERRAL_ENGINE_CONTRACT_NAME,
  contractVersion: 1,
  loyaltyRequestId: 'b1-referral-engine-loyalty-req-1',
  loyaltyRequestVersion: 1,
  scopeKey: B1_REFERRAL_ENGINE_SCOPE_KEY,
  scopeVersion: B1_REFERRAL_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_REFERRAL_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-referral-engine-customer-1',
  merchantId: 'b1-referral-engine-merchant-1',
  partnerId: 'b1-referral-engine-partner-1',
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
  causationId: 'b1-referral-engine-loyalty-causation',
  ...overrides,
});

describe('B1 referral engine repository (B1T07)', () => {
  let repository: B1ReferralEngineRepository;

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
  });

  it('exposes the B1 referral engine contract name and version', () => {
    expect(repository.getContractName()).toBe(B1_REFERRAL_ENGINE_CONTRACT_NAME);
    expect(repository.getContractVersion()).toBe(B1_REFERRAL_ENGINE_CONTRACT_VERSION);
  });

  it('exposes the B1 referral engine first commercial scope identity', () => {
    expect(repository.getScopeKey()).toBe(B1_REFERRAL_ENGINE_SCOPE_KEY);
    expect(repository.getScopeVersion()).toBe(B1_REFERRAL_ENGINE_SCOPE_VERSION);
    expect(repository.getScopeCurrency()).toBe(B1_REFERRAL_ENGINE_SCOPE_CURRENCY);
    expect(repository.getScopeAccountingUnit()).toBe(B1_REFERRAL_ENGINE_SCOPE_ACCOUNTING_UNIT);
    expect(repository.getScopeDirection()).toBe('inbound');
    expect(repository.getScopeProductDependency()).toBe('VIRTUAL_ACCOUNT');
    expect(repository.getScopePartnerDependency()).toBe('NIBSS_NIP');
  });

  it('exposes the B1 referral engine period identity', () => {
    expect(repository.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.referral-period.per-flow.v1',
    );
  });

  it('exposes the B1 referral engine audit, outbox, idempotency, and reference prefix', () => {
    expect(repository.getAuditActor()).toBe('b1-referral-engine');
    expect(repository.getAuditEntityType()).toBe('B1_REFERRAL_DECISION');
    expect(repository.getOutboxEventType()).toBe('B1ReferralDecisionDecided');
    expect(repository.getReferralIdempotencyScope()).toBe(
      B1_REFERRAL_ENGINE_REFERRAL_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getCashbackIdempotencyScope()).toBe(
      B1_REFERRAL_ENGINE_CASHBACK_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getLoyaltyIdempotencyScope()).toBe(
      B1_REFERRAL_ENGINE_LOYALTY_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(repository.getReferencePrefix()).toBe('b1-referral-decision');
  });

  it('exposes the B1 referral engine vocabulary accessors', () => {
    expect(repository.getReferralStates().length).toBe(5);
    expect(repository.getCashbackStates().length).toBe(5);
    expect(repository.getLoyaltyStates().length).toBe(5);
    expect(repository.getDecisionKinds().length).toBe(3);
    expect(repository.getDecisionOutcomes().length).toBe(4);
    expect(repository.getDocumentKinds().length).toBe(15);
    expect(repository.getRuleKinds().length).toBeGreaterThan(50);
    expect(repository.getRuleOutcomes().length).toBe(4);
    expect(repository.getRelationshipTypes().length).toBe(7);
    expect(repository.getQualificationStatuses().length).toBe(5);
    expect(repository.getLoyaltyTierStatuses().length).toBe(6);
    expect(repository.getLoyaltyEarningSources().length).toBe(8);
    expect(repository.getCashbackCalculationBases().length).toBe(5);
    expect(repository.getClassificationLevels().length).toBe(5);
    expect(repository.getDataControlClassifications().length).toBe(5);
    expect(repository.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(repository.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(repository.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(repository.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(repository.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(repository.getFailureCodes().length).toBe(32);
    expect(repository.getMetrics().length).toBeGreaterThan(20);
    expect(repository.getRetentionDays()).toBe(365);
  });

  it('generates a B1 referral reward decision for a valid request', () => {
    const record = repository.generateReferralRewardDecision(buildReferralRequest());
    expect(record.referralRewardDecisionState).toBe('ACTIVE');
    expect(record.referralRewardDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.referralRewardDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.referralRewardDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.referralRequestHash)).toBe(true);
    expect(record.referralEligible).toBe(true);
    expect(record.referralApplicable).toBe(true);
    expect(record.eligibilitySummary.length).toBe(9);
  });

  it('produces deterministic B1 referral reward decisions for identical inputs', () => {
    const request = buildReferralRequest();
    const a = repository.generateReferralRewardDecision(request);
    const b = repository.generateReferralRewardDecision(request);
    expect(a.referralRewardDecisionHash).toBe(b.referralRewardDecisionHash);
    expect(a.referralRewardDecisionReplayHash).toBe(b.referralRewardDecisionReplayHash);
    expect(a.referralRequestHash).toBe(b.referralRequestHash);
  });

  it('returns a failure referral decision for an invalid contract name', () => {
    const record = repository.generateReferralRewardDecision(
      buildReferralRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure referral decision for an invalid scope key', () => {
    const record = repository.generateReferralRewardDecision(
      buildReferralRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(record.failure?.code).toBe(B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure referral decision for an invalid product key', () => {
    const record = repository.generateReferralRewardDecision(
      buildReferralRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(record.failure?.code).toBe(B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure referral decision for an invalid idempotency key', () => {
    const record = repository.generateReferralRewardDecision(
      buildReferralRequest({ idempotencyKey: 'invalid' }),
    );
    expect(record.failure?.code).toBe(B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 cashback calculation decision for a valid request', () => {
    const record = repository.generateCashbackCalculationDecision(buildCashbackRequest());
    expect(record.cashbackDecisionState).toBe('ACTIVE');
    expect(record.cashbackDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.cashbackDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.cashbackDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.cashbackRequestHash)).toBe(true);
    expect(record.cashbackEligible).toBe(true);
    expect(record.cashbackApplicable).toBe(true);
    expect(record.cashbackCalculationAmount).toBe('50000');
  });

  it('produces deterministic B1 cashback calculation decisions for identical inputs', () => {
    const request = buildCashbackRequest();
    const a = repository.generateCashbackCalculationDecision(request);
    const b = repository.generateCashbackCalculationDecision(request);
    expect(a.cashbackDecisionHash).toBe(b.cashbackDecisionHash);
    expect(a.cashbackDecisionReplayHash).toBe(b.cashbackDecisionReplayHash);
    expect(a.cashbackRequestHash).toBe(b.cashbackRequestHash);
  });

  it('returns a failure cashback decision for an invalid cashback request', () => {
    const record = repository.generateCashbackCalculationDecision(
      buildCashbackRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 loyalty earning decision for a valid request', () => {
    const record = repository.generateLoyaltyEarningDecision(buildLoyaltyRequest());
    expect(record.loyaltyEarningDecisionState).toBe('ACTIVE');
    expect(record.loyaltyEarningDecisionOutcome).toBe('APPLIED');
    expect(SHA256_RE.test(record.loyaltyEarningDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.loyaltyEarningDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.loyaltyRequestHash)).toBe(true);
    expect(record.loyaltyEarningEligible).toBe(true);
    expect(record.loyaltyEarningApplicable).toBe(true);
    expect(record.loyaltyEarningAmount).toBe('10000');
  });

  it('produces deterministic B1 loyalty earning decisions for identical inputs', () => {
    const request = buildLoyaltyRequest();
    const a = repository.generateLoyaltyEarningDecision(request);
    const b = repository.generateLoyaltyEarningDecision(request);
    expect(a.loyaltyEarningDecisionHash).toBe(b.loyaltyEarningDecisionHash);
    expect(a.loyaltyEarningDecisionReplayHash).toBe(b.loyaltyEarningDecisionReplayHash);
    expect(a.loyaltyRequestHash).toBe(b.loyaltyRequestHash);
  });

  it('returns a failure loyalty decision for an invalid loyalty request', () => {
    const record = repository.generateLoyaltyEarningDecision(
      buildLoyaltyRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_REFERRAL_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('runs a B1 referral engine compatibility check', () => {
    const compatibility = repository.compatibilityCheck(buildReferralRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('returns a compatibility mismatch for an invalid scope key', () => {
    const compatibility = repository.compatibilityCheck(
      buildReferralRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(compatibility.compatible).toBe(false);
    if (!compatibility.compatible) {
      expect(compatibility.code).toBe(B1_REFERRAL_ENGINE_FAILURE_INCOMPATIBLE);
    }
  });

  it('returns a compatibility mismatch for an invalid product key', () => {
    const compatibility = repository.compatibilityCheck(
      buildReferralRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns the B1 referral engine versioning contract', () => {
    const versioning = repository.getVersioningContract();
    expect(versioning.contractName).toBe(B1_REFERRAL_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_REFERRAL_ENGINE_SCOPE_KEY);
  });

  it('exposes the B1 referral engine consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const evaluated = await ports.generateReferralRewardDecision(buildReferralRequest());
    expect(evaluated.referralRewardDecisionState).toBe('ACTIVE');
  });

  it('runs a replay-safe generate referral reward decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateReferralRewardDecision(buildReferralRequest());
    expect(result.record.referralRewardDecisionState).toBe('ACTIVE');
    expect(SHA256_RE.test(result.referralRequestHash)).toBe(true);
    expect(SHA256_RE.test(result.referralRewardDecisionHash)).toBe(true);
    expect(SHA256_RE.test(result.referralRewardDecisionReplayHash)).toBe(true);
  });

  it('runs a replay-safe generate cashback calculation decision', async () => {
    const ports = repository.getConsumerPorts();
    const result =
      await ports.replaySafeGenerateCashbackCalculationDecision(buildCashbackRequest());
    expect(result.record.cashbackDecisionState).toBe('ACTIVE');
  });

  it('runs a replay-safe generate loyalty earning decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateLoyaltyEarningDecision(buildLoyaltyRequest());
    expect(result.record.loyaltyEarningDecisionState).toBe('ACTIVE');
  });

  it('runs a compatibility check via consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.compatibilityCheck(buildReferralRequest());
    expect(result.compatible).toBe(true);
  });
});
