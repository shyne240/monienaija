import { B1CommercialAnalyticsEngineService } from '../src/policy/b1-commercial-analytics-engine.service';
import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1CommercialGovernanceEngineRepository } from '../src/policy/b1-commercial-governance-engine.repository';
import { B1CommercialGovernanceEngineService } from '../src/policy/b1-commercial-governance-engine.service';
import {
  B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-commercial-governance-engine.constants';
import type { RequestContext } from '../src/production/request-context';

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-commercial-governance-engine-svc-req',
  correlationId: 'b1-commercial-governance-engine-svc-corr',
  traceId: 'b1-commercial-governance-engine-svc-trace',
});

describe('B1 commercial-governance engine service (B1T10)', () => {
  let repository: B1CommercialGovernanceEngineRepository;
  let service: B1CommercialGovernanceEngineService;

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
    repository = new B1CommercialGovernanceEngineRepository(
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
      {} as never,
      idempotencyServiceMock as never,
      metricsServiceMock as never,
    );
    service = new B1CommercialGovernanceEngineService(repository);
  });

  it('exposes the B1 commercial-governance engine contract name and version', () => {
    expect(service.getContractName()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME);
    expect(service.getContractVersion()).toBe(1);
  });

  it('exposes the B1 commercial-governance engine first commercial scope identity', () => {
    expect(service.getScopeKey()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY);
    expect(service.getScopeVersion()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION);
    expect(service.getScopeCurrency()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY);
    expect(service.getScopeAccountingUnit()).toBe(
      B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
    );
  });

  it('exposes the B1 commercial-governance engine period identity', () => {
    expect(service.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.commercial-governance-period.per-flow.v1',
    );
  });

  it('exposes the B1 commercial-governance engine audit, outbox, idempotency, and reference prefix', () => {
    expect(service.getAuditActor()).toBe('b1-commercial-governance-engine');
    expect(service.getAuditEntityType()).toBe('B1_COMMERCIAL_GOVERNANCE_DECISION');
    expect(service.getOutboxEventType()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_OUTBOX_EVENT_TYPE);
    expect(service.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(service.getReferencePrefix()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_REFERENCE_PREFIX);
  });

  it('exposes the B1 commercial-governance engine vocabulary accessors', () => {
    expect(service.getCommercialDataClassificationStates().length).toBe(6);
    expect(service.getCommercialIdempotencyStates().length).toBe(6);
    expect(service.getCommercialAuditStates().length).toBe(6);
    expect(service.getCommercialApprovalStates().length).toBe(7);
    expect(service.getCommercialFeatureFlagStates().length).toBe(6);
    expect(service.getDecisionKinds().length).toBe(5);
    expect(service.getDecisionOutcomes().length).toBe(8);
    expect(service.getDocumentKinds().length).toBe(26);
    expect(service.getRuleKinds().length).toBeGreaterThan(50);
    expect(service.getRuleOutcomes().length).toBe(4);
    expect(service.getCommercialSensitivities().length).toBe(8);
    expect(service.getCommercialDisclosureLevels().length).toBe(5);
    expect(service.getCommercialRetentionClasses().length).toBe(6);
    expect(service.getCommercialExportRules().length).toBe(6);
    expect(service.getCommercialReplayPolicies().length).toBe(6);
    expect(service.getCommercialReplayEligibilities().length).toBe(6);
    expect(service.getCommercialAuditEvents().length).toBe(23);
    expect(service.getCommercialApprovalRequirements().length).toBe(6);
    expect(service.getCommercialApprovalPolicies().length).toBe(5);
    expect(service.getCommercialFeatureFlagRolloutStates().length).toBe(7);
    expect(service.getCommercialActivationReadinesses().length).toBe(5);
    expect(service.getClassificationLevels().length).toBe(5);
    expect(service.getDataControlClassifications().length).toBe(5);
    expect(service.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(service.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(service.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(service.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(service.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(service.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(service.getFailureCodes().length).toBe(28);
    expect(service.getMetrics().length).toBeGreaterThan(20);
    expect(service.getRetentionDays()).toBe(365);
  });

  it('exposes the B1 commercial-governance engine consumer ports', () => {
    const ports = service.getConsumerPorts();
    expect(typeof ports.generateCommercialDataClassificationDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCommercialDataClassificationDecision).toBe('function');
    expect(typeof ports.generateCommercialIdempotencyDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCommercialIdempotencyDecision).toBe('function');
    expect(typeof ports.generateCommercialAuditDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCommercialAuditDecision).toBe('function');
    expect(typeof ports.generateCommercialApprovalDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCommercialApprovalDecision).toBe('function');
    expect(typeof ports.generateCommercialFeatureFlagDecision).toBe('function');
    expect(typeof ports.replaySafeGenerateCommercialFeatureFlagDecision).toBe('function');
    expect(typeof ports.compatibilityCheck).toBe('function');
  });

  it('runs a B1 commercial-data-classification decision generate', () => {
    const record = service.generateCommercialDataClassificationDecision({
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: 1,
      commercialDataClassificationRequestId: 'b1-commercial-governance-engine-svc-dc-req-1',
      commercialDataClassificationRequestVersion: 1,
      scopeKey: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
      expectedCurrency: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY,
      expectedAccountingUnit: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
      customerId: 'b1-commercial-governance-engine-svc-customer-1',
      merchantId: 'b1-commercial-governance-engine-svc-merchant-1',
      partnerId: 'b1-commercial-governance-engine-svc-partner-1',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-data-classification',
      capabilityVersion: 1,
      planKey:
        'commercial.virtual-account.inbound-funding.commercial-data-classification.v1.plan.standard',
      planVersion: 1,
      customerTierKey: 'commercial.customer.tier.standard.v1',
      customerTierVersion: 1,
      merchantTierKey: 'commercial.merchant.tier.standard.v1',
      merchantTierVersion: 1,
      partnerTierKey: 'commercial.partner.tier.standard.v1',
      partnerTierVersion: 1,
      productEntitlementKey:
        'commercial.virtual-account.inbound-funding.entitlement.commercial-data-classification.v1',
      productEntitlementVersion: 1,
      subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
      subscriptionVersion: 1,
      periodKey:
        'commercial.virtual-account.inbound-funding.commercial-governance-period.per-flow.v1',
      periodVersion: 1,
      periodOpenAt: '2024-01-01T00:00:00.000Z',
      periodCloseAt: '2024-01-01T00:00:00.001Z',
      periodEffectiveAt: '2024-01-01T00:00:00.000Z',
      commercialClassificationLevel: 'INTERNAL',
      commercialSensitivity: 'COMMERCIAL_INTERNAL',
      commercialDisclosureLevel: 'COMMERCIAL_DISCLOSURE_INTERNAL',
      commercialRetentionClass: 'COMMERCIAL_RETENTION_OPERATIONS_DEFAULT',
      commercialExportRule: 'COMMERCIAL_EXPORT_INTERNAL_ONLY',
      commercialDataClassificationStartAt: '2024-01-01T00:00:00.000Z',
      commercialDataClassificationEndAt: '2024-12-31T23:59:59.999Z',
      commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
      commercialDecisionIdempotencyKey: 'a'.repeat(64),
      billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
      campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
      promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
      couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
      referralDecisionReference: 'b1-referral-decision:v1:referral:1',
      cashbackDecisionReference: 'b1-referral-decision:v1:cashback:1',
      loyaltyDecisionReference: 'b1-referral-decision:v1:loyalty:1',
      revenueRecognitionDecisionReference:
        'b1-revenue-recognition-decision:v1:revenue-recognition:1',
      taxVatDecisionReference: 'b1-revenue-recognition-decision:v1:tax-vat:1',
      costAccountingDecisionReference: 'b1-revenue-recognition-decision:v1:cost-accounting:1',
      commercialAnalyticsDecisionReference:
        'b1-commercial-analytics-decision:v1:commercial-analytics:1',
      idempotencyKey: 'b'.repeat(64),
      requestContext: buildRequestContext(),
      causationId: 'b1-commercial-governance-engine-svc-dc-causation',
    });
    expect(record.commercialDataClassificationDecisionState).toBe('CLASSIFIED');
  });

  it('runs a B1 commercial-governance engine compatibility check', () => {
    const compatibility = service.compatibilityCheck({
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: 1,
      commercialDataClassificationRequestId: 'b1-commercial-governance-engine-svc-dc-req-1',
      commercialDataClassificationRequestVersion: 1,
      scopeKey: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
      expectedCurrency: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY,
      expectedAccountingUnit: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
      customerId: 'b1-commercial-governance-engine-svc-customer-1',
      merchantId: 'b1-commercial-governance-engine-svc-merchant-1',
      partnerId: 'b1-commercial-governance-engine-svc-partner-1',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-data-classification',
      capabilityVersion: 1,
      planKey:
        'commercial.virtual-account.inbound-funding.commercial-data-classification.v1.plan.standard',
      planVersion: 1,
      customerTierKey: 'commercial.customer.tier.standard.v1',
      customerTierVersion: 1,
      merchantTierKey: 'commercial.merchant.tier.standard.v1',
      merchantTierVersion: 1,
      partnerTierKey: 'commercial.partner.tier.standard.v1',
      partnerTierVersion: 1,
      productEntitlementKey:
        'commercial.virtual-account.inbound-funding.entitlement.commercial-data-classification.v1',
      productEntitlementVersion: 1,
      subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
      subscriptionVersion: 1,
      periodKey:
        'commercial.virtual-account.inbound-funding.commercial-governance-period.per-flow.v1',
      periodVersion: 1,
      periodOpenAt: '2024-01-01T00:00:00.000Z',
      periodCloseAt: '2024-01-01T00:00:00.001Z',
      periodEffectiveAt: '2024-01-01T00:00:00.000Z',
      commercialClassificationLevel: 'INTERNAL',
      commercialSensitivity: 'COMMERCIAL_INTERNAL',
      commercialDisclosureLevel: 'COMMERCIAL_DISCLOSURE_INTERNAL',
      commercialRetentionClass: 'COMMERCIAL_RETENTION_OPERATIONS_DEFAULT',
      commercialExportRule: 'COMMERCIAL_EXPORT_INTERNAL_ONLY',
      commercialDataClassificationStartAt: '2024-01-01T00:00:00.000Z',
      commercialDataClassificationEndAt: '2024-12-31T23:59:59.999Z',
      commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
      commercialDecisionIdempotencyKey: 'a'.repeat(64),
      billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
      campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
      promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
      couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
      referralDecisionReference: 'b1-referral-decision:v1:referral:1',
      cashbackDecisionReference: 'b1-referral-decision:v1:cashback:1',
      loyaltyDecisionReference: 'b1-referral-decision:v1:loyalty:1',
      revenueRecognitionDecisionReference:
        'b1-revenue-recognition-decision:v1:revenue-recognition:1',
      taxVatDecisionReference: 'b1-revenue-recognition-decision:v1:tax-vat:1',
      costAccountingDecisionReference: 'b1-revenue-recognition-decision:v1:cost-accounting:1',
      commercialAnalyticsDecisionReference:
        'b1-commercial-analytics-decision:v1:commercial-analytics:1',
      idempotencyKey: 'b'.repeat(64),
      requestContext: buildRequestContext(),
      causationId: 'b1-commercial-governance-engine-svc-dc-causation',
    });
    expect(compatibility.compatible).toBe(true);
  });

  it('runs a B1 commercial-data-classification decision replay-safe generate', async () => {
    const result = await service.replaySafeGenerateCommercialDataClassificationDecision({
      contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
      contractVersion: 1,
      commercialDataClassificationRequestId: 'b1-commercial-governance-engine-svc-dc-req-1',
      commercialDataClassificationRequestVersion: 1,
      scopeKey: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
      scopeVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
      expectedCurrency: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY,
      expectedAccountingUnit: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
      customerId: 'b1-commercial-governance-engine-svc-customer-1',
      merchantId: 'b1-commercial-governance-engine-svc-merchant-1',
      partnerId: 'b1-commercial-governance-engine-svc-partner-1',
      productKey: 'VIRTUAL_ACCOUNT',
      productVersion: 1,
      capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-data-classification',
      capabilityVersion: 1,
      planKey:
        'commercial.virtual-account.inbound-funding.commercial-data-classification.v1.plan.standard',
      planVersion: 1,
      customerTierKey: 'commercial.customer.tier.standard.v1',
      customerTierVersion: 1,
      merchantTierKey: 'commercial.merchant.tier.standard.v1',
      merchantTierVersion: 1,
      partnerTierKey: 'commercial.partner.tier.standard.v1',
      partnerTierVersion: 1,
      productEntitlementKey:
        'commercial.virtual-account.inbound-funding.entitlement.commercial-data-classification.v1',
      productEntitlementVersion: 1,
      subscriptionKey: 'commercial.virtual-account.inbound-funding.subscription.standard.v1',
      subscriptionVersion: 1,
      periodKey:
        'commercial.virtual-account.inbound-funding.commercial-governance-period.per-flow.v1',
      periodVersion: 1,
      periodOpenAt: '2024-01-01T00:00:00.000Z',
      periodCloseAt: '2024-01-01T00:00:00.001Z',
      periodEffectiveAt: '2024-01-01T00:00:00.000Z',
      commercialClassificationLevel: 'INTERNAL',
      commercialSensitivity: 'COMMERCIAL_INTERNAL',
      commercialDisclosureLevel: 'COMMERCIAL_DISCLOSURE_INTERNAL',
      commercialRetentionClass: 'COMMERCIAL_RETENTION_OPERATIONS_DEFAULT',
      commercialExportRule: 'COMMERCIAL_EXPORT_INTERNAL_ONLY',
      commercialDataClassificationStartAt: '2024-01-01T00:00:00.000Z',
      commercialDataClassificationEndAt: '2024-12-31T23:59:59.999Z',
      commercialDecisionReference: 'b1-commercial-decision:v1:fee:1',
      commercialDecisionIdempotencyKey: 'a'.repeat(64),
      billingDocumentReference: 'b1-billing-document:billing-record:v1:1',
      campaignDecisionReference: 'b1-campaign-decision:v1:campaign:1',
      promotionDecisionReference: 'b1-campaign-decision:v1:promotion:1',
      couponDecisionReference: 'b1-campaign-decision:v1:coupon:1',
      referralDecisionReference: 'b1-referral-decision:v1:referral:1',
      cashbackDecisionReference: 'b1-referral-decision:v1:cashback:1',
      loyaltyDecisionReference: 'b1-referral-decision:v1:loyalty:1',
      revenueRecognitionDecisionReference:
        'b1-revenue-recognition-decision:v1:revenue-recognition:1',
      taxVatDecisionReference: 'b1-revenue-recognition-decision:v1:tax-vat:1',
      costAccountingDecisionReference: 'b1-revenue-recognition-decision:v1:cost-accounting:1',
      commercialAnalyticsDecisionReference:
        'b1-commercial-analytics-decision:v1:commercial-analytics:1',
      idempotencyKey: 'b'.repeat(64),
      requestContext: buildRequestContext(),
      causationId: 'b1-commercial-governance-engine-svc-dc-causation',
    });
    expect(result.record.commercialDataClassificationDecisionState).toBe('CLASSIFIED');
  });

  it('returns the B1 commercial-governance engine versioning contract', () => {
    const versioning = service.getVersioningContract();
    expect(versioning.contractName).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY);
  });
});

void B1CommercialAnalyticsEngineService;
