import { B1CommercialAnalyticsEngineService } from '../src/policy/b1-commercial-analytics-engine.service';
import { B1CommercialCatalogService } from '../src/policy/b1-commercial-catalog.service';
import { B1CommercialGovernanceEngineRepository } from '../src/policy/b1-commercial-governance-engine.repository';
import {
  // Type-safe wrapper: each builder returns the union type that we then cast to the concrete request type

  B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INCOMPATIBLE,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
  B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
} from '../src/policy/b1-commercial-governance-engine.constants';
import type {
  B1CommercialApprovalRequestV1,
  B1CommercialAuditRequestV1,
  B1CommercialDataClassificationRequestV1,
  B1CommercialFeatureFlagRequestV1,
  B1CommercialIdempotencyRequestV1,
} from '../src/policy/b1-commercial-governance-engine.types';
import type { RequestContext } from '../src/production/request-context';

const SHA256_RE = /^[a-f0-9]{64}$/;

const buildRequestContext = (): RequestContext => ({
  requestId: 'b1-commercial-governance-engine-req',
  correlationId: 'b1-commercial-governance-engine-corr',
  traceId: 'b1-commercial-governance-engine-trace',
});

const buildCommonRequestFields = () => ({
  contractName: B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME,
  contractVersion: 1 as const,
  scopeKey: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY,
  scopeVersion: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION,
  expectedCurrency: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY,
  expectedAccountingUnit: B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
  customerId: 'b1-commercial-governance-engine-customer-1',
  merchantId: 'b1-commercial-governance-engine-merchant-1',
  partnerId: 'b1-commercial-governance-engine-partner-1',
  productKey: 'VIRTUAL_ACCOUNT' as const,
  productVersion: 1,
  capabilityKey:
    'commercial.virtual-account.inbound-funding.commercial-data-classification' as const,
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
  periodKey: 'commercial.virtual-account.inbound-funding.commercial-governance-period.per-flow.v1',
  periodVersion: 1,
  periodOpenAt: '2024-01-01T00:00:00.000Z',
  periodCloseAt: '2024-01-01T00:00:00.001Z',
  periodEffectiveAt: '2024-01-01T00:00:00.000Z',
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
  commercialAnalyticsDecisionReference:
    'b1-commercial-analytics-decision:v1:commercial-analytics:1',
});

const buildCommercialDataClassificationRequest = (
  overrides: Partial<B1CommercialDataClassificationRequestV1> = {},
): B1CommercialDataClassificationRequestV1 =>
  ({
    ...buildCommonRequestFields(),
    commercialDataClassificationRequestId: 'b1-commercial-governance-engine-dc-req-1',
    commercialDataClassificationRequestVersion: 1,
    commercialClassificationLevel: 'INTERNAL' as const,
    commercialSensitivity: 'COMMERCIAL_INTERNAL' as const,
    commercialDisclosureLevel: 'COMMERCIAL_DISCLOSURE_INTERNAL' as const,
    commercialRetentionClass: 'COMMERCIAL_RETENTION_OPERATIONS_DEFAULT' as const,
    commercialExportRule: 'COMMERCIAL_EXPORT_INTERNAL_ONLY' as const,
    commercialDataClassificationStartAt: '2024-01-01T00:00:00.000Z',
    commercialDataClassificationEndAt: '2024-12-31T23:59:59.999Z',
    idempotencyKey: 'a1b2c3d4e5f6a7b8'.repeat(4),
    requestContext: buildRequestContext(),
    causationId: 'b1-commercial-governance-engine-dc-causation',
    ...overrides,
  }) as never;

const buildCommercialIdempotencyRequest = (
  overrides: Partial<B1CommercialIdempotencyRequestV1> = {},
): B1CommercialIdempotencyRequestV1 =>
  ({
    ...buildCommonRequestFields(),
    capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-idempotency' as const,
    planKey: 'commercial.virtual-account.inbound-funding.commercial-idempotency.v1.plan.standard',
    productEntitlementKey:
      'commercial.virtual-account.inbound-funding.entitlement.commercial-idempotency.v1',
    commercialIdempotencyRequestId: 'b1-commercial-governance-engine-id-req-1',
    commercialIdempotencyRequestVersion: 1,
    commercialIdempotencyScope:
      'b1.commercial-governance-engine.commercial-idempotency.idempotency.v1',
    commercialIdempotencyKey: 'c'.repeat(64),
    commercialReplayPolicy: 'COMMERCIAL_REPLAY_ALLOW',
    commercialReplayWindowSeconds: 86_400,
    commercialIdempotencyStartAt: '2024-01-01T00:00:00.000Z',
    commercialIdempotencyEndAt: '2024-12-31T23:59:59.999Z',
    idempotencyKey: 'b2c3d4e5f6a7c8d9'.repeat(4),
    requestContext: buildRequestContext(),
    causationId: 'b1-commercial-governance-engine-id-causation',
    ...overrides,
  }) as never;

const buildCommercialAuditRequest = (
  overrides: Partial<B1CommercialAuditRequestV1> = {},
): B1CommercialAuditRequestV1 =>
  ({
    ...buildCommonRequestFields(),
    capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-audit' as const,
    planKey: 'commercial.virtual-account.inbound-funding.commercial-audit.v1.plan.standard',
    productEntitlementKey:
      'commercial.virtual-account.inbound-funding.entitlement.commercial-audit.v1',
    commercialAuditRequestId: 'b1-commercial-governance-engine-aud-req-1',
    commercialAuditRequestVersion: 1,
    commercialAuditEvent: 'COMMERCIAL_AUDIT_DECISION_RECORDED',
    commercialAuditActor: 'b1-commercial-governance-engine',
    commercialAuditEntityType: 'B1_COMMERCIAL_GOVERNANCE_DECISION',
    commercialAuditEntityId: 'b1-commercial-governance-engine-entity-1',
    commercialAuditStartAt: '2024-01-01T00:00:00.000Z',
    commercialAuditEndAt: '2024-12-31T23:59:59.999Z',
    idempotencyKey: 'c3d4e5f6a7b8d9e0'.repeat(4),
    requestContext: buildRequestContext(),
    causationId: 'b1-commercial-governance-engine-aud-causation',
    ...overrides,
  }) as never;

const buildCommercialApprovalRequest = (
  overrides: Partial<B1CommercialApprovalRequestV1> = {},
): B1CommercialApprovalRequestV1 =>
  ({
    ...buildCommonRequestFields(),
    capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-approvals' as const,
    planKey: 'commercial.virtual-account.inbound-funding.commercial-approvals.v1.plan.standard',
    productEntitlementKey:
      'commercial.virtual-account.inbound-funding.entitlement.commercial-approvals.v1',
    commercialApprovalRequestId: 'b1-commercial-governance-engine-app-req-1',
    commercialApprovalRequestVersion: 1,
    commercialApprovalRequirement: 'COMMERCIAL_APPROVAL_PRINCIPAL',
    commercialApprovalPolicy: 'COMMERCIAL_APPROVAL_POLICY_ALLOW',
    commercialApprovalStartAt: '2024-01-01T00:00:00.000Z',
    commercialApprovalEndAt: '2024-12-31T23:59:59.999Z',
    idempotencyKey: 'd4e5f6a7b8c9d0e1'.repeat(4),
    requestContext: buildRequestContext(),
    causationId: 'b1-commercial-governance-engine-app-causation',
    ...overrides,
  }) as never;

const buildCommercialFeatureFlagRequest = (
  overrides: Partial<B1CommercialFeatureFlagRequestV1> = {},
): B1CommercialFeatureFlagRequestV1 =>
  ({
    ...buildCommonRequestFields(),
    capabilityKey: 'commercial.virtual-account.inbound-funding.commercial-feature-flag' as const,
    planKey: 'commercial.virtual-account.inbound-funding.commercial-feature-flag.v1.plan.standard',
    productEntitlementKey:
      'commercial.virtual-account.inbound-funding.entitlement.commercial-feature-flag.v1',
    commercialFeatureFlagRequestId: 'b1-commercial-governance-engine-ff-req-1',
    commercialFeatureFlagRequestVersion: 1,
    commercialFeatureFlagKey: 'commercial.virtual-account.inbound-funding.feature-flag.v1.standard',
    commercialFeatureFlagRolloutState: 'COMMERCIAL_FEATURE_FLAG_ENABLED',
    commercialFeatureFlagActivationReadiness: 'COMMERCIAL_ACTIVATION_READY',
    commercialFeatureFlagStartAt: '2024-01-01T00:00:00.000Z',
    commercialFeatureFlagEndAt: '2024-12-31T23:59:59.999Z',
    idempotencyKey: 'a1b2c3d4e5f6a7b8'.repeat(4),
    requestContext: buildRequestContext(),
    causationId: 'b1-commercial-governance-engine-ff-causation',
    ...overrides,
  }) as never;

describe('B1 commercial-governance engine repository (B1T10)', () => {
  let repository: B1CommercialGovernanceEngineRepository;

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
  });

  it('exposes the B1 commercial-governance engine contract name and version', () => {
    expect(repository.getContractName()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME);
    expect(repository.getContractVersion()).toBe(1);
  });

  it('exposes the B1 commercial-governance engine first commercial scope identity', () => {
    expect(repository.getScopeKey()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY);
    expect(repository.getScopeVersion()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_VERSION);
    expect(repository.getScopeCurrency()).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_CURRENCY);
    expect(repository.getScopeAccountingUnit()).toBe(
      B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_ACCOUNTING_UNIT,
    );
    expect(repository.getScopeDirection()).toBe('inbound');
    expect(repository.getScopeProductDependency()).toBe('VIRTUAL_ACCOUNT');
    expect(repository.getScopePartnerDependency()).toBe('NIBSS_NIP');
  });

  it('exposes the B1 commercial-governance engine period identity', () => {
    expect(repository.getPeriodKey()).toBe(
      'commercial.virtual-account.inbound-funding.commercial-governance-period.per-flow.v1',
    );
  });

  it('exposes the B1 commercial-governance engine audit, outbox, idempotency, and reference prefix', () => {
    expect(repository.getAuditActor()).toBe('b1-commercial-governance-engine');
    expect(repository.getAuditEntityType()).toBe('B1_COMMERCIAL_GOVERNANCE_DECISION');
    expect(repository.getOutboxEventType()).toBe('B1CommercialGovernanceDecisionDecided');
    expect(repository.getCommercialDataClassificationIdempotencyScope()).toBe(
      B1_COMMERCIAL_GOVERNANCE_ENGINE_COMMERCIAL_DATA_CLASSIFICATION_IDEMPOTENCY_SCOPE,
    );
    expect(repository.getIdempotencyRetentionSeconds()).toBe(86_400);
    expect(repository.getReferencePrefix()).toBe('b1-commercial-governance-decision');
  });

  it('exposes the B1 commercial-governance engine vocabulary accessors', () => {
    expect(repository.getCommercialDataClassificationStates().length).toBe(6);
    expect(repository.getCommercialIdempotencyStates().length).toBe(6);
    expect(repository.getCommercialAuditStates().length).toBe(6);
    expect(repository.getCommercialApprovalStates().length).toBe(7);
    expect(repository.getCommercialFeatureFlagStates().length).toBe(6);
    expect(repository.getDecisionKinds().length).toBe(5);
    expect(repository.getDecisionOutcomes().length).toBe(8);
    expect(repository.getDocumentKinds().length).toBe(26);
    expect(repository.getRuleKinds().length).toBeGreaterThan(50);
    expect(repository.getRuleOutcomes().length).toBe(4);
    expect(repository.getCommercialSensitivities().length).toBe(8);
    expect(repository.getCommercialDisclosureLevels().length).toBe(5);
    expect(repository.getCommercialRetentionClasses().length).toBe(6);
    expect(repository.getCommercialExportRules().length).toBe(6);
    expect(repository.getCommercialReplayPolicies().length).toBe(6);
    expect(repository.getCommercialReplayEligibilities().length).toBe(6);
    expect(repository.getCommercialAuditEvents().length).toBe(23);
    expect(repository.getCommercialApprovalRequirements().length).toBe(6);
    expect(repository.getCommercialApprovalPolicies().length).toBe(5);
    expect(repository.getCommercialFeatureFlagRolloutStates().length).toBe(7);
    expect(repository.getCommercialActivationReadinesses().length).toBe(5);
    expect(repository.getClassificationLevels().length).toBe(5);
    expect(repository.getDataControlClassifications().length).toBe(5);
    expect(repository.getCompatibilityRuleIds().length).toBeGreaterThan(0);
    expect(repository.getConsumerContractIds().length).toBeGreaterThan(0);
    expect(repository.getVersionNegotiationRuleIds().length).toBeGreaterThan(0);
    expect(repository.getReplayRuleIds().length).toBeGreaterThan(0);
    expect(repository.getDeclaredDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedDependencies().length).toBeGreaterThan(0);
    expect(repository.getProhibitedAdjacentScopes().length).toBeGreaterThan(0);
    expect(repository.getFailureCodes().length).toBe(28);
    expect(repository.getMetrics().length).toBeGreaterThan(20);
    expect(repository.getRetentionDays()).toBe(365);
  });

  it('generates a B1 commercial-data-classification decision for a valid request', () => {
    const record = repository.generateCommercialDataClassificationDecision(
      buildCommercialDataClassificationRequest(),
    );
    expect(record.commercialDataClassificationDecisionState).toBe('CLASSIFIED');
    expect(record.commercialDataClassificationDecisionOutcome).toBe('CLASSIFIED');
    expect(SHA256_RE.test(record.commercialDataClassificationDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialDataClassificationDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialDataClassificationRequestHash)).toBe(true);
    expect(record.commercialDataClassificationEligible).toBe(true);
    expect(record.commercialDataClassificationApplicable).toBe(true);
    expect(record.eligibilitySummary.length).toBe(10);
  });

  it('produces deterministic B1 commercial-data-classification decisions for identical inputs', () => {
    const request = buildCommercialDataClassificationRequest();
    const a = repository.generateCommercialDataClassificationDecision(request);
    const b = repository.generateCommercialDataClassificationDecision(request);
    expect(a.commercialDataClassificationDecisionHash).toBe(
      b.commercialDataClassificationDecisionHash,
    );
    expect(a.commercialDataClassificationDecisionReplayHash).toBe(
      b.commercialDataClassificationDecisionReplayHash,
    );
    expect(a.commercialDataClassificationRequestHash).toBe(
      b.commercialDataClassificationRequestHash,
    );
  });

  it('returns a failure commercial-data-classification decision for an invalid contract name', () => {
    const record = repository.generateCommercialDataClassificationDecision(
      buildCommercialDataClassificationRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure commercial-data-classification decision for an invalid scope key', () => {
    const record = repository.generateCommercialDataClassificationDecision(
      buildCommercialDataClassificationRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure commercial-data-classification decision for an invalid product key', () => {
    const record = repository.generateCommercialDataClassificationDecision(
      buildCommercialDataClassificationRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('returns a failure commercial-data-classification decision for an invalid idempotency key', () => {
    const record = repository.generateCommercialDataClassificationDecision(
      buildCommercialDataClassificationRequest({ idempotencyKey: 'invalid' }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 commercial-idempotency decision for a valid request', () => {
    const record = repository.generateCommercialIdempotencyDecision(
      buildCommercialIdempotencyRequest(),
    );
    expect(record.commercialIdempotencyDecisionState).toBe('RESERVED');
    expect(record.commercialIdempotencyDecisionOutcome).toBe('AVAILABLE');
    expect(SHA256_RE.test(record.commercialIdempotencyDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialIdempotencyDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialIdempotencyRequestHash)).toBe(true);
    expect(record.commercialIdempotencyEligible).toBe(true);
    expect(record.commercialIdempotencyApplicable).toBe(true);
  });

  it('produces deterministic B1 commercial-idempotency decisions for identical inputs', () => {
    const request = buildCommercialIdempotencyRequest();
    const a = repository.generateCommercialIdempotencyDecision(request);
    const b = repository.generateCommercialIdempotencyDecision(request);
    expect(a.commercialIdempotencyDecisionHash).toBe(b.commercialIdempotencyDecisionHash);
    expect(a.commercialIdempotencyDecisionReplayHash).toBe(
      b.commercialIdempotencyDecisionReplayHash,
    );
    expect(a.commercialIdempotencyRequestHash).toBe(b.commercialIdempotencyRequestHash);
  });

  it('returns a failure commercial-idempotency decision for an invalid request', () => {
    const record = repository.generateCommercialIdempotencyDecision(
      buildCommercialIdempotencyRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 commercial-audit decision for a valid request', () => {
    const record = repository.generateCommercialAuditDecision(buildCommercialAuditRequest());
    expect(record.commercialAuditDecisionState).toBe('RECORDED');
    expect(record.commercialAuditDecisionOutcome).toBe('AUDITED');
    expect(SHA256_RE.test(record.commercialAuditDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialAuditDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialAuditRequestHash)).toBe(true);
    expect(record.commercialAuditEligible).toBe(true);
    expect(record.commercialAuditApplicable).toBe(true);
  });

  it('produces deterministic B1 commercial-audit decisions for identical inputs', () => {
    const request = buildCommercialAuditRequest();
    const a = repository.generateCommercialAuditDecision(request);
    const b = repository.generateCommercialAuditDecision(request);
    expect(a.commercialAuditDecisionHash).toBe(b.commercialAuditDecisionHash);
    expect(a.commercialAuditDecisionReplayHash).toBe(b.commercialAuditDecisionReplayHash);
    expect(a.commercialAuditRequestHash).toBe(b.commercialAuditRequestHash);
  });

  it('returns a failure commercial-audit decision for an invalid request', () => {
    const record = repository.generateCommercialAuditDecision(
      buildCommercialAuditRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 commercial-approval decision for a valid request', () => {
    const record = repository.generateCommercialApprovalDecision(buildCommercialApprovalRequest());
    expect(record.commercialApprovalDecisionState).toBe('GRANTED');
    expect(record.commercialApprovalDecisionOutcome).toBe('APPROVED');
    expect(record.commercialApprovalGranted).toBe(true);
    expect(record.commercialApprovalDenied).toBe(false);
    expect(SHA256_RE.test(record.commercialApprovalDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialApprovalDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialApprovalRequestHash)).toBe(true);
  });

  it('returns a rejected commercial-approval decision for a deny policy', () => {
    const record = repository.generateCommercialApprovalDecision(
      buildCommercialApprovalRequest({
        commercialApprovalPolicy: 'COMMERCIAL_APPROVAL_POLICY_DENY',
      }),
    );
    expect(record.commercialApprovalDecisionOutcome).toBe('REJECTED');
    expect(record.commercialApprovalGranted).toBe(false);
    expect(record.commercialApprovalDenied).toBe(true);
  });

  it('returns a failure commercial-approval decision for an invalid request', () => {
    const record = repository.generateCommercialApprovalDecision(
      buildCommercialApprovalRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('generates a B1 commercial-feature-flag decision for a valid request', () => {
    const record = repository.generateCommercialFeatureFlagDecision(
      buildCommercialFeatureFlagRequest(),
    );
    expect(record.commercialFeatureFlagDecisionState).toBe('ENABLED');
    expect(record.commercialFeatureFlagDecisionOutcome).toBe('ROLLED_OUT');
    expect(record.commercialFeatureFlagEnabled).toBe(true);
    expect(SHA256_RE.test(record.commercialFeatureFlagDecisionHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialFeatureFlagDecisionReplayHash)).toBe(true);
    expect(SHA256_RE.test(record.commercialFeatureFlagRequestHash)).toBe(true);
  });

  it('returns a failure commercial-feature-flag decision for an invalid request', () => {
    const record = repository.generateCommercialFeatureFlagDecision(
      buildCommercialFeatureFlagRequest({ contractName: 'B1-OTHER-ENGINE' as never }),
    );
    expect(record.failure?.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INVALID_COMMAND);
  });

  it('runs a B1 commercial-governance engine compatibility check', () => {
    const compatibility = repository.compatibilityCheck(buildCommercialDataClassificationRequest());
    expect(compatibility.compatible).toBe(true);
  });

  it('returns a compatibility mismatch for an invalid scope key', () => {
    const compatibility = repository.compatibilityCheck(
      buildCommercialDataClassificationRequest({ scopeKey: 'commercial.fx' as never }),
    );
    expect(compatibility.compatible).toBe(false);
    if (!compatibility.compatible) {
      expect(compatibility.code).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_FAILURE_INCOMPATIBLE);
    }
  });

  it('returns a compatibility mismatch for an invalid product key', () => {
    const compatibility = repository.compatibilityCheck(
      buildCommercialDataClassificationRequest({ productKey: 'SAVINGS' as never }),
    );
    expect(compatibility.compatible).toBe(false);
  });

  it('returns the B1 commercial-governance engine versioning contract', () => {
    const versioning = repository.getVersioningContract();
    expect(versioning.contractName).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_CONTRACT_NAME);
    expect(versioning.documentVersion).toBe(1);
    expect(versioning.scopeKey).toBe(B1_COMMERCIAL_GOVERNANCE_ENGINE_SCOPE_KEY);
  });

  it('exposes the B1 commercial-governance engine consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const evaluated = await ports.generateCommercialDataClassificationDecision(
      buildCommercialDataClassificationRequest(),
    );
    expect(evaluated.commercialDataClassificationDecisionState).toBe('CLASSIFIED');
  });

  it('runs a replay-safe generate commercial-data-classification decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCommercialDataClassificationDecision(
      buildCommercialDataClassificationRequest(),
    );
    expect(result.record.commercialDataClassificationDecisionState).toBe('CLASSIFIED');
    expect(SHA256_RE.test(result.commercialDataClassificationRequestHash)).toBe(true);
    expect(SHA256_RE.test(result.commercialDataClassificationDecisionHash)).toBe(true);
    expect(SHA256_RE.test(result.commercialDataClassificationDecisionReplayHash)).toBe(true);
  });

  it('runs a replay-safe generate commercial-idempotency decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCommercialIdempotencyDecision(
      buildCommercialIdempotencyRequest(),
    );
    expect(result.record.commercialIdempotencyDecisionState).toBe('RESERVED');
  });

  it('runs a replay-safe generate commercial-audit decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCommercialAuditDecision(
      buildCommercialAuditRequest(),
    );
    expect(result.record.commercialAuditDecisionState).toBe('RECORDED');
  });

  it('runs a replay-safe generate commercial-approval decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCommercialApprovalDecision(
      buildCommercialApprovalRequest(),
    );
    expect(result.record.commercialApprovalDecisionState).toBe('GRANTED');
  });

  it('runs a replay-safe generate commercial-feature-flag decision', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.replaySafeGenerateCommercialFeatureFlagDecision(
      buildCommercialFeatureFlagRequest(),
    );
    expect(result.record.commercialFeatureFlagDecisionState).toBe('ENABLED');
  });

  it('runs a compatibility check via consumer ports', async () => {
    const ports = repository.getConsumerPorts();
    const result = await ports.compatibilityCheck(buildCommercialDataClassificationRequest());
    expect(result.compatible).toBe(true);
  });
});

void B1CommercialAnalyticsEngineService;
